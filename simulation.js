// ══════════════════════════════════════════════
//  RELATIONSHIP / BONDING / BREEDING SIMULATION
//  Kindlewood — runs inside the settlement tick
// ══════════════════════════════════════════════

const { query } = require('./db');
const { seasonAt } = require('./seasons');
const HFX = require('./lib/happening_effects');
const { VISIBLE_TRAITS, HIDDEN_TRAITS, MALE_NAMES, FEMALE_NAMES, LAST_NAMES } = require('./citizens');

// ── Relationship score thresholds ─────────────
const REL_STATES = [
  { min: 90, state: 'partners'      },
  { min: 75, state: 'bonded'        },
  { min: 60, state: 'close'         },
  { min: 40, state: 'friends'       },
  { min: 20, state: 'acquaintances' },
  { min:  0, state: 'strangers'     },
];

function scoreToState(score) {
  for (const { min, state } of REL_STATES) {
    if (score >= min) return state;
  }
  return 'strangers';
}

// ── Config (easy to tune) ──────────────────────
const CFG = {
  // Relationship score gains per simulated hour
  SAME_HOUSE_GAIN:  0.6,   // strongest — living together
  SAME_ROLE_GAIN:   0.25,  // working same job
  QUEST_BONUS:      3.0,   // one-time bonus per completed shared quest
  BASE_PROXIMITY:   0.05,  // gentle background familiarity
  HAPPINESS_MULT:   0.8,   // max extra multiplier from happiness

  // Partnership
  PARTNER_SCORE_THRESHOLD: 90,
  PARTNER_MIN_HAPPINESS:   55,
  PARTNER_FORM_CHANCE:     0.15,  // per tick once eligible

  // Breeding
  BREED_MIN_HAPPINESS:     60,
  BREED_BASE_CHANCE:       0.04,  // per tick (~4%)
  BREED_SPRING_BONUS:      0.06,
  BREED_HAPPY_BONUS:       0.04,  // per 10 pts above threshold
  BREED_FERTILE_BONUS:     0.05,  // if citizen has 'fertile' hidden trait

  // Child
  CHILD_ADULT_AGE:         16,
  SIM_TICK_HOURS:          1.0,   // run sim every simulated hour
};

// ── Main entry point ──────────────────────────
// Called from within game.js applyTick gated by last_sim_tick. Catches up
// one simulated hour per real hour since last_sim_tick (capped), each hour
// using the season and Happening modifiers in force at that time, so a
// player who was away gets the bonding, partnerships and births they would
// have had online. Runs in memory, then writes once.
const SIM_MAX_CATCHUP_HOURS = 168;   // a week; older hours are skipped

async function runSimulation(settlement, hoursElapsed, lastSimAt) {
  if (hoursElapsed < CFG.SIM_TICK_HOURS) return;
  const settlementId = settlement.id;
  const HOUR = 3600 * 1000;
  const hours = Math.floor(hoursElapsed / CFG.SIM_TICK_HOURS);

  // Claim the window: advance last_sim_tick by WHOLE hours (no time lost)
  // with a compare-and-swap, so concurrent ticks simulate it exactly once.
  let startMs;
  if (lastSimAt) {
    startMs = new Date(lastSimAt).getTime();
    const claim = await query(
      `UPDATE settlements SET last_sim_tick=$1
        WHERE id=$2 AND date_trunc('milliseconds', last_sim_tick) = $3 RETURNING id`,
      [new Date(startMs + hours * HOUR).toISOString(), settlementId, new Date(startMs).toISOString()]
    );
    if (!claim.rows.length) return;
  } else {
    await query('UPDATE settlements SET last_sim_tick = NOW() WHERE id = $1', [settlementId]);
    startMs = Date.now() - hours * HOUR;
  }
  const simHours = Math.min(hours, SIM_MAX_CATCHUP_HOURS);
  const firstMs = startMs + (hours - simHours) * HOUR;

  const citizenRes = await query(
    `SELECT * FROM citizens WHERE settlement_id = $1 AND COALESCE(life_stage, 'adult') != 'deceased'`,
    [settlementId]
  );
  const citizens = citizenRes.rows;
  const adults = citizens.filter(c => (c.life_stage || 'adult') === 'adult');
  if (adults.length < 2) return;

  const hDefs = await require('./lib/happenings').loadLive();
  const sim = await _loadSimState(settlementId, citizens, adults);
  for (let h = 0; h < simHours; h++) {
    const at = firstMs + h * HOUR + HOUR / 2;          // mid-hour: the modifiers for this hour
    const ctx = { at, season: seasonAt(at), hMods: HFX.modifiersAt(hDefs, at) };
    _hourRelationships(sim, ctx);
    _hourPartnerships(sim, ctx);
    _hourBreeding(sim, ctx);
  }
  await _persistSimState(settlementId, sim);
}

