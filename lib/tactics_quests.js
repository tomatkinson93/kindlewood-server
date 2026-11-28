// ══════════════════════════════════════════════════════════════════════════
//  tactics_quests — a quest's, camp's, raid's or clan quest's battle, on
//  the board (docs/TACTICS.md §8 step 3, Phase 5).
//
//  A fight on the road is a row in settlement_quests whose combat_status is
//  'pending': its creatures, its seed and the party's frozen modifiers are
//  already there (routes/quests.js processCombatTriggers). The player fights
//  it as a tactics battle that names the quest run
//  (tactics_battles.quest_run_id): the quest's citizens, in their own
//  classes, against the foes that stand in for its creatures, at the 'quest'
//  tier (lib/tactics_setup.js QUEST).
//
//  When the battle ends, the quest is settled:
//    won    the quest's clock runs on from where it stopped; the fight's
//           wealth and what the foes carried are paid; survivors may gain
//           combat skill; anyone down at the end rolls for injury; a camp or
//           a sally is told (lib/raid_camps.js); experience is paid into
//           class levels at once (lib/tactics_xp.js), for the end screen
//    lost   the quest fails; everyone rolls for injury
//
//  A fight the player leaves to be decided for them (auto_resolve_combat),
//  and a clan quest's (which nobody plays), is decided by the board's own
//  mind on both sides, from the fight's seed, out of sight (decide,
//  autoResolve).
//
//  Until 2026-11-26 all of this was done with cards (the card battler in
//  routes/combat.js and lib/combat_resolver.js, now removed), and from
//  2026-11-25 the board stood behind a switch, `tactics.quests`. The switch
//  is gone: the board is the only way a battle is fought.
//
//    open(user, questRunId)      the quest's battle, made if it is not there
//    resolved(client, bt, state) in the transaction that stores the last choice
//    after(hook)                 once it has committed → { quest, rewards, rolls }
//    decide(client, sid, run, encounter, mods)   a quest's fight left to be decided
//    autoResolve({ citizenIds, enemyKeys, seed, mods })   any fight, decided: { outcome, log, battle }
//    closeFor(questRunId, q)     a quest forfeited or ended some other way
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const E = require('./tactics_engine');
const SETUP = require('./tactics_setup');
const F = require('./tactics_foes');

const MAX_BATTLE_WEALTH = 200;     // as routes/combat.js
const COMBAT_SKILL_CAP = 10;
const LANDS = ['plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];
const err = (status, msg) => Object.assign(new Error(msg), { status });
const arr = v => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (e) { return []; } })() : []);
const partyOf = run => ((run.quest_type === 'party' && Array.isArray(run.party_ids) && run.party_ids.length) ? run.party_ids : [run.citizen_id]).filter(Boolean).map(Number);

