// Happening effects + stat modifiers (spec 021 Phase 6 follow-up): shared
// rules, deterministic random modifiers, offline production integration and
// every server application point that runs without a DB.
// Run from the server root: node scripts/happening_effects_test.js [frontendDir]
'use strict';
process.env.ADMIN_USER_IDS = '1';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// Stub ../db so modules that load Happenings never reach Postgres.
const emptyQ = async () => ({ rows: [] });
require.cache[require.resolve('../db')] = { id: 'db', filename: require.resolve('../db'), loaded: true,
  exports: { query: emptyQ, pool: { connect: async () => ({ query: emptyQ, release() {} }) } } };

const FX = require('../lib/happening_effects');
const D = require('../lib/day_cycle');
const HOUR = 3600e3, DAY = 24 * HOUR;
let pass = 0, fail = 0;
function check(name, ok, extra) { console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; }
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const T0 = Date.parse('2026-11-05T00:00:00Z');
const def = (id, rule, effects) => ({ id, title: id, enabled: true, archived: false, rule, effects });

// 1. Byte identity
{
  const dir = process.argv[2] || process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
  const fe = path.join(dir, 'js', 'happening-effects.js');
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (!fs.existsSync(fe)) console.log('  ⚠ 1. SKIPPED byte identity — frontend not found at ' + fe);
  else check('1. lib/happening_effects.js byte-identical to the frontend js/happening-effects.js', sha(fe) === sha(path.join(__dirname, '..', 'lib', 'happening_effects.js')));
}

// 2. Validation
{
  const v = FX.validateEffects;
  check('2. every visual kind and stat is accepted; values must sit inside the stat range',
        Object.keys(FX.VISUALS).every(k => v([{ type: 'map_flourish', kind: k }]).ok) &&
        FX.STAT_IDS.every(k => v([{ type: 'modifier', stat: k, value: FX.STATS[k].max }]).ok && !v([{ type: 'modifier', stat: k, value: FX.STATS[k].max * 1.01 + 0.01 }]).ok));
  check('2b. unknown stat / zero value / bad mood rejected',
        !v([{ type: 'modifier', stat: 'luck', value: 1 }]).ok && !v([{ type: 'modifier', stat: 'happiness', value: 0 }]).ok &&
        !v([{ type: 'random_modifier', mood: 'chaotic' }]).ok && v([{ type: 'random_modifier' }]).effects[0].mood === 'any');
}

// 3. Random modifiers: deterministic per window, within reason, mood respected
{
  const h = def('mystery', { type: 'daily', start: '20:00', durationMin: 120 }, [{ type: 'random_modifier' }]);
  const a = FX.resolveEffects(h, T0 + 20 * HOUR)[0], b = FX.resolveEffects(h, T0 + 20 * HOUR)[0];
  check('3. same Happening + window → the same random stat and value (client = server)', JSON.stringify(a) === JSON.stringify(b) && a.type === 'modifier' && a.random);
  let inRange = true, goodOk = true, badOk = true; const statsSeen = new Set(); let differ = 0;
  for (let i = 0; i < 400; i++) {
    const w = T0 + i * DAY;
    const r = FX.rollRandom('mystery', w, 0, 'any'), g = FX.rollRandom('blessing', w, 0, 'good'), c = FX.rollRandom('curse', w, 0, 'bad');
    for (const m of [r, g, c]) { const s = FX.STATS[m.stat]; const mag = Math.abs(m.value); if (mag < s.rand[0] - 1e-9 || mag > s.rand[1] + 1e-9 || m.value === 0) inRange = false; }
    if (!FX.isGood(g.stat, g.value)) goodOk = false;
    if (FX.isGood(c.stat, c.value)) badOk = false;
    statsSeen.add(r.stat);
    if (i && JSON.stringify(r) !== JSON.stringify(FX.rollRandom('mystery', w - DAY, 0, 'any'))) differ++;
  }
  check('3b. rolls stay within each stat\'s random range (never zero)', inRange);
  check('3c. mood "good" only rolls blessings, "bad" only curses (inverted stats handled)', goodOk && badOk);
  check('3d. picks vary across windows and cover many stats', statsSeen.size >= 15 && differ > 300, statsSeen.size + ' stats seen');
}

