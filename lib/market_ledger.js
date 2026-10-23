// ══════════════════════════════════════════════════════════════════════════
//  MARKET LEDGER — every deal's record: price history and each town's Ledger.
//
//  One market_trades row per deal, written in the deal's own transaction
//  when its price is agreed (record), then stamped as the goods and gold
//  arrive (settle). Player-to-player deals (lot, pickup, fill) carry the
//  price signal; Ironhaven and village deals only appear in the Ledger.
//
//  Prices are volume-weighted: sum(gold) / sum(qty) over the window. Items
//  are priced per quality (crafted pieces), 'basic' for everything else.
//  A good's guide price is its 7-day average once it has GUIDE_MIN_TRADES
//  trades, else the reference (REFERENCE_PRICE / Ironhaven's offer).
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');

const GUIDE_MIN_TRADES = 3;
const MAX_GOODS = 12;
const DAY_MS = 24 * 3600 * 1000;
const QUALITIES = ['basic', 'sturdy', 'fine', 'superior', 'legendary'];
const round = (n, d = 2) => Math.round(Number(n) * 10 ** d) / 10 ** d;

class LedgerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Crafted quality of an item snapshot, else 'basic'.
function qualityOf(snap) {
  const m = (snap && snap.metadata) || {};
  return m.crafted_by && QUALITIES.includes(m.quality) ? m.quality : 'basic';
}

// row: { kind, source, source_id, resource | item_snapshot, qty, gold, fee,
//        seller_id, buyer_id, seller_name, buyer_name, citizen_name, citizen_side }
async function record(client, row) {
  const snap = row.item_snapshot || null;
  const qty = Number(row.qty), gold = Number(row.gold) || 0;
  await client.query(
    `INSERT INTO market_trades (kind, source, source_id, good_type, resource, item_key, quality, item_name, item_icon, item_snapshot,
                                qty, gold, fee, unit_price, seller_settlement_id, buyer_settlement_id, seller_name, buyer_name,
                                citizen_name, citizen_side, price_signal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (source, source_id) DO NOTHING`,
    [row.kind, row.source, row.source_id, snap ? 'item' : 'resource', snap ? null : row.resource, snap ? snap.item_key : null,
     qualityOf(snap), snap ? snap.name : null, snap ? snap.icon : null, snap ? JSON.stringify(snap) : null,
     qty, gold, Number(row.fee) || 0, gold / qty, row.seller_id || null, row.buyer_id || null,
     row.seller_name || null, row.buyer_name || null, row.citizen_name || null, row.citizen_side || null,
     ['lot', 'pickup', 'fill'].includes(row.kind)]);
}

// Stamp a deal: { delivered, paid, failed } (true = now). Never un-stamps.
async function settle(client, source, sourceId, f) {
  const sets = [];
  if (f.delivered) sets.push('delivered_at = COALESCE(delivered_at, NOW())');
  if (f.paid) sets.push('paid_at = COALESCE(paid_at, NOW())');
  if (f.failed) sets.push('failed = TRUE');
  if (!sets.length) return;
  await client.query(`UPDATE market_trades SET ${sets.join(', ')} WHERE source = $1 AND source_id = $2`, [source, sourceId]);
}

// ── Price history ──────────────────────────────────────────────────────────

// 'resource:timber' | 'item:iron_sword' | 'item:iron_sword:fine'
function parseGood(key) {
  const m = /^(resource|item):([a-z0-9_]{1,60})(?::([a-z]+))?$/.exec(String(key || ''));
  if (!m) return null;
  if (m[1] === 'resource' && m[3]) return null;
  const quality = m[1] === 'item' ? (m[3] || 'basic') : 'basic';
  if (!QUALITIES.includes(quality)) return null;
  return { key: m[1] === 'item' ? `item:${m[2]}:${quality}` : `resource:${m[2]}`, type: m[1], id: m[2], quality };
}
function parseGoods(raw) {
  const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new LedgerError(400, 'Name at least one good.');
  if (list.length > MAX_GOODS) throw new LedgerError(400, `At most ${MAX_GOODS} goods at a time.`);
  const out = [];
  for (const k of list) {
    const g = parseGood(k);
    if (!g) throw new LedgerError(400, `Unknown good: ${k}`);
    if (!out.some(x => x.key === g.key)) out.push(g);
  }
  return out;
}
const goodWhere = (g, i) => (g.type === 'resource'
  ? { sql: `good_type = 'resource' AND resource = $${i}`, params: [g.id] }
  : { sql: `good_type = 'item' AND item_key = $${i} AND quality = $${i + 1}`, params: [g.id, g.quality] });

