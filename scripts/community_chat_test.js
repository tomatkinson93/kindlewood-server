// scripts/community_chat_test.js — realm-wide boards + Realm Chat in the Chat
// hub. Drives a running server over HTTP (same DATABASE_URL). The server
// must run with ADMIN_USER_IDS containing user id 1 (the script signs an
// admin token for it). Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… JWT_SECRET=… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/community_chat_test.js

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
  console.log(`Community chat tests against ${BASE} (run ${RUN})`);
  // Admin = user 1 (ensure it exists).
  let adminRow = (await q('SELECT id, username FROM users WHERE id = 1')).rows[0];
  if (!adminRow) { await player('admin'); adminRow = (await q('SELECT id, username FROM users WHERE id = 1')).rows[0]; }
  const ADMIN = { id: 1, token: jwt.sign({ userId: 1, username: adminRow.username }, process.env.JWT_SECRET || 'dev-secret-change-in-production') };

  const A = await player('ann'), B = await player('bob'), C = await player('clanny', { hall: true });
  const clan = await api(C.token, 'POST', '/api/clans', { name: `Fern ${RUN}`, banner: { emblem: 'leaf', primary: 'river', secondary: 'wheat' } });
  if (clan.status !== 200) console.log('  (founding failed:', clan.status, JSON.stringify(clan.data), ')');

  console.log('Channels');
  const list = await api(A.token, 'GET', '/api/chat/channels');
  const g = list.data.channels.filter(c => c.kind === 'global');
  const by = slug => g.find(c => c.slug === slug);
  check(['announcements', 'general', 'trade', 'help', 'suggestions', 'tavern', 'realm-chat'].every(s => by(s)), 'all seven realm channels listed');
  check(g[0].slug === 'realm-chat', 'ordered by sort_order (Realm Chat first)');
  check(by('announcements').permissions.post_forum === false && by('general').permissions.post_forum === true, 'announcements: threads staff-only for players');
  check((await api(ADMIN.token, 'GET', '/api/chat/channels')).data.admin === true, 'admin flagged for ADMIN_USER_IDS');
  const clanList = await api(C.token, 'GET', '/api/chat/channels');
  check(clanList.data.channels[0].kind === 'clan' && clanList.data.channels.filter(c => c.kind === 'global').length === 7,
    'clan members see their hall first, then the realm');

  console.log('Boards');
  const gen = by('general'), ann = by('announcements'), chat = by('realm-chat');
  const t = await api(A.token, 'POST', `/api/chat/channels/${gen.id}/threads`, { title: 'Hello realm', body: 'First post!' });
  check(t.status === 200, 'any player starts a General thread');
  const r1 = await api(C.token, 'POST', `/api/chat/threads/${t.data.thread_id}/posts`, { body: 'Welcome!' });
  check(r1.status === 200, 'another player replies');
  const view = await api(B.token, 'GET', `/api/chat/threads/${t.data.thread_id}/posts`);
  check(view.data.posts[1].author_clan && view.data.posts[1].author_clan.name === `Fern ${RUN}`, "posts carry the author's clan tag");
  check(view.data.posts[0].author_clan === null, 'clanless authors have no tag');
  const a1 = await api(A.token, 'POST', `/api/chat/channels/${ann.id}/threads`, { title: 'I am the news', body: 'nope' });
  check(a1.status === 403 && /team/.test(a1.data.error), 'player cannot start an Announcements thread');
  const a2 = await api(ADMIN.token, 'POST', `/api/chat/channels/${ann.id}/threads`, { title: `Patch notes ${RUN}`, body: 'Clans are here.' });
  check(a2.status === 200, 'admin posts an announcement');
  check((await api(B.token, 'POST', `/api/chat/threads/${a2.data.thread_id}/posts`, { body: 'Hooray!' })).status === 200, 'players can reply to announcements');
  check((await api(A.token, 'POST', `/api/chat/threads/${t.data.thread_id}/pin`, { pinned: true })).status === 403, 'player cannot pin');
  check((await api(ADMIN.token, 'POST', `/api/chat/threads/${a2.data.thread_id}/pin`, { pinned: true })).status === 200, 'admin pins');
  check((await api(B.token, 'DELETE', `/api/chat/posts/${r1.data.post_id}`)).status === 403, "player cannot delete another's post");
  check((await api(ADMIN.token, 'DELETE', `/api/chat/posts/${r1.data.post_id}`)).status === 200, 'admin moderates any post');
  check((await api(A.token, 'GET', `/api/chat/channels/${chat.id}/threads`)).status === 404, 'Realm Chat has no forum → 404');
  check((await api(A.token, 'GET', `/api/chat/channels/${gen.id}/messages`)).status === 404, 'a board has no live chat → 404');

  console.log('Realm Chat');
  const sb = listen(B);
  await tick(400);
  const m = await api(C.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'Anyone trading stone?' });
  check(m.status === 200 && m.data.message.author_clan && m.data.message.author_clan.name === `Fern ${RUN}`, 'clan member chats; message carries clan tag');
  const m2 = await api(A.token, 'POST', `/api/chat/channels/${chat.id}/messages`, { body: 'I have some.' });
  check(m2.status === 200 && m2.data.message.author_clan === null, 'clanless player chats');
  await tick(400);
  const got = sb.events.filter(e => e.type === 'chat_message' && e.channel_id === chat.id).map(e => e.message.body);
  check(got.includes('Anyone trading stone?') && got.includes('I have some.'), 'every player receives Realm Chat lines live');
  const gap = await api(B.token, 'GET', `/api/chat/channels/${chat.id}/messages?after=${m.data.message.id}`);
  check(gap.data.messages.length === 1 && gap.data.messages[0].body === 'I have some.', '?after= catch-up works on Realm Chat');
  check((await api(B.token, 'DELETE', `/api/chat/messages/${m2.data.message.id}`)).status === 403, 'player cannot remove chat lines');
  check((await api(ADMIN.token, 'DELETE', `/api/chat/messages/${m2.data.message.id}`)).status === 200, 'admin removes a chat line');
  await tick(300);
  check(sb.events.some(e => e.type === 'chat_message_deleted' && e.message_id === m2.data.message.id), 'removal broadcast to everyone');

  const t2 = await api(A.token, 'POST', `/api/chat/channels/${by('trade').id}/threads`, { title: 'Selling timber', body: '500 for 200 stone' });
  await tick(300);
  check(sb.events.some(e => e.type === 'forum_updated' && e.thread_id === t2.data.thread_id), 'board updates are broadcast realm-wide');

  console.log('Isolation');
  await q('UPDATE clans SET level = 4 WHERE id = $1', [clan.data.clan_id]);
  const hall = clanList.data.channels.find(c => c.kind === 'clan');
  if (!hall) throw new Error('setup: the clan member has no clan hall');
  await api(C.token, 'POST', `/api/chat/channels/${hall.id}/messages`, { body: 'clan secret' });
  await tick(300);
  check(!sb.events.some(e => e.message && e.message.body === 'clan secret'), 'clan hall lines never reach the realm channel');

  sb.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
