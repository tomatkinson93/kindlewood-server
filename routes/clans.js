// ══════════════════════════════════════════════════════════════════════════
//  CLANS — membership core (spec 016, Phase 1)
//
//  Mounted at /api/clans. Founding, invites, leave/kick, promote/demote,
//  leadership transfer, disband, profile edit.
//
//  Concurrency: every membership mutation runs in withTransaction and first
//  locks the clan row (SELECT … FOR UPDATE — the per-clan mutex, spec §3
//  Pattern B), then re-reads the actor's and target's member rows. The
//  permission middleware in front is only a fast gate.
//
//  SSE: clan_membership_changed and clan_invite_received on the affected
//  user's settlement channel; clan_disbanded on each former member's; and
//  roster/profile changes on the clan channel `clan:<id>` (notify-then-fetch).
//  Always published after COMMIT.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query, withTransaction, CURRENT_WORLD_VERSION } = require('../db');
const requireAuth = require('../middleware/auth');
const eventBus = require('../lib/event_bus');
const palette = require('../lib/clan_palette');
const mapgen = require('../mapgen');
const { spendPrestige, grantPrestige, applyLevelUp } = require('../lib/clan_subscriber');
const { systemLine } = require('../lib/clan_chat');
const {
  RANK_ORDER, RANK_LABELS,
  checkClanPermission, permissionsFor,
  requireClanPermission, requireClanMember, outranks, promotedRank, demotedRank,
} = require('../lib/clan_permissions');

const router = express.Router();

