const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const clanPalette = require('../lib/clan_palette');
const { RANK_LABELS } = require('../lib/clan_permissions');

const router = express.Router();
const { JWT_SECRET } = require('../lib/jwt_secret');

const names = require('../lib/names');
const { rateLimit } = require('../lib/rate_limit');

// SECURITY_REVIEW.md S3. req.ip is the player's address because index.js
// sets `trust proxy` for Render's proxy.
const loginLimit = rateLimit({
  name: 'login', windowMs: 60 * 1000, max: 10,
  keys: req => [req.ip, req.body && typeof req.body.email === 'string' ? 'e:' + req.body.email.trim() : null],
  message: 'Too many sign-in attempts. Please wait a minute and try again.',
});
const registerLimit = rateLimit({
  name: 'register', windowMs: 60 * 60 * 1000, max: 5,
  keys: req => [req.ip],
  message: 'Too many new accounts from this address. Please try again later.',
});

// Sign-in is by Bearer token only. The old `token` cookie (SameSite=None)
// let other websites act as a signed-in player (SECURITY_REVIEW.md S2), so
// it is no longer set or read. Logout still clears any old one.
const OLD_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
};

const SPECIES_VALID = ['Mice', 'Badgers', 'Otters', 'Moles', 'Foxes', 'Hares'];

const STARTER_BUILDINGS = {
  Mice:    ['granary', 'farm', 'market'],
  Badgers: ['granary', 'barracks', 'quarry'],
  Otters:  ['granary', 'dock', 'market'],
  Moles:   ['granary', 'mine', 'workshop'],
  Foxes:   ['granary', 'watchtower', 'market'],
  Hares:   ['granary', 'barracks', 'farm'],
};

// A sign-in lasts a week; without "Keep me signed in" (a shared computer:
// the client sends remember: false) twelve hours, and the client ends it
// sooner (js/session.js in the frontend).
const tokenLife = body => (body && body.remember === false ? '12h' : '7d');

