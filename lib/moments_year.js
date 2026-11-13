// ══════════════════════════════════════════════════════════════════════════
//  The year (docs/PHASE_2_MOMENTS.md §3, M9–M13). Each is asked only in its
//  season and at most once a game year (28 hours), competing with the other
//  kinds for the daily budget. What lasts is a timed town effect
//  (lib/town_effects), shown in the town's breakdown while it runs.
//
//    M9  spring_planting  what to plant
//    M10 summer_days      the long days
//    M11 autumn_feast     the harvest feast
//    M12 winter_stores    short stores (only when food won't last the winter)
//    M13 winter_stories   stories by the fire
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const LIFE = require('./life');
const TE = require('./town_effects');
const { seasonAt } = require('../seasons');
const { happy, bond, spend, living, first, arr, pick, trade, LIVING } = require('./moments_family');

const H = 3600e3;
const SEASON_MS = 7 * H;
const CONFIG = {
  FLAX_FOOD: -0.15, FLAX_WEALTH: 0.30,          // M9
  FALLOW_FOOD: -0.10, FALLOW_SPRING: 0.30,
  REST_HAPPY: 5, LATE_PRODUCTION: 0.10, LATE_INJURY_ODDS: 0.2,   // M10
  EXPLORE_TILES: 6, EXPLORE_LOST_ODDS: 0.1,
  FEAST_FOOD_EACH: 8, FEAST_WEALTH_EACH: 4, FEAST_HAPPY: 8, FEAST_BOND: 4, FEAST_BIRTHS: 0.05,   // M11
  RATION_UPKEEP: -0.25, RATION_HAPPY: -6, ELDERS_HAPPY: -15, GRAIN_PRICE: 1,   // M12
  TALE_XP: 30, FOUNDERS_HAPPY: 6, GHOST_BOND: 8, GHOST_FRIGHT: -10,          // M13
};

// The season now, and when the coming ones start (ms).
function calendar(now) {
  const s = seasonAt(now);
  const end = now + s.msRemaining;
  return { s, id: s.id, year: s.year, end, after: n => end + n * SEASON_MS };
}
// Asked this game year already?
async function askedThisYear(ctx, kind, year) {
  return (await ctx.q(`SELECT 1 FROM moments WHERE settlement_id = $1 AND kind = $2 AND (data->>'year')::int = $3 LIMIT 1`, [ctx.sid, kind, year])).rows.length > 0;
}
const inSeason = (season, kind) => async ctx => {
  const c = calendar(ctx.now);
  if (c.id !== season || await askedThisYear(ctx, kind, c.year)) return null;
  return c;
};
const pct = v => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