const FOUNDING_COST_WEALTH = 500;
const NAME_RE = /^[A-Za-z0-9 '\-]{3,24}$/;
const DESCRIPTION_MAX = 500;

// Thrown inside a transaction to roll back and answer with a status.
class ClanError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function sendError(res, e, fallback) {
  if (e instanceof ClanError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  if (e && e.code === '23505') {
    if (e.constraint === 'clans_name_lower_uniq') return res.status(409).json({ error: 'That clan name is taken.' });
    if (e.constraint === 'clan_members_pkey') return res.status(409).json({ error: 'Already in a clan.' });
    if (e.constraint === 'clan_invites_pending_uniq') return res.status(409).json({ error: 'That player already has an invite from your clan.' });
  }
  console.error(e);
  res.status(500).json({ error: fallback });
}

// Trims and collapses internal whitespace; null if invalid.
function cleanName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  return NAME_RE.test(name) ? name : null;
}

function cleanDescription(raw) {
  return String(raw || '').trim().slice(0, DESCRIPTION_MAX);
}

function parseId(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function logActivity(client, clanId, type, actorUserId, payload) {
  await client.query(
    'INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,$2,$3,$4)',
    [clanId, type, actorUserId || null, JSON.stringify(payload || {})]
  );
}

// Locks the clan row (per-clan mutex) and returns it, or throws 404.
async function lockClan(client, clanId) {
  const r = await client.query('SELECT * FROM clans WHERE id = $1 FOR UPDATE', [clanId]);
  if (!r.rows[0]) throw new ClanError(404, 'Clan not found.');
  return r.rows[0];
}

// Re-reads a member row inside the transaction (after lockClan).
async function memberRow(client, userId) {
  const r = await client.query(
    `SELECT cm.user_id, cm.clan_id, cm.rank, u.username
       FROM clan_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.user_id = $1`, [userId]);
  return r.rows[0] || null;
}

// Re-checks the actor's flag inside the transaction.
async function requireActor(client, userId, clanId, flag) {
  const m = await checkClanPermission(userId, flag, client);
  if (!m || m.clanId !== clanId) throw new ClanError(403, 'You are not in this clan.');
  if (!m.allowed) throw new ClanError(403, 'Your rank does not permit this.');
  return m;
}

async function settlementIdFor(userId, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run('SELECT id FROM settlements WHERE user_id = $1', [userId]);
  return r.rows[0] ? r.rows[0].id : null;
}

function publishToSettlements(settlementIds, event) {
  for (const sid of settlementIds) if (sid) eventBus.publish(sid, event);
}

function publishToClan(clanId, event) {
  eventBus.publish(`clan:${clanId}`, { clan_id: clanId, ...event });
}

function clanSummary(c, memberCount) {
  const next = palette.nextLevel(c.level);
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    banner: palette.resolveBanner(c.banner),
    level: c.level,
    prestige: Number(c.prestige),
    prestige_lifetime: Number(c.prestige_lifetime),
    next_level_at: next ? next.lifetime : null,
    member_count: memberCount,
    member_cap: palette.memberCap(c.level),
    founder_user_id: c.founder_user_id,
    created_at: c.created_at,
  };
}

async function loadRoster(clanId) {
  const r = await query(
    `SELECT cm.user_id, u.username, u.species, cm.rank, cm.joined_at,
            cm.prestige_contributed, s.name AS settlement_name, s.tier, s.tile_q, s.tile_r
       FROM clan_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN settlements s ON s.user_id = cm.user_id
      WHERE cm.clan_id = $1`, [clanId]);
  return r.rows
    .map(m => ({ ...m, prestige_contributed: Number(m.prestige_contributed), rank_label: RANK_LABELS[m.rank] }))
    .sort((a, b) => (RANK_ORDER[b.rank] - RANK_ORDER[a.rank]) || (new Date(a.joined_at) - new Date(b.joined_at)));
}

// ── GET /api/clans/me — everything the Clan panel needs in one call ────────
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const sRes = await query(
      'SELECT id, tier, tile_q, world_version, wealth FROM settlements WHERE user_id = $1', [userId]);
    const s = sRes.rows[0] || null;
    const hallRes = s
      ? await query("SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = 'guild_hall' LIMIT 1", [s.id])
      : { rows: [] };

    const mRes = await query('SELECT clan_id, rank FROM clan_members WHERE user_id = $1', [userId]);
    const me = mRes.rows[0];

    if (!me) {
      const inv = await query(
        `SELECT i.id, i.created_at, c.id AS clan_id, c.name AS clan_name, c.level, c.banner,
                u.username AS invited_by_name,
                (SELECT COUNT(*)::int FROM clan_members x WHERE x.clan_id = c.id) AS member_count
           FROM clan_invites i
           JOIN clans c ON c.id = i.clan_id
           JOIN users u ON u.id = i.invited_by
          WHERE i.invited_user_id = $1 AND i.status = 'pending'
          ORDER BY i.created_at DESC`, [userId]);
      return res.json({
        ok: true,
        clan: null,
        invites: inv.rows.map(i => ({
          id: i.id, clan_id: i.clan_id, clan_name: i.clan_name, level: i.level,
          banner: palette.resolveBanner(i.banner), member_count: i.member_count,
          member_cap: palette.memberCap(i.level), invited_by: i.invited_by_name, created_at: i.created_at,
        })),
        founding: {
          has_guild_hall: hallRes.rows.length > 0,
          placed: !!(s && s.tile_q !== null && s.world_version >= CURRENT_WORLD_VERSION),
          tier: s ? s.tier : null,
          cost: { wealth: FOUNDING_COST_WEALTH },
          wealth: s ? s.wealth : 0,
        },
      });
    }

    const cRes = await query('SELECT * FROM clans WHERE id = $1', [me.clan_id]);
    const tRes = await query(
      'SELECT q, r, claimed_at FROM clan_territory WHERE clan_id = $1 ORDER BY claimed_at', [me.clan_id]);
    const roster = await loadRoster(me.clan_id);
    const permissions = await permissionsFor(me.clan_id, me.rank);

    let outgoing = [];
    if (permissions.includes('invite')) {
      const o = await query(
        `SELECT i.id, u.username, i.created_at, b.username AS invited_by
           FROM clan_invites i
           JOIN users u ON u.id = i.invited_user_id
           JOIN users b ON b.id = i.invited_by
          WHERE i.clan_id = $1 AND i.status = 'pending'
          ORDER BY i.created_at DESC`, [me.clan_id]);
      outgoing = o.rows;
    }

    res.json({
      ok: true,
      clan: clanSummary(cRes.rows[0], roster.length),
      territory: {
        count: tRes.rows.length,
        cap: palette.territoryCap(cRes.rows[0].level),
        next_cost: claimCost(tRes.rows.length),
        radius: palette.claimRadius(cRes.rows[0].level),
        tiles: tRes.rows.map(t => ({ q: t.q, r: t.r })),
        hq: { q: cRes.rows[0].hq_q, r: cRes.rows[0].hq_r },
      },
      me: { user_id: userId, rank: me.rank, rank_label: RANK_LABELS[me.rank], permissions },
      roster,
      outgoing_invites: outgoing,
      invites: [],
    });
  } catch (e) {
    sendError(res, e, 'Failed to load clan.');
  }
});