router.post('/register', registerLimit, async (req, res) => {
  const body = req.body || {};
  const { password, species } = body;
  if (!body.username || !body.email || !password)
    return res.status(400).json({ error: 'All fields are required.' });
  const username = names.cleanUsername(body.username);
  if (!username) return res.status(400).json({ error: names.USERNAME_RULE });
  const email = names.cleanEmail(body.email);
  if (!email) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (species && !SPECIES_VALID.includes(species))
    return res.status(400).json({ error: 'Invalid species.' });
  const pwProblem = names.passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  try {
    const existing = await query(
      'SELECT id FROM users WHERE email=$1 OR username=$2',
      [email, username]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Email or username already in use.' });

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await query(
      'INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,$3,$4) RETURNING id',
      [username, email, password_hash, species || 'pending']
    );
    const userId = userResult.rows[0].id;

    const settlementResult = await query(
      "INSERT INTO settlements (user_id, name) VALUES ($1,$2) RETURNING id",
      [userId, `${username}'s Camp`]
    );
    const settlementId = settlementResult.rows[0].id;

    // Starter buildings added during arrival when species is confirmed


    // The client stores this token and sends it as a Bearer header.
    const token = jwt.sign({ userId, username, species }, JWT_SECRET, { expiresIn: tokenLife(body) });
    res.json({ ok: true, username, species, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', loginLimit, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  if (email.length > names.EMAIL_MAX || Buffer.byteLength(password, 'utf8') > 1024)
    return res.status(401).json({ error: 'Invalid email or password.' });

  try {
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { userId: user.id, username: user.username, species: user.species },
      JWT_SECRET, { expiresIn: tokenLife(req.body) }
    );
    res.json({ ok: true, username: user.username, species: user.species, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', async (req, res) => {
  res.clearCookie('token', OLD_COOKIE_OPTIONS);
  // A test account is deleted when it signs out (lib/test_accounts.js).
  let deleted = false;
  try {
    const h = req.headers.authorization || '';
    const payload = h.startsWith('Bearer ') ? jwt.verify(h.slice(7), JWT_SECRET) : null;
    if (payload && payload.userId) deleted = await require('../lib/test_accounts').purge(payload.userId);
  } catch (e) { if (e && e.name !== 'JsonWebTokenError' && e.name !== 'TokenExpiredError') console.error('[test accounts] purge on logout:', e.message); }
  res.json({ ok: true, ...(deleted ? { test_account_deleted: true } : {}) });
});

// ── Test accounts (lib/test_accounts.js) ────────────────────────────────────
//   GET  /api/auth/test-account           { available }  (is the button offered)
//   POST /api/auth/test-account           a fresh account, signed in: { username, token, test: true }
//   POST /api/auth/test-account/switch { on }   admins: offer the button or not
const testLimit = rateLimit({
  name: 'test-account', windowMs: 60 * 60 * 1000, max: 30,
  keys: req => [req.ip],
  message: 'Too many test accounts from this address. Please try again later.',
});
router.get('/test-account', async (req, res) => {
  res.json({ ok: true, available: await require('../lib/test_accounts').available() });
});
router.post('/test-account', testLimit, async (req, res) => {
  const TA = require('../lib/test_accounts');
  try {
    const a = await TA.create();
    const token = jwt.sign({ userId: a.userId, username: a.username, species: 'pending' }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ ok: true, username: a.username, species: 'pending', token, test: true });
  } catch (e) {
    if (e instanceof TA.TestAccountError) return res.status(e.status).json({ error: e.message });
    console.error('[test accounts] create:', e);
    res.status(500).json({ error: 'Could not make a test account.' });
  }
});
router.post('/test-account/switch', requireAuth, require('../middleware/admin').requireAdmin, async (req, res) => {
  try {
    await require('../lib/tuning').setSwitch('test_login.on', !!(req.body || {}).on);
    res.json({ ok: true, available: await require('../lib/test_accounts').available() });
  } catch (e) { console.error('[test accounts] switch:', e); res.status(500).json({ error: 'Could not change it.' }); }
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, userId: payload.userId, username: payload.username, species: payload.species });
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
});

module.exports = router;

// GET /api/auth/profile/:username — public profile fetch
router.get('/profile/:username', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.username, u.species, u.bio, u.created_at,
              s.name as settlement_name, s.tier, s.tile_q, s.tile_r, s.population,
              c.id AS clan_id, c.name AS clan_name, c.banner AS clan_banner, c.level AS clan_level,
              cm.rank AS clan_rank, cm.title AS clan_title
       FROM users u
       LEFT JOIN settlements s ON s.user_id = u.id
       LEFT JOIN clan_members cm ON cm.user_id = u.id
       LEFT JOIN clans c ON c.id = cm.clan_id
       WHERE u.username = $1`,
      [req.params.username]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({
      ok: true,
      username: user.username,
      species:  user.species,
      bio:      user.bio || '',
      joined:   user.created_at,
      settlement: user.settlement_name ? {
        name: user.settlement_name,
        tier: user.tier,
        tile_q: user.tile_q,
        tile_r: user.tile_r,
        population: user.population,
      } : null,
      // Clan membership for the profile's clan line (spec 016 Phase 5).
      clan: user.clan_id ? {
        id: user.clan_id, name: user.clan_name, level: user.clan_level,
        banner: clanPalette.resolveBanner(user.clan_banner),
        rank: user.clan_rank, rank_label: RANK_LABELS[user.clan_rank] || user.clan_rank,
        title: user.clan_level >= clanPalette.TITLE_UNLOCK_LEVEL ? (user.clan_title || '') : '',
      } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// PATCH /api/auth/profile — update own bio (authenticated)
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { bio } = req.body;
    if (typeof bio !== 'string') return res.status(400).json({ error: 'Bio must be a string.' });
    const trimmed = bio.trim().slice(0, 280);
    await query('UPDATE users SET bio=$1 WHERE id=$2', [trimmed, req.user.userId]);
    res.json({ ok: true, bio: trimmed });
  } catch (err) {
    console.error('Profile patch error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});
