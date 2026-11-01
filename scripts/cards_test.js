// ══════════════════════════════════════════════════════════════════════════
//  cards_test — the card collection (lib/cards, routes/cards, routes/decks),
//  battle spoils (lib/spoils, the auto-resolve path in routes/quests) and
//  enemies of the land (lib/time_gates biomes).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/cards_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const C = require('../lib/cards');
  const D = require('../lib/card_definitions');
  console.log('Cards');
  check(C.STARTER.length === 9 && C.STARTER.every(k => D.CARDS[k]), 'nine starter cards, all real');
  const un = C.unlockable();
  check(un.length >= 10 && ['venom_edge', 'shield_bash', 'arrow_rain', 'last_stand'].every(k => un.includes(k)), `${un.length} cards to earn, the new ten among them`);
  const v = C.villageCards(42, Date.parse('2026-06-01T00:00:00Z'));
  check(v.length === 2 && v[0] !== v[1] && JSON.stringify(v) === JSON.stringify(C.villageCards(42, Date.parse('2026-06-03T00:00:00Z'))), 'a village teaches two cards, the same all week');
  check(C.priceOf('last_stand') > C.priceOf('venom_edge'), 'rarer cards cost more');
  const FE = process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
  const twin = path.join(FE, 'js', 'card-definitions.js');
  if (fs.existsSync(twin)) check(fs.readFileSync(twin, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'card_definitions.js'), 'utf8'), 'card definitions identical in both repos');
  console.log('New cards in play');
  const ctxEv = [];
  const ctx = {
    dealDamage: (a, t, n) => { t.hp -= n; return [{ type: 'dmg', n }]; }, applyPoison: (t, n) => { t.poison = n; return [{ type: 'poison' }]; },
    applyStun: (t, n) => { t.stun = n; return [{ type: 'stun' }]; }, addBlock: (u, n) => { u.block = n; return []; },
    heal: (u, n) => { u.hp += n; return []; }, drawCards: n => { ctxEv.push('draw' + n); return []; }, applyBuff: (u, k, n) => { u[k] = n; return []; }, applyDebuff: (u, k, n) => { u[k] = n; return []; },
  };
  const me = { strength: 8, agility: 8, endurance: 8, intelligence: 6, charisma: 6, combatSkill: 3, hp: 10, maxHp: 40 }, foe = { hp: 50 };
  D.CARDS.venom_edge.effect({}, me, foe, ctx);
  D.CARDS.shield_bash.effect({}, me, foe, ctx);
  check(foe.poison === 3 && foe.stun === 1 && foe.hp < 50, 'Venom Edge poisons, Shield Bash stuns');
  const f2 = { hp: 100 };
  D.CARDS.last_stand.effect({}, me, f2, ctx);
  const f3 = { hp: 100 };
  D.CARDS.last_stand.effect({}, { ...me, hp: 40 }, f3, ctx);
  check(100 - f2.hp > 100 - f3.hp, 'Last Stand hits harder when hurt');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'town',2000,1000,500,500,500,-72000-$3,-72000,NOW()) RETURNING id`, [u.id, username, seq])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const C = require('../lib/cards');

  console.log('Collection');
  const a = await player('cards');
  let r = await api(a, 'GET', '/api/cards');
  check(r.status === 200 && r.body.owned.length === 9 && r.body.cards.some(c => c.key === 'venom_edge' && !c.owned), 'GET /api/cards: the starter nine owned, the rest locked');
  const deck = { strike: 5, defend: 5, quick_jab: 1, venom_edge: 1 };
  r = await api(a, 'POST', '/api/decks', { name: 'Test', cards: deck });
  check(r.status === 400 && /haven't unlocked Venom Edge/.test(r.body.error), 'a deck can\'t use a card you haven\'t unlocked');
  const got = await C.unlock(null, a.sid, 'venom_edge', 'test');
  check(got && got.name === 'Venom Edge' && !(await C.unlock(null, a.sid, 'venom_edge', 'test')), 'unlock once (a second time is a no-op)');
  r = await api(a, 'POST', '/api/decks', { name: 'Test', cards: deck });
  check(r.status === 200, 'once unlocked it goes in a deck');
  const dk = await api(a, 'GET', '/api/decks');
  check(dk.body.catalog && dk.body.catalog.venom_edge.owned === true && dk.body.catalog.shield_bash.owned === false && dk.body.how_to_get, 'the deck builder sees what is owned and how to get the rest');

  console.log('Villages');
  const npc = (await q("SELECT id FROM npc_settlements WHERE COALESCE(disposition,'neutral') <> 'hostile' AND COALESCE(faction,'neutral') <> 'hostile' AND NOT COALESCE(is_kingdom, FALSE) ORDER BY id LIMIT 1")).rows[0];
  if (npc) {
    await q("INSERT INTO diplomacy_relations (settlement_id, npc_id, trust, status) VALUES ($1,$2,50,'friendly') ON CONFLICT (settlement_id, npc_id) DO UPDATE SET trust = 50", [a.sid, npc.id]);
    r = await api(a, 'GET', `/api/cards/village/${npc.id}`);
    check(r.status === 200 && r.body.cards.length === 2 && !r.body.allied, 'a village shows the two cards it teaches');
    const pick = r.body.cards.find(c => !c.owned) || r.body.cards[0];
    let b = await api(a, 'POST', `/api/cards/village/${npc.id}/${pick.key}`);
    check(b.status === 403 && /Allied/.test(b.body.error), 'only an Allied village teaches');
    await q('UPDATE diplomacy_relations SET trust = 80 WHERE settlement_id = $1 AND npc_id = $2', [a.sid, npc.id]);
    const w0 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [a.sid])).rows[0].wealth);
    b = await api(a, 'POST', `/api/cards/village/${npc.id}/${pick.key}`);
    const w1 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [a.sid])).rows[0].wealth);
    check((b.status === 200 && w0 - w1 === pick.price) || (pick.owned && b.status === 400), `Allied: learn it for ${pick.price} wealth` + (b.status === 200 ? '' : ' — ' + JSON.stringify(b.body)));
    b = await api(a, 'POST', `/api/cards/village/${npc.id}/${pick.key}`);
    check(b.status === 400, 'not twice');
  } else check(true, '(no villages on this map — village cards skipped)');

  console.log('Spoils');
  const S = require('../lib/spoils');
  const sp = await S.grant({ query: q }, a.sid, { drops: [{ item: 'hide', qty: 2 }, { item: 'no_such_thing', qty: 1 }], enemies: [], seedKey: 'x' });
  const hide = (await q("SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key='hide'", [a.sid])).rows[0].n;
  check(sp.items.length === 1 && sp.items[0].qty === 2 && hide === 2, 'loot goes into the stores (unknown items skipped)');
  await q(`INSERT INTO enemy_definitions (id, name, icon, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order, drops, biomes)
           VALUES ('r4_dummy','Straw Dummy','🎯',1,1,1,1,1,'flops at',5,999,'[{"item":"hide","chance":1,"min":1,"max":1}]','["ruins"]')
           ON CONFLICT (id) DO UPDATE SET max_hp=1, strength=1, reward_weight=5, drops=EXCLUDED.drops, archived=FALSE`);
  const always = { calls: 0 };
  const card = await C.rollBattle(null, a.sid, ['r4_dummy'], () => { always.calls++; return 0; });
  check(card && card.key, 'a big enemy can drop a card (25%)');

  console.log('Auto-resolved battles keep their loot');
  const b2 = await player('spoils');
  const c = (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, stats, life_stage)
                      VALUES ($1,'Brute','male','soldier','{"combat":9}','{"strength":14,"agility":12,"endurance":14}','adult') RETURNING id`, [b2.sid])).rows[0];
  const run = (await q(`INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, completes_at, status, quest_type,
                          combat_status, combat_trigger_at, combat_seed, combat_encounter, auto_resolve_combat)
                        VALUES ($1,$2,'q_gather_herbs',$3,NOW() + interval '1 hour','active','solo','rolled',NOW() - interval '1 minute',7,'["r4_dummy"]',TRUE) RETURNING id`,
    [b2.sid, b2.id, c.id])).rows[0];
  const quests = require('../routes/quests');
  await quests.processCombatTriggers(b2.sid);
  const row = (await q('SELECT combat_status, combat_outcome FROM settlement_quests WHERE id=$1', [run.id])).rows[0];
  const hides = async () => (await q("SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key='hide'", [b2.sid])).rows[0].n;
  check(row.combat_status === 'resolved' && row.combat_outcome === 'victory', 'the auto-resolved fight is won');
  const h1 = await hides();
  check(h1 === 1, `its loot is in the stores (${h1} hide)`);
  await quests.processCombatTriggers(b2.sid);
  check(await hides() === h1, 'and only once');

  console.log('Enemies of the land');
  const TG = require('../lib/time_gates');
  const ids = new Set();
  for (let i = 0; i < 12; i++) ids.add((await TG.pickRandomEnemy(Date.parse('2026-06-01T12:00:00Z'), q, [], 'hills'))[0]);
  const rows = (await q('SELECT id, biomes FROM enemy_definitions WHERE id = ANY($1::text[])', [[...ids]])).rows;
  check(rows.length === ids.size && rows.every(e => !e.biomes || e.biomes.includes('hills')), `hills quests meet hill creatures (${[...ids].join(', ')})`);
  const moved = (await q("SELECT jsonb_array_length(moves) AS n FROM enemy_definitions WHERE id IN ('hill_ogre','bog_lurker','rot_shaman')")).rows;
  check(moved.length === 3 && moved.every(m => m.n === 2), 'the new creatures have two moves each');
  const R = require('../lib/combat_resolver');
  const auto = await R.autoResolveBattle({ citizenIds: [c.id], enemyKeys: ['bog_lurker'], seed: 3 });
  check(auto && (auto.outcome === 'victory' || auto.outcome === 'defeat'), `a fight with a Bog Lurker runs to the end (${auto && auto.outcome})`);
  await q("UPDATE enemy_definitions SET archived = TRUE WHERE id = 'r4_dummy'");

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and QUEST_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
