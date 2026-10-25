// "Since you were gone…" — mounted by routes/game.js under /api/game:
//   POST /seen         auth — the client's heartbeat while the game is open:
//                      marks the player online now and clears the ledger.
//   GET  /away-report  auth — everything that happened since the last
//                      heartbeat: resources produced / eaten (with who
//                      contributed), quests, births, partnerships, deaths,
//                      the Happenings and seasons that passed, and what is
//                      waiting for the player. show=false for short absences.
// The settlement's own tick (GET /settlement → applyTick) must run first so
// the ledger is up to date; the client fetches this after loading the game.
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { query } = require('../db');
const { calculateRatesBreakdown } = require('../buildings');
const { buildUpkeepBreakdownSource, buildOutpostUpkeepBreakdownSource } = require('../famine');
const happenings = require('../lib/happenings');
const HFX = require('../lib/happening_effects');
const A = require('../lib/away_report');

const router = express.Router();

router.post('/seen', requireAuth, async (req, res) => {
  try {
    await query(`UPDATE settlements SET away_since = NOW(), away_ledger = '{}'::jsonb WHERE user_id = $1`, [req.user.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[away] seen failed:', err.message);
    res.status(500).json({ error: 'Failed.' });
  }
});

router.get('/away-report', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const sRes = await query(
      `SELECT s.id, s.away_since, s.away_ledger, u.species
         FROM settlements s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
      [req.user.userId]
    );
    const s = sRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const now = Date.now();
    const since = s.away_since ? new Date(s.away_since).getTime() : null;
    if (!since || now - since < A.AWAY_MIN_MS) return res.json({ ok: true, show: false });

    res.json(Object.assign({ ok: true, show: true, since, now, awayMs: now - since }, await buildReport(s, since, now)));
  } catch (err) {
    console.error('[away] report failed:', err);
    res.status(500).json({ error: 'Failed to build the report.' });
  }
});

async function buildReport(s, since, now) {
  const sinceIso = new Date(since).toISOString();
  const [bRes, cRes, oRes, evRes, soloRes, ceRes, waitRes] = await Promise.all([
    query('SELECT id, type, level FROM buildings WHERE settlement_id=$1', [s.id]),
    query('SELECT id, name, role, life_stage FROM citizens WHERE settlement_id=$1', [s.id]),
    query('SELECT id, tile_q, tile_r, terrain, level FROM outposts WHERE settlement_id=$1', [s.id]).catch(() => ({ rows: [] })),
    query(`SELECT type, message, citizen_ids, created_at FROM settlement_events
            WHERE settlement_id=$1 AND created_at > $2 ORDER BY created_at DESC LIMIT $3`, [s.id, sinceIso, A.MAX_EVENTS]),
    query(`SELECT id, quest_id, citizen_id, status, resolved_at, completes_at FROM settlement_quests
            WHERE settlement_id=$1 AND COALESCE(quest_type, 'solo') != 'party' AND status IN ('completed', 'failed', 'collected')
              AND (resolved_at > $2 OR (resolved_at IS NULL AND status = 'failed' AND completes_at > $2))
            ORDER BY id DESC LIMIT $3`, [s.id, sinceIso, A.MAX_EVENTS]),
    query(`SELECT citizen_id, event_type, narrative, occurred_at FROM citizen_events
            WHERE settlement_id=$1 AND occurred_at > $2 AND COALESCE(cause, '') != 'starvation'
            ORDER BY occurred_at DESC LIMIT $3`, [s.id, sinceIso, A.MAX_EVENTS]).catch(() => ({ rows: [] })),
    query(`SELECT
             COUNT(*) FILTER (WHERE status = 'completed')::int AS to_collect,
             COUNT(*) FILTER (WHERE status = 'active' AND combat_status = 'pending')::int AS battles
           FROM settlement_quests WHERE settlement_id=$1`, [s.id]).catch(() => ({ rows: [{}] })),
  ]);

  const names = {};
  for (const c of cRes.rows) names[c.id] = c.name;

  // ── Resources: ledger totals, split over who produced / ate them ──
  const ledger = s.away_ledger || {};
  const base = calculateRatesBreakdown(bRes.rows, cRes.rows.filter(c => c.life_stage !== 'deceased' && c.life_stage !== 'child'), s.species, oRes.rows);
  const defs = await happenings.loadLive();
  const effHours = A.effectiveProductionHours(defs, since, now);
  const awayHours = (now - since) / 3600000;
  const resources = {};
  for (const r of HFX.RESOURCES) {
    const produced = Math.round(Number(ledger['produced_' + r]) || 0);
    const consumed = Math.round(Number(ledger['consumed_' + r]) || 0);
    resources[r] = {
      produced, consumed, net: produced - consumed,
      // Average season × Happening multiplier over the absence (1 = none).
      multiplier: awayHours > 0 ? Math.round(effHours[r] / awayHours * 100) / 100 : 1,
      sources: A.splitBySources(produced, (base[r] && base[r].sources || []).filter(x => x.kind !== 'season_multiplier')),
      consumers: [],
    };
  }
  if (resources.food.consumed > 0) {
    const upkeep = [];
    try { upkeep.push(await buildUpkeepBreakdownSource(s.id)); } catch (e) {}
    try { const op = await buildOutpostUpkeepBreakdownSource(s.id); if (op) upkeep.push(op); } catch (e) {}
    resources.food.consumers = A.splitBySources(resources.food.consumed, upkeep.map(u => Object.assign({}, u, { weight: u.per_hour })));
  }

  // ── Events ──
  const events = evRes.rows.map(A.eventFromSettlementEvent);
  if (soloRes.rows.length) {
    const titles = await questTitles(soloRes.rows.map(q => q.quest_id));
    for (const q of soloRes.rows) events.push(A.eventFromSoloQuest(q, titles[q.quest_id] || 'a quest', names[q.citizen_id]));
  }
  for (const e of ceRes.rows) events.push(A.eventFromCitizenEvent(e, names[e.citizen_id]));

  // ── Trade & crafting: pieces made, recipes learned, Market deals ──
  const trade = await tradeSince(s.id, sinceIso, since);
  events.push(...trade.events);

  const wait = waitRes.rows[0] || {};
  const waiting = [];
  if (wait.to_collect > 0) waiting.push({ icon: '🎁', text: `${wait.to_collect} quest reward${wait.to_collect === 1 ? '' : 's'} ready to collect`, action: 'quests' });
  if (wait.battles > 0) waiting.push({ icon: '⚔️', text: `${wait.battles} battle${wait.battles === 1 ? '' : 's'} waiting for you`, action: 'battles' });

  const seasons = A.seasonsBetween(since, now);
  return {
    resources,
    events: A.sortAndCap(events),
    citizens: names,
    happenings: A.happeningsBetween(defs, since, now),
    seasons: seasons.length > 1 ? seasons : [],
    waiting,
    trade: trade.totals,
  };
}

// What the workshops and the Market did while you were away. Optional
// tables (pre-migration) just yield nothing.
const QORDER = ['basic', 'sturdy', 'fine', 'superior', 'legendary'];
async function tradeSince(sid, sinceIso, sinceMs) {
  const none = { rows: [] };
  const [jobs, learned, deals] = await Promise.all([
    query(`SELECT j.*, c.name AS citizen_name FROM craft_jobs j LEFT JOIN citizens c ON c.id = j.citizen_id
            WHERE j.settlement_id = $1 AND j.status IN ('done','ruined') AND j.finished_at > $2
            ORDER BY j.finished_at DESC LIMIT $3`, [sid, sinceIso, A.MAX_EVENTS]).catch(() => none),
    query(`SELECT k.*, r.name AS recipe_name, c.name AS citizen_name FROM settlement_recipes k
             LEFT JOIN recipes r ON r.recipe_key = k.recipe_key LEFT JOIN citizens c ON c.id = k.citizen_id
            WHERE k.settlement_id = $1 AND k.learned_at > $2 AND k.source <> 'admin'`, [sid, sinceIso]).catch(() => none),
    query(`SELECT * FROM market_trades WHERE (seller_settlement_id = $1 OR buyer_settlement_id = $1) AND agreed_at > $2
            ORDER BY id DESC LIMIT 200`, [sid, sinceIso]).catch(() => none),
  ]);
  const ledger = require('../lib/market_ledger');
  const entries = deals.rows.map(t => ledger.entryFor(t, sid));
  const made = jobs.rows.filter(j => j.status === 'done');
  const best = made.reduce((b, j) => (QORDER.indexOf(j.quality) > QORDER.indexOf(b) ? j.quality : b), null);
  const live = entries.filter(e => e.status !== 'returned');
  const totals = {
    made: made.length, ruined: jobs.rows.length - made.length, best_quality: best,
    listed: made.filter(j => j.roll && j.roll.listed).length,
    learned: learned.rows.length,
    earned: live.filter(e => e.side === 'sold').reduce((n, e) => n + e.net, 0),
    spent: live.filter(e => e.side === 'bought').reduce((n, e) => n - e.net, 0),
    fees: live.reduce((n, e) => n + (e.fee || 0), 0),
    deals: live.length,
    on_road: live.filter(e => e.side === 'sold' && e.status === 'on_road').reduce((n, e) => n + e.net, 0),
  };
  totals.net = totals.earned - totals.spent;
  return {
    totals,
    events: [...jobs.rows.map(A.eventFromCraftJob), ...learned.rows.map(A.eventFromRecipe), ...entries.map(A.eventFromTrade)]
      .filter(e => Number.isFinite(e.at) && e.at > sinceMs),
  };
}

// Quest titles from the hardcoded pools, then quest_definitions (NPC quests).
async function questTitles(ids) {
  const out = {};
  const Q = require('./quests');
  for (const q of [...(Q.QUEST_POOL || []), ...(Q.PARTY_QUEST_POOL || [])]) out[q.id] = q.title;
  const missing = [...new Set(ids)].filter(id => !out[id]);
  if (missing.length) {
    const r = await query('SELECT id, title FROM quest_definitions WHERE id = ANY($1)', [missing]).catch(() => ({ rows: [] }));
    for (const row of r.rows) out[row.id] = row.title;
  }
  return out;
}

module.exports = router;
module.exports._buildReport = buildReport;