// 4. modifiersAt: sums, clamps, only while running
{
  const defs = [
    def('fireworks', { type: 'daily', start: '18:00', durationMin: 240 }, [{ type: 'map_flourish', kind: 'fireworks' }, { type: 'modifier', stat: 'happiness', value: 6 }]),
    def('feast', { type: 'daily', start: '19:00', durationMin: 60 }, [{ type: 'modifier', stat: 'happiness', value: 30 }, { type: 'modifier', stat: 'food_production', value: 0.5 }]),
  ];
  const at19 = FX.modifiersAt(defs, T0 + 19.5 * HOUR), at17 = FX.modifiersAt(defs, T0 + 17 * HOUR), at21 = FX.modifiersAt(defs, T0 + 21 * HOUR);
  check('4. overlapping modifiers on one stat add up, then clamp to the stat max', at19.happiness === FX.STATS.happiness.max && at19.food_production === 0.5);
  check('4b. nothing outside the windows; one Happening alone when the other has ended', Object.keys(at17).length === 0 && at21.happiness === 6 && !at21.food_production);
  check('4c. productionFactor = 1 + resource + all_production (floored at 0.1)',
        near(FX.productionFactor({ food_production: 0.2, all_production: 0.1 }, 'food'), 1.3) && near(FX.productionFactor({ all_production: -2 }, 'stone'), 0.1));
}

// 5. Offline integration (the D7 replacement)
{
  const fest = [def('harvest', { type: 'daily', start: '12:00', durationMin: 120 }, [{ type: 'modifier', stat: 'food_production', value: 0.2 }])];
  const f = FX.averageProductionFactor(fest, 'food', T0 + 6 * HOUR, T0 + 16 * HOUR);     // 10h away, 2h of it festival
  const g = FX.averageProductionFactor(fest, 'food', T0 + 12.5 * HOUR, T0 + 13.5 * HOUR); // fully inside
  const n = FX.averageProductionFactor(fest, 'food', T0 + 15 * HOUR, T0 + 20 * HOUR);     // none
  check('5. 10h offline with a 2h +20% festival → ×1.04 (only the 2h count), not ×1.20', near(f, 1.04), f.toFixed(4));
  check('5b. fully inside → ×1.20; fully outside → ×1.00', near(g, 1.2) && near(n, 1));
  // Same total as summing hour-by-hour
  let acc = 0; for (let t = 6; t < 16; t += 0.25) acc += FX.productionFactor(FX.modifiersAt(fest, T0 + (t + 0.125) * HOUR), 'food') * 0.25;
  check('5c. matches brute-force quarter-hour integration', near(f, acc / 10, 1e-9));
}

// 6. Famine upkeep per quantum
{
  const famine = require('../famine');
  const season = { name: 'Winter', foodConsumption: 1.2 };
  const greedy = [def('famine_feast', { type: 'daily', start: '10:00', durationMin: 60 }, [{ type: 'modifier', stat: 'food_upkeep', value: 0.5 }])];
  const inside = famine.seasonWithUpkeep(season, greedy, T0 + 10.5 * HOUR), outside = famine.seasonWithUpkeep(season, greedy, T0 + 12 * HOUR);
  check('6. food_upkeep folds into the quantum\'s season (×1.2 × 1.5 = ×1.8) only inside the window',
        near(inside.foodConsumption, 1.8) && outside === season && famine.seasonWithUpkeep(season, [], T0) === season);
}

// 7. Quests
{
  const Q = require('../routes/quests')._happeningHelpers;
  check('7. quest_duration −25% shortens, quest_success +10% adds (capped 0.95), quest_rewards +50% multiplies',
        Q.moddedDuration(120, { quest_duration: -0.25 }) === 90 && near(Q.moddedSuccess(0.5, { quest_success: 0.1 }), 0.6) &&
        Q.moddedSuccess(0.9, { quest_success: 0.3 }) === 0.95 && Q.moddedReward(10, { quest_rewards: 0.5 }) === 15 && Q.moddedReward(10, {}) === 10);
}