// Everything the hourly loop reads or changes, keyed for quick lookup.
async function _loadSimState(settlementId, citizens, adults) {
  const byId = {};
  for (const c of citizens) byId[c.id] = c;
  const relRes = await query('SELECT * FROM citizen_relationships WHERE settlement_id = $1', [settlementId]);
  const rels = {};
  for (const r of relRes.rows) rels[`${r.citizen_a_id}_${r.citizen_b_id}`] = { ...r, gain: 0 };
  const houseRes = await query('SELECT id, capacity, name FROM houses WHERE settlement_id = $1', [settlementId]);
  const houses = {};
  for (const hRow of houseRes.rows) houses[hRow.id] = { ...hRow, occupants: 0 };
  for (const c of citizens) if (c.house_id && houses[c.house_id]) houses[c.house_id].occupants++;
  const pairs = [];
  for (let i = 0; i < adults.length; i++) {
    for (let j = i + 1; j < adults.length; j++) {
      const a = adults[i].id < adults[j].id ? adults[i] : adults[j];
      const b = a === adults[i] ? adults[j] : adults[i];
      pairs.push([a, b]);
    }
  }
  return { byId, rels, houses, pairs, newPartners: [], events: [], births: [] };
}

function _happiness(c, ctx) { return (c.life?.happiness ?? 70) + (ctx.hMods.happiness || 0); }

// ── Step 1 (hourly): relationship scores ─────
function _hourRelationships(sim, ctx) {
  for (const [a, b] of sim.pairs) {
    const key = `${a.id}_${b.id}`;
    let gain = CFG.BASE_PROXIMITY;
    if (a.house_id && b.house_id && a.house_id === b.house_id) gain += CFG.SAME_HOUSE_GAIN;
    if (a.role && b.role && a.role === b.role && a.role !== 'idle') gain += CFG.SAME_ROLE_GAIN;
    // Happiness multiplier (both citizens contribute)
    const avgHappiness = (_happiness(a, ctx) + _happiness(b, ctx)) / 2;
    gain *= 1 + (Math.max(0, avgHappiness - 40) / 100) * CFG.HAPPINESS_MULT;
    // Happening bonding modifier (e.g. a lantern festival brings folk together).
    gain *= Math.max(0.1, 1 + (ctx.hMods.bonding || 0));
    gain = Math.max(0, gain);

    const rel = sim.rels[key] || (sim.rels[key] = { citizen_a_id: a.id, citizen_b_id: b.id, score: 0, state: 'strangers', gain: 0, isNew: true });
    const before = scoreToState(Math.floor(rel.score + rel.gain));
    rel.gain += gain;
    const after = scoreToState(Math.floor(Math.min(100, rel.score + rel.gain)));
    if (before !== after && after === 'close' && rel.state !== 'partners') {
      sim.events.push({ type: 'close_bond', at: ctx.at, ids: [a.id, b.id], message: `${_name(a)} and ${_name(b)} have grown close.` });
    }
    if (before !== after && after === 'bonded' && rel.state !== 'partners') {
      sim.events.push({ type: 'bond_formed', at: ctx.at, ids: [a.id, b.id], message: `${_name(a)} and ${_name(b)} share a strong bond.` });
    }
  }
}

// ── Step 2: Quest relationship bonuses ────────
// Called externally when a quest is collected to award bonus to participants
async function awardQuestRelationshipBonus(settlementId, citizenIds) {
  if (!citizenIds || citizenIds.length < 2) return;
  for (let i = 0; i < citizenIds.length; i++) {
    for (let j = i + 1; j < citizenIds.length; j++) {
      const aId = Math.min(citizenIds[i], citizenIds[j]);
      const bId = Math.max(citizenIds[i], citizenIds[j]);
      await query(
        `INSERT INTO citizen_relationships
           (settlement_id, citizen_a_id, citizen_b_id, score, state, shared_quest_count)
         VALUES ($1,$2,$3,$4,'acquaintances',1)
         ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE
           SET score = LEAST(100, citizen_relationships.score + $4),
               shared_quest_count = citizen_relationships.shared_quest_count + 1,
               state = CASE WHEN citizen_relationships.score + $4 >= 90 THEN 'bonded'
                            WHEN citizen_relationships.score + $4 >= 75 THEN 'bonded'
                            WHEN citizen_relationships.score + $4 >= 60 THEN 'close'
                            WHEN citizen_relationships.score + $4 >= 40 THEN 'friends'
                            WHEN citizen_relationships.score + $4 >= 20 THEN 'acquaintances'
                            ELSE 'strangers' END,
               last_updated = NOW()`,
        [settlementId, aId, bId, CFG.QUEST_BONUS]
      );
    }
  }
}

