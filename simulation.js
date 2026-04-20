// ══════════════════════════════════════════════
//  RELATIONSHIP / BONDING / BREEDING SIMULATION
//  Kindlewood — runs inside the settlement tick
// ══════════════════════════════════════════════

const { query } = require('./db');
const { getCurrentSeason } = require('./seasons');
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
// Called from within game.js applyTick gated by last_sim_tick
async function runSimulation(settlement, hoursElapsed) {
  if (hoursElapsed < CFG.SIM_TICK_HOURS) return;

  const settlementId = settlement.id;

  // Load all adult citizens with their current state
  const citizenRes = await query(
    `SELECT c.*, h.id as house_id_val
     FROM citizens c
     LEFT JOIN houses h ON c.house_id = h.id
     WHERE c.settlement_id = $1`,
    [settlementId]
  );
  const citizens = citizenRes.rows;
  const adults = citizens.filter(c => (c.life_stage || 'adult') === 'adult');

  if (adults.length < 2) return;

  // Update relationship scores
  await _updateRelationships(settlementId, adults);

  // Check partnership formation
  await _checkPartnerships(settlementId, adults);

  // Check breeding
  await _checkBreeding(settlementId, citizens, adults);

  // Update last_sim_tick
  await query(
    'UPDATE settlements SET last_sim_tick = NOW() WHERE id = $1',
    [settlementId]
  );
}

// ── Step 1: Update relationship scores ────────