// ── M9 Spring: what to plant ───────────────────────────────────────────────
M.register('spring_planting', {
  source: 'year', icon: '🌱', title: 'Spring: what to plant', weight: 3, cooldownDays: 1, expireHours: 6, gentle: true,
  async eligible(ctx) {
    const c = await inSeason('spring', 'spring_planting')(ctx);
    if (!c) return null;
    const farmer = (await living(ctx)).find(x => x.role === 'farmer' && x.life_stage === 'adult');
    return { subject: { citizen_ids: farmer ? [farmer.id] : [] },
      data: { year: c.year, speaker: farmer ? farmer.name : null, springEnd: c.end, summerEnd: c.after(1), autumnEnd: c.after(2), nextSpring: c.after(3) } };
  },
  text: d => `${d.speaker ? first(d.speaker) + ' asks' : 'The fields are ready, and the town asks'} what to sow this spring.`,
  options: () => [
    { key: 'usual', label: 'The usual fields', hint: 'a normal harvest', risk: 0 },
    { key: 'flax', label: 'Flax and herbs', hint: `food ${pct(CONFIG.FLAX_FOOD)} to autumn, then wealth ${pct(CONFIG.FLAX_WEALTH)} all autumn`, risk: 1 },
    { key: 'fallow', label: 'Leave a field fallow', hint: `food ${pct(CONFIG.FALLOW_FOOD)} this year, ${pct(CONFIG.FALLOW_SPRING)} next spring`, risk: 1 },
  ],
  fallback: 'usual',
  async choose(key, x) {
    const d = x.d;
    if (key === 'flax') {
      await TE.add(x.q, x.sid, { key: 'moment:flax', label: '🌱 Flax and herbs sown', mods: { food_production: CONFIG.FLAX_FOOD }, endsAt: d.summerEnd });
      await TE.add(x.q, x.sid, { key: 'moment:flax_sold', label: '🌿 Flax and herbs to sell', mods: { wealth_production: CONFIG.FLAX_WEALTH }, startsAt: d.summerEnd, endsAt: d.autumnEnd });
      return { outcome: 'Flax and herbs are sown: a little less food until autumn, then more wealth.', chronicle: 'The town sowed flax and herbs this spring.' };
    }
    if (key === 'fallow') {
      await TE.add(x.q, x.sid, { key: 'moment:fallow', label: '🟫 A field left fallow', mods: { food_production: CONFIG.FALLOW_FOOD }, endsAt: d.nextSpring });
      await TE.add(x.q, x.sid, { key: 'moment:fallow_rested', label: '🌾 Rested fields', mods: { food_production: CONFIG.FALLOW_SPRING }, startsAt: d.nextSpring, endsAt: d.nextSpring + SEASON_MS });
      return { outcome: 'A field is left to rest: a little less food this year, a rich crop next spring.', chronicle: 'The town left a field fallow to rest.' };
    }
    return { outcome: 'The usual fields are sown.', chronicle: 'The usual fields were sown this spring.' };
  },
});

// ── M10 Summer: the long days ──────────────────────────────────────────────
M.register('summer_days', {
  source: 'year', icon: '☀️', title: 'Summer: the long days', weight: 3, cooldownDays: 1, expireHours: 6, gentle: true,
  async eligible(ctx) {
    const c = await inSeason('summer', 'summer_days')(ctx);
    if (!c) return null;
    const town = await living(ctx);
    const adults = town.filter(x => x.life_stage === 'adult');
    const youths = town.filter(x => LIFE.stageOf(x, ctx.now) === 'youth');
    if (!adults.length) return null;
    // Odds rolled now, kept in the data (§4).
    const hurt = ctx.rng() < CONFIG.LATE_INJURY_ODDS ? pick(ctx.rng, adults) : null;
    const lost = youths.length && ctx.rng() < CONFIG.EXPLORE_LOST_ODDS ? pick(ctx.rng, youths) : null;
    return { subject: { citizen_ids: [] },
      data: { year: c.year, until: c.end, youths: youths.length, hurt: hurt ? { id: hurt.id, name: hurt.name } : null, lost: lost ? { id: lost.id, name: lost.name } : null } };
  },
  text: () => 'The evenings are long and warm. What should the town do with them?',
  options: d => [
    { key: 'rest', label: 'Rest in the evenings', hint: `happiness +${CONFIG.REST_HAPPY} for the summer`, risk: 0 },
    { key: 'late', label: 'Work late', hint: `production ${pct(CONFIG.LATE_PRODUCTION)} for the summer; someone may get hurt`, risk: 1 },
    ...(d.youths ? [{ key: 'explore', label: 'Send the young ones exploring', hint: 'they map the land nearby; one may get lost for a day', risk: 1 }] : []),
  ],
  fallback: 'rest',
  async choose(key, x) {
    const d = x.d;
    if (key === 'late') {
      await TE.add(x.q, x.sid, { key: 'moment:late', label: '🌇 Working late', mods: { all_production: CONFIG.LATE_PRODUCTION }, endsAt: d.until });
      if (d.hurt) {
        await happy(x.q, [d.hurt.id], -10);
        return { outcome: `Everyone works late this summer. ${first(d.hurt.name)} hurt their back in the fields.`, chronicle: `The town worked late through the summer; ${d.hurt.name} was hurt.` };
      }
      return { outcome: 'Everyone works late this summer, and nobody is hurt.', chronicle: 'The town worked late through the summer.' };
    }
    if (key === 'explore' && d.youths) {
      const s = (await x.q('SELECT user_id, tile_q, tile_r FROM settlements WHERE id = $1', [x.sid])).rows[0];
      let found = 0;
      if (s && s.tile_q != null) {
        const ring = [];
        for (let dq = -5; dq <= 5; dq++) for (let dr = -5; dr <= 5; dr++) {
          const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
          if (dist >= 3 && dist <= 5) ring.push([s.tile_q + dq, s.tile_r + dr]);
        }
        const seen = new Set((await x.q('SELECT tile_q, tile_r FROM fog_of_war WHERE user_id = $1', [s.user_id])).rows.map(r => `${r.tile_q},${r.tile_r}`));
        const fresh = ring.filter(([q, r]) => !seen.has(`${q},${r}`)).sort(() => x.rng() - 0.5).slice(0, CONFIG.EXPLORE_TILES);
        for (const [q, r] of fresh) await x.q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [s.user_id, q, r]);
        found = fresh.length;
      }
      const lost = d.lost ? ` ${first(d.lost.name)} got lost and came home a day later, tired and proud.` : '';
      if (d.lost) await happy(x.q, [d.lost.id], -5);
      return { outcome: `The young ones explored and mapped ${found} new place${found === 1 ? '' : 's'}.${lost}`, chronicle: `The town's young ones went exploring this summer.${lost}` };
    }
    await TE.add(x.q, x.sid, { key: 'moment:rest', label: '🌙 Long summer evenings', mods: { happiness: CONFIG.REST_HAPPY }, endsAt: d.until });
    return { outcome: 'The town rests in the long evenings, and spirits rise.', chronicle: 'The town rested through the long summer evenings.' };
  },
});

