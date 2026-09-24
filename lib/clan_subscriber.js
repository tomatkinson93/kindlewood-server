// ══════════════════════════════════════════════════════════════════════════
//  CLAN SUBSCRIBER — turns game events into clan prestige (spec 016 §5, §8b)
//
//  game event → is the player in a clan? (no → return: single-player fast
//  path, one indexed lookup) → withTransaction: lock clan, lock member,
//  apply the per-member daily cap, grant, level-up check, activity row →
//  AFTER COMMIT publish clan_prestige (+ clan_level_up) on clan:<id>.
//
//  Lock order is clan row, then member row — the same order the membership
//  routes use — so a grant racing a kick can't deadlock.
//
//  All tuning lives in PRESTIGE_CONFIG. Values are provisional.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query, withTransaction } = require('../db');
const eventBus = require('./event_bus');
const gameEvents = require('./game_events');
const palette = require('./clan_palette');

const PRESTIGE_CONFIG = {
  quest:   { perSqrtMinute: 4, min: 2, max: 40 },       // clamp(round(4·√(min)), 2, 40)
  battle:  { base: 6, perExtraEnemy: 3, max: 18 },      // min(18, 6 + 3·(enemies − 1))
  outpost: 15,
  tier:    { village: 100, town: 200, city: 300 },     // milestones — not capped
  dailySoft: 150,   // raw points/day credited at 100%
  dailyHard: 300,   // raw points/day between soft and hard credited at 50%; beyond, 0
};

function questPrestige(durationS) {
  const c = PRESTIGE_CONFIG.quest;
  const v = Math.round(c.perSqrtMinute * Math.sqrt(Math.max(0, Number(durationS) || 0) / 60));
  return Math.max(c.min, Math.min(c.max, v));
}

function battlePrestige(enemyCount) {
  const c = PRESTIGE_CONFIG.battle;
  return Math.min(c.max, c.base + c.perExtraEnemy * (Math.max(1, enemyCount | 0) - 1));
}