// ── Step 3 (hourly): partnership formation ────
function _hourPartnerships(sim, ctx) {
  for (const [a, b] of sim.pairs) {
    if (a.partner_id || b.partner_id) continue;
    const rel = sim.rels[`${a.id}_${b.id}`];
    if (!rel || Math.min(100, rel.score + rel.gain) < CFG.PARTNER_SCORE_THRESHOLD) continue;
    if (_happiness(a, ctx) < CFG.PARTNER_MIN_HAPPINESS || _happiness(b, ctx) < CFG.PARTNER_MIN_HAPPINESS) continue;
    if (Math.random() > CFG.PARTNER_FORM_CHANCE) continue;
    a.partner_id = b.id;
    b.partner_id = a.id;
    rel.state = 'partners';
    sim.newPartners.push([a, b]);
    sim.events.push({ type: 'partnership', at: ctx.at, ids: [a.id, b.id], message: `${_name(a)} and ${_name(b)} have become partners. 💕` });
  }
}

// ── Step 4 (hourly): breeding ─────────────────
// Partnered opposite-gender adults sharing a house with room for a child.
function _hourBreeding(sim, ctx) {
  for (const [a, b] of sim.pairs) {
    if (a.partner_id !== b.id || a.gender === b.gender) continue;
    if (!a.house_id || a.house_id !== b.house_id) continue;
    const house = sim.houses[a.house_id];
    if (!house || house.occupants >= house.capacity) continue;

    const happA = _happiness(a, ctx), happB = _happiness(b, ctx);
    if (happA < CFG.BREED_MIN_HAPPINESS || happB < CFG.BREED_MIN_HAPPINESS) continue;

    let chance = CFG.BREED_BASE_CHANCE;
    chance += ctx.season.birthChanceBonus || 0;               // season bonus
    chance += ctx.hMods.birth_chance || 0;                    // Happening birth-chance modifier
    chance += Math.floor(((happA + happB) / 2 - CFG.BREED_MIN_HAPPINESS) / 10) * CFG.BREED_HAPPY_BONUS;
    // Fertile trait bonus (hidden trait)
    if ((a.hidden_traits || []).includes('fertile') || (b.hidden_traits || []).includes('fertile')) chance += CFG.BREED_FERTILE_BONUS;
    chance = Math.min(0.35, Math.max(0, chance)); // cap at 35%
    if (Math.random() > chance) continue;

    house.occupants++;
    sim.births.push({ at: ctx.at, house, pair: {
      id_a: a.id, name_a: a.name, id_b: b.id, name_b: b.name,
      gen_a: a.generation, gen_b: b.generation,
      traits_a: a.visible_traits, traits_b: b.visible_traits,
      stats_a: a.stats, stats_b: b.stats, skills_a: a.skills, skills_b: b.skills,
      house_a: a.house_id,
    } });
  }
}

// One write pass after the hourly loop. Score gains are summed over the
// whole catch-up and rounded at random (score is an INTEGER column), so
// sub-1 hourly gains still add up on average instead of being floored away.
async function _persistSimState(settlementId, sim) {
  for (const rel of Object.values(sim.rels)) {
    if (!(rel.gain > 0) && !rel.isNew && rel.state !== 'partners') continue;
    const total = rel.score + rel.gain;
    const newScore = Math.min(100, Math.floor(total) + (Math.random() < total - Math.floor(total) ? 1 : 0));
    const newState = rel.state === 'partners' ? 'partners' : scoreToState(newScore);
    if (rel.isNew) {
      await query(
        `INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (citizen_a_id, citizen_b_id) DO NOTHING`,
        [settlementId, rel.citizen_a_id, rel.citizen_b_id, newScore, newState]
      );
    } else if (newScore !== rel.score || newState !== rel.state) {
      await query(
        'UPDATE citizen_relationships SET score = $1, state = $2, last_updated = NOW() WHERE id = $3',
        [newScore, newState, rel.id]
      );
    }
  }
  for (const [a, b] of sim.newPartners) {
    await query('UPDATE citizens SET partner_id = $1 WHERE id = $2', [b.id, a.id]);
    await query('UPDATE citizens SET partner_id = $1 WHERE id = $2', [a.id, b.id]);
  }
  for (const e of sim.events) await _addEvent(settlementId, e.type, e.message, e.ids, e.at);
  for (const birth of sim.births) await _createChild(settlementId, birth.pair, birth.at, birth.house.name);
}

// ── Step 5: Child creation ────────────────────