// ── M11 Autumn: the harvest feast ──────────────────────────────────────────
M.register('autumn_feast', {
  source: 'year', icon: '🍂', title: 'Autumn: the harvest feast', weight: 3, cooldownDays: 1, expireHours: 6, gentle: true,
  async eligible(ctx) {
    const c = await inSeason('autumn', 'autumn_feast')(ctx);
    if (!c) return null;
    const n = (await living(ctx)).length;
    if (!n) return null;
    return { subject: { citizen_ids: [] },
      data: { year: c.year, until: c.end, nextSpring: c.after(1), cost: { food: Math.max(40, n * CONFIG.FEAST_FOOD_EACH), wealth: Math.max(20, n * CONFIG.FEAST_WEALTH_EACH) } } };
  },
  text: () => 'The harvest is in. How should the town mark it?',
  options: d => [
    { key: 'modest', label: 'A modest supper', hint: 'nothing spent', risk: 0 },
    { key: 'feast', label: 'A proper feast', hint: `${d.cost.food} food and ${d.cost.wealth} wealth; happier, closer, more births in spring`, risk: 1 },
  ],
  fallback: 'modest',
  async choose(key, x) {
    const d = x.d;
    if (key === 'feast') {
      const no = await spend(x.q, x.sid, d.cost);
      if (no) return { error: no };
      await TE.add(x.q, x.sid, { key: 'moment:feast', label: '🍂 After the harvest feast', mods: { happiness: CONFIG.FEAST_HAPPY }, endsAt: d.until });
      await TE.add(x.q, x.sid, { key: 'moment:feast_spring', label: '💞 Remembering the feast', mods: { birth_chance: CONFIG.FEAST_BIRTHS }, startsAt: d.nextSpring, endsAt: d.nextSpring + SEASON_MS });
      await x.q(`UPDATE citizen_relationships SET score = LEAST(CASE WHEN state = 'partners' THEN 100 ELSE 89 END, score + $2), last_updated = NOW()
                 WHERE settlement_id = $1 AND citizen_a_id IN (SELECT id FROM citizens WHERE settlement_id = $1 AND ${LIVING})`, [x.sid, CONFIG.FEAST_BOND]);
      return { outcome: 'A proper feast! Everyone is happier and closer, and there may be babies in the spring.', chronicle: 'The town held a great harvest feast.' };
    }
    return { outcome: 'A modest supper, and an early night.', chronicle: 'The harvest was marked with a modest supper.' };
  },
});

