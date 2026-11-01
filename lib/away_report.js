// ══════════════════════════════════════════════════════════════════════════
//  away_report — "Since you were gone…" (the splash shown on game load).
//
//  Pure helpers (no DB) used by routes/away.js and applyTick:
//    effectiveProductionHours(defs, from, to)  season × Happening weighted
//        production hours per resource over [from, to] — the one place the
//        offline production maths lives.
//    splitBySources(total, sources)  share a produced / consumed total out
//        over the rate-breakdown rows (and their citizens) by their per-hour
//        weight, so the splash can say who contributed.
//    eventFromSettlementEvent / … map DB rows to { at, category, icon, text,
//        citizenIds } entries.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { seasonSegments } = require('../seasons');
const HFX = require('./happening_effects');
const D = require('./day_cycle');

const HOUR_MS = 3600 * 1000;
const AWAY_MIN_MS = 15 * 60 * 1000;   // shorter absences get no splash
const MAX_EVENTS = 200;

// Production hours per resource over [fromMs, toMs], each hour weighted by
// the season multiplier and the Happening production factor in force.
function effectiveProductionHours(defs, fromMs, toMs) {
  const out = {};
  for (const res of HFX.RESOURCES) out[res] = 0;
  if (!(toMs > fromMs)) return out;
  for (const seg of seasonSegments(fromMs, toMs)) {
    const segHours = (seg.toMs - seg.fromMs) / HOUR_MS;
    for (const res of HFX.RESOURCES) {
      out[res] += (seg.season.modifiers[res] ?? 1) * HFX.averageProductionFactor(defs, res, seg.fromMs, seg.toMs) * segHours;
    }
  }
  return out;
}

