// ══════════════════════════════════════════════════════════════════════════
//  combat_resolver — who walks into a battle, and how they come out of it.
//
//  Two things every battle on the board needs from the town (lib/tactics_*):
//
//    partyUnits(ids, mods)   the citizens as fighters (lib/citizen_unit.js),
//                            with what ails them, what they wear and any
//                            Happening counted in. `mods` is frozen when a
//                            fight is triggered, so a battle begun today and
//                            finished tomorrow is fought with the same party.
//    combatModsOf, withParty how those frozen modifiers are made.
//
//    applyBattleAftermath    the injury rolls after a battle: lost, everyone
//                            rolls; won, whoever was down at the end.
//    applyRunAftermath       the same for a dungeon run, rolled once at its end.
//    rollInjuryFor           one roll on the injury table (lib/injury_table.js).
//
//  The card battler lived here too (replaying and deciding card battles)
//  until it was removed on 2026-11-26 (docs/TACTICS.md §8). A battle is now
//  played, decided and stored by lib/tactics_battles.js and
//  lib/tactics_quests.js.
// ══════════════════════════════════════════════════════════════════════════

const U = require('./citizen_unit');
const { query } = require('../db');
const { writeDeathEvent } = require('../deaths'); // shared death pipeline (also used by famine.js)

// ── Happening combat modifiers (spec 021) ─────────────────────────────────
// Only these stats apply to battles. The caller freezes them when the
// encounter starts (settlement_quests.combat_mods), so the battle is fought
// with the numbers of the moment it began.
const COMBAT_MOD_KEYS = ['enemy_health', 'enemy_strength', 'enemy_agility', 'party_strength', 'party_agility', 'party_endurance'];
// `party` (careers, below) survives only when stamped PARTY_V.
const PARTY_V = 2;
function combatModsOf(mods) {
  const out = {};
  for (const k of COMBAT_MOD_KEYS) if (mods && mods[k]) out[k] = mods[k];
  if (mods && mods.party && Number(mods.party_v) >= PARTY_V) { out.party = mods.party; out.party_v = mods.party_v; }
  return Object.keys(out).length ? out : null;
}

// The citizens as fighters: [{ id, name, role, unit }].
async function partyUnits(citizenIds, mods) {
  const citizens = await _loadCitizens(citizenIds, combatModsOf(mods));
  return citizens.map(c => { const u = U.unitFromCitizen(c); u.charisma = Number((c.stats || {}).charisma) || 8; return { id: c.id, name: c.name, role: c.role, unit: u }; });
}
// Full health of each citizen as a battle with these mods would build them: [{ id, name, maxHp }].
// The dungeon path screen and rest rooms use it.
async function partyHealth(citizenIds, mods) {
  const citizens = await _loadCitizens(citizenIds, combatModsOf(mods));
  return citizens.map(c => ({ id: c.id, name: c.name, maxHp: U.unitFromCitizen(c).maxHp }));
}


// Careers: per-citizen stat/skill changes (perks, gear) and equipped weapon
// and armour, frozen with the battle's mods under `party` so every replay
// uses the same numbers: { citizenId: { strength, agility, endurance, combat,
// weapon: { dice, bonus, name }, armour } }.
function withParty(mods, party) {
  if (!party || !Object.keys(party).length) return mods;
  return { ...(mods || {}), party, party_v: PARTY_V };
}

