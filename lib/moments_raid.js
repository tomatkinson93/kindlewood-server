// ══════════════════════════════════════════════════════════════════════════
//  Raids and the Withered (docs/PHASE_2_MOMENTS.md §3, M28–M30). They follow
//  events from lib/raids and lib/raid_camps, offered within the daily budget
//  (moments.offer).
//
//    M28 raid_warning   scouts report movement (a raid on its way)
//    M29 raid_hero      after a raid turned back: someone held the gate
//    M30 withered_child a child found near a burned camp
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const { query } = require('../db');
const LIFE = require('./life');
const TE = require('./town_effects');
const { happy, living, first, arr, pick, LIVING } = require('./moments_family');

const CONFIG = {
  REINFORCE_DEFENCE: 20,     // M28
  HERO_ODDS: 0.6, CHILD_AFTER_RAID_ODDS: 0.15, CHILD_AFTER_CAMP_ODDS: 0.5,
  THANKS_HAPPY: 8, SHIELD_HAPPY: 12, ENVY_HAPPY: -2,   // M29
  OBJECT_HAPPY: -8, LEAVE_TRUST: 6,                    // M30
};

// ── M28 Scouts report movement ─────────────────────────────────────────────
M.register('raid_warning', {
  source: 'raid', icon: '🔭', title: 'Scouts report movement', weight: 0, cooldownDays: 0, expireHours: 6,
  async eligible(ctx) {
    const r = (await ctx.q('SELECT * FROM settlement_raids WHERE id = $1 AND settlement_id = $2 AND resolved_at IS NULL', [ctx.raid_id, ctx.sid])).rows[0];
    if (!r) return null;
    const crew = r.outpost_id ? (await ctx.q('SELECT c.id, c.name FROM outpost_crew oc JOIN citizens c ON c.id = oc.citizen_id WHERE oc.outpost_id = $1', [r.outpost_id])).rows : [];
    const quote = require('./raids').tributeQuote(ctx.settlement, r);
    const hours = Math.max(1, Math.round((new Date(r.arrives_at) - ctx.now) / 3600e3));
    return { subject: { citizen_ids: crew.map(c => c.id), outpost_id: r.outpost_id || undefined },
      data: { speaker: 'Your scouts', raid_id: r.id, target: r.target_name, from: r.from_name, hours, arrives_at: new Date(r.arrives_at).getTime(),
        outpost: !!r.outpost_id, crew: crew.map(c => ({ id: c.id, name: c.name })), tribute: quote.cost } };
  },
  text: d => `Raiders from ${d.from} are gathering, and will strike ${d.target} in about ${d.hours} hour${d.hours === 1 ? '' : 's'}.`,
  options: d => [
    d.outpost && d.crew.length ? { key: 'safe', label: 'Bring the outpost crew home', hint: 'they are safe; the outpost lies open', risk: 1 }
                               : { key: 'safe', label: 'Bar the gates and wait', hint: 'the defences stand as they are', risk: 1 },
    { key: 'reinforce', label: `Reinforce ${d.target}`, hint: `defence +${CONFIG.REINFORCE_DEFENCE}; anyone posted there is hurt if it still falls`, risk: 2 },
    { key: 'offer', label: 'Send an offer', hint: `${d.tribute} wealth; they turn back and leave you in peace a day`, risk: 1 },
  ],
  fallback: 'safe',
  async choose(key, x) {
    const d = x.d;
    const raid = (await x.q('SELECT * FROM settlement_raids WHERE id = $1 AND resolved_at IS NULL FOR UPDATE', [d.raid_id])).rows[0];
    if (!raid) return { outcome: 'The raid had already come and gone.' };
    if (key === 'offer') {
      // Tribute at today's price (lib/raids payTribute, on this transaction).
      const R = require('./raids');
      const s = (await x.q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [x.sid])).rows[0];
      const quote = R.tributeQuote(s, raid);
      if (Number(s.wealth) < quote.cost) return { error: `The Withered want ${quote.cost} wealth.` };
      await x.q(`UPDATE settlements SET wealth = wealth - $2, raid_peace_until = NOW() + make_interval(hours => $3), raid_tribute_at = NOW(), raid_tribute_streak = $4 WHERE id = $1`,
        [x.sid, quote.cost, quote.hours, quote.streak + 1]);
      await x.q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = 'turned_back', loss_share = 0, loot = $2 WHERE id = $1", [raid.id, JSON.stringify({ tribute: quote.cost })]);
      try { await require('./raid_extras').releaseReinforcements(x.q, raid.id); } catch (e) { /* none */ }
      return { outcome: `You paid the Withered ${quote.cost} wealth. The raiders turn back.`, chronicle: `The town paid the Withered ${quote.cost} wealth to turn back a raid on ${d.target}.` };
    }
    if (key === 'reinforce') {
      await TE.add(x.q, x.sid, { key: 'moment:reinforce', label: `🛡️ ${d.target} reinforced`, mods: { raid_defence: CONFIG.REINFORCE_DEFENCE },
        endsAt: new Date(raid.arrives_at).getTime() + 30 * 60e3 });
      return { outcome: `${d.target} is reinforced against the raid (+${CONFIG.REINFORCE_DEFENCE} defence).`, chronicle: `The town reinforced ${d.target} against raiders from ${d.from}.` };
    }
    if (d.outpost && raid.outpost_id) {
      const gone = (await x.q('DELETE FROM outpost_crew WHERE outpost_id = $1 RETURNING citizen_id', [raid.outpost_id])).rows.length;
      if (gone) return { outcome: `The crew came home from ${d.target}. They are safe; the outpost lies open.`, chronicle: `The crew of ${d.target} came home ahead of a raid.` };
    }
    return { outcome: 'The gates are barred. The town waits.', chronicle: `The town barred its gates against raiders from ${d.from}.` };
  },
});

