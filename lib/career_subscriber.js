// ══════════════════════════════════════════════════════════════════════════
//  CAREER SUBSCRIBER — game events → class XP and deed counters.
//
//  Side jobs pay XP when they finish (the time spent on them earns no
//  passive XP): quests to the class that matches the quest's skill, battles
//  to Guards and Archers, porter runs to the Porter class, merchant trips,
//  expeditions, shop sales. Someone working outside their job earns half.
//  Each grant runs in its own transaction (careers.grantXp locks citizens
//  first); events publish after commit.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const gameEvents = require('./game_events');
const careers = require('./careers');
const { CLASSES } = require('./careers/classes');

const XP = {
  questPerHour: 10, questSuccess: 15,
  battleBase: 12, battlePerEnemy: 4,
  porterBase: 5, porterPerHour: 10, npcTrade: 5,
  merchantBase: 8,
  expeditionBase: 10,
  shopBase: 3, shopPerGold: 0.1, shopMax: 25,
  offJob: 0.5,
};
// The class that trains a skill when the citizen's own job doesn't.
const SKILL_CLASS = { farming: 'farmer', woodcutting: 'woodcutter', fishing: 'fisher', mining: 'miner', crafting: 'crafter', scouting: 'scout', combat: 'soldier' };

async function rolesOf(sid, ids) {
  const r = await query(
    `SELECT id, role FROM citizens WHERE settlement_id = $1 AND id = ANY($2::int[]) AND COALESCE(life_stage, 'adult') = 'adult'`,
    [sid, (ids || []).map(Number).filter(Boolean)]);
  return new Map(r.rows.map(x => [x.id, x.role]));
}

// grants: [{ citizenId, classKey, xp }]; counters: [{ citizenId, counter, by }]
async function apply(sid, grants, counters = []) {
  if (!sid || (!grants.length && !counters.length)) return;
  const events = [];
  await withTransaction(async client => {
    await careers.grantXp(client, sid, grants, events);
    for (const c of counters) await careers.bumpCounter(client, sid, c.citizenId, c.counter, c.by, events);
  });
  careers.publish(sid, events);
}

// Quest: XP to the class whose skill the quest used — full if that's their
// job (an Archer counts for combat), half to the skill's default class if not.
async function onQuest(p) {
  const ids = p.citizenIds || [];
  if (!ids.length) return;
  const roles = await rolesOf(p.settlementId, ids);
  const base = XP.questPerHour * (Number(p.durationS) || 0) / 3600 + (p.success ? XP.questSuccess : 0);
  const grants = [];
  ids.forEach((id, i) => {
    const role = roles.get(Number(id));
    if (!role) return;
    const skill = (p.skillKeys || [])[i];
    const own = CLASSES[role] && CLASSES[role].skill === skill;
    const cls = own ? role : SKILL_CLASS[skill];
    if (cls) grants.push({ citizenId: Number(id), classKey: cls, xp: base * (own ? 1 : XP.offJob) });
  });
  await apply(p.settlementId, grants);
}

async function onBattle(p) {
  const ids = p.citizenIds || [];
  if (!ids.length) return;
  const roles = await rolesOf(p.settlementId, ids);
  const xp = XP.battleBase + XP.battlePerEnemy * Math.max(1, Number(p.enemyCount) || 1);
  const grants = [], counters = [];
  for (const id of ids) {
    const role = roles.get(Number(id));
    if (!role) continue;
    const combat = role === 'soldier' || role === 'archer';
    grants.push({ citizenId: Number(id), classKey: combat ? role : 'soldier', xp: xp * (combat ? 1 : XP.offJob) });
    counters.push({ citizenId: Number(id), counter: 'battles_won' });
  }
  await apply(p.settlementId, grants, counters);
}

async function onPorterHome(p) {
  const roles = await rolesOf(p.settlementId, [p.citizenId]);
  const role = roles.get(Number(p.citizenId));
  if (!role) return;
  const xp = (XP.porterBase + XP.porterPerHour * (Number(p.hours) || 0) + (p.kind === 'npc' ? XP.npcTrade : 0)) * (role === 'porter' ? 1 : XP.offJob);
  const counters = [{ citizenId: p.citizenId, counter: 'porter_runs' }];
  if (p.kind === 'npc') counters.push({ citizenId: p.citizenId, counter: 'npc_trades' });
  await apply(p.settlementId, [{ citizenId: p.citizenId, classKey: 'porter', xp }], counters);
}

async function onMerchantTrip(p) {
  await apply(p.settlementId, [{ citizenId: p.citizenId, classKey: 'merchant', xp: XP.merchantBase + (Number(p.distance) || 0) }]);
}

async function onExpedition(p) {
  const roles = await rolesOf(p.settlementId, [p.citizenId]);
  if (roles.get(Number(p.citizenId)) !== 'scout') return;
  await apply(p.settlementId, [{ citizenId: p.citizenId, classKey: 'scout', xp: XP.expeditionBase + (Number(p.hexes) || 0) }]);
}

// A stall sale pays the keeper of the shop it sold from.
async function onShopSale(p) {
  const k = (await query('SELECT citizen_id FROM shop_keepers WHERE settlement_id = $1 AND venue = $2', [p.settlementId, p.venue])
    .catch(() => ({ rows: [] }))).rows[0];
  if (!k) return;
  const xp = Math.min(XP.shopMax, XP.shopBase + (Number(p.gold) || 0) * XP.shopPerGold);
  await apply(p.settlementId, [{ citizenId: k.citizen_id, classKey: 'shopkeeper', xp }], [{ citizenId: k.citizen_id, counter: 'shop_sales' }]);
}

let _registered = false;
function register() {
  if (_registered) return;
  _registered = true;
  gameEvents.on('quest_completed', onQuest);
  gameEvents.on('clan_quest_completed', onQuest);
  gameEvents.on('battle_won', onBattle);
  gameEvents.on('porter_home', onPorterHome);
  gameEvents.on('merchant_trip_done', onMerchantTrip);
  gameEvents.on('expedition_returned', onExpedition);
  gameEvents.on('shop_sale', onShopSale);
}

module.exports = { register, XP, SKILL_CLASS, onQuest, onBattle, onPorterHome, onMerchantTrip, onExpedition, onShopSale };
