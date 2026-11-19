#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
//  class_deck_sim — numbers for the class decks (docs/DUNGEON_CLASS_DECKS.md).
//
//  The proposal (2026-11-19): every citizen brings their own deck into a
//  dungeon, built from their class's base pack; a citizen with no fighting
//  class brings the Villager pack and one trade card from their job. This
//  script holds the proposed packs as data and plays whole dungeon runs with
//  them on the REAL combat engine, with the same bot, creatures, skull
//  scaling and room plans as scripts/dungeon_balance_sim.js (which it builds
//  on), so the two can be read side by side. Nothing here touches the
//  database or changes the game.
//
//    node scripts/class_deck_sim.js packs          the packs, with each card's effect
//    node scripts/class_deck_sim.js door [n]       how a deck should grow: door picks and fight rewards
//    node scripts/class_deck_sim.js tiers [n]      clear rates per skull and party
//    node scripts/class_deck_sim.js heal [n]       healing that withers against healing that does not
//
//  One deck per citizen needs no new engine rule to try: only the citizen
//  whose turn it is plays cards, so the script points the battle's deck at
//  that citizen's own deck as each turn starts. The engine then draws,
//  discards and reshuffles that deck as it would the shared one.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const _log = console.log; console.log = () => {};
const S = require('./dungeon_balance_sim');
console.log = _log;
const { E, REG, FM, DECK, C, citizen, unitOf, installRoster, encounter, cardValue, bestPlay, rng32, PLANS, REST, TIERS, LEVELS, pct, pad } = S;