// ── M12 Winter: short stores ───────────────────────────────────────────────
// Only when the food in store won't last the rest of the winter.
const UPKEEP = { child: 0.5, adult: 1.0, elder: 0.75 };
M.register('winter_stores', {
  source: 'year', icon: '❄️', title: 'Winter: short stores', weight: 4, cooldownDays: 1, expireHours: 4,
  async eligible(ctx) {
    const c = await inSeason('winter', 'winter_stores')(ctx);
    if (!c) return null;
    const town = await living(ctx);
    if (!town.length) return null;
    const rate = town.reduce((t, x) => t + (UPKEEP[LIFE.stageOf(x, ctx.now) === 'elder' ? 'elder' : x.life_stage === 'child' ? 'child' : 'adult'] || 1), 0) * (c.s.foodConsumption || 1);
    const need = Math.ceil(rate * (c.s.msRemaining / H));
    const food = Math.floor(Number(ctx.settlement.food) || 0);
    if (food >= need) return null;
    const deficit = Math.ceil((need - food) / 10) * 10;
    const village = (await ctx.q(`SELECT n.id, n.name FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id WHERE d.settlement_id = $1 ORDER BY d.trust DESC NULLS LAST LIMIT 1`, [ctx.sid]).catch(() => ({ rows: [] }))).rows[0];
    const elders = town.filter(x => LIFE.stageOf(x, ctx.now) === 'elder').map(x => x.id);
    return { subject: { citizen_ids: [] },
      data: { year: c.year, until: c.end, food, need, deficit, price: deficit * CONFIG.GRAIN_PRICE, village: village || null, elders } };
  },
  text: d => `The stores hold ${d.food} food, and the winter needs about ${d.need}.`,
  options: d => [
    { key: 'even', label: 'Ration evenly', hint: 'everyone a little hungry; the food lasts longer', risk: 1 },
    ...(d.elders.length ? [{ key: 'young', label: 'Feed the children and workers first', hint: 'the food lasts longer; the elders weaken', risk: 2 }] : []),
    { key: 'buy', label: `Buy grain${d.village ? ' from ' + d.village.name : ''}`, hint: `${d.price} wealth for ${d.deficit} food`, risk: 1 },
  ],
  fallback: 'even',
  async choose(key, x) {
    const d = x.d;
    if (key === 'buy') {
      const no = await spend(x.q, x.sid, { wealth: d.price });
      if (no) return { error: no };
      await x.q('UPDATE settlements SET food = food + $2 WHERE id = $1', [x.sid, d.deficit]);
      if (d.village) await x.q('UPDATE diplomacy_relations SET trust = LEAST(100, trust + 2), last_interaction = NOW() WHERE settlement_id = $1 AND npc_id = $2', [x.sid, d.village.id]).catch(() => {});
      return { outcome: `${d.deficit} food bought${d.village ? ' from ' + d.village.name : ''}. Nobody goes hungry.`, chronicle: `In a lean winter the town bought grain${d.village ? ' from ' + d.village.name : ''}.` };
    }
    if (key === 'young' && d.elders.length) {
      await TE.add(x.q, x.sid, { key: 'moment:ration_young', label: '🥣 Children and workers fed first', mods: { food_upkeep: CONFIG.RATION_UPKEEP }, endsAt: d.until });
      await happy(x.q, d.elders, CONFIG.ELDERS_HAPPY);
      return { outcome: 'The children and workers are fed first. The elders go without, and weaken.', chronicle: 'In a lean winter the elders went without so the young could eat.' };
    }
    await TE.add(x.q, x.sid, { key: 'moment:ration', label: '🥣 Rationing', mods: { food_upkeep: CONFIG.RATION_UPKEEP, happiness: CONFIG.RATION_HAPPY }, endsAt: d.until });
    return { outcome: 'Everyone eats a little less until spring.', chronicle: 'The town rationed its food through a lean winter.' };
  },
});

