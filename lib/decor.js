// ═══════════════════════════════════════════════════════════════════════════
//  Decorating and charm (docs/HOME_SCENE.md Part F, F.9; step 23).
//
//  In Build mode the player places small things in the Home scene: benches,
//  lantern posts, flower beds, fence pieces, a well, a pond. Each costs a
//  little timber or stone, and together they give the town charm.
//
//  Charm is a score: every kind counts, each further one of the same kind
//  for less (× REPEAT of the one before), so variety beats rows of benches.
//  With upkeep on, buildings kept sound add up to SOUND_POINTS. Every
//  PER_BONUS points of charm is +1 happiness for the whole town, to at most
//  MAX_BONUS (lib/town_mods adds it; it shows in the town's sources).
//
//  Everything that counts is here: what is placed, what it cost, and the
//  charm. The scene only draws.
//
//    state(sid)                         what is placed, the kinds and costs, the charm
//    place(sid, { kind, area, x, y })   pay and place
//    move(sid, id, { area?, x, y })     free
//    remove(sid, id)                    half the cost back
//    charm(db, s)                       { score, bonus, line } for lib/town_mods
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');

const CONFIG = {
  MAX: 60,              // decorations per town
  REPEAT: 0.7,          // each further one of a kind counts this much of the one before
  PER_BONUS: 10,        // charm per +1 happiness
  MAX_BONUS: 5,
  SOUND_POINTS: 10,     // charm when every building is sound (upkeep on); in proportion below that
  REFUND: 0.5,
  AREAS: ['town', 'neighbourhood', 'outskirts'],
  Y: [40, 100],         // the band of the picture that can be ground, in percent
};
// `charm`: what the first one is worth. `max`: how many a town may have.
const KINDS = [
  { key: 'bench',      label: 'Bench',        icon: '🪑', cost: { timber: 12 },            charm: 3, max: 12 },
  { key: 'lantern',    label: 'Lantern post', icon: '🏮', cost: { timber: 8 },             charm: 3, max: 16 },
  { key: 'flower_bed', label: 'Flower bed',   icon: '🌷', cost: { timber: 4 },             charm: 2, max: 16 },
  { key: 'fence',      label: 'Fence piece',  icon: '🚧', cost: { timber: 5 },             charm: 1, max: 24 },
  { key: 'well',       label: 'Well',         icon: '🪣', cost: { stone: 30, timber: 10 }, charm: 6, max: 2 },
  { key: 'pond',       label: 'Pond',         icon: '💧', cost: { stone: 20 },             charm: 6, max: 2 },
];
const kindOf = key => KINDS.find(k => k.key === key) || null;

class DecorError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// ── Pure rules ─────────────────────────────────────────────────────────────
// Charm. `counts`: { kind: n }. `sound`: the share of buildings that are
// sound (0..1), or null when upkeep is off. → { score, bonus, parts, line }.
function charmOf(counts, sound = null) {
  const parts = [];
  let score = 0;
  for (const k of KINDS) {
    const n = Math.max(0, Math.floor(Number((counts || {})[k.key]) || 0));
    if (!n) continue;
    const v = k.charm * (1 - Math.pow(CONFIG.REPEAT, n)) / (1 - CONFIG.REPEAT);
    parts.push({ key: k.key, label: k.label, n, charm: Math.round(v * 10) / 10 });
    score += v;
  }
  if (sound != null) {
    const v = CONFIG.SOUND_POINTS * Math.max(0, Math.min(1, Number(sound) || 0));
    if (v > 0) { parts.push({ key: 'sound', label: 'Buildings kept sound', charm: Math.round(v * 10) / 10 }); score += v; }
  }
  score = Math.round(score * 10) / 10;
  const bonus = Math.min(CONFIG.MAX_BONUS, Math.floor(score / CONFIG.PER_BONUS));
  const next = bonus >= CONFIG.MAX_BONUS ? null : Math.round(((bonus + 1) * CONFIG.PER_BONUS - score) * 10) / 10;
  const line = !score ? 'No charm yet: place a bench, a lantern or some flowers in Build mode.'
    : `Charm ${Math.floor(score)}: ${bonus ? `+${bonus} happiness for everyone` : 'not enough for a bonus yet'}${next != null ? ` (${Math.ceil(next)} more for +${bonus + 1})` : ''}.`;
  return { score, bonus, parts, next, line };
}
// What one more of a kind would add to the score. Pure.
const nextWorth = (kind, have) => { const k = kindOf(kind); return k ? Math.round(k.charm * Math.pow(CONFIG.REPEAT, Math.max(0, have)) * 10) / 10 : 0; };
// A place in the scene, kept inside the picture. → { area, x, y } or throws. Pure.
function spot(o, fallbackArea) {
  const area = o && o.area != null ? String(o.area) : fallbackArea;
  if (!CONFIG.AREAS.includes(area)) throw new DecorError('Choose where to put it.');
  const x = Number(o && o.x), y = Number(o && o.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DecorError('Choose where to put it.');
  const r2 = v => Math.round(v * 100) / 100;
  return { area, x: r2(Math.max(0, Math.min(100, x))), y: r2(Math.max(CONFIG.Y[0], Math.min(CONFIG.Y[1], y))) };
}
const refundOf = cost => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, Math.floor(v * CONFIG.REFUND)]).filter(([, v]) => v > 0));
const view = r => ({ id: r.id, kind: r.kind, area: r.area, x: Number(r.x), y: Number(r.y) });