// ── The packs ───────────────────────────────────────────────────────────────
// P(key, name, cost, type, target, formula, extra). A pack card belongs to a
// deck, not to a class requirement: whoever holds it can play it.
const P = (key, name, cost, type, target, formula, x) => C(key, name, null, cost, type, target, formula, x);
const PACK_CARDS = [
  // Guard (strength / endurance): the best plain attack and block, and block for others.
  P('g_strike',  'Strike',        1, 'attack',  'enemy',        'damage: strength*0.7 + combat*0.8 + 5', { hit: 'front' }),
  P('g_shield',  'Shield Up',     1, 'defense', 'self',         'block: endurance*0.8 + combat*0.5 + 5'),
  P('g_cover',   'Cover',         1, 'defense', 'ally',         'block: endurance*0.7 + combat*0.4 + 5'),
  P('g_shove',   'Shove',         1, 'attack',  'enemy',        'damage: strength*0.4 + combat*0.4 + 3\npush: 1\ndebuff weak: 2', { hit: 'front' }),
  P('g_heavy',   'Heavy Blow',    2, 'attack',  'enemy',        'damage: strength*1.2 + combat*1.2 + 8', { hit: 'front' }),
  // Archer (agility / strength): any target, the line, and getting out of reach.
  P('a_shoot',   'Shoot',         1, 'attack',  'enemy',        'damage: agility*0.7 + combat*0.8 + 4'),
  P('a_side',    'Sidestep',      1, 'defense', 'self',         'block: agility*0.6 + combat*0.4 + 4'),
  P('a_part',    'Parting Shot',  1, 'attack',  'enemy',        'damage: agility*0.5 + combat*0.6 + 3\nblock: agility*0.3 + 2\nmove: 1'),
  P('a_pierce',  'Piercing Arrow', 2, 'attack', 'enemy',        'damage: agility*0.8 + combat*0.8 + 5', { hit: 'pierce', falloff: 0.6 }),
  P('a_mark',    'Mark',          0, 'support', 'enemy',        'debuff vulnerable: 3'),
  // Wizard (intelligence / agility): weak basics, real spells, little health.
  P('w_spark',   'Spark',         1, 'attack',  'enemy',        'damage: intelligence*0.5 + combat*0.4 + 3'),
  P('w_ward',    'Ward',          1, 'defense', 'ally_or_self', 'block: intelligence*0.6 + combat*0.3 + 3'),
  P('w_bolt',    'Firebolt',      1, 'attack',  'enemy',        'damage: intelligence*0.8 + combat*0.6 + 5'),
  P('w_burst',   'Ember Burst',   2, 'attack',  'all_enemies',  'damage: intelligence*0.6 + combat*0.4 + 2'),
  P('w_chill',   'Chill',         1, 'attack',  'enemy',        'damage: intelligence*0.4 + 2\nslow: 3\ndebuff weak: 3'),
  // Hearthkeeper (intelligence / charisma): keeps the others standing. Healing withers.
  P('h_cinder',  'Cinder',        1, 'attack',  'enemy',        'damage: intelligence*0.5 + combat*0.4 + 3'),
  P('h_ward',    'Hearth Ward',   1, 'defense', 'ally_or_self', 'block: intelligence*0.6 + charisma*0.3 + 3'),
  P('h_kindle',  'Kindle',        1, 'support', 'ally_or_self', 'heal: intelligence*0.6 + charisma*0.4 + 4', { wither: true }),
  P('h_steady',  'Steady Now',    1, 'defense', 'all_allies',   'block: charisma*0.4 + 2'),
  P('h_bold',    'Embolden',      0, 'support', 'ally',         'buff damage_bonus: charisma*0.5 + 2'),
  // Villager (no fighting class): the plainest basics.
  P('v_swing',   'Swing',         1, 'attack',  'enemy',        'damage: strength*0.6 + combat*0.8 + 5'),
  P('v_duck',    'Duck',          1, 'defense', 'self',         'block: endurance*0.7 + combat*0.5 + 5'),
  // Trade cards: one by the kind of job a villager holds (two copies in their deck).
  P('t_tool',    'Tool of the Trade', 2, 'attack',  'enemy',    'damage: strength*1.0 + combat*0.8 + 7', { hit: 'front' }),            // gathering: axe, pick, pitchfork
  P('t_spot',    'Spot the Weakness', 0, 'support', 'enemy',    'debuff vulnerable: 2\ndraw: 1'),                                      // travel: scouts
  P('t_shore',   'Shore Up',      1, 'defense', 'ally_or_self', 'block: endurance*0.5 + 6'),                                           // crafting: builders, smiths
  P('t_ration',  'Share Rations', 1, 'support', 'ally_or_self', 'heal: 7', { wither: true }),                                          // trade: porters, merchants
  P('t_drink',   'Strong Drink',  1, 'support', 'ally',         'heal: 4\nbuff damage_bonus: charisma*0.3 + 3', { wither: true }),     // service: the tavernkeep
  P('t_signs',   'Read the Signs', 1, 'support', 'enemy',       'debuff weak: 3\ndraw: 1'),                                            // learning: scholars
  // The Hearthkeeper's healing, were it not to wither (the `heal` report).
  P('h_kindle_keep', 'Kindle (kept)', 1, 'support', 'ally_or_self', 'heal: intelligence*0.6 + charisma*0.4 + 4'),
];
// Ten cards a pack: plain attacks and blocks, and four of the class's own.
const PACKS = {
  guard:        { label: 'Guard',        deck: { g_strike: 3, g_shield: 3, g_cover: 2, g_shove: 1, g_heavy: 1 } },
  archer:       { label: 'Archer',       deck: { a_shoot: 3, a_side: 3, a_part: 2, a_pierce: 1, a_mark: 1 } },
  wizard:       { label: 'Wizard',       deck: { w_spark: 3, w_ward: 3, w_bolt: 2, w_burst: 1, w_chill: 1 } },
  hearthkeeper: { label: 'Hearthkeeper', deck: { h_cinder: 3, h_ward: 3, h_kindle: 1, h_steady: 1, h_bold: 2 } },
};
const TRADES = { gathering: 't_tool', travel: 't_spot', crafting: 't_shore', trade: 't_ration', service: 't_drink', learning: 't_signs' };
const VILLAGER = { deck: { v_swing: 5, v_duck: 3 }, trade: 2 };
const villagerDeck = kind => ({ ...VILLAGER.deck, [TRADES[kind] || 't_tool']: VILLAGER.trade });
// What a citizen can be offered beyond their pack: their pack's own cards
// again (anyone has these), and what the town has unlocked for them.
const BASICS = ['g_strike', 'g_shield', 'a_shoot', 'a_side', 'w_spark', 'w_ward', 'h_cinder', 'h_ward', 'v_swing', 'v_duck'];
const UNLOCKED = {
  guard: ['stand_fast', 'guards_oath', 'hammer_blow', 'hold_the_line', 'shield_bash', 'bulwark'],
  archer: ['aimed_shot', 'piercing_arrow', 'pin_down', 'hail_of_arrows', 'arrow_rain', 'hamstring'],
  wizard: ['firebolt', 'fireball', 'scorch', 'frost_lance', 'ice_ward', 'deep_freeze', 'chain_lightning', 'thunderclap'],
  hearthkeeper: ['ember_ward', 'banish_blight', 'rekindle', 'battle_cry'],
  villager: ['second_wind', 'venom_edge', 'smoke_bomb', 'hamstring', 'shield_bash'],
};
// Plain cards every town owns from its first day (five of today's nine starter cards).
const COMMON = ['quick_jab', 'cleave', 'weaken', 'expose', 'rally'];
// Healing cards. Under the "spent until the party rests" rule a heal that has been
// played leaves its owner's deck until the next rest room or landing.
const HEALS = ['h_kindle', 'h_kindle_keep', 't_ration', 't_drink', 'kindle', 'hearthlight', 'rekindle', 'mend', 'second_wind'];
function loadAll() { REG.loadRows(S.ALL_CARDS.map(c => (c.card_key === 'focus' ? { ...c, wither: true } : c)).concat(PACK_CARDS)); }

