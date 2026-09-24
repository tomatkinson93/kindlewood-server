// ══════════════════════════════════════════════════════════════════════════
//  CLAN PERMISSIONS — rank table lookups (spec 016 §4)
//
//  Every clan mutation route goes through requireClanPermission(flag) or
//  requireClanMember. Both set req.clan = { clanId, rank }. The flags come
//  from clan_rank_permissions (clan_id NULL = global default), so per-clan
//  tuning later is an INSERT, not a code change.
//
//  The middleware is a fast gate. Routes that change membership re-read the
//  actor's row inside their transaction (after locking the clan), because a
//  rank can change between the check and the write.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');

const RANKS = ['founder', 'leader', 'officer', 'member', 'recruit'];
const RANK_ORDER = { founder: 5, leader: 4, officer: 3, member: 2, recruit: 1 };
const RANK_LABELS = { founder: 'Founder', leader: 'Leader', officer: 'Officer', member: 'Member', recruit: 'Recruit' };

const PERMISSION_SQL = `
  EXISTS (SELECT 1 FROM clan_rank_permissions p
           WHERE p.rank = cm.rank AND p.permission = $2
             AND (p.clan_id IS NULL OR p.clan_id = cm.clan_id))`;

// Checks one flag for a user. Pass a transaction client as `db` to read
// inside a transaction. Resolves { clanId, rank, allowed } or null (no clan).
async function checkClanPermission(userId, flag, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run(
    `SELECT cm.clan_id, cm.rank, ${PERMISSION_SQL} AS allowed
       FROM clan_members cm WHERE cm.user_id = $1`,
    [userId, flag]
  );
  const row = r.rows[0];
  return row ? { clanId: row.clan_id, rank: row.rank, allowed: row.allowed } : null;
}

// All flags a rank holds in a clan — sent to the client so the UI only
// offers what the server will accept.
async function permissionsFor(clanId, rank) {
  const r = await query(
    `SELECT DISTINCT permission FROM clan_rank_permissions
      WHERE rank = $1 AND (clan_id IS NULL OR clan_id = $2)`,
    [rank, clanId]
  );
  return r.rows.map(x => x.permission).sort();
}

function requireClanPermission(flag) {
  return async function (req, res, next) {
    try {
      const m = await checkClanPermission(req.user.userId, flag);
      if (!m) return res.status(403).json({ error: 'You are not in a clan.' });
      if (!m.allowed) return res.status(403).json({ error: 'Your rank does not permit this.' });
      req.clan = { clanId: m.clanId, rank: m.rank };
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

async function requireClanMember(req, res, next) {
  try {
    const r = await query('SELECT clan_id, rank FROM clan_members WHERE user_id = $1', [req.user.userId]);
    if (!r.rows[0]) return res.status(403).json({ error: 'You are not in a clan.' });
    req.clan = { clanId: r.rows[0].clan_id, rank: r.rows[0].rank };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Membership check failed.' });
  }
}

// Acts-on-lower-rank rule: kick, promote and demote only target strictly
// lower ranks.
function outranks(actorRank, targetRank) {
  return (RANK_ORDER[actorRank] || 0) > (RANK_ORDER[targetRank] || 0);
}

// The rank a promotion moves `rank` to, or null if the actor may not grant
// it. Promotion tops out at actor rank − 1; only a leadership transfer makes
// a founder.
function promotedRank(actorRank, rank) {
  const next = RANKS[RANKS.indexOf(rank) - 1];
  if (!next || next === 'founder') return null;
  return RANK_ORDER[next] < RANK_ORDER[actorRank] ? next : null;
}

function demotedRank(rank) {
  const i = RANKS.indexOf(rank);
  return i >= 0 && i < RANKS.length - 1 ? RANKS[i + 1] : null;
}

module.exports = {
  RANKS, RANK_ORDER, RANK_LABELS,
  checkClanPermission, permissionsFor,
  requireClanPermission, requireClanMember,
  outranks, promotedRank, demotedRank,
};
