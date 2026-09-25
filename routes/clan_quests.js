// ══════════════════════════════════════════════════════════════════════════
//  CLAN QUESTS — the clan's quest board (lib/clan_quests.js has the rules)
//
//  Mounted at /api/clan-quests. Every route needs clan membership.
//    GET  /                      today's rotating board + forming/active
//                                parties + recent runs
//
//  Only quests on today's board (CQ.boardFor) can be started or posted;
//  runs already underway finish whatever the board says.
//    POST /solo                  { quest_key, citizen_id } — start a solo run
//    POST /party                 { quest_key, role_index, citizen_id } — post
//                                a party, taking one role yourself (Member+)
//    POST /runs/:id/join         { role_index, citizen_id } — fill a role
//    POST /runs/:id/leave        give your role back (forming only)
//    POST /runs/:id/cancel       disband a forming party (poster, or anyone
//                                with 'moderate')
//    POST /cheat/finish          Dev Tools: finish your active runs now
//
//  Concurrency: every write locks the clan's run row (SELECT … FOR UPDATE)
//  and relies on the slot indexes — one member per role, one role per
//  member, one live run per citizen — so racing joins can't overfill.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireClanMember, checkClanPermission } = require('../lib/clan_permissions');
const CQ = require('../lib/clan_quests');

const router = express.Router();

