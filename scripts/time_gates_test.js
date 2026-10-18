// Spec 021 Phase 5 — time-gated (nocturnal / lunar) enemy picks.
// Pure: a stubbed query layer stands in for Postgres (no pg-mem — no new
// dependencies). The stub applies the same rule the SQL fragment encodes:
//   (active_phases IS NULL OR active_phases ∋ $phase) AND
//   (moon_phases   IS NULL OR moon_phases   ∋ $moon)
// Run from the server root: node scripts/time_gates_test.js
'use strict';
process.env.ADMIN_USER_IDS = '1';

const fs = require('fs');
const path = require('path');
const D = require('../lib/day_cycle');
const clock = require('../lib/server_clock');
const TG = require('../lib/time_gates');

const H = 3600e3, DAY = 24 * H;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : ''));
  ok ? pass++ : fail++;
}

// ── stubbed query layer ────────────────────────────────────────────────────
function stubDb(rows) {
  let turn = 0;
  const calls = [];
  async function q(sql, params) {
    calls.push({ sql, params });
    let pool = rows.filter(r => !r.archived);
    if (/active_phases/.test(sql)) {
      const [phase, moon] = params;
      pool = pool.filter(r => (!r.active_phases || r.active_phases.includes(phase)) &&
                              (!r.moon_phases || r.moon_phases.includes(moon)));
    }
    if (!pool.length) return { rows: [] };
    return { rows: [{ id: pool[turn++ % pool.length].id }] };   // ORDER BY random() stand-in: rotate
  }
  q.calls = calls;
  return q;
}
// Every id a pick can return at ms (the stub rotates through the pool).
async function pickable(q, ms, n = 24, happenings = []) {
  const s = new Set();
  for (let i = 0; i < n; i++) (await TG.pickRandomEnemy(ms, q, happenings)).forEach(id => s.add(id));
  return s;
}

const ROWS = [
  { id: 'wolf' },                                                    // any time
  { id: 'owl_hag', active_phases: ['night'] },                        // night only
  { id: 'moon_stag', moon_phases: ['full'] },                         // full moon only
  { id: 'old_ghost', archived: true },
];
const NOON = Date.parse('2026-11-05T12:00:00Z');
const NIGHT = Date.parse('2026-11-05T03:00:00Z');
const FULL_NIGHT = D.MOON_EPOCH_MS + 4 * DAY + 16 * H;               // 03:00, moon day 4