// ── POST /api/clans — found a clan ────────────────────────────────────────
//  Body: { name, description, banner: { emblem, primary, secondary } }
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const body = req.body || {};
  const name = cleanName(body.name);
  if (!name) return res.status(400).json({ error: "Clan names are 3–24 letters, numbers, spaces, ' or -." });
  const description = cleanDescription(body.description);
  const banner = palette.validateBanner(body.banner, 1);
  if (!banner.ok) return res.status(400).json({ error: banner.error });

  try {
    const sRes = await query(
      'SELECT id, tile_q, tile_r, world_version FROM settlements WHERE user_id = $1', [userId]);
    const s = sRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    if (s.tile_q === null || s.world_version < CURRENT_WORLD_VERSION)
      return res.status(400).json({ error: 'Place your settlement on the map first.' });
    const hall = await query(
      "SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = 'guild_hall' LIMIT 1", [s.id]);
    if (!hall.rows.length) return res.status(403).json({ error: 'You need a Guild Hall to found a clan.' });
    const inClan = await query('SELECT 1 FROM clan_members WHERE user_id = $1', [userId]);
    if (inClan.rows.length) return res.status(409).json({ error: 'Already in a clan.' });

    const clanId = await withTransaction(async (client) => {
      const paid = await client.query(
        'UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2 RETURNING wealth',
        [s.id, FOUNDING_COST_WEALTH]);
      if (!paid.rowCount) throw new ClanError(400, `Founding a clan costs ${FOUNDING_COST_WEALTH} wealth.`);

      const c = await client.query(
        `INSERT INTO clans (name, description, banner, founder_user_id, hq_q, hq_r)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, description, JSON.stringify(banner.banner), userId, s.tile_q, s.tile_r]);
      const id = c.rows[0].id;
      await client.query(
        "INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder')", [userId, id]);
      // Pending invites to the founder are moot now.
      await client.query(
        "UPDATE clan_invites SET status = 'revoked' WHERE invited_user_id = $1 AND status = 'pending'", [userId]);
      // HQ seed: the founder's home tile. It can already belong to another
      // clan (players may settle inside clan land) — then the clan starts
      // with no tiles and its first claim anchors on the HQ tile instead.
      await client.query(
        `INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [s.tile_q, s.tile_r, id, userId]);
      // The clan's Chat hub channel exists from founding; forum and live
      // chat unlock by level, with no insert needed then.
      await client.query("INSERT INTO chat_channels (kind, clan_id, name) VALUES ('clan', $1, $2)", [id, name]);
      await logActivity(client, id, 'clan_founded', userId, { name });
      return id;
    });

    publishToSettlements([s.id], { type: 'clan_membership_changed', clan_id: clanId });
    systemLine(clanId, `🏛️ ${req.user.username} founded ${name}.`);
    res.json({ ok: true, clan_id: clanId });
  } catch (e) {
    sendError(res, e, 'Founding failed.');
  }
});

// ── PATCH /api/clans/profile — description / banner (name is fixed) ───────
router.patch('/profile', requireAuth, requireClanPermission('edit_profile'), async (req, res) => {
  const body = req.body || {};
  try {
    await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      await requireActor(client, req.user.userId, clan.id, 'edit_profile');
      const changes = {};
      if (body.description !== undefined) changes.description = cleanDescription(body.description);
      if (body.banner !== undefined) {
        const b = palette.validateBanner(body.banner, clan.level);
        if (!b.ok) throw new ClanError(400, b.error);
        changes.banner = b.banner;
      }
      if (!Object.keys(changes).length) throw new ClanError(400, 'Nothing to change.');
      await client.query(
        `UPDATE clans SET description = COALESCE($2, description), banner = COALESCE($3::jsonb, banner)
          WHERE id = $1`,
        [clan.id, changes.description ?? null, changes.banner ? JSON.stringify(changes.banner) : null]);
      await logActivity(client, clan.id, 'profile_updated', req.user.userId, { fields: Object.keys(changes) });
    });
    publishToClan(req.clan.clanId, { type: 'clan_profile_updated' });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Profile update failed.');
  }
});

