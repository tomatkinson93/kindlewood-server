// scripts/clan_phase5_test.js — checks for spec 016 Phase 5 (public clan
// profile, presence, recruiting flag, member titles, clan on player
// profiles). Drives a running server over HTTP (same DATABASE_URL).
// Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_phase5_test.js

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
  console.log(`Clan Phase 5 tests against ${BASE} (run ${RUN})`);
  const F = await player('founder', { hall: true });
  const founded = await api(F.token, 'POST', '/api/clans', { name: `Glade ${RUN}`, description: 'We tend the old glade.',
    banner: { emblem: 'leaf', primary: 'moss', secondary: 'wheat' } });
  const clanId = founded.data.clan_id;
  const O = await player('officer'), M = await player('member'), X = await player('outsider');
  for (const p of [O, M]) await join(F, p);
  await q("UPDATE clan_members SET rank = 'officer' WHERE user_id = $1", [O.id]);
  await q("UPDATE clan_members SET rank = 'member' WHERE user_id = $1", [M.id]);

  console.log('Public profile');
  const pub = await api(X.token, 'GET', `/api/clans/${clanId}`);
  check(pub.status === 200 && pub.data.clan.name === `Glade ${RUN}` && pub.data.clan.description === 'We tend the old glade.', 'an outsider opens the public profile');
  check(pub.data.clan.prestige === undefined && pub.data.clan.prestige_lifetime === 0, 'spendable prestige stays private; lifetime is public');
  check(pub.data.roster.length === 3 && pub.data.roster[0].rank === 'founder' && pub.data.roster[0].username === F.username, 'roster, founder first');
  check(pub.data.clan.founder === F.username && pub.data.clan.member_cap === 10, 'founder and member cap');
  check(pub.data.clan.territory.count === 1 && pub.data.clan.territory.hq && pub.data.clan.territory.hq.name, 'territory count and HQ settlement');
  check(pub.data.clan.standing >= 1 && pub.data.clan.clan_count >= pub.data.clan.standing, 'standing on the prestige board');
  check(pub.data.milestones.some(m => m.type === 'clan_founded'), 'milestones include the founding');
  check(pub.data.honors && pub.data.honors.live === false, 'honors stubbed (CLAN_HONORS_LIVE = false)');
  check(pub.data.viewer.member === false && (await api(M.token, 'GET', `/api/clans/${clanId}`)).data.viewer.member === true, 'viewer.member');
  check(!('permissions' in pub.data) && !('outgoing_invites' in pub.data), 'no private panel data');
  check((await api(X.token, 'GET', '/api/clans/99999999')).status === 404, 'unknown clan → 404');
  check((await api(null, 'GET', `/api/clans/${clanId}`)).status === 401, 'needs sign-in');
  check((await api(X.token, 'GET', '/api/clans/me')).data.clan === null, '/me still routes to the panel endpoint');
  check((await api(X.token, 'GET', '/api/clans/leaderboard')).status === 200, '/leaderboard still routes');

  console.log('Presence');
  const sm = listen(M);
  await tick(500);
  const withOnline = (await api(X.token, 'GET', `/api/clans/${clanId}`)).data.roster;
  check(withOnline.find(m => m.user_id === M.id).online === true && withOnline.find(m => m.user_id === O.id).online === false, 'online = open stream');
  sm.close();
  await tick(400);
  const me = (await api(F.token, 'GET', '/api/clans/me')).data.roster.find(m => m.user_id === M.id);
  check(me.online === false && me.last_seen_at, 'last seen recorded when the stream closes');

  console.log('Recruiting');
  check((await api(M.token, 'PATCH', '/api/clans/profile', { recruiting: true })).status === 403, 'members cannot edit the profile');
  check((await api(F.token, 'PATCH', '/api/clans/profile', { recruiting: true })).status === 200, 'founder flags the clan as recruiting');
  check((await api(X.token, 'GET', `/api/clans/${clanId}`)).data.clan.recruiting === true, 'recruiting shows on the public profile');

  console.log('Member titles');
  const early = await api(F.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: 'Quartermaster' });
  check(early.status === 403 && early.data.unlock_level === 5, 'titles locked below level 5');
  await setLevel(clanId, 5);
  check((await api(M.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: 'Self-made' })).status === 403, 'members cannot title themselves');
  check((await api(O.token, 'PATCH', `/api/clans/members/${F.id}/title`, { title: 'Old Root' })).status === 403, 'officers cannot title the founder');
  const sf = listen(F);
  await tick(400);
  const t1 = await api(F.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: '  Quartermaster  ' });
  check(t1.status === 200 && t1.data.title === 'Quartermaster', 'founder titles a member (trimmed)');
  await tick(300);
  check(sf.events.some(e => e.type === 'clan_member_updated' && e.user_id === M.id), 'clan channel told about the title');
  sf.close();
  check((await api(F.token, 'PATCH', `/api/clans/members/${F.id}/title`, { title: 'Keeper of the Glade' })).status === 200, 'founder titles themselves');
  check((await api(F.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: '<b>x</b>' })).status === 400, 'titles are validated');
  check((await api(F.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: 'x'.repeat(25) })).status === 400, 'title length capped');
  const r2 = (await api(X.token, 'GET', `/api/clans/${clanId}`)).data.roster;
  check(r2.find(m => m.user_id === M.id).title === 'Quartermaster', 'title on the public roster');
  const prof = await api(X.token, 'GET', `/api/auth/profile/${M.username}`);
  check(prof.data.clan && prof.data.clan.id === clanId && prof.data.clan.title === 'Quartermaster' && prof.data.clan.rank_label, 'player profile carries clan, rank and title');
  check((await api(X.token, 'GET', `/api/auth/profile/${X.username}`)).data.clan === null, 'clanless profile → clan null');
  const act = (await api(F.token, 'GET', '/api/clans/activity')).data.activity;
  check(act.some(a => a.type === 'title_changed' && a.payload.title === 'Quartermaster'), 'title change logged');
  check((await api(F.token, 'PATCH', `/api/clans/members/${M.id}/title`, { title: '' })).status === 200, 'empty clears a title');

  console.log('Chat tags link to the clan');
  await setLevel(clanId, 5);
  const chs = (await api(M.token, 'GET', '/api/chat/channels')).data.channels;
  const rc = chs.find(c => c.slug === 'realm-chat');
  if (rc) {
    const m = await api(M.token, 'POST', `/api/chat/channels/${rc.id}/messages`, { body: 'hello from the glade' });
    check(m.data.message.author_clan && m.data.message.author_clan.id === clanId, 'live chat clan tag carries the clan id');
    const h = (await api(X.token, 'GET', `/api/chat/channels/${rc.id}/messages`)).data.messages.find(x => x.id === m.data.message.id);
    check(h && h.author_clan.id === clanId, 'history clan tag carries the clan id');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
