// ══════════════════════════════════════════════════════════════════════════
//  resources — a town's stores beyond the basic five, and what it has
//  discovered. The list itself is lib/resource_defs.js (shared with the
//  frontend).
//
//    discoveredKeys(db, sid)           extra keys the town knows
//    discover(db, sid, key, source)    → true the first time (writes a
//                                        settlement event for the log and
//                                        the away report)
//    discoverHeld(db, settlement)      discover every extra the town holds
//                                        (gains that skipped discover(), e.g.
//                                        an admin grant); returns new keys
//    resourcesOf(settlement)           { key: amount } for every resource
//    unseen(db, sid) / markSeen(…)     the "New discovery!" cards
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const RD = require('./resource_defs');
const { query: pool } = require('../db');

const q = (db, sql, params) => (db && db.query ? db.query(sql, params) : pool(sql, params));

async function discoveredKeys(db, sid) {
  const r = await q(db, 'SELECT key FROM settlement_discoveries WHERE settlement_id=$1', [sid]).catch(() => ({ rows: [] }));
  return r.rows.map(x => x.key).filter(k => RD.isResource(k) && !RD.startsKnown(k));
}

async function discover(db, sid, key, source = 'stock') {
  if (!RD.isResource(key) || RD.startsKnown(key)) return false;
  const r = await q(db,
    `INSERT INTO settlement_discoveries (settlement_id, key, source) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING RETURNING key`, [sid, key, String(source).slice(0, 20)]);
  if (!r.rowCount) return false;
  await q(db, 'INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1,$2,$3,$4)',
    [sid, 'discovery', `${RD.icon(key)} New discovery: ${RD.label(key)}! ${RD.sourceHint(key)}`.trim(), '[]']);
  return true;
}

async function discoverHeld(db, settlement) {
  if (!settlement) return [];
  const held = RD.EXTRA.filter(k => Number(settlement[k]) > 0);
  if (!held.length) return [];
  const known = new Set(await discoveredKeys(db, settlement.id));
  const out = [];
  for (const k of held) if (!known.has(k) && await discover(db, settlement.id, k, 'stock')) out.push(k);
  return out;
}

function resourcesOf(settlement) {
  const out = {};
  for (const k of RD.KEYS) out[k] = Number(settlement && settlement[k]) || 0;
  return out;
}

async function unseen(db, sid) {
  const r = await q(db, 'SELECT key, source, discovered_at FROM settlement_discoveries WHERE settlement_id=$1 AND NOT seen ORDER BY discovered_at', [sid]).catch(() => ({ rows: [] }));
  return r.rows.filter(x => RD.isResource(x.key)).map(x => ({
    key: x.key, label: RD.label(x.key), icon: RD.icon(x.key), source: x.source, at: x.discovered_at, hint: RD.sourceHint(x.key),
  }));
}
async function markSeen(db, sid, keys) {
  await q(db, 'UPDATE settlement_discoveries SET seen=TRUE WHERE settlement_id=$1 AND ($2::text[] IS NULL OR key = ANY($2))',
    [sid, Array.isArray(keys) && keys.length ? keys.map(String) : null]);
}

module.exports = { discoveredKeys, discover, discoverHeld, resourcesOf, unseen, markSeen };
