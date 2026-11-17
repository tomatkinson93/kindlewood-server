// ══════════════════════════════════════════════════════════════════════════
//  Events in the scene (docs/HOME_SCENE.md Part F, F.12; step 26).
//
//  Three moments that happen in the town and can be answered there. Each is
//  an ordinary moment (the daily budget, the cap, a cooldown, a timer, a
//  default), with `subject.scene` saying what the Home scene should show:
//
//    scene_fire        smoke and flames on one building. A bucket chain, or
//                      pull down the roof.
//    scene_lost_child  a child hides somewhere in Home. Finding them in the
//                      scene is the good outcome (the option marked
//                      `scene: true` is not offered in the dialogue); or
//                      call a search, or wait.
//    scene_cart        a cart rolls down the lane. Stop it (in the scene or
//                      the dialogue), or let it go.
//
//  When they start, how long they last and what each outcome does are all
//  here. The scene decides only where things are drawn, from `subject.seed`.
//  Outcomes are kept mild on purpose: these are short (a few hours), so the
//  default will often be what happens.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const { happy, living, first, pick } = require('./moments_family');
const RD = require('./resource_defs');

const CONFIG = {
  // Fire
  FIRE_HOURS: 3, FIRE_COOLDOWN_DAYS: 6,
  BUCKETS_SAVE: 0.75,          // the chain puts it out with nothing lost
  FIRE_HELPERS: 4, FIRE_HELP_HAPPY: 3,
  FIRE_DAMAGE: 30,             // health off the building (upkeep on)
  FIRE_TIMBER: { camp: 10, village: 15, town: 25, city: 35 },   // timber lost when it takes hold, or spent on a new roof
  // Lost child
  CHILD_HOURS: 6, CHILD_COOLDOWN_DAYS: 5,
  FOUND_HAPPY: 5, FOUND_PARENT_HAPPY: 3,
  SEARCH_TIRED: -1,            // every grown villager, after a search
  WAIT_HOME: 0.7, WAIT_FRIGHT: -8, WAIT_PARENT: -5,
  // Runaway cart
  CART_HOURS: 2, CART_COOLDOWN_DAYS: 4,
  CART_FOOD: { camp: 15, village: 25, town: 40, city: 60 },   // its load, saved when it is stopped
  CART_BRUISE: 0.25, CART_BRUISE_HAPPY: -5, CART_HERO_HAPPY: 3,
  CART_TIMBER: { camp: 5, village: 8, town: 12, city: 16 },    // the cart, lost when it is let go
};
const tierOf = (map, s) => map[(s && s.tier) || 'camp'] || map.camp;
const seedOf = rng => Math.floor(rng() * 2147483647);
const grown = c => c.life_stage !== 'child';
async function give(q, sid, res) {
  const keys = Object.keys(res).filter(k => RD.isResource(k) && res[k] > 0);
  if (keys.length) await q(`UPDATE settlements SET ${keys.map((k, i) => `${k} = ${k} + $${i + 2}`).join(', ')} WHERE id = $1`, [sid, ...keys.map(k => res[k])]);
}
// Takes up to `n` of a resource; → what was taken (never below nothing).
async function takeUpTo(q, sid, key, n) {
  const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
  const got = Math.max(0, Math.min(n, Math.floor(Number(s[key]) || 0)));
  if (got > 0) await q(`UPDATE settlements SET ${key} = ${key} - $2 WHERE id = $1`, [sid, got]);
  return got;
}
const labelOf = type => { try { const b = require('../buildings').BUILDINGS[type]; return (b && b.label) || type; } catch (e) { return type; } };

