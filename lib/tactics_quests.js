// ══════════════════════════════════════════════════════════════════════════
//  tactics_quests — a quest's, camp's or raid's battle, fought on the board
//  (docs/TACTICS.md §8 step 3, Phase 5).
//
//  A fight on the road is a row in settlement_quests whose combat_status is
//  'pending': its creatures, its seed and the party's frozen modifiers are
//  already there (routes/quests.js processCombatTriggers). Until now the
//  player fought it with cards (routes/combat.js). Here it becomes a tactics
//  battle that names the quest run (tactics_battles.quest_run_id): the
//  quest's citizens, in their own classes, against the foes that stand in
//  for its creatures, at the 'quest' tier (lib/tactics_setup.js QUEST).
//
//  When the battle ends, the quest is settled exactly as the card battle
//  settled it (routes/combat.js POST /resolve is the model, line for line):
//    won    the quest's clock runs on from where it stopped; the fight's
//           wealth and what the foes carried are paid; survivors may gain
//           combat skill; anyone down at the end rolls for injury; a camp or
//           a sally is told (lib/raid_camps.js)
//    lost   the quest fails; everyone rolls for injury
//  and, new with the board, a won fight pays experience into class levels
//  at once (lib/tactics_xp.js), which the end screen shows.
//
//  Who gets the board: everyone once the switch `tactics.quests` is on.
//  While it is off players fight with cards as before, and an admin is
//  offered both (mode() says which).
//
//    mode(user)                  'on' | 'choice' | 'off'
//    open(user, questRunId)      the quest's battle, made if it is not there
//    resolved(client, bt, state) in the transaction that stores the last choice
//    after(hook)                 once it has committed → { quest, rewards, rolls }
//    closeFor(questRunId, q)     a quest forfeited or ended some other way
//
//  Not here yet: fights the player leaves to be decided for them
//  (auto_resolve_combat) are still played out by the card engine.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const E = require('./tactics_engine');
const SETUP = require('./tactics_setup');
const F = require('./tactics_foes');
const TU = require('./tuning');
const { isAdminUser } = require('../middleware/admin');

const MAX_BATTLE_WEALTH = 200;     // as routes/combat.js
const COMBAT_SKILL_CAP = 10;
const LANDS = ['plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];
const err = (status, msg) => Object.assign(new Error(msg), { status });
const arr = v => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (e) { return []; } })() : []);
const partyOf = run => ((run.quest_type === 'party' && Array.isArray(run.party_ids) && run.party_ids.length) ? run.party_ids : [run.citizen_id]).filter(Boolean).map(Number);

async function mode(user) {
  if (await TU.switchOn('tactics.quests')) return 'on';
  return isAdminUser(user) ? 'choice' : 'off';
}

// The quest's battle on the board: the one already open for it, or a new one.
async function open(user, questRunId) {
  if ((await mode(user)) === 'off') throw err(403, 'Battles on the board are not open yet.');
  const B = require('./tactics_battles');
  const id = Math.floor(Number(questRunId));
  return withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const s = (await q('SELECT id FROM settlements WHERE user_id=$1', [user.userId])).rows[0];
    const run = s && id > 0 && (await q(`SELECT * FROM settlement_quests WHERE id=$1 AND settlement_id=$2 AND status='active' FOR UPDATE`, [id, s.id])).rows[0];
    if (!run) throw err(404, 'Quest not found.');
    if (!['pending', 'in_progress'].includes(run.combat_status)) throw err(400, 'No battle awaiting on that quest.');
    const have = (await q(`SELECT * FROM tactics_battles WHERE quest_run_id=$1 AND status='active'`, [run.id])).rows[0];
    if (have) return B.view(have);
    if (arr(run.combat_actions).length) throw err(400, 'This battle was begun with cards. Finish it there.');
    const party = await SETUP.partyFor(partyOf(run), { mods: run.combat_mods || null });
    if (!party.length) throw err(400, 'Nobody is left to fight this battle.');
    let encounter = arr(run.combat_encounter);
    if (!encounter.length) encounter = ['marsh_rat'];
    // A Happening's hand on the creatures (frozen on the run when the fight was triggered) carries over.
    const mods = run.combat_mods || {}, boost = { hp: Number(mods.enemy_health) || 0, str: Number(mods.enemy_strength) || 0 };
    const enemies = await SETUP.foesFor(encounter, 'quest', boost, q);
    const def = (await q('SELECT title, icon FROM quest_definitions WHERE id=$1', [run.quest_id]).catch(() => ({ rows: [] }))).rows[0] || {};
    const land = await require('../routes/quests').questBiome(run).catch(() => null);
    const setup = {
      seed: Number(run.combat_seed) || 1, land: LANDS.includes(land) ? land : 'forest', tier: 'quest', skull: '⚔', name: def.title || 'A fight on the road',
      fight: 'fight', level: 'as_is', species: await SETUP.speciesOf(user.userId, q), party, enemies, quest: { run: run.id, quest: run.quest_id },
    };
    const row = (await q(
      `INSERT INTO tactics_battles (settlement_id, user_id, source, seed, land, tier, fight, setup, quest_run_id) VALUES ($1,$2,'quest',$3,$4,'quest','fight',$5,$6) RETURNING *`,
      [s.id, user.userId, setup.seed, setup.land, JSON.stringify(setup), run.id])).rows[0];
    await q(`UPDATE settlement_quests SET combat_status='in_progress' WHERE id=$1`, [run.id]);
    return B.view(row);
  });
}

