// ══════════════════════════════════════════════════════════════════════════
//  First steps — a short checklist for a new town, worked out from what the
//  town has actually done (nothing is stored but "dismissed").
//
//    GET  /api/game/first-steps          { steps, done, total, dismissed }
//    POST /api/game/first-steps/dismiss  hide it for good
//
//  Each step: { key, icon, title, hint, show, done } — `show` names the
//  screen the client opens for "Show me".
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query } = require('../db');

const STEPS = [
  { key: 'lumber',   icon: '🪵', title: 'Build a Lumber Camp',            show: 'build',     hint: 'Timber builds almost everything. Open Manage Settlement and build one on an empty plot.',
    sql: "SELECT 1 FROM buildings WHERE settlement_id=$1 AND type='lumber_camp' AND level > 0" },
  { key: 'jobs',     icon: '👷', title: 'Give a citizen a new job',       show: 'citizens',  hint: 'Your foragers can become woodcutters, scouts, miners… Open Manage Citizens and change a role.',
    sql: "SELECT 1 FROM citizens WHERE settlement_id=$1 AND COALESCE(role,'idle') NOT IN ('idle','forager','farmer')" },
  { key: 'quest',    icon: '⚔️', title: 'Take a quest at the Tavern',      show: 'tavern',    hint: 'The Tavern board has new quests every day — send a citizen for coin and loot.',
    sql: 'SELECT 1 FROM settlement_quests WHERE settlement_id=$1' },
  { key: 'scout',    icon: '🗺', title: 'Send a scout',                    show: 'map',       hint: 'Build a Scout Post, then tap a tile under the fog and send a scout to reveal it.',
    sql: 'SELECT 1 FROM expeditions WHERE settlement_id=$1' },
  { key: 'outpost',  icon: '🏕️', title: 'Found an outpost',               show: 'map',       hint: 'Outposts gather stone, ore and more from the land around your town. Tap a nearby tile to found one.',
    sql: 'SELECT 1 FROM outposts WHERE settlement_id=$1' },
  { key: 'research', icon: '📚', title: 'Build a Library and start research', show: 'research', hint: 'Research unlocks new buildings, resources and bonuses.',
    sql: 'SELECT 1 FROM settlement_research WHERE settlement_id=$1' },
  { key: 'market',   icon: '⚖️', title: 'Trade at the Market',             show: 'market',    hint: 'Sell what you have plenty of, or buy what you lack from other towns.',
    sql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM market_orders WHERE seller_settlement_id=$1)
             OR EXISTS (SELECT 1 FROM market_trades WHERE buyer_settlement_id=$1 OR seller_settlement_id=$1)
             OR EXISTS (SELECT 1 FROM market_runs WHERE settlement_id=$1)
             OR EXISTS (SELECT 1 FROM market_wants WHERE buyer_settlement_id=$1)` },
];

async function forSettlement(s, q = (t, p) => query(t, p)) {
  const steps = [];
  for (const st of STEPS) {
    const done = (await q(st.sql + ' LIMIT 1', [s.id]).catch(() => ({ rows: [] }))).rows.length > 0;
    steps.push({ key: st.key, icon: st.icon, title: st.title, hint: st.hint, show: st.show, done });
  }
  const done = steps.filter(x => x.done).length;
  return { steps, done, total: steps.length, dismissed: !!s.first_steps_dismissed };
}

module.exports = { forSettlement, STEPS };