async function _updateRelationships(settlementId, adults) {
  const season = getCurrentSeason();

  // Build lookup: citizen_id -> citizen
  const byId = {};
  for (const c of adults) byId[c.id] = c;

  // Get all current relationship pairs for this settlement
  const relRes = await query(
    'SELECT * FROM citizen_relationships WHERE settlement_id = $1',
    [settlementId]
  );
  const relMap = {};
  for (const r of relRes.rows) {
    relMap[`${r.citizen_a_id}_${r.citizen_b_id}`] = r;
  }

  // Build pairs (canonical: lower id first)
  const pairs = [];
  for (let i = 0; i < adults.length; i++) {
    for (let j = i + 1; j < adults.length; j++) {
      pairs.push([adults[i], adults[j]]);
    }
  }

  for (const [a, b] of pairs) {
    const aId = Math.min(a.id, b.id);
    const bId = Math.max(a.id, b.id);
    const key = `${aId}_${bId}`;
    const existing = relMap[key];

    // Calculate gain
    let gain = CFG.BASE_PROXIMITY;

    // Same house bonus
    if (a.house_id && b.house_id && a.house_id === b.house_id) {
      gain += CFG.SAME_HOUSE_GAIN;
    }

    // Same role bonus
    if (a.role && b.role && a.role === b.role && a.role !== 'idle') {
      gain += CFG.SAME_ROLE_GAIN;
    }

    // Happiness multiplier (both citizens contribute)
    const avgHappiness = ((a.life?.happiness ?? 70) + (b.life?.happiness ?? 70)) / 2;
    const happMult = 1 + (Math.max(0, avgHappiness - 40) / 100) * CFG.HAPPINESS_MULT;
    gain = gain * happMult;

    // Cap and round
    gain = Math.max(0, gain);

    const newScore = Math.min(100, (existing?.score ?? 0) + gain);
    const newState = scoreToState(Math.floor(newScore));

    if (existing) {
      const prevState = existing.state;
      await query(
        `UPDATE citizen_relationships
         SET score = $1, state = $2, last_updated = NOW()
         WHERE id = $3`,
        [Math.floor(newScore), newState, existing.id]
      );
      // Fire event if state improved meaningfully
      if (prevState !== newState && newState === 'close') {
        await _addEvent(settlementId, 'close_bond',
          `${_name(byId[aId])} and ${_name(byId[bId])} have grown close.`,
          [aId, bId]);
      }
      if (prevState !== newState && newState === 'bonded') {
        await _addEvent(settlementId, 'bond_formed',
          `${_name(byId[aId])} and ${_name(byId[bId])} share a strong bond.`,
          [aId, bId]);
      }
    } else {
      await query(
        `INSERT INTO citizen_relationships
           (settlement_id, citizen_a_id, citizen_b_id, score, state)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (citizen_a_id, citizen_b_id) DO NOTHING`,
        [settlementId, aId, bId, Math.floor(newScore), newState]
      );
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

// ── Step 3: Partnership formation ─────────────

async function _checkPartnerships(settlementId, adults) {
  // Find pairs at 'bonded' or near-partners who are both unpartnered adults
  const eligibleRels = await query(
    `SELECT cr.*, 
            ca.name as name_a, ca.gender as gender_a, ca.partner_id as partner_a,
            ca.life as life_a,
            cb.name as name_b, cb.gender as gender_b, cb.partner_id as partner_b,
            cb.life as life_b
     FROM citizen_relationships cr
     JOIN citizens ca ON cr.citizen_a_id = ca.id
     JOIN citizens cb ON cr.citizen_b_id = cb.id
     WHERE cr.settlement_id = $1
       AND cr.score >= $2
       AND ca.partner_id IS NULL
       AND cb.partner_id IS NULL
       AND (ca.life->>'happiness')::int >= $3
       AND (cb.life->>'happiness')::int >= $3`,
    [settlementId, CFG.PARTNER_SCORE_THRESHOLD, CFG.PARTNER_MIN_HAPPINESS]
  );

  for (const rel of eligibleRels.rows) {
    // Random chance per tick
    if (Math.random() > CFG.PARTNER_FORM_CHANCE) continue;

    // Form partnership (bidirectional)
    await query(
      'UPDATE citizens SET partner_id = $1 WHERE id = $2',
      [rel.citizen_b_id, rel.citizen_a_id]
    );
    await query(
      'UPDATE citizens SET partner_id = $1 WHERE id = $2',
      [rel.citizen_a_id, rel.citizen_b_id]
    );
    await query(
      "UPDATE citizen_relationships SET state = 'partners' WHERE id = $1",
      [rel.id]
    );

    await _addEvent(settlementId, 'partnership',
      `${rel.name_a} and ${rel.name_b} have become partners. 💕`,
      [rel.citizen_a_id, rel.citizen_b_id]
    );
  }
}

// ── Step 4: Breeding ──────────────────────────

async function _checkBreeding(settlementId, citizens, adults) {
  const season = getCurrentSeason();

  // Find partnered male+female pairs who share a house
  const breedPairs = await query(
    `SELECT ca.id as id_a, ca.name as name_a, ca.gender as gender_a,
            ca.life as life_a, ca.hidden_traits as hidden_a,
            ca.house_id as house_a,
            cb.id as id_b, cb.name as name_b, cb.gender as gender_b,
            cb.life as life_b, cb.hidden_traits as hidden_b,
            ca.generation as gen_a, cb.generation as gen_b,
            ca.visible_traits as traits_a, cb.visible_traits as traits_b,
            ca.stats as stats_a, cb.stats as stats_b,
            ca.skills as skills_a, cb.skills as skills_b,
            h.capacity as house_cap
     FROM citizens ca
     JOIN citizens cb ON ca.partner_id = cb.id
     JOIN houses h ON ca.house_id = h.id
     WHERE ca.settlement_id = $1
       AND ca.life_stage = 'adult'
       AND cb.life_stage = 'adult'
       AND ca.gender != cb.gender
       AND ca.house_id IS NOT NULL
       AND ca.house_id = cb.house_id
       AND ca.id < cb.id`,
    [settlementId]
  );

  for (const pair of breedPairs.rows) {
    // Check house has capacity for a child
    const occupantsRes = await query(
      'SELECT COUNT(*) FROM citizens WHERE house_id = $1',
      [pair.house_a]
    );
    const occupants = parseInt(occupantsRes.rows[0].count);
    if (occupants >= pair.house_cap) continue;

    // Happiness check
    const happA = pair.life_a?.happiness ?? 70;
    const happB = pair.life_b?.happiness ?? 70;
    if (happA < CFG.BREED_MIN_HAPPINESS || happB < CFG.BREED_MIN_HAPPINESS) continue;

    // Build breed chance
    let chance = CFG.BREED_BASE_CHANCE;

    // Season bonus
    chance += season.birthChanceBonus || 0;

    // Happiness bonus
    const avgHappy = (happA + happB) / 2;
    chance += Math.floor((avgHappy - CFG.BREED_MIN_HAPPINESS) / 10) * CFG.BREED_HAPPY_BONUS;

    // Fertile trait bonus (hidden trait)
    const hiddenA = pair.hidden_a || [];
    const hiddenB = pair.hidden_b || [];
    if (hiddenA.includes('fertile') || hiddenB.includes('fertile')) {
      chance += CFG.BREED_FERTILE_BONUS;
    }

    chance = Math.min(0.35, Math.max(0, chance)); // cap at 35%

    if (Math.random() > chance) continue;

    // Create child!
    await _createChild(settlementId, pair);
  }
}

// ── Step 5: Child creation ────────────────────

async function _createChild(settlementId, pair) {
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

  // Find house name for event
  const houseRes = await query('SELECT name FROM houses WHERE id = $1', [pair.house_a]);
  const houseName = houseRes.rows[0]?.name || 'a Willow Hut';

  await _addEvent(settlementId, 'child_born',
    `A child has been born to ${pair.name_a} and ${pair.name_b} in ${houseName}. 🍼 Welcome, ${childName}!`,
    [pair.id_a, pair.id_b, childId]
  );
}

// ── Events ────────────────────────────────────

async function _addEvent(settlementId, type, message, citizenIds = []) {
  await query(
    `INSERT INTO settlement_events (settlement_id, type, message, citizen_ids)
     VALUES ($1, $2, $3, $4)`,
    [settlementId, type, message, JSON.stringify(citizenIds)]
  );
}

// ── Helpers ───────────────────────────────────

function _name(citizen) {
  return citizen?.name || 'Unknown';
}

module.exports = { runSimulation, awardQuestRelationshipBonus };