async function _loadCitizens(citizenIds, mods) {
  if (!citizenIds || !citizenIds.length) return [];
  const r = await query(
    'SELECT id, name, role, life_stage, stats, skills, visible_traits, hidden_traits FROM citizens WHERE id = ANY($1)',
    [citizenIds]
  );
  const citizens = r.rows;

  // Fold in active condition modifiers so injured citizens fight worse.
  // We do this once per battle load (not per replay frame) — the conditions
  // are presumed stable for the duration of a single combat. For long-lived
  // manual battles, this means an injury that expires mid-battle won't kick
  // in until the next fight. Acceptable for now.
  const condRows = await query(
    `SELECT citizen_id, stat_modifiers FROM citizen_conditions
     WHERE citizen_id = ANY($1)
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [citizenIds]
  ).catch(() => ({ rows: [] }));

  // Group by citizen
  const modsByCit = {};
  for (const row of condRows.rows) {
    const m = row.stat_modifiers || {};
    if (!modsByCit[row.citizen_id]) modsByCit[row.citizen_id] = {};
    for (const [k, v] of Object.entries(m)) {
      modsByCit[row.citizen_id][k] = (modsByCit[row.citizen_id][k] || 0) + v;
    }
  }

  // Apply: stats fields are { strength, agility, endurance, intelligence, charisma }
  // Skills fields include 'combat'. The injury table can hit either; we apply
  // to whichever side the key belongs to. APPLY_CAP_FLOOR_PCT floors stats so
  // a heavily-scarred citizen never drops below 50% of their base.
  for (const cit of citizens) {
    const mods = modsByCit[cit.id];
    if (!mods) continue;
    const stats = { ...(cit.stats || {}) };
    const skills = { ...(cit.skills || {}) };
    for (const [key, delta] of Object.entries(mods)) {
      if (key in stats) {
        const base = stats[key];
        const floor = Math.floor(base * APPLY_CAP_FLOOR_PCT);
        stats[key] = Math.max(floor, base + delta);
      } else if (key in skills) {
        // Skills floor at 1 — losing combat down to 0 makes the citizen
        // useless and the math edge-cases compound.
        skills[key] = Math.max(1, (skills[key] || 1) + delta);
      }
    }
    cit.stats = stats;
    cit.skills = skills;
  }

  // Careers (frozen per battle): perks and gear.
  if (mods && mods.party) {
    for (const cit of citizens) {
      const d = mods.party[cit.id] || mods.party[String(cit.id)];
      if (!d) continue;
      const stats = { ...(cit.stats || {}) }, skills = { ...(cit.skills || {}) };
      for (const [k, v] of Object.entries(d)) {
        if (k === 'weapon') cit.weapon = v;
        else if (k === 'armour') cit.armour = Number(v) || 0;
        else if (k === 'combat') skills.combat = Math.max(1, (Number(skills.combat) || 1) + v);
        else stats[k] = Math.max(1, (Number(stats[k]) || 1) + v);
      }
      cit.stats = stats; cit.skills = skills;
    }
  }

  // Happening party_* modifiers: flat, floored at 1.
  if (mods) {
    for (const cit of citizens) {
      const stats = { ...(cit.stats || {}) };
      if (mods.party_strength) stats.strength = Math.max(1, (stats.strength || 1) + mods.party_strength);
      if (mods.party_agility) stats.agility = Math.max(1, (stats.agility || 1) + mods.party_agility);
      if (mods.party_endurance) stats.endurance = Math.max(1, (stats.endurance || 1) + mods.party_endurance);
      cit.stats = stats;
    }
  }

  return citizens;
}



// (The autoResolveBattle export above stays; the module.exports up top
// already lists everything in one place.)

// ══════════════════════════════════════════════════════════════════════════
//  AFTERMATH — injuries, deaths, scars
//
//  Called by both /resolve (manual battles) and processCombatTriggers
//  (auto-resolves) after a battle's outcome is locked in. Decides who rolls,
//  what they roll, and writes the resulting events + conditions.
//
//  Design notes:
//    - Defeat: every PARTICIPATING citizen rolls. Even survivors get hit
//      because the party was driven from the field.
//    - Pyrrhic victory: only FALLEN (downed) citizens roll. Healthy
//      survivors walk away clean.
//    - Clean victory: nobody rolls.
//    - The roll uses Math.random — not the seeded battle RNG — so injury
//      results don't accidentally become deterministic from the seed.
//      Cosmetically: a player who restarts hoping for a "better death" can't.
// ══════════════════════════════════════════════════════════════════════════

const INJURY_TABLE = require('./injury_table');

// Total accumulated stat-modifier debuffs are capped so a heavily-scarred
// citizen never goes below this fraction of their base stats. Without a
// floor, six crippling injuries would zero them out and make them a
// permanent burden — narratively interesting in small doses, frustrating
// in large ones. Tune in playtesting.
const APPLY_CAP_FLOOR_PCT = 0.5;

// Weighted random pick from an array of { weight, ... } objects.
function _pickWeighted(items) {
  const total = items.reduce((s, it) => s + (it.weight || 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= (it.weight || 1);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function _findBand(roll) {
  for (const band of INJURY_TABLE.BANDS) {
    if (roll >= band.min && roll <= band.max) return band;
  }
  return INJURY_TABLE.BANDS[INJURY_TABLE.BANDS.length - 1];
}

function _interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? vars[k] : '');
}

// Public: compute a single injury roll for one citizen, given the trait
// modifiers and prior injury count. Returns the rolled band + body part +
// modifier choice but does NOT touch the DB. Useful for previewing or for
// dev-tool admin inflictions.
//
// Modifier handling note: we deliberately clamp the modified roll into
// [1, 98] so modifiers can push citizens toward crippling but cannot push
// them into the fatal band. Death requires an UNMODIFIED roll of 99-100.
// Without this carve-out, even a small +12 modifier (a frail citizen) ends
// up with ~14% death rate because all rolls of 88+ would clamp to 100.
// This way, frail/elder/prior-injury status make every other outcome more
// likely (crippling, scar, wound) without making death a near-certainty.
function rollInjuryFor({ traits = [], life_stage = 'adult', prior_permanent_injuries = 0, extra_modifier = 0, no_fatal = false } = {}) {
  const baseRoll = 1 + Math.floor(Math.random() * 100);

  // Natural-fatal carve-out: an unmodified roll of 99 or 100 is fatal
  // regardless of any negative modifiers. This makes death an act of fate,
  // not a function of accumulated misfortune.
  // no_fatal (a dungeon citizen who went down and was stood back up,
  // docs/DUNGEONS.md §3.2): the roll tops out at crippling.
  const naturalFatal = baseRoll >= 99 && !no_fatal;

  let modifier = 0;
  for (const t of traits) {
    const m = INJURY_TABLE.ROLL_MODIFIERS.traits[t];
    if (m) modifier += m;
  }
  const ageMod = INJURY_TABLE.ROLL_MODIFIERS.life_stage[life_stage];
  if (ageMod) modifier += ageMod;
  const priorMod = Math.min(
    INJURY_TABLE.ROLL_MODIFIERS.max_prior_injury_modifier,
    prior_permanent_injuries * INJURY_TABLE.ROLL_MODIFIERS.per_prior_permanent_injury
  );
  modifier += priorMod;
  modifier += Number(extra_modifier) || 0;   // careers: perks, gear, traits

  // Clamp final roll. The upper bound is 98 (top of crippling) unless this
  // is a natural-fatal roll; in that case we let it reach 99-100.
  const upperCap = naturalFatal ? 100 : 98;
  const finalRoll = Math.max(1, Math.min(upperCap, baseRoll + modifier));
  const band = _findBand(finalRoll);

  const part = _pickWeighted(INJURY_TABLE.BODY_PARTS).key;
  const severityCfg = INJURY_TABLE.SEVERITY_EFFECTS[band.severity];
  const modifiers = severityCfg ? (severityCfg.modifiers_by_part[part] || {}) : {};
  const heal_days = severityCfg ? severityCfg.heal_days : null;

  return {
    base_roll: baseRoll,
    modifier,
    final_roll: finalRoll,
    severity: band.severity,
    body_part: part,
    stat_modifiers: { ...modifiers },
    heal_days,
  };
}

// Look up how many *permanent* injuries a citizen already carries. Used to
// escalate roll modifiers. Permanent = severity in ('scar','crippling').
async function _countPriorPermanentInjuries(citizenId) {
  const r = await query(
    `SELECT COUNT(*)::int AS c FROM citizen_events
     WHERE citizen_id=$1 AND event_type='injury'
       AND severity IN ('scar','crippling')`,
    [citizenId]
  );
  return (r.rows[0] && r.rows[0].c) || 0;
}

// Pick one enemy name from the battle for narrative templating. We prefer
// the enemy that landed the killing blow if we can identify them in the
// log, otherwise fall back to the first enemy in the encounter.
function _narrativeEnemyName(battle, encounterKeys) {
  if (battle && Array.isArray(battle.units)) {
    const e = battle.units.find(u => u.side === 'enemy');
    if (e && e.name) return e.name;
  }
  if (Array.isArray(encounterKeys) && encounterKeys.length) {
    return encounterKeys[0].replace(/_/g, ' ');
  }
  return 'the enemy';
}

// Write a single injury to the DB. Returns the inserted event row (for the
// frontend resolution screen to show).
async function _writeInjury({ citizen, settlementId, questRunId, battle, encounter, injury }) {
  // 'none' severity = no event, no condition. The citizen walked away clean.
  if (injury.severity === 'none') {
    return null;
  }

  const enemyName = _narrativeEnemyName(battle, encounter);
  const narrative = _interpolate(
    _pickWeighted(
      INJURY_TABLE.NARRATIVES[injury.severity].map(t => ({ text: t, weight: 1 }))
    ).text,
    { name: citizen.name, part: injury.body_part, enemy: enemyName }
  ).replace(/^./, c => c.toUpperCase());      // a line may begin with the enemy ("a Boar Bruiser caught …")

  // ── Careers: Guardian armour (Armorer's Bulwark) takes a killing blow
  //    once and shatters; the wearer walks away scarred instead.
  if (injury.severity === 'fatal') {
    const guard = (await query(
      `SELECT id, name FROM inventory_items WHERE equipped_to = $1 AND equip_slot = 'armour' AND metadata->>'guardian' = 'true' LIMIT 1`,
      [citizen.id]).catch(() => ({ rows: [] }))).rows[0];
    if (guard) {
      await query('DELETE FROM inventory_items WHERE id = $1', [guard.id]);
      const saved = `${citizen.name}'s ${guard.name} took a killing blow from the ${enemyName} and shattered — ${citizen.name} lives.`;
      const ev = await query(
        `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id, meta)
         VALUES ($1,$2,'injury','scar',$3,$4,$5,$6) RETURNING *`,
        [citizen.id, settlementId, injury.body_part, saved, questRunId, JSON.stringify({ guardian: guard.name })]);
      return ev.rows[0];
    }
  }

  // ── Fatal: mark citizen deceased and write a death event. No condition.
  //    Routed through the shared writer (deaths.js) so combat and
  //    starvation deaths use one pipeline; cause='combat' distinguishes
  //    them (famine.js writes cause='starvation').
  if (injury.severity === 'fatal') {
    return await writeDeathEvent({
      citizenId: citizen.id,
      settlementId,
      cause: 'combat',
      narrative,
      severity: injury.severity,
      bodyPart: injury.body_part,
      sourceBattleId: questRunId,
    });
  }

  // ── All other severities: write the event log first.
  const evRes = await query(
    `INSERT INTO citizen_events (citizen_id, settlement_id, event_type, severity, body_part, narrative, source_battle_id)
     VALUES ($1,$2,'injury',$3,$4,$5,$6) RETURNING *`,
    [citizen.id, settlementId, injury.severity, injury.body_part, narrative, questRunId]
  );
  const event = evRes.rows[0];

  // ── For scratches/wounds/cripplings, create the active condition. Scars
  //    are permanent narrative with no stat impact — no condition row.
  const hasStatImpact = Object.keys(injury.stat_modifiers || {}).length > 0;
  if (hasStatImpact) {
    const expiresAt = injury.heal_days != null
      ? new Date(Date.now() + injury.heal_days * 86400 * 1000).toISOString()
      : null;
    await query(
      `INSERT INTO citizen_conditions (citizen_id, condition_type, body_part, severity, stat_modifiers, expires_at, source_event_id)
       VALUES ($1,'injury',$2,$3,$4,$5,$6)`,
      [citizen.id, injury.body_part, injury.severity, JSON.stringify(injury.stat_modifiers), expiresAt, event.id]
    );
  }

  return event;
}