// ── M13 Winter: stories by the fire ────────────────────────────────────────
M.register('winter_stories', {
  source: 'year', icon: '🔥', title: 'Winter: stories by the fire', weight: 3, cooldownDays: 1, expireHours: 6, gentle: true,
  async eligible(ctx) {
    const c = await inSeason('winter', 'winter_stories')(ctx);
    if (!c) return null;
    const town = await living(ctx);
    const young = town.filter(x => x.life_stage === 'child');
    if (!young.length) return null;
    const C = require('./careers/classes');
    // The founders: the largest living family of the first generation.
    const fam = (await ctx.q(`SELECT f.id, f.name, COUNT(c.id)::int AS n FROM families f JOIN citizens c ON c.family_id = f.id AND ${LIVING.replace(/life_stage/g, 'c.life_stage')}
                                WHERE f.settlement_id = $1 GROUP BY f.id ORDER BY n DESC, f.id LIMIT 1`, [ctx.sid]).catch(() => ({ rows: [] }))).rows[0];
    const teller = town.filter(x => x.life_stage === 'adult').sort((a, b) => new Date(a.born_at) - new Date(b.born_at))[0];
    return { subject: { citizen_ids: young.map(y => y.id) },
      data: { year: c.year, speaker: teller ? teller.name : null, young: young.map(y => ({ id: y.id, name: y.name, cls: pick(ctx.rng, C.ASSIGNABLE) })),
        family: fam ? { id: fam.id, name: fam.name } : null, frightened: (() => { const f = pick(ctx.rng, young); return { id: f.id, name: f.name }; })() } };
  },
  text: d => `The nights are long. ${d.speaker ? first(d.speaker) + ' gathers' : 'The elders gather'} the children by the fire for a story.`,
  options: d => [
    { key: 'old', label: 'The old tales', hint: 'each child learns a little of a trade', risk: 0 },
    ...(d.family ? [{ key: 'founders', label: 'Tales of the founders', hint: `the ${d.family.name} family is proud`, risk: 0 }] : []),
    { key: 'ghost', label: 'Ghost stories', hint: 'the young ones grow closer; one is frightened', risk: 1 },
  ],
  fallback: 'old',
  async choose(key, x) {
    const d = x.d;
    if (key === 'founders' && d.family) {
      const ids = (await x.q(`SELECT id FROM citizens WHERE family_id = $1 AND ${LIVING}`, [d.family.id])).rows.map(r => r.id);
      await happy(x.q, ids, CONFIG.FOUNDERS_HAPPY);
      return { outcome: `Tales of the founders: the ${d.family.name} family sits a little taller.`, chronicle: `Through the winter nights the children heard tales of the ${d.family.name} founders.` };
    }
    if (key === 'ghost') {
      const ids = arr(d.young).map(y => y.id);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) await bond(x.q, x.sid, ids[i], ids[j], CONFIG.GHOST_BOND);
      await happy(x.q, [d.frightened.id], CONFIG.GHOST_FRIGHT);
      return { outcome: `Ghost stories! The young ones huddle closer, and ${first(d.frightened.name)} won't sleep alone for a week.`, chronicle: 'The children told ghost stories through the winter nights.' };
    }
    const grants = arr(d.young).map(y => ({ citizenId: y.id, classKey: y.cls, xp: CONFIG.TALE_XP }));
    await require('./careers').grantXp(x.client, x.sid, grants, []).catch(() => {});
    return { outcome: 'The old tales: each child picks up a little of a trade.', chronicle: 'Through the winter nights the children heard the old tales.' };
  },
});

module.exports = { CONFIG, calendar };
