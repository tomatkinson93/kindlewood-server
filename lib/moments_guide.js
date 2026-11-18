// ═══════════════════════════════════════════════════════════════════════════
//  The tour's own first moment (docs/PHASE_3_ONBOARDING.md; lib/guide.js).
//
//  The tour ends by having the player answer a moment. It used to borrow
//  whichever gentle one the town could have, and on some towns none could
//  start, which left the tour with nothing to answer. This one can always
//  start (it needs one living villager), is never rolled by itself
//  (`triggerOnly`, weight 0), costs little and has no wrong answer.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const { happy, first, pick, spend } = require('./moments_family');

const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";
const CONFIG = {
  SUPPER_FOOD: 20, SUPPER_HAPPY: 3,
  STORIES_BOND: 6,          // two neighbours grow this much closer
  REST_ENERGY: 15,
};

M.register('guide_first_evening', {
  source: 'guide', icon: '🔥', title: 'The first evening', weight: 0, triggerOnly: true, cooldownDays: 0, expireHours: 24, gentle: true,
  async eligible(ctx) {
    const cs = (await ctx.q(`SELECT id, name, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIVING} ORDER BY id`, [ctx.sid])).rows;
    if (!cs.length) return null;
    const grown = cs.filter(c => (c.life_stage || 'adult') !== 'child');
    const asker = ctx.asker_id ? cs.find(c => c.id === Number(ctx.asker_id)) : null;
    const who = asker || pick(ctx.rng, grown.length ? grown : cs);
    return { subject: { citizen_ids: [who.id] }, data: { name: who.name, speaker: who.name, food: CONFIG.SUPPER_FOOD } };
  },
  text: d => `"Our first evening here," says ${first(d.name)}. "How shall we spend it?"`,
  options: d => [
    { key: 'supper', label: 'A shared supper', hint: `${d.food} food; everyone a little happier`, risk: 1 },
    { key: 'stories', label: 'Stories by the fire', hint: 'nothing spent; two neighbours grow closer', risk: 0 },
    { key: 'early', label: 'An early night', hint: 'nothing spent; everyone rested', risk: 0 },
  ],
  fallback: 'early',
  async choose(key, x) {
    const ids = (await x.q(`SELECT id FROM citizens WHERE settlement_id = $1 AND ${LIVING}`, [x.sid])).rows.map(r => r.id);
    if (key === 'supper') {
      const no = await spend(x.q, x.sid, { food: x.d.food });
      if (no) return { error: no };
      await happy(x.q, ids, CONFIG.SUPPER_HAPPY);
      return { outcome: 'One long table, and everyone at it. The camp feels like a town already.', chronicle: 'On their first evening the whole camp ate together.' };
    }
    if (key === 'stories') {
      const pair = (await x.q(`SELECT r.id, a.name AS a, b.name AS b FROM citizen_relationships r
                                 JOIN citizens a ON a.id = r.citizen_a_id JOIN citizens b ON b.id = r.citizen_b_id
                                WHERE r.settlement_id = $1 AND r.state <> 'partners' ORDER BY r.score DESC, r.id LIMIT 1`, [x.sid]).catch(() => ({ rows: [] }))).rows[0];
      if (pair) await x.q(`UPDATE citizen_relationships SET score = LEAST(89, score + $2), last_updated = NOW() WHERE id = $1`, [pair.id, CONFIG.STORIES_BOND]);
      return { outcome: pair ? `Stories until the fire burned low. ${first(pair.a)} and ${first(pair.b)} sat talking long after the rest.` : 'Stories until the fire burned low.',
        chronicle: 'On their first evening the camp told stories by the fire.' };
    }
    await x.q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{energy}',
                 to_jsonb(LEAST(100, COALESCE((life->>'energy')::numeric, 70) + $2))) WHERE settlement_id = $1 AND ${LIVING}`, [x.sid, CONFIG.REST_ENERGY]);
    return { outcome: 'An early night. Everyone wakes rested.', chronicle: 'On their first evening the camp turned in early.' };
  },
});

module.exports = { CONFIG };
