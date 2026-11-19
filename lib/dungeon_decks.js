// ══════════════════════════════════════════════════════════════════════════
//  dungeon_decks — each citizen's deck through a dungeon run
//  (docs/DUNGEON_CLASS_DECKS.md §3 to §5; the cards are lib/class_cards.js).
//
//  A run's decks (dungeon_runs.deck):
//    { cards: { citizenId: { card: copies } },   what each citizen holds now
//      spent: { citizenId: [card, …] },          heals played, gone until the party rests
//      cls:   { citizenId: 'guard' | … },        the pack each started from
//      trade: { citizenId: 't_tool' | null } }   a villager's trade card
//
//  A choice of cards that is waiting (dungeon_runs.draft):
//    { kind: 'door',   offers: { citizenId: [card, card, card] }, done: [citizenId, …] }
//    { kind: 'reward', offers: [{ citizen, card }, …] }
//
//  How a deck grows: at the door every citizen is shown three cards of their
//  own and keeps one; after each fight but the last, three cards are shown,
//  each for a different citizen, and the party keeps one. Either can be
//  passed over. Offers are seeded by the dungeon, the town and the moment, so
//  reloading shows the same cards.
//
//  Healing: a heal that has been played is spent until the party rests, and
//  a deck never holds two of the same heal.
//  Honing: at a rest room the party may, in place of resting, hone one card
//  of one citizen for the rest of the run (class_cards.honed).
//
//  Pure but for `start` (which reads the citizens) and `collection`.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_cards');
const stream = (seed, label) => require('./dungeon_gen')._stream(seed, label);
const err = (status, msg) => Object.assign(new Error(msg), { status });
const OFFER = 3;

