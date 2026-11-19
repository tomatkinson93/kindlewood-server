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
//    node scripts/class_deck_sim.js skulls [n]     clear rates with the buildings a town of that standing has, and honing
//    node scripts/class_deck_sim.js sweep [n] [skull]   a grid of creature health and strength for a skull
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
// The cards, packs, trade cards, unlock ladders and honed forms are the
// game's own (lib/class_cards.js): this script holds no numbers of its own.
const CC = require('../lib/class_cards');
const PACK_CARDS = CC.allKeys().map(CC.rowOf)
  // The Hearthkeeper's healing, were it not to wither (the `heal` report).
  .concat([{ ...CC.rowOf('h_kindle'), card_key: 'h_kindle_keep', name: 'Kindle (kept)', wither: false }]);
const PACKS = Object.fromEntries(Object.entries(CC.PACKS).filter(([k]) => k !== 'villager'));
const TRADES = CC.TRADES;
const VILLAGER = { deck: CC.PACKS.villager.deck, trade: CC.TRADE_COPIES };
const villagerDeck = kind => ({ ...VILLAGER.deck, [TRADES[kind] || 't_tool']: VILLAGER.trade });
const isHeal = k => k === 'h_kindle_keep' || !!(CC.card(k) && CC.card(k).heal);
// What a town owns, from its buildings' levels (and, with `older`, the older
// general cards whose class-deck twins come with them: Shield Bash, Arrow Rain…).
const MAX_LEVELS = { watchtower: 4, wizard_tower: 3, hearth_shrine: 3 };
function ownedAt(levels, older) {
  const out = new Set();
  for (const k of Object.keys(CC.CARDS)) {
    const u = CC.UNLOCKS[k];
    if (u ? ((levels || {})[u.building] || 0) >= u.level : (older && CC.CARDS[k].from)) out.add(k);
  }
  return out;
}
// loadAll(factor): with a factor, honed cards are that much stronger in place of the game's (to try other values).
function loadAll(factor) {
  const rows = !factor ? PACK_CARDS : PACK_CARDS.map(r => (CC.isHoned(r.card_key) ? { ...r, formula: r.formula.split(')*' + CC.HONE).join(')*' + factor) } : r));
  REG.loadRows(S.ALL_CARDS.map(c => (c.card_key === 'focus' ? { ...c, wither: true } : c)).concat(rows));
}

// ── A citizen with a deck ───────────────────────────────────────────────────
// who: 'guard' | 'archer' | 'wizard' | 'hearthkeeper' | 'villager:<kind>'
function member(who, level, opts = {}) {
  const [cls, kind] = who.split(':');
  const isClass = !!PACKS[cls];
  const c = citizen(isClass ? cls : null, level);
  let deck = isClass ? { ...PACKS[cls].deck } : villagerDeck(kind || 'gathering');
  if (opts.heals && deck.h_kindle) { deck = { ...deck, h_kindle: opts.heals, h_cinder: Math.max(1, deck.h_cinder + deck.h_kindle - opts.heals) }; }
  if (opts.keepHeals && deck.h_kindle) { deck = { ...deck, h_kindle_keep: deck.h_kindle }; delete deck.h_kindle; }
  // Offers: what the game would offer this citizen (class_cards.poolFor): the pack's own class cards, the plain
  // cards for a villager, and what the town owns. opts.unlocks: every building at its top level and the older
  // cards owned; opts.levels: { watchtower, wizard_tower, hearth_shrine } as built; neither: nothing unlocked.
  const owned = opts.unlocks ? ownedAt(MAX_LEVELS, true) : ownedAt(opts.levels || {}, !!opts.older);
  const pool = CC.poolFor(isClass ? cls : 'villager', isClass ? null : (TRADES[kind] || 't_tool'), owned, null);
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
const offerFor = (p, rnd, n = 3) => { const o = [], pool = p.pool.filter(k => !(isHeal(k) && ((p.deck[k] || 0) > 0 || (p.spent || []).includes(k)))); while (o.length < n && pool.length) o.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); return o; };
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
  live.forEach((p, i) => { p.played = (decks[units[i].id].withered || []).filter(isHeal); });
  return { win: s.status === 'victory', turns, healed, timeout: s.status === 'active' };
}

// Hone the card worth most to its holder (one copy becomes its honed form).
function honeBest(party) {
  let best = null;
  for (const p of party) {
    if (p.hp <= 0) continue;
    for (const k of Object.keys(p.deck)) {
      if (CC.isHoned(k) || !CC.card(k)) continue;
      const v = rate(p, CC.honed(k)) - rate(p, k);
      if (!best || v > best.v) best = { p, k, v };
    }
  }
  if (!best) return;
  const d = best.p.deck;
  d[best.k] -= 1; if (!d[best.k]) delete d[best.k];
  d[CC.honed(best.k)] = (d[CC.honed(best.k)] || 0) + 1;
}