// The battle has just ended (lib/tactics_battles.js act, same transaction): the quest's row is settled
// and the wealth paid. Everything that may fail without undoing the battle waits for after().
async function resolved(client, bt, state) {
  const q = (t, p) => client.query(t, p);
  const run = (await q('SELECT * FROM settlement_quests WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [bt.quest_run_id, bt.settlement_id])).rows[0];
  if (!run || !['pending', 'in_progress', 'rolled'].includes(run.combat_status)) return { stale: true, sid: bt.settlement_id, runId: bt.quest_run_id };
  const won = state.status === 'victory';
  const keys = (bt.setup.enemies || []).map(e => e.key);
  const mine = state.units.filter(u => u.side === 'player');
  const log = [`Fought on the board: ${won ? 'won' : 'lost'} in ${state.round} round${state.round === 1 ? '' : 's'}.`];
  let wealth = 0;
  if (won) {
    // The quest's clock was stopped while the fight waited: it runs on from where it stopped.
    const paused = run.combat_clock_paused_at ? Math.max(0, Date.now() - new Date(run.combat_clock_paused_at).getTime()) : 0;
    await q(
      `UPDATE settlement_quests SET combat_status='resolved', combat_outcome='victory', combat_resolved_at=NOW(), combat_log=$1, combat_clock_paused_at=NULL,
              completes_at = completes_at + ($2 || ' milliseconds')::interval WHERE id=$3`, [JSON.stringify(log), String(paused), run.id]);
    wealth = Math.max(0, Math.min(MAX_BATTLE_WEALTH, Math.round(await SETUP.rewardOf(keys, q))));
    if (wealth > 0) await q('UPDATE settlements SET wealth = wealth + $1 WHERE id=$2', [wealth, bt.settlement_id]);
  } else {
    await q(
      `UPDATE settlement_quests SET combat_status='resolved', combat_outcome='defeat', combat_resolved_at=NOW(), combat_log=$1,
              status='failed', completes_at=NOW(), combat_clock_paused_at=NULL WHERE id=$2`, [JSON.stringify(log), run.id]);
  }
  return {
    sid: bt.settlement_id, userId: bt.user_id, runId: run.id, run, won, keys, wealth, seed: bt.seed, tier: bt.tier,
    units: mine.map(u => ({ citizen_id: u.citizen_id, name: u.name, cls: u.cls, down: !!u.down, hp: Math.max(0, u.hp) })),
  };
}

// Once the battle's transaction has committed: injuries, what the foes carried, experience, the news.
// → { quest: { outcome, wealth, items, upgraded, injuries, raid_battle }, rewards, rolls }
async function after(hook) {
  if (!hook) return null;
  if (hook.stale) return { quest: { outcome: null, stale: true }, rewards: null, rolls: [] };
  const CR = require('./combat_resolver'), bus = require('./event_bus');
  const outcome = hook.won ? 'victory' : 'defeat';
  const out = { outcome, quest_run_id: hook.runId, wealth: hook.wealth, items: [], upgraded: [], injuries: [], raid_battle: null };
  // Injuries, by the card battles' rule: lost, everyone rolls; won, only those lying fallen at the end.
  // (The resolver reads a battle's units; this is the board's battle in that shape.)
  const shim = { units: hook.units.map(u => ({ side: 'player', citizen_id: u.citizen_id, name: u.name, flags: { downed: u.down } })).concat([{ side: 'enemy', name: F.words(hook.keys[0]) || 'the enemy' }]) };
  const rolling = hook.units.filter(u => u.citizen_id && (!hook.won || u.down));
  try { out.injuries = await CR.applyBattleAftermath({ battle: shim, outcome, settlementId: hook.sid, questRunId: hook.runId, encounter: hook.keys }); } catch (e) { console.error('[tactics_quests] aftermath failed:', e.message); }
  const rolls = rolling.map(u => {
    const ev = out.injuries.find(x => Number(x.citizen_id) === Number(u.citizen_id));
    return { citizen_id: u.citizen_id, name: u.name, no_fatal: false, severity: ev ? (ev.event_type === 'death' ? 'fatal' : ev.severity) : 'none', body_part: ev ? ev.body_part : null, narrative: ev ? ev.narrative : null };
  });
  let rewards = null;
  if (hook.won) {
    // What the foes carried, rolled from the battle's seed.
    try { out.items = await require('./spoils').grantItems({ query }, hook.sid, await SETUP.dropsFor(hook.keys, hook.seed), 'battle'); } catch (e) { console.error('[tactics_quests] drops failed:', e.message); }
    // Experience, paid at once so the screen can show it; the careers' listener is told and only counts the battle.
    const XP = require('./tactics_xp'), xp = XP.xpOf(hook.keys, hook.tier);
    try { rewards = { kept: true, xp, party: await XP.award(hook.sid, hook.units.filter(u => u.citizen_id), xp) }; } catch (e) { console.error('[tactics_quests] experience failed:', e.message); }
    // A survivor may come back a better fighter, as after a card battle: one chance in two, up to the cap.
    const alive = hook.units.filter(u => u.citizen_id && !u.down).map(u => Number(u.citizen_id));
    if (alive.length) {
      const own = (await query('SELECT id, name, skills FROM citizens WHERE id = ANY($1) AND settlement_id=$2', [alive, hook.sid])).rows;
      for (const c of own) {
        if (Math.random() > 0.5) continue;
        const skills = c.skills || {}, cur = skills.combat || 1;
        if (cur >= COMBAT_SKILL_CAP) continue;
        skills.combat = cur + 1;
        await query('UPDATE citizens SET skills=$1 WHERE id=$2', [skills, c.id]);
        out.upgraded.push({ id: c.id, name: c.name, combat: skills.combat });
      }
    }
    try { require('./game_events').emit('battle_won', { settlementId: hook.sid, userId: hook.userId, enemyCount: hook.keys.length, citizenIds: alive, xpGranted: !!rewards }); } catch (e) { /* no listeners */ }
  }
  // A sally or a camp assault settles its own outcome (lib/raid_camps.js).
  try { out.raid_battle = await require('./raid_camps').onBattleEnded(hook.run, outcome); } catch (e) { console.error('[tactics_quests] raid battle failed:', e.message); }
  try {
    bus.publish(hook.sid, { type: 'combat_resolved', quest_run_id: hook.runId, outcome });
    if (!hook.won) bus.publish(hook.sid, { type: 'quest_resolved', quest_run_id: hook.runId, outcome: 'failed' });
  } catch (e) { /* offline */ }
  if (hook.won) require('../routes/quests').resolveCompletedQuests(hook.sid).catch(e => console.error('[tactics_quests] post-battle resolve failed:', e.message));
  return { quest: out, rewards, rolls };
}

// The quest's fight ended some other way (forfeited from the Battles list, the quest cancelled): its battle
// on the board, if there is one, is closed.
const closeFor = (questRunId, q) => (q || query)(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE quest_run_id=$1 AND status='active'`, [questRunId]).catch(() => {});

module.exports = { mode, open, resolved, after, closeFor, MAX_BATTLE_WEALTH };
