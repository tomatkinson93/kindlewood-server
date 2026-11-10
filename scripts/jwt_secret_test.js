// jwt_secret_test — the sign-in secret (lib/jwt_secret.js). Pure.
//   node scripts/jwt_secret_test.js
'use strict';
const { resolve, DEV_SECRET } = require('../lib/jwt_secret');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ', m); } else { failed++; console.log('  FAIL', m); } };
const throws = env => { try { resolve(env); return false; } catch (e) { return /JWT_SECRET/.test(e.message); } };
check(resolve({}) === DEV_SECRET && resolve({ JWT_SECRET: 'abc' }) === 'abc', 'outside production: the given secret, else the development one');
check(throws({ NODE_ENV: 'production' }), 'production with no secret: refuses to start');
check(throws({ NODE_ENV: 'production', JWT_SECRET: 'short' }) && throws({ NODE_ENV: 'production', JWT_SECRET: DEV_SECRET }), 'production with a short or the development secret: refuses');
check(resolve({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }) === 'x'.repeat(32), 'production with a real secret: uses it');
const fs = require('fs'), path = require('path');
const files = ['middleware/auth.js', 'routes/auth.js', 'routes/stream.js', 'routes/rooms.js', 'routes/presence.js', 'routes/game_stats.js'];
check(files.every(f => /require\('\.\.\/lib\/jwt_secret'\)/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')) && !/process\.env\.JWT_SECRET/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))), 'every file that signs or checks a token uses it');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
