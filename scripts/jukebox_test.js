#!/usr/bin/env node
// The jukebox's ratings (routes/jukebox.js): public, no sign-in, hard to misuse.
//   QUEST_TEST_BASE=http://localhost:3998 CRAFTING_TEST_ADMIN_ID=<an admin's user id> node scripts/jukebox_test.js
'use strict';
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const R = require('../routes/jukebox')._test;
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };

async function main() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000', adminId = Number(process.env.CRAFTING_TEST_ADMIN_ID) || 0;
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const call = async (method, p, body, uid) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: 'Bearer ' + jwt.sign({ userId: uid, username: 't', species: 'Mice' }, secret) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const run = Date.now().toString(36), track = 'test-' + run, other = 'test-b-' + run;
  const a = ('a' + run).padEnd(20, '0'), b = ('b' + run).padEnd(20, '0');
  console.log('Cleaning text');
  check(R.clean('  hello \u0007  there\t\tyou  ', 50) === 'hello there you' && R.clean('x'.repeat(900), R.LIMITS.comment).length === 600 && R.clean(null, 5) === '' && R.clean('<b>bold</b>', 50) === '<b>bold</b>',
    'text is kept as plain text: control characters out, spaces squeezed, cut to length (the page escapes it when it shows it)');
  check(R.TRACK.test('forest-under-the-old-oaks') && !R.TRACK.test('../etc') && !R.TRACK.test('A Track') && !R.TRACK.test('') && R.VISITOR.test(a) && !R.VISITOR.test('short') && !R.VISITOR.test('has spaces in it 12345'),
    'a track is a file\'s name and a listener a plain id: nothing else is taken');
  check(R.hashOf('1.2.3.4') === R.hashOf('1.2.3.4') && R.hashOf('1.2.3.4') !== R.hashOf('1.2.3.5') && !R.hashOf('1.2.3.4').includes('1.2.3.4'), 'an address is kept as a salted hash, never itself');

  console.log('Rating without signing in');
  let r = await call('GET', '/api/jukebox');
  check(r.status === 200 && r.body.ok && typeof r.body.tracks === 'object' && Object.keys(r.body.mine).length === 0, 'anyone can read the averages; with no listener id there is nothing of "mine"');
  r = await call('POST', '/api/jukebox/rate', { visitor: a, track, stars: 5, comment: 'Lovely  <i>tune</i>', name: 'Sam' });
  check(r.status === 200 && r.body.tracks[track].stars === 5 && r.body.tracks[track].count === 1 && r.body.mine[track].stars === 5 && r.body.mine[track].comment === 'Lovely <i>tune</i>' && r.body.mine[track].name === 'Sam',
    'a listener rates a track with stars, a comment and a name');
  r = await call('POST', '/api/jukebox/rate', { visitor: b, track, stars: 2 });
  check(r.status === 200 && r.body.tracks[track].stars === 3.5 && r.body.tracks[track].count === 2 && r.body.mine[track].comment === '', 'a second listener moves the average; a comment is not needed');
  r = await call('POST', '/api/jukebox/rate', { visitor: a, track, stars: 3, comment: 'On second thoughts' });
  check(r.status === 200 && r.body.tracks[track].count === 2 && r.body.tracks[track].stars === 2.5 && r.body.mine[track].comment === 'On second thoughts', 'rating again changes the rating: one row for each listener and track');
  await call('POST', '/api/jukebox/rate', { visitor: a, track: other, stars: 4 });
  r = await call('GET', '/api/jukebox?visitor=' + b);
  check(r.body.mine[track] && r.body.mine[track].stars === 2 && !r.body.mine[other] && r.body.tracks[other].count === 1 && !JSON.stringify(r.body).includes('On second thoughts'),
    'a listener gets their own ratings back, and nobody else\'s comment');
  const bad = [{ visitor: 'x', track, stars: 3 }, { visitor: a, track: '../x', stars: 3 }, { visitor: a, track, stars: 0 }, { visitor: a, track, stars: 6 }, { visitor: a, track, stars: 2.5 }, { visitor: a, track, stars: 'five' }, {}];
  const codes = [];
  for (const body of bad) codes.push((await call('POST', '/api/jukebox/rate', body)).status);
  check(codes.every(c => c === 400), 'a bad listener id, track or number of stars is refused', codes.join(' '));
  r = await call('POST', '/api/jukebox/rate', { visitor: a, track, stars: 4, comment: 'y'.repeat(5000), name: 'n'.repeat(500) });
  check(r.status === 200 && r.body.mine[track].comment.length === 600 && r.body.mine[track].name.length === 40, 'a long comment or name is cut, not refused');
  const row = (await query('SELECT ip_hash FROM jukebox_feedback WHERE track=$1 AND visitor=$2', [track, a])).rows[0];
  check(row && /^[0-9a-f]{32}$/.test(row.ip_hash), 'the row holds the hash of where it came from');

  console.log('Reading the comments');
  check((await call('GET', '/api/jukebox/admin/feedback')).status === 401 && (await call('GET', '/api/jukebox/admin/feedback', null, 987654321)).status === 403, 'the comments are for admins: not the public, not a signed-in player');
  if (adminId) {
    r = await call('GET', '/api/jukebox/admin/feedback', null, adminId);
    const mine = (r.body.feedback || []).filter(x => x.track === track);
    check(r.status === 200 && mine.length === 2 && mine.some(x => x.name === 'n'.repeat(40) && x.stars === 4) && !('ip_hash' in mine[0]) && !('visitor' in mine[0]), 'an admin reads every rating with its comment and name (and no ids or addresses)');
  }
  await query('DELETE FROM jukebox_feedback WHERE track = ANY($1::text[])', [[track, other]]);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