// Integer shares of `total` proportional to `weights` that add up to exactly
// round(total) (largest remainder), so a breakdown never disagrees with its sum.
function roundShares(total, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  const target = Math.round(total);
  if (!(sum > 0)) return weights.map(() => 0);
  const raw = weights.map(w => target * w / sum);
  const out = raw.map(Math.floor);
  let left = target - out.reduce((a, x) => a + x, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

// Split `total` over breakdown sources by weight (weight / value / per_hour).
// Returns rows sorted largest first; a row's citizens share its amount
// equally, or by their own upkeep when they carry one.
function splitBySources(total, sources) {
  const rows = (sources || []).map(s => ({ s, w: Math.abs(Number(s.weight ?? s.value ?? s.per_hour) || 0) })).filter(r => r.w > 0);
  if (!(total > 0) || !rows.length) return [];
  const amounts = roundShares(total, rows.map(r => r.w));
  return rows.map(({ s }, i) => {
    const row = { label: s.label, amount: amounts[i] };
    const cits = s.citizens || [];
    if (cits.length) {
      const cw = cits.map(c => Math.abs(Number(c.upkeep) || 0));
      const shares = roundShares(row.amount, cw.some(x => x > 0) ? cw : cits.map(() => 1));
      row.citizens = cits.map((c, j) => ({ id: c.id, name: c.name, amount: shares[j] })).sort((a, b) => b.amount - a.amount);
    }
    return row;
  }).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
}

// ── Event mapping ─────────────────────────────────────────────────────────
const SETTLEMENT_EVENT_KINDS = {
  quest_success:        { category: 'quests',   icon: '✅' },
  quest_fail:           { category: 'quests',   icon: '❌' },
  child_born:           { category: 'citizens', icon: '🍼' },
  partnership:          { category: 'citizens', icon: '💕' },
  bond_formed:          { category: 'citizens', icon: '🤝' },
  close_bond:           { category: 'citizens', icon: '🤝' },
  starvation_onset:     { category: 'hardship', icon: '⚠️' },
  starvation_recovered: { category: 'citizens', icon: '💚' },
  starvation_death:     { category: 'hardship', icon: '🪦' },
  research:             { category: 'trade',    icon: '📚' },
  discovery:            { category: 'trade',    icon: '💎' },
  expedition:           { category: 'other',    icon: '🧭' },
  village_request:      { category: 'trade',    icon: '🤝' },
  village_request_new:  { category: 'trade',    icon: '📣' },
  festival:             { category: 'citizens', icon: '🎉' },
  arrears:              { category: 'hardship', icon: '⚠️' },
  arrears_cleared:      { category: 'other',    icon: '✅' },
  wonder:               { category: 'other',    icon: '🏛' },
};

function _ids(v) {
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  if (typeof v === 'string') { try { return _ids(JSON.parse(v)); } catch (e) { return []; } }
  return [];
}

function eventFromSettlementEvent(row) {
  const k = SETTLEMENT_EVENT_KINDS[row.type] || { category: 'other', icon: '📜' };
  // Messages that open with their own emoji ("📚 Your scholars…") keep it as the icon.
  const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+/u.exec(String(row.message || ''));
  return { at: new Date(row.created_at).getTime(), category: k.category, icon: m ? m[1] : k.icon,
    text: m ? row.message.slice(m[0].length) : row.message, citizenIds: _ids(row.citizen_ids) };
}

// Solo quest resolutions (party / clan quests already write settlement events).
function eventFromSoloQuest(row, title, citizenName) {
  const ok = row.status === 'completed';
  const at = new Date(row.resolved_at || row.completes_at).getTime();
  return {
    at, category: 'quests', icon: ok ? '✅' : '❌',
    text: `${citizenName || 'A citizen'} ${ok ? 'returned from' : 'failed'} "${title}"${ok ? ' — success! Collect the reward on the Quests board.' : '.'}`,
    citizenIds: row.citizen_id ? [Number(row.citizen_id)] : [],
  };
}

// citizen_events rows: deaths and injuries (starvation ones already appear
// through the settlement feed, so callers filter them out).
function eventFromCitizenEvent(row, citizenName) {
  const type = row.event_type;
  // Careers: levels, paths, discoveries and milestones are good news.
  const CAREER = { career_level: '🎓', career_fork: '🌿', career_milestone: '🎖️', trait_revealed: '✨' };
  const icon = type === 'death' ? '🪦' : type === 'injury' ? '🩹' : CAREER[type] || '⚔️';
  const category = type === 'death' || type === 'injury' ? 'hardship' : CAREER[type] ? 'citizens' : 'quests';
  const who = citizenName || 'A citizen';
  const narrative = String(row.narrative || '').trim();
  const text = narrative && narrative.toLowerCase().indexOf(String(who).toLowerCase()) >= 0 ? narrative : `${who}: ${narrative || type}`;
  return { at: new Date(row.occurred_at).getTime(), category, icon, text, citizenIds: [Number(row.citizen_id)] };
}

// Happening windows that overlapped [fromMs, toMs], with their effects in words.
function happeningsBetween(defs, fromMs, toMs) {
  const out = [];
  for (const h of defs || []) {
    for (const w of D.windowsBetween(h.rule, fromMs, toMs)) {
      if (w.endMs <= fromMs || w.startMs >= toMs) continue;
      const effects = HFX.resolveEffects(h, w.startMs).filter(e => e.type !== 'banner')
        .map(e => ({ text: HFX.describeEffect(e), tone: e.type === 'modifier' ? (HFX.isGood(e.stat, e.value) ? 'good' : 'bad') : 'neutral' }));
      out.push({ id: h.id, title: h.title, icon: h.icon || '🏮', startMs: w.startMs, endMs: w.endMs, effects });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

// Seasons covered by [fromMs, toMs] (only interesting when more than one).
function seasonsBetween(fromMs, toMs) {
  return seasonSegments(fromMs, toMs).map(s => ({ id: s.season.id, name: s.season.name, emoji: s.season.emoji, fromMs: s.fromMs, toMs: s.toMs }));
}

// ── Trade & crafting (category 'trade') ────────────────────────────────────

// A finished craft_jobs row (with citizen_name).
function eventFromCraftJob(row) {
  const at = new Date(row.finished_at).getTime();
  const who = row.citizen_name || 'A crafter';
  const snap = row.recipe_snapshot || {};
  if (row.status === 'ruined') return { at, category: 'trade', icon: '💥', text: `${who} ruined a ${snap.name || 'piece'} at the bench.`, citizenIds: [Number(row.citizen_id)] };
  const roll = row.roll || {}, item = roll.item || {};
  let text = `${who} made ${/^[AEIOU]/i.test(item.name || '') ? 'an' : 'a'} ${item.name || snap.name || 'piece'}`;
  if (roll.listed) text += ` — on a stall at ${roll.listed.price} gold`;
  else if (roll.list_failed) text += ` — kept in the stores (${roll.list_failed})`;
  return { at, category: 'trade', icon: item.icon || '🔨', text: text + '.', citizenIds: [Number(row.citizen_id)], quality: row.quality || null };
}

// A settlement_recipes row learned while away (with citizen_name, recipe_name).
function eventFromRecipe(row) {
  const at = new Date(row.learned_at).getTime();
  const text = row.source === 'discovery'
    ? `${row.citizen_name || 'A crafter'} worked out how to make ${row.recipe_name || row.recipe_key}.`
    : `Your crafters learned to make ${row.recipe_name || row.recipe_key}.`;
  return { at, category: 'trade', icon: row.source === 'discovery' ? '💡' : '📜', text, citizenIds: row.citizen_id ? [Number(row.citizen_id)] : [] };
}

// A Market deal (lib/market_ledger entryFor shape).
function eventFromTrade(e) {
  const what = e.item ? `${e.qty}× ${e.item.name}` : `${e.qty} ${e.resource}`;
  const text = e.status === 'returned' ? `A porter found ${e.counterparty || 'a stall'} sold out — your ${e.gross} gold came back.`
    : e.side === 'sold' ? `Sold ${what} to ${e.counterparty || 'a buyer'} for ${e.net} gold${e.fee ? ` (after a ${e.fee} fee)` : ''}${e.status === 'on_road' ? ' — gold on the way' : ''}.`
    : `Bought ${what} from ${e.counterparty || 'a seller'} for ${-e.net} gold${e.status === 'on_road' ? ' — on the way' : ''}.`;
  return { at: new Date(e.agreed_at).getTime(), category: 'trade', icon: e.side === 'sold' ? '🪙' : '🛒', text, citizenIds: [] };
}

function sortAndCap(events) {
  return events.filter(e => Number.isFinite(e.at)).sort((a, b) => a.at - b.at).slice(-MAX_EVENTS);
}

module.exports = {
  AWAY_MIN_MS, MAX_EVENTS, SETTLEMENT_EVENT_KINDS,
  effectiveProductionHours, splitBySources, roundShares,
  eventFromSettlementEvent, eventFromSoloQuest, eventFromCitizenEvent, eventFromCraftJob, eventFromRecipe, eventFromTrade,
  happeningsBetween, seasonsBetween, sortAndCap,
};
