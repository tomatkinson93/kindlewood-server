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
// Finish everything a town has queued, in order.
async function finishAll(settlementId) {
  for (let i = 0; i < CN.CONFIG.QUEUE_MAX + 1; i++) {
    try { await CN.finishNow(settlementId); } catch (e) { if (e instanceof CN.SiteError) return i; throw e; }
  }
  return CN.CONFIG.QUEUE_MAX;
}

module.exports = { build, finishAll };