// ── Main entry: process an entire battle's aftermath. ────────────────────
//
// Arguments:
//   battle       — engine-state of the resolved battle (post-final-turn)
//   outcome      — 'victory' | 'defeat'
//   settlementId — for event-row foreign keys
//   questRunId   — references settlement_quests.id; nullable for test battles
//   encounter    — array of enemy keys, used to pick a narrative villain
//
// Returns: array of inserted citizen_events rows (for the resolution screen).
async function applyBattleAftermath({ battle, outcome, settlementId, questRunId, encounter }) {
  if (!battle || !Array.isArray(battle.units)) return [];

  const playerUnits = battle.units.filter(u => u.side === 'player');
  // Decide who rolls based on outcome shape.
  let toRoll;
  if (outcome === 'defeat') {
    // All participants. The party was routed; everyone took hits.
    toRoll = playerUnits;
  } else if (outcome === 'victory') {
    // Only the fallen. Clean survivors walk away unscathed.
    toRoll = playerUnits.filter(u => u.flags && u.flags.downed);
    if (toRoll.length === 0) return [];   // clean victory, nobody rolls
  } else {
    return [];
  }

  // Fetch fresh citizen rows (need traits + life_stage). The unit on the
  // battle has stats but not traits.
  const citIds = toRoll.map(u => u.citizen_id).filter(Boolean);
  if (!citIds.length) return [];
  const citRes = await query(
    `SELECT id, name, life_stage, born_at, visible_traits, hidden_traits
     FROM citizens WHERE id = ANY($1)`,
    [citIds]
  );
  const citizens = citRes.rows;
  const events = [];
  const careers = require('./careers');
  const profs = await careers.profilesFor(null, settlementId).catch(() => new Map());

  for (const cit of citizens) {
    // Skip citizens who are already deceased (shouldn't happen, but defensive)
    if (cit.life_stage === 'deceased') continue;

    const traits = [...(cit.visible_traits || []), ...(cit.hidden_traits || [])];
    const priorCount = await _countPriorPermanentInjuries(cit.id);
    const injury = rollInjuryFor({
      traits,
      life_stage: cit.born_at ? require('./life').stageOf(cit) : (cit.life_stage || 'adult'),   // 'elder' at 60+
      prior_permanent_injuries: priorCount,
      extra_modifier: (profs.get(cit.id) || { effects: {} }).effects.injury || 0,
    });

    const event = await _writeInjury({
      citizen: cit,
      settlementId,
      questRunId,
      battle,
      encounter,
      injury,
    });
    if (event) {
      events.push(event);
      careers.recordInjury(settlementId, cit.id).catch(() => {});
    }
  }

  return events;
}