// The two sides of a quest's fight, as a battle's setup: the quest's citizens as they are (their class, the five
// they bring, the party's frozen modifiers) against the foes that stand in for its creatures, at the quest tier.
//   encounter, mods: given when the run's row does not hold them yet (a fight decided as it is triggered).
// The party (citizens as they are, with the frozen modifiers) and the foes (stand-ins for these creatures, at the
// quest tier, with any Happening's hand on them).
async function sides(citizenIds, encounter, frozen, q) {
  const party = await SETUP.partyFor(citizenIds, { mods: frozen || null });
  if (!party.length) throw err(400, 'Nobody is left to fight this battle.');
  const keys = encounter && encounter.length ? encounter : ['marsh_rat'];
  const boost = { hp: Number((frozen || {}).enemy_health) || 0, str: Number((frozen || {}).enemy_strength) || 0 };
  return { party, enemies: await SETUP.foesFor(keys, 'quest', boost, q) };
}
async function build(run, { q, userId, encounter = null, mods = null } = {}) {
  const { party, enemies } = await sides(partyOf(run), encounter || arr(run.combat_encounter), mods || run.combat_mods || null, q);
  const def = (await q('SELECT title, icon FROM quest_definitions WHERE id=$1', [run.quest_id]).catch(() => ({ rows: [] }))).rows[0] || {};
  const land = await require('../routes/quests').questBiome(run).catch(() => null);
  const qSeed = Number(run.combat_seed) || 1, qLand = LANDS.includes(land) ? land : 'forest';
  return {
    seed: qSeed, land: qLand, season: SETUP.seasonOf(), ...SETUP.fieldOf(qSeed, qLand, enemies), place: true, tier: 'quest', skull: '⚔', name: def.title || 'A fight on the road',
    fight: 'fight', level: 'as_is', species: userId ? await SETUP.speciesOf(userId, q) : null, party, enemies, quest: { run: run.id, quest: run.quest_id },
  };
}
// How a battle on the board ended, in the shape the card battles left on a quest (settlement_quests.combat_state),
// which the battle report and the injury rolls read: who was there, and who was down. `foes`: who they fought.
const record = (state, setup) => ({
  board: true, status: state.status, round: state.round, foes: (setup.enemies || []).map(e => e.name),
  units: state.units.filter(u => u.side === 'player').map(u => ({ id: u.id, side: 'player', citizen_id: u.citizen_id || null, name: u.name, hp: Math.max(0, u.hp), maxHp: u.maxHp, flags: { downed: !!u.down } }))
    .concat([{ id: 'foe', side: 'enemy', name: F.words(((setup.enemies || [])[0] || {}).key) || 'the enemy', hp: 0, maxHp: 1, flags: { downed: state.status === 'victory' } }]),
});