// What a good is worth without trades: resources' reference price; items
// what Ironhaven pays (its weekly wants pay more).
async function referenceFor(goods) {
  const market = require('./market');
  const out = {};
  const items = goods.filter(g => g.type === 'item');
  let tpl = [];
  if (items.length) tpl = (await query('SELECT item_key, sell_value, tradeable FROM item_templates')).rows;
  const wants = items.length ? market.ironhavenWants(tpl) : [];
  for (const g of goods) {
    if (g.type === 'resource') {
      const p = market.REFERENCE_PRICE[g.id];
      out[g.key] = p != null ? { price: p, label: 'Market reference' } : null;
    } else {
      const t = tpl.find(x => x.item_key === g.id);
      const M = require('./career_math');
      const base = t ? Number(t.sell_value) || 0 : 0;
      const v = base * (g.quality === 'basic' ? 1 : M.QUALITY_VALUE_MULT[g.quality] || 1);
      out[g.key] = v > 0 ? { price: market.ironhavenUnitPrice(v, wants.includes(g.id)), label: 'Ironhaven pays' } : null;
    }
  }
  return out;
}

// { key: { days: [{ day, avg, qty, n }], week: { avg, low, high, n, qty }, last, reference, guide, guide_source } }
async function priceHistory(goods, days = 14) {
  days = Math.max(1, Math.min(60, Math.floor(days) || 14));
  const refs = await referenceFor(goods);
  const out = {};
  for (const g of goods) {
    const w = goodWhere(g, 1), n = w.params.length + 1;
    const [daily, week, last] = await Promise.all([
      query(`SELECT to_char(date_trunc('day', agreed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                    SUM(gold)::numeric / NULLIF(SUM(qty), 0) AS avg, SUM(qty)::int AS qty, COUNT(*)::int AS n
               FROM market_trades WHERE price_signal AND NOT failed AND ${w.sql} AND agreed_at > NOW() - make_interval(days => $${n})
              GROUP BY 1 ORDER BY 1`, [...w.params, days]),
      query(`SELECT SUM(gold)::numeric / NULLIF(SUM(qty), 0) AS avg, MIN(unit_price) AS low, MAX(unit_price) AS high,
                    COUNT(*)::int AS n, COALESCE(SUM(qty), 0)::int AS qty
               FROM market_trades WHERE price_signal AND NOT failed AND ${w.sql} AND agreed_at > NOW() - interval '7 days'`, w.params),
      query(`SELECT unit_price, agreed_at FROM market_trades WHERE price_signal AND NOT failed AND ${w.sql}
              ORDER BY agreed_at DESC LIMIT 1`, w.params),
    ]);
    const wk = week.rows[0];
    const stats = { avg: wk.avg == null ? null : round(wk.avg), low: wk.low == null ? null : round(wk.low), high: wk.high == null ? null : round(wk.high), n: wk.n, qty: wk.qty };
    const ref = refs[g.key];
    const useTrades = stats.n >= GUIDE_MIN_TRADES && stats.avg != null;
    out[g.key] = {
      type: g.type, id: g.id, quality: g.quality,
      days: daily.rows.map(r => ({ day: r.day, avg: round(r.avg), qty: r.qty, n: r.n })),
      week: stats,
      last: last.rows[0] ? { price: round(last.rows[0].unit_price), at: last.rows[0].agreed_at } : null,
      reference: ref,
      guide: useTrades ? stats.avg : ref ? ref.price : null,
      guide_source: useTrades ? 'trades' : ref ? 'reference' : null,
    };
  }
  return out;
}

// Resource guide prices for the Sell form (one query for all four).
async function resourceGuides(resources) {
  const market = require('./market');
  const r = await query(
    `SELECT resource, SUM(gold)::numeric / NULLIF(SUM(qty), 0) AS avg, COUNT(*)::int AS n
       FROM market_trades WHERE price_signal AND NOT failed AND good_type = 'resource' AND agreed_at > NOW() - interval '7 days'
      GROUP BY resource`).catch(() => ({ rows: [] }));
  const out = {};
  for (const res of resources) {
    const row = r.rows.find(x => x.resource === res);
    const ok = row && row.n >= GUIDE_MIN_TRADES;
    out[res] = { price: ok ? round(row.avg) : market.REFERENCE_PRICE[res], source: ok ? 'trades' : 'reference', n: row ? row.n : 0 };
  }
  return out;
}

// Goods traded in the last `days`: average, change vs the window before, volume.
async function movers(days = 7, limit = 40) {
  const r = await query(
    `WITH w AS (
       SELECT good_type, resource, item_key, quality,
              SUM(gold) FILTER (WHERE agreed_at > NOW() - make_interval(days => $1))::numeric
                / NULLIF(SUM(qty) FILTER (WHERE agreed_at > NOW() - make_interval(days => $1)), 0) AS avg,
              SUM(gold) FILTER (WHERE agreed_at <= NOW() - make_interval(days => $1))::numeric
                / NULLIF(SUM(qty) FILTER (WHERE agreed_at <= NOW() - make_interval(days => $1)), 0) AS prev,
              COALESCE(SUM(qty) FILTER (WHERE agreed_at > NOW() - make_interval(days => $1)), 0)::int AS qty,
              COUNT(*) FILTER (WHERE agreed_at > NOW() - make_interval(days => $1))::int AS n,
              MAX(item_name) AS item_name, MAX(item_icon) AS item_icon
         FROM market_trades
        WHERE price_signal AND NOT failed AND agreed_at > NOW() - make_interval(days => $1 * 2)
        GROUP BY good_type, resource, item_key, quality)
     SELECT * FROM w WHERE n > 0 ORDER BY qty DESC, n DESC LIMIT $2`, [days, limit]);
  return r.rows.map(x => ({
    key: x.good_type === 'resource' ? `resource:${x.resource}` : `item:${x.item_key}:${x.quality}`,
    type: x.good_type, id: x.good_type === 'resource' ? x.resource : x.item_key, quality: x.quality,
    name: x.item_name, icon: x.item_icon, avg: round(x.avg), prev: x.prev == null ? null : round(x.prev),
    change: x.prev ? round((x.avg - x.prev) / x.prev, 3) : null, qty: x.qty, n: x.n,
  }));
}

