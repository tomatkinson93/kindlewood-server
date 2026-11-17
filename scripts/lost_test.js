// ═══════════════════════════════════════════════════════════════════════════
//  lost_test — a lost thing each day (docs/HOME_SCENE.md Part F, F.8, step 22;
//  lib/lost.js, /api/lost).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/lost_test.js
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}

function pure() {
  const L = require('../lib/lost');
  console.log('The day\'s thing');
  const grown = [{ id: 3, name: 'Ash Oak', life_stage: 'adult' }, { id: 1, name: 'Bea Oak', life_stage: 'elder' }, { id: 2, name: 'Cob Oak', life_stage: 'adult' }];
  const town = grown.concat([{ id: 9, name: 'Dot Oak', life_stage: 'child' }]);
  const a = L.pick(7, 20500, town), b = L.pick(7, 20500, town.slice().reverse());
  check(JSON.stringify(a) === JSON.stringify(b), 'the same town and day give the same thing, whatever order the villagers come in', a);
  check(L.pick(7, 20500, []) === null, 'a town with nobody loses nothing');
  const days = Array.from({ length: 400 }, (_, i) => L.pick(7, 20000 + i, town));
  check(new Set(days.map(d => d.kind)).size === L.THINGS.length, 'every kind of thing turns up');
  check(new Set(days.map(d => d.owner_id)).size === town.length, 'anyone can lose something');
  check(new Set(days.map(d => d.seed)).size > 390 && days.every(d => Number.isInteger(d.seed) && d.seed >= 0), 'each day has its own place');
  check(days.filter(d => d.kind === 'toy').every(d => d.owner_id === 9) && days.filter(d => d.kind !== 'toy').every(d => d.owner_id !== 9), 'a toy is a child\'s; the rest belong to grown villagers');
  const noKids = Array.from({ length: 400 }, (_, i) => L.pick(7, 20000 + i, grown));
  check(noKids.every(d => d.kind !== 'toy') && new Set(noKids.map(d => d.kind)).size === L.THINGS.length - 1, 'no children: no toys');
  const onlyKid = L.pick(7, 20500, [{ id: 9, name: 'Dot Oak', life_stage: 'child' }]);
  check(onlyKid && onlyKid.owner_id === 9, 'a town of one child still loses something');
  check(L.THINGS.every(t => Object.keys(t.gives).length === 1 && Object.values(t.gives)[0] > 0 && Object.values(t.gives)[0] <= 15) && L.CONFIG.HAPPY === 3, 'the thank-you is small: a little food or a few coins, and 3 happiness for the owner');
  const v = L.view({ id: 1, day: 5, kind: 'ribbon', owner_id: 3, owner_name: 'Ash Oak', seed: 44, found_at: null, reward: null }, 123);
  check(v.line === 'Ash has lost a ribbon.' && v.found === false && v.icon && v.seed === 44 && L.view({ ...v, kind: 'ribbon', owner_name: 'Ash Oak', found_at: new Date() }).line === 'Ash has a ribbon back.', 'what the player is told');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const L = require('../lib/lost');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async () => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `lo_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -130000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,'camp',$3,0,NOW()) RETURNING id`, [u.id, username, tq])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const mk = async (sid, name, stage = 'adult') => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, parent_ids, visible_traits, life)
      VALUES ($1,$2,'female','idle',$3,'[]','[]','{"happiness":60}') RETURNING id`, [sid, name, stage])).rows[0].id;
  const happyOf = async id => Number((await q("SELECT life->>'happiness' AS h FROM citizens WHERE id = $1", [id])).rows[0].h);
  const stock = async sid => (await q('SELECT food, wealth FROM settlements WHERE id = $1', [sid])).rows[0];
  const NOW = Date.UTC(2026, 10, 17, 12), TOMORROW = NOW + 24 * 3600e3;

  console.log('One a day');
  const t = await mkTown();
  check((await L.today(t.id, NOW)) === null, 'an empty town has nothing lost');
  const a = await mk(t.id, 'Ash Oak'), b = await mk(t.id, 'Bea Oak');
  const one = await L.today(t.id, NOW);
  check(one && !one.found && [a, b].includes(one.owner_id) && one.resets_at > NOW, 'the first ask of the day makes the day\'s thing', one);
  const again = await L.today(t.id, NOW + 3600e3);
  check(again.id === one.id && again.seed === one.seed && again.kind === one.kind, 'asking again gives the same one');
  check((await q('SELECT COUNT(*)::int AS n FROM lost_things WHERE settlement_id = $1', [t.id])).rows[0].n === 1, 'one row for the day');

  console.log('Giving it back');
  {
    const before = await stock(t.id), h0 = await happyOf(one.owner_id);
    const out = await L.giveBack(t.id, NOW + 2 * 3600e3);
    const after = await stock(t.id), gives = L.THINGS.find(x => x.key === one.kind).gives, key = Object.keys(gives)[0];
    check(out.found && out.reward.happiness === 3 && out.reward[key] === gives[key], 'it is marked found, with what it gave', out.reward);
    check(Number(after[key]) - Number(before[key]) === gives[key], 'the town gets its small thank-you', { key, before, after });
    check((await happyOf(one.owner_id)) === h0 + 3, 'the owner is 3 happier');
    const ch = (await q("SELECT text, citizen_ids FROM chronicle WHERE settlement_id = $1 AND kind = 'town' ORDER BY id DESC LIMIT 1", [t.id])).rows[0];
    check(ch && /found and given back/.test(ch.text) && JSON.stringify(ch.citizen_ids) === JSON.stringify([one.owner_id]), 'the chronicle notes it', ch);
    const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id = $1 AND type = 'lost'", [t.id])).rows;
    check(ev.length === 1, 'and a news line');
    let err = null; try { await L.giveBack(t.id, NOW + 3 * 3600e3); } catch (e) { err = e; }
    check(err instanceof L.LostError && err.status === 409, 'it cannot be given back twice');
    const s2 = await stock(t.id);
    check(Number(s2[key]) === Number(after[key]) && (await happyOf(one.owner_id)) === h0 + 3, 'and a second try gives nothing');
    check((await L.today(t.id, NOW + 4 * 3600e3)).found === true, 'for the rest of the day it shows as found');
  }

  console.log('Two devices at once');
  {
    const u = await mkTown(); await mk(u.id, 'Cob Elm'); await mk(u.id, 'Dot Elm');
    const both = await Promise.all([L.today(u.id, NOW), L.today(u.id, NOW)]);
    check(both[0].id === both[1].id, 'two asks at the same moment make one thing');
    const before = await stock(u.id);
    const res = await Promise.allSettled([L.giveBack(u.id, NOW), L.giveBack(u.id, NOW)]);
    const ok = res.filter(r => r.status === 'fulfilled').length, key = Object.keys(L.THINGS.find(x => x.key === both[0].kind).gives)[0];
    const after = await stock(u.id);
    check(ok === 1 && res.some(r => r.status === 'rejected' && r.reason.status === 409), 'two finds at the same moment: one counts');
    check(Number(after[key]) - Number(before[key]) === L.THINGS.find(x => x.key === both[0].kind).gives[key], 'and the town is thanked once');
  }

  console.log('The next day, and an owner who is gone');
  {
    const next = await L.today(t.id, TOMORROW);
    check(next.id !== one.id && next.day === one.day + 1 && !next.found, 'a new day, a new thing');
    await q("UPDATE citizens SET life_stage = 'deceased' WHERE id = $1", [next.owner_id]);
    const out = await L.giveBack(t.id, TOMORROW + 3600e3);
    check(out.found && out.reward.happiness === 0, 'if the owner has died it still comes home, with no happiness to give');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'town' ORDER BY id DESC LIMIT 1", [t.id])).rows[0];
    check(/given to the family/.test(ch.text), 'and the chronicle says so', ch.text);
    await q('UPDATE lost_things SET day = day - 40 WHERE settlement_id = $1 AND id = $2', [t.id, one.id]);
    await L.today(t.id, TOMORROW + 24 * 3600e3);
    check((await q('SELECT COUNT(*)::int AS n FROM lost_things WHERE settlement_id = $1 AND id = $2', [t.id, one.id])).rows[0].n === 0, 'old days are cleared');
  }

  console.log('Routes');
  {
    const r = await mkTown(); const c = await mk(r.id, 'Eve Ash');
    let x = await r.api('GET', '/api/lost');
    check(x.status === 200 && x.body.thing && x.body.thing.owner_id === c && x.body.thing.found === false && typeof x.body.thing.seed === 'number', 'GET /api/lost', x.body);
    x = await r.api('POST', '/api/lost/return');
    check(x.status === 200 && x.body.thing.found === true && x.body.thing.reward.happiness === 3, 'POST /api/lost/return');
    x = await r.api('POST', '/api/lost/return');
    check(x.status === 409 && /already/.test(x.body.error), 'a second return is refused');
    const empty = await mkTown();
    x = await empty.api('GET', '/api/lost');
    check(x.status === 200 && x.body.thing === null, 'a town with nobody: nothing');
    x = await empty.api('POST', '/api/lost/return');
    check(x.status === 404, 'and nothing to return');
    const anon = await fetch(BASE + '/api/lost'); check(anon.status === 401, 'signed-out callers are refused');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
