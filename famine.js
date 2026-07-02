// ══════════════════════════════════════════════════════════════════════════
//  FAMINE — consumption & starvation system (server root, alongside
//  simulation.js). Implements 01_SPEC_consumption_famine_REFINED.md.
//
//  Layout:
//    CONSTANTS            — every tunable, per the spec's decision log
//    upkeepPerHour()      — per-citizen consumption (Q1)
//    simulateConsumption()— PURE function, no DB, no Date.now(), no
//                           Math.random(). Fully deterministic; this is the
//                           unit-test surface (spec §6 tests 1–9a).
//    applyConsumption()   — the tick entry point. Quantized clock +
//                           compare-and-swap claim (spec §3). Call from
//                           applyTick in server game.js.
//    getFamineSummary()   — famine block for the /settlement response (Q5).
//    buildUpkeepBreakdownSource() — negative food row for the breakdown
//                           modal (Q5).
//
//  Determinism accounting (spec §5): the ONLY seeded element is narrative
//  template selection — hash32(citizen_id, quantumIndex). Feeding order is
//  a pure sort. Math.random() appears nowhere in this file.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('./db');
const { SEASONS } = require('./seasons');
const { FAMINE_NARRATIVES } = require('./lib/injury_table');
const { writeDeathEvent } = require('./deaths');

// ── Constants (spec Q1–Q4 + decision log) ────────────────────────────────
const QUANTUM_MS         = 15 * 60 * 1000;   // 15-minute consumption quanta
const QUANTUM_HOURS      = 0.25;
const MAX_QUANTA_PER_RUN = 4 * 24 * 28;      // cap offline processing at 28 days

const UPKEEP_BY_STAGE = { child: 0.5, adult: 1.0, elder: 0.75, deceased: 0 };
const PHYSICAL_ROLES  = new Set(['farmer', 'woodcutter', 'miner', 'soldier']);
const PHYSICAL_ROLE_MULT = 1.2;
const GREEDY_MULT        = 1.5;

const HUNGER_RISE_PER_HOUR = 5;    // unfed
const HUNGER_FALL_PER_HOUR = 10;   // fed (recovery is 2x rise, spec Q4)
const HUNGER_FLOOR         = 20;   // generated baseline
const HUNGRY_THRESHOLD     = 70;   // happiness factor kicks in
const STARVING_THRESHOLD   = 90;   // condition + health drain
const STARVING_RELEASE     = 75;   // hysteresis: condition lifted below this

const HEALTH_DRAIN_PER_HOUR = 2;   // while hunger >= STARVING_THRESHOLD
const HEALTH_REGEN_PER_HOUR = 1;   // fed & hunger <= REGEN_HUNGER_MAX
const REGEN_HUNGER_MAX      = 40;

// Stored-happiness nudge. simulation.js READS life.happiness for
// partnership/breeding gates but nothing writes it after generation — so
// the computed `hungry` factor alone would never suppress breeding during
// a famine. While starving, stored happiness decays; when fed and sated it
// recovers toward (but never above) the 70 baseline. Deterministic, small,
// and it makes BREED_MIN_HAPPINESS (60) actually bite during famine.
const HAPPINESS_DECAY_PER_HOUR   = 1;   // while starving, floor 20
const HAPPINESS_RECOVER_PER_HOUR = 1;   // fed & hunger<=40, toward 70 only
const HAPPINESS_DECAY_FLOOR      = 20;
const HAPPINESS_RECOVER_CEIL     = 70;

// Mercy cap + tutorial grace gate (spec Q2, DECIDED)
const FAMINE_DEATH_CAP_PCT  = 0.25;
const FAMINE_GRACE_MIN_POP  = 5;   // no starvation deaths at/below this pop

// Starving condition debuff — wound-tier (spec §2). Flows into combat via
// getActiveStatModifiersForCitizen automatically; never a roll modifier.
const STARVING_STAT_MODIFIERS = { strength: -2, endurance: -2, agility: -1 };

