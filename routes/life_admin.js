// ══════════════════════════════════════════════════════════════════════════
//  Dev Tools for the life cycle (docs/PHASE_1_LIFE_CYCLE.md §8). Admins only,
//  on the admin's own town.
//
//    GET  /api/life/admin/status         beds, stages, working adults, the
//                                        next settler, open inheritances,
//                                        fertile couples and what blocks them
//    POST /api/life/admin/age   { years }               everyone ages by N years
//    POST /api/life/admin/stage { citizen_id, stage }   child | youth | adult | elder
//    POST /api/life/admin/death { citizen_id }          a death of old age, now
//    POST /api/life/admin/settler                       a settler now (needs a bed)
//    POST /api/life/admin/inheritances/settle           every open one, now
//    GET  /api/life/admin/numbers                       the tunable numbers
//    POST /api/life/admin/numbers { key, value }        change one
//    POST /api/life/admin/numbers/reset { key? }        back to the default(s)
// ══════════════════════════════════════════════════════════════════════════
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const LIFE = require('../lib/life');

const router = express.Router();
router.use(requireAuth, requireAdmin);

async function town(req, res) {
  const s = (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0];
  if (!s) res.status(404).json({ error: 'No settlement.' });
  return s || null;
}
const fail = (res, e, what) => {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error(`[life admin] ${what}:`, e);
  res.status(500).json({ error: `Failed to ${what}.` });
};

router.get('/status', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const now = Date.now();
    const cits = (await query(`SELECT * FROM citizens WHERE settlement_id = $1 AND ${LIFE.LIVING}`, [s.id])).rows;
    const stages = { child: 0, youth: 0, adult: 0, elder: 0 };
    cits.forEach(c => { const st = LIFE.stageOf(c, now); if (stages[st] != null) stages[st]++; });
    // Couples and what stands between them and a child.
    const byId = new Map(cits.map(c => [c.id, c]));
    const kids = (await query(`SELECT parent_ids, born_at FROM citizens WHERE settlement_id = $1 AND jsonb_typeof(parent_ids) = 'array' AND jsonb_array_length(parent_ids) = 2`, [s.id])).rows;
    const beds = await LIFE.beds(s.id);
    const couples = [];
    for (const a of cits) {
      const b = a.partner_id && byId.get(a.partner_id);
      if (!b || a.id > b.id) continue;
      const mine = kids.filter(k => { const p = LIFE.parentsOf(k); return p.includes(a.id) && p.includes(b.id); });
      const last = mine.reduce((m, k) => Math.max(m, new Date(k.born_at).getTime() || 0), 0) || null;
      const blockers = LIFE.birthBlockers(a, b, { children: mine.length, lastChildAt: last }, now);
      if (beds.free <= 0) blockers.unshift('No free bed in town');
      couples.push({ a: { id: a.id, name: a.name, age: Math.floor(LIFE.ageOf(a, now)) }, b: { id: b.id, name: b.name, age: Math.floor(LIFE.ageOf(b, now)) },
        children: mine.length, fertile: blockers.length === 0, blockers });
    }
    const oldest = cits.map(c => ({ id: c.id, name: c.name, age: Math.floor(LIFE.ageOf(c, now)), chance: LIFE.deathChance(Math.floor(LIFE.ageOf(c, now)) + 1) }))
      .sort((x, y) => y.age - x.age).slice(0, 5);
    const open = (await query(`SELECT i.deceased_id, d.name, i.heir_id, h.name AS heir, i.settle_at FROM inheritances i
        JOIN citizens d ON d.id = i.deceased_id LEFT JOIN citizens h ON h.id = i.heir_id
       WHERE i.settlement_id = $1 AND i.status = 'open' ORDER BY i.settle_at`, [s.id])).rows;
    res.json({ ok: true, beds, stages, working: stages.adult, couples, oldest,
      settler: await require('../lib/settlers').nextDue(s.id, now), inheritances: open, year_hours: LIFE.YEAR_MS / 3600000 });
  } catch (e) { fail(res, e, 'load the status'); }
});