class QuestError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
function sendError(res, e, fallback) {
  if (e instanceof QuestError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  if (e && e.code === '23505') {
    if (e.constraint === 'clan_quest_slots_pkey') return res.status(409).json({ error: 'Someone just took that role.' });
    if (e.constraint === 'clan_quest_slots_member_uniq') return res.status(409).json({ error: 'You already have a citizen in this party.' });
    if (e.constraint === 'clan_quest_slots_citizen_live') return res.status(409).json({ error: 'That citizen is already on a clan quest.' });
    if (e.constraint === 'clan_quest_runs_party_uniq') return res.status(409).json({ error: 'A party for this quest is already forming.' });
  }
  console.error(e);
  res.status(500).json({ error: fallback });
}
const parseId = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

async function clanLevel(clanId, client) {
  const r = await (client || { query }).query('SELECT level FROM clans WHERE id = $1', [clanId]);
  return r.rows[0] ? r.rows[0].level : 1;
}
async function mySettlementId(userId) {
  const r = await query('SELECT id FROM settlements WHERE user_id = $1', [userId]);
  if (!r.rows[0]) throw new QuestError(404, 'No settlement.');
  return r.rows[0].id;
}

// Public shape of a definition.
function defView(d) {
  return {
    key: d.key, kind: d.kind, min_level: d.min_level, icon: d.icon, title: d.title, description: d.description,
    duration_s: d.duration_s, base_success: d.base_success, rewards: d.rewards, prestige: d.prestige,
    skill_key: d.skill_key || null, roles: d.roles || null, combat_chance: d.combat_chance,
  };
}

// Runs with their slots, for the board.
async function loadRuns(clanId, statuses, limit) {
  const runs = (await query(
    `SELECT r.*, u.username AS created_by_name FROM clan_quest_runs r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.clan_id = $1 AND r.status = ANY($2::text[])
      ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT $3`, [clanId, statuses, limit])).rows;
  if (!runs.length) return [];
  const slots = (await query(
    `SELECT s.run_id, s.role_index, s.user_id, s.citizen_id, s.rewards, s.prestige,
            u.username, c.name AS citizen_name, c.skills
       FROM clan_quest_slots s JOIN users u ON u.id = s.user_id JOIN citizens c ON c.id = s.citizen_id
      WHERE s.run_id = ANY($1::int[]) ORDER BY s.role_index`, [runs.map(r => r.id)])).rows;
  const defs = await CQ.loadDefs();
  const foes = {};
  for (const r of runs) {
    const enc = Array.isArray(r.combat_encounter) ? r.combat_encounter : [];
    if (r.combat_status === 'resolved' && enc.length) foes[r.id] = (await CQ.enemyNames(enc)).join(', ');
  }
  return runs.map(r => {
    const def = defs.find(d => d.key === r.quest_key) || null;
    return {
      id: r.id, quest_key: r.quest_key, kind: r.kind, status: r.status,
      created_by: r.created_by, created_by_name: r.created_by_name,
      created_at: r.created_at, expires_at: r.expires_at, started_at: r.started_at,
      completes_at: r.completes_at, resolved_at: r.resolved_at,
      success_chance: r.success_chance,
      // Encounters stay hidden until they happen.
      combat: r.combat_status === 'resolved'
        ? { outcome: r.combat_outcome, foes: foes[r.id] || '', log: r.combat_log || [] }
        : null,
      quest: def ? defView(def) : { key: r.quest_key, title: r.quest_key, icon: '📜', kind: r.kind },
      slots: slots.filter(s => s.run_id === r.id).map(s => ({
        role_index: s.role_index, user_id: s.user_id, username: s.username,
        citizen_id: s.citizen_id, citizen_name: s.citizen_name,
        skill: def ? Number((s.skills || {})[CQ.skillFor(def, s.role_index)]) || 1 : null,
        rewards: s.rewards, prestige: s.prestige,
      })),
    };
  });
}

// ── GET /api/clan-quests ─────────────────────────────────────────────────
router.get('/', requireAuth, requireClanMember, async (req, res) => {
  const clanId = req.clan.clanId, userId = req.user.userId;
  try {
    // Safety net like GET /api/quests: resolve anything due even if the
    // worker is off or behind.
    await CQ.tick();
    const level = await clanLevel(clanId);
    const today = CQ.utcDay();
    const mySoloToday = (await query(
      `SELECT DISTINCT r.quest_key FROM clan_quest_runs r JOIN clan_quest_slots s ON s.run_id = r.id
        WHERE r.clan_id = $1 AND r.kind = 'solo' AND s.user_id = $2 AND r.day = $3 AND r.status <> 'cancelled'`,
      [clanId, userId, today])).rows.map(r => r.quest_key);
    const partyDoneToday = (await query(
      `SELECT DISTINCT quest_key FROM clan_quest_runs
        WHERE clan_id = $1 AND kind = 'party' AND status = 'completed' AND day = $2`, [clanId, today])).rows.map(r => r.quest_key);
    const live = await loadRuns(clanId, ['forming', 'active'], 50);
    const recent = await loadRuns(clanId, ['completed', 'failed', 'expired'], 12);
    const today_board = await CQ.boardFor(clanId, level, today);
    const board = [...today_board.solo, ...today_board.party].map(d => {
      const gate = CQ.gateFor(d);
      const liveRun = live.find(r => r.quest_key === d.key && (d.kind === 'party' || r.slots.some(s => s.user_id === userId)));
      let state = 'available';
      if (level < gate) state = 'locked';
      else if (d.kind === 'party' && liveRun) state = liveRun.status;          // forming | active
      else if (d.kind === 'solo' && liveRun) state = 'active';
      else if (d.kind === 'solo' && mySoloToday.includes(d.key)) state = 'done_today';
      else if (d.kind === 'party' && partyDoneToday.includes(d.key)) state = 'done_today';
      return { ...defView(d), unlock_level: gate, state, run_id: liveRun ? liveRun.id : null };
    });
    const perms = await checkClanPermission(userId, 'moderate');
    res.json({
      ok: true, level, me: { user_id: userId, rank: req.clan.rank, moderate: !!(perms && perms.allowed) },
      board, runs: live, recent, forming_hours: CQ.FORMING_HOURS,
      rotates_at: today_board.rotates_at,
      // Teasers: the next few quests the clan's level hasn't reached.
      locked: today_board.locked.slice(0, 4).map(d => ({ key: d.key, kind: d.kind, icon: d.icon, title: d.title, unlock_level: CQ.gateFor(d) })),
      board_size: { solo: CQ.BOARD_SOLO, party: CQ.BOARD_PARTY },
      party_unlock_level: CQ.PARTY_UNLOCK_LEVEL, server_now: new Date().toISOString(),
    });
  } catch (e) {
    sendError(res, e, 'Could not load the quest board.');
  }
});

// Shared checks for putting a citizen on a run.
async function claimCitizen(client, userId, citizenId) {
  const sid = (await client.query('SELECT id FROM settlements WHERE user_id = $1', [userId])).rows[0];
  if (!sid) throw new QuestError(404, 'No settlement.');
  const a = await CQ.availableCitizen(client, citizenId, sid.id);
  if (a.error) throw new QuestError(400, a.error);
  return { settlementId: sid.id, citizen: a.citizen };
}

// Locks the clan row: serialises board writes per clan.
async function lockClan(client, clanId) {
  const c = (await client.query('SELECT id, level FROM clans WHERE id = $1 FOR UPDATE', [clanId])).rows[0];
  if (!c) throw new QuestError(404, 'Clan not found.');
  return c;
}

// ── POST /api/clan-quests/solo ───────────────────────────────────────────
router.post('/solo', requireAuth, requireClanMember, async (req, res) => {
  const def = await CQ.byKey(String((req.body || {}).quest_key || ''));
  const citizenId = parseId((req.body || {}).citizen_id);
  if (!def || def.kind !== 'solo') return res.status(400).json({ error: 'Unknown clan quest.' });
  if (!citizenId) return res.status(400).json({ error: 'Choose a citizen.' });
  const userId = req.user.userId;
  try {
    const run = await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      if (clan.level < CQ.gateFor(def)) {
        throw new QuestError(403, `Unlocks at clan level ${CQ.gateFor(def)}.`, { locked: true });
      }
      if (def.archived || !(await CQ.onBoard(clan.id, clan.level, def.key))) {
        throw new QuestError(409, "That quest isn't on today's board.");
      }
      const done = await client.query(
        `SELECT 1 FROM clan_quest_runs r JOIN clan_quest_slots s ON s.run_id = r.id
          WHERE r.clan_id = $1 AND r.quest_key = $2 AND s.user_id = $3 AND r.day = $4 AND r.status <> 'cancelled'`,
        [clan.id, def.key, userId, CQ.utcDay()]);
      if (done.rows.length) throw new QuestError(409, 'You have already done this one today — it returns tomorrow.');
      const { settlementId, citizen } = await claimCitizen(client, userId, citizenId);
      const r = (await client.query(
        `INSERT INTO clan_quest_runs (clan_id, quest_key, kind, status, created_by)
         VALUES ($1,$2,'solo','forming',$3) RETURNING *`,
        [clan.id, def.key, userId])).rows[0];
      await client.query(
        'INSERT INTO clan_quest_slots (run_id, role_index, user_id, settlement_id, citizen_id) VALUES ($1,0,$2,$3,$4)',
        [r.id, userId, settlementId, citizen.id]);
      await CQ.setOut(client, r.id, def);
      const ends = (await client.query('SELECT completes_at FROM clan_quest_runs WHERE id = $1', [r.id])).rows[0];
      return { ...r, completes_at: ends.completes_at, citizen_name: citizen.name };
    });
    CQ.publishClan(req.clan.clanId, { run_id: run.id, what: 'started' });
    res.json({ ok: true, run_id: run.id, completes_at: run.completes_at, citizen_name: run.citizen_name });
  } catch (e) {
    sendError(res, e, 'Could not start the quest.');
  }
});