// ── M29 After the raid ─────────────────────────────────────────────────────
M.register('raid_hero', {
  source: 'raid', icon: '🛡️', title: 'After the raid', weight: 0, cooldownDays: 2, expireHours: 24,
  async eligible(ctx) {
    const r = (await ctx.q("SELECT * FROM settlement_raids WHERE id = $1 AND settlement_id = $2 AND outcome IN ('repelled', 'broken')", [ctx.raid_id, ctx.sid])).rows[0];
    if (!r) return null;
    const posted = arr(r.loot && r.loot.defence && r.loot.defence.posted).filter(c => c.id);
    const alive = posted.length ? (await ctx.q(`SELECT id, name, role, visible_traits FROM citizens WHERE id = ANY($1::int[]) AND settlement_id = $2 AND ${LIVING}`,
      [posted.map(c => Number(c.id)), ctx.sid])).rows : [];
    if (!alive.length) return null;
    const hero = alive.find(c => ['soldier', 'archer'].includes(c.role)) || alive[0];
    return { subject: { citizen_ids: [hero.id] },
      data: { speaker: hero.name, hero: { id: hero.id, name: hero.name }, target: r.target_name, from: r.from_name, already: arr(hero.visible_traits).includes('shield') } };
  },
  text: d => `The raiders from ${d.from} broke against ${d.target}, and it was ${d.hero.name} who held the gate.`,
  options: d => [
    { key: 'thanks', label: 'A quiet thanks', hint: `${first(d.hero.name)} is happier`, risk: 0 },
    ...(d.already ? [] : [{ key: 'shield', label: "Name them the town's shield", hint: 'a title in the chronicle; others envy it a little', risk: 0 }]),
  ],
  fallback: 'thanks',
  async choose(key, x) {
    const d = x.d;
    if (key === 'shield' && !d.already) {
      await x.q(`UPDATE citizens SET visible_traits = COALESCE(visible_traits, '[]'::jsonb) || '["shield"]'::jsonb WHERE id = $1 AND NOT (COALESCE(visible_traits, '[]'::jsonb) ? 'shield')`, [d.hero.id]);
      await happy(x.q, [d.hero.id], CONFIG.SHIELD_HAPPY);
      const others = (await x.q(`SELECT id FROM citizens WHERE settlement_id = $1 AND ${LIVING} AND life_stage = 'adult' AND id <> $2`, [x.sid, d.hero.id])).rows.map(r => r.id);
      await happy(x.q, others, CONFIG.ENVY_HAPPY);
      return { outcome: `${d.hero.name} is named the town's shield.`, chronicle: `${d.hero.name} held the gate at ${d.target} and was named the shield of the town.` };
    }
    await happy(x.q, [d.hero.id], CONFIG.THANKS_HAPPY);
    return { outcome: `${first(d.hero.name)} was quietly thanked, and stands a little taller.`, chronicle: `${d.hero.name} held the gate at ${d.target} against the Withered.` };
  },
});

