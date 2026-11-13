// ══════════════════════════════════════════════════════════════════════════
//  Quests and the road (docs/PHASE_2_MOMENTS.md §3, M14–M17). These follow
//  events, so they are offered (moments.offer: the daily budget, the cap and
//  cooldowns, but no spacing) when a quest comes home or a battle is won.
//  At most one per event.
//
//    M14 road_find        the party found something
//    M15 wounded_stranger they met someone hurt on the way home
//    M16 rival_party      another town's party wanted the same prize; settles
//                         the reward, which routes/quests.js collect reads
//    M17 froze            someone panicked in the fight
//
//  The spec has M15 and M16 happen mid-quest. Quests here resolve in one go,
//  so both are asked as the party comes home: carrying the stranger tires the
//  party instead of delaying the quest, and the rival decides the reward
//  before it is collected (collecting first takes the default).
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const { query } = require('../db');
const { happy, bond, spend, first, arr, pick } = require('./moments_family');

const CONFIG = {
  FIND_ODDS: 0.20,       // a successful quest
  RIVAL_ODDS: 0.10,      // a successful party quest
  STRANGER_ODDS: 0.08,   // any party quest home
  FROZE_ODDS: 0.12,      // a battle won with two or more
  STRANGER_STAYS: 0.6,
  RACE_WIN: 0.5,
};

const names = async ids => (await query('SELECT id, name, visible_traits, life, role, stats FROM citizens WHERE id = ANY($1::int[])', [ids.map(Number)])).rows;
const villageOf = async (q, sid) => (await q(`SELECT n.id, n.name FROM diplomacy_relations d JOIN npc_settlements n ON n.id = d.npc_id WHERE d.settlement_id = $1 ORDER BY random() LIMIT 1`, [sid]).catch(() => ({ rows: [] }))).rows[0] || null;
const trust = (q, sid, npc, delta) => q('UPDATE diplomacy_relations SET trust = LEAST(100, GREATEST(0, trust + $3)), last_interaction = NOW() WHERE settlement_id = $1 AND npc_id = $2', [sid, npc, delta]);
async function bondAll(q, sid, ids, delta) { for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) await bond(q, sid, ids[i], ids[j], delta); }

// ── M14 A find on the road ─────────────────────────────────────────────────
M.register('road_find', {
  source: 'quest', icon: '🎁', title: 'A find on the road', weight: 0, cooldownDays: 1, expireHours: 12,
  async eligible(ctx) {
    const party = arr(ctx.party).map(Number);
    if (!party.length) return null;
    const item = (await ctx.q(`SELECT item_key, name, icon, description, category, rarity, equip_slot, stat_bonuses, sell_value FROM item_templates
                                WHERE category = 'equipment' AND equip_slot IS NOT NULL AND COALESCE(sell_value, 0) BETWEEN 10 AND 150 ORDER BY random() LIMIT 1`)).rows[0];
    if (!item) return null;
    const who = pick(ctx.rng, await names(party));
    const village = await villageOf(ctx.q, ctx.sid);
    return { subject: { citizen_ids: party, quest_run_id: ctx.quest_run_id },
      data: { speaker: who.name, finder: { id: who.id, name: who.name }, party, item, price: Math.max(10, Number(item.sell_value) || 20), village } };
  },
  text: d => `On the road home ${first(d.finder.name)} found ${d.item.icon || ''} ${d.item.name}.`.replace(/\s+/g, ' '),
  options: d => [
    { key: 'home', label: 'Bring it home', hint: 'into the stores', risk: 0 },
    { key: 'finder', label: `Let ${first(d.finder.name)} keep it`, hint: `${first(d.finder.name)} wears it; the party grows closer`, risk: 0 },
    { key: 'sell', label: `Sell it${d.village ? ' in ' + d.village.name : ''}`, hint: `${d.price} wealth${d.village ? '; ' + d.village.name + ' trusts you a little more' : ''}`, risk: 0 },
  ],
  fallback: 'home',
  async choose(key, x) {
    const d = x.d, it = d.item;
    if (key === 'sell') {
      await x.q('UPDATE settlements SET wealth = wealth + $2 WHERE id = $1', [x.sid, d.price]);
      if (d.village) await trust(x.q, x.sid, d.village.id, 3);
      return { outcome: `${it.name} sold for ${d.price} wealth.`, chronicle: `${d.finder.name} found ${it.name} on the road; it was sold${d.village ? ' in ' + d.village.name : ''}.` };
    }
    const got = await require('./inventory').grantItem(x.q, x.sid, { item_key: it.item_key, name: it.name, description: it.description || '', icon: it.icon || '📦',
      category: it.category, rarity: it.rarity || 'common', equip_slot: it.equip_slot, stat_bonuses: it.stat_bonuses || {}, quantity: 1, source: 'road_find',
      metadata: { sell_value: it.sell_value } });
    if (key === 'finder' && got.item) {
      // Wear it if that slot is free; otherwise it waits in the stores for them.
      const busy = (await x.q('SELECT 1 FROM inventory_items WHERE equipped_to = $1 AND equip_slot = $2', [d.finder.id, it.equip_slot])).rows.length;
      if (!busy) await x.q('UPDATE inventory_items SET equipped_to = $1 WHERE id = $2', [d.finder.id, got.item.id]);
      await bondAll(x.q, x.sid, arr(d.party), 5);
      return { outcome: `${first(d.finder.name)} keeps ${it.name}${busy ? ' (in the stores until they free that slot)' : ' and wears it proudly'}.`, chronicle: `${d.finder.name} found ${it.name} on the road and kept it.` };
    }
    return { outcome: `${it.name} goes into the stores.`, chronicle: `${d.finder.name} found ${it.name} on the road and brought it home.` };
  },
});