// ── The Ledger ─────────────────────────────────────────────────────────────

// One deal from `sid`'s side.
function entryFor(t, sid) {
  const sold = t.seller_settlement_id === sid;
  const mineDone = sold ? t.paid_at : t.delivered_at;
  return {
    id: t.id, kind: t.kind, side: sold ? 'sold' : 'bought',
    good_type: t.good_type, resource: t.resource, item_key: t.item_key, quality: t.quality,
    item: t.item_snapshot ? { name: t.item_name, icon: t.item_icon, rarity: t.item_snapshot.rarity, metadata: t.item_snapshot.metadata || {} } : null,
    qty: t.qty, gross: t.gold, fee: sold ? t.fee : 0,
    net: t.failed ? 0 : sold ? t.gold - t.fee : -t.gold,
    unit_price: round(t.unit_price),
    counterparty: sold ? t.buyer_name : t.seller_name,
    citizen_name: (sold ? t.citizen_side === 'seller' : t.citizen_side === 'buyer') ? t.citizen_name : null,
    status: t.failed ? 'returned' : mineDone ? 'settled' : 'on_road',
    agreed_at: t.agreed_at, settled_at: t.failed ? null : mineDone,
  };
}

// { entries, next_before, weeks: [{ week_start, in, out, fees, net, n, pending }] }
async function ledger(sid, { weeks = 8, before = null, limit = 40, side = null } = {}) {
  weeks = Math.max(1, Math.min(26, Math.floor(weeks) || 8));
  limit = Math.max(1, Math.min(100, Math.floor(limit) || 40));
  const params = [sid, limit];
  let extra = '';
  if (before) { params.push(Number(before)); extra += ` AND id < $${params.length}`; }
  if (side === 'sold') extra += ' AND seller_settlement_id = $1';
  else if (side === 'bought') extra += ' AND buyer_settlement_id = $1';
  const rows = (await query(
    `SELECT * FROM market_trades WHERE (seller_settlement_id = $1 OR buyer_settlement_id = $1) ${extra}
      ORDER BY id DESC LIMIT $2`, params)).rows;
  const totals = (await query(
    `SELECT to_char(date_trunc('week', agreed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week_start,
            COALESCE(SUM(gold - fee) FILTER (WHERE seller_settlement_id = $1 AND NOT failed), 0)::int AS gold_in,
            COALESCE(SUM(gold) FILTER (WHERE buyer_settlement_id = $1 AND NOT failed), 0)::int AS gold_out,
            COALESCE(SUM(fee) FILTER (WHERE seller_settlement_id = $1 AND NOT failed), 0)::int AS fees,
            COUNT(*) FILTER (WHERE NOT failed)::int AS n,
            COALESCE(SUM(gold - fee) FILTER (WHERE seller_settlement_id = $1 AND NOT failed AND paid_at IS NULL), 0)::int AS pending
       FROM market_trades
      WHERE (seller_settlement_id = $1 OR buyer_settlement_id = $1)
        AND agreed_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(weeks => $2 - 1)
      GROUP BY 1`, [sid, weeks])).rows;
  // Every week in the window, oldest first, zeros where nothing happened.
  const thisMonday = new Date(); thisMonday.setUTCHours(0, 0, 0, 0);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - ((thisMonday.getUTCDay() + 6) % 7));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisMonday.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10);
    const t = totals.find(x => x.week_start === ws) || { gold_in: 0, gold_out: 0, fees: 0, n: 0, pending: 0 };
    out.push({ week_start: ws, in: t.gold_in, out: t.gold_out, fees: t.fees, net: t.gold_in - t.gold_out, n: t.n, pending: t.pending });
  }
  return {
    entries: rows.map(t => entryFor(t, sid)),
    next_before: rows.length === limit ? rows[rows.length - 1].id : null,
    weeks: out,
  };
}

module.exports = {
  GUIDE_MIN_TRADES, MAX_GOODS, LedgerError,
  qualityOf, record, settle, parseGood, parseGoods, priceHistory, resourceGuides, movers, ledger, entryFor,
};