// ── M30 A Withered child ───────────────────────────────────────────────────
M.register('withered_child', {
  source: 'raid', icon: '🧒', title: 'A Withered child', weight: 0, cooldownDays: 7, expireHours: 24,
  async eligible(ctx) {
    const town = await living(ctx);
    if (!town.length) return null;
    const S = require('./settlers');
    const { taken } = await S.townFor(ctx.sid);
    const { generateCitizen, MALE_NAMES, FEMALE_NAMES } = require('../citizens');
    const c = generateCitizen(1);
    const surname = S.newSurname(taken, ctx.rng);
    const T = require('./careers/traits');
    const knack = pick(ctx.rng, Object.keys(T.APTITUDES));   // the unusual gift they carry
    const age = 4 + Math.floor(ctx.rng() * 4);
    // The family that objects: the head of the largest family.
    const fam = (await ctx.q(`SELECT f.id, f.name, f.head_citizen_id FROM families f JOIN citizens c ON c.family_id = f.id AND ${LIVING.replace(/life_stage/g, 'c.life_stage')}
                                WHERE f.settlement_id = $1 GROUP BY f.id ORDER BY COUNT(c.id) DESC, f.id LIMIT 1`, [ctx.sid]).catch(() => ({ rows: [] }))).rows[0];
    const head = fam && fam.head_citizen_id ? town.find(x => x.id === fam.head_citizen_id) : null;
    const village = (await ctx.q(`SELECT n.id, n.name FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id
                                    WHERE d.settlement_id = $1 AND COALESCE(n.disposition, 'neutral') <> 'hostile' AND COALESCE(n.faction, 'neutral') <> 'hostile'
                                    ORDER BY d.trust DESC LIMIT 1`, [ctx.sid]).catch(() => ({ rows: [] }))).rows[0] || null;
    const name = `${pick(ctx.rng, c.gender === 'male' ? MALE_NAMES : FEMALE_NAMES)} ${surname}`;
    return { subject: { citizen_ids: head ? [head.id] : [] },
      data: { speaker: 'Your scouts', child: { name, surname, gender: c.gender, age, knack, stats: c.stats, skills: c.skills, life: c.life, repro: c.repro, visible_traits: c.visible_traits },
        objector: head ? { id: head.id, name: head.name, family: fam.name } : null, village } };
  },
  text: d => `Near a burned Withered camp, your scouts found a child of about ${d.child.age}, alone. They say their name is ${first(d.child.name)}.`,
  options: d => [
    { key: 'take', label: 'Take them in', hint: `a new child with an unusual gift${d.objector ? '; the ' + d.objector.family + ' family objects' : ''}`, risk: 0 },
    { key: 'leave', label: d.village ? `Take them to ${d.village.name}` : 'Leave them at the nearest village', hint: d.village ? `${d.village.name} trusts you more` : 'they will be cared for there', risk: 0 },
  ],
  fallback: 'take',
  async choose(key, x) {
    const d = x.d, c = d.child;
    if (key === 'leave') {
      if (d.village) await x.q('UPDATE diplomacy_relations SET trust = LEAST(100, trust + $3), last_interaction = NOW() WHERE settlement_id = $1 AND npc_id = $2', [x.sid, d.village.id, CONFIG.LEAVE_TRUST]);
      return { outcome: `${first(c.name)} was taken to ${d.village ? d.village.name : 'a village'}, where they will be cared for.`, chronicle: `A child found near a Withered camp was taken to ${d.village ? d.village.name : 'a village'}.` };
    }
    if ((await LIFE.beds(x.sid, x.q)).free <= 0) return { error: 'There is no bed for a child. Build a Willow Hut first.' };
    const bornAt = new Date(Date.now() - c.age * LIFE.YEAR_MS);
    const id = (await x.q(
      `INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits, born_at, last_birthday_year, life_stage)
       VALUES ($1,$2,$3,1,'idle',$4,$5,$6,$7,$8,$9,$10,$11,'child') RETURNING id`,
      [x.sid, c.name, c.gender, JSON.stringify(c.stats), JSON.stringify(c.skills), JSON.stringify({ ...c.life, age: c.age, withered_born: true }), JSON.stringify(c.repro),
       JSON.stringify(c.visible_traits), JSON.stringify([c.knack]), bornAt.toISOString(), c.age])).rows[0].id;
    await LIFE.assignFamilies(x.sid, x.q);
    await LIFE.autoHouse(x.sid, {}, x.q);
    await LIFE.recount(x.sid, x.q);
    if (d.objector) await happy(x.q, [d.objector.id], CONFIG.OBJECT_HAPPY);
    return { outcome: `${first(c.name)} has a home now${d.objector ? `, though ${first(d.objector.name)} doesn't like it` : ''}.`,
      chronicle: `${c.name}, a child of about ${c.age} found near a burned Withered camp, was taken in and starts the ${c.surname} family.`, joined: { id } };
  },
});

// ── Listeners (index.js) ───────────────────────────────────────────────────
async function onRaidStarted(p) {
  if (!p || !p.settlementId || !p.raidId) return null;
  return M.offer(p.settlementId, 'raid_warning', { raid_id: p.raidId });
}
async function onRaidRepelled(p, rng = Math.random) {
  if (!p || !p.settlementId) return null;
  if (p.raidId && rng() < CONFIG.HERO_ODDS) { const m = await M.offer(p.settlementId, 'raid_hero', { raid_id: p.raidId }); if (m) return m; }
  if (rng() < CONFIG.CHILD_AFTER_RAID_ODDS) return M.offer(p.settlementId, 'withered_child', {});
  return null;
}
async function onCampCleared(p, rng = Math.random) {
  if (!p || !p.settlementId || rng() >= CONFIG.CHILD_AFTER_CAMP_ODDS) return null;
  return M.offer(p.settlementId, 'withered_child', {});
}
function register() {
  const ge = require('./game_events');
  const safe = (f, tag) => p => f(p).catch(e => console.error('[moments] ' + tag, e.message));
  ge.on('raid_started', safe(onRaidStarted, 'raid'));
  ge.on('raid_repelled', safe(onRaidRepelled, 'raid hero'));
  ge.on('camp_cleared', safe(onCampCleared, 'camp'));
}

module.exports = { CONFIG, onRaidStarted, onRaidRepelled, onCampCleared, register };
