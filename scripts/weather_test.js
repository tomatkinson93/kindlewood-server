// ═══════════════════════════════════════════════════════════════════════════
//  weather_test — the day's weather (docs/HOME_SCENE.md Part F, F.5, step 21;
//  lib/weather.js). Looks only.
//   node scripts/weather_test.js
//   QUEST_TEST_BASE=http://localhost:3999 QUEST_TEST_TOKEN=… node scripts/weather_test.js   (also checks the payload)
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}
const W = require('../lib/weather');

console.log('One roll per town per day');
{
  const a = W.roll(7, 20500, 'spring'), b = W.roll(7, 20500, 'spring');
  check(JSON.stringify(a) === JSON.stringify(b), 'the same town and day always give the same weather', a);
  check(a.spells.length === 4 && a.spells.every(k => W.KINDS.includes(k)) && W.KINDS.includes(a.today), 'a word for the day and four spells');
  const days = Array.from({ length: 60 }, (_, i) => JSON.stringify(W.roll(7, 20500 + i, 'autumn')));
  check(new Set(days).size > 8, 'different days differ');
  const towns = Array.from({ length: 60 }, (_, i) => W.roll(i + 1, 20500, 'autumn').today);
  check(new Set(towns).size === 3, 'different towns differ on the same day');
}

console.log('By season');
{
  const N = 4000, share = (season, f) => { let n = 0; for (let d = 0; d < N; d++) if (f(W.roll(3, d, season))) n++; return n / N; };
  for (const [season, o] of Object.entries(W.CONFIG.ODDS)) {
    const wet = season === 'winter' ? 'snow' : 'rain';
    const c = share(season, r => r.today === 'clear'), w = share(season, r => r.today === wet);
    check(Math.abs(c - o[0]) < 0.04 && Math.abs(w - o[2]) < 0.04, `${season}: clear about ${o[0]}, ${wet} about ${o[2]}`, { c, w });
  }
  check(share('winter', r => r.today === 'rain' || r.spells.includes('rain')) === 0, 'it never rains in winter');
  check(['spring', 'summer', 'autumn'].every(s => share(s, r => r.today === 'snow' || r.spells.includes('snow')) === 0), 'it only snows in winter');
  check(share('summer', r => r.today === 'clear') > share('autumn', r => r.today === 'clear'), 'summer is clearer than autumn');
}

console.log('Spells');
{
  let wetAll = 0, wetNone = 0, clearWet = 0, n = 0;
  for (let d = 0; d < 4000; d++) {
    const r = W.roll(11, d, 'autumn');
    if (r.today === 'rain') { n++; if (!r.spells.includes('rain')) wetNone++; if (r.spells.every(k => k === 'rain')) wetAll++; if (r.spells.includes('clear')) clearWet++; }
    else if (r.spells.includes('rain')) clearWet++;
  }
  check(n > 500 && wetNone === 0, 'a wet day is wet for at least one spell');
  check(wetAll / n < 0.2, 'and seldom for all four (it does not rain a whole real day often)', wetAll / n);
  check(clearWet === 0, 'a dry day has no rain, and a wet day is cloudy between showers');
}

console.log('At a moment');
{
  const dawn = Date.UTC(2026, 10, 17, 9, 0, 0), sid = 5;
  const a = W.at(sid, dawn + 60e3), b = W.at(sid, dawn + 7 * 3600e3), c = W.at(sid, dawn - 60e3), z = W.at(sid, dawn + 23.9 * 3600e3);
  check(a.day === b.day && c.day === a.day - 1 && z.day === a.day, 'a day runs from 09:00 UTC to 09:00 UTC');
  check(a.now === a.spells[0] && b.now === a.spells[1] && z.now === a.spells[3], 'the spell follows the clock: six hours each');
  check(a.was === c.spells[3] && a.before === c.spells[3] && b.was === a.spells[0], 'it knows the spell before, across the day\'s turn');
  check(new Date(a.starts).getTime() === dawn && a.spell_ms === 6 * 3600e3, 'the payload says when the day started and how long a spell is');
  check(typeof W.line(a) === 'string' && W.line(a).length > 5 && W.line({ today: 'rain', spells: ['rain', 'rain', 'rain', 'cloudy'] }) === 'Rain for most of the day.' && W.line({ today: 'snow', spells: ['cloudy', 'snow', 'cloudy', 'cloudy'] }) === 'Snow showers.' && W.line({ today: 'clear', spells: ['clear', 'clear', 'clear', 'clear'] }) === 'A clear day.', 'a line for the news');
}

(async () => {
  const base = process.env.QUEST_TEST_BASE, token = process.env.QUEST_TEST_TOKEN;
  if (base && token) {
    console.log('In the town\'s payload');
    const r = await fetch(base + '/api/game/settlement', { headers: { Authorization: 'Bearer ' + token } }).then(x => x.json()).catch(e => ({ error: e.message }));
    const w = r && r.settlement && r.settlement.weather;
    check(!!w && W.KINDS.includes(w.now) && w.spells.length === 4, 'the town comes with its weather', w || r.error);
    check(!!w && JSON.stringify(W.at(r.settlement.id).spells) === JSON.stringify(w.spells), 'and it is the seeded roll for that town');
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