// ── POST /api/clans/invites — invite a player by username ─────────────────
router.post('/invites', requireAuth, requireClanPermission('invite'), async (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  if (!username) return res.status(400).json({ error: 'Who should we invite?' });
  try {
    const t = await query('SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
    const target = t.rows[0];
    if (!target) return res.status(404).json({ error: 'No player by that name.' });
    if (target.id === req.user.userId) return res.status(400).json({ error: "You can't invite yourself." });

    const inviteId = await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      await requireActor(client, req.user.userId, clan.id, 'invite');
      if (await memberRow(client, target.id)) throw new ClanError(409, `${target.username} is already in a clan.`);
      const count = (await client.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clan.id])).rows[0].n;
      if (count >= palette.memberCap(clan.level)) throw new ClanError(400, 'Your clan is full.');
      const i = await client.query(
        'INSERT INTO clan_invites (clan_id, invited_user_id, invited_by) VALUES ($1,$2,$3) RETURNING id',
        [clan.id, target.id, req.user.userId]);
      await logActivity(client, clan.id, 'invite_sent', req.user.userId, { username: target.username });
      return i.rows[0].id;
    });

    publishToSettlements([await settlementIdFor(target.id)],
      { type: 'clan_invite_received', invite_id: inviteId, clan_id: req.clan.clanId });
    res.json({ ok: true, invite_id: inviteId });
  } catch (e) {
    sendError(res, e, 'Invite failed.');
  }
});

// ── DELETE /api/clans/invites/:id — revoke a pending invite ───────────────
router.delete('/invites/:id', requireAuth, requireClanPermission('invite'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad invite id.' });
  try {
    const r = await query(
      "UPDATE clan_invites SET status = 'revoked' WHERE id = $1 AND clan_id = $2 AND status = 'pending'",
      [id, req.clan.clanId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Invite not found.' });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Revoke failed.');
  }
});

// ── POST /api/clans/invites/:id/accept ────────────────────────────────────
router.post('/invites/:id/accept', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad invite id.' });
  const userId = req.user.userId;
  try {
    const sRes = await query('SELECT id, tile_q, world_version FROM settlements WHERE user_id = $1', [userId]);
    const s = sRes.rows[0];
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    if (s.tile_q === null || s.world_version < CURRENT_WORLD_VERSION)
      return res.status(400).json({ error: 'Place your settlement on the map first.' });

    const pre = await query(
      "SELECT clan_id FROM clan_invites WHERE id = $1 AND invited_user_id = $2 AND status = 'pending'", [id, userId]);
    if (!pre.rows[0]) return res.status(404).json({ error: 'Invite not found.' });

    const clanId = await withTransaction(async (client) => {
      const clan = await lockClan(client, pre.rows[0].clan_id);
      const inv = await client.query(
        "SELECT id FROM clan_invites WHERE id = $1 AND invited_user_id = $2 AND status = 'pending' FOR UPDATE",
        [id, userId]);
      if (!inv.rows[0]) throw new ClanError(404, 'Invite not found.');
      if (await memberRow(client, userId)) throw new ClanError(409, 'Already in a clan.');
      const count = (await client.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clan.id])).rows[0].n;
      if (count >= palette.memberCap(clan.level)) throw new ClanError(400, 'That clan is full.');

      await client.query("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'recruit')", [userId, clan.id]);
      await client.query("UPDATE clan_invites SET status = 'accepted' WHERE id = $1", [id]);
      await client.query(
        "UPDATE clan_invites SET status = 'declined' WHERE invited_user_id = $1 AND status = 'pending'", [userId]);
      await logActivity(client, clan.id, 'member_joined', userId, { username: req.user.username });
      return clan.id;
    });

    publishToSettlements([s.id], { type: 'clan_membership_changed', clan_id: clanId });
    publishToClan(clanId, { type: 'clan_member_joined', user_id: userId, username: req.user.username });
    systemLine(clanId, `🌱 ${req.user.username} joined the clan.`);
    res.json({ ok: true, clan_id: clanId });
  } catch (e) {
    sendError(res, e, 'Could not join the clan.');
  }
});