// ── A citizen with a deck ───────────────────────────────────────────────────
// who: 'guard' | 'archer' | 'wizard' | 'hearthkeeper' | 'villager:<kind>'
function member(who, level, opts = {}) {
  const [cls, kind] = who.split(':');
  const isClass = !!PACKS[cls];
  const c = citizen(isClass ? cls : null, level);
  let deck = isClass ? { ...PACKS[cls].deck } : villagerDeck(kind || 'gathering');
  if (opts.heals && deck.h_kindle) { deck = { ...deck, h_kindle: opts.heals, h_cinder: Math.max(1, deck.h_cinder + deck.h_kindle - opts.heals) }; }
  if (opts.keepHeals && deck.h_kindle) { deck = { ...deck, h_kindle_keep: deck.h_kindle }; delete deck.h_kindle; }
  // Offers: the pack's own cards again; for a villager also the plain cards every town starts with; and what the town has unlocked.
  const own = Object.keys(deck).filter(k => !BASICS.includes(k));
  const pool = own.concat(isClass ? [] : COMMON).concat(opts.unlocks ? (UNLOCKED[isClass ? cls : 'villager'] || []) : []);
  // opts.ban: cards taken out of every pack and offer (to see what a card is worth to a party).
  for (const k of (opts.ban || [])) { if (deck[k]) { const basic = Object.keys(deck)[0]; deck = { ...deck, [basic]: deck[basic] + deck[k] }; delete deck[k]; } }
  const offers = pool.filter(k => !(opts.ban || []).includes(k));
  const max = E.statsFromCitizen(c).maxHp;
  return { c, who, cls: isClass ? cls : 'villager', deck, pool: offers, hp: max, max };
}
// What a card is worth to this citizen, per energy, in a plain scene (hurt, two creatures in front).
function rate(p, key) {
  const card = REG.getCard(key);
  const who = unitOf(p.c);
  const dummy = { side: 'enemy', hp: 60, maxHp: 60, block: 0, buffs: {}, enemy_key: 'wild_fox', flags: {}, pos: 1, _intent: S.MON.wild_fox.moves[0] };
  const hurt = { ...who, hp: who.maxHp * 0.6, pos: 1 };
  const mate = { ...who, id: 'mate', hp: who.maxHp * 0.5, pos: 2 };
  const fake = { units: [hurt, mate, dummy, { ...dummy, pos: 2 }], deck: { hand: [], drawPile: [], discardPile: [], energy: 3 } };
  const t = card.target === 'enemy' ? dummy : card.target === 'ally' ? mate : hurt;
  let v = cardValue(fake, hurt, card, t) / Math.max(card.cost, 0.6);
  if ((p.deck[key] || 0) >= 2) v *= 0.6;
  if (card.wither && (p.deck[key] || 0) >= 1) v *= 0.6;
  return v;
}
// A deck holds one of any healing card at most, so a healer cannot be made of nothing but heals.
const offerFor = (p, rnd, n = 3) => { const o = [], pool = p.pool.filter(k => !(HEALS.includes(k) && ((p.deck[k] || 0) > 0 || (p.spent || []).includes(k)))); while (o.length < n && pool.length) o.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); return o; };
// At the door: each citizen is shown three cards of their own and keeps one.
function doorPick(p, rnd) { const o = offerFor(p, rnd); if (!o.length) return; const k = o.sort((a, b) => rate(p, b) - rate(p, a))[0]; p.deck[k] = (p.deck[k] || 0) + 1; }
// After a fight: three cards, each for a different citizen; the party keeps one.
function reward(party, rnd) {
  const who = party.slice().sort(() => rnd() - 0.5).slice(0, 3);
  let best = null;
  for (const p of who) { const k = offerFor(p, rnd, 1)[0]; if (!k) continue; const v = rate(p, k) * (p.hp > 0 ? 1 : 0.5); if (!best || v > best.v) best = { p, k, v }; }
  if (best) best.p.deck[best.k] = (best.p.deck[best.k] || 0) + 1;
}