// 8. Combat: enemy scaling + party bonus, frozen per battle
{
  const R = require('../lib/combat_resolver');
  const E = require('../lib/combat_engine');
  check('8. combatModsOf keeps only combat stats (null when none)',
        JSON.stringify(R.combatModsOf({ enemy_health: 0.5, happiness: 5 })) === '{"enemy_health":0.5}' && R.combatModsOf({ happiness: 5 }) === null);
  R._installRosterForTest(null);
  const base = JSON.parse(JSON.stringify(E.ENEMIES()));
  const k = Object.keys(base)[0];
  R._installRosterForTest({ enemy_health: 0.5, enemy_strength: -0.2 });
  const up = E.ENEMIES()[k].stats;
  const b = base[k].stats;
  const ok = up.maxHp === Math.round(b.maxHp * 1.5) && up.strength === Math.max(1, Math.round(b.strength * 0.8)) && up.agility === b.agility;
  R._installRosterForTest(null);
  const back = E.ENEMIES()[k].stats.maxHp === b.maxHp;
  check('8b. enemy_health +50% / enemy_strength −20% scale the roster; no mods → back to base', ok && back, k + ' hp ' + b.maxHp + '→' + up.maxHp);
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'combat.js'), 'utf8');
  check('8c. every quest-battle replay passes the frozen combat_mods', (src.match(/mods: (run|questRun)\.combat_mods/g) || []).length === 4);
  const qsrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'quests.js'), 'utf8');
  check('8d. the trigger stores combat_mods on the run and passes them to auto-resolve',
        /combat_encounter=\$1, combat_mods=\$3/.test(qsrc) && /mods: combatMods,/.test(qsrc));
}

// 9. Fishing
{
  const F = require('../lib/fishing');
  const tally = (mods) => { let rare = 0, junk = 0; let a = 7; const rng = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
    for (let i = 0; i < 20000; i++) { const c = F.rollCatch(rng, T0, 'autumn', false, mods); if (c.kind === 'junk') junk++; else if (c.fish.rarity === 'rare' || c.fish.rarity === 'legendary') rare++; }
    return { rare: rare / 20000, junk: junk / 20000 }; };
  const base = tally({}), lucky = tally({ rare_fish: 2, junk_catch: -0.5 });
  check('9. rare_fish +200% roughly triples rare catches; junk_catch −50% halves junk',
        lucky.rare > base.rare * 2.4 && Math.abs(lucky.junk - base.junk / 2) < 0.01, `rare ${(base.rare * 100).toFixed(1)}%→${(lucky.rare * 100).toFixed(1)}% · junk ${(base.junk * 100).toFixed(1)}%→${(lucky.junk * 100).toFixed(1)}%`);
}

// 10. Citizens + economy wiring (source)
{
  const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  check('10. happiness factor, birth chance and bonding read Happening modifiers',
        /happeningHappiness/.test(r('happiness.js')) && /hMods\.birth_chance/.test(r('simulation.js')) && /hMods\.bonding/.test(r('simulation.js')) &&
        /hMods\.birth_chance/.test(r('routes/citizens.js')));
  check('10b. applyTick integrates production over [last_tick, now]; topbar + breakdown show current multipliers',
        /effectiveProductionHours\(await happenings.loadLive\(\), lastTick, now\)/.test(r('routes/game.js')) && /averageProductionFactor\(defs, res, seg.fromMs, seg.toMs\)/.test(r('lib/away_report.js')) && /applyHappeningRates\(/.test(r('routes/game.js')) && /happeningPseudoSeason\(/.test(r('routes/game.js')));
  check('10c. economy stays on the real clock (no gameplayNow in famine / simulation)',
        !/gameplayNow/.test(r('famine.js')) && !/gameplayNow/.test(r('simulation.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
