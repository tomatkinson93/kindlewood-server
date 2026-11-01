// ══════════════════════════════════════════════════════════════════════════
//  trust_decay — villages forget towns that never write.
//
//  After DECAY_AFTER_DAYS without contact (gifts, goodwill, trades,
//  requests, quests, tribute — anything that stamps
//  diplomacy_relations.last_interaction), trust drops PER_DAY a day, never
//  below trust_floor. The floor only rises: reaching a band lifts it to the
//  start of the band below (Allied 71+ → 41: an ally can cool to Friendly,
//  no further). From WARN_AFTER_DAYS the village panel says it hasn't heard
//  from you. A drop out of a band writes a settlement event.
//
//  Runs from the quest worker (tick) at most once every RUN_EVERY_MS, so it
//  works for players who aren't online.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

const DECAY_AFTER_DAYS = 7;
const WARN_AFTER_DAYS = 5;
const PER_DAY = 1;
const RUN_EVERY_MS = 10 * 60 * 1000;
const BANDS = [1, 21, 41, 71];   // Contacted, Familiar, Friendly, Allied

// The floor a trust value earns: the start of the band below its own.
function floorFor(trust) {
  let i = -1;
  for (let k = 0; k < BANDS.length; k++) if (trust >= BANDS[k]) i = k;
  return i <= 0 ? 0 : BANDS[i - 1];
}
const FLOOR_SQL = `CASE WHEN trust >= 71 THEN 41 WHEN trust >= 41 THEN 21 WHEN trust >= 21 THEN 1 ELSE 0 END`;

// Days since contact → how worried the village is (for the panel).
function quietDays(lastInteraction, now = Date.now()) {
  if (!lastInteraction) return 0;
  return Math.floor((now - Date.parse(lastInteraction)) / 86400000);
}
function warning(rel, now = Date.now()) {
  const d = quietDays(rel && rel.last_interaction, now);
  if (!rel || !(rel.trust > 0) || d < WARN_AFTER_DAYS) return null;
  return d >= DECAY_AFTER_DAYS
    ? { days: d, decaying: true, text: `They haven't heard from you in ${d} days — trust is slipping (never below ${Math.max(rel.trust_floor || 0, floorFor(rel.trust))}).` }
    : { days: d, decaying: false, text: `They haven't heard from you in ${d} days. Keep in touch — trust fades after a week of silence.` };
}

let _last = 0;
// One pass: lift floors, then take a day's trust from every quiet relation
// not decayed in the last day. Returns the rows that dropped.
async function run(now = Date.now(), db) {
  const q = db ? (t, p) => db.query(t, p) : query;
  await q(`UPDATE diplomacy_relations SET trust_floor = ${FLOOR_SQL} WHERE trust_floor < ${FLOOR_SQL}`);
  const r = await q(
    `UPDATE diplomacy_relations d SET trust = GREATEST(d.trust_floor, d.trust - $2), trust_decayed_at = to_timestamp($1 / 1000.0)
      WHERE d.trust > d.trust_floor AND d.last_interaction IS NOT NULL
        AND d.last_interaction < to_timestamp($1 / 1000.0) - make_interval(days => $3)
        AND (d.trust_decayed_at IS NULL OR d.trust_decayed_at < to_timestamp($1 / 1000.0) - interval '1 day')
        AND d.status <> 'contact_sent'
      RETURNING d.id, d.settlement_id, d.npc_id, d.trust, d.trust + $2 AS was`, [now, PER_DAY, DECAY_AFTER_DAYS]);
  const { getTrustLevel } = require('../routes/diplomacy');
  for (const row of r.rows) {
    const before = getTrustLevel(Math.min(100, row.was)), after = getTrustLevel(row.trust);
    if (before.status === after.status) continue;
    await q("UPDATE diplomacy_relations SET status = $2 WHERE id = $1 AND status <> 'contact_sent'", [row.id, after.status]);
    const n = (await q('SELECT name FROM npc_settlements WHERE id = $1', [row.npc_id])).rows[0];
    await q("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1, 'trust_faded', $2)",
      [row.settlement_id, `🍂 ${n ? n.name : 'A village'} hasn't heard from you in a long while. Relations cool from ${before.label} to ${after.label}.`]).catch(() => {});
  }
  return r.rows;
}

async function tick() {
  if (Date.now() - _last < RUN_EVERY_MS) return;
  _last = Date.now();
  try { await run(); } catch (e) { console.error('[trust_decay]', e.message); }
}

module.exports = { run, tick, floorFor, warning, quietDays, DECAY_AFTER_DAYS, WARN_AFTER_DAYS, PER_DAY, BANDS };
