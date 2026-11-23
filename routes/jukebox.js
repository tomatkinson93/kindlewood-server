// ══════════════════════════════════════════════════════════════════════════
//  /api/jukebox — what listeners think of the battle music.
//  For jukebox.html on the site: a page anyone with the link can open, to hear
//  each track over the kind of battle it is for and say what they think.
//  Nobody signs in. A listener is a random id their browser keeps.
//
//    GET  /?visitor=<id>   → { tracks: { <track>: { stars, count } }, mine: { <track>: { stars, comment, name } } }
//    POST /rate            { visitor, track, stars: 1–5, comment?, name? }  → the same answer; rating again changes it
//    GET  /admin/feedback  (admins) every rating with its comment, newest first
//
//  Open to the world, so it is kept small and hard to misuse: averages are
//  public, comments are shown only to their writer and to admins; text is
//  stored as plain text and capped; one address can write only so often and
//  hold only so many rows; the address is kept as a salted hash, never itself.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { rateLimit } = require('../lib/rate_limit');

const router = express.Router();
const LIMITS = { comment: 600, name: 40, perAddress: 300 };
const TRACK = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const VISITOR = /^[a-z0-9]{16,40}$/;
const hashOf = ip => crypto.createHash('sha256').update((process.env.JWT_SECRET || 'kindlewood') + '|jukebox|' + String(ip || '')).digest('hex').slice(0, 32);
// Plain text only: control characters out, runs of space squeezed, cut to length.
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

const readLimit = rateLimit({ name: 'jukebox-read', windowMs: 60 * 1000, max: 120, keys: req => [req.ip], message: 'Too many requests. Please wait a moment.' });
const writeLimit = rateLimit({ name: 'jukebox-write', windowMs: 10 * 60 * 1000, max: 60, keys: req => [req.ip], message: 'That is a lot of ratings at once. Please wait a few minutes.' });

async function summary(visitor) {
  const all = (await query('SELECT track, ROUND(AVG(stars)::numeric, 2) AS stars, COUNT(*)::int AS count FROM jukebox_feedback GROUP BY track')).rows;
  const tracks = {};
  for (const r of all) tracks[r.track] = { stars: Number(r.stars), count: r.count };
  const mine = {};
  if (VISITOR.test(String(visitor || ''))) {
    for (const r of (await query('SELECT track, stars, comment, name FROM jukebox_feedback WHERE visitor = $1', [visitor])).rows) mine[r.track] = { stars: r.stars, comment: r.comment, name: r.name };
  }
  return { ok: true, tracks, mine };
}

router.get('/', readLimit, async (req, res) => {
  try { res.json(await summary(req.query.visitor)); } catch (e) { console.error('[jukebox]', e); res.status(500).json({ error: 'The ratings could not be read.' }); }
});

router.post('/rate', writeLimit, async (req, res) => {
  try {
    const b = req.body || {}, visitor = String(b.visitor || ''), track = String(b.track || ''), stars = Number(b.stars);
    if (!VISITOR.test(visitor)) return res.status(400).json({ error: 'This browser has no listener id. Reload the page and try again.' });
    if (!TRACK.test(track)) return res.status(400).json({ error: 'No such track.' });
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'A rating is one to five stars.' });
    const ip = hashOf(req.ip);
    const held = (await query('SELECT COUNT(*)::int AS n FROM jukebox_feedback WHERE ip_hash = $1', [ip])).rows[0].n;
    const has = (await query('SELECT 1 FROM jukebox_feedback WHERE track = $1 AND visitor = $2', [track, visitor])).rowCount;
    if (!has && held >= LIMITS.perAddress) return res.status(429).json({ error: 'This address has left as many ratings as it may.' });
    await query(
      `INSERT INTO jukebox_feedback (track, visitor, stars, comment, name, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (track, visitor) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, name = EXCLUDED.name, ip_hash = EXCLUDED.ip_hash, updated_at = NOW()`,
      [track, visitor, stars, clean(b.comment, LIMITS.comment), clean(b.name, LIMITS.name), ip]);
    res.json(await summary(visitor));
  } catch (e) { console.error('[jukebox]', e); res.status(500).json({ error: 'The rating could not be saved.' }); }
});

router.get('/admin/feedback', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = (await query('SELECT track, stars, comment, name, created_at, updated_at FROM jukebox_feedback ORDER BY updated_at DESC LIMIT 1000')).rows;
    res.json({ ok: true, feedback: rows });
  } catch (e) { console.error('[jukebox]', e); res.status(500).json({ error: 'The feedback could not be read.' }); }
});

router._test = { clean, hashOf, LIMITS, TRACK, VISITOR };
module.exports = router;