// ── A fire ─────────────────────────────────────────────────────────────────
M.register('scene_fire', {
  source: 'scene', icon: '🔥', title: 'Fire!', weight: 2, cooldownDays: CONFIG.FIRE_COOLDOWN_DAYS, expireHours: CONFIG.FIRE_HOURS, gentle: false,
  async eligible(ctx) {
    const town = await living(ctx), hands = town.filter(grown);
    if (hands.length < 2) return null;
    // Not the Guild Hall (the town's heart), not housing (homes are their own
    // houses in the Neighbourhood now, not a building in the scene), and not
    // something already broken.
    const bs = (await ctx.q(`SELECT id, type, COALESCE(health, 100) AS health FROM buildings WHERE settlement_id = $1 AND type NOT IN ('guild_hall', 'starter_house') ORDER BY id`, [ctx.sid])).rows.filter(b => Number(b.health) > 0);
    if (!bs.length) return null;
    const b = pick(ctx.rng, bs), who = pick(ctx.rng, hands);
    return { subject: { scene: 'fire', building: b.type, building_id: b.id, citizen_ids: [who.id], seed: seedOf(ctx.rng) },
      data: { speaker: who.name, building: labelOf(b.type), building_id: b.id, timber: tierOf(CONFIG.FIRE_TIMBER, ctx.settlement), helpers: hands.filter(c => c.id !== who.id).slice(0, CONFIG.FIRE_HELPERS - 1).map(c => c.id).concat(who.id) } };
  },
  text: d => `${d.speaker ? first(d.speaker) + ' comes running' : 'A shout goes up'}: the ${d.building || 'building'} is on fire!`,
  options: d => [
    { key: 'buckets', label: 'Form a bucket chain', hint: `costs nothing; three times in four it saves the ${d.building || 'building'}`, risk: 1 },
    { key: 'roof', label: 'Pull down the roof', hint: `the fire is out for sure; ${d.timber || 10} timber for a new roof`, risk: 1 },
  ],
  fallback: 'buckets',
  async choose(key, x) {
    const d = x.d, name = d.building || 'building';
    if (key === 'roof') {
      const spent = await takeUpTo(x.q, x.sid, 'timber', d.timber || 10);
      return { outcome: `The roof came down and the fire went out with it. A new roof took ${spent} timber.`, chronicle: `Fire at the ${name}: the roof was pulled down to stop it.`, effects: { timber: -spent } };
    }
    if (x.rng() < CONFIG.BUCKETS_SAVE) {
      await happy(x.q, d.helpers || [], CONFIG.FIRE_HELP_HAPPY);
      return { outcome: `Bucket by bucket the fire was beaten. The ${name} is safe, and the chain is proud of itself.`, chronicle: `Fire at the ${name}: a bucket chain put it out.` };
    }
    const lost = await takeUpTo(x.q, x.sid, 'timber', d.timber || 10);
    let worn = false;
    try {
      const s = (await x.q('SELECT id, tier, upkeep_on FROM settlements WHERE id = $1', [x.sid])).rows[0];
      if (d.building_id && await require('./upkeep').enabled(s)) {
        worn = (await x.q('UPDATE buildings SET health = GREATEST(1, COALESCE(health, 100) - $2) WHERE id = $1 AND settlement_id = $3 RETURNING id', [d.building_id, CONFIG.FIRE_DAMAGE, x.sid])).rows.length > 0;
      }
    } catch (e) { /* upkeep not there */ }
    return { outcome: `The chain was too slow. The fire took part of the ${name} before it was out${lost ? `: ${lost} timber went into mending it` : ''}${worn ? ', and it is the worse for wear' : ''}.`,
      chronicle: `Fire at the ${name}: it was put out, but not before it did harm.`, effects: { timber: -lost } };
  },
});

// ── A lost child ───────────────────────────────────────────────────────────
M.register('scene_lost_child', {
  source: 'scene', icon: '🧒', title: 'A lost child', weight: 2, cooldownDays: CONFIG.CHILD_COOLDOWN_DAYS, expireHours: CONFIG.CHILD_HOURS, gentle: false,
  async eligible(ctx) {
    const town = await living(ctx), kids = town.filter(c => c.life_stage === 'child');
    if (!kids.length) return null;
    const child = pick(ctx.rng, kids);
    const parents = town.filter(c => (Array.isArray(child.parent_ids) ? child.parent_ids : []).map(Number).includes(c.id));
    const asks = parents[0] || town.find(grown);
    // The one who asks comes first: the scene puts the moment's mark on them (the child is hiding).
    return { subject: { scene: 'lost_child', citizen_ids: (asks ? [asks.id] : []).concat([child.id]), child_id: child.id, seed: seedOf(ctx.rng) },
      data: { speaker: asks ? asks.name : null, child: { id: child.id, name: child.name }, parents: parents.map(p => p.id), grown: town.filter(grown).map(c => c.id) } };
  },
  text: d => `${d.speaker ? first(d.speaker) + ' cannot find' : 'Nobody can find'} ${d.child ? first(d.child.name) : 'one of the children'}. They were playing a moment ago.`,
  options: d => [
    { key: 'found', label: 'Find them yourself', hint: 'look for them in Home: the best ending', risk: 0, scene: true },
    { key: 'search', label: 'Call everyone to search', hint: 'found for sure; everyone is a little tired after', risk: 1 },
    { key: 'wait', label: 'They will come home', hint: 'usually they do; sometimes cold and frightened', risk: 2 },
  ],
  fallback: 'search',
  async choose(key, x) {
    const d = x.d, kid = d.child || {}, name = first(kid.name);
    const here = kid.id ? (await x.q(`SELECT id FROM citizens WHERE id = $1 AND settlement_id = $2 AND COALESCE(life_stage, 'adult') <> 'deceased'`, [kid.id, x.sid])).rows[0] : null;
    if (!here) return { outcome: 'They were home all along.', chronicle: false };
    if (key === 'found') {
      await happy(x.q, [kid.id], CONFIG.FOUND_HAPPY); await happy(x.q, d.parents || [], CONFIG.FOUND_PARENT_HAPPY);
      return { outcome: `You found ${name} hiding, very pleased with the hiding place. All is well.`, chronicle: `${kid.name} went missing and was found hiding, safe and giggling.` };
    }
    if (key === 'search') {
      await happy(x.q, d.grown || [], CONFIG.SEARCH_TIRED);
      return { outcome: `The whole town turned out, and ${name} was found before dark. Everyone is a little tired.`, chronicle: `${kid.name} went missing; the whole town searched and found them.` };
    }
    if (x.rng() < CONFIG.WAIT_HOME) return { outcome: `${name} wandered home for supper, wondering what the fuss was about.`, chronicle: `${kid.name} went missing for an afternoon and came home for supper.` };
    await happy(x.q, [kid.id], CONFIG.WAIT_FRIGHT); await happy(x.q, d.parents || [], CONFIG.WAIT_PARENT);
    return { outcome: `${name} was found after dark, cold and frightened. It will be a while before they wander again.`, chronicle: `${kid.name} was lost until after dark, and came home cold and frightened.` };
  },
});

