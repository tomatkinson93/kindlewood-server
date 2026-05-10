// ══════════════════════════════════════════════════════════════════════════
//  COMBAT — server-side resolution endpoint
//
//  First pass: small, focused. The browser runs the actual battle (state,
//  damage, AI, all of it) and posts the *outcome* here. Server is the keeper
//  of truth for persistent rewards: settlement wealth + a small combat-skill
//  bump on surviving citizens.
//
//  This kept the MVP a one-endpoint problem. When we add status effects,
//  injuries, or proper XP curves, this is where they hook in.
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Anti-abuse: cap a single battle's reward so a malicious client can't just
// post {wealth_reward: 9999999}. Tunable.
const MAX_BATTLE_WEALTH = 200;
const COMBAT_SKILL_CAP = 10;

// ── Enemy definitions ────────────────────────────────────────────────────
// Default seed roster — kept in sync with the engine's hardcoded fallback so
// that an admin who hits "Seed Defaults" gets back to the original three
// without needing a fresh DB. Add new entries here when introducing new
// stock enemies.
const DEFAULT_ENEMIES = [
  { id: 'marsh_rat',   name: 'Marsh Rat',   icon: '🐀', flavour: 'A scrappy biter, quick on its feet.',
    max_hp: 22, strength: 5, agility: 9,  endurance: 4, combat_skill: 2, attack_verb: 'bites',     reward_weight: 1, sort_order: 10 },
  { id: 'wild_fox',    name: 'Wild Fox',    icon: '🦊', flavour: 'Cunning. Will harry the weakest.',
    max_hp: 30, strength: 7, agility: 11, endurance: 5, combat_skill: 3, attack_verb: 'lunges at', reward_weight: 2, sort_order: 20 },
  { id: 'fungal_toad', name: 'Fungal Toad', icon: '🐸', flavour: 'Slow and bloated, but surprisingly tough.',
    max_hp: 42, strength: 8, agility: 4,  endurance: 9, combat_skill: 2, attack_verb: 'slams into', reward_weight: 3, sort_order: 30 },
];

// ── GET /api/combat/enemies — list all (non-archived by default) ────────
router.get('/enemies', requireAuth, async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1';
    const r = await query(
      'SELECT * FROM enemy_definitions' +
      (includeArchived ? '' : ' WHERE archived = FALSE') +
      ' ORDER BY sort_order ASC, id ASC'
    );
    res.json({ ok: true, enemies: r.rows });
  } catch (e) {
    console.error('list enemies error', e);
    res.status(500).json({ error: e.message });
  }
});

