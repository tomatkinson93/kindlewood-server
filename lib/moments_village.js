// ══════════════════════════════════════════════════════════════════════════
//  Villages (docs/PHASE_2_MOMENTS.md §3, M18–M20). Rolled like the others,
//  each needing a village at enough trust (diplomacy_relations.trust:
//  21–40 familiar, 41–70 friendly, 71+ allied).
//
//    M18 village_help   their harvest failed
//    M19 envoy_offer    a marriage between your town and theirs
//    M20 debt_called    a village that has stood by you asks a favour
//
//  M19 differs from §3: there is no "left town" state for a citizen, so the
//  marriage brings a spouse from the village to live here instead of one of
//  yours leaving. The village's trust rises either way.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const LIFE = require('./life');
const { happy, spend, living, first, pick, LIVING } = require('./moments_family');

const CONFIG = {
  HELP_FOOD_PER_TIER: 80, HELP_TRUST: 6, WORKERS_TRUST: 10, WORKERS_DAYS: 2, DECLINE_TRUST: -3,   // M18
  MARRY_TRUST: 12,                                                                                // M19
  FAVOUR_PER_TIER: 60, FAVOUR_TRUST: 4, PUT_OFF_TRUST: -8,                                       // M20
};
const TIER = { camp: 0, village: 1, town: 2, city: 3 };
const tierOf = s => (TIER[s.tier] || 0) + 1;
const RES = r => (r === 'metal' ? 'iron' : r);

// A known, peaceful village with at least `min` trust (the most trusted first,
// with a little chance so it isn't always the same one).
async function villageAt(ctx, min) {
  const rows = (await ctx.q(`SELECT n.id, n.name, d.trust FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id
                              WHERE d.settlement_id = $1 AND d.trust >= $2
                                AND COALESCE(n.disposition, 'neutral') <> 'hostile' AND COALESCE(n.faction, 'neutral') <> 'hostile'
                              ORDER BY d.trust DESC LIMIT 3`, [ctx.sid, min])).rows;
  return rows.length ? pick(ctx.rng, rows) : null;
}
const trust = (q, sid, npc, delta) => q(`UPDATE diplomacy_relations SET trust = LEAST(100, GREATEST(0, trust + $3)), last_interaction = NOW(),
                                          interactions = interactions + 1 WHERE settlement_id = $1 AND npc_id = $2`, [sid, npc, delta]);