// Effective credit for a new raw award, given raw already earned today.
function capped(rawBefore, raw) {
  const SOFT = PRESTIGE_CONFIG.dailySoft, HARD = PRESTIGE_CONFIG.dailyHard;
  const seg = (lo, hi) => Math.max(0, Math.min(rawBefore + raw, hi) - Math.max(rawBefore, lo));
  return seg(0, SOFT) + Math.floor(seg(SOFT, HARD) * 0.5);
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

// ── Pattern A helpers (caller holds a transaction client) ─────────────────

// Adds to both counters; returns { prestige, prestige_lifetime, level }.
async function grantPrestige(client, clanId, amount) {
  const r = await client.query(
    `UPDATE clans SET prestige = prestige + $2, prestige_lifetime = prestige_lifetime + $2
      WHERE id = $1 RETURNING prestige, prestige_lifetime, level`,
    [clanId, amount]);
  return r.rows[0] || null;
}

// Deducts if affordable; returns the new balance, or null when it isn't.
async function spendPrestige(client, clanId, cost) {
  const r = await client.query(
    'UPDATE clans SET prestige = prestige - $2 WHERE id = $1 AND prestige >= $2 RETURNING prestige',
    [clanId, cost]);
  return r.rows[0] ? Number(r.rows[0].prestige) : null;
}

// Raises the level if lifetime prestige crossed a threshold. Monotonic, so
// only the request that actually moves it gets a row back.
async function applyLevelUp(client, clanId, lifetime) {
  const target = palette.levelForLifetime(Number(lifetime));
  const r = await client.query(
    'UPDATE clans SET level = $2 WHERE id = $1 AND level < $2 RETURNING level', [clanId, target]);
  return r.rows[0] ? r.rows[0].level : null;
}

// ── Award (Pattern C) ─────────────────────────────────────────────────────

// Credits `raw` prestige earned by userId to their clan. milestone awards
// skip the daily cap and don't advance the day counter. Resolves the
// outcome, or null if the player isn't in a clan. Publishes after COMMIT.
async function awardPrestige({ userId, raw, milestone = false, source, detail = {}, now = new Date() }) {
  if (!(raw > 0)) return null;
  const pre = await query('SELECT clan_id FROM clan_members WHERE user_id = $1', [userId]);
  if (!pre.rows[0]) return null;
  const clanId = pre.rows[0].clan_id;
  const today = utcDay(now);

  const out = await withTransaction(async (client) => {
    const clan = await client.query('SELECT id FROM clans WHERE id = $1 FOR UPDATE', [clanId]);
    if (!clan.rows[0]) return null;
    const m = await client.query(
      `SELECT clan_id, prestige_day::text AS day, prestige_today
         FROM clan_members WHERE user_id = $1 FOR UPDATE`, [userId]);
    const member = m.rows[0];
    if (!member || member.clan_id !== clanId) return null;   // left/kicked meanwhile

    let effective;
    if (milestone) {
      effective = raw;
      await client.query(
        'UPDATE clan_members SET prestige_contributed = prestige_contributed + $2 WHERE user_id = $1',
        [userId, effective]);
    } else {
      const rawBefore = member.day === today ? member.prestige_today : 0;
      effective = capped(rawBefore, raw);
      await client.query(
        `UPDATE clan_members
            SET prestige_day = $2, prestige_today = $3,
                prestige_contributed = prestige_contributed + $4
          WHERE user_id = $1`,
        [userId, today, rawBefore + raw, effective]);
    }
    if (effective <= 0) return { clanId, effective: 0, raw, leveledTo: null };

    const g = await grantPrestige(client, clanId, effective);
    const leveledTo = await applyLevelUp(client, clanId, g.prestige_lifetime);
    await client.query(
      `INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'prestige_earned',$2,$3)`,
      [clanId, userId, JSON.stringify({ amount: effective, raw, source, milestone, ...detail })]);
    if (leveledTo) {
      await client.query(
        `INSERT INTO clan_activity (clan_id, type, actor_user_id, payload) VALUES ($1,'level_up',NULL,$2)`,
        [clanId, JSON.stringify({ level: leveledTo })]);
    }
    return { clanId, effective, raw, leveledTo, lifetime: Number(g.prestige_lifetime) };
  });

  if (out && out.effective > 0) {
    eventBus.publish(`clan:${clanId}`, {
      type: 'clan_prestige', clan_id: clanId, user_id: userId, amount: out.effective, source,
    });
    if (out.leveledTo) {
      eventBus.publish(`clan:${clanId}`, { type: 'clan_level_up', clan_id: clanId, level: out.leveledTo });
      // Phase 4: also write a system line into the clan's chat backlog here.
    }
  }
  return out;
}

async function userIdForSettlement(settlementId) {
  const r = await query('SELECT user_id FROM settlements WHERE id = $1', [settlementId]);
  return r.rows[0] ? r.rows[0].user_id : null;
}

// ── Game event handlers ───────────────────────────────────────────────────

async function onQuestCompleted(p) {
  if (!p || !p.success) return null;
  const userId = p.userId || await userIdForSettlement(p.settlementId);
  if (!userId) return null;
  return awardPrestige({
    userId, raw: questPrestige(p.durationS), source: 'quest',
    detail: { quest_run_id: p.questRunId, duration_s: p.durationS },
  });
}

async function onBattleWon(p) {
  const userId = p.userId || await userIdForSettlement(p.settlementId);
  if (!userId) return null;
  return awardPrestige({ userId, raw: battlePrestige(p.enemyCount), source: 'battle', detail: { enemies: p.enemyCount } });
}

async function onOutpostEstablished(p) {
  const userId = p.userId || await userIdForSettlement(p.settlementId);
  if (!userId) return null;
  return awardPrestige({ userId, raw: PRESTIGE_CONFIG.outpost, source: 'outpost' });
}

async function onTierUpgraded(p) {
  const raw = PRESTIGE_CONFIG.tier[p.tier];
  const userId = p.userId || await userIdForSettlement(p.settlementId);
  if (!raw || !userId) return null;
  return awardPrestige({ userId, raw, milestone: true, source: 'tier', detail: { tier: p.tier } });
}

let _registered = false;
function register() {
  if (_registered) return;
  _registered = true;
  gameEvents.on('quest_completed', onQuestCompleted);
  gameEvents.on('battle_won', onBattleWon);
  gameEvents.on('outpost_established', onOutpostEstablished);
  gameEvents.on('tier_upgraded', onTierUpgraded);
}

module.exports = {
  PRESTIGE_CONFIG, questPrestige, battlePrestige, capped, utcDay,
  grantPrestige, spendPrestige, applyLevelUp, awardPrestige,
  onQuestCompleted, onBattleWon, onOutpostEstablished, onTierUpgraded,
  register,
};
