// A quest's battle fought on the board (docs/TACTICS.md §8 step 3; lib/tactics_quests.js).
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/tactics_quest_test.js
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

async function main() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const E = require('../lib/tactics_engine');
  const T = require('../lib/tactics_setup');
  const F = require('../lib/tactics_foes');
  const TU = require('../lib/tuning');
  const XP = require('../lib/tactics_xp');
  const RUN = Date.now().toString(36);
  let seq = 0;
  // A town with a Guard, an Archer and two with no job; `strong` ones win their fights, weak ones lose them.
  async function player(name, strong = true) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, 29000 + (Date.now() % 100000) + seq * 40])).rows[0];
    const stats = strong ? { strength: 24, agility: 14, endurance: 18, intelligence: 12, charisma: 10 } : { strength: 1, agility: 1, endurance: 1, intelligence: 1, charisma: 1 };
    const roles = ['soldier', 'archer', 'idle', 'idle'], cits = [];
    for (let i = 0; i < roles.length; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify(stats), JSON.stringify({ combat: strong ? 6 : 1 })])).rows[0].id);
    return { id: u.id, sid: s.id, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // A quest under way whose fight is waiting on the player, as processCombatTriggers leaves it.
  async function waiting(p, { party = null, citizen = null, encounter = ['night_wolf'], seed = 11, mods = null } = {}) {
    return (await q(
      `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, party_ids, completes_at, status, quest_type,
                                      combat_status, combat_trigger_at, combat_seed, combat_encounter, combat_clock_paused_at, combat_mods, auto_resolve_combat)
       VALUES ($1,$2,'q_gather_herbs',$3,$4,NOW() + interval '1 hour','active',$5,'pending',NOW() - interval '1 minute',$6,$7,NOW() - interval '10 minutes',$8,FALSE) RETURNING id`,
      [p.sid, p.id, party ? null : citizen, JSON.stringify(party || []), party ? 'party' : 'solo', seed, JSON.stringify(encounter), mods ? JSON.stringify(mods) : null])).rows[0].id;
  }
  const runOf = async id => (await q('SELECT * FROM settlement_quests WHERE id=$1', [id])).rows[0];
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  // Fight a battle through the routes, the engine's mind choosing for the party. → the last answer.
  async function fight(p, battleId, { until = null } = {}) {
    let bt = (await api(p, 'GET', '/api/tactics/battles/' + battleId)).body.battle, last = null;
    const st = E.replay(bt.setup, bt.actions).state;
    let n = bt.count;
    for (let g = 0; g < 500 && st.status === 'active'; g++) {
      if (until && until(st)) break;
      const u = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const a of acts) {
        if (st.status !== 'active' || !E.apply(st, a)) continue;
        last = await api(p, 'POST', `/api/tactics/battles/${battleId}/act`, { n: n++, action: a });
        if (last.status !== 200) return { last, st, broke: true };
      }
    }
    return { last, st };
  }
  const wasQ = await TU.switchOn('tactics.quests'), wasD = await TU.switchOn('dungeons.on');
  try {
    console.log('Who is offered the board');
    await TU.setSwitch('tactics.quests', false); await TU.setSwitch('dungeons.on', false);
    const a = await player('Quest');
    const [guard, archer, v1, v2] = a.cits;
    let run1 = await waiting(a, { citizen: guard });
    let r = await api(a, 'GET', '/api/combat/pending');
    check(r.status === 200 && r.body.board === 'off' && r.body.battles.length === 1 && r.body.battles[0].board_battle === null, 'while the switch is off a player\'s Battles list says: with cards');
    check((await api(a, 'POST', '/api/tactics/quest/' + run1)).status === 403 && (await api(a, 'GET', '/api/tactics/open')).body.quests === 'off', 'and the board is refused');
    check((await TU.lifeAll()).filter(n => n.group === 'Quest battles').map(n => n.key).join() === 'QUEST_FOE_HP,QUEST_FOE_POW' && T.QUEST.hp === TU.LIFE_KEYS.QUEST_FOE_HP.default && T.QUEST.str === TU.LIFE_KEYS.QUEST_FOE_POW.default,
      'how tough a quest\'s foes are is two numbers in Dev Tools, starting from the game\'s own');
    await TU.setSwitch('tactics.quests', true);
    r = await api(a, 'GET', '/api/combat/pending');
    check(r.body.board === 'on' && (await api(a, 'GET', '/api/tactics/open')).body.quests === 'on' && (await api(a, 'GET', '/api/tactics/open')).body.dungeons === false, 'with the switch on, every player\'s quest battles are on the board (dungeons stay as they were)');

    console.log('A quest\'s battle on the board');
    r = await api(a, 'POST', '/api/tactics/quest/' + run1);
    let bt = r.body.battle;
    check(r.status === 200 && bt && bt.source === 'quest' && bt.quest_run_id === run1 && bt.tier === 'quest' && bt.status === 'active' && bt.seed === 11, 'the quest\'s battle is opened on the board, with the quest\'s own seed');
    check(bt.setup.party.length === 1 && bt.setup.party[0].citizen_id === guard && bt.setup.party[0].cls === 'guard' && bt.setup.enemies.length === 1 && bt.setup.enemies[0].key === 'wolf_raider'
      && bt.setup.enemies[0].maxHp === Math.round(F.foe('wolf_raider').hp * (1 + T.QUEST.hp)) && LANDS().includes(bt.setup.land),
      'the quest\'s citizen in her own class, against the foe that stands in for its creature, at the quest tier', `a Wolf Raider with ${bt.setup.enemies[0].maxHp} health`);
    check((await runOf(run1)).combat_status === 'in_progress', 'the quest is marked as being fought');
    const again = await api(a, 'POST', '/api/tactics/quest/' + run1);
    check(again.status === 200 && again.body.battle.id === bt.id, 'asked again, it is the same battle (to pick it up after closing the page)');
    r = await api(a, 'GET', '/api/combat/pending');
    check(r.body.battles[0].board_battle === bt.id && r.body.battles[0].board_foes.join() === 'Wolf Raider', 'the Battles list knows the fight has been begun on the board, and who the creature is there');
    check((await api(a, 'POST', '/api/combat/engage/' + run1)).status === 400, 'begun on the board, it cannot also be fought with cards');
    check((await api(a, 'GET', '/api/tactics/battles/current')).body.battle === null, 'a quest\'s battle is not the town\'s "current" battle: it is reached from its quest');
    // Stepping away leaves it open.
    r = await api(a, 'POST', `/api/tactics/battles/${bt.id}/leave`);
    check(r.status === 200 && r.body.battle.status === 'active' && (await runOf(run1)).combat_status === 'in_progress', 'stepping away from it leaves the battle, and the quest, waiting');
    // Win it.
    const w0 = await wealth(a), before = await runOf(run1);
    let f = await fight(a, bt.id);
    const qd = f.last.body.quest, rw = f.last.body.rewards;
    const after = await runOf(run1);
    check(f.st.status === 'victory' && qd && qd.outcome === 'victory' && after.combat_status === 'resolved' && after.combat_outcome === 'victory' && after.status === 'active' && after.combat_clock_paused_at === null,
      'won: the battle is recorded on the quest, which goes on', `${f.st.round} rounds`);
    const moved = new Date(after.completes_at) - new Date(before.completes_at);
    check(moved > 9 * 60000 && moved < 12 * 60000, 'its clock runs on from where it stopped: the ten minutes it waited are given back', `${Math.round(moved / 60000)} minutes`);
    const worth = Math.min(200, await T.rewardOf(['wolf_raider']));
    check(qd.wealth === worth && worth > 0 && (await wealth(a)) === w0 + worth, 'the fight\'s wealth is paid', `+${worth}`);
    const drops = await T.dropsFor(['wolf_raider'], 11);
    check(qd.items.length === drops.length && drops.every(d => qd.items.some(i => i.item_key === d.item && i.qty === d.qty)), 'what the foe carried goes into the stores, the same for the same battle', drops.map(d => `${d.qty} ${d.item}`).join(', ') || 'nothing this time');
    const xp = XP.xpOf(['wolf_raider'], 'quest'), row = rw && rw.party && rw.party[0];
    check(rw && rw.kept === true && rw.xp === xp && rw.party.length === 1 && row.citizen_id === guard && row.class_key === 'soldier' && row.gain === (row.down ? Math.round(xp / 2) : xp)
      && Math.abs(Number((await q(`SELECT xp FROM citizen_classes WHERE citizen_id=$1 AND class_key='soldier'`, [guard])).rows[0].xp) - row.after.xp) < 1,
      'a fight that is won pays experience into her class at once, for the screen to show', `+${row && row.gain} Guard`);
    check((f.last.body.rolls || []).length === (f.st.units.find(u => u.citizen_id === guard).down ? 1 : 0) && (qd.injuries || []).length <= 1, 'nobody who is standing at the end rolls for injury');
    check(Array.isArray(qd.upgraded) && qd.upgraded.every(x => x.id === guard && x.combat >= 2), 'a survivor may come back a better fighter, as before');
    check((await api(a, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 999, action: { t: 'end' } })).status !== 200 && (await wealth(a)) === w0 + worth && (await api(a, 'POST', '/api/tactics/quest/' + run1)).status === 400,
      'a battle that is over takes no more turns, pays nothing more, and the quest has no battle left to open');
    check((await api(a, 'GET', '/api/combat/pending')).body.battles.length === 0, 'and it is gone from the Battles list');

    console.log('A party, a Happening, and losing');
    const run2 = await waiting(a, { party: [guard, archer, v1], encounter: ['wild_fox', 'marsh_rat'], seed: 23, mods: { enemy_health: 0.5 } });
    bt = (await api(a, 'POST', '/api/tactics/quest/' + run2)).body.battle;
    check(bt.setup.party.map(u => u.cls).join() === 'guard,archer,villager' && bt.setup.enemies.map(e => e.key).join() === 'fox_footpad,rat_cutpurse'
      && bt.setup.enemies[0].maxHp === Math.round(F.foe('fox_footpad').hp * (1 + T.QUEST.hp + 0.5)),
      'a party quest brings its whole party, each in their class; a Happening that toughens creatures toughens these too');
    f = await fight(a, bt.id);
    check(f.st.status === 'victory' && f.last.body.rewards.party.length === 3 && f.last.body.quest.wealth === Math.min(200, await T.rewardOf(['fox_footpad', 'rat_cutpurse'])), 'three citizens win it and each is paid experience');
    const weak = await player('Weak', false);
    const run3 = await waiting(weak, { party: weak.cits.slice(0, 2), encounter: ['thornback_boar', 'night_wolf', 'night_wolf'], seed: 5 });
    bt = (await api(weak, 'POST', '/api/tactics/quest/' + run3)).body.battle;
    const ww = await wealth(weak);
    f = await fight(weak, bt.id);
    const lost = await runOf(run3), lq = f.last.body.quest;
    check(f.st.status === 'defeat' && lq.outcome === 'defeat' && lost.status === 'failed' && lost.combat_outcome === 'defeat' && lost.combat_status === 'resolved' && (await wealth(weak)) === ww && !f.last.body.rewards,
      'lost: the quest fails, and nothing is paid or taught');
    const kinds = ['none', 'scratch', 'wound', 'scar', 'crippling', 'fatal'], rolls = f.last.body.rolls || [];
    check(rolls.length === 2 && rolls.every(x => kinds.includes(x.severity) && x.name && x.no_fatal === false) && rolls.filter(x => x.severity !== 'none').length === lq.injuries.length
      && rolls.filter(x => x.narrative).every(x => /Boar Bruiser/.test(x.narrative) && /^[A-Z]/.test(x.narrative)),
      'everyone who lost rolls for injury, shown one by one, and the line names the foe of the board', rolls.map(x => x.severity).join(', '));

    console.log('The record, and a fight left to be decided');
    r = await api(a, 'GET', '/api/combat/report/' + run1);
    check(r.status === 200 && r.body.outcome === 'victory' && r.body.foes && r.body.foes.join() === 'Wolf Raider' && r.body.battle_state.board === true
      && r.body.battle_state.units.filter(u => u.side === 'player').length === 1 && r.body.battle_state.units[0].citizen_id === guard && /Fought on the board: won in \d+ round/.test(r.body.log[0]),
      'the battle report of a fight on the board says who was fought there, who stood at the end, and how it went', r.body.log && r.body.log[0]);
    r = await api(weak, 'GET', '/api/combat/report/' + run3);
    check(r.body.outcome === 'defeat' && r.body.foes.join() === 'Boar Bruiser,Wolf Raider,Wolf Raider' && r.body.injury_events.length === lq.injuries.length, 'and a lost one, with the wounds it left');
    // Left to be decided, with the switch on: the board's mind decides it as the fight is triggered.
    const auto = async (p, citizen, encounter, seed) => (await q(
      `INSERT INTO settlement_quests (settlement_id, user_id, quest_id, citizen_id, party_ids, completes_at, status, quest_type, combat_status, combat_trigger_at, combat_seed, combat_encounter, auto_resolve_combat)
       VALUES ($1,$2,'q_gather_herbs',$3,'[]',NOW() + interval '1 hour','active','solo','rolled',NOW() - interval '1 minute',$4,$5,TRUE) RETURNING id`, [p.sid, p.id, citizen, seed, JSON.stringify(encounter)])).rows[0].id;
    const quests = require('../routes/quests');
    const run8 = await auto(a, guard, ['marsh_rat'], 77);
    await quests.processCombatTriggers(a.sid);
    let dec = await runOf(run8);
    check(dec.combat_status === 'resolved' && dec.combat_outcome === 'victory' && dec.status === 'active' && dec.combat_state && dec.combat_state.board === true && dec.combat_state.foes.join() === 'Rat Cutpurse'
      && /^Decided on the board: won in \d+ round/.test(dec.combat_log[0]) && (await q(`SELECT COUNT(*)::int AS n FROM tactics_battles WHERE quest_run_id=$1`, [run8])).rows[0].n === 0,
      'with the switch on, a fight left to be decided is decided by the board\'s mind, out of sight: no battle is kept for it, and the quest goes on', dec.combat_log && dec.combat_log[0]);
    check((await api(a, 'GET', '/api/combat/report/' + run8)).body.foes.join() === 'Rat Cutpurse' && (await api(a, 'GET', '/api/combat/pending')).body.battles.every(b => b.id !== run8), 'it has its report, and never waits in the Battles list');
    const run9 = await auto(weak, weak.cits[2], ['thornback_boar', 'night_wolf'], 78);
    await quests.processCombatTriggers(weak.sid);
    dec = await runOf(run9);
    check(dec.combat_outcome === 'defeat' && dec.status === 'failed' && dec.combat_state.board === true && dec.combat_state.units.find(u => u.side === 'player').flags.downed === true, 'a weak citizen left to it loses, and the quest fails');
    // The same battle decided twice is decided the same way.
    const TQ = require('../lib/tactics_quests');
    const setupA = await TQ.build(await runOf(run8), { q }), setupB = await TQ.build(await runOf(run8), { q });
    const endA = E.autoplay({ seed: setupA.seed, land: setupA.land, party: setupA.party, enemies: setupA.enemies }, 600), endB = E.autoplay({ seed: setupB.seed, land: setupB.land, party: setupB.party, enemies: setupB.enemies }, 600);
    check(endA.status === 'victory' && E.checksum(endA) === E.checksum(endB), 'the decision comes from the quest\'s own seed: the same fight is always decided the same way');
    // With the switch off the card engine decides, as before.
    await TU.setSwitch('tactics.quests', false);
    const run10 = await auto(a, guard, ['marsh_rat'], 79);
    await quests.processCombatTriggers(a.sid);
    dec = await runOf(run10);
    check(dec.combat_status === 'resolved' && !(dec.combat_state && dec.combat_state.board) && !/on the board/.test(JSON.stringify(dec.combat_log)), 'with the switch off, a fight left to be decided is the card engine\'s, as before');
    await TU.setSwitch('tactics.quests', true);
    r = await api(a, 'GET', '/api/combat/pending');

    console.log('Giving up, and the admin\'s choice');
    const run4 = await waiting(a, { citizen: archer });
    bt = (await api(a, 'POST', '/api/tactics/quest/' + run4)).body.battle;
    await fight(a, bt.id, { until: st => st.round >= 2 });
    r = await api(a, 'POST', '/api/combat/forfeit/' + run4);
    check(r.status === 200 && (await runOf(run4)).status === 'failed' && (await api(a, 'GET', '/api/tactics/battles/' + bt.id)).body.battle.status === 'left', 'forfeiting from the Battles list fails the quest and closes its battle on the board');
    check((await api(a, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'end' } })).status !== 200, 'which then takes no more turns');
    // Begun with cards: it is finished with cards.
    const run5 = await waiting(a, { citizen: v2 });
    await q(`UPDATE settlement_quests SET combat_actions='[{"action_key":"end_turn"}]' WHERE id=$1`, [run5]);
    check((await api(a, 'POST', '/api/tactics/quest/' + run5)).status === 400, 'a battle already begun with cards is not moved to the board');
    await q(`UPDATE settlement_quests SET status='failed', combat_status='resolved' WHERE id=$1`, [run5]);
    const other = await player('Other');
    const run6 = await waiting(a, { citizen: v2 });
    check((await api(other, 'POST', '/api/tactics/quest/' + run6)).status === 404 && (await api(a, 'POST', '/api/tactics/quest/999999999')).status === 404 && (await api(a, 'POST', '/api/tactics/quest/abc')).status === 404, 'another town\'s quest, or no quest, is not found');
    // A dungeon's fight and a quest's fight can both be open.
    await TU.setSwitch('dungeons.on', true);
    const D = require('../lib/dungeons');
    const d = await player('Both');
    await q(`INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,'Fifth','female','idle','{"strength":20,"agility":12,"endurance":16}','{"combat":5}','adult')`, [d.sid]);
    const fifth = (await q(`SELECT id FROM citizens WHERE settlement_id=$1 AND name='Fifth'`, [d.sid])).rows[0].id;
    await D.startTest(d.id, 'test_green', d.cits);
    const db = (await api(d, 'POST', '/api/dungeons/run/move', { room: 'a' })).body.board_battle_id;
    const run7 = await waiting(d, { citizen: fifth });
    r = await api(d, 'POST', '/api/tactics/quest/' + run7);
    check(r.status === 200 && db > 0 && r.body.battle.id !== db && (await api(d, 'GET', '/api/tactics/battles/' + db)).body.battle.status === 'active' && (await api(d, 'GET', '/api/tactics/battles/current')).body.battle.id === db,
      'a town in a dungeon fight can still fight a quest\'s battle: neither pushes the other aside');
    f = await fight(d, r.body.battle.id);
    check(f.last.body.quest && (await api(d, 'GET', '/api/dungeons/run')).body.run.pending.battle_id === db, 'and finishing the one leaves the other as it was');
    await api(d, 'POST', '/api/dungeons/run/flee');
    // The switch off: an admin is offered both.
    await TU.setSwitch('tactics.quests', false);
    const adminId = Number(process.env.CRAFTING_TEST_ADMIN_ID) || 0;
    if (adminId) {
      const adm = { token: jwt.sign({ userId: adminId, username: 'admin', species: 'Mice' }, SECRET) };
      r = await api(adm, 'GET', '/api/tactics/open');
      check(r.body.quests === 'choice' && (await api(adm, 'GET', '/api/combat/pending')).body.board === 'choice', 'with the switch off an admin is offered both ways to fight');
      check((await api(adm, 'POST', '/api/tactics/admin/quests-switch', { on: true })).body.on === true && (await TU.switchOn('tactics.quests')) === true && (await api(a, 'POST', '/api/tactics/admin/quests-switch', { on: false })).status === 403,
        'and an admin, and only an admin, can turn the switch');
    }
  } finally { await TU.setSwitch('tactics.quests', wasQ); await TU.setSwitch('dungeons.on', wasD); await pool.end(); }
}
const LANDS = () => ['plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(no DATABASE_URL: skipped)'); process.exit(0); }
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
