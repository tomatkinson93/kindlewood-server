// ══════════════════════════════════════════════════════════════════════════
//  cards — a settlement's card collection (settlement_unlocked_cards).
//
//  STARTER cards are owned by everyone (no row needed). Every other card —
//  the unlockable built-ins in card_definitions.js and admin cards in
//  card_templates — is earned:
//    battles   each defeated enemy DROP_CHANCE (BOSS_CHANCE for a big one,
//              reward_weight ≥ BOSS_WEIGHT), server-side only (lib/spoils)
//    quests    a finished quest QUEST_CHANCE (routes/quests collect)
//    villages  an Allied village teaches VILLAGE_CARDS cards a week, for
//              wealth (routes/cards)
//  Deck saves only accept owned cards (routes/decks).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const STARTER = ['strike', 'defend', 'quick_jab', 'rally', 'cleave', 'weaken', 'expose', 'focus', 'mend'];
const DROP_CHANCE = 0.06;
const BOSS_CHANCE = 0.25;
const BOSS_WEIGHT = 4;
const QUEST_CHANCE = 0.05;
const VILLAGE_CARDS = 2;
const PRICE = { common: 120, uncommon: 200, rare: 320, epic: 520, legendary: 800 };
const HOW = 'Won in battle now and then, found on quests, or taught by an Allied village.';

function registry() {
  try { return require('./card_registry'); } catch (e) { return require('./card_definitions'); }
}
// Every card the game knows: key → { key, name, cost, type, rarity, desc }.
function allCards() {
  const R = registry();
  const all = R.allCards ? R.allCards() : require('./card_definitions').CARDS;
  return all;
}
// The cards you can earn (everything but the starter set), in a stable order.
function unlockable() {
  return Object.keys(allCards()).filter(k => !STARTER.includes(k)).sort();
}

async function ownedSet(sid, db) {
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run('SELECT card_key FROM settlement_unlocked_cards WHERE settlement_id=$1', [sid]).catch(() => ({ rows: [] }));
  return new Set([...STARTER, ...r.rows.map(x => x.card_key)]);
}

function meta(key) {
  const c = allCards()[key];
  return c ? { key, name: c.name, rarity: c.rarity || 'common', type: c.type, cost: c.cost, desc: c.desc } : null;
}

// Unlock one card; returns its meta when it is new, null if already owned
// or unknown.
async function unlock(db, sid, key, source) {
  if (STARTER.includes(key) || !allCards()[key]) return null;
  const run = db ? (t, p) => db.query(t, p) : query;
  const r = await run(
    `INSERT INTO settlement_unlocked_cards (settlement_id, card_key, source) VALUES ($1,$2,$3)
     ON CONFLICT (settlement_id, card_key) DO NOTHING RETURNING card_key`, [sid, key, source || null]);
  return r.rows.length ? meta(key) : null;
}

// A random card this settlement doesn't own yet (rng() in [0,1)), unlocked.
async function grantRandom(db, sid, rng, source) {
  const have = await ownedSet(sid, db);
  const pool = unlockable().filter(k => !have.has(k));
  if (!pool.length) return null;
  return unlock(db, sid, pool[Math.floor(rng() * pool.length) % pool.length], source);
}

// Battle: one roll per defeated enemy. `enemies` = enemy ids; weights from
// enemy_definitions.reward_weight.
async function rollBattle(db, sid, enemies, rng, source = 'battle') {
  if (!enemies || !enemies.length) return null;
  const run = db ? (t, p) => db.query(t, p) : query;
  const w = Object.fromEntries((await run('SELECT id, reward_weight FROM enemy_definitions WHERE id = ANY($1::text[])', [enemies])
    .catch(() => ({ rows: [] }))).rows.map(r => [r.id, Number(r.reward_weight) || 1]));
  for (const e of enemies) {
    const chance = (w[e] || 1) >= BOSS_WEIGHT ? BOSS_CHANCE : DROP_CHANCE;
    if (rng() < chance) return grantRandom(db, sid, rng, source);
  }
  return null;
}

// This week's cards an Allied village teaches (same for every town):
// VILLAGE_CARDS keys seeded by village id + ISO week.
function villageCards(npcId, now = Date.now()) {
  const week = Math.floor(now / (7 * 24 * 3600 * 1000));
  const rng = require('./clan_quests').seededRng(`cards:${npcId}:${week}`);
  const pool = unlockable().slice();
  const out = [];
  while (pool.length && out.length < VILLAGE_CARDS) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
const priceOf = key => PRICE[(meta(key) || {}).rarity] || PRICE.common;

module.exports = {
  STARTER, DROP_CHANCE, BOSS_CHANCE, BOSS_WEIGHT, QUEST_CHANCE, VILLAGE_CARDS, PRICE, HOW,
  allCards, unlockable, ownedSet, meta, unlock, grantRandom, rollBattle, villageCards, priceOf,
};