// ── M15 A wounded stranger ─────────────────────────────────────────────────
M.register('wounded_stranger', {
  source: 'quest', icon: '🩹', title: 'A wounded stranger', weight: 0, cooldownDays: 3, expireHours: 12,
  async eligible(ctx) {
    const party = arr(ctx.party).map(Number);
    if (party.length < 2) return null;
    const S = require('./settlers');
    const { types, taken } = await S.townFor(ctx.sid);
    const people = await names(party);
    const kind = people.find(p => arr(p.visible_traits).some(t => t === 'loyal' || t === 'charming')) || people[0];
    return { subject: { citizen_ids: party, quest_run_id: ctx.quest_run_id },
      data: { speaker: kind.name, party, kindest: { id: kind.id, name: kind.name }, stranger: S.makeSettler(taken, types), stays: ctx.rng() < CONFIG.STRANGER_STAYS, food: 30 } };
  },
  text: d => `On the way home the party found ${d.stranger.name}, hurt and alone by the road.`,
  options: d => [
    { key: 'carry', label: 'Carry them home', hint: 'the party comes home tired; they may want to stay', risk: 1 },
    { key: 'leave', label: 'Leave supplies and go on', hint: `${d.food} food; ${first(d.kindest.name)} is troubled`, risk: 1 },
  ],
  fallback: 'carry',
  async choose(key, x) {
    const d = x.d;
    if (key === 'leave') {
      await x.q('UPDATE settlements SET food = GREATEST(0, food - $2) WHERE id = $1', [x.sid, d.food]);
      await happy(x.q, [d.kindest.id], -6);
      return { outcome: `They left food for ${first(d.stranger.name)} and went on. ${first(d.kindest.name)} keeps looking back.`, chronicle: `The party left supplies for a wounded stranger, ${d.stranger.name}.` };
    }
    await happy(x.q, arr(d.party), -3);
    const beds = (await x.q(`SELECT (SELECT COALESCE(SUM(capacity), 0) FROM houses WHERE settlement_id = $1)::int AS beds,
                                    (SELECT COUNT(*) FROM citizens WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') <> 'deceased')::int AS n`, [x.sid])).rows[0];
    if (d.stays && beds.n < beds.beds) {
      const s = (await x.q('SELECT id, name FROM settlements WHERE id = $1', [x.sid])).rows[0];
      await require('./settlers').admitOne(s, { ...d.stranger, at: Date.now() },
        { q: x.q, text: `${d.stranger.name}, ${d.stranger.age}, was carried home hurt from the road, and stayed to start the ${d.stranger.surname} family.` });
      return { outcome: `${first(d.stranger.name)} recovered and asked to stay. A new family begins.`, chronicle: false };
    }
    await x.q('UPDATE settlements SET wealth = wealth + 20 WHERE id = $1', [x.sid]);
    return { outcome: `${first(d.stranger.name)} recovered and went home, and sent 20 wealth in thanks.`, chronicle: `The party carried a wounded stranger, ${d.stranger.name}, home to recover.` };
  },
});