// ── A fight with one deck per citizen ───────────────────────────────────────
function fight(party, enemyKeys, seed) {
  const live = party.filter(p => p.hp > 0);
  const units = live.map(p => { const u = unitOf(p.c); u.hp = Math.min(u.maxHp, p.hp); return u; });
  const s = E.createBattle({ players: units, enemies: enemyKeys, seed, deck: live[0].deck });
  for (const u of s.units) if (u.side === 'enemy') u.species = (S.MON[u.enemy_key] || {}).family;
  const decks = {};
  live.forEach((p, i) => { DECK.initDeck(s, p.deck); decks[units[i].id] = s.deck; });
  let guard = 0, turns = 0, healed = 0;
  while (s.status === 'active' && guard++ < 900) {
    const cur = E.currentUnit(s); if (!cur) break;
    if (cur.buffs) for (const k of ['weak', 'vulnerable']) if (cur.buffs[k] > 0) cur.buffs[k] -= 1;
    if (cur.side === 'enemy') { if (!E.enemyAct(s)) break; continue; }
    turns++;
    s.deck = decks[cur.id];                       // this citizen's own deck
    const before = s.units.filter(u => u.side === 'player').reduce((n, u) => n + Math.max(0, u.hp), 0);
    let plays = 0, p;
    while (s.status === 'active' && plays++ < 12 && (p = bestPlay(s, cur))) if (!E.playCard(s, p.i, p.t ? p.t.id : null)) break;
    healed += Math.max(0, s.units.filter(u => u.side === 'player').reduce((n, u) => n + Math.max(0, u.hp), 0) - before);
    if (s.status === 'active') E.endTurn(s);
  }
  for (const p of party) { const u = s.units.find(x => x.citizen_id === p.c.id); if (u) { p.hp = Math.max(0, u.hp); if (u.hp <= 0) p.wentDown = true; } }
  // Which heals each citizen played (withering ones sit in the withered pile).
  live.forEach((p, i) => { p.played = (decks[units[i].id].withered || []).filter(k => HEALS.includes(k)); });
  return { win: s.status === 'victory', turns, healed, timeout: s.status === 'active' };
}

// ── A run ───────────────────────────────────────────────────────────────────
// opts: party [who…], level, door (picks each at the door), rewards (a pick of three after a fight), unlocks,
//       healsUntilRest (a played heal is gone until the next rest), heals (Kindles in the Hearthkeeper pack), keepHeals (heals do not wither)
function run(tier, opts, seed) {
  const plan = PLANS[tier], rnd = rng32(seed);
  const level = opts.level || plan.party[0];
  const party = opts.party.map(w => member(w, level, opts));
  for (let d = 0; d < (opts.door || 0); d++) for (const p of party) doorPick(p, rnd);
  const terrain = ['forest', 'plains', 'hills', 'mountain', 'river', 'marsh', 'ruins'][Math.floor(rnd() * 7)];
  installRoster(tier);
  const out = { cleared: false, fights: 0, turns: 0, healed: 0 };
  const fightsInPlan = plan.rooms.filter(Array.isArray).length;
  for (const room of plan.rooms) {
    if (room === 'R' || room === 'L') {
      for (const p of party) {
        p.hp = Math.min(p.max, Math.max(p.hp, 0) + Math.round(p.max * REST));
        for (const k of (p.spent || [])) p.deck[k] = (p.deck[k] || 0) + 1;      // heals come back with a rest
        p.spent = [];
      }
      continue;
    }
    const r = fight(party, encounter(terrain, room, rnd), Math.floor(rnd() * 2e9) + 1);
    out.fights++; out.turns += r.turns; out.healed += r.healed;
    if (opts.healsUntilRest !== false) for (const p of party) for (const k of (p.played || [])) { if (p.deck[k] > 0) { p.deck[k]--; if (!p.deck[k]) delete p.deck[k]; (p.spent = p.spent || []).push(k); } }
    for (const p of party) p.played = [];
    if (!r.win) { out.down = party.filter(p => p.wentDown).length; return out; }
    if (opts.rewards && out.fights < fightsInPlan) reward(party, rnd);
  }
  out.cleared = true; out.down = party.filter(p => p.wentDown).length;
  out.hpLeft = party.reduce((n, p) => n + p.hp, 0) / party.reduce((n, p) => n + p.max, 0);
  return out;
}
function trial(tier, opts, n) {
  let clear = 0, turns = 0, down = 0, left = 0, healed = 0, fights = 0;
  for (let k = 0; k < n; k++) { const r = run(tier, opts, 1000 + k * 7919); if (r.cleared) { clear++; left += r.hpLeft; } turns += r.turns; down += r.down || 0; healed += r.healed; fights += r.fights; }
  return { clear: clear / n, turns: turns / n, turnsPerFight: turns / fights, down: down / n, hpLeft: clear ? left / clear : 0, healed: healed / n };
}
const line = (label, r, extra = '') => console.log(pad(label, 58) + pad(pct(r.clear), 8) + pad(r.down.toFixed(1), 8) + pad(r.turns.toFixed(0), 8) + pad(r.turnsPerFight.toFixed(1), 12) + extra);
const HEAD = () => console.log(pad('', 58) + pad('clears', 8) + pad('downed', 8) + pad('turns', 8) + pad('turns/fight', 12));

