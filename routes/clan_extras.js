// ══════════════════════════════════════════════════════════════════════════
//  Clan treasury, boons, weekly goals and land release (mounted at
//  /api/clans before routes/clans.js).
//
//  GET    /treasury              balance, my donations today, boons, log, land
//  POST   /treasury/donate       { amount }
//  POST   /boons/:key            buy a boon (treasury permission)
//  GET    /goals                 this week's goals with progress (pays any met)
//  DELETE /territory/:q/:r       give up a tile (release_territory permission)
//  POST   /admin/treasury        Dev Tools: { amount } into my clan's treasury
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query } = require('../db');
const T = require('../lib/clan_treasury');
const G = require('../lib/clan_goals');

const router = express.Router();
const send = (res, e, fallback) => {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[clan_extras]', e);
  res.status(500).json({ error: fallback });
};

router.get('/treasury', requireAuth, async (req, res) => {
  try {
    const v = await T.view(req.user.userId);
    if (!v) return res.status(403).json({ error: 'You are not in a clan.' });
    res.json({ ok: true, ...v });
  } catch (e) { send(res, e, 'Could not load the treasury.'); }
});

router.post('/treasury/donate', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await T.donate(req.user.userId, req.body && req.body.amount)) }); }
  catch (e) { send(res, e, 'Could not make the donation.'); }
});

router.post('/boons/:key', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await T.buyBoon(req.user.userId, req.params.key)) }); }
  catch (e) { send(res, e, 'Could not buy the boon.'); }
});

router.get('/goals', requireAuth, async (req, res) => {
  try {
    const m = await T.clanOf(req.user.userId);
    if (!m) return res.status(403).json({ error: 'You are not in a clan.' });
    res.json({ ok: true, ...(await G.refresh(m.clan_id)), honors: await G.honorsOf(m.clan_id) });
  } catch (e) { send(res, e, 'Could not load the goals.'); }
});

router.delete('/territory/:q/:r', requireAuth, async (req, res) => {
  try {
    const q = parseInt(req.params.q, 10), r = parseInt(req.params.r, 10);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return res.status(400).json({ error: 'Bad tile.' });
    const perm = await require('../lib/clan_permissions').checkClanPermission(req.user.userId, 'release_territory');
    if (!perm) return res.status(403).json({ error: 'You are not in a clan.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Your rank can\'t give up land.' });
    const clan = (await query('SELECT hq_q, hq_r FROM clans WHERE id = $1', [perm.clanId])).rows[0];
    if (clan && clan.hq_q === q && clan.hq_r === r) return res.status(400).json({ error: 'The hall\'s own tile can\'t be given up.' });
    const del = await query('DELETE FROM clan_territory WHERE clan_id = $1 AND q = $2 AND r = $3 RETURNING q, r', [perm.clanId, q, r]);
    if (!del.rowCount) return res.status(404).json({ error: 'That tile isn\'t your clan\'s.' });
    await query("INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'territory_released',$2,$3)", [perm.clanId, req.user.userId, JSON.stringify({ q, r })]).catch(() => {});
    try { require('../lib/event_bus').publish(`clan:${perm.clanId}`, { type: 'clan_territory_claimed', clan_id: perm.clanId }); } catch (e) { /* offline */ }
    const left = Number((await query('SELECT COUNT(*)::int AS n FROM clan_territory WHERE clan_id = $1', [perm.clanId])).rows[0].n);
    res.json({ ok: true, released: { q, r }, tiles: left });
  } catch (e) { send(res, e, 'Could not give up the tile.'); }
});

router.post('/admin/treasury', requireAuth, requireAdmin, async (req, res) => {
  try {
    const m = await T.clanOf(req.user.userId);
    if (!m) return res.status(403).json({ error: 'You are not in a clan.' });
    const amount = Math.max(1, Math.min(100000, parseInt(req.body && req.body.amount, 10) || 1000));
    const c = (await query('UPDATE clans SET treasury = treasury + $2 WHERE id = $1 RETURNING treasury', [m.clan_id, amount])).rows[0];
    await query("INSERT INTO clan_treasury_log (clan_id, user_id, kind, amount) VALUES ($1,$2,'admin',$3)", [m.clan_id, req.user.userId, amount]);
    res.json({ ok: true, treasury: Number(c.treasury) });
  } catch (e) { send(res, e, 'Failed.'); }
});

module.exports = router;