// ── A runaway cart ─────────────────────────────────────────────────────────
M.register('scene_cart', {
  source: 'scene', icon: '🛒', title: 'A runaway cart', weight: 2, cooldownDays: CONFIG.CART_COOLDOWN_DAYS, expireHours: CONFIG.CART_HOURS, gentle: false,
  async eligible(ctx) {
    const hands = (await living(ctx)).filter(c => c.life_stage === 'adult');
    if (!hands.length) return null;
    const who = pick(ctx.rng, hands);
    return { subject: { scene: 'cart', citizen_ids: [who.id], seed: seedOf(ctx.rng) },
      data: { speaker: who.name, hero: { id: who.id, name: who.name }, food: tierOf(CONFIG.CART_FOOD, ctx.settlement), timber: tierOf(CONFIG.CART_TIMBER, ctx.settlement) } };
  },
  text: d => `A loaded cart has slipped its chock and is rolling down the lane. ${d.hero ? first(d.hero.name) + ' is nearest.' : 'Someone could catch it.'}`,
  options: d => [
    { key: 'stop', label: 'Stop it', hint: `saves its load (${d.food || 15} food); one time in four ${d.hero ? first(d.hero.name) : 'the catcher'} is bruised`, risk: 1 },
    { key: 'let_go', label: 'Let it go', hint: `nobody is hurt; the cart is smashed (${d.timber || 5} timber)`, risk: 1 },
  ],
  fallback: 'let_go',
  async choose(key, x) {
    const d = x.d, hero = d.hero || {}, name = first(hero.name);
    if (key === 'let_go') {
      const lost = await takeUpTo(x.q, x.sid, 'timber', d.timber || 5);
      return { outcome: `The cart ran to the bottom of the lane and broke apart. Nobody was hurt${lost ? `; ${lost} timber went into a new one` : ''}.`, chronicle: 'A runaway cart was left to run, and smashed at the bottom of the lane.', effects: { timber: -lost } };
    }
    await give(x.q, x.sid, { food: d.food || 15 });
    if (x.rng() < CONFIG.CART_BRUISE) {
      if (hero.id) await happy(x.q, [hero.id], CONFIG.CART_BRUISE_HAPPY);
      return { outcome: `${name} caught the cart and was dragged a few yards for it. The load is safe (+${d.food || 15} food); ${name} is bruised and cross.`, chronicle: `${hero.name || 'Someone'} stopped a runaway cart and was bruised doing it.`, effects: { food: d.food || 15 } };
    }
    if (hero.id) await happy(x.q, [hero.id], CONFIG.CART_HERO_HAPPY);
    return { outcome: `${name} caught the cart with one hand, as if it happened every day. The load is safe (+${d.food || 15} food).`, chronicle: `${hero.name || 'Someone'} stopped a runaway cart before it came to harm.`, effects: { food: d.food || 15 } };
  },
});

module.exports = { CONFIG };