(async () => {
  // 0. SQL fragment shape
  {
    const g = TG.enemyEligibleSql(3, { phase: 'night', moon: 'full' });
    check('0. enemyEligibleSql returns { sql, params } with placeholders from $start',
          /\$3::text/.test(g.sql) && /\$4::text/.test(g.sql) && g.sql.startsWith('(') && g.sql.endsWith(')') && g.params[0] === 'night' && g.params[1] === 'full' &&
          /active_phases @> jsonb_build_array/.test(g.sql) && !/\?\s/.test(g.sql));
    const c = TG.timeContext(FULL_NIGHT);
    check('0b. timeContext → phase + moon ids', c.phase === 'night' && c.moon === 'full', JSON.stringify(c));
  }

  // 1. Phase filter
  {
    const q = stubDb(ROWS);
    const day = await pickable(q, NOON), night = await pickable(q, NIGHT);
    check('1. a night-only enemy is never picked at noon', !day.has('owl_hag'), [...day].join(','));
    check('1b. …and is pickable at 03:00 UTC', night.has('owl_hag'), [...night].join(','));
    check('1c. archived enemies are never picked', !day.has('old_ghost') && !night.has('old_ghost'));
  }

  // 2. Moon filter
  {
    const q = stubDb(ROWS);
    let only4 = true;
    for (let i = 0; i < 8; i++) {
      const s = await pickable(q, D.MOON_EPOCH_MS + i * DAY + 16 * H);
      if (s.has('moon_stag') !== (i === 4)) only4 = false;
    }
    check('2. a full-moon-only enemy is pickable only on moon index 4', only4);
  }

  // 3. Fallbacks
  {
    const q = stubDb([{ id: 'owl_hag', active_phases: ['night'] }]);
    const p = await TG.pickRandomEnemy(NOON, q, []);
    check('3. empty filtered pool → falls back to the unfiltered pool', p[0] === 'owl_hag' && q.calls.length === 2);
    const empty = await TG.pickRandomEnemy(NOON, stubDb([]), []);
    check('3b. empty table → engine fallback', empty[0] === TG.ENGINE_FALLBACK);
    const broken = await TG.pickRandomEnemy(NOON, async () => { throw new Error('db down'); }, []);
    check('3c. DB error → engine fallback (combat never fails)', broken[0] === TG.ENGINE_FALLBACK);
  }

  // 4. Debug offset: admin warps to night, a second player at the same instant stays in day
  {
    clock._resetForTest();
    clock._setClockForTest(() => NOON);
    const admin = { userId: 1 }, player = { userId: 2 };
    const off = D.overrideOffset({ phase: 'night' }, NOON, 0);
    clock.setDebugOffset(admin.userId, off);
    clock.setDebugOffset(player.userId, off);   // ignored: not an admin
    const q = stubDb(ROWS);
    const a = await pickable(q, clock.gameplayNow(admin));
    const b = await pickable(q, clock.gameplayNow(player));
    check('4. admin debug offset to night → night enemies pickable for that admin',
          D.phaseAt(clock.gameplayNow(admin)).phase === 'night' && a.has('owl_hag'), [...a].join(','));
    check('4b. non-admin at the same instant still gets the day pool', !b.has('owl_hag') && clock.gameplayNow(player) === NOON, [...b].join(','));
    clock._resetForTest();
  }

  // 5. Admin form validation
  {
    check('5. cleanPhases keeps known ids in table order; empty → NULL',
          JSON.stringify(TG.cleanPhases(['night', 'bogus', 'dusk', 'night'])) === '["dusk","night"]' &&
          TG.cleanPhases([]) === null && TG.cleanPhases('night') === null && TG.cleanPhases(undefined) === null);
    check('5b. cleanMoons keeps known moon ids; empty → NULL',
          JSON.stringify(TG.cleanMoons(['full', 'blue'])) === '["full"]' && TG.cleanMoons([]) === null);
  }

  // 6. Call sites (source): the right clock at each random pick; explicit lists untouched
  {
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const quests = src('routes/quests.js'), clan = src('lib/clan_quests.js'), combat = src('routes/combat.js');
    check('6. solo quests pick at the owner\'s gameplayNow (owner loaded from the settlement)',
          /gameplayNow\(\{ userId: ownerUserId \}\)/.test(quests) && /SELECT user_id FROM settlements WHERE id=\$1/.test(quests) &&
          /timeGates\.pickRandomEnemy/.test(quests));
    check('6b. clan quests pick at wallNow (never warped)',
          /pickRandomEnemy\(require\('\.\/server_clock'\)\.wallNow\(\)/.test(clan) && !/gameplayNow/.test(clan));
    check('6c. no unfiltered ORDER BY random() enemy pick left in quests / clan quests',
          !/enemy_definitions[^;]*ORDER BY random\(\)/.test(quests) && !/enemy_definitions[^;]*ORDER BY random\(\)/.test(clan));
    check('6d. combat.js insert/update write active_phases + moon_phases', (combat.match(/active_phases/g) || []).length >= 3);
    const mig = fs.readdirSync(path.join(__dirname, '..', 'migrations')).find(f => f.endsWith('_time_gated_enemies.sql'));
    const db = src('db.js');
    check('6e. migration exists, is wrapped in BEGIN/COMMIT, and is registered in db.js',
          !!mig && /BEGIN;[\s\S]*ADD COLUMN IF NOT EXISTS active_phases[\s\S]*ADD COLUMN IF NOT EXISTS moon_phases[\s\S]*COMMIT;/.test(src('migrations/' + mig)) &&
          /'time_gated_enemies'/.test(db));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
