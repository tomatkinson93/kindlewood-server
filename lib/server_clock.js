// ══════════════════════════════════════════════════════════════════════════
//  server_clock — the two time seams (spec 021 §2.2, decisions D2/D4/D5).
//
//  wallNow()          Real UTC time. Economy, famine, workers, seasons,
//                     timers and season accrual use ONLY this.
//  gameplayNow(user)  wallNow() plus that admin's debug offset, if one is set
//                     and unexpired. Time-gated content (creatures,
//                     Happenings) must call gameplayNow(req.user).
//
//  NEVER route economy through gameplayNow — scripts/daycycle_test.js greps
//  famine.js, simulation.js, seasons.js and routes/outposts.js for it.
//
//  Debug offsets are in-memory (lost on restart, which is fine), per admin
//  user, and expire after their TTL (default 2h). Non-admins always get 0,
//  even if an entry somehow exists. Other players are never affected.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { isAdminUser } = require('../middleware/admin');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;   // ±30 days

let _clock = () => Date.now();
const _offsets = new Map();   // userId(number) -> { offsetMs, expiresAt }

function wallNow() { return _clock(); }

function _key(userId) { return Number(userId); }

function _entry(userId) {
  const k = _key(userId);
  const e = _offsets.get(k);
  if (!e) return null;
  if (wallNow() >= e.expiresAt) { _offsets.delete(k); return null; }
  return e;
}

function getDebugOffset(userId) {
  const e = _entry(userId);
  return e ? e.offsetMs : 0;
}

function getDebugExpiry(userId) {
  const e = _entry(userId);
  return e ? e.expiresAt : null;
}

// Callers (routes) must have checked isAdminUser first; gameplayNow re-checks.
function setDebugOffset(userId, offsetMs, ttlMs = DEFAULT_TTL_MS) {
  const off = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(Number(offsetMs) || 0)));
  if (off === 0) { clearDebugOffset(userId); return 0; }
  _offsets.set(_key(userId), { offsetMs: off, expiresAt: wallNow() + ttlMs });
  return off;
}

function clearDebugOffset(userId) { _offsets.delete(_key(userId)); }

function gameplayNow(user) {
  const now = wallNow();
  if (!user || !isAdminUser(user)) return now;
  return now + getDebugOffset(user.userId);
}

// Test seam: inject a clock (fn → ms). Pass nothing to restore Date.now.
function _setClockForTest(fn) { _clock = typeof fn === 'function' ? fn : () => Date.now(); }
function _resetForTest() { _offsets.clear(); _setClockForTest(); }

module.exports = {
  wallNow, gameplayNow, setDebugOffset, clearDebugOffset, getDebugOffset, getDebugExpiry,
  DEFAULT_TTL_MS, MAX_OFFSET_MS, _setClockForTest, _resetForTest,
};
