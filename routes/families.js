// ══════════════════════════════════════════════════════════════════════════
//  Families (docs/PHASE_1_LIFE_CYCLE.md §5, §6).
//
//    GET /api/families               the town's family lines: head, living
//                                    members by stage, the remembered, heirlooms
//    GET /api/families/:id           one line's members, living and dead, with
//                                    parents and partners (for the tree)
//    GET /api/families/:id/chronicle the record, newest first, paged
//                                    (?before=<id>&limit=); :id 'all' = the town
//
//  A chronicle line belongs to a family when it was written for it, or when
//  any of its members is named in it.
// ══════════════════════════════════════════════════════════════════════════
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const LIFE = require('../lib/life');

const router = express.Router();
const arr = v => (Array.isArray(v) ? v : []);

async function townOf(req) {
  const r = await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId]);
  return r.rows[0] || null;
}

function memberOut(c, now) {
  const dead = (c.life_stage || 'adult') === 'deceased';
  return {
    id: c.id, name: c.name, gender: c.gender, role: c.role,
    age: Math.floor(LIFE.ageOf(dead && c.died_at ? { born_at: c.born_at } : c, dead && c.died_at ? new Date(c.died_at).getTime() : now)),
    stage: LIFE.stageOf(c, now), generation: c.generation || 1,
    parent_ids: arr(c.parent_ids).map(Number), partner_id: c.partner_id || null,
    born_at: c.born_at, died_at: c.died_at || null, death_cause: c.death_cause || null,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const s = await townOf(req);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const now = Date.now();
    const fams = (await query('SELECT id, name, founded_at, head_citizen_id FROM families WHERE settlement_id = $1 ORDER BY founded_at, id', [s.id])).rows;
    const cits = (await query(
      'SELECT id, name, gender, role, born_at, died_at, death_cause, life_stage, parent_ids, partner_id, generation, family_id FROM citizens WHERE settlement_id = $1', [s.id])).rows;
    const gear = (await query(`SELECT name, equipped_to, metadata FROM inventory_items WHERE settlement_id = $1 AND metadata ? 'heirloom'`, [s.id])).rows;
    const out = [];
    for (const f of fams) {
      const members = cits.filter(c => c.family_id === f.id);
      if (!members.length) continue;
      const living = members.filter(c => (c.life_stage || 'adult') !== 'deceased').map(c => memberOut(c, now))
        .sort((a, b) => b.age - a.age);
      const stages = { child: 0, youth: 0, adult: 0, elder: 0 };
      living.forEach(m => { if (stages[m.stage] != null) stages[m.stage]++; });
      const head = living.find(m => m.id === f.head_citizen_id) || null;
      const heirlooms = gear.filter(g => g.metadata.heirloom && Number(g.metadata.heirloom.family_id) === f.id).map(g => ({
        name: g.name, from: g.metadata.heirloom.from_name, generations: g.metadata.heirloom.generations || 1,
        carrier: (cits.find(c => c.id === g.equipped_to) || {}).name || null,
      }));
      out.push({
        id: f.id, name: f.name, founded_at: f.founded_at,
        head: head ? { id: head.id, name: head.name, age: head.age } : null,
        living, stages, remembered: members.length - living.length,
        generations: Math.max(...members.map(c => c.generation || 1)),
        heirlooms,
      });
    }
    // Lines with living members first, then the largest.
    out.sort((a, b) => (b.living.length > 0) - (a.living.length > 0) || b.living.length - a.living.length || a.id - b.id);
    res.json({ ok: true, families: out });
  } catch (err) {
    console.error('[families] list failed:', err);
    res.status(500).json({ error: 'Failed to load the families.' });
  }
});

router.get('/:id/chronicle', requireAuth, async (req, res) => {
  try {
    const s = await townOf(req);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 30));
    const before = parseInt(req.query.before, 10) || null;
    let rows;
    if (req.params.id === 'all') {
      rows = (await query(
        `SELECT id, family_id, citizen_ids, kind, text, at FROM chronicle
          WHERE settlement_id = $1 AND ($2::int IS NULL OR id < $2) ORDER BY at DESC, id DESC LIMIT $3`, [s.id, before, limit])).rows;
    } else {
      const fid = parseInt(req.params.id, 10);
      const fam = (await query('SELECT id FROM families WHERE id = $1 AND settlement_id = $2', [fid, s.id])).rows[0];
      if (!fam) return res.status(404).json({ error: 'No such family.' });
      const ids = (await query('SELECT id FROM citizens WHERE family_id = $1', [fid])).rows.map(r => String(r.id));
      rows = (await query(
        `SELECT id, family_id, citizen_ids, kind, text, at FROM chronicle
          WHERE settlement_id = $1 AND ($2::int IS NULL OR id < $2)
            AND (family_id = $3 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(citizen_ids) x WHERE x = ANY($4::text[])))
          ORDER BY at DESC, id DESC LIMIT $5`, [s.id, before, fid, ids, limit])).rows;
    }
    res.json({ ok: true, entries: rows.map(r => ({ id: r.id, kind: r.kind, text: r.text, at: r.at, citizen_ids: arr(r.citizen_ids) })),
      more: rows.length === limit ? rows[rows.length - 1].id : null });
  } catch (err) {
    console.error('[families] chronicle failed:', err);
    res.status(500).json({ error: 'Failed to load the chronicle.' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const s = await townOf(req);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const fid = parseInt(req.params.id, 10);
    const fam = (await query('SELECT id, name, founded_at, head_citizen_id FROM families WHERE id = $1 AND settlement_id = $2', [fid, s.id])).rows[0];
    if (!fam) return res.status(404).json({ error: 'No such family.' });
    const now = Date.now();
    const members = (await query(
      `SELECT id, name, gender, role, born_at, died_at, death_cause, life_stage, parent_ids, partner_id, generation FROM citizens
        WHERE family_id = $1 ORDER BY born_at ASC, id ASC`, [fid])).rows.map(c => memberOut(c, now));
    // Partners from other families, so couples show in the tree.
    const known = new Set(members.map(m => m.id));
    const outsiders = members.map(m => m.partner_id).filter(id => id && !known.has(id));
    const partners = outsiders.length ? (await query(
      `SELECT id, name, gender, role, born_at, died_at, death_cause, life_stage, parent_ids, partner_id, generation, family_id FROM citizens WHERE id = ANY($1::int[])`, [outsiders])).rows
      .map(c => ({ ...memberOut(c, now), outsider: true })) : [];
    res.json({ ok: true, family: { id: fam.id, name: fam.name, founded_at: fam.founded_at, head_id: fam.head_citizen_id }, members, partners });
  } catch (err) {
    console.error('[families] one failed:', err);
    res.status(500).json({ error: 'Failed to load the family.' });
  }
});

module.exports = router;