// ── A run ───────────────────────────────────────────────────────────────────
// opts: party [who…], level, door (picks each at the door), rewards (a pick of three after a fight), unlocks,
//       levels (the town's buildings), healsUntilRest (a played heal is gone until the next rest), heals (Kindles in the
//       Hearthkeeper pack), keepHeals (heals do not wither), hone (hone at a rest room in place of resting)
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
    // A rest room: rest, or hone a card in its place (opts.hone: 'always', or a share of health above which the
    // party hones: 0.7 = "hone when the party is at 70% or better"). A landing only rests.
    if (room === 'R' && opts.hone != null) {
      const share = party.reduce((n, p) => n + Math.max(0, p.hp), 0) / party.reduce((n, p) => n + p.max, 0);
      // opts.honeEach: every citizen hones a card (else one card for the party). opts.honeAndRest: the party rests as well.
      const go = opts.honeAndRest || opts.hone === 'always' || share >= opts.hone;
      if (go) { if (opts.honeEach) for (const p of party) honeBest([p]); else honeBest(party); out.honed = (out.honed || 0) + 1; if (!opts.honeAndRest) continue; }
    }
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
    // After a fight: a card of three for the party, or (opts.rewardHone) hone a card in its place:
    // 'always', or 'late' = a card after the first half of the fights, a hone after that.
    if (opts.rewards && out.fights < fightsInPlan) {
      const honeNow = opts.rewardHone === 'always' || (opts.rewardHone === 'late' && out.fights > fightsInPlan / 2) || (opts.rewardHone === 'early' && out.fights <= fightsInPlan / 2);
      if (honeNow) honeBest(party); else reward(party, rnd);
    }
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
    show('  a Hearthkeeper with no healing', { ban: ['h_kindle', 'h_rekindle', 'h_hearthlight'] });
  }
}

// ── The skulls, with what a town of that standing has built ────────────────
// Each skull is read with the party and buildings a town sending it would
// really have; the first line of each is the party the skull is tuned for.
const W = (watchtower, hearth_shrine = 0, wizard_tower = 0) => ({ levels: { watchtower, hearth_shrine, wizard_tower } });
const HEALER4 = ['guard', 'hearthkeeper', 'archer', 'archer'];            // a village: a shrine, no tower yet
const TOWNS = {
  green:  [[VILLAGERS, '4 villagers; nothing built', {}], [MIXED, 'guard, 2 villagers, archer; Watchtower 1', W(1)]],
  yellow: [[MIXED, 'guard, 2 villagers, archer; Watchtower 1', W(1)], [TODAY4, '2 guards, 2 archers; Watchtower 2', W(2)], [VILLAGERS, '4 villagers; nothing built', {}]],
  orange: [[HEALER4, 'guard, hearthkeeper, 2 archers; Watchtower 2, Shrine 1', W(2, 1)], [CLASSES4, 'all four classes; Watchtower 2, Shrine 1, Tower 1', W(2, 1, 1)], [TODAY4, '2 guards, 2 archers; Watchtower 2 (no healer)', W(2)]],
  red:    [[CLASSES4, 'all four classes; Watchtower 3, Shrine 2, Tower 2', W(3, 2, 2)], [HEALER4, 'guard, hearthkeeper, 2 archers; Watchtower 3, Shrine 2', W(3, 2)], [TODAY4, '2 guards, 2 archers; Watchtower 3 (no healer)', W(3)]],
  purple: [[CLASSES4, 'all four classes; every building at its top level', { unlocks: true }], [HEALER4, 'guard, hearthkeeper, 2 archers; top levels', { unlocks: true }], [TODAY4, '2 guards, 2 archers; Watchtower 4 (no healer)', W(4)]],
};
// The game's rules: one pick each at the door, a card of three after each fight, and a rest room that rests the
// party and hones a card. (PLAIN is the same without honing, for the reports that predate it.)
const PLAIN = { door: 1, rewards: true };
const GROW = { ...PLAIN, hone: 0, honeAndRest: true };
const HONE_AT = 0.7;   // for the `hone` report: "when healthy" = the party stands at 70% of its health or better
function reportSkulls(n) {
  loadAll();
  console.log('Clear rates by skull, with the buildings a town of that standing has. ' + n + ' runs each.');
  console.log('One pick each at the door, a card after each fight, a rest that also hones a card. "hones instead" = the bot hones after every fight in place of the card.\n');
  for (const tier of Object.keys(TOWNS)) {
    console.log('── ' + tier.toUpperCase() + ' (' + PLANS[tier].party[0] + ', +' + pct(TIERS[tier].hp) + ' health, +' + pct(TIERS[tier].str) + ' strength)');
    console.log(pad('', 58) + pad('clears', 8) + pad('downed', 8) + pad('turns', 8) + pad('turns/fight', 12) + 'hones instead');
    for (const [party, label, town] of TOWNS[tier]) {
      const o = { party, ...GROW, ...town };
      line(label, trial(tier, o, n), pct(trial(tier, { ...o, rewardHone: 'always' }, n).clear));
    }
    console.log('');
  }
}
// A grid of creature health and strength for one skull: the clear rate of the party it is tuned for, and beside
// it the last party in its list (the same town without its healer, or four villagers).
function reportSweep(tier, n) {
  loadAll();
  const [party, label, town] = TOWNS[tier][0], other = TOWNS[tier][TOWNS[tier].length - 1];
  const now = { ...TIERS[tier] };
  const hps = [-0.25, 0, 0.25, 0.5, 0.75].map(d => +(now.hp + d).toFixed(2)), strs = [-0.2, 0, 0.2, 0.4, 0.6].map(d => +(now.str + d).toFixed(2));
  console.log(tier.toUpperCase() + ': ' + label + '   /   ' + other[1] + '     (' + n + ' runs a cell; now +' + pct(now.hp) + ' health, +' + pct(now.str) + ' strength)');
  console.log(pad('health \\ strength', 20) + strs.map(x => pad('+' + pct(x), 14)).join(''));
  for (const hp of hps) {
    let row = pad('+' + pct(hp), 20);
    for (const str of strs) {
      TIERS[tier] = { hp, str };
      const a = trial(tier, { party, ...GROW, ...town }, n), b = trial(tier, { party: other[0], ...GROW, ...other[2] }, n);
      row += pad(pct(a.clear) + ' / ' + pct(b.clear), 14);
    }
    console.log(row);
  }
  TIERS[tier] = now;
}

