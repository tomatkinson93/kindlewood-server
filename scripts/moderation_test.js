// scripts/moderation_test.js — moderator role, reports, mutes and the audit
// log in the Chat hub. Drives a running server over HTTP (same
// DATABASE_URL). The server must run with ADMIN_USER_IDS containing user id
// 1. Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… JWT_SECRET=… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/moderation_test.js

'use strict';

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, p) => pool.query(t, p);
const RUN = Math.random().toString(36).slice(2, 7);
let passed = 0, failed = 0, seq = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
const tick = ms => new Promise(r => setTimeout(r, ms));
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}
async function player(name, { hall = false } = {}) {
  const username = `${name}${RUN}${seq++}`;
  const r = await api(null, 'POST', '/api/auth/register', { username, email: username + '@t.l', password: 'password123', species: 'Mice' });
  const u = (await q('SELECT id FROM users WHERE username=$1', [username])).rows[0];
  const s = (await q(`UPDATE settlements SET tile_q = $2, tile_r = $3, world_version = 2, tier = 'town', wealth = 9000
    WHERE user_id = $1 RETURNING id`, [u.id, (seq * 3) % 40, (seq * 7) % 40])).rows[0];
  if (hall) await q("INSERT INTO buildings (settlement_id,type,level) VALUES ($1,'guild_hall',1)", [s.id]);
  return { username, token: r.data.token, id: u.id };
}
function listen(p) {
  const events = [], ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(p.token)}`, { signal: ctrl.signal });
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const f = buf.slice(0, i); buf = buf.slice(i + 2);
          if (f.startsWith('data: ')) events.push(JSON.parse(f.slice(6)));
        }
      }
    } catch (_) {}
  })();
  return { events, close: () => ctrl.abort() };
}

async function main() {
  console.log(`Moderation tests against ${BASE} (run ${RUN})`);
  let adminRow = (await q('SELECT id, username FROM users WHERE id = 1')).rows[0];
  if (!adminRow) { await player('admin'); adminRow = (await q('SELECT id, username FROM users WHERE id = 1')).rows[0]; }
  const ADMIN = { id: 1, token: jwt.sign({ userId: 1, username: adminRow.username }, process.env.JWT_SECRET || 'dev-secret-change-in-production') };

  const A = await player('ann'), B = await player('bob'), M = await player('mod'), C = await player('clanny', { hall: true });
  const clan = await api(C.token, 'POST', '/api/clans', { name: `Moss ${RUN}`, banner: { emblem: 'leaf', primary: 'river', secondary: 'wheat' } });
  await q('UPDATE clans SET level = 4 WHERE id = $1', [clan.data.clan_id]);

  console.log('Staff roles');
  const list = (await api(A.token, 'GET', '/api/chat/channels')).data;
  check(list.staff === null && list.muted === null && list.open_reports === 0, 'players are not staff and see no queue');
  check((await api(M.token, 'POST', '/api/chat/staff', { username: A.username, role: 'moderator' })).status === 403, 'non-admins cannot appoint moderators');
  const sm = listen(M);
  await tick(300);
  const g = await api(ADMIN.token, 'POST', '/api/chat/staff', { username: M.username, role: 'moderator' });
  check(g.status === 200 && g.data.role === 'moderator', 'admin appoints a moderator');
  await tick(300);
  check(sm.events.some(e => e.type === 'site_role_changed'), "the new moderator's stream is told to reconnect");
  sm.close();
  const staffList = (await api(ADMIN.token, 'GET', '/api/chat/staff')).data.staff;
  check(staffList.some(s => s.id === M.id && s.role === 'moderator') && staffList.some(s => s.id === 1 && s.role === 'admin'), 'staff list shows admins and moderators');
  check((await api(ADMIN.token, 'POST', '/api/chat/staff', { user_id: 1, role: 'moderator' })).status === 400, 'admins are config-only');
  const mlist = (await api(M.token, 'GET', '/api/chat/channels')).data;
  const by = slug => mlist.channels.find(c => c.slug === slug);
  check(mlist.staff === 'moderator' && by('general').permissions.moderate && by('announcements').permissions.post_forum, 'moderator gets realm moderation + announcements');
  const hallAsC = (await api(C.token, 'GET', '/api/chat/channels')).data.channels.find(c => c.kind === 'clan');

  console.log('Moderator powers');
  const gen = by('general'), chat = by('realm-chat');
  const t = await api(A.token, 'POST', `/api/chat/channels/${gen.id}/threads`, { title: 'Rude thread', body: 'bad words' });
  const reply = await api(B.token, 'POST', `/api/chat/threads/${t.data.thread_id}/posts`, { body: 'more bad words' });
  check((await api(M.token, 'POST', `/api/chat/threads/${t.data.thread_id}/pin`, { pinned: true })).status === 200, 'moderator pins');
  check((await api(M.token, 'DELETE', `/api/chat/posts/${reply.data.post_id}`)).status === 200, 'moderator removes a post');
  const ml = await api(A.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'spam spam' });
  check(ml.data.message.author_staff === null, 'players have no staff badge');
  const mm = await api(M.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'Please keep it civil.' });
  check(mm.data.message.author_staff === 'moderator', 'moderator lines carry the MOD badge');
  const am = await api(ADMIN.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'Hello from the team.' });
  check(am.data.message.author_staff === 'admin', 'admin lines carry the ADMIN badge');
  const hist = (await api(B.token, 'GET', `/api/chat/channels/${chat.id}/messages`)).data.messages;
  check(hist.find(x => x.id === mm.data.message.id).author_staff === 'moderator', 'badge also on history');
  check((await api(M.token, 'DELETE', `/api/chat/messages/${ml.data.message.id}`)).status === 200, 'moderator removes a chat line');
  if (hallAsC) {
    const hm = await api(C.token, 'POST', `/api/chat/channels/${hallAsC.id}/messages`, { body: 'clan business' });
    check((await api(M.token, 'DELETE', `/api/chat/messages/${hm.data.message.id}`)).status === 403, 'site staff cannot moderate a clan hall directly');
  }
  const log = (await api(M.token, 'GET', '/api/chat/mod-log')).data.actions;
  check(['remove_post', 'remove_message', 'pin_thread', 'grant_moderator'].every(a => log.some(x => x.action === a)), 'actions are audited');

  console.log('Reporting');
  const sa = listen(ADMIN);
  await tick(300);
  const bad = await api(A.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'you are all terrible' });
  const bid = bad.data.message.id;
  check((await api(A.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: bid, reason: 'abuse' })).status === 400, 'cannot report your own line');
  check((await api(B.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: bid, reason: 'rude' })).status === 400, 'reason must be from the list');
  const r1 = await api(B.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: bid, reason: 'abuse', note: 'insulting everyone' });
  check(r1.status === 200 && !r1.data.already, 'player reports a line');
  check((await api(B.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: bid, reason: 'abuse' })).data.already === true, 'duplicate report is idempotent');
  await api(C.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: bid, reason: 'inappropriate' });
  await tick(300);
  check(sa.events.some(e => e.type === 'mod_reports' && e.open_reports >= 1), 'staff are notified live');
  check((await api(A.token, 'GET', '/api/chat/reports')).status === 403, 'players cannot see the queue');
  let queue = (await api(M.token, 'GET', '/api/chat/reports')).data;
  const grp = queue.reports.find(x => x.target_type === 'message' && x.target_id === bid);
  check(grp && grp.reports.length === 2 && grp.body === 'you are all terrible' && grp.reported_user.id === A.id, 'queue groups reports on one target with a snapshot');
  check((await api(M.token, 'GET', '/api/chat/channels')).data.open_reports >= 1, 'open count on the channel list');
  if (hallAsC) {
    const hm2 = await api(C.token, 'POST', `/api/chat/channels/${hallAsC.id}/messages`, { body: 'clan line' });
    check((await api(A.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: hm2.data.message.id, reason: 'spam' })).status === 403,
      "cannot report inside another clan's hall");
  }

  console.log('Resolving');
  const res1 = await api(M.token, 'POST', `/api/chat/reports/${grp.id}/resolve`, { action: 'remove_and_mute', mute_hours: 1 });
  check(res1.status === 200 && res1.data.resolved === 2 && res1.data.removed === true, 'remove & mute resolves every report on the target');
  check((await api(ADMIN.token, 'POST', `/api/chat/reports/${grp.id}/resolve`, { action: 'dismiss' })).status === 409, 'second resolution is refused');
  check(!(await api(B.token, 'GET', `/api/chat/channels/${chat.id}/messages`)).data.messages.some(x => x.id === bid), 'the line is gone');
  const muted = await api(A.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'let me talk' });
  check(muted.status === 403 && muted.data.muted === true && /muted/.test(muted.data.error), 'muted player cannot chat');
  check((await api(A.token, 'POST', `/api/chat/channels/${gen.id}/threads`, { title: 'Still here', body: 'hi' })).status === 403, 'muted player cannot start threads');
  check((await api(A.token, 'GET', `/api/chat/channels/${gen.id}/threads`)).status === 200, 'muted player can still read');
  check((await api(A.token, 'GET', '/api/chat/channels')).data.muted.until, 'channel list tells them when the mute ends');
  const resolvedList = (await api(M.token, 'GET', '/api/chat/reports?status=resolved')).data.reports;
  check(resolvedList.some(x => x.target_id === bid && x.status === 'actioned' && x.resolver === M.username), 'resolved history names the moderator');

  // A report on the opening post takes the thread.
  const t2 = await api(B.token, 'POST', `/api/chat/channels/${gen.id}/threads`, { title: 'Buy gold cheap', body: 'visit spam.example' });
  const first = (await api(C.token, 'GET', `/api/chat/threads/${t2.data.thread_id}/posts`)).data.thread.first_post_id;
  await api(C.token, 'POST', '/api/chat/reports', { target_type: 'post', target_id: first, reason: 'spam' });
  queue = (await api(M.token, 'GET', '/api/chat/reports')).data;
  const pg = queue.reports.find(x => x.target_type === 'post' && x.target_id === first);
  check(pg && /Buy gold cheap/.test(pg.body) && pg.thread_title === 'Buy gold cheap', 'post reports show the thread');
  await api(M.token, 'POST', `/api/chat/reports/${pg.id}/resolve`, { action: 'remove' });
  check((await api(C.token, 'GET', `/api/chat/threads/${t2.data.thread_id}/posts`)).status === 404, 'removing the opening post removes the thread');

  // Dismiss leaves content alone.
  const ok = await api(C.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'perfectly fine' });
  await api(B.token, 'POST', '/api/chat/reports', { target_type: 'message', target_id: ok.data.message.id, reason: 'other' });
  const og = (await api(M.token, 'GET', '/api/chat/reports')).data.reports.find(x => x.target_id === ok.data.message.id);
  check((await api(M.token, 'POST', `/api/chat/reports/${og.id}/resolve`, { action: 'dismiss' })).data.removed === false, 'dismiss keeps the content');

  console.log('Mutes');
  check((await api(M.token, 'POST', '/api/chat/mutes', { user_id: 1, hours: 1 })).status === 403, 'nobody mutes an admin');
  check((await api(M.token, 'POST', '/api/chat/mutes', { username: M.username, hours: 1 })).status === 400, 'cannot mute yourself');
  const mb = await api(M.token, 'POST', '/api/chat/mutes', { username: B.username, hours: 0, reason: 'cool off' });
  check(mb.status === 200 && mb.data.until === null, 'indefinite mute by name');
  const mutes = (await api(M.token, 'GET', '/api/chat/mutes')).data.mutes;
  check(mutes.some(x => x.user_id === B.id) && mutes.some(x => x.user_id === A.id), 'active mutes listed');
  if (hallAsC) {
    await api(M.token, 'POST', '/api/chat/mutes', { username: C.username, hours: 1 });
    check((await api(C.token, 'POST', `/api/chat/channels/${hallAsC.id}/messages`, { body: 'still fine here' })).status === 200, 'mutes do not reach clan halls');
    await api(M.token, 'DELETE', `/api/chat/mutes/${C.id}`);
  }
  check((await api(M.token, 'DELETE', `/api/chat/mutes/${B.id}`)).status === 200, 'lift a mute');
  check((await api(B.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'thanks' })).status === 200, 'unmuted player chats again');
  await q("UPDATE user_mutes SET until = NOW() - INTERVAL '1 minute' WHERE user_id = $1", [A.id]);
  check((await api(A.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'back' })).status === 200, 'expired mutes lapse on their own');

  console.log('Revoking');
  await api(ADMIN.token, 'POST', '/api/chat/staff', { username: M.username, role: 'player' });
  check((await api(M.token, 'GET', '/api/chat/reports')).status === 403, 'revoked moderator loses the queue');
  check((await api(M.token, 'GET', '/api/chat/mod-log')).status === 403, 'and the log');

  sa.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
