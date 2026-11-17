'use strict';
// The one way for a test to "build something and have it stand" when building
// time is on (docs/HOME_SCENE.md D.9): order it as a player would, then finish
// the site with the same function the Dev Tools route calls. With building
// time off the order is the whole of it. There is no secret instant switch.
//
//   const { build } = require('./_build');
//   const r = await build(town.api, town.id, 'lumber_camp');   // → the /build response
const CN = require('../lib/construction');

async function build(api, settlementId, buildingId) {
  const r = await api('POST', '/api/buildings/build', { buildingId });
  if (r.status === 200 && r.body && r.body.queued && r.body.site) await CN.finishNow(settlementId, r.body.site.id);
  return r;
}
// For a suite with its own api(): give it the /build response and say whose
// town it was (a settlement id, a token, or a player object with .token, .sid
// or .settlement_id); if the order was queued, the site is finished.
//   const r = await standing(await api(p, 'POST', '/api/buildings/build', { buildingId: 'walls' }), p);
async function sidOf(who) {
  if (typeof who === 'number') return who;
  if (who && typeof who === 'object' && (who.sid || who.settlement_id)) return Number(who.sid || who.settlement_id);
  const token = typeof who === 'string' ? who : who && who.token;
  const d = token ? require('jsonwebtoken').decode(token) : null;
  if (!d || !d.userId) throw new Error('_build.standing: whose town?');
  const r = await require('../db').query('SELECT id FROM settlements WHERE user_id = $1', [d.userId]);
  return r.rows[0] ? r.rows[0].id : null;
}
async function standing(r, who) {
  const b = r && (r.body || r.data);   // suites name the parsed answer either way
  if (r && r.status === 200 && b && b.queued && b.site) await CN.finishNow(await sidOf(who), b.site.id);
  return r;
}
// Place a home through the Neighbourhood's own route and have it stand. With
// building time on the order is finished, and the answer is given `house`
// and a fresh `town`, as it has when building time is off.
async function placeHome(api, settlementId, neighbourhoodId, body) {
  const r = await api('POST', `/api/neighbourhoods/${neighbourhoodId}/houses`, body);
  const b = r && r.body;
  if (r.status === 200 && b && b.queued && b.site) {
    await CN.finishNow(settlementId, b.site.id);
    b.town = (await api('GET', '/api/neighbourhoods')).body;
    b.house = (await require('../db').query('SELECT * FROM houses WHERE settlement_id = $1 AND neighbourhood_id = $2 AND plot = $3', [settlementId, neighbourhoodId, b.site.plot])).rows[0];
  }
  return r;
}
// For a suite that tests the building-time switch itself, or the game without
// it: the switch is turned off for the run. → a function that puts back what
// was there (call it before the pool closes).
async function withoutBuildingTime() {
  const TU = require('../lib/tuning');
  const was = await TU.switchOn('construction.on').catch(() => false);
  if (was) await TU.setSwitch('construction.on', false);
  return async () => { if (was) await TU.setSwitch('construction.on', true).catch(() => {}); };
}
// Finish everything a town has queued, in order.
async function finishAll(settlementId) {
  for (let i = 0; i < CN.CONFIG.QUEUE_MAX + 1; i++) {
    try { await CN.finishNow(settlementId); } catch (e) { if (e instanceof CN.SiteError) return i; throw e; }
  }
  return CN.CONFIG.QUEUE_MAX;
}

module.exports = { build, finishAll, standing, placeHome, withoutBuildingTime };
