// ══════════════════════════════════════════════════════════════════════════
//  happenings — scheduled timed events (spec 021 Phase 6).
//
//  A Happening is a definition (rule + effects); whether it's on is COMPUTED
//  from the rule with the shared day_cycle.windowsBetween — nothing stored,
//  no background job. "Active at t" = windowsBetween(rule, t, t + 1) is
//  non-empty. Gameplay effects use gameplayNow(user) (clan content: wallNow).
//
//  Effects (v1):
//    { type: 'banner' }                         HUD list + start toast (client)
//    { type: 'enemy_pool', add: [enemy ids] }   eligible for random picks during
//                                               the window, whatever their own
//                                               active_phases / moon_phases
//    { type: 'map_flourish', kind: 'lanterns' | 'fireflies' | 'aurora' }
//                                               cosmetic (client); lanterns only
//  NO economy or resource multipliers (decision D7): simulation.applyTick
//  accrues over arbitrary offline spans, so a multiplier would need per-window
//  overlap integration across every tick. Deferred on purpose — don't add a
//  multiplier effect here without building that first.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const D = require('./day_cycle');

const EFFECT_TYPES = ['banner', 'enemy_pool', 'map_flourish'];
const FLOURISHES = ['lanterns', 'fireflies', 'aurora'];
const ID_RE = /^[a-z0-9_]{2,40}$/;

function validateEffects(effects) {
  if (effects == null) return { ok: true, effects: [] };
  if (!Array.isArray(effects)) return { ok: false, error: 'effects must be an array.' };
  if (effects.length > 10) return { ok: false, error: 'At most 10 effects.' };
  const out = [];
  for (const e of effects) {
    const t = e && e.type;
    if (!EFFECT_TYPES.includes(t)) return { ok: false, error: 'Unknown effect type "' + t + '" (banner, enemy_pool, map_flourish).' };
    if (t === 'banner') out.push({ type: t });
    if (t === 'enemy_pool') {
      const add = Array.isArray(e.add) ? [...new Set(e.add.map(String))] : [];
      if (!add.length || add.some(id => !ID_RE.test(id))) return { ok: false, error: 'enemy_pool.add must list enemy ids (lowercase, underscores).' };
      out.push({ type: t, add: add.slice(0, 20) });
    }
    if (t === 'map_flourish') {
      if (!FLOURISHES.includes(e.kind)) return { ok: false, error: 'map_flourish.kind must be lanterns, fireflies or aurora.' };
      out.push({ type: t, kind: e.kind });
    }
  }
  return { ok: true, effects: out };
}

// Admin payload → clean row, or throws. id is fixed after creation.
function validateHappening(body, isNew) {
  const b = body || {};
  const id = String(b.id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (isNew && !ID_RE.test(id)) throw new Error('id must be 2–40 characters: lowercase letters, digits, underscores.');
  const title = String(b.title || '').trim().slice(0, 80);
  if (!title) throw new Error('title is required.');
  const rule = D.validateRule(b.rule);
  if (!rule.ok) throw new Error('rule: ' + rule.error);
  const fx = validateEffects(b.effects);
  if (!fx.ok) throw new Error('effects: ' + fx.error);
  return {
    id, title,
    flavour: String(b.flavour || '').slice(0, 280),
    icon: String(b.icon || '🏮').slice(0, 8) || '🏮',
    rule: rule.rule, effects: fx.effects,
    rewarding: !!b.rewarding,
    enabled: b.enabled === undefined ? true : !!b.enabled,
    sort_order: Math.max(0, Math.min(9999, parseInt(b.sort_order) || 0)),
  };
}

const isLive = (h) => h && h.enabled !== false && !h.archived;

// Definitions active at ms, each with its current window.
function activeAt(defs, ms) {
  const out = [];
  for (const h of defs || []) {
    if (!isLive(h)) continue;
    const w = D.windowsBetween(h.rule, ms, ms + 1);
    if (w.length) out.push({ ...h, window: w[0] });
  }
  return out;
}

// Enemy ids added by enemy_pool effects of Happenings active at ms.
function enemyPoolAt(defs, ms) {
  const ids = new Set();
  for (const h of activeAt(defs, ms)) for (const e of h.effects || []) if (e.type === 'enemy_pool') e.add.forEach(id => ids.add(id));
  return [...ids];
}

// Live definitions from the DB, cached 60s (invalidate() after admin saves).
// A missing table (migration not yet applied) or DB error → [] so nothing
// that reads Happenings can break gameplay.
let _cache = null, _cacheAt = 0;
const CACHE_MS = 60 * 1000;
async function loadLive(q, now) {
  now = now == null ? Date.now() : now;
  if (_cache && now - _cacheAt < CACHE_MS) return _cache;
  q = q || require('../db').query;
  try {
    const r = await q('SELECT id, title, flavour, icon, rule, effects, rewarding, enabled, archived, sort_order FROM happenings WHERE enabled = TRUE AND archived = FALSE ORDER BY sort_order, id');
    _cache = r.rows; _cacheAt = now;
  } catch (e) { _cache = []; _cacheAt = now; }
  return _cache;
}
function invalidate() { _cache = null; _cacheAt = 0; }

module.exports = { EFFECT_TYPES, FLOURISHES, validateEffects, validateHappening, activeAt, enemyPoolAt, loadLive, invalidate };