// ── M18 A village asks for help ────────────────────────────────────────────
M.register('village_help', {
  source: 'village', icon: '🌾', title: 'A village asks for help', weight: 2, cooldownDays: 5, expireHours: 24,
  async eligible(ctx) {
    const v = await villageAt(ctx, 21);
    if (!v) return null;
    const town = await living(ctx);
    const away = new Set((await require('./careers').awayMap(null, ctx.sid).catch(() => new Map())).keys());
    const hands = town.filter(c => c.life_stage === 'adult' && !away.has(c.id) && LIFE.ageOf(c, ctx.now) < 60);
    return { subject: { citizen_ids: [], npc_id: v.id },
      data: { speaker: `An envoy from ${v.name}`, village: { id: v.id, name: v.name }, food: CONFIG.HELP_FOOD_PER_TIER * tierOf(ctx.settlement),
        // Two can go only if at least two others stay to keep the town going.
        workers: hands.length >= 4 ? hands.slice().sort(() => ctx.rng() - 0.5).slice(0, 2).map(c => ({ id: c.id, name: c.name })) : [] } };
  },
  text: d => `${d.village.name}'s harvest has failed, and they ask if you can spare anything.`,
  options: d => [
    { key: 'food', label: `Send ${d.food} food`, hint: `${d.village.name} trusts you more`, risk: 1 },
    ...(d.workers.length ? [{ key: 'workers', label: `Send ${d.workers.map(w => first(w.name)).join(' and ')} to help`, hint: `trust rises more; they are away ${CONFIG.WORKERS_DAYS} days`, risk: 1 }] : []),
    { key: 'decline', label: 'Decline', hint: 'trust falls a little', risk: 1 },
  ],
  fallback: 'food',
  async choose(key, x) {
    const d = x.d, v = d.village;
    if (key === 'food') {
      const no = await spend(x.q, x.sid, { food: d.food });
      if (no) return { error: no };
      await trust(x.q, x.sid, v.id, CONFIG.HELP_TRUST);
      return { outcome: `${d.food} food went to ${v.name}. They won't forget it.`, chronicle: `The town sent ${d.food} food to ${v.name} when their harvest failed.` };
    }
    if (key === 'workers' && d.workers.length) {
      const ids = d.workers.map(w => w.id);
      await x.q(`UPDATE citizens SET away_until = NOW() + make_interval(days => $3), away_reason = $4 WHERE id = ANY($1::int[]) AND settlement_id = $2`,
        [ids, x.sid, CONFIG.WORKERS_DAYS, `helping ${v.name}`]);
      await trust(x.q, x.sid, v.id, CONFIG.WORKERS_TRUST);
      const who = d.workers.map(w => first(w.name)).join(' and ');
      return { outcome: `${who} went to help ${v.name} bring in what is left. They'll be back in ${CONFIG.WORKERS_DAYS} days.`, chronicle: `${d.workers.map(w => w.name).join(' and ')} went to help ${v.name} after their harvest failed.` };
    }
    await trust(x.q, x.sid, v.id, CONFIG.DECLINE_TRUST);
    return { outcome: `You sent ${v.name} away with nothing. They are disappointed.`, chronicle: `${v.name} asked for help, and the town could not give it.` };
  },
});

