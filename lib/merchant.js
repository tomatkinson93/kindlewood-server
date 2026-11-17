// ═══════════════════════════════════════════════════════════════════════════
//  A visiting merchant (docs/HOME_SCENE.md Part F, F.13; step 25).
//
//  About once every four days a merchant's cart stands in Town for one game
//  day with three or four trades: goods for wealth, wealth for goods, or
//  goods for goods, each a little better than the going rate and each to be
//  taken once.
//
//  When the merchant comes and what they offer is seeded by the town and
//  the day (no table, no tick); the one thing stored is which trades have
//  been taken. Everything that counts is here, so a second device sees the
//  same cart and gains nothing.
//
//    state(sid, now)        is the merchant here, the trades, when they next come
//    take(sid, idx, now)    make one trade (once each)
//    call(sid, on, now)     Dev Tools: the merchant comes today
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');
const { gameDay } = require('./social');
const RD = require('./resource_defs');

const CONFIG = {
  CYCLE: 4,               // one visit in every four game days
  KEEP_DAYS: 30,
  SELL_BONUS: 1.25,       // the merchant pays this much of the going rate for goods
  BUY_DISCOUNT: 0.8,      // and sells goods for this much of it
  SWAP_BONUS: 1.2,        // goods for goods: this much more comes back, by worth
  WORTH: { camp: 30, village: 60, town: 100, city: 160 },   // a trade's size, in wealth
  SPREAD: [0.8, 1.4],
  ROUND: 5,
};
const GOODS = ['food', 'timber', 'stone', 'metal'];
const price = k => (k === 'wealth' ? 1 : Number((RD.DEFS.find(d => d.key === k) || {}).ref_price) || 1);
const nameOf = k => { const d = RD.DEFS.find(x => x.key === k); return d ? d.label.toLowerCase() : k; };

class MerchantError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

