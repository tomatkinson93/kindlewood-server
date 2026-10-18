// ══════════════════════════════════════════════════════════════════════════
//  happenings — scheduled timed events (spec 021 Phase 6).
//
//  A Happening is a definition (rule + effects); whether it's on is COMPUTED
//  from the rule with the shared day_cycle.windowsBetween — nothing stored,
//  no background job. "Active at t" = windowsBetween(rule, t, t + 1) is
//  non-empty.
//
//  What effects exist and how they resolve (banner, enemy_pool, map visuals,
//  stat modifiers, random modifiers) lives in the shared, byte-identical
//  lib/happening_effects.js so the client shows exactly what the server
//  applies. This file adds the DB loading and the admin payload validation.
//
//  Where modifiers apply (clock in brackets — wall = real time, shared;
//  gameplay = the player's gameplayNow, so an admin's warp moves only them):
//    production + food upkeep [wall, integrated over offline spans]
//    happiness, birth chance, bonding [wall]
//    quest success / duration / rewards [gameplay]
//    enemy + party combat stats [gameplay, frozen when the battle starts]
//    rare fish / junk [gameplay]
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const D = require('./day_cycle');
const FX = require('./happening_effects');
const ID_RE = /^[a-z0-9_]{2,40}$/;
const validateEffects = FX.validateEffects;

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

// Definitions active at ms, each with its current window and its effects
// resolved for that window (random modifiers rolled).
function activeAt(defs, ms) {
  return FX.activeAt(defs, ms).map(a => ({ ...a.h, window: a.window, resolvedEffects: a.effects }));
}

// Enemy ids added by enemy_pool effects of Happenings active at ms.
function enemyPoolAt(defs, ms) {
  const ids = new Set();
  for (const a of FX.activeAt(defs, ms)) for (const e of a.effects) if (e.type === 'enemy_pool') e.add.forEach(id => ids.add(id));
  return [...ids];
}

// { stat: value } active at ms (see happening_effects.modifiersAt).
const modifiersAt = (defs, ms) => FX.modifiersAt(defs, ms);

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

module.exports = { validateEffects, validateHappening, activeAt, enemyPoolAt, modifiersAt, loadLive, invalidate };
