const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const N = require('../lib/neighbourhoods');

// The Neighbourhood (docs/HOME_SCENE.md Part C): a town's houses on plots.
// Every route names its neighbourhood or house; nothing assumes "the" one.
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id, tier FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
const int = v => (Number.isInteger(Number(v)) && String(v).trim() !== '' ? Number(v) : null);
// Runs a change and answers with the town's neighbourhoods as they now are.
function change(fn) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      const out = await fn(s, req);
      res.json({ ok: true, ...out, town: await N.list(s) });
    } catch (e) {
      if (e instanceof N.HouseError) return res.status(e.status).json({ error: e.message });
      if (e && e.code === '23505') return res.status(400).json({ error: 'A home already stands on that plot.' });
      console.error('[neighbourhoods]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

// GET /api/neighbourhoods — every neighbourhood, its open plots and houses
// (with who lives in each), the unhoused, the styles and the next house's cost.
router.get('/', requireAuth, async (req, res) => {
  try {
    const s = await settlementOf(req);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    res.json({ ok: true, ...(await N.list(s)) });
  } catch (e) {
    console.error('[neighbourhoods]', e);
    res.status(500).json({ error: 'Failed to load the neighbourhood.' });
  }
});

// POST /api/neighbourhoods/:nid/houses { plot, style? } — build a house there.
router.post('/:nid/houses', requireAuth, change((s, req) => {
  const nid = int(req.params.nid), plot = int((req.body || {}).plot);
  if (nid === null || plot === null) throw new N.HouseError('A neighbourhood and a plot are needed.');
  const style = typeof (req.body || {}).style === 'string' ? req.body.style : null;
  return N.place(s.id, { neighbourhoodId: nid, plot, style });
}));

// POST /api/neighbourhoods/houses/:id/move { plot, neighbourhood_id? } — free, at once; onto a home, they swap.
router.post('/houses/:id/move', requireAuth, change((s, req) => {
  const id = int(req.params.id), plot = int((req.body || {}).plot);
  if (id === null || plot === null) throw new N.HouseError('A house and a plot are needed.');
  return N.move(s.id, id, { neighbourhoodId: int((req.body || {}).neighbourhood_id), plot });
}));

// POST /api/neighbourhoods/houses/:id/style { style } — looks only; free, at once.
router.post('/houses/:id/style', requireAuth, change((s, req) => {
  const id = int(req.params.id);
  if (id === null) throw new N.HouseError('A house is needed.');
  return N.setStyle(s.id, id, String((req.body || {}).style || ''));
}));

// POST /api/neighbourhoods/houses/:id/demolish — this house; its residents lose their bed first.
router.post('/houses/:id/demolish', requireAuth, change((s, req) => {
  const id = int(req.params.id);
  if (id === null) throw new N.HouseError('A house is needed.');
  return N.demolish(s.id, id);
}));

module.exports = router;
