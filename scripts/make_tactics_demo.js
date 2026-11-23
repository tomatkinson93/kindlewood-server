#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
//  make_tactics_demo — the battles the jukebox page plays by itself.
//
//    node scripts/make_tactics_demo.js        writes the frontend's assets/tactics/demo.json
//
//  jukebox.html (in the frontend) shows a battle on the board behind each
//  track: the kind of fight the music is for, with both sides played by the
//  rules' own mind. That page has no server behind its battle, so the two
//  sides are made here, from the same code the game uses (lib/tactics_setup.js,
//  lib/tactics_foes.js), and kept as a file: four trained citizens, one of
//  each class, and for every band an ordinary fight, a hard one and its boss.
//  Run it again when a kit, a foe or a skull's numbers change. No database.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../lib/tactics_setup');
const F = T.FOES;
const OUT = path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'assets', 'tactics', 'demo.json');

const TIER = 'orange', LEVEL = 'trained';
const WHO = [['Hazel', 'guard'], ['Perrin', 'hearthkeeper'], ['Moss', 'archer'], ['Holly', 'wizard']];
const party = WHO.map(([name, cls], i) => { const u = T.partyUnit({ id: i + 1, name, role: 'idle' }, cls, LEVEL, null, 1); delete u.citizen_id; return u; });
// Which band a place's battle is against, and on which land a boss's music is shown.
const PLACES = {
  plains: { land: 'plains', band: 'brigand' }, forest: { land: 'forest', band: 'pack' }, hills: { land: 'hills', band: 'crag' }, mountain: { land: 'mountain', band: 'crag' },
  river: { land: 'river', band: 'mire' }, marsh: { land: 'marsh', band: 'mire' }, ruins: { land: 'ruins', band: 'withered' },
  boss: { land: 'plains', band: 'brigand', fight: 'boss', also: [['forest', 'pack'], ['mountain', 'crag'], ['marsh', 'mire']] },
  'boss-withered': { land: 'ruins', band: 'withered', fight: 'boss' },
};
const bands = {};
for (const b of Object.keys(F.BANDS)) {
  bands[b] = { name: F.BANDS[b].name };
  for (const k of ['first', 'hard', 'boss']) bands[b][k] = F.SHOWCASE[b][k].map((key, i) => T.foeUnit(F.FOES[key], i, TIER, null));
}
const out = { made_by: 'kindlewood-server scripts/make_tactics_demo.js', tier: TIER, skull: require('../lib/dungeon_defs').TIERS[TIER].skull, party, bands, places: PLACES };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`${OUT}: ${party.length} citizens, ${Object.keys(bands).length} bands, ${Object.keys(PLACES).length} places, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
process.exit(0);
