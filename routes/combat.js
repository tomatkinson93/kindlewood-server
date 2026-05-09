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