// Validate + sanitise an enemy payload coming from the admin form. Returns
// the cleaned object or throws an Error explaining what's wrong.
function _validateEnemy(body, isNew) {
  if (!body) throw new Error('Empty body.');
  const id = (body.id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (isNew && !id) throw new Error('id is required.');
  const name = (body.name || '').trim();
  if (!name) throw new Error('name is required.');

  const intIn = (v, lo, hi, dflt) => {
    const n = parseInt(v);
    if (isNaN(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  };

  return {
    id,
    name,
    icon:      (body.icon || '👹').slice(0, 8),
    flavour:   (body.flavour || '').slice(0, 280),
    max_hp:        intIn(body.max_hp,        1,   500, 20),
    strength:      intIn(body.strength,      0,   50,  5),
    agility:       intIn(body.agility,       0,   50,  5),
    endurance:     intIn(body.endurance,     0,   50,  5),
    combat_skill:  intIn(body.combat_skill,  0,   20,  1),
    attack_verb:   (body.attack_verb || 'strikes').trim().slice(0, 40),
    reward_weight: intIn(body.reward_weight, 0,   10,  1),
    sort_order:    intIn(body.sort_order,    0,   9999, 100),
  };
}

// ── POST /api/combat/enemies — create new ───────────────────────────────
router.post('/enemies', requireAuth, async (req, res) => {
  try {
    const e = _validateEnemy(req.body, /*isNew=*/true);
    const dupe = await query('SELECT id FROM enemy_definitions WHERE id=$1', [e.id]);
    if (dupe.rows.length) return res.status(400).json({ error: 'An enemy with that id already exists.' });

    await query(
      `INSERT INTO enemy_definitions
       (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
       e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
    );
    res.json({ ok: true, enemy: e });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH /api/combat/enemies/:id — update ──────────────────────────────
router.patch('/enemies/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await query('SELECT id FROM enemy_definitions WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Enemy not found.' });

    const e = _validateEnemy({ ...req.body, id }, /*isNew=*/false);

    await query(
      `UPDATE enemy_definitions SET
         name=$1, icon=$2, flavour=$3, max_hp=$4, strength=$5, agility=$6,
         endurance=$7, combat_skill=$8, attack_verb=$9, reward_weight=$10,
         sort_order=$11, updated_at=NOW()
       WHERE id=$12`,
      [e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility,
       e.endurance, e.combat_skill, e.attack_verb, e.reward_weight,
       e.sort_order, id]
    );
    res.json({ ok: true, enemy: { ...e, id } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/combat/enemies/:id — soft delete (archive) ──────────────
// We never hard-delete: an enemy id may be referenced in old battle logs or
// future encounter tables, so flipping `archived` keeps history intact while
// hiding it from the active roster. A second DELETE call hard-deletes if the
// enemy was already archived (escape hatch for cleanup).
router.delete('/enemies/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const r = await query('SELECT archived FROM enemy_definitions WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Enemy not found.' });
    if (r.rows[0].archived) {
      await query('DELETE FROM enemy_definitions WHERE id=$1', [id]);
      return res.json({ ok: true, deleted: true });
    }
    await query('UPDATE enemy_definitions SET archived=TRUE WHERE id=$1', [id]);
    res.json({ ok: true, archived: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/combat/enemies/seed — insert defaults (idempotent) ────────
// Only inserts rows whose id isn't already present, so an admin who has
// customised an existing enemy won't have their changes overwritten. Use
// `?force=1` to re-overwrite all defaults (resets to the bundled stats).
router.post('/enemies/seed', requireAuth, async (req, res) => {
  try {
    const force = req.query.force === '1';
    let inserted = 0, updated = 0;
    for (const e of DEFAULT_ENEMIES) {
      if (force) {
        await query(
          `INSERT INTO enemy_definitions
           (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order, archived)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, icon=EXCLUDED.icon, flavour=EXCLUDED.flavour,
             max_hp=EXCLUDED.max_hp, strength=EXCLUDED.strength, agility=EXCLUDED.agility,
             endurance=EXCLUDED.endurance, combat_skill=EXCLUDED.combat_skill,
             attack_verb=EXCLUDED.attack_verb, reward_weight=EXCLUDED.reward_weight,
             sort_order=EXCLUDED.sort_order, archived=FALSE, updated_at=NOW()`,
          [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
           e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
        );
        updated++;
      } else {
        const exists = await query('SELECT id FROM enemy_definitions WHERE id=$1', [e.id]);
        if (exists.rows.length) continue;
        await query(
          `INSERT INTO enemy_definitions
           (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [e.id, e.name, e.icon, e.flavour, e.max_hp, e.strength, e.agility, e.endurance,
           e.combat_skill, e.attack_verb, e.reward_weight, e.sort_order]
        );
        inserted++;
      }
    }
    res.json({ ok: true, inserted, updated, total: DEFAULT_ENEMIES.length });
  } catch (e) {
    console.error('enemy seed error', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/resolve', requireAuth, async (req, res) => {
  try {
    const { outcome, wealth_reward, citizen_ids } = req.body || {};

    const settRes = await query('SELECT id, wealth FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    if (outcome !== 'victory') {
      // Nothing to persist on defeat for now (no permadeath, no penalty yet).
      return res.json({ ok: true, wealth_after: sett.wealth });
    }

    const wealth = Math.max(0, Math.min(MAX_BATTLE_WEALTH, parseInt(wealth_reward) || 0));
    let wealthAfter = sett.wealth;
    if (wealth > 0) {
      const upd = await query(
        'UPDATE settlements SET wealth = wealth + $1 WHERE id=$2 RETURNING wealth',
        [wealth, sett.id]
      );
      wealthAfter = upd.rows[0]?.wealth ?? sett.wealth + wealth;
    }

    // Bump combat skill on surviving citizens (cap at COMBAT_SKILL_CAP).
    // We do a small per-citizen probability roll to stop combat skill from
    // ratcheting up on every fight; that turns 5 quick test battles into a
    // skill-30 super-citizen. ~50% chance per fight feels honest for MVP.
    let upgraded = [];
    if (Array.isArray(citizen_ids) && citizen_ids.length) {
      // Validate ownership before touching skills.
      const own = await query(
        'SELECT id, name, skills FROM citizens WHERE id = ANY($1) AND settlement_id=$2',
        [citizen_ids.map(Number).filter(Boolean), sett.id]
      );
      for (const c of own.rows) {
        if (Math.random() > 0.5) continue;
        const skills = c.skills || {};
        const cur = skills.combat || 1;
        if (cur >= COMBAT_SKILL_CAP) continue;
        skills.combat = cur + 1;
        await query('UPDATE citizens SET skills=$1 WHERE id=$2', [skills, c.id]);
        upgraded.push({ id: c.id, name: c.name, combat: skills.combat });
      }
    }

    res.json({
      ok: true,
      wealth_awarded: wealth,
      wealth_after: wealthAfter,
      upgraded_citizens: upgraded,
    });
  } catch (e) {
    console.error('Combat resolve error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
