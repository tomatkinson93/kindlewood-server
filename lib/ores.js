// ══════════════════════════════════════════════════════════════════════════
//  ores — where the resources beyond the basic five come from, per hour.
//
//  • Miners at the Mine dig ore alongside stone and iron. What they turn up
//    grows with the Mine's level (resource_defs `mine_level`):
//        Lv1 copper, tin, coal · Lv2 silver · Lv3 gold ore and gems
//    Per seated miner: MINE_ORE × their output multiplier × (1 + `ore`
//    perks — all ores — + `ore:<key>` perks for one).
//  • Outposts on hills and mountains (outposts_config `ores`) × level.
//  • Research-gated resources (resource_defs `research`) yield nothing
//    until the town has finished that project. Prospecting: +15% of all.
//
//  oreRates(buildings, citizens, outposts, research)
//    → { rates: { key: perHour }, sources: { key: [{ kind, label, value, citizenIds? }] } }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const RD = require('./resource_defs');

// Per miner per hour at an ordinary Mine (before perks and stats).
const MINE_ORE = { copper: 0.5, tin: 0.35, coal: 0.6, silver: 0.2, goldore: 0.12, gems: 0.04 };

const r2 = v => Math.round(v * 100) / 100;

function available(key, research) {
  const d = RD.def(key);
  if (!d) return false;
  if (d.discovery === 'research' || d.discovery === 'alloy') return !!(research && research.has(d.research));
  return true;
}

function oreRates(buildings, citizens, outposts, research) {
  const { BUILDINGS } = require('../buildings');
  const rates = {}, sources = {};
  const add = (k, v, src) => {
    if (!(v > 0)) return;
    rates[k] = (rates[k] || 0) + v;
    (sources[k] = sources[k] || []).push({ ...src, value: r2(v) });
  };

  const mineLevel = (buildings || []).filter(b => b.type === 'mine').reduce((m, b) => Math.max(m, Number(b.level) || 0), 0);
  if (mineLevel > 0) {
    const slots = BUILDINGS.mine.citizenSlots(mineLevel);
    const miners = (citizens || []).filter(c => c.role === 'miner')
      .map(c => ({ c, m: c.profile ? c.profile.outputMult : 1 }))
      .sort((a, b) => b.m - a.m).slice(0, slots);
    for (const [k, base] of Object.entries(MINE_ORE)) {
      if (RD.def(k).mine_level > mineLevel || !available(k, research)) continue;
      for (const { c, m } of miners) {
        const fx = (c.profile && c.profile.effects) || {};
        const v = base * m * (1 + (fx.ore || 0) + (fx['ore:' + k] || 0));
        add(k, v, { kind: 'citizen', label: c.name || 'Miner', citizenIds: c.id != null ? [c.id] : [] });
      }
    }
  }

  if (Array.isArray(outposts) && outposts.length) {
    const { OUTPOST_CONFIG } = require('../outposts_config');
    for (const o of outposts) {
      const cfg = OUTPOST_CONFIG[o.terrain];
      if (!cfg || !cfg.ores) continue;
      const lvl = Math.max(1, Math.floor(o.level) || 1);
      for (const [k, v] of Object.entries(cfg.ores)) {
        if (available(k, research)) add(k, v * lvl, { kind: 'outpost', label: `${cfg.name} (${o.terrain})` });
      }
    }
  }
  // Research (Prospecting): more of every ore, town-wide.
  // …and the Dev Tools ore multiplier (lib/tuning.js).
  const boost = (1 + (require('./research_defs').effectsOf(research).ore || 0)) * require('./tuning').T('ore') - 1;
  if (boost) for (const k of Object.keys(rates)) { rates[k] *= 1 + boost; for (const src of sources[k]) src.value = r2(src.value * (1 + boost)); }
  for (const k of Object.keys(rates)) rates[k] = r2(rates[k]);
  return { rates, sources };
}

module.exports = { MINE_ORE, oreRates, available };