// ── Season lookup at an arbitrary timestamp ───────────────────────────────
// getCurrentSeason() reads Date.now(); the per-quantum loop needs the season
// at each quantum's START so long offline windows cross season boundaries
// correctly and deterministically.
const SEASON_DURATION_MS = 6 * 60 * 60 * 1000;
const YEAR_DURATION_MS   = 24 * 60 * 60 * 1000;
function seasonAt(ms) {
  const idx = Math.floor((ms % YEAR_DURATION_MS) / SEASON_DURATION_MS);
  return SEASONS[idx] || SEASONS[0];
}

// ── Seeded narrative pick (the only "random" in this file) ───────────────
function hash32(a, b) {
  let h = (a ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21F0AAAD) >>> 0;
  h = (h ^ b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735A2D97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
function pickSeeded(arr, citizenId, quantumIndex) {
  if (!arr || !arr.length) return '';
  return arr[hash32(Number(citizenId) >>> 0, quantumIndex >>> 0) % arr.length];
}
function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
}

// ── Per-citizen upkeep (spec Q1, all DECIDED) ─────────────────────────────
// season is optional; pass the quantum's season so winter's foodConsumption
// x1.20 (already defined in seasons.js) applies.
function upkeepPerHour(citizen, season = null) {
  const stage = citizen.life_stage || 'adult';
  let u = UPKEEP_BY_STAGE[stage] != null ? UPKEEP_BY_STAGE[stage] : UPKEEP_BY_STAGE.adult;
  if (u === 0) return 0;
  if (stage === 'adult' && PHYSICAL_ROLES.has(citizen.role)) u *= PHYSICAL_ROLE_MULT;
  const traits = citizen.visible_traits || [];
  if (traits.includes('greedy')) u *= GREEDY_MULT;
  if (season && season.foodConsumption) u *= season.foodConsumption;
  return u;
}

// ── Pure simulation (no DB, no clock, no RNG) ─────────────────────────────
//
// state = {
//   foodF:    number,           // fractional food pool (food + carry)
//   citizens: [{ id, name, life_stage, role, visible_traits,
//                hunger, health, happiness, starving (bool) }],
// }
// startMs   = epoch ms of the first quantum's start (= last_consumption_at)
// nQuanta   = whole quanta to process
//
// Returns { foodF, citizens, events, deaths } where events is
// [{ type: 'starving_onset'|'recovered'|'death', citizenId, name,
//    narrative, quantumIndex }]. Citizens array entries are mutated copies;
// each gains _dirty=true when hunger/health/happiness/starving changed.
function simulateConsumption(state, nQuanta, startMs) {
  const citizens = state.citizens.map(c => ({ ...c, _dirty: false }));
  let foodF = Number(state.foodF) || 0;
  const events = [];

  const livingCount = citizens.filter(c => c.life_stage !== 'deceased').length;
  const deathCap = livingCount <= FAMINE_GRACE_MIN_POP
    ? 0
    : Math.max(1, Math.floor(FAMINE_DEATH_CAP_PCT * livingCount));
  let deaths = 0;

  const EPS = 1e-9;

  for (let q = 0; q < nQuanta; q++) {
    const quantumStartMs = startMs + q * QUANTUM_MS;
    const quantumIndex = Math.floor(quantumStartMs / QUANTUM_MS); // global index — the seed
    const season = seasonAt(quantumStartMs);

    // Feeding order (spec Q3, DECIDED): children first, then most desperate,
    // id ascending as total-order tie-break. Re-sorted every quantum as
    // hunger values move. Pure sort — no RNG.
    const order = citizens
      .filter(c => c.life_stage !== 'deceased')
      .sort((a, b) =>
        ((b.life_stage === 'child') - (a.life_stage === 'child')) ||
        (b.hunger - a.hunger) ||
        (a.id - b.id)
      );

    for (const c of order) {
      const ration = upkeepPerHour(c, season) * QUANTUM_HOURS;
      const eaten = Math.min(ration, Math.max(0, foodF));
      foodF -= eaten;
      const fed = eaten >= ration - EPS; // zero-upkeep citizens count as fed

      if (fed) {
        if (c.hunger > HUNGER_FLOOR) {
          c.hunger = Math.max(HUNGER_FLOOR, c.hunger - HUNGER_FALL_PER_HOUR * QUANTUM_HOURS);
          c._dirty = true;
        }
        if (c.starving && c.hunger < STARVING_RELEASE) {
          c.starving = false;
          c._dirty = true;
          events.push({
            type: 'recovered', citizenId: c.id, name: c.name, quantumIndex,
            narrative: interpolate(pickSeeded(FAMINE_NARRATIVES.recovered, c.id, quantumIndex), { name: c.name }),
          });
        }
        if (c.hunger <= REGEN_HUNGER_MAX) {
          if (c.health < 100) {
            c.health = Math.min(100, c.health + HEALTH_REGEN_PER_HOUR * QUANTUM_HOURS);
            c._dirty = true;
          }
          if (c.happiness < HAPPINESS_RECOVER_CEIL) {
            c.happiness = Math.min(HAPPINESS_RECOVER_CEIL, c.happiness + HAPPINESS_RECOVER_PER_HOUR * QUANTUM_HOURS);
            c._dirty = true;
          }
        }
      } else {
        c.hunger = Math.min(100, c.hunger + HUNGER_RISE_PER_HOUR * QUANTUM_HOURS);
        c._dirty = true;

        if (c.hunger >= STARVING_THRESHOLD) {
          if (!c.starving) {
            c.starving = true;
            events.push({
              type: 'starving_onset', citizenId: c.id, name: c.name, quantumIndex,
              narrative: interpolate(pickSeeded(FAMINE_NARRATIVES.starving_onset, c.id, quantumIndex), { name: c.name }),
            });
          }
          c.health -= HEALTH_DRAIN_PER_HOUR * QUANTUM_HOURS;
          c.happiness = Math.max(HAPPINESS_DECAY_FLOOR, c.happiness - HAPPINESS_DECAY_PER_HOUR * QUANTUM_HOURS);

          if (c.health <= 0) {
            if (deaths < deathCap) {
              deaths++;
              c.health = 0;
              c.life_stage = 'deceased';
              c.starving = false; // condition removed on death
              events.push({
                type: 'death', citizenId: c.id, name: c.name, quantumIndex,
                narrative: interpolate(pickSeeded(FAMINE_NARRATIVES.death, c.id, quantumIndex), { name: c.name }),
              });
            } else {
              c.health = 1; // mercy cap / grace gate floor (spec Q2)
            }
          }
        }
      }
    }
  }

  return { foodF, citizens, events, deaths };
}

// ── Tick entry point: quantized clock + compare-and-swap (spec §3) ───────
//
// Call from applyTick(settlement, species) in server game.js:
//     const { applyConsumption } = require('./famine');
//     await applyConsumption(settlement.id);
//
// Safe to call from every ticking endpoint: the CAS guarantees exactly one
// concurrent caller applies each window. Claim-first-then-apply — a crash
// after the claim loses at most one window of consumption (citizens
// under-starve; the fail-safe direction).
//
// Returns null when there was nothing to do or the CAS was lost, else a
// small summary { quanta, deaths, events } for logging.
async function applyConsumption(settlementId) {
  const sRes = await query(
    `SELECT id, food, consumption_carry, last_consumption_at
       FROM settlements WHERE id=$1`,
    [settlementId]
  );
  const s = sRes.rows[0];
  if (!s || !s.last_consumption_at) return null;

  const lastMs = new Date(s.last_consumption_at).getTime();
  const nQuanta = Math.min(
    Math.floor((Date.now() - lastMs) / QUANTUM_MS),
    MAX_QUANTA_PER_RUN
  );
  if (nQuanta < 1) return null;

  // Advance by WHOLE quanta — never NOW() — so no time is lost, and claim
  // atomically so concurrent ticks apply exactly once.
  const newClock = new Date(lastMs + nQuanta * QUANTUM_MS);
  const claim = await query(
    `UPDATE settlements SET last_consumption_at=$1
      WHERE id=$2 AND last_consumption_at=$3
      RETURNING id`,
    [newClock.toISOString(), settlementId, s.last_consumption_at]
  );
  if (!claim.rows.length) return null; // lost the race — another request owns this window

  // Load living citizens + their active starving conditions.
  const cRes = await query(
    `SELECT id, name, life_stage, role, visible_traits, life
       FROM citizens
      WHERE settlement_id=$1 AND life_stage != 'deceased'`,
    [settlementId]
  );
  if (!cRes.rows.length) return { quanta: nQuanta, deaths: 0, events: [] };

  const condRes = await query(
    `SELECT citizen_id FROM citizen_conditions
      WHERE condition_type='starving'
        AND citizen_id = ANY($1::int[])`,
    [cRes.rows.map(c => c.id)]
  );
  const starvingSet = new Set(condRes.rows.map(r => r.citizen_id));

  const state = {
    foodF: (Number(s.food) || 0) + (Number(s.consumption_carry) || 0),
    citizens: cRes.rows.map(c => ({
      id: c.id,
      name: c.name,
      life_stage: c.life_stage || 'adult',
      role: c.role,
      visible_traits: c.visible_traits || [],
      hunger:    c.life?.hunger    ?? 30,
      health:    c.life?.health    ?? 100,
      happiness: c.life?.happiness ?? 70,
      starving:  starvingSet.has(c.id),
    })),
  };

  const result = simulateConsumption(state, nQuanta, lastMs);

  // ── Persist ──────────────────────────────────────────────────────────
  // Settlement food: integer part back to food, remainder to carry.
  const newFood = Math.max(0, Math.floor(result.foodF));
  const newCarry = Math.max(0, result.foodF - newFood);
  await query(
    `UPDATE settlements SET food=$1, consumption_carry=$2 WHERE id=$3`,
    [newFood, newCarry.toFixed(4), settlementId]
  );

  // Citizens: merge changed life fields (jsonb shallow merge).
  for (const c of result.citizens) {
    if (!c._dirty) continue;
    await query(
      `UPDATE citizens SET life = COALESCE(life,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({
        hunger:    Math.round(c.hunger * 100) / 100,
        health:    Math.round(c.health * 100) / 100,
        happiness: Math.round(c.happiness * 100) / 100,
      }), c.id]
    );
  }

  // Events: conditions, permanent death events, settlement feed entries.
  for (const ev of result.events) {
    if (ev.type === 'starving_onset') {
      // Permanent history entry + active condition (spec §2). severity
      // 'wound' reuses the existing vocabulary; cause marks it famine.
      const evRes = await query(
        `INSERT INTO citizen_events
           (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id, cause)
         VALUES ($1,$2,'injury','wound',NULL,$3,NULL,'starvation') RETURNING id`,
        [ev.citizenId, settlementId, ev.narrative]
      );
      await query(
        `INSERT INTO citizen_conditions
           (citizen_id, condition_type, body_part, severity, stat_modifiers, expires_at, source_event_id)
         VALUES ($1,'starving',NULL,'wound',$2,NULL,$3)`,
        [ev.citizenId, JSON.stringify(STARVING_STAT_MODIFIERS), evRes.rows[0].id]
      );
    } else if (ev.type === 'recovered' || ev.type === 'death') {
      await query(
        `DELETE FROM citizen_conditions WHERE citizen_id=$1 AND condition_type='starving'`,
        [ev.citizenId]
      );
      if (ev.type === 'death') {
        await writeDeathEvent({
          citizenId: ev.citizenId,
          settlementId,
          cause: 'starvation',
          narrative: ev.narrative,
        });
      }
    }
    // Settlement event feed (same table simulation.js uses).
    await query(
      `INSERT INTO settlement_events (settlement_id, type, message, citizen_ids)
       VALUES ($1,$2,$3,$4)`,
      [
        settlementId,
        ev.type === 'death' ? 'starvation_death'
          : ev.type === 'recovered' ? 'starvation_recovered'
          : 'starvation_onset',
        ev.narrative,
        JSON.stringify([ev.citizenId]),
      ]
    );
  }

  return { quanta: nQuanta, deaths: result.deaths, events: result.events };
}

// ── /settlement famine block (spec Q5) ────────────────────────────────────
// foodProductionPerHour: the settlement's POST-season food rate (what
// applySeasonModifiers returns for food). Pass it from where /settlement
// already has rates in hand.
async function getFamineSummary(settlementId, foodProductionPerHour = 0) {
  const sRes = await query(`SELECT food FROM settlements WHERE id=$1`, [settlementId]);
  const food = Number(sRes.rows[0]?.food) || 0;

  const cRes = await query(
    `SELECT id, life_stage, role, visible_traits, life
       FROM citizens WHERE settlement_id=$1 AND life_stage != 'deceased'`,
    [settlementId]
  );
  const season = seasonAt(Date.now());
  let upkeep = 0, unfed = 0, starving = 0;
  for (const c of cRes.rows) {
    upkeep += upkeepPerHour(c, season);
    const h = c.life?.hunger ?? 0;
    if (h >= HUNGRY_THRESHOLD) unfed++;
    if (h >= STARVING_THRESHOLD) starving++;
  }

  const net = foodProductionPerHour - upkeep;
  const hoursToEmpty = net < 0 && food > 0 ? Math.round((food / -net) * 10) / 10 : null;

  let state = 'ok';
  if (food < 1 && upkeep > 0) state = 'famine';
  else if (hoursToEmpty != null && hoursToEmpty < 12) state = 'critical';
  else if (hoursToEmpty != null && hoursToEmpty < 48) state = 'low';

  return {
    state,
    hours_to_empty: hoursToEmpty,
    unfed_count: unfed,
    starving_count: starving,
    upkeep_per_hour: Math.round(upkeep * 10) / 10,
  };
}

// ── Breakdown modal row (spec Q5) ─────────────────────────────────────────
// Push onto breakdown.food.sources and add .value (negative) to the total.
async function buildUpkeepBreakdownSource(settlementId) {
  const cRes = await query(
    `SELECT id, name, life_stage, role, visible_traits, life
       FROM citizens WHERE settlement_id=$1 AND life_stage != 'deceased'`,
    [settlementId]
  );
  const season = seasonAt(Date.now());
  let total = 0;
  const citizens = cRes.rows.map(c => {
    const u = upkeepPerHour(c, season);
    total += u;
    return { id: c.id, name: c.name, upkeep: Math.round(u * 100) / 100 };
  });
  const seasonNote = season.foodConsumption && season.foodConsumption !== 1.0
    ? `, ${season.name} ×${season.foodConsumption.toFixed(2)}`
    : '';
  return {
    kind: 'citizen_upkeep',
    label: `Citizen upkeep (×${citizens.length}${seasonNote})`,
    per_hour: Math.round(total * 10) / 10,
    count: citizens.length,
    citizens,
    value: -Math.round(total * 10) / 10,
  };
}

module.exports = {
  // tick + API
  applyConsumption,
  getFamineSummary,
  buildUpkeepBreakdownSource,
  // pure/test surface
  simulateConsumption,
  upkeepPerHour,
  seasonAt,
  hash32,
  pickSeeded,
  // tunables (exported for tests)
  QUANTUM_MS, QUANTUM_HOURS, MAX_QUANTA_PER_RUN,
  FAMINE_DEATH_CAP_PCT, FAMINE_GRACE_MIN_POP,
  HUNGRY_THRESHOLD, STARVING_THRESHOLD, STARVING_RELEASE,
  STARVING_STAT_MODIFIERS,
};
