// scripts/clan_phase1_test.js — end-to-end checks for spec 016 Phase 1
// (membership core, Guild Hall gate, admin-guarded regenerate wipe).
//
// DESTRUCTIVE: calls /world/regenerate at the end. Run only against a
// throwaway database. Needs a running server started with the same
// DATABASE_URL and with ADMIN_USER_IDS containing the first user this
// script registers (it prints the id and skips the regenerate checks if
// that user is not an admin).
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_phase1_test.js

'use strict';

const { Pool } = require('pg');

const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const RUN = Math.random().toString(36).slice(2, 7);

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

let tileSeq = 0;
// Registers a player and sets their settlement up directly in the DB.
async function player(name, { tier = 'camp', hall = false, wealth = 2000 } = {}) {
  const username = `${name}_${RUN}`;
  const r = await api(null, 'POST', '/api/auth/register',
    { username, email: `${username}@test.local`, password: 'password123', species: 'Mice' });
  if (r.status !== 200) throw new Error('register failed: ' + JSON.stringify(r.data));
  const u = (await pool.query('SELECT id FROM users WHERE username = $1', [username])).rows[0];
  const s = (await pool.query(
    `UPDATE settlements SET tile_q = $2, tile_r = $3, world_version = 2, tier = $4, wealth = $5,
            timber = 5000, stone = 5000
      WHERE user_id = $1 RETURNING id`,
    [u.id, 1 + (tileSeq % 30), 1 + Math.floor(tileSeq / 30), tier, wealth])).rows[0];
  tileSeq++;
  if (hall) await pool.query("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'guild_hall',1)", [s.id]);
  return { username, token: r.data.token, id: u.id, settlementId: s.id };
}

const BANNER = { emblem: 'acorn', primary: 'moss', secondary: 'wheat' };
const me = p => api(p.token, 'GET', '/api/clans/me');