// Fills one role on a locked forming run; starts it if that was the last.
async function fillRole(client, run, def, roleIndex, userId, citizenId) {
  if (!(roleIndex >= 0 && roleIndex < def.roles.length)) throw new QuestError(400, 'No such role.');
  const slots = (await client.query('SELECT role_index, user_id FROM clan_quest_slots WHERE run_id = $1', [run.id])).rows;
  if (slots.some(s => s.role_index === roleIndex)) throw new QuestError(409, 'Someone just took that role.');
  if (slots.some(s => s.user_id === userId)) throw new QuestError(409, 'You already have a citizen in this party — one per member.');
  const { settlementId, citizen } = await claimCitizen(client, userId, citizenId);
  await client.query(
    'INSERT INTO clan_quest_slots (run_id, role_index, user_id, settlement_id, citizen_id) VALUES ($1,$2,$3,$4,$5)',
    [run.id, roleIndex, userId, settlementId, citizen.id]);
  const started = slots.length + 1 >= def.roles.length;
  if (started) await CQ.setOut(client, run.id, def);
  return { started, citizen };
}

// ── POST /api/clan-quests/party — post a party and take a role ───────────
router.post('/party', requireAuth, requireClanMember, async (req, res) => {
  const b = req.body || {};
  const def = await CQ.byKey(String(b.quest_key || ''));
  const citizenId = parseId(b.citizen_id), roleIndex = Number.isInteger(b.role_index) ? b.role_index : parseInt(b.role_index, 10);
  if (!def || def.kind !== 'party') return res.status(400).json({ error: 'Unknown party quest.' });
  if (!citizenId) return res.status(400).json({ error: 'Choose a citizen.' });
  if (req.clan.rank === 'recruit') return res.status(403).json({ error: 'Recruits can join parties but not post them.' });
  const userId = req.user.userId;
  try {
    const out = await withTransaction(async (client) => {
      const clan = await lockClan(client, req.clan.clanId);
      const gate = CQ.gateFor(def);
      if (clan.level < gate) throw new QuestError(403, `Unlocks at clan level ${gate}.`, { locked: true });
      if (def.archived || !(await CQ.onBoard(clan.id, clan.level, def.key))) {
        throw new QuestError(409, "That quest isn't on today's board.");
      }
      const live = await client.query(
        "SELECT id FROM clan_quest_runs WHERE clan_id = $1 AND quest_key = $2 AND kind = 'party' AND status IN ('forming','active')",
        [clan.id, def.key]);
      if (live.rows.length) throw new QuestError(409, 'A party for this quest is already forming — join it instead.', { run_id: live.rows[0].id });
      const done = await client.query(
        "SELECT 1 FROM clan_quest_runs WHERE clan_id = $1 AND quest_key = $2 AND kind = 'party' AND status = 'completed' AND day = $3",
        [clan.id, def.key, CQ.utcDay()]);
      if (done.rows.length) throw new QuestError(409, 'Your clan already completed this today — it returns tomorrow.');
      const run = (await client.query(
        `INSERT INTO clan_quest_runs (clan_id, quest_key, kind, status, created_by, expires_at)
         VALUES ($1,$2,'party','forming',$3, NOW() + make_interval(hours => $4)) RETURNING *`,
        [clan.id, def.key, userId, CQ.FORMING_HOURS])).rows[0];
      const f = await fillRole(client, run, def, roleIndex, userId, citizenId);
      return { run, ...f };
    });
    CQ.publishClan(req.clan.clanId, { run_id: out.run.id, what: out.started ? 'started' : 'posted' });
    if (!out.started) {
      require('../lib/clan_chat').systemLine(req.clan.clanId,
        `${def.icon} ${req.user.username} is gathering a party for "${def.title}" — ${def.roles.length - 1} role${def.roles.length - 1 === 1 ? '' : 's'} open.`);
    }
    res.json({ ok: true, run_id: out.run.id, started: out.started });
  } catch (e) {
    sendError(res, e, 'Could not post the party.');
  }
});