// The quest's battle on the board: the one already open for it, or a new one.
async function open(user, questRunId) {
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
    // A battle that was begun with cards before they were removed starts again here: the card battle cannot go on.
    if (arr(run.combat_actions).length) await q(`UPDATE settlement_quests SET combat_actions='[]'::jsonb, combat_state=NULL WHERE id=$1`, [run.id]);
    const setup = await build(run, { q, userId: user.userId });
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
              combat_state=$4, completes_at = completes_at + ($2 || ' milliseconds')::interval WHERE id=$3`, [JSON.stringify(log), String(paused), run.id, JSON.stringify(record(state, bt.setup))]);
    wealth = Math.max(0, Math.min(MAX_BATTLE_WEALTH, Math.round(await SETUP.rewardOf(keys, q))));
    if (wealth > 0) await q('UPDATE settlements SET wealth = wealth + $1 WHERE id=$2', [wealth, bt.settlement_id]);
  } else {
    await q(
      `UPDATE settlement_quests SET combat_status='resolved', combat_outcome='defeat', combat_resolved_at=NOW(), combat_log=$1, combat_state=$3,
              status='failed', completes_at=NOW(), combat_clock_paused_at=NULL WHERE id=$2`, [JSON.stringify(log), run.id, JSON.stringify(record(state, bt.setup))]);
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

// A fight the player left to be decided (auto_resolve_combat), decided by the board's own mind on both sides,
// out of sight, as the quest's fight is triggered (routes/quests.js processCombatTriggers, inside its transaction).
// Settled as the card engine's decision was: won, the quest goes on, the fallen roll for injury and what the foes
// carried goes into the stores; lost, the quest fails and everyone rolls. → the events to send once it commits.
const DECIDE_TURNS = 600;
async function decide(client, settlementId, run, encounter, mods) {
  const q = (t, p) => client.query(t, p);
  const events = [], game = [];
  let setup, state;
  try {
    setup = await build(run, { q, encounter, mods });
    state = E.autoplay({ seed: setup.seed, land: setup.land, season: setup.season, w: setup.w, h: setup.h, lair: setup.lair, party: setup.party, enemies: setup.enemies }, DECIDE_TURNS);
  } catch (e) {
    console.error('[tactics_quests] deciding a battle failed for quest run', run.id, e.message);
    setup = { enemies: [], party: [] }; state = { status: 'defeat', round: 0, units: [] };
  }
  const won = state.status === 'victory';
  const keys = (setup.enemies || []).map(e => e.key), rec = record(state, setup);
  const log = [`Decided on the board: ${won ? 'won' : 'lost'}${state.round ? ` in ${state.round} round${state.round === 1 ? '' : 's'}` : ''}.`];
  const CR = require('./combat_resolver');
  if (won) {
    await q(`UPDATE settlement_quests SET combat_status='resolved', combat_outcome='victory', combat_resolved_at=NOW(), combat_log=$1, combat_state=$2 WHERE id=$3`, [JSON.stringify(log), JSON.stringify(rec), run.id]);
    try { await CR.applyBattleAftermath({ battle: rec, outcome: 'victory', settlementId, questRunId: run.id, encounter: keys }); } catch (e) { console.error('[tactics_quests] aftermath (victory) failed for run', run.id, e.message); }
    try {
      const items = await require('./spoils').grantItems(client, settlementId, await SETUP.dropsFor(keys, setup.seed, q), 'battle');
      if (items.length) events.push({ type: 'battle_spoils', quest_run_id: run.id, items, card: null });
    } catch (e) { console.error('[tactics_quests] drops failed for run', run.id, e.message); }
    events.push({ type: 'combat_resolved', quest_run_id: run.id, outcome: 'victory' });
    game.push(['battle_won', { settlementId, enemyCount: keys.length, citizenIds: partyOf(run) }]);
  } else {
    await q(`UPDATE settlement_quests SET combat_status='resolved', combat_outcome='defeat', combat_resolved_at=NOW(), combat_log=$1, combat_state=$2, status='failed', completes_at=NOW() WHERE id=$3`, [JSON.stringify(log), JSON.stringify(rec), run.id]);
    try { await CR.applyBattleAftermath({ battle: rec, outcome: 'defeat', settlementId, questRunId: run.id, encounter: keys }); } catch (e) { console.error('[tactics_quests] aftermath (defeat) failed for run', run.id, e.message); }
    events.push({ type: 'combat_resolved', quest_run_id: run.id, outcome: 'defeat' });
    events.push({ type: 'quest_resolved', quest_run_id: run.id, outcome: 'failed' });
  }
  return { won, events, game };
}

// Any fight, decided by the board's mind: the citizens named against these creatures, from this seed. For a
// battle nobody plays (a clan quest's). → { outcome: 'victory' | 'defeat', log, rounds, battle } where `battle` is
// the record the injury rolls read (who was there, who was down).
async function autoResolve({ citizenIds, enemyKeys, seed, mods = null, land = 'forest', q = null } = {}) {
  const { party, enemies } = await sides((citizenIds || []).map(Number).filter(Boolean), enemyKeys || [], mods, q || ((t, p) => query(t, p)));
  const aSeed = Number(seed) || 1, aLand = LANDS.includes(land) ? land : 'forest';
  const setup = { seed: aSeed, land: aLand, ...SETUP.fieldOf(aSeed, aLand, enemies), party, enemies };
  const state = E.autoplay(setup, DECIDE_TURNS);
  const won = state.status === 'victory';
  return { outcome: won ? 'victory' : 'defeat', rounds: state.round, battle: record(state, setup), foes: enemies.map(e => e.name),
    log: [`${won ? 'The party won' : 'The party was driven back'} in ${state.round} round${state.round === 1 ? '' : 's'}.`] };
}

// The quest's fight ended some other way (forfeited from the Battles list, the quest cancelled): its battle
// on the board, if there is one, is closed.
const closeFor = (questRunId, q) => (q || query)(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE quest_run_id=$1 AND status='active'`, [questRunId]).catch(() => {});

module.exports = { open, build, record, decide, autoResolve, resolved, after, closeFor, MAX_BATTLE_WEALTH };
