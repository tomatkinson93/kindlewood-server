// ══════════════════════════════════════════════════════════════════════════
//  MODERATION — site staff, mutes and the audit log (Chat hub)
//
//  Staff = admins (ADMIN_USER_IDS, middleware/admin.js) + moderators
//  (users.site_role = 'moderator', granted in-game by an admin). Staff
//  moderate the realm channels directly; clan halls stay with the clan's
//  own ranks, and staff reach clan-hall content only through reports.
//
//  Mutes (user_mutes) stop a player posting in realm channels until `until`
//  (NULL = until lifted). Expired rows are ignored, not deleted.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');
const { isAdminUser } = require('../middleware/admin');

const MUTE_MAX_HOURS = 24 * 30;

// 'admin' | 'moderator' | null, from a users.site_role value already loaded.
function staffFor(userId, siteRole) {
  if (!userId) return null;
  if (isAdminUser({ userId })) return 'admin';
  return siteRole === 'moderator' ? 'moderator' : null;
}

async function staffRole(user) {
  if (!user || !user.userId) return null;
  if (isAdminUser(user)) return 'admin';
  const r = await query('SELECT site_role FROM users WHERE id = $1', [user.userId]);
  return r.rows[0] ? staffFor(user.userId, r.rows[0].site_role) : null;
}

// Active mute row { until, reason } or null.
async function activeMute(userId) {
  const r = await query(
    `SELECT until, reason FROM user_mutes
      WHERE user_id = $1 AND (until IS NULL OR until > NOW())`, [userId]);
  return r.rows[0] || null;
}

function muteMessage(m) {
  return m.until
    ? `You're muted in the realm channels until ${new Date(m.until).toUTCString()}.`
    : "You're muted in the realm channels until a moderator lifts it.";
}

// Mute for `hours` (null/0 = indefinite). Replaces any existing mute.
async function mute(db, userId, byUserId, hours, reason) {
  const h = hours ? Math.min(MUTE_MAX_HOURS, Math.max(1, Math.round(hours))) : null;
  const r = await db.query(
    `INSERT INTO user_mutes (user_id, muted_by, reason, until, created_at)
     VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + make_interval(hours => $4::int) END, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET muted_by = EXCLUDED.muted_by, reason = EXCLUDED.reason, until = EXCLUDED.until, created_at = NOW()
     RETURNING until`, [userId, byUserId, String(reason || '').slice(0, 200), h]);
  return { until: r.rows[0].until, hours: h };
}

async function logModAction(db, actorUserId, action, targetUserId, detail) {
  await db.query(
    'INSERT INTO mod_actions (actor_user_id, action, target_user_id, detail) VALUES ($1,$2,$3,$4)',
    [actorUserId, action, targetUserId || null, JSON.stringify(detail || {})]);
}

module.exports = { staffFor, staffRole, activeMute, muteMessage, mute, logModAction, MUTE_MAX_HOURS };