// ── POST /api/clans/invites/:id/decline ───────────────────────────────────
router.post('/invites/:id/decline', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad invite id.' });
  try {
    const r = await query(
      "UPDATE clan_invites SET status = 'declined' WHERE id = $1 AND invited_user_id = $2 AND status = 'pending'",
      [id, req.user.userId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Invite not found.' });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Decline failed.');
  }
});

// Deletes the clan (cascades every child table) and returns the former
// members' settlement ids. Caller holds the clan lock.
async function disbandLocked(client, clanId) {
  const m = await client.query(
    `SELECT s.id AS settlement_id FROM clan_members cm
       JOIN settlements s ON s.user_id = cm.user_id WHERE cm.clan_id = $1`, [clanId]);
  await client.query('DELETE FROM clans WHERE id = $1', [clanId]);
  return m.rows.map(r => r.settlement_id);
}

function publishDisband(settlementIds, clanId, name) {
  publishToSettlements(settlementIds, { type: 'clan_disbanded', clan_id: clanId, name });
  publishToSettlements(settlementIds, { type: 'clan_membership_changed', clan_id: null });
}

// ── POST /api/clans/leave ─────────────────────────────────────────────────
//  Founder may only leave as the last member, which disbands the clan.
router.post('/leave', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const pre = await query('SELECT clan_id FROM clan_members WHERE user_id = $1', [userId]);
    if (!pre.rows[0]) return res.status(403).json({ error: 'You are not in a clan.' });

    const out = await withTransaction(async (client) => {
      const clan = await lockClan(client, pre.rows[0].clan_id);
      const me = await memberRow(client, userId);
      if (!me || me.clan_id !== clan.id) throw new ClanError(403, 'You are not in this clan.');
      if (me.rank === 'founder') {
        const n = (await client.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clan.id])).rows[0].n;
        if (n > 1) throw new ClanError(400, 'Transfer leadership before leaving, or disband the clan.');
        return { disbanded: true, clan, settlementIds: await disbandLocked(client, clan.id) };
      }
      await client.query('DELETE FROM clan_members WHERE user_id = $1', [userId]);
      await logActivity(client, clan.id, 'member_left', userId, { username: me.username });
      return { disbanded: false, clan };
    });

    if (out.disbanded) publishDisband(out.settlementIds, out.clan.id, out.clan.name);
    else {
      publishToSettlements([await settlementIdFor(userId)], { type: 'clan_membership_changed', clan_id: null });
      publishToClan(out.clan.id, { type: 'clan_member_left', user_id: userId });
      systemLine(out.clan.id, `🚪 ${req.user.username} left the clan.`);
    }
    res.json({ ok: true, disbanded: out.disbanded });
  } catch (e) {
    sendError(res, e, 'Could not leave the clan.');
  }
});

// Shared shape for kick / promote / demote: lock the clan, re-check the
// actor's flag and the lower-rank rule, then apply `mutate`.
function memberAction(flag, activityType, mutate) {
  return async (req, res) => {
    const targetId = parseId(req.params.userId);
    if (!targetId) return res.status(400).json({ error: 'Bad member id.' });
    if (targetId === req.user.userId) return res.status(400).json({ error: "You can't do that to yourself." });
    try {
      const out = await withTransaction(async (client) => {
        const clan = await lockClan(client, req.clan.clanId);
        const actor = await requireActor(client, req.user.userId, clan.id, flag);
        const target = await memberRow(client, targetId);
        if (!target || target.clan_id !== clan.id) throw new ClanError(404, 'Not a member of your clan.');
        if (!outranks(actor.rank, target.rank)) throw new ClanError(403, 'You can only act on lower ranks.');
        const result = await mutate(client, actor, target);
        await logActivity(client, clan.id, activityType, req.user.userId, { username: target.username, ...result });
        return { target, result };
      });
      if (activityType === 'member_kicked') {
        publishToSettlements([await settlementIdFor(targetId)], { type: 'clan_membership_changed', clan_id: null });
        publishToClan(req.clan.clanId, { type: 'clan_member_kicked', user_id: targetId });
        systemLine(req.clan.clanId, `✂️ ${out.target.username} was removed from the clan.`);
      } else {
        publishToClan(req.clan.clanId, { type: 'clan_rank_changed', user_id: targetId, rank: out.result.rank });
      }
      res.json({ ok: true, ...out.result });
    } catch (e) {
      sendError(res, e, 'Action failed.');
    }
  };
}