// What honing should be: the rules tried, on the party each skull is tuned for.
function reportHone(n) {
  console.log('Honing rules compared. ' + n + ' runs each; the party each skull is tuned for. "when healthy" = at ' + pct(HONE_AT) + ' health or better.\n');
  const rules = [
    ['never hone (always rest)', {}, null],
    ['one card, in place of resting, when healthy', { hone: HONE_AT }, null],
    ['a card each, in place of resting, when healthy', { hone: HONE_AT, honeEach: true }, null],
    ['a card each at +50%, in place of resting, when healthy', { hone: HONE_AT, honeEach: true }, 1.5],
    ['a card each, in place of resting, always', { hone: 'always', honeEach: true }, null],
    ['rest and hone one card', { hone: 0, honeAndRest: true }, null],
    ['rest and hone a card each', { hone: 0, honeAndRest: true, honeEach: true }, null],
    ['rest and hone one card at +50%', { hone: 0, honeAndRest: true }, 1.5],
    ['after a fight: always hone, never take the card', { rewardHone: 'always' }, null],
    ['  the same at +50%', { rewardHone: 'always' }, 1.5],
    ['after a fight: cards first, hones in the later half', { rewardHone: 'late' }, null],
    ['  the same at +50%', { rewardHone: 'late' }, 1.5],
    ['after a fight: hones first, cards in the later half', { rewardHone: 'early' }, 1.5],
    ['no rewards at all (door pick only)', { rewards: false }, null],
    ['both: rest and hone one, and hones in the later half, +50%', { hone: 0, honeAndRest: true, rewardHone: 'late' }, 1.5],
  ];
  console.log(pad('', 58) + Object.keys(TOWNS).map(t => pad(t, 9)).join(''));
  for (const [label, o, factor] of rules) {
    loadAll(factor);
    console.log(pad(label, 58) + Object.keys(TOWNS).map(t => { const [party, , town] = TOWNS[t][0]; return pad(pct(trial(t, { party, ...PLAIN, ...town, ...o }, n).clear), 9); }).join(''));
  }
  loadAll();
}

if (require.main === module) {
  const cmd = process.argv[2] || 'tiers', n = parseInt(process.argv[3], 10) || 300;
  if (cmd === 'packs') reportPacks();
  else if (cmd === 'door') reportDoor(n);
  else if (cmd === 'heal') reportHeal(n);
  else if (cmd === 'skulls') reportSkulls(n);
  else if (cmd === 'hone') reportHone(n);
  else if (cmd === 'sweep') { for (const t of (process.argv[4] ? [process.argv[4]] : Object.keys(TOWNS))) { reportSweep(t, n); console.log(''); } }
  else reportTiers(n);
}
module.exports = { PACK_CARDS, PACKS, VILLAGER, TRADES, ownedAt, villagerDeck, trial, run, member, loadAll, rate };