// Loads + locks a run of the viewer's clan.
async function lockRun(client, runId, clanId) {
  const r = (await client.query('SELECT * FROM clan_quest_runs WHERE id = $1 AND clan_id = $2 FOR UPDATE', [runId, clanId])).rows[0];
  if (!r) throw new QuestError(404, 'Quest not found.');
  return r;
}

// ── POST /api/clan-quests/runs/:id/join ──────────────────────────────────
router.post('/runs/:id/join', requireAuth, requireClanMember, async (req, res) => {
  const runId = parseId(req.params.id);
  const b = req.body || {};
  const citizenId = parseId(b.citizen_id), roleIndex = Number.isInteger(b.role_index) ? b.role_index : parseInt(b.role_index, 10);
  if (!runId || !citizenId) return res.status(400).json({ error: 'Choose a role and a citizen.' });
  try {
    const out = await withTransaction(async (client) => {
      const run = await lockRun(client, runId, req.clan.clanId);
      if (run.status !== 'forming') throw new QuestError(409, 'That party has already set out.');
      const def = await CQ.byKey(run.quest_key);
      if (!def) throw new QuestError(404, 'Quest not found.');
      return { run, def, ...(await fillRole(client, run, def, roleIndex, req.user.userId, citizenId)) };
    });
    CQ.publishClan(req.clan.clanId, { run_id: runId, what: out.started ? 'started' : 'joined' });
    if (out.started) {
      require('../lib/clan_chat').systemLine(req.clan.clanId, `${out.def.icon} The party for "${out.def.title}" is complete and has set out!`);
    }
    res.json({ ok: true, started: out.started });
  } catch (e) {
    sendError(res, e, 'Could not join the party.');
  }
});