// ── A dungeon run's injuries: rolled once, when the run ends ─────────────
// (docs/DUNGEONS.md §3.2). The run decides who rolls and how:
//   rolls: [{ citizenId, noFatal }]   noFatal for a citizen who went down
//                                     and was stood back up before the end.
// `enemy` (a creature key) names the villain in the injury lines. Returns the
// citizen_events rows written, like applyBattleAftermath.
async function applyRunAftermath({ settlementId, questRunId = null, enemy = null, rolls = [] }) {
  const ids = rolls.map(r => Number(r.citizenId)).filter(Boolean);
  if (!ids.length) return [];
  const citizens = (await query(
    `SELECT id, name, life_stage, born_at, visible_traits, hidden_traits FROM citizens WHERE id = ANY($1)`, [ids])).rows;
  const careers = require('./careers');
  const profs = await careers.profilesFor(null, settlementId).catch(() => new Map());
  const events = [];
  for (const r of rolls) {
    const cit = citizens.find(c => c.id === Number(r.citizenId));
    if (!cit || cit.life_stage === 'deceased') continue;
    const injury = rollInjuryFor({
      traits: [...(cit.visible_traits || []), ...(cit.hidden_traits || [])],
      life_stage: cit.born_at ? require('./life').stageOf(cit) : (cit.life_stage || 'adult'),
      prior_permanent_injuries: await _countPriorPermanentInjuries(cit.id),
      extra_modifier: (profs.get(cit.id) || { effects: {} }).effects.injury || 0,
      no_fatal: !!r.noFatal,
    });
    const event = await _writeInjury({ citizen: cit, settlementId, questRunId, battle: null, encounter: enemy ? [enemy] : [], injury });
    if (event) {
      events.push(event);
      careers.recordInjury(settlementId, cit.id).catch(() => {});
    }
  }
  return events;
}