async function _createChild(settlementId, pair, atMs = null, houseNameKnown = null) {
  // Determine gender
  const isFemale = Math.random() < 0.5;

  const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

  // Child takes one parent's last name
  const parentLastName = pair.name_a.split(' ')[1] || pair.name_b.split(' ')[1] || 'Woodkin';
  const citMod = require('./citizens');
  const firstName = pickRandom(isFemale ? citMod.FEMALE_NAMES : citMod.MALE_NAMES);
  const childName = `${firstName} ${parentLastName}`;

  // Inherit stats — average of parents with slight randomness
  const statsA = pair.stats_a || {};
  const statsB = pair.stats_b || {};
  const stats = {};
  for (const stat of ['strength','agility','endurance','intelligence','charisma']) {
    const avg = ((statsA[stat] || 8) + (statsB[stat] || 8)) / 2;
    const jitter = Math.round((Math.random() - 0.5) * 4);
    stats[stat] = Math.max(1, Math.min(20, Math.round(avg + jitter)));
  }

  // Inherit skills — slightly lower than parents (child is untrained)
  const skillsA = pair.skills_a || {};
  const skillsB = pair.skills_b || {};
  const skills = {};
  for (const skill of ['farming','woodcutting','fishing','mining','crafting','scouting','combat']) {
    const avgSkill = ((skillsA[skill] || 1) + (skillsB[skill] || 1)) / 2;
    skills[skill] = Math.max(1, Math.round(avgSkill * 0.4 + Math.random() * 1.5));
  }

  // Trait inheritance — small chance only (not a power-building mechanic)
  const inheritedTraits = [];
  const traitsA = pair.traits_a || [];
  const traitsB = pair.traits_b || [];
  if (traitsA.length && Math.random() < 0.25) {
    inheritedTraits.push(traitsA[Math.floor(Math.random() * traitsA.length)]);
  }
  if (traitsB.length && Math.random() < 0.25) {
    const t = traitsB[Math.floor(Math.random() * traitsB.length)];
    if (!inheritedTraits.includes(t)) inheritedTraits.push(t);
  }
  // Small mutation chance — random new trait
  if (Math.random() < 0.08) {
    const citMod2 = require('./citizens'); const VISIBLE_TRAITS = citMod2.VISIBLE_TRAITS;
    const mutant = VISIBLE_TRAITS[Math.floor(Math.random() * VISIBLE_TRAITS.length)];
    if (!inheritedTraits.includes(mutant.id)) inheritedTraits.push(mutant.id);
  }

  const life = {
    age: 0,
    health: 80 + Math.round(Math.random() * 15),
    happiness: 75,
    hunger: 20,
    energy: 90,
  };

  const generation = Math.max(pair.gen_a || 1, pair.gen_b || 1) + 1;

  const result = await query(
    `INSERT INTO citizens
       (settlement_id, name, gender, generation, role, stats, skills, life,
        repro, visible_traits, hidden_traits, house_id, life_stage, parent_ids)
     VALUES ($1,$2,$3,$4,'idle',$5,$6,$7,$8,$9,$10,$11,'child',$12)
     RETURNING id`,
    [
      settlementId,
      childName,
      isFemale ? 'female' : 'male',
      generation,
      JSON.stringify(stats),
      JSON.stringify(skills),
      JSON.stringify(life),
      JSON.stringify({ fertility: 50, genetic_quality: 60, compatibility: 50 }),
      JSON.stringify(inheritedTraits),
      JSON.stringify([]),
      pair.house_a,
      JSON.stringify([pair.id_a, pair.id_b]),
    ]
  );

  const childId = result.rows[0]?.id;

  // House name for the event
  let houseName = houseNameKnown;
  if (!houseName) {
    const houseRes = await query('SELECT name FROM houses WHERE id = $1', [pair.house_a]);
    houseName = houseRes.rows[0]?.name || 'a Willow Hut';
  }

  const babyGender = isFemale ? 'daughter' : 'son';
  await _addEvent(settlementId, 'child_born',
    `New beginnings — ${pair.name_a} and ${pair.name_b} welcome a ${babyGender} into the world. 🍼 May ${childName} grow strong in ${houseName}.`,
    [pair.id_a, pair.id_b, childId], atMs
  );
}

// ── Events ────────────────────────────────────

// atMs: when it happened (catch-up events are back-dated to their hour).
async function _addEvent(settlementId, type, message, citizenIds = [], atMs = null) {
  await query(
    `INSERT INTO settlement_events (settlement_id, type, message, citizen_ids, created_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))`,
    [settlementId, type, message, JSON.stringify(citizenIds), atMs ? new Date(Math.min(atMs, Date.now())).toISOString() : null]
  );
}

// ── Helpers ───────────────────────────────────

function _name(citizen) {
  return citizen?.name || 'Unknown';
}

module.exports = { runSimulation, awardQuestRelationshipBonus, _createChild, CFG, SIM_MAX_CATCHUP_HOURS,
  _hourly: { relationships: _hourRelationships, partnerships: _hourPartnerships, breeding: _hourBreeding } };
