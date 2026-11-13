// ══════════════════════════════════════════════════════════════════════════
//  security_test — SECURITY_REVIEW.md S1–S4: name rules, no sign-in cookie,
//  registration input, sign-in rate limits, the one-off name cleanup.
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/security_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const N = require('../lib/names');
  console.log('Name rules (lib/names)');
  check(N.cleanUsername('Aldric Thornpaw') === 'Aldric Thornpaw' && N.cleanUsername('tom_93') === 'tom_93' && N.cleanUsername('  Moss   Pip ') === 'Moss Pip',
    'ruler names: letters, digits, _ -, single spaces between words (extra spaces collapse)');
  check([null, {}, ['ab'], 'ab', 'x'.repeat(21), '<img src=x onerror=alert(1)>', 'a"b', 'a&b', ' ', 'tab\tname'].every(u => N.cleanUsername(u) === null || u === 'tab\tname' && N.cleanUsername(u) === 'tab name'),
    'refused: non-strings, too short or long, < > " &');
  check(N.cleanTownName("Éclair's Hollow") === "Éclair's Hollow" && N.cleanTownName("tom_93's Camp") === "tom_93's Camp",
    "town names: any alphabet, apostrophes, and a username's underscore");
  check(['<b>x</b>', 'a', 'x'.repeat(33), 'a"b', 'a&b', 'a`b', 42].every(t => N.cleanTownName(t) === null), 'town names refuse markup, 1 or 33+ characters, non-strings');
  check(N.cleanEmail('a@b.co') === 'a@b.co' && N.cleanEmail('nope') === null && N.cleanEmail('a@b.co'.padStart(255, 'x')) === null && N.cleanEmail({}) === null, 'emails: shape and 254-character cap');
  check(N.passwordProblem('password1') === null && /at least 8/.test(N.passwordProblem('short')) && /at most 72/.test(N.passwordProblem('x'.repeat(73))) && N.passwordProblem(12345678) !== null,
    'passwords: 8 to 72 bytes, strings only');

  console.log('No sign-in cookie (S2)');
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const authFiles = ['middleware/auth.js', 'routes/auth.js', 'routes/stream.js', 'routes/rooms.js', 'routes/presence.js', 'routes/game_stats.js'];
  check(authFiles.every(f => !/req\.cookies/.test(read(f))), 'no route reads req.cookies');
  check(!/res\.cookie\(/.test(read('routes/auth.js')), 'register and login set no cookie');

  console.log('Rate limiter (S3)');
  const { rateLimit } = require('../lib/rate_limit');
  const prevEnv = process.env.NODE_ENV;
  const run = (mw, req) => { let status = 200; const res = { set() {}, status(s) { status = s; return this; }, json() {} }; mw(req, res, () => {}); return status; };
  const lim = rateLimit({ windowMs: 60000, max: 3, keys: r => [r.ip, r.email && 'e:' + r.email] });
  const s1 = [1, 2, 3, 4].map(() => run(lim, { ip: '10.0.0.1' }));
  check(s1.join() === '200,200,200,429', 'the 4th request in the window from one address is refused (429)');
  const s2 = [1, 2, 3, 4].map((_, i) => run(lim, { ip: '10.0.1.' + i, email: 'Victim@x.y' }));
  check(s2[3] === 429, 'one email from many addresses is limited too');
  check(run(lim, { ip: '10.0.0.2' }) === 200, 'another address is unaffected');
  process.env.NODE_ENV = 'development';
  check([1, 2, 3, 4, 5].map(() => run(lim, { ip: '127.0.0.1' })).every(s => s === 200), 'local test runs (loopback, not production) are not limited');
  process.env.NODE_ENV = 'production';
  check([1, 2, 3, 4].map(() => run(lim, { ip: '::1' })).pop() === 429, 'in production loopback is limited like anyone');
  process.env.NODE_ENV = prevEnv;
  check(/app\.set\('trust proxy'/.test(read('index.js')), 'Express trusts Render\'s proxy, so req.ip is the player');

  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const RUN = Math.random().toString(36).slice(2, 7);
  const post = async (p, body, headers = {}) => {
    const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => ({})) };
  };

  console.log('Registration (S1, S4)');
  const bad = [
    { username: '<img src=x onerror=alert(1)>', why: 'markup' },
    { username: { a: 1 }, why: 'an object' },
    { username: 'a'.repeat(3000), why: '3,000 characters' },
  ];
  for (const b of bad) {
    const r = await post('/api/auth/register', { username: b.username, email: `bad${RUN}${b.why.length}@t.l`, password: 'password123' });
    check(r.status === 400 && /Ruler names/.test(r.body.error), `a username that is ${b.why} is refused`);
  }
  let r = await post('/api/auth/register', { username: `ok${RUN}`, email: 'not-an-email', password: 'password123' });
  check(r.status === 400 && /valid email/.test(r.body.error), 'a malformed email is refused');
  r = await post('/api/auth/register', { username: `ok${RUN}`, email: `ok${RUN}@t.l`, password: 'x'.repeat(100) });
  check(r.status === 400 && /at most 72/.test(r.body.error), 'a password past 72 bytes is refused');
  const uname = `Sec ${RUN}`;
  r = await post('/api/auth/register', { username: uname, email: `sec${RUN}@t.l`, password: 'password123', species: 'Mice' });
  check(r.status === 200 && r.body.token && r.body.username === uname, 'a spaced ruler name registers and gets a token');
  check(!r.cookie, 'no Set-Cookie on register');
  const token = r.body.token;
  const lr = await post('/api/auth/login', { email: `sec${RUN}@t.l`, password: 'password123' });
  check(lr.status === 200 && lr.body.token && !lr.cookie, 'login answers a token and no cookie');
  const lo = await post('/api/auth/login', { email: { $ne: 1 }, password: 'x' });
  check(lo.status === 400, 'login refuses a non-string email');

  console.log('The cookie no longer signs anyone in (S2)');
  const get = async (p, headers) => (await fetch(BASE + p, { headers })).status;
  check(await get('/api/game/settlement', { Cookie: 'token=' + token }) === 401, 'a cookie alone: 401');
  check(await get('/api/auth/me', { Cookie: 'token=' + token }) === 401, '/me with a cookie alone: 401');
  check(await get('/api/game/settlement', { Authorization: 'Bearer ' + token }) === 200, 'the Bearer header still works');

  console.log('Town rename (S1)');
  const patch = async name => {
    const res = await fetch(BASE + '/api/game/settlement/rename', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  let p = await patch('<script>alert(1)</script>');
  check(p.status === 400 && /Town names/.test(p.body.error), 'a town name with markup is refused');
  p = await patch({ x: 1 });
  check(p.status === 400, 'a non-string town name is refused');
  p = await patch("  Éclair's   Hollow ");
  check(p.status === 200 && p.body.name === "Éclair's Hollow", 'a good name is trimmed and saved');

  console.log('One-off cleanup of stored names');
  const ids = [];
  for (const [n, e] of [[`<b>z${RUN}`, 'c1'], [`z${RUN}<>`, 'c2'], ['<>', 'c3']]) {
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [n, `${e}${RUN}@t.l`])).rows[0];
    await q('INSERT INTO settlements (user_id, name) VALUES ($1,$2)', [u.id, n + "'s <script>Camp"]);
    ids.push(u.id);
  }
  const sql = read(fs.readdirSync(path.join(__dirname, '..', 'migrations')).map(f => 'migrations/' + f).find(f => f.endsWith('_name_cleanup.sql')));
  await q(sql); await q(sql);   // runs on every boot: twice is the same as once
  const rows = (await q('SELECT u.id, u.username, s.name FROM users u JOIN settlements s ON s.user_id = u.id WHERE u.id = ANY($1) ORDER BY u.id', [ids])).rows;
  check(rows.every(x => !/[<>"&`]/.test(x.username) && !/[<>"&`]/.test(x.name)), 'no < > " & ` left in usernames or town names');
  check(rows[0].username === `bz${RUN}` && rows[1].username === `z${RUN}`, 'clean names keep their letters');
  check(rows[2].username === 'player' + ids[2], 'a name with nothing left becomes player<id>');
  check(new Set(rows.map(x => x.username)).size === 3, 'usernames stay unique');

  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