// Opens the SSE stream and collects events until close().
function listen(p) {
  const events = [];
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(p.token)}`, { signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)));
        }
      }
    } catch (_) {}
  })();
  return { events, close: () => ctrl.abort() };
}
const tick = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`Clan Phase 1 tests against ${BASE} (run ${RUN})`);

  // ── Guild Hall tier gate ──
  console.log('Gating');
  const camp = await player('camp');
  const village = await player('village', { tier: 'village' });
  const town = await player('town', { tier: 'town' });
  for (const p of [camp, village]) {
    const r = await api(p.token, 'POST', '/api/buildings/build', { buildingId: 'guild_hall' });
    check(r.status === 400 && /Town/.test(r.data.error), `guild hall at ${p.username.split('_')[0]} → 400 tier message`);
    const list = await api(p.token, 'GET', '/api/buildings');
    check(list.data.buildings.find(b => b.id === 'guild_hall').tierMet === false, 'list reports tierMet:false');
  }
  const built = await api(town.token, 'POST', '/api/buildings/build', { buildingId: 'guild_hall' });
  check(built.status === 200, 'guild hall at town → 200');

  // ── Founding ──
  console.log('Founding');
  const noHall = await api(camp.token, 'POST', '/api/clans', { name: `NoHall ${RUN}`, banner: BANNER });
  check(noHall.status === 403, 'found without a hall → 403');
  const bad1 = await api(town.token, 'POST', '/api/clans', { name: `Oaks ${RUN}`, banner: { ...BANNER, primary: 'gilt' } });
  check(bad1.status === 400, 'locked swatch → 400');
  const bad2 = await api(town.token, 'POST', '/api/clans', { name: `Oaks ${RUN}`, banner: { ...BANNER, secondary: 'moss' } });
  check(bad2.status === 400, 'primary = secondary → 400');
  const bad3 = await api(town.token, 'POST', '/api/clans', { name: 'x<script>', banner: BANNER });
  check(bad3.status === 400, 'invalid name → 400');
  const founded = await api(town.token, 'POST', '/api/clans', { name: `Oaks ${RUN}`, banner: BANNER, description: 'hi' });
  check(founded.status === 200, 'found at town with hall → 200');
  const w = (await pool.query('SELECT wealth FROM settlements WHERE id = $1', [town.settlementId])).rows[0].wealth;
  check(w === 2000 - 300 - 500, 'founding deducted 500 wealth (after 300 for the hall)');

  const founder2 = await player('rival', { tier: 'town', hall: true });
  const dup = await api(founder2.token, 'POST', '/api/clans', { name: `oAkS ${RUN}`, banner: BANNER });
  check(dup.status === 409, 'duplicate name, different case → 409');
  const again = await api(town.token, 'POST', '/api/clans', { name: `Second ${RUN}`, banner: BANNER });
  check(again.status === 409, 'founding while in a clan → 409');
  const rival = await api(founder2.token, 'POST', '/api/clans', { name: `Rivals ${RUN}`, banner: BANNER });
  check(rival.status === 200, 'second clan founded');

  // Parallel founding with one name: exactly one wins.
  const racers = await Promise.all([1, 2, 3].map(i => player(`racer${i}`, { tier: 'town', hall: true })));
  const race = await Promise.all(racers.map(p => api(p.token, 'POST', '/api/clans', { name: `Race ${RUN}`, banner: BANNER })));
  check(race.filter(r => r.status === 200).length === 1 && race.filter(r => r.status === 409).length === 2,
    'parallel founding, same name → one 200, two 409');

  // ── Invites / join ──
  console.log('Invites');
  const sse = listen(camp);
  await tick(300);
  const inv = await api(town.token, 'POST', '/api/clans/invites', { username: camp.username.toUpperCase() });
  check(inv.status === 200, 'founder invites camp-tier player (case-insensitive name)');
  const invDup = await api(town.token, 'POST', '/api/clans/invites', { username: camp.username });
  check(invDup.status === 409, 'duplicate pending invite → 409');
  const rivalInv = await api(founder2.token, 'POST', '/api/clans/invites', { username: camp.username });
  check(rivalInv.status === 200, 'rival clan can also invite');
  await tick(300);
  check(sse.events.some(e => e.type === 'clan_invite_received'), 'invitee receives clan_invite_received over SSE');

  const campMe = await me(camp);
  check(campMe.data.clan === null && campMe.data.invites.length === 2, '/me lists two pending invites');
  const accept = await api(camp.token, 'POST', `/api/clans/invites/${inv.data.invite_id}/accept`);
  check(accept.status === 200, 'camp-tier player joins → 200');
  await tick(300);
  check(sse.events.some(e => e.type === 'clan_membership_changed'), 'joiner receives clan_membership_changed');
  sse.close();
  const second = await api(camp.token, 'POST', `/api/clans/invites/${rivalInv.data.invite_id}/accept`);
  check(second.status === 404 || second.status === 409, 'accepting a second clan → rejected');

  // ── Rank matrix ──
  console.log('Ranks');
  const m2 = await player('m2'); const m3 = await player('m3');
  for (const p of [m2, m3]) {
    const i = await api(town.token, 'POST', '/api/clans/invites', { username: p.username });
    await api(p.token, 'POST', `/api/clans/invites/${i.data.invite_id}/accept`);
  }
  const recruitInvite = await api(camp.token, 'POST', '/api/clans/invites', { username: village.username });
  check(recruitInvite.status === 403, 'recruit cannot invite');
  const recruitKick = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/kick`);
  check(recruitKick.status === 403, 'recruit cannot kick');

  // founder: camp → member → officer → leader, not founder
  let p1 = await api(town.token, 'POST', `/api/clans/members/${camp.id}/promote`);
  check(p1.status === 200 && p1.data.rank === 'member', 'recruit → member');
  p1 = await api(town.token, 'POST', `/api/clans/members/${camp.id}/promote`);
  check(p1.data.rank === 'officer', 'member → officer');
  const offInvite = await api(camp.token, 'POST', '/api/clans/invites', { username: village.username });
  check(offInvite.status === 200, 'officer can invite');
  const offKick = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/kick`);
  check(offKick.status === 403, 'officer cannot kick');
  const offPromote = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/promote`);
  check(offPromote.status === 403, 'officer cannot manage ranks');
  p1 = await api(town.token, 'POST', `/api/clans/members/${camp.id}/promote`);
  check(p1.data.rank === 'leader', 'officer → leader');
  p1 = await api(town.token, 'POST', `/api/clans/members/${camp.id}/promote`);
  check(p1.status === 403, 'leader cannot be promoted to founder');

  // leader acting on others
  const lp = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/promote`);
  check(lp.status === 200 && lp.data.rank === 'member', 'leader promotes recruit → member');
  await api(camp.token, 'POST', `/api/clans/members/${m2.id}/promote`);
  const lp3 = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/promote`);
  check(lp3.status === 403, 'leader cannot promote to leader (tops out at rank − 1)');
  const kickFounder = await api(camp.token, 'POST', `/api/clans/members/${town.id}/kick`);
  check(kickFounder.status === 403, 'leader cannot kick the founder');
  const leaderTransfer = await api(camp.token, 'POST', '/api/clans/transfer', { userId: m2.id });
  check(leaderTransfer.status === 403, 'leader cannot transfer leadership');
  const leaderDisband = await api(camp.token, 'POST', '/api/clans/disband');
  check(leaderDisband.status === 403, 'leader cannot disband');
  const demote = await api(camp.token, 'POST', `/api/clans/members/${m2.id}/demote`);
  check(demote.status === 200 && demote.data.rank === 'member', 'leader demotes officer → member');
  const kick = await api(camp.token, 'POST', `/api/clans/members/${m3.id}/kick`);
  check(kick.status === 200, 'leader kicks a recruit');
  check((await me(m3)).data.clan === null, 'kicked player is clanless');

  // edit profile
  const edit = await api(camp.token, 'PATCH', '/api/clans/profile', { description: 'Rooted.', banner: { emblem: 'leaf', primary: 'river', secondary: 'fox' } });
  check(edit.status === 200, 'leader edits profile');
  const editLocked = await api(camp.token, 'PATCH', '/api/clans/profile', { banner: { emblem: 'crown', primary: 'river', secondary: 'fox' } });
  check(editLocked.status === 400, 'level-3 emblem rejected at level 1');
  const memEdit = await api(m2.token, 'PATCH', '/api/clans/profile', { description: 'nope' });
  check(memEdit.status === 403, 'member cannot edit profile');

  // ── Founder lifecycle ──
  console.log('Founder lifecycle');
  const founderLeave = await api(town.token, 'POST', '/api/clans/leave');
  check(founderLeave.status === 400, 'founder cannot leave with members');
  const transfer = await api(town.token, 'POST', '/api/clans/transfer', { userId: m2.id });
  check(transfer.status === 200, 'transfer to a member without a hall → 200');
  const founders = (await pool.query(
    "SELECT user_id FROM clan_members WHERE clan_id = $1 AND rank = 'founder'", [founded.data.clan_id])).rows;
  check(founders.length === 1 && founders[0].user_id === m2.id, 'exactly one founder, the new one');
  const oldRank = (await me(town)).data.me.rank;
  check(oldRank === 'leader', 'old founder is now a leader');
  const leaveOk = await api(town.token, 'POST', '/api/clans/leave');
  check(leaveOk.status === 200, 'old founder can now leave');

  // Sole-member leave disbands.
  const soloLeave = await api(racers.find((_, i) => race[i].status === 200).token, 'POST', '/api/clans/leave');
  check(soloLeave.status === 200 && soloLeave.data.disbanded === true, 'sole founder leaving disbands');

  // ── Member cap under concurrency ──
  console.log('Concurrency');
  const capClanId = rival.data.clan_id;
  // Fill to cap − 1 directly, then race three accepts for the last slot.
  const filler = [];
  for (let i = 0; i < 8; i++) filler.push(await player(`fill${i}`));
  for (const p of filler) {
    await pool.query("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'recruit')", [p.id, capClanId]);
  }
  const hopefuls = await Promise.all([1, 2, 3].map(i => player(`hope${i}`)));
  const ids = [];
  for (const p of hopefuls) {
    const i = await api(founder2.token, 'POST', '/api/clans/invites', { username: p.username });
    ids.push(i.data.invite_id);
  }
  // Count now: founder + 8 = 9; cap 10.
  const accepts = await Promise.all(hopefuls.map((p, i) => api(p.token, 'POST', `/api/clans/invites/${ids[i]}/accept`)));
  check(accepts.filter(a => a.status === 200).length === 1, 'three accepts for the last slot → exactly one joins');
  const count = (await pool.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [capClanId])).rows[0].n;
  check(count === 10, 'clan is at exactly its member cap');

  // ── Disband cascade ──
  console.log('Disband');
  const dis = await api(m2.token, 'POST', '/api/clans/disband');
  check(dis.status === 200, 'founder disbands');
  const left = await pool.query(
    `SELECT (SELECT COUNT(*) FROM clan_members WHERE clan_id = $1)::int
          + (SELECT COUNT(*) FROM clan_invites WHERE clan_id = $1)::int
          + (SELECT COUNT(*) FROM clan_activity WHERE clan_id = $1)::int AS n`, [founded.data.clan_id]);
  check(left.rows[0].n === 0, 'disband cascades members, invites, activity');

  // ── Regenerate ──
  console.log('Regenerate');
  const unauth = await api(null, 'POST', '/api/game/world/regenerate', { w: 12, h: 12 });
  check(unauth.status === 401, 'regenerate unauthenticated → 401');
  const nonAdmin = await api(m3.token, 'POST', '/api/game/world/regenerate', { w: 12, h: 12 });
  check(nonAdmin.status === 403, 'regenerate as non-admin → 403');
  const restoreNonAdmin = await api(m3.token, 'POST', '/api/game/world/restore');
  check(restoreNonAdmin.status === 403, 'restore as non-admin → 403');

  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(Number);
  const admin = adminIds.length ? (await pool.query('SELECT id FROM users WHERE id = $1', [adminIds[0]])).rows[0] : null;
  if (!admin) {
    console.log('  skip  admin regenerate checks (set ADMIN_USER_IDS for this script and the server)');
  } else {
    const jwt = require('jsonwebtoken');
    const adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET || 'dev-secret-change-in-production');
    const halls = (await pool.query("SELECT COUNT(*)::int AS n FROM buildings WHERE type = 'guild_hall'")).rows[0].n;
    const regen = await api(adminToken, 'POST', '/api/game/world/regenerate', { w: 12, h: 12, seed: 7 });
    check(regen.status === 200 && regen.data.clans_wiped === true, 'admin regenerate → 200, clans wiped');
    const n = (await pool.query('SELECT (SELECT COUNT(*) FROM clans)::int + (SELECT COUNT(*) FROM clan_members)::int AS n')).rows[0].n;
    check(n === 0, 'no clans or members remain');
    const halls2 = (await pool.query("SELECT COUNT(*)::int AS n FROM buildings WHERE type = 'guild_hall'")).rows[0].n;
    check(halls2 === halls, 'guild halls survive regenerate');
    const restore = await api(adminToken, 'POST', '/api/game/world/restore');
    const n2 = (await pool.query('SELECT COUNT(*)::int AS n FROM clans')).rows[0].n;
    check(restore.status === 200 && n2 === 0, 'restore does not bring clans back');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}

main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