router.post('/members/:userId/kick', requireAuth, requireClanPermission('kick'),
  memberAction('kick', 'member_kicked', async (client, actor, target) => {
    await client.query('DELETE FROM clan_members WHERE user_id = $1', [target.user_id]);
    return {};
  }));

router.post('/members/:userId/promote', requireAuth, requireClanPermission('manage_ranks'),
  memberAction('manage_ranks', 'rank_changed', async (client, actor, target) => {
    const rank = promotedRank(actor.rank, target.rank);
    if (!rank) throw new ClanError(403, `You can't promote a ${RANK_LABELS[target.rank]} any higher.`);
    await client.query('UPDATE clan_members SET rank = $2 WHERE user_id = $1', [target.user_id, rank]);
    return { from: target.rank, rank };
  }));

router.post('/members/:userId/demote', requireAuth, requireClanPermission('manage_ranks'),
  memberAction('manage_ranks', 'rank_changed', async (client, actor, target) => {
    const rank = demotedRank(target.rank);
    if (!rank) throw new ClanError(400, 'Recruits are already the lowest rank.');
    await client.query('UPDATE clan_members SET rank = $2 WHERE user_id = $1', [target.user_id, rank]);
    return { from: target.rank, rank };
  }));

// ── POST /api/clans/transfer — { userId } → new founder ───────────────────
//  Demote self first, then promote: that order keeps the one-founder index
//  satisfied. The new founder needs no Guild Hall and no tier.
router.post('/transfer', requireAuth, requireClanPermission('transfer_leadership'), async (req, res) => {
  const targetId = parseId((req.body || {}).userId);
  if (!targetId) return res.status(400).json({ error: 'Choose a member.' });
  if (targetId === req.user.userId) return res.status(400).json({ error: 'You already lead this clan.' });
  try {
    await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      await requireActor(client, req.user.userId, clan.id, 'transfer_leadership');
      const target = await memberRow(client, targetId);
      if (!target || target.clan_id !== clan.id) throw new ClanError(404, 'Not a member of your clan.');
      await client.query("UPDATE clan_members SET rank = 'leader' WHERE user_id = $1", [req.user.userId]);
      await client.query("UPDATE clan_members SET rank = 'founder' WHERE user_id = $1", [targetId]);
      await client.query('UPDATE clans SET founder_user_id = $2 WHERE id = $1', [clan.id, targetId]);
      await logActivity(client, clan.id, 'leadership_transferred', req.user.userId, { username: target.username });
      return target.username;
    }).then(name => { systemLine(req.clan.clanId, `👑 ${name} now leads the clan.`); });
    publishToClan(req.clan.clanId, { type: 'clan_leadership_transferred', user_id: targetId });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Transfer failed.');
  }
});

// ── POST /api/clans/disband ───────────────────────────────────────────────
router.post('/disband', requireAuth, requireClanPermission('disband'), async (req, res) => {
  try {
    const out = await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      await requireActor(client, req.user.userId, clan.id, 'disband');
      return { clan, settlementIds: await disbandLocked(client, clan.id) };
    });
    publishDisband(out.settlementIds, out.clan.id, out.clan.name);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Disband failed.');
  }
});

// ── Territory (spec §6) ────────────────────────────────────────────────────

const claimCost = tiles => 50 + 25 * tiles;
const wrap = (v, n) => ((v % n) + n) % n;