// ── M19 An envoy's offer ───────────────────────────────────────────────────
M.register('envoy_offer', {
  source: 'village', icon: '💐', title: "An envoy's offer", weight: 1, cooldownDays: 10, expireHours: 24,
  async eligible(ctx) {
    const v = await villageAt(ctx, 41);
    if (!v) return null;
    const free = (await LIFE.beds(ctx.sid, ctx.q)).free;
    if (free <= 0) return null;
    const single = (await living(ctx)).filter(c => c.life_stage === 'adult' && !c.partner_id && LIFE.ageOf(c, ctx.now) >= 16 && LIFE.ageOf(c, ctx.now) < 45);
    if (!single.length) return null;
    const ours = pick(ctx.rng, single);
    const S = require('./settlers');
    const { types, taken } = await S.townFor(ctx.sid);
    const spouse = S.makeSettler(taken, types);
    spouse.gender = ours.gender === 'female' ? 'male' : 'female';
    spouse.age = Math.max(16, Math.min(44, Math.round(LIFE.ageOf(ours, ctx.now)) + Math.floor(ctx.rng() * 5) - 2));
    spouse.life = { ...spouse.life, age: spouse.age };
    // Someone from the village brings a gift of their own: a good trait.
    const good = require('../citizens').VISIBLE_TRAITS.filter(t => Object.values(t.effect).every(n => n >= 0) && !spouse.visible_traits.includes(t.id));
    const gift = pick(ctx.rng, good);
    spouse.visible_traits = [...spouse.visible_traits, gift.id];
    const { MALE_NAMES, FEMALE_NAMES } = require('../citizens');
    spouse.name = `${pick(ctx.rng, spouse.gender === 'male' ? MALE_NAMES : FEMALE_NAMES)} ${spouse.surname}`;
    return { subject: { citizen_ids: [ours.id], npc_id: v.id },
      data: { speaker: `An envoy from ${v.name}`, village: { id: v.id, name: v.name }, ours: { id: ours.id, name: ours.name }, spouse, gift: gift.label } };
  },
  text: d => `${d.village.name} proposes a marriage: ${d.spouse.name} would come to live here with ${d.ours.name}.`,
  options: d => [
    { key: 'accept', label: 'Accept', hint: `a new citizen (${d.gift}) and lasting trust with ${d.village.name}`, risk: 0 },
    { key: 'decline', label: 'Decline politely', hint: 'nothing changes', risk: 0 },
  ],
  fallback: 'accept',
  async choose(key, x) {
    const d = x.d, v = d.village;
    if (key !== 'accept') return { outcome: `You thanked ${v.name} and declined.`, chronicle: `${v.name} offered a marriage, and the town politely declined.` };
    const ours = (await x.q(`SELECT id, partner_id FROM citizens WHERE id = $1 AND ${LIVING} FOR UPDATE`, [d.ours.id])).rows[0];
    if (!ours || ours.partner_id) return { outcome: `${first(d.ours.name)} is no longer free to marry; ${v.name} understands.` };
    if ((await LIFE.beds(x.sid, x.q)).free <= 0) return { outcome: `There was no room for ${first(d.spouse.name)} after all; ${v.name} understands.` };
    const s = (await x.q('SELECT id, name FROM settlements WHERE id = $1', [x.sid])).rows[0];
    const came = await require('./settlers').admitOne(s, { ...d.spouse, at: Date.now() },
      { q: x.q, text: `${d.spouse.name} came from ${v.name} to marry ${d.ours.name}.` });
    await x.q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [came.id, d.ours.id]);
    await x.q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [d.ours.id, came.id]);
    const [lo, hi] = [Math.min(came.id, d.ours.id), Math.max(came.id, d.ours.id)];
    await x.q(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,92,'partners')
               ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score = 92, state = 'partners'`, [x.sid, lo, hi]);
    await LIFE.autoHouse(x.sid, { couples: [[d.ours.id, came.id]] }, x.q);
    await trust(x.q, x.sid, v.id, CONFIG.MARRY_TRUST);
    return { outcome: `${first(d.spouse.name)} came from ${v.name} and married ${first(d.ours.name)}.`, chronicle: false };
  },
});

// ── M20 A debt called in ───────────────────────────────────────────────────
M.register('debt_called', {
  source: 'village', icon: '🤝', title: 'A debt called in', weight: 1, cooldownDays: 7, expireHours: 24,
  async eligible(ctx) {
    const v = await villageAt(ctx, 41);
    if (!v) return null;
    const res = pick(ctx.rng, ['timber', 'stone', 'food']);
    return { subject: { citizen_ids: [], npc_id: v.id },
      data: { speaker: `An envoy from ${v.name}`, village: { id: v.id, name: v.name }, res, amount: CONFIG.FAVOUR_PER_TIER * tierOf(ctx.settlement),
        need: { timber: 'to mend their bridge', stone: 'to rebuild a wall the floods took', food: 'to feed travellers at their fair' }[res] } };
  },
  text: d => `${d.village.name} has stood by you, and now asks a favour: ${d.amount} ${RES(d.res)} ${d.need}.`,
  options: d => [
    { key: 'honour', label: 'Honour it', hint: `${d.amount} ${RES(d.res)}`, risk: 1 },
    { key: 'putoff', label: 'Put them off', hint: `${d.village.name} trusts you less`, risk: 1 },
  ],
  fallback: 'honour',
  async choose(key, x) {
    const d = x.d, v = d.village;
    if (key === 'honour') {
      const no = await spend(x.q, x.sid, { [d.res]: d.amount });
      if (no) return { error: no };
      await trust(x.q, x.sid, v.id, CONFIG.FAVOUR_TRUST);
      return { outcome: `${d.amount} ${RES(d.res)} went to ${v.name}. The debt is paid.`, chronicle: `The town repaid ${v.name}'s friendship with ${d.amount} ${RES(d.res)}.` };
    }
    await trust(x.q, x.sid, v.id, CONFIG.PUT_OFF_TRUST);
    return { outcome: `You put ${v.name} off. They noticed.`, chronicle: `${v.name} called in a favour, and the town put them off.` };
  },
});

module.exports = { CONFIG, villageAt };