// ── M16 A rival party ──────────────────────────────────────────────────────
// The reward multiplier is read by routes/quests.js collect (rewardMult).
M.register('rival_party', {
  source: 'quest', icon: '⚔️', title: 'A rival party', weight: 0, cooldownDays: 3, expireHours: 12,
  async eligible(ctx) {
    const party = arr(ctx.party).map(Number);
    if (party.length < 2 || !ctx.quest_run_id) return null;
    const run = (await ctx.q('SELECT quest_id FROM settlement_quests WHERE id = $1', [ctx.quest_run_id])).rows[0];
    if (!run) return null;
    const lead = (await names(party))[0];
    return { subject: { citizen_ids: party, quest_run_id: ctx.quest_run_id },
      data: { speaker: lead.name, party, title: ctx.title || 'the quest', win: ctx.rng() < CONFIG.RACE_WIN, village: await villageOf(ctx.q, ctx.sid) } };
  },
  text: d => `Another town's party reached the prize of "${d.title}" at the same time as yours.`,
  options: d => [
    { key: 'share', label: 'Share it', hint: `half the reward${d.village ? '; ' + d.village.name + ' hears of it kindly' : ''}`, risk: 1 },
    { key: 'race', label: 'Race them for it', hint: 'the whole reward, or nothing', risk: 2 },
    { key: 'yield', label: 'Let them have it', hint: `no reward${d.village ? '; ' + d.village.name + ' owes you a favour' : ''}`, risk: 1 },
  ],
  fallback: 'share',
  async choose(key, x) {
    const d = x.d;
    if (key === 'race') {
      return d.win ? { outcome: 'Your party won the race and brings home the whole reward.', chronicle: `${arr(d.party).length} of the town's folk outran a rival party on "${d.title}".` }
                   : { outcome: 'The rivals got there first. Your party comes home empty-handed.', chronicle: `A rival party beat the town's to the prize of "${d.title}".` };
    }
    if (d.village) await trust(x.q, x.sid, d.village.id, key === 'yield' ? 8 : 4);
    return key === 'yield' ? { outcome: `Your party stood aside. ${d.village ? d.village.name + ' will remember it.' : 'The rivals were grateful.'}`, chronicle: `The town's party let a rival have the prize of "${d.title}".` }
                           : { outcome: 'The two parties shared the prize.', chronicle: `The town's party shared the prize of "${d.title}" with a rival.` };
  },
});
// What share of a quest's reward is collected (1 unless a rival moment settled otherwise).
async function rewardMult(db, sid, runId) {
  const m = (await db.query(`SELECT choice, data FROM moments WHERE settlement_id = $1 AND kind = 'rival_party' AND subject->>'quest_run_id' = $2 AND resolved_at IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [sid, String(runId)])).rows[0];
  if (!m) return 1;
  return m.choice === 'race' ? (m.data && m.data.win ? 1 : 0) : m.choice === 'yield' ? 0 : 0.5;
}
// Collecting while the rival moment is still open takes its default first.
async function settleRivalFor(sid, runId) {
  const m = (await query(`SELECT id FROM moments WHERE settlement_id = $1 AND kind = 'rival_party' AND subject->>'quest_run_id' = $2 AND resolved_at IS NULL`, [sid, String(runId)])).rows[0];
  if (m) await M.choose(sid, m.id, M.DEFS.rival_party.fallback, true);
}

// ── M17 The one who froze ──────────────────────────────────────────────────
const FIGHTERS = new Set(['soldier', 'archer']);
M.register('froze', {
  source: 'quest', icon: '😨', title: 'The one who froze', weight: 0, cooldownDays: 3, expireHours: 12,
  async eligible(ctx) {
    const party = arr(ctx.party).map(Number);
    if (party.length < 2) return null;
    const ppl = (await names(party)).filter(p => !arr(p.visible_traits).some(t => t === 'brave' || t === 'shaken'));
    if (!ppl.length) return null;
    const who = pick(ctx.rng, ppl);
    return { subject: { citizen_ids: [who.id] },
      data: { speaker: who.name, who: { id: who.id, name: who.name, fighter: FIGHTERS.has(who.role) }, overcome: ctx.rng() < 0.55 } };
  },
  text: d => `${d.who.name} froze in the fight and couldn't lift a hand. They're ashamed.`,
  options: d => [
    { key: 'nothing', label: 'Say nothing', hint: 'they recover on their own, slowly', risk: 1 },
    { key: 'again', label: 'Send them out again soon', hint: 'they may find their courage, or lose heart', risk: 2 },
    { key: 'home', label: 'Give them work at home', hint: d.who.fighter ? 'safe; they stop being a fighter' : 'safe; they keep away from fighting', risk: 0 },
  ],
  fallback: 'nothing',
  async choose(key, x) {
    const d = x.d, id = d.who.id;
    const addTrait = async (t, stat) => {
      await x.q(`UPDATE citizens SET visible_traits = COALESCE(visible_traits, '[]'::jsonb) || $2::jsonb,
                   stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{strength}', to_jsonb(GREATEST(1, COALESCE((stats->>'strength')::int, 5) + $3)))
                 WHERE id = $1 AND NOT (COALESCE(visible_traits, '[]'::jsonb) ? $4)`, [id, JSON.stringify([t]), stat, t]);
    };
    if (key === 'again') {
      if (d.overcome) { await addTrait('brave', 2); await happy(x.q, [id], 6);
        return { outcome: `${first(d.who.name)} went out again and stood their ground. They are Brave now.`, chronicle: `${d.who.name} overcame their fear and was called Brave.` }; }
      await addTrait('shaken', -1); await happy(x.q, [id], -10);
      return { outcome: `${first(d.who.name)} went out again and froze again. They are Shaken.`, chronicle: `${d.who.name} lost heart after a fight.` };
    }
    if (key === 'home') {
      if (d.who.fighter) await x.q("UPDATE citizens SET role = 'forager' WHERE id = $1", [id]);
      await happy(x.q, [id], 4);
      return { outcome: `${first(d.who.name)} works at home now${d.who.fighter ? ', as a forager' : ''}, and is glad of it.`, chronicle: `${d.who.name} gave up fighting for work at home.` };
    }
    await happy(x.q, [id], -5);
    return { outcome: `Nobody mentions it. ${first(d.who.name)} will come round in time.`, chronicle: `${d.who.name} froze in a fight; nobody spoke of it.` };
  },
});

// ── Listeners (index.js) ───────────────────────────────────────────────────
// One moment at most per event. `rng` for tests.
async function onQuest(p, rng = Math.random) {
  if (!p || !p.settlementId || !p.questRunId) return null;
  const run = (await query('SELECT quest_type, quest_id, party_ids, citizen_id FROM settlement_quests WHERE id = $1', [p.questRunId])).rows[0];
  if (!run) return null;
  const party = run.quest_type === 'party' ? arr(run.party_ids).map(Number) : (run.citizen_id ? [Number(run.citizen_id)] : []);
  if (!party.length) return null;
  let title = null;
  try { const Q = require('../routes/quests'); const d = (Q.PARTY_QUEST_POOL.concat(Q.QUEST_POOL)).find(q => q.id === run.quest_id); title = d ? d.title : null; } catch (e) { /* none */ }
  const args = { party, quest_run_id: p.questRunId, title };
  const tries = [];
  if (p.success && run.quest_type === 'party') tries.push(['rival_party', CONFIG.RIVAL_ODDS]);
  if (p.success) tries.push(['road_find', CONFIG.FIND_ODDS]);
  if (run.quest_type === 'party') tries.push(['wounded_stranger', CONFIG.STRANGER_ODDS]);
  for (const [kind, odds] of tries) if (rng() < odds) return M.offer(p.settlementId, kind, args);
  return null;
}
async function onBattle(p, rng = Math.random) {
  const party = arr(p && p.citizenIds).map(Number).filter(Boolean);
  if (!p || !p.settlementId || party.length < 2 || rng() >= CONFIG.FROZE_ODDS) return null;
  return M.offer(p.settlementId, 'froze', { party });
}
function register() {
  const ge = require('./game_events');
  ge.on('quest_completed', p => onQuest(p).catch(e => console.error('[moments] quest', e.message)));
  ge.on('battle_won', p => onBattle(p).catch(e => console.error('[moments] battle', e.message)));
}

module.exports = { CONFIG, onQuest, onBattle, register, rewardMult, settleRivalFor };
