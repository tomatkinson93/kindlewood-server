// ══════════════════════════════════════════════════════════════════════════
//  rares_test — things to make from obsidian, moonsilver, mithril, gems and
//  gold ore (migrations/0NN_rares.sql), and the items that used to only sell.
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 node scripts/rares_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  console.log('Definitions');
  const npc = require('../lib/npc_trade');
  const src = require('fs').readFileSync(require.resolve('../lib/npc_trade.js'), 'utf8');
  check(['goldore', 'gems', 'obsidian'].every(k => new RegExp(`REQUEST_RESOURCES = \\[[^\\]]*'${k}'`).test(src)), 'villages can ask for gold ore, gems and obsidian');
  void npc;
  const RS = require('../lib/research_defs');
  check(RS.PROJECTS.meteor_hunting.effects['ore:obsidian'] === 0.25 && RS.PROJECTS.meteor_hunting.effects['ore:moonsilver'] === 0.25, 'Meteor Hunting does something now: more obsidian and moonsilver');
}

async function part2() {
  const { pool } = require('../db');
  const crafting = require('../lib/crafting');
  const careers = require('../lib/careers');
  const research = require('../lib/research');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const username = 'rares_' + RUN;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, username + '@t.l'])).rows[0];
  const sid = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, timber, stone, metal, steel, silver, goldore, gems, obsidian, moonsilver, mithril, coal, last_tick)
                        VALUES ($1,$2,2,1000,500,500,500,500,50,50,50,50,50,50,50,50,NOW()) RETURNING id`, [u.id, username])).rows[0].id;
  for (const [t, l] of [['smithy', 3], ['jeweller', 3], ['smelter', 3], ['workshop', 3]]) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [sid, t, l]);
  const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
  const api = async (method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  async function crafter(role, name) {
    const id = (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
       VALUES ($1,$2,$3,'{"strength":8,"agility":8,"endurance":8,"intelligence":8,"charisma":8}','{"crafting":1}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`, [sid, name, role])).rows[0].id;
    await careers.adminGrant(sid, id, role, { level: 20 });
    return id;
  }
  const item = (key, n) => q("INSERT INTO inventory_items (settlement_id,item_key,name,icon,category,quantity) VALUES ($1,$2,$2,'•','material',$3)", [sid, key, n]);
  const count = async key => Number((await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [sid, key])).rows[0].n);
  const stores = async () => (await q('SELECT wealth, steel, silver, goldore, gems, obsidian, moonsilver, mithril, coal, metal FROM settlements WHERE id=$1', [sid])).rows[0];
  async function make(cid, recipe) {
    const r = await api('POST', '/api/crafting/jobs', { citizen_id: cid, recipe_key: recipe, qty: 1 });
    if (r.status !== 200) return r;
    const job = (await q("SELECT id FROM craft_jobs WHERE citizen_id=$1 AND status IN ('active','queued') ORDER BY id DESC LIMIT 1", [cid])).rows[0];
    await q("UPDATE craft_jobs SET started_at = NOW() - interval '9 hours', completes_at = NOW() - interval '8 hours' WHERE id = $1", [job.id]);
    await crafting.resolveDue(sid, { rand: () => 0.5 });
    return r;
  }

  const jw = await crafter('jeweller', 'Opal'), bs = await crafter('blacksmith', 'Fenn'), cp = await crafter('carpenter', 'Ash'), sm = await crafter('smelter', 'Cinder');

  console.log('Research comes first');
  let r = await api('GET', '/api/crafting/station/jeweller');
  const opal = r.body.crafters.find(c => c.id === jw);
  check(opal && /research/i.test(opal.can.gemset_ring || ''), 'the Gem-set Ring waits for its research');
  for (const k of ['deep_veins', 'volcanic_lore', 'moon_lore', 'starmetal']) await research.adminComplete(sid, k);

  console.log('Crafting');
  let before = await stores();
  await make(jw, 'gemset_ring');
  let after = await stores();
  check(await count('gemset_ring') === 1 && before.gems - after.gems === 3 && before.goldore - after.goldore === 2, 'a Gem-set Ring: 3 gems and 2 gold ore');
  before = await stores();
  await make(sm, 'gold_ingots');
  after = await stores();
  check(after.wealth - before.wealth === 60 && before.goldore - after.goldore === 3, 'Gold Ingots turn 3 gold ore into 60 wealth');
  await item('timber_bundle', 2);
  before = await stores();
  r = await make(cp, 'obsidian_axe');
  check(r.status === 200 && await count('obsidian_axe') === 1 && await count('timber_bundle') === 0 && before.obsidian - (await stores()).obsidian === 3, 'an Obsidian Axe uses up Timber Bundles (they used to only sell)');
  await item('luminous_scale', 1);
  await make(jw, 'moonsilver_charm');
  check(await count('moonsilver_charm') === 1 && await count('luminous_scale') === 0, 'a Moonsilver Charm uses a Luminous Scale');
  await make(bs, 'obsidian_blade');
  const blade = (await q("SELECT metadata FROM inventory_items WHERE settlement_id=$1 AND item_key='obsidian_blade'", [sid])).rows[0];
  check(blade && blade.metadata.damage_dice === '1d8', 'the Obsidian Blade carries its damage dice into battle');

  console.log('Masterpieces and their schematics');
  r = await api('GET', '/api/crafting/station/smithy');
  const fenn = r.body.crafters.find(c => c.id === bs);
  check(fenn && fenn.can.mithril_blade && /schematic|not known/i.test(fenn.can.mithril_blade), 'the Mithril Blade has to be learned first');
  const sch = (await q("SELECT rarity FROM item_templates WHERE item_key IN ('schematic_mithril_blade','schematic_mithril_mail','schematic_moonsilver_circlet','schematic_gilded_crown')")).rows;
  check(sch.length === 4 && sch.every(x => x.rarity === 'epic'), 'their schematics are epic — Allied villages sell them');
  await crafting.learnRecipe({ query: q }, sid, 'mithril_mail', 'admin');
  before = await stores();
  await make(bs, 'mithril_mail');
  const mail = (await q("SELECT metadata FROM inventory_items WHERE settlement_id=$1 AND item_key='mithril_mail'", [sid])).rows[0];
  check(mail && mail.metadata.armor_class === 8 && before.mithril - (await stores()).mithril === 4, 'once learned: Mithril Mail, armour class 8, 4 mithril');

  console.log('Old items made useful');
  const ring = (await q("SELECT item_effects FROM item_templates WHERE item_key = 'gold_ring'")).rows[0];
  check(ring && Array.isArray(ring.item_effects) && ring.item_effects.some(e => e.type === 'mood'), 'the Gold Ring lifts its wearer\'s mood');
  const inputs = (await q("SELECT inputs FROM recipes WHERE recipe_key IN ('moonsilver_circlet','gilded_crown','healers_satchel')")).rows.flatMap(x => (x.inputs.items || []).map(i => i.item_key));
  check(['wool', 'ancient_coin', 'blightbane_herb'].every(k => inputs.includes(k)), 'wool, ancient coins and blightbane herb are recipe inputs now');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CRAFTING_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