// Everyone ages by N years. Birthdays already rolled stay rolled, so each
// citizen gets at most one death roll for the jump, at the next hourly run.
router.post('/age', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const years = Number((req.body || {}).years);
    if (!isFinite(years) || years <= 0 || years > 100) return res.status(400).json({ error: 'Years must be between 0 and 100.' });
    const r = await query(`UPDATE citizens SET born_at = born_at - make_interval(secs => $2) WHERE settlement_id = $1 AND ${LIFE.LIVING} RETURNING id`,
      [s.id, years * LIFE.YEAR_MS / 1000]);
    const grown = await LIFE.comeOfAge(s.id);
    await LIFE.updateHeads(s.id);
    res.json({ ok: true, aged: r.rows.length, came_of_age: grown.map(g => g.name) });
  } catch (e) { fail(res, e, 'age the town'); }
});

// One citizen into a stage (by moving their born_at; child ↔ adult as needed).
const STAGE_AGE = { child: 3, youth: 8, adult: 25, elder: 62 };
router.post('/stage', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const { citizen_id, stage } = req.body || {};
    if (!STAGE_AGE[stage]) return res.status(400).json({ error: 'Stage must be child, youth, adult or elder.' });
    const c = (await query(`SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2 AND ${LIFE.LIVING}`, [citizen_id, s.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });
    // Keep their age within the stage if it already fits.
    const lo = { child: 0, youth: LIFE.CONFIG.YOUTH_FROM, adult: LIFE.CONFIG.ADULT_FROM, elder: LIFE.CONFIG.ELDER_FROM }[stage];
    const hi = { child: LIFE.CONFIG.YOUTH_FROM, youth: LIFE.CONFIG.ADULT_FROM, adult: LIFE.CONFIG.ELDER_FROM, elder: 200 }[stage];
    const age = Math.max(lo, Math.min(hi - 0.5, STAGE_AGE[stage] >= lo && STAGE_AGE[stage] < hi ? STAGE_AGE[stage] : lo + 1));
    const stored = stage === 'child' || stage === 'youth' ? 'child' : 'adult';
    const role = stored === 'adult' && c.life_stage === 'child' ? require('../lib/careers/classes').FALLBACK_ROLE : c.role;
    await query(`UPDATE citizens SET born_at = $2, life_stage = $3, role = $4, last_birthday_year = $5 WHERE id = $1`,
      [c.id, LIFE.bornAtFor(age).toISOString(), stored, stored === 'child' ? 'idle' : role, Math.floor(age)]);
    await LIFE.updateHeads(s.id);
    await LIFE.recount(s.id);
    res.json({ ok: true, id: c.id, name: c.name, stage, age: Math.floor(age) });
  } catch (e) { fail(res, e, 'set the stage'); }
});

router.post('/death', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const c = (await query(`SELECT id, name, born_at FROM citizens WHERE id = $1 AND settlement_id = $2 AND ${LIFE.LIVING}`, [(req.body || {}).citizen_id, s.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });
    await require('../deaths').writeDeathEvent({ citizenId: c.id, settlementId: s.id, cause: 'old_age',
      narrative: `${c.name} passed away peacefully at ${Math.floor(LIFE.ageOf(c))}.` });
    const inh = (await query('SELECT heir_id, default_heir_id FROM inheritances WHERE deceased_id = $1', [c.id])).rows[0];
    res.json({ ok: true, name: c.name, heir_id: inh ? inh.heir_id : null });
  } catch (e) { fail(res, e, 'trigger the death'); }
});

router.post('/settler', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const came = await require('../lib/settlers').sendNow(s.id);
    res.json({ ok: true, settler: came || null });
  } catch (e) { fail(res, e, 'send a settler'); }
});

router.post('/inheritances/settle', async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const open = (await query(`SELECT id FROM inheritances WHERE settlement_id = $1 AND status = 'open'`, [s.id])).rows;
    const IH = require('../lib/inheritance');
    for (const r of open) await IH.settle(r.id);
    res.json({ ok: true, settled: open.length });
  } catch (e) { fail(res, e, 'settle the inheritances'); }
});

router.get('/numbers', async (req, res) => {
  try { res.json({ ok: true, numbers: await require('../lib/tuning').lifeAll() }); }
  catch (e) { fail(res, e, 'load the numbers'); }
});
router.post('/numbers', async (req, res) => {
  try { const { key, value } = req.body || {}; res.json({ ok: true, numbers: await require('../lib/tuning').setLife(key, value) }); }
  catch (e) { fail(res, e, 'save the number'); }
});
router.post('/numbers/reset', async (req, res) => {
  try { res.json({ ok: true, numbers: await require('../lib/tuning').resetLife((req.body || {}).key || null) }); }
  catch (e) { fail(res, e, 'reset the numbers'); }
});

module.exports = router;