// Why (q,r) can't be claimed by this clan regardless of adjacency/funds, or
// null. Blocks: a non-member's home settlement, NPC / kingdom settlements
// and kingdom annex tiles. Outposts and outpost claims never block (§6.3).
async function blockedReason(q, r, clanId) {
  const home = await query(
    `SELECT s.user_id, cm.clan_id FROM settlements s
       LEFT JOIN clan_members cm ON cm.user_id = s.user_id
      WHERE s.tile_q = $1 AND s.tile_r = $2`, [q, r]);
  if (home.rows.some(h => h.clan_id !== clanId)) return "Another player's settlement stands there.";
  const npc = await query(
    `SELECT 1 FROM npc_settlements
      WHERE (tile_q = $1 AND tile_r = $2)
         OR (is_kingdom AND kingdom_tiles @> $3::jsonb)
      LIMIT 1`, [q, r, JSON.stringify([{ q, r }])]);
  if (npc.rows.length) return 'That land belongs to an NPC settlement.';
  return null;
}

// ── POST /api/clans/territory/claim — { q, r } ────────────────────────────
//  Pattern B: lock the clan, then check adjacency + capacity + funds as one
//  unit. The (q,r) primary key is the backstop against other clans.
router.post('/territory/claim', requireAuth, requireClanPermission('claim_territory'), async (req, res) => {
  const W = mapgen.MAP_W, H = mapgen.MAP_H;
  const qIn = Number((req.body || {}).q), rIn = Number((req.body || {}).r);
  if (!Number.isInteger(qIn) || !Number.isInteger(rIn)) return res.status(400).json({ error: 'Choose a tile.' });
  const q = wrap(qIn, W), r = wrap(rIn, H);
  try {
    const tile = await query('SELECT terrain FROM tiles WHERE q = $1 AND r = $2', [q, r]);
    if (!tile.rows[0]) return res.status(404).json({ error: 'No such tile.' });
    const seen = await query(
      'SELECT 1 FROM fog_of_war WHERE user_id = $1 AND tile_q = $2 AND tile_r = $3', [req.user.userId, q, r]);
    if (!seen.rows.length) return res.status(400).json({ error: "You haven't explored that tile yet." });
    const blocked = await blockedReason(q, r, req.clan.clanId);
    if (blocked) return res.status(400).json({ error: blocked });

    const out = await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      await requireActor(client, req.user.userId, clan.id, 'claim_territory');
      const owned = (await client.query('SELECT q, r FROM clan_territory WHERE clan_id = $1', [clan.id])).rows;
      if (owned.some(t => t.q === q && t.r === r)) throw new ClanError(409, 'Your clan already holds that tile.');
      const cap = palette.territoryCap(clan.level);
      if (owned.length >= cap) {
        throw new ClanError(400, `Your clan holds all ${cap} tiles its level allows. Level up to claim more.`);
      }
      // No voluntary unclaim ⇒ adjacency keeps territory connected. A clan
      // with no tiles (HQ seed was taken) anchors on its HQ tile.
      const anchors = owned.length ? owned : [{ q: clan.hq_q, r: clan.hq_r }];
      const adjacent = anchors.some(t => t.q !== null &&
        (mapgen.hexDistanceWrapped(q, r, t.q, t.r) === 1 || (!owned.length && t.q === q && t.r === r)));
      if (!adjacent) throw new ClanError(400, "Claims must border your clan's land.");
      // Reach: within claimRadius(level) of the HQ tile, so territory stays
      // compact (no long lines) and grows outward with the clan.
      const radius = palette.claimRadius(clan.level);
      const dist = mapgen.hexDistanceWrapped(q, r, clan.hq_q, clan.hq_r);
      if (dist > radius) {
        const need = palette.levelForRadius(dist);
        throw new ClanError(400, need
          ? `At level ${clan.level} your clan can claim within ${radius} tile${radius === 1 ? '' : 's'} of its hall; this tile is ${dist} away (level ${need} reaches it).`
          : `That tile is ${dist} tiles from your hall — beyond any clan's reach.`);
      }
      const cost = claimCost(owned.length);
      if ((await spendPrestige(client, clan.id, cost)) === null) {
        throw new ClanError(400, `Claiming costs ${cost} prestige; your clan has ${Number(clan.prestige)}.`);
      }
      const ins = await client.query(
        `INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [q, r, clan.id, req.user.userId]);
      if (!ins.rowCount) throw new ClanError(409, 'Another clan holds that tile.');
      await logActivity(client, clan.id, 'territory_claimed', req.user.userId, { q, r, cost });
      return { cost, tiles: owned.length + 1, cap };
    });

    publishToClan(req.clan.clanId, { type: 'clan_territory_claimed', q, r, user_id: req.user.userId });
    systemLine(req.clan.clanId, `🏳️ ${req.user.username} claimed (${q}, ${r}) for the clan.`);
    res.json({ ok: true, q, r, ...out, next_cost: claimCost(out.tiles) });
  } catch (e) {
    sendError(res, e, 'Claim failed.');
  }
});

// ── POST /api/clans/cheat/prestige — { amount } (Dev Tools) ──────────────
//  Same gate as the other Dev Tools cheats (/api/game/cheat/*): any signed-
//  in player, own clan only. Adding moves spendable + lifetime and can level
//  the clan up, skipping the daily cap. Removing only lowers the spendable
//  balance (floored at 0) — lifetime and level never go down.
router.post('/cheat/prestige', requireAuth, requireClanMember, async (req, res) => {
  const amount = parseInt((req.body || {}).amount, 10);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) {
    return res.status(400).json({ error: 'Amount must be a non-zero number.' });
  }
  const clanId = req.clan.clanId;
  try {
    const out = await withTransaction(async (client) => {
      await lockClan(client, clanId);
      let leveledTo = null;
      if (amount > 0) {
        const g = await grantPrestige(client, clanId, amount);
        leveledTo = await applyLevelUp(client, clanId, g.prestige_lifetime);
      } else {
        await client.query('UPDATE clans SET prestige = GREATEST(0, prestige + $2) WHERE id = $1', [clanId, amount]);
      }
      await logActivity(client, clanId, 'prestige_adjusted', req.user.userId, { amount, cheat: true });
      if (leveledTo) {
        await client.query(
          "INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'level_up',NULL,$2)",
          [clanId, JSON.stringify({ level: leveledTo })]);
      }
      const c = (await client.query('SELECT prestige, prestige_lifetime, level FROM clans WHERE id = $1', [clanId])).rows[0];
      return { leveledTo, prestige: Number(c.prestige), prestige_lifetime: Number(c.prestige_lifetime), level: c.level };
    });
    publishToClan(clanId, { type: 'clan_prestige', user_id: req.user.userId, amount, source: 'cheat' });
    if (out.leveledTo) {
      publishToClan(clanId, { type: 'clan_level_up', level: out.leveledTo });
      systemLine(clanId, `🎉 The clan reached level ${out.leveledTo}!`);
    }
    res.json({ ok: true, ...out });
  } catch (e) {
    sendError(res, e, 'Cheat failed.');
  }
});

// ── GET /api/clans/activity?before=<id> — the clan's feed, newest first ────
router.get('/activity', requireAuth, requireClanMember, async (req, res) => {
  const before = parseId(req.query.before);
  try {
    const r = await query(
      `SELECT a.id, a.type, a.payload, a.created_at, u.username AS actor
         FROM clan_activity a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.clan_id = $1 AND ($2::int IS NULL OR a.id < $2)
        ORDER BY a.id DESC LIMIT 30`,
      [req.clan.clanId, before]);
    res.json({ ok: true, activity: r.rows });
  } catch (e) {
    sendError(res, e, 'Failed to load activity.');
  }
});

// ── GET /api/clans/leaderboard — top clans by lifetime prestige (public) ──
router.get('/leaderboard', async (req, res) => {
  try {
    const r = await query(
      `SELECT c.id, c.name, c.level, c.prestige_lifetime, c.banner,
              (SELECT COUNT(*)::int FROM clan_members m WHERE m.clan_id = c.id) AS member_count
         FROM clans c
        ORDER BY c.prestige_lifetime DESC, c.created_at ASC
        LIMIT 50`);
    res.json({
      ok: true,
      leaderboard: r.rows.map(c => ({
        id: c.id, name: c.name, level: c.level, prestige: Number(c.prestige_lifetime),
        member_count: c.member_count, banner: palette.resolveBanner(c.banner),
      })),
    });
  } catch (e) {
    sendError(res, e, 'Could not load the clan leaderboard.');
  }
});

module.exports = router;