// ── Reports ─────────────────────────────────────────────────────────────────
const VILLAGERS = ['villager:gathering', 'villager:gathering', 'villager:crafting', 'villager:trade'];
const CLASSES4 = ['guard', 'hearthkeeper', 'archer', 'wizard'];           // front to back
const TODAY4 = ['guard', 'guard', 'archer', 'archer'];                     // the two classes that exist before the class buildings
const MIXED = ['guard', 'villager:gathering', 'villager:crafting', 'archer'];

function reportPacks() {
  loadAll();
  const show = (title, who, deck) => {
    console.log('\n' + title);
    console.log(pad('  card', 22) + pad('×', 3) + pad('cost', 6) + pad('a villager (all stats 8, combat 1)', 44) + 'trained in the class (11 / 10, combat 4)');
    for (const [k, n] of Object.entries(deck)) {
      const card = REG.getCard(k);
      const fresh = unitOf(citizen(who, 'fresh')), trained = unitOf(citizen(who, 'trained'));
      const tags = [card.hit === 'front' ? 'front' : card.hit === 'pierce' ? 'pierces' : '', card.wither ? 'withers' : '', { all_enemies: 'all enemies', all_allies: 'all friends', ally: 'a friend', ally_or_self: 'anyone friendly' }[card.target] || ''].filter(Boolean).join(', ');
      console.log(pad('  ' + card.name, 22) + pad(n, 3) + pad(card.cost, 6) + pad(FM.previewEffect(card.formula, fresh).replace(/\n/g, '; ').slice(0, 42), 44) + FM.previewEffect(card.formula, trained).replace(/\n/g, '; ') + (tags ? '  [' + tags + ']' : ''));
    }
    const u = unitOf(citizen(who, 'trained'));
    console.log('  health at trained: ' + u.maxHp);
  };
  for (const [k, p] of Object.entries(PACKS)) show(p.label.toUpperCase(), k, p.deck);
  show('VILLAGER (shown with the gathering trade card)', null, villagerDeck('gathering'));
  console.log('\nTRADE CARDS (two copies replace Tool of the Trade)');
  for (const [kind, k] of Object.entries(TRADES)) { const card = REG.getCard(k), u = unitOf(citizen(null, 'fresh')); console.log(pad('  ' + kind, 14) + pad(card.name, 22) + pad(card.cost, 4) + FM.previewEffect(card.formula, u).replace(/\n/g, '; ') + (card.wither ? '  [withers]' : '')); }
}
function reportDoor(n) {
  loadAll();
  console.log('How a deck should grow. ' + n + ' runs each; the bot keeps the card worth most to that citizen.\n');
  const cases = [['green', VILLAGERS, '4 villagers'], ['yellow', MIXED, 'guard, 2 villagers, archer (novices)'], ['orange', CLASSES4, 'guard, hearthkeeper, archer, wizard (trained)'], ['red', CLASSES4, 'the same four (trained)'], ['purple', CLASSES4, 'the same four (veterans)']];
  for (const [tier, party, label] of cases) {
    console.log('── ' + tier.toUpperCase() + ': ' + label);
    HEAD();
    line('packs only: nothing added', trial(tier, { party }, n));
    line('one pick each at the door', trial(tier, { party, door: 1, unlocks: true }, n));
    line('two picks each at the door', trial(tier, { party, door: 2, unlocks: true }, n));
    line('no door; a pick of three after each fight', trial(tier, { party, rewards: true, unlocks: true }, n));
    line('one at the door + a pick after each fight', trial(tier, { party, door: 1, rewards: true, unlocks: true }, n));
    line('the same, the town has unlocked nothing', trial(tier, { party, door: 1, rewards: true, unlocks: false }, n));
    console.log('');
  }
}
function reportTiers(n) {
  loadAll();
  console.log('Clear rates with class decks: one pick each at the door, a pick of three after each fight. ' + n + ' runs each.');
  console.log('"shared draft" is the earlier design (one drafted deck for the party) for the same four citizens.\n');
  const old = (tier, classes) => { S.loadCards(S.DEFAULT_RULES); const r = S.trial(tier, { unlocks: true, classes }, n); loadAll(); return pct(r.clear); };
  const cases = {
    green:  [[VILLAGERS, '4 villagers', []], [MIXED, 'guard, 2 villagers, archer', ['guard', null, null, 'archer']]],
    yellow: [[VILLAGERS, '4 villagers', []], [MIXED, 'guard, 2 villagers, archer', ['guard', null, null, 'archer']], [TODAY4, '2 guards, 2 archers', TODAY4]],
    orange: [[MIXED, 'guard, 2 villagers, archer', ['guard', null, null, 'archer']], [TODAY4, '2 guards, 2 archers', TODAY4], [CLASSES4, 'guard, hearthkeeper, archer, wizard', CLASSES4]],
    red:    [[TODAY4, '2 guards, 2 archers', TODAY4], [CLASSES4, 'guard, hearthkeeper, archer, wizard', CLASSES4]],
    purple: [[TODAY4, '2 guards, 2 archers', TODAY4], [CLASSES4, 'guard, hearthkeeper, archer, wizard', CLASSES4]],
  };
  for (const tier of Object.keys(cases)) {
    console.log('── ' + tier.toUpperCase() + ' (' + PLANS[tier].party[0] + ', +' + pct(TIERS[tier].hp) + ' health, +' + pct(TIERS[tier].str) + ' strength)');
    console.log(pad('', 58) + pad('clears', 8) + pad('downed', 8) + pad('turns', 8) + pad('turns/fight', 12) + 'shared draft');
    for (const [party, label, classes] of cases[tier]) line(label, trial(tier, { party, door: 1, rewards: true, unlocks: true }, n), old(tier, classes));
    console.log('');
  }
}
function reportHeal(n) {
  loadAll();
  console.log('What healing is worth. Trained citizens; one pick each at the door, a pick of three after each fight; ' + n + ' runs.\n');
  console.log(pad('', 58) + pad('clears', 8) + pad('downed', 8) + pad('turns', 8) + pad('turns/fight', 12) + 'health healed a run');
  const H = ['guard', 'hearthkeeper', 'archer', 'archer'], o = { door: 1, rewards: true, unlocks: true };
  for (const tier of ['orange', 'red']) {
    const show = (label, x, party = H) => { const r = trial(tier, { ...o, ...x, party }, n); line(tier + ': ' + label, r, r.healed.toFixed(0)); };
    show('2 guards, 2 archers (no healer)', {}, TODAY4);
    show('a Hearthkeeper for one guard: heals spent until a rest', {});
    show('  the same, heals only wither (back every fight)', { healsUntilRest: false });
    show('  the same, heals do not wither at all', { healsUntilRest: false, keepHeals: true });
    show('  a Hearthkeeper with no healing', { ban: ['h_kindle', 'rekindle', 'kindle', 'hearthlight'] });
  }
}

if (require.main === module) {
  const cmd = process.argv[2] || 'tiers', n = parseInt(process.argv[3], 10) || 300;
  if (cmd === 'packs') reportPacks();
  else if (cmd === 'door') reportDoor(n);
  else if (cmd === 'heal') reportHeal(n);
  else reportTiers(n);
}
module.exports = { PACK_CARDS, PACKS, VILLAGER, TRADES, UNLOCKED, villagerDeck, trial, run, member, loadAll, rate };
