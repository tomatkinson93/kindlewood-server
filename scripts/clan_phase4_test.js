// scripts/clan_phase4_test.js — checks for spec 016 Phase 4 (Chat hub:
// level gates, forum, live chat, backlog, catch-up, SSE). Drives a running
// server over HTTP (same DATABASE_URL). Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_phase4_test.js

'use strict';

const { Pool } = require('pg');
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
    WHERE user_id = $1 RETURNING id`, [u.id, seq % 40, Math.floor(seq / 40) % 40])).rows[0];
  if (hall) await q("INSERT INTO buildings (settlement_id,type,level) VALUES ($1,'guild_hall',1)", [s.id]);
  return { username, token: r.data.token, id: u.id };
}
async function join(founder, p) {
  const i = await api(founder.token, 'POST', '/api/clans/invites', { username: p.username });
  await api(p.token, 'POST', `/api/clans/invites/${i.data.invite_id}/accept`);
}
const setLevel = (clanId, level) => q('UPDATE clans SET level = $2 WHERE id = $1', [clanId, level]);
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
  console.log(`Clan Phase 4 tests against ${BASE} (run ${RUN})`);
  const F = await player('founder', { hall: true });
  const founded = await api(F.token, 'POST', '/api/clans', { name: `Hall ${RUN}`, banner: { emblem: 'acorn', primary: 'moss', secondary: 'wheat' } });
  const clanId = founded.data.clan_id;
  const O = await player('officer'), M = await player('member'), R = await player('recruit'), X = await player('outsider');
  for (const p of [O, M, R]) await join(F, p);
  await q("UPDATE clan_members SET rank = 'officer' WHERE user_id = $1", [O.id]);
  await q("UPDATE clan_members SET rank = 'member' WHERE user_id = $1", [M.id]);

  console.log('Channel & gates');
  const chs = await api(M.token, 'GET', '/api/chat/channels');
  const clanChs = chs.data.channels.filter(c => c.kind === 'clan');
  const ch = clanChs[0];
  check(chs.status === 200 && clanChs.length === 1 && ch.clan_id === clanId, 'founding created the clan channel');
  check(ch.forum.unlocked === false && ch.chat.unlocked === false, 'level 1: forum and chat locked');
  const f1 = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/threads`);
  check(f1.status === 403 && f1.data.locked === true && f1.data.unlock_level === 2, 'level 1: forum → 403 locked, unlock_level 2');
  const c1 = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages`);
  check(c1.status === 403 && c1.data.unlock_level === 4, 'level 1: chat → 403 locked, unlock_level 4');
  await setLevel(clanId, 2);
  check((await api(M.token, 'GET', `/api/chat/channels/${ch.id}/threads`)).status === 200, 'level 2: forum → 200');
  check((await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages`)).status === 403, 'level 2: chat still → 403');
  await setLevel(clanId, 4);
  const c4 = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages`);
  check(c4.status === 200, 'level 4: chat → 200');
  check(c4.data.messages.some(m => m.system && /founded/.test(m.body)) && c4.data.messages.some(m => m.system && /joined/.test(m.body)),
    'backlog already holds system lines from founding onward');
  check((await api(X.token, 'GET', `/api/chat/channels/${ch.id}/threads`)).status === 403, 'non-member → 403 on the forum');
  check((await api(X.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: 'hi' })).status === 403, 'non-member → 403 on chat');
  check((await api(X.token, 'GET', '/api/chat/channels')).data.channels.every(c => c.kind === 'global'), 'non-member sees no clan channel (only realm channels)');

  console.log('Forum');
  const badT = await api(M.token, 'POST', `/api/chat/channels/${ch.id}/threads`, { title: 'hi', body: 'x' });
  check(badT.status === 400, 'title under 3 chars → 400');
  const t1 = await api(M.token, 'POST', `/api/chat/channels/${ch.id}/threads`, { title: 'Harvest plans', body: 'Who is farming?' });
  check(t1.status === 200, 'member starts a thread');
  const recT = await api(R.token, 'POST', `/api/chat/channels/${ch.id}/threads`, { title: 'Hello all', body: 'new here' });
  check(recT.status === 403, 'recruit cannot start a thread');
  check((await api(R.token, 'POST', `/api/chat/threads/${t1.data.thread_id}/posts`, { body: 'me!' })).status === 403, 'recruit cannot reply');
  check((await api(R.token, 'GET', `/api/chat/threads/${t1.data.thread_id}/posts`)).status === 200, 'recruit can read');
  const rep = await api(O.token, 'POST', `/api/chat/threads/${t1.data.thread_id}/posts`, { body: 'I am.' });
  check(rep.status === 200, 'officer replies');
  const t2 = await api(F.token, 'POST', `/api/chat/channels/${ch.id}/threads`, { title: 'Clan rules', body: 'Be kind.' });
  check((await api(M.token, 'POST', `/api/chat/threads/${t2.data.thread_id}/pin`, { pinned: true })).status === 403, 'member cannot pin');
  check((await api(O.token, 'POST', `/api/chat/threads/${t2.data.thread_id}/pin`, { pinned: true })).status === 200, 'officer pins');
  const list = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/threads`);
  check(list.data.threads[0].id === t2.data.thread_id && list.data.threads[0].pinned, 'pinned thread listed first');
  check(list.data.threads.find(t => t.id === t1.data.thread_id).reply_count === 1, 'reply_count counts replies');
  const view = await api(M.token, 'GET', `/api/chat/threads/${t1.data.thread_id}/posts`);
  const [opening, reply] = view.data.posts;
  check(view.data.posts.length === 2 && view.data.thread.first_post_id === opening.id, 'thread view: opening post + reply');
  check((await api(M.token, 'PATCH', `/api/chat/posts/${opening.id}`, { body: 'Who is farming this week?' })).status === 200, 'author edits own post');
  check((await api(M.token, 'PATCH', `/api/chat/posts/${reply.id}`, { body: 'hacked' })).status === 403, "member cannot edit another's post");
  check((await api(M.token, 'DELETE', `/api/chat/posts/${opening.id}`)).status === 400, 'deleting the opening post → 400 (delete the thread)');
  check((await api(M.token, 'DELETE', `/api/chat/threads/${t1.data.thread_id}`)).status === 403, 'author cannot delete a thread that has replies');
  check((await api(O.token, 'DELETE', `/api/chat/posts/${reply.id}`)).status === 200, 'author (officer) deletes own reply');
  check((await api(M.token, 'DELETE', `/api/chat/threads/${t1.data.thread_id}`)).status === 200, 'author deletes own thread once it has no replies');
  const t3 = await api(M.token, 'POST', `/api/chat/channels/${ch.id}/threads`, { title: 'Spam?', body: 'hmm' });
  check((await api(O.token, 'DELETE', `/api/chat/threads/${t3.data.thread_id}`)).status === 200, 'moderator deletes any thread');

  console.log('Live chat');
  const sm = listen(M), sx = listen(X);
  await tick(400);
  const long = await api(R.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: 'x'.repeat(501) });
  check(long.status === 400, 'chat line over 500 chars → 400');
  const sent = await api(R.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: 'Hello from a recruit' });
  check(sent.status === 200 && sent.data.message.author === R.username, 'recruit can chat');
  await tick(400);
  check(sm.events.some(e => e.type === 'clan_chat' && e.message.body === 'Hello from a recruit'), 'clanmate receives clan_chat inline');
  check(!sx.events.some(e => String(e.type).startsWith('clan_')), 'non-member receives nothing');
  check(sm.events.length > 0 && !sm.events.some(e => e.type === 'clan_forum_updated' && e.clan_id !== clanId), 'events are scoped to this clan');

  // Catch-up: everything after a known id, exactly.
  const lastSeen = sent.data.message.id;
  for (const t of ['one', 'two', 'three']) await api(O.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: t });
  const gap = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages?after=${lastSeen}`);
  check(gap.data.messages.map(m => m.body).join() === 'one,two,three', '?after= returns exactly the gap, oldest first');

  // Rate limit: 5 lines / 10 s → the 6th is refused.
  const burst = [];
  for (let i = 0; i < 6; i++) burst.push((await api(F.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: 'spam ' + i })).status);
  check(burst.slice(0, 5).every(s => s === 200) && burst[5] === 429, 'rate limit trips on the 6th line in 10 s');

  // Moderation
  check((await api(M.token, 'DELETE', `/api/chat/messages/${lastSeen}`)).status === 403, 'member cannot delete chat lines');
  check((await api(O.token, 'DELETE', `/api/chat/messages/${lastSeen}`)).status === 200, 'officer removes a chat line');
  await tick(300);
  check(sm.events.some(e => e.type === 'clan_chat_deleted' && e.message_id === lastSeen), 'deletion is broadcast');

  // Backlog prune: fill past 250 directly, then one more send prunes to 200.
  await q(`INSERT INTO chat_messages (channel_id, author_user_id, body)
           SELECT $1, $2, 'filler ' || g FROM generate_series(1, 260) g`, [ch.id, M.id]);
  await api(M.token, 'POST', `/api/chat/channels/${ch.id}/messages`, { body: 'trigger prune' });
  await tick(500);
  const n = (await q('SELECT COUNT(*)::int AS n FROM chat_messages WHERE channel_id = $1', [ch.id])).rows[0].n;
  check(n === 200, `backlog prunes to the newest 200 (now ${n})`);
  const newest = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages`);
  check(newest.data.messages.length === 50 && newest.data.messages[49].body === 'trigger prune' && newest.data.more, 'default page is the newest 50, oldest first');
  const older = await api(M.token, 'GET', `/api/chat/channels/${ch.id}/messages?before=${newest.data.messages[0].id}`);
  check(older.data.messages.length === 50 && older.data.messages[49].id < newest.data.messages[0].id, '?before= pages further back');

  console.log('Level-up & disband');
  await q('UPDATE clans SET level = 1, prestige_lifetime = 0 WHERE id = $1', [clanId]);
  const cheat = await api(F.token, 'POST', '/api/clans/cheat/prestige', { amount: 500 });
  await tick(400);
  check(cheat.data.leveledTo === 2 || cheat.data.level === 2, 'cheat levels the clan to 2');
  const sys = await q("SELECT body FROM chat_messages WHERE channel_id = $1 AND author_user_id IS NULL ORDER BY id DESC LIMIT 1", [ch.id]);
  check(/level 2/.test(sys.rows[0].body), 'level-up writes a system line');
  await api(F.token, 'POST', '/api/clans/disband');
  const left = (await q(
    `SELECT (SELECT COUNT(*) FROM chat_channels WHERE id = $1)::int
          + (SELECT COUNT(*) FROM chat_messages WHERE channel_id = $1)::int
          + (SELECT COUNT(*) FROM forum_threads WHERE channel_id = $1)::int AS n`, [ch.id])).rows[0].n;
  check(left === 0, 'disband cascades channel, threads, posts, messages');

  sm.close(); sx.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
