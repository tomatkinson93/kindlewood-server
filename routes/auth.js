const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
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

router.post('/register', async (req, res) => {
  const { username, email, password, species } = req.body;
  if (!username || !email || !password || !species)
    return res.status(400).json({ error: 'All fields are required.' });
  if (!SPECIES_VALID.includes(species))
    return res.status(400).json({ error: 'Invalid species.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

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
      [username, email, password_hash, species]
    );
    const userId = userResult.rows[0].id;

    const settlementResult = await query(
      "INSERT INTO settlements (user_id, name) VALUES ($1,$2) RETURNING id",
      [userId, `${username}'s Camp`]
    );
    const settlementId = settlementResult.rows[0].id;

    for (const b of STARTER_BUILDINGS[species]) {
      await query(
        'INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)',
        [settlementId, b]
      );
    }

    const token = jwt.sign({ userId, username, species }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ ok: true, username, species });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { userId: user.id, username: user.username, species: user.species },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({ ok: true, username: user.username, species: user.species });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, username: payload.username, species: payload.species });
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
});

module.exports = router;