// ── POST /api/clan-quests/runs/:id/leave ─────────────────────────────────
router.post('/runs/:id/leave', requireAuth, requireClanMember, async (req, res) => {
  const runId = parseId(req.params.id);
  if (!runId) return res.status(400).json({ error: 'Bad quest.' });
  try {
    const cancelled = await withTransaction(async (client) => {
      const run = await lockRun(client, runId, req.clan.clanId);
      if (run.status !== 'forming') throw new QuestError(409, 'The party has already set out.');
      const d = await client.query('DELETE FROM clan_quest_slots WHERE run_id = $1 AND user_id = $2', [runId, req.user.userId]);
      if (!d.rowCount) throw new QuestError(404, 'You are not in this party.');
      const left = (await client.query('SELECT COUNT(*)::int AS n FROM clan_quest_slots WHERE run_id = $1', [runId])).rows[0].n;
      if (!left) await client.query("UPDATE clan_quest_runs SET status = 'cancelled', resolved_at = NOW() WHERE id = $1", [runId]);
      return !left;
    });
    CQ.publishClan(req.clan.clanId, { run_id: runId, what: cancelled ? 'cancelled' : 'left' });
    res.json({ ok: true, cancelled });
  } catch (e) {
    sendError(res, e, 'Could not leave the party.');
  }
});

// ── POST /api/clan-quests/runs/:id/cancel ────────────────────────────────
router.post('/runs/:id/cancel', requireAuth, requireClanMember, async (req, res) => {
  const runId = parseId(req.params.id);
  if (!runId) return res.status(400).json({ error: 'Bad quest.' });
  try {
    await withTransaction(async (client) => {
      const run = await lockRun(client, runId, req.clan.clanId);
      if (run.status !== 'forming') throw new QuestError(409, 'Only a forming party can be called off.');
      if (run.created_by !== req.user.userId) {
        const p = await checkClanPermission(req.user.userId, 'moderate', client);
        if (!p || !p.allowed) throw new QuestError(403, 'Only whoever posted the party, or an officer, can call it off.');
      }
      await client.query("UPDATE clan_quest_runs SET status = 'cancelled', resolved_at = NOW() WHERE id = $1", [runId]);
      await client.query('UPDATE clan_quest_slots SET active = FALSE WHERE run_id = $1', [runId]);
    });
    CQ.publishClan(req.clan.clanId, { run_id: runId, what: 'cancelled' });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not call off the party.');
  }
});

// ── POST /api/clan-quests/cheat/finish (Dev Tools) ───────────────────────
//  Same gate as the other Dev Tools cheats: brings every active run of your
//  clan that you're part of to its end now and resolves it.
router.post('/cheat/finish', requireAuth, requireClanMember, async (req, res) => {
  try {
    const r = await query(
      `UPDATE clan_quest_runs r SET completes_at = NOW(),
              combat_trigger_at = CASE WHEN r.combat_status = 'rolled' THEN NOW() - INTERVAL '1 second' ELSE r.combat_trigger_at END
        WHERE r.clan_id = $1 AND r.status = 'active'
          AND EXISTS (SELECT 1 FROM clan_quest_slots s WHERE s.run_id = r.id AND s.user_id = $2) RETURNING id`,
      [req.clan.clanId, req.user.userId]);
    await CQ.tick();
    res.json({ ok: true, finished: r.rowCount });
  } catch (e) {
    sendError(res, e, 'Cheat failed.');
  }
});

module.exports = router;
