// ══════════════════════════════════════════════════════════════════════════
//  mail_test — letters between players, blocks, mutes, and abuse reports
//  that land in the moderators' queue (routes/mail.js, routes/chat.js).
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/mail_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.MARKET_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function user(name, forceId) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET email = users.email RETURNING id, username", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id, username", [username, `${username}@t.l`])).rows[0];
    if (!forceId) await q("INSERT INTO settlements (user_id, name, world_version, last_tick) VALUES ($1,$2,2,NOW())", [u.id, username]);
    return { id: u.id, username: u.username, token: jwt.sign({ userId: u.id, username: u.username, species: 'Mice' }, SECRET) };
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  const a = await user('mailA'), b = await user('mailB'), c = await user('mailC');

  console.log('Sending and reading');
  let r = await api(a, 'POST', '/api/mail', { to: b.username, subject: 'Hello', body: 'Fancy some copper?' });
  check(r.status === 200 && r.body.letter.to.username === b.username, 'a letter goes to a player by name');
  const id = r.body.letter.id;
  r = await api(b, 'GET', '/api/mail');
  check(r.body.letters.length === 1 && r.body.letters[0].subject === 'Hello' && r.body.letters[0].from.username === a.username && !r.body.letters[0].read && r.body.unread === 1, 'it arrives unread in their inbox');
  check((await api(b, 'GET', '/api/mail/unread')).body.unread === 1, 'the unread count for the badge');
  r = await api(a, 'GET', '/api/mail?box=sent');
  check(r.body.letters.length === 1 && r.body.letters[0].mine, 'and shows in the sender\'s Sent box');
  check((await api(b, 'POST', `/api/mail/${id}/read`)).status === 200 && (await api(b, 'GET', '/api/mail/unread')).body.unread === 0, 'reading it clears the badge');
  check((await api(c, 'GET', '/api/mail')).body.letters.length === 0 && (await api(c, 'POST', `/api/mail/${id}/read`)).status === 404
    && (await api(c, 'DELETE', `/api/mail/${id}`)).status === 404, 'nobody else can see, read or delete it');
  check((await api(a, 'POST', '/api/mail', { to: a.username, body: 'me' })).status === 400, 'no letters to yourself');
  check((await api(a, 'POST', '/api/mail', { to: 'nobody_' + RUN, body: 'hi' })).status === 404, 'an unknown name is refused');
  check((await api(a, 'POST', '/api/mail', { to: b.username, body: '  ' })).status === 400 && (await api(a, 'POST', '/api/mail', { to: b.username, body: 'x'.repeat(2001) })).status === 400, 'empty or over-long letters are refused');

  console.log('Deleting');
  await api(b, 'DELETE', `/api/mail/${id}`);
  check((await api(b, 'GET', '/api/mail')).body.letters.length === 0 && (await api(a, 'GET', '/api/mail?box=sent')).body.letters.length === 1, 'deleting removes only your own copy');

  console.log('Blocks and mutes');
  check((await api(b, 'POST', '/api/mail/block', { username: a.username })).status === 200, 'block a sender');
  r = await api(a, 'POST', '/api/mail', { to: b.username, body: 'again' });
  check(r.status === 403 && /aren't accepting/.test(r.body.error), 'their letters are refused');
  check((await api(b, 'GET', '/api/mail/blocks')).body.blocked.some(x => x.id === a.id), 'the block list shows them');
  await api(b, 'DELETE', `/api/mail/block/${a.id}`);
  check((await api(a, 'POST', '/api/mail', { to: b.username, body: 'friends again?' })).status === 200, 'unblocking lets letters through');
  await q("INSERT INTO user_mutes (user_id, reason, until) VALUES ($1,'test', NOW() + interval '1 hour') ON CONFLICT (user_id) DO UPDATE SET until = EXCLUDED.until", [c.id]);
  r = await api(c, 'POST', '/api/mail', { to: b.username, body: 'spam' });
  check(r.status === 403 && /muted/.test(r.body.error), 'a muted player can\'t send letters');
  await q('DELETE FROM user_mutes WHERE user_id = $1', [c.id]);
  await q("INSERT INTO mail_messages (sender_user_id, recipient_user_id, body) SELECT $1, $2, 'flood' FROM generate_series(1, 20)", [c.id, b.id]);
  check((await api(c, 'POST', '/api/mail', { to: b.username, body: 'one more' })).status === 429, '20 letters an hour, then a pause');

  console.log('Reporting abuse');
  const bad = (await api(a, 'POST', '/api/mail', { to: b.username, subject: 'Rude', body: 'Something abusive' })).body.letter.id;
  check((await api(a, 'POST', `/api/mail/${bad}/report`, { reason: 'abuse' })).status === 404, 'only the recipient can report a letter');
  check((await api(b, 'POST', `/api/mail/${bad}/report`, { reason: 'nonsense' })).status === 400, 'a report needs a real reason');
  r = await api(b, 'POST', `/api/mail/${bad}/report`, { reason: 'abuse', note: 'not nice' });
  check(r.status === 200 && !r.body.already, 'the recipient reports it');
  check((await api(b, 'POST', `/api/mail/${bad}/report`, { reason: 'abuse' })).body.already === true, 'reporting twice doesn\'t pile up');
  const rep = (await q("SELECT * FROM chat_reports WHERE target_type = 'mail' AND target_id = $1", [bad])).rows[0];
  check(rep && rep.reported_user_id === a.id && /Something abusive/.test(rep.snapshot_body) && rep.status === 'open', 'it lands in the moderators\' queue with a copy of the letter');
  if (ADMIN) {
    const adm = await user('mailadm', ADMIN);
    r = await api(adm, 'GET', '/api/chat/reports');
    const g = (r.body.reports || []).find(x => x.target_type === 'mail' && x.target_id === bad);
    check(g && g.channel.kind === 'mail' && g.still_there === true && g.reported_user.id === a.id, 'moderators see it as a letter, with who sent it');
    r = await api(adm, 'POST', `/api/chat/reports/${g.id}/resolve`, { action: 'remove_and_mute', mute_hours: 2 });
    check(r.status === 200 && r.body.removed === true, 'remove + mute');
    const after = (await api(b, 'GET', '/api/mail')).body.letters.find(x => x.id === bad);
    check(after && after.removed && after.body === '' && after.subject === '', 'the letter now reads "removed by a moderator"');
    check((await api(a, 'POST', '/api/mail', { to: b.username, body: 'ha' })).status === 403, 'and the muted sender can\'t send more');
    await q('DELETE FROM user_mutes WHERE user_id = $1', [a.id]);
  } else console.log('  (moderator checks skipped — set CRAFTING_TEST_ADMIN_ID)');

  await pool.end();
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(skipped — set DATABASE_URL and CRAFTING_TEST_BASE)'); console.log('\n0 passed, 0 failed'); return; }
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
