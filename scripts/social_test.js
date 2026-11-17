// ══════════════════════════════════════════════════════════════════════════
//  social_test — Talk to… and Praise (docs/HOME_SCENE.md Part F, step 18;
//  lib/social.js, /api/social).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/social_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function pure() {
  const S = require('../lib/social');
  console.log('Topics and interests');
  check(S.TOPICS.length === 16 && new Set(S.TOPICS.map(t => t.key)).size === 16 && S.TOPICS.every(t => t.label && t.icon), 'sixteen topics, each with a name and a picture');
  const a = S.interestsFor(41), again = S.interestsFor(41);
  check(a.likes.length === 3 && new Set(a.likes).size === 3 && !a.likes.includes(a.dull) && a.likes.concat(a.dull).every(S.isTopic), 'a villager likes three topics and finds another dull');
  check(JSON.stringify(a) === JSON.stringify(again), 'the same villager always has the same interests');
  const spread = new Set(); for (let i = 1; i <= 200; i++) S.interestsFor(i).likes.forEach(k => spread.add(k));
  check(spread.size === 16, 'across a town every topic is liked by somebody');
  const mum = { likes: ['fishing', 'music', 'herbs'], dull: 'gossip' }, dad = { likes: ['stars', 'games', 'dancing'], dull: 'weather' };
  let ok = true;
  for (let id = 500; id < 560; id++) {
    const k = S.interestsFor(id, [mum, dad]);
    if (!(mum.likes.includes(k.likes[0]) && dad.likes.includes(k.likes[1]) && k.likes.length === 3 && new Set(k.likes).size === 3 && !k.likes.includes(k.dull))) ok = false;
  }
  check(ok, 'a child takes one liked topic from each parent and one of their own');
  const same = { likes: ['fishing', 'music', 'herbs'], dull: 'gossip' };
  check(S.interestsFor(77, [same, same]).likes.length === 3 && S.interestsFor(77, [{ likes: [] }, null]).likes.length === 3, 'parents alike, or unknown, still leave three different likes');

  console.log('The chance to get along');
  const sp = { likes: ['fishing', 'music', 'herbs'], dull: 'gossip' }, li = { likes: ['fishing', 'stars', 'games'], dull: 'music' };
  check(S.chance('weather', sp, li) === 0.5, 'an ordinary topic: an even chance');
  check(S.chance('stars', sp, li) === 0.7, 'the listener likes it: 70%');
  check(S.chance('fishing', sp, li) === 0.8, 'both like it: 80%');
  check(S.chance('fishing', sp, li, { charming: true }) === 0.9 && S.chance('fishing', { ...sp }, li, { charming: true }) <= 0.9, 'a Charming speaker adds 10%, and it never passes 90%');
  check(S.chance('music', sp, li) === 0.3, 'the speaker likes it but the listener finds it dull: 30%');
  check(S.chance('gossip', sp, li) === 0.35, 'the speaker finds it dull: 35%');
  check(S.chance('gossip', sp, { likes: [], dull: 'gossip' }) === 0.1, 'dull to both: the floor of 10%');
  check(S.feels(li, 'fishing') === 'likes' && S.feels(li, 'music') === 'dull' && S.feels(li, 'herbs') === 'fine', 'how a villager felt about a topic');

  console.log('The day');
  const at = (h, m = 0) => Date.UTC(2026, 10, 17, h, m);
  const d = S.gameDay(at(12));
  check(S.gameDay(at(8, 59)).day === d.day - 1 && S.gameDay(at(9)).day === d.day && S.gameDay(at(23, 59)).day === d.day && S.gameDay(at(24 + 8)).day === d.day, 'a day runs from dawn (09:00 UTC) to the next dawn');
  check(d.resets === at(24 + 9), 'and says when the next one starts');

  console.log('What the player has learned');
  const k = S.learned(new Map([[1, { ...sp, known: ['fishing', 'music', 'weather'] }], [2, { ...li, known: ['fishing', 'music', 'weather'] }], [3, { ...sp, known: [] }]]));
  check(k[1].likes.join() === 'fishing,music' && k[1].dull === null && k[1].fine.join() === 'weather', 'a villager shows how they feel about the topics their chats have touched');
  check(k[2].likes.join() === 'fishing' && k[2].dull === 'music' && k[2].fine.join() === 'weather', 'likes, the dull one and the ordinary ones');
  check(!k[3], 'nothing is known of a villager before they have talked');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const S = require('../lib/social');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async () => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `so_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -120000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,'camp',$3,0,NOW()) RETURNING id`, [u.id, username, tq])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, api };
  };
  const mk = async (sid, name, extra = {}) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, parent_ids, visible_traits, life)
      VALUES ($1,$2,'female','idle',$3,$4,$5,'{"happiness":60}') RETURNING id`, [sid, name, extra.stage || 'adult', JSON.stringify(extra.parents || []), JSON.stringify(extra.traits || [])])).rows[0].id;
  const happyOf = async id => Number((await q("SELECT life->>'happiness' AS h FROM citizens WHERE id = $1", [id])).rows[0].h);
  const rel = async (a, b) => (await q('SELECT score, state FROM citizen_relationships WHERE citizen_a_id = $1 AND citizen_b_id = $2', [Math.min(a, b), Math.max(a, b)])).rows[0];
  const NOW = Date.UTC(2026, 10, 17, 12), TOMORROW = NOW + 24 * 3600e3;
  const yes = () => 0, no = () => 0.999;

  console.log('Interests are given out, parents first');
  const t = await mkTown();
  const mum = await mk(t.id, 'Mum Oak'), dad = await mk(t.id, 'Dad Oak');
  const kid = await mk(t.id, 'Kid Oak', { stage: 'child', parents: [mum, dad] });
  const gone = await mk(t.id, 'Old Oak', { stage: 'deceased' });
  {
    const its = await S.ensure(t.id);
    check(its.size === 3 && !its.has(gone), 'every living villager has interests');
    const k = its.get(kid);
    check(its.get(mum).likes.includes(k.likes[0]) && its.get(dad).likes.includes(k.likes[1]), 'the child takes after both parents');
    const before = JSON.stringify([...its]);
    check(JSON.stringify([...(await S.ensure(t.id))]) === before, 'asking again changes nothing');
    const cols = (await q('SELECT * FROM citizens WHERE id = $1', [mum])).rows[0];
    check(!('likes' in cols) && !('dull' in cols), 'interests are kept apart from the citizen (they are not sent with the town)');
  }

  console.log('Talking');
  {
    const its = await S.ensure(t.id);
    const liked = its.get(dad).likes[0];
    let x = await S.talk(t.id, mum, dad, liked, NOW, yes);
    check(x.got_along && x.delta === 3 && x.topic === liked && x.picked && x.listener.felt === 'likes', 'they got along: the bond goes up by 3');
    check((await rel(mum, dad)).score === 3 && await happyOf(mum) === 61 && await happyOf(dad) === 61, 'the bond is saved and both are a little happier');
    let err = null; try { await S.talk(t.id, mum, kid, null, NOW, yes); } catch (e) { err = e; }
    check(err instanceof S.SocialError && err.status === 409 && /tomorrow/.test(err.message), 'a villager can be sent once a day');
    x = await S.talk(t.id, dad, mum, null, NOW, no);
    check(!x.got_along && x.delta === -2 && !x.picked && S.isTopic(x.topic), 'being talked to does not use a turn; a chat that goes badly costs 2');
    check((await rel(mum, dad)).score === 1 && await happyOf(mum) === 61, 'the bond falls and nobody is happier for it');
    x = await S.talk(t.id, kid, mum, null, NOW, no);
    check(x.delta === 0 && (await rel(kid, mum)).score === 0, 'a bond never falls below nothing (and the result says what really changed)');
    x = await S.talk(t.id, mum, dad, liked, TOMORROW, yes);
    check(x.got_along && (await rel(mum, dad)).score === 4, 'the next morning they can be sent again');
    await S.talk(t.id, dad, kid, null, NOW + 40 * 24 * 3600e3, yes);
    const kept = (await q('SELECT COUNT(*)::int AS n FROM citizen_chats WHERE settlement_id = $1', [t.id])).rows[0].n;
    const st = await S.state(t.id, NOW + 40 * 24 * 3600e3);
    check(kept === 1 && st.known[mum] && st.known[mum].likes.concat(st.known[mum].fine, [st.known[mum].dull]).includes(liked), 'old chats are cleared after a month; what was learned stays');
    for (const bad of [[mum, mum, null], [mum, gone, null], [mum, 99999999, null], [dad, mum, 'taxes']]) {
      err = null; try { await S.talk(t.id, bad[0], bad[1], bad[2], TOMORROW, yes); } catch (e) { err = e; }
      if (!(err instanceof S.SocialError)) { check(false, 'refused: ' + bad.join()); }
    }
    check(true, 'not themselves, not the dead, not a stranger to the town, not an unknown topic');
    await q("UPDATE citizen_relationships SET score = 95, state = 'partners' WHERE citizen_a_id = $1 AND citizen_b_id = $2", [Math.min(mum, dad), Math.max(mum, dad)]);
    await S.talk(t.id, dad, mum, null, TOMORROW, no);
    check((await rel(mum, dad)).state === 'partners', 'a bad chat does not part partners');
    await q('UPDATE citizen_relationships SET score = 88, state = $3 WHERE citizen_a_id = $1 AND citizen_b_id = $2', [Math.min(mum, kid), Math.max(mum, kid), 'bonded']);
    await S.talk(t.id, kid, mum, null, TOMORROW, yes);
    const r = await rel(mum, kid);
    check(r.score === 91 && r.state === 'bonded', 'and a good one does not make partners by itself: that stays with the town\'s own life');
  }

  console.log('A Charming speaker, and the roll');
  {
    const c = await mkTown();
    const a = await mk(c.id, 'Ash', { traits: ['charming'] }), b = await mk(c.id, 'Birch');
    const its = await S.ensure(c.id);
    const plain = KEYSNOT(S, its.get(a), its.get(b));
    let x = await S.talk(c.id, a, b, plain, NOW, seq([0.55]));
    check(x.got_along, 'a Charming speaker gets along on a 55 roll over an ordinary topic');
    x = await S.talk(c.id, b, a, plain, NOW, seq([0.55]));
    check(!x.got_along, 'an ordinary speaker does not');
  }

  console.log('Praise');
  {
    const p = await mkTown();
    const ids = []; for (let i = 0; i < 5; i++) ids.push(await mk(p.id, 'Villager ' + i));
    let x = await S.praise(p.id, ids[0], NOW);
    check(x.praise_left === 2 && await happyOf(ids[0]) === 62, 'praise: a little happiness (+2), and two left');
    let err = null; try { await S.praise(p.id, ids[0], NOW); } catch (e) { err = e; }
    check(err instanceof S.SocialError && err.status === 409, 'a villager is praised once a day');
    await S.praise(p.id, ids[1], NOW); await S.praise(p.id, ids[2], NOW);
    err = null; try { await S.praise(p.id, ids[3], NOW); } catch (e) { err = e; }
    check(err instanceof S.SocialError && err.status === 409 && await happyOf(ids[3]) === 60, 'three a day for the whole town');
    x = await S.praise(p.id, ids[3], TOMORROW);
    check(x.praise_left === 2, 'and three more the next morning');
    const both = await Promise.allSettled([S.praise(p.id, ids[4], TOMORROW), S.praise(p.id, ids[4], TOMORROW)]);
    check(both.filter(r => r.status === 'fulfilled').length === 1 && await happyOf(ids[4]) === 62, 'two devices praising at once: one counts');
    const two = await Promise.allSettled([S.talk(p.id, ids[0], ids[1], null, NOW, yes), S.talk(p.id, ids[0], ids[2], null, NOW, yes)]);
    check(two.filter(r => r.status === 'fulfilled').length === 1, 'two devices sending the same villager at once: one chat');
  }

  console.log('The API');
  {
    const a = await mkTown();
    const one = await mk(a.id, 'One Elm'), two = await mk(a.id, 'Two Elm'), three = await mk(a.id, 'Three Elm');
    let x = await a.api('GET', '/api/social');
    check(x.status === 200 && x.body.topics.length === 16 && x.body.praise_left === 3 && x.body.talked.length === 0 && Object.keys(x.body.known).length === 0, 'GET /api/social: today, with nothing known yet');
    check(!JSON.stringify(x.body).includes('"dull":"') , 'no interests are sent before a chat has touched them');
    x = await a.api('POST', '/api/social/talk', { speaker_id: one, listener_id: two, topic: 'fishing' });
    check(x.status === 200 && x.body.chat.topic === 'fishing' && typeof x.body.chat.got_along === 'boolean' && x.body.social.talked.includes(one), 'POST /talk answers with the chat and the day as it now is');
    const k = x.body.social.known;
    check(k[one] && k[two] && !k[three] && (k[one].likes.concat(k[one].fine, [k[one].dull]).includes('fishing')), 'what they felt about that topic is now known, and nothing else');
    x = await a.api('POST', '/api/social/talk', { speaker_id: one, listener_id: three });
    check(x.status === 409 && /tomorrow/.test(x.body.error), 'a second chat the same day is refused');
    x = await a.api('POST', '/api/social/talk', { speaker_id: two, listener_id: three, topic: 'anything' });
    check(x.status === 200 && x.body.chat.picked === false, '"anything" lets the server pick');
    x = await a.api('POST', '/api/social/praise', { citizen_id: three });
    check(x.status === 200 && x.body.praise.praise_left === 2 && x.body.social.praised.includes(three), 'POST /praise');
    x = await a.api('GET', '/api/social/bonds/' + one);
    check(x.status === 200 && x.body.bonds[two] && typeof x.body.bonds[two].score === 'number' && !x.body.bonds[one], 'GET /bonds/:id: their bond with each of the others');
    const other = await mkTown();
    x = await other.api('POST', '/api/social/talk', { speaker_id: one, listener_id: two });
    check(x.status === 404, 'another town\'s villagers cannot be sent');
    x = await other.api('POST', '/api/social/praise', { citizen_id: one });
    check(x.status === 404, 'or praised');
    x = await a.api('GET', '/api/citizens');
    check(x.status === 200 && !/"likes"|"dull"/.test(JSON.stringify(x.body)), 'the citizens list does not carry interests');
  }

  await pool.end();
}
// A topic neither of two villagers likes or finds dull.
function KEYSNOT(S, a, b) { return S.TOPICS.map(t => t.key).find(k => S.feels(a, k) === 'fine' && S.feels(b, k) === 'fine'); }
// A roll that answers with the given numbers, in turn.
function seq(list) { let i = 0; return () => list[Math.min(i++, list.length - 1)]; }

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