const empty = () => ({ cards: {}, spent: {}, cls: {}, trade: {} });
function normal(deck) {
  const d = (deck && typeof deck === 'object' && !Array.isArray(deck)) ? deck : {};
  return { cards: d.cards || {}, spent: d.spent || {}, cls: d.cls || {}, trade: d.trade || {} };
}
const has = (deck) => Object.keys(normal(deck).cards).length > 0;
const count = (cards) => Object.values(cards || {}).reduce((n, x) => n + x, 0);
function shuffled(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// Every citizen's starting deck, from their job.
async function start(db, ids) {
  const run = db && db.query ? (t, p) => db.query(t, p) : query;
  const rows = (await run('SELECT id, role FROM citizens WHERE id = ANY($1)', [ids])).rows;
  const out = empty();
  for (const id of ids) {
    const p = CC.packFor(rows.find(r => r.id === id) || {});
    out.cards[id] = p.deck; out.cls[id] = p.cls; out.trade[id] = p.trade; out.spent[id] = [];
  }
  return out;
}

// What this citizen could be offered now: their pool, less any heal they
// already hold (or have spent).
function poolOf(deck, id, owned, unprepared) {
  const d = normal(deck);
  const held = new Set(Object.keys(d.cards[id] || {}).concat(d.spent[id] || []).map(CC.baseOf));
  return CC.poolFor(d.cls[id] || 'villager', d.trade[id] || null, owned, unprepared).filter(k => !(CC.card(k).heal && held.has(k)));
}
// At the door: three cards for each citizen.
function doorOffers(deck, ids, seedKey, owned, unprepared) {
  const offers = {};
  for (const id of ids) offers[id] = shuffled(poolOf(deck, id, owned, unprepared), stream(seedKey, `door:${id}`)).slice(0, OFFER);
  return { kind: 'door', offers, done: ids.filter(id => !offers[id].length) };
}
// After a fight: three cards, each for a different citizen.
function rewardOffers(deck, ids, seedKey, label, owned, unprepared) {
  const rnd = stream(seedKey, `reward:${label}`);
  const offers = [];
  for (const id of shuffled(ids, rnd)) {
    if (offers.length >= OFFER) break;
    const pool = poolOf(deck, id, owned, unprepared);
    if (pool.length) offers.push({ citizen: id, card: pool[Math.floor(rnd() * pool.length)] });
  }
  return offers.length ? { kind: 'reward', offers } : null;
}

// Keep a card (or pass). → { deck, draft }: the draft that remains, or null.
//   door:   { citizen_id, card }   card null to pass for that citizen
//   reward: { index }              index null to pass
function pick(deck, draft, body = {}) {
  const d = normal(JSON.parse(JSON.stringify(deck || {})));
  if (!draft) throw err(400, 'There are no cards to choose from.');
  const add = (id, key) => { d.cards[id] = d.cards[id] || {}; d.cards[id][key] = (d.cards[id][key] || 0) + 1; };
  if (draft.kind === 'door') {
    const id = Number(body.citizen_id);
    const offers = draft.offers[id] || draft.offers[String(id)];
    if (!offers || (draft.done || []).includes(id)) throw err(400, 'That citizen has no cards to choose from.');
    if (body.card != null) {
      if (!offers.includes(body.card)) throw err(400, 'That card was not offered.');
      add(id, body.card);
    }
    const done = (draft.done || []).concat([id]);
    const left = Object.keys(draft.offers).map(Number).filter(x => !done.includes(x));
    return { deck: d, draft: left.length ? { ...draft, done } : null, took: body.card != null ? { citizen: id, card: body.card } : null };
  }
  if (draft.kind === 'reward') {
    if (body.index == null) return { deck: d, draft: null, took: null };
    const o = draft.offers[Number(body.index)];
    if (!o) throw err(400, 'That card was not offered.');
    add(o.citizen, o.card);
    return { deck: d, draft: null, took: o };
  }
  throw err(400, 'There are no cards to choose from.');
}

// After a fight: the heals each citizen played are gone until the party
// rests. `battle` is the server's replay; its per-citizen decks hold the
// withered piles.
function spendHeals(deck, battle) {
  const d = normal(JSON.parse(JSON.stringify(deck || {})));
  if (!battle || !battle.decks) return d;
  for (const u of battle.units || []) {
    if (u.side !== 'player' || !battle.decks[u.id]) continue;
    const id = u.citizen_id;
    for (const key of (battle.decks[u.id].withered || [])) {
      const c = CC.card(key);
      if (!c || !c.heal || !(d.cards[id] && d.cards[id][key] > 0)) continue;
      d.cards[id][key] -= 1;
      if (!d.cards[id][key]) delete d.cards[id][key];
      (d.spent[id] = d.spent[id] || []).push(key);
    }
  }
  return d;
}
// The party rests: spent heals come back.
function restore(deck) {
  const d = normal(JSON.parse(JSON.stringify(deck || {})));
  for (const id of Object.keys(d.spent)) {
    for (const key of d.spent[id]) { d.cards[id] = d.cards[id] || {}; d.cards[id][key] = (d.cards[id][key] || 0) + 1; }
    d.spent[id] = [];
  }
  return d;
}
// Hone one copy of a card a citizen holds.
function hone(deck, citizenId, key) {
  const d = normal(JSON.parse(JSON.stringify(deck || {})));
  const id = Number(citizenId), cards = d.cards[id];
  if (!cards) throw err(400, 'That citizen is not in the party.');
  if (!key || !(cards[key] > 0)) throw err(400, 'That citizen does not hold that card.');
  if (CC.isHoned(key)) throw err(400, 'That card is already honed.');
  cards[key] -= 1;
  if (!cards[key]) delete cards[key];
  const h = CC.honed(key);
  cards[h] = (cards[h] || 0) + 1;
  return d;
}
// The decks a battle is given: what each citizen holds now. Every citizen
// has an entry, even one with nothing left to play (every heal spent, say):
// with no deck of their own they would be handed someone else's.
function forBattle(deck) {
  const d = normal(deck), out = {};
  for (const id of Object.keys(d.cards)) out[id] = { ...d.cards[id] };
  return out;
}

// ── For the screen ──────────────────────────────────────────────────────────
// One card as the screen shows it. `text(formula)` gives the effect in this
// citizen's hands ("Deal 16 damage"), when the caller can work it out.
function cardView(key, n, text) {
  const c = CC.card(key);
  if (!c) return { key, name: key, cost: 0, type: 'attack', n: n || 1, text: '', desc: '' };
  const reach = c.hit === 'front' ? 'the front creature' : c.hit === 'pierce' ? 'down the line' : { all_enemies: 'every creature', all_allies: 'every friend', ally: 'a friend', ally_or_self: 'anyone friendly', self: 'yourself', enemy: 'any creature' }[c.target] || '';
  return { key, name: c.name, cost: c.cost, type: c.type, rarity: c.rarity, n: n == null ? 1 : n, text: text ? text(c.formula) : '', desc: c.desc, reach,
    heal: !!c.heal, once: !!c.wither && !c.heal, honed: !!c.honed, basic: !!c.basic };
}
// A citizen's deck: [{ card… , n }], basics first, then by cost and name.
function deckView(deck, id, text) {
  const d = normal(deck);
  const list = Object.entries(d.cards[id] || {}).map(([k, n]) => cardView(k, n, text));
  list.sort((a, b) => (b.basic - a.basic) || (a.cost - b.cost) || a.name.localeCompare(b.name));
  return { cls: d.cls[id] || 'villager', label: (CC.PACKS[d.cls[id]] || CC.PACKS.villager).label, icon: (CC.PACKS[d.cls[id]] || CC.PACKS.villager).icon,
    size: count(d.cards[id]), cards: list, spent: (d.spent[id] || []).map(k => cardView(k, 1, text)) };
}

// ── The town's class cards (for the "prepare" screen) ──────────────────────
// Every class with its pack and the cards a town can unlock for it: owned or
// how to get it, and whether it is prepared (offered) or set aside.
async function collection(sid, db) {
  const owned = await CC.ownedFor(sid, db), off = await CC.unpreparedFor(sid, db);
  const one = (k) => {
    const c = CC.CARDS[k], unlock = CC.isUnlock(k);
    return { ...cardView(k, 1), unlock, owned: !unlock || owned.has(k), how: unlock && !owned.has(k) ? CC.howTo(k) : '', prepared: !off.has(k) };
  };
  const classes = CC.CLASS_ORDER.map(cls => {
    const p = CC.PACKS[cls];
    const pack = Object.entries(p.deck).map(([k, n]) => ({ ...one(k), n }));
    const group = cls === 'villager' ? ['common'] : [cls];
    const more = Object.keys(CC.CARDS).filter(k => group.includes(CC.CARDS[k].cls) && !p.deck[k]).map(one);
    const trades = cls === 'villager' ? Object.entries(CC.TRADES).map(([kind, k]) => ({ ...one(k), kind })) : [];
    return { cls, label: p.label, icon: p.icon, pack, trades, more };
  });
  return { classes };
}
// Set a card aside, or prepare it again. Only a card that can be offered.
async function setPrepared(sid, key, prepared, db) {
  const run = db && db.query ? (t, p) => db.query(t, p) : query;
  const c = CC.CARDS[key];
  if (!c || c.basic) throw err(400, 'That card cannot be set aside.');
  await run(`INSERT INTO settlement_card_prefs (settlement_id, card_key, prepared) VALUES ($1,$2,$3)
             ON CONFLICT (settlement_id, card_key) DO UPDATE SET prepared = $3`, [sid, key, !!prepared]);
  return collection(sid, db);
}

module.exports = { OFFER, empty, normal, has, start, poolOf, doorOffers, rewardOffers, pick, spendHeals, restore, hone, forBattle, cardView, deckView, collection, setPrepared };