function seeded(n) {
  let a = (n >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix = (sid, n, salt) => (Math.imul(Number(sid) | 0, 0x9E3779B1) ^ Math.imul(Number(n) | 0, 0x85EBCA6B) ^ salt) >>> 0;

// ── Pure rules ─────────────────────────────────────────────────────────────
// The day of a town's visit in the cycle that holds `day`. Each town has its
// own offset; the visit is one of the cycle's first three days, so two visits
// are never on days next to each other.
function visitDay(sid, day) {
  const off = mix(sid, 0, 0x51ed) % CONFIG.CYCLE;
  const cycle = Math.floor((day + off) / CONFIG.CYCLE);
  return cycle * CONFIG.CYCLE - off + Math.floor(seeded(mix(sid, cycle, 0xca47))() * (CONFIG.CYCLE - 1));
}
const here = (sid, day) => visitDay(sid, day) === day;
// The next day (after `day`) the merchant comes.
function nextVisit(sid, day) {
  let d = visitDay(sid, day);
  if (d > day) return d;
  for (let c = 1; c <= 3; c++) { d = visitDay(sid, day + c * CONFIG.CYCLE); if (d > day) return d; }
  return day + CONFIG.CYCLE;
}
const round = v => Math.max(CONFIG.ROUND, Math.round(v / CONFIG.ROUND) * CONFIG.ROUND);
// A visit's trades: a sale, a purchase, a swap, and sometimes a fourth.
// → [{ idx, kind, give: { res: n }, get: { res: n }, line }]. Pure.
function trades(sid, day, tier) {
  const r = seeded(mix(sid, day, 0x7ade)), base = CONFIG.WORTH[tier] || CONFIG.WORTH.camp;
  const worth = () => base * (CONFIG.SPREAD[0] + r() * (CONFIG.SPREAD[1] - CONFIG.SPREAD[0]));
  const pick = not => { const pool = GOODS.filter(g => !not.includes(g)); return pool[Math.floor(r() * pool.length)]; };
  const sell = used => { const g = pick(used), v = worth(); return { kind: 'sell', give: { [g]: round(v / price(g)) }, get: { wealth: round(v * CONFIG.SELL_BONUS) } }; };
  const buy = used => { const g = pick(used), v = worth(); return { kind: 'buy', give: { wealth: round(v * CONFIG.BUY_DISCOUNT) }, get: { [g]: round(v / price(g)) } }; };
  const swap = () => { const a = pick([]), b = pick([a]), v = worth(); return { kind: 'swap', give: { [a]: round(v / price(a)) }, get: { [b]: round(v * CONFIG.SWAP_BONUS / price(b)) } }; };
  const out = [];
  out.push(sell([]));
  out.push(buy([Object.keys(out[0].give)[0]]));   // not the thing they are buying from you
  out.push(swap());
  if (r() < 0.5) out.push(r() < 0.5 ? sell([Object.keys(out[0].give)[0]]) : buy([Object.keys(out[1].get)[0]]));
  const amount = o => Object.entries(o).map(([k, v]) => `${v} ${nameOf(k)}`).join(' and ');
  return out.map((t, idx) => ({ idx, ...t, line: `Give ${amount(t.give)}, get ${amount(t.get)}.` }));
}

// ── The town ───────────────────────────────────────────────────────────────
// On their own day, or called for today from Dev Tools (settlements.merchant_day).
const hereFor = (s, day) => here(s.id, day) || Number(s.merchant_day) === day;
// Dev Tools: the merchant comes today (or, with on false, only on their own days again).
async function call(sid, on = true, now = Date.now()) {
  const { day } = gameDay(now);
  await query('UPDATE settlements SET merchant_day = $2 WHERE id = $1', [sid, on ? day : null]);
  try { require('./event_bus').publish(sid, { type: 'merchant' }); } catch (e) { /* no stream */ }
  return { called: !!on };
}
async function state(sid, now = Date.now(), q = query) {
  const { day, resets } = gameDay(now);
  const s = (await q('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
  if (!s) throw new MerchantError('No settlement.', 404);
  const next = nextVisit(sid, day), DAY = 86400e3;
  if (!hereFor(s, day)) return { here: false, day, trades: [], next_day: next, next_at: resets + (next - day - 1) * DAY, line: '' };
  const taken = new Set((await q('SELECT idx FROM merchant_trades WHERE settlement_id = $1 AND day = $2', [sid, day])).rows.map(r => r.idx));
  // The first look of a visit puts it in the town's news, once.
  if (!taken.has(-1)) {
    const ins = await q(`INSERT INTO merchant_trades (settlement_id, day, idx) VALUES ($1,$2,-1) ON CONFLICT (settlement_id, day, idx) DO NOTHING RETURNING id`, [sid, day]);
    if (ins.rows.length) {
      await q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'merchant', $2, '[]')`, [sid, '🛒 A travelling merchant has set up a cart in town. They leave at dawn.']);
      await q('DELETE FROM merchant_trades WHERE settlement_id = $1 AND day < $2', [sid, day - CONFIG.KEEP_DAYS]);
    }
  }
  const list = trades(sid, day, s.tier).map(t => ({
    ...t, taken: taken.has(t.idx),
    can: !taken.has(t.idx) && Object.entries(t.give).every(([k, v]) => (Number(s[k]) || 0) >= v),
  }));
  return { here: true, day, leaves_at: resets, trades: list, next_day: next, next_at: resets + (next - day - 1) * DAY,
    line: list.every(t => t.taken) ? 'The travelling merchant is in town until dawn. You have taken every trade.' : 'A travelling merchant is in town until dawn.' };
}

async function take(sid, idx, now = Date.now()) {
  idx = Number(idx);
  const { day } = gameDay(now);
  if (!Number.isInteger(idx) || idx < 0) throw new MerchantError('Choose a trade.');
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
    if (!s) throw new MerchantError('No settlement.', 404);
    if (!hereFor(s, day)) throw new MerchantError('The merchant has gone.', 409);
    const t = trades(sid, day, s.tier)[idx];
    if (!t) throw new MerchantError('The merchant has no such trade.', 404);
    if ((await q('SELECT 1 FROM merchant_trades WHERE settlement_id = $1 AND day = $2 AND idx = $3', [sid, day, idx])).rows.length) throw new MerchantError('You have already made that trade.', 409);
    const short = Object.entries(t.give).find(([k, v]) => (Number(s[k]) || 0) < v);
    if (short) throw new MerchantError(`Not enough ${nameOf(short[0])}: the merchant asks for ${short[1]}.`, 402);
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(t.give)) if (RD.isResource(k)) { vals.push(v); sets.push(`${k} = ${k} - $${vals.length}`); }
    for (const [k, v] of Object.entries(t.get)) if (RD.isResource(k)) { vals.push(v); sets.push(`${k} = ${k} + $${vals.length}`); }
    vals.push(sid);
    await q(`UPDATE settlements SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    await q('INSERT INTO merchant_trades (settlement_id, day, idx) VALUES ($1,$2,$3)', [sid, day, idx]);
    return { trade: { idx, give: t.give, get: t.get, line: t.line } };
  });
  try { require('./event_bus').publish(sid, { type: 'merchant', idx }); } catch (e) { /* no stream */ }
  return out;
}

module.exports = { CONFIG, GOODS, MerchantError, visitDay, here, nextVisit, trades, state, take, call, _price: price };