// ── Active-conditions helper for the engine ─────────────────────────────
// Given a citizen id, return the sum of all currently-active condition
// stat modifiers, with the APPLY_CAP_FLOOR_PCT floor applied. The engine's
// statsFromCitizen sums this in so injured citizens fight worse next time.
//
// This is exposed via module.exports so the engine — and admin tools —
// can use the same calculation.
async function getActiveStatModifiersForCitizen(citizenId, baseStats = {}) {
  const r = await query(
    `SELECT stat_modifiers FROM citizen_conditions
     WHERE citizen_id=$1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [citizenId]
  );

  const totals = {};
  for (const row of r.rows) {
    const mods = row.stat_modifiers || {};
    for (const [key, val] of Object.entries(mods)) {
      totals[key] = (totals[key] || 0) + val;
    }
  }

  // Apply the floor cap per-stat. The cap is: (final stat) cannot go below
  // baseStats[key] * APPLY_CAP_FLOOR_PCT. Find the maximum debuff allowed.
  for (const key of Object.keys(totals)) {
    const base = baseStats[key];
    if (base != null) {
      const floor = Math.floor(base * APPLY_CAP_FLOOR_PCT);
      const minDebuff = floor - base;     // most-negative allowed delta
      if (totals[key] < minDebuff) totals[key] = minDebuff;
    }
  }

  return totals;
}

module.exports = {
  combatModsOf, withParty, partyUnits, partyHealth,
  applyBattleAftermath, applyRunAftermath, rollInjuryFor,
  getActiveStatModifiersForCitizen,
  _writeInjury,   // tests (Guardian armour)
};