// ── The town ───────────────────────────────────────────────────────────────
async function rows(q, sid) { return (await q('SELECT id, kind, area, x, y FROM decorations WHERE settlement_id = $1 ORDER BY id', [sid])).rows; }
const countsOf = list => list.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
// The share of buildings that are sound, or null when upkeep is off here.
async function soundShare(q, s) {
  try {
    const UK = require('./upkeep');
    if (!(await UK.enabled(s))) return null;
    const r = (await q(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE COALESCE(health, 100) >= $2)::int AS ok FROM buildings WHERE settlement_id = $1`, [s.id, UK.CONFIG.WORN_BELOW])).rows[0];
    return r.n ? r.ok / r.n : null;
  } catch (e) { return null; }
}
async function charm(db, s) {
  const q = db ? (t, p) => db.query(t, p) : query;
  const list = (await q('SELECT kind FROM decorations WHERE settlement_id = $1', [s.id])).rows;
  return charmOf(countsOf(list), await soundShare(q, s));
}
async function state(sid, q = query) {
  const s = (await q('SELECT id, tier, upkeep_on FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!s) throw new DecorError('No settlement.', 404);
  const list = await rows(q, sid), counts = countsOf(list);
  return {
    decorations: list.map(view), max: CONFIG.MAX,
    kinds: KINDS.map(k => ({ ...k, have: counts[k.key] || 0, refund: refundOf(k.cost), next_charm: nextWorth(k.key, counts[k.key] || 0) })),
    charm: charmOf(counts, await soundShare(q, s)),
  };
}
const publish = sid => { try { require('./event_bus').publish(sid, { type: 'decor' }); } catch (e) { /* no stream */ } };
const lock = (q, sid) => q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid]);

async function place(sid, o) {
  const k = kindOf(o && o.kind);
  if (!k) throw new DecorError('That cannot be placed.');
  const at = spot(o);
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await lock(q, sid)).rows[0];
    const list = await rows(q, sid);
    if (list.length >= CONFIG.MAX) throw new DecorError(`The town has all ${CONFIG.MAX} decorations it can hold. Remove one first.`, 409);
    if (list.filter(r => r.kind === k.key).length >= k.max) throw new DecorError(`A town can have ${k.max} of those.`, 409);
    const RD = require('./resource_defs'), keys = Object.keys(k.cost).filter(r => RD.isResource(r));
    const short = keys.find(r => (Number(s[r]) || 0) < k.cost[r]);
    if (short) throw new DecorError(`Not enough ${short === 'metal' ? 'iron' : short}: a ${k.label.toLowerCase()} costs ${keys.map(r => `${k.cost[r]} ${r === 'metal' ? 'iron' : r}`).join(' and ')}.`, 402);
    await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => k.cost[r]), sid]);
    const row = (await q('INSERT INTO decorations (settlement_id, kind, area, x, y) VALUES ($1,$2,$3,$4,$5) RETURNING id, kind, area, x, y', [sid, k.key, at.area, at.x, at.y])).rows[0];
    return { placed: view(row), cost: k.cost };
  });
  publish(sid);
  return out;
}
async function move(sid, id, o) {
  id = Number(id);
  if (!Number.isInteger(id)) throw new DecorError('Choose what to move.');
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await lock(q, sid);
    const row = (await q('SELECT id, kind, area, x, y FROM decorations WHERE id = $1 AND settlement_id = $2', [id, sid])).rows[0];
    if (!row) throw new DecorError('That is not in your town.', 404);
    const at = spot(o, row.area);
    return { moved: view((await q('UPDATE decorations SET area = $2, x = $3, y = $4 WHERE id = $1 RETURNING id, kind, area, x, y', [id, at.area, at.x, at.y])).rows[0]) };
  });
  publish(sid);
  return out;
}
async function remove(sid, id) {
  id = Number(id);
  if (!Number.isInteger(id)) throw new DecorError('Choose what to remove.');
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await lock(q, sid);
    const row = (await q('DELETE FROM decorations WHERE id = $1 AND settlement_id = $2 RETURNING id, kind', [id, sid])).rows[0];
    if (!row) throw new DecorError('That is not in your town.', 404);
    const k = kindOf(row.kind), refund = k ? refundOf(k.cost) : {};
    const RD = require('./resource_defs'), keys = Object.keys(refund).filter(r => RD.isResource(r));
    if (keys.length) await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(r => refund[r]), sid]);
    return { removed: row.id, refund };
  });
  publish(sid);
  return out;
}

module.exports = { CONFIG, KINDS, DecorError, charmOf, nextWorth, spot, refundOf, state, place, move, remove, charm };
