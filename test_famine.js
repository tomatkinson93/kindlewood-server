// Run from the server root (next to famine.js): node test_famine.js
// Pure-simulation tests — never touches the DB (query is never called).
// Covers spec §6 tests 1–9a: steady state, upkeep modifiers, food=0 onset,
// partial-famine ordering, determinism + composability, mercy cap + grace
// gate, recovery/hysteresis, seeded narratives, deceased exclusion.
const F = require('./famine');
const assert = require('assert');

const SPRING_MS = new Date('2025-01-01T01:00:00Z').getTime(); // 1am UTC = spring window
const mk = (id, over = {}) => ({ id, name: 'C' + id, life_stage: 'adult', role: 'idle',
  visible_traits: [], hunger: 30, health: 100, happiness: 70, starving: false, ...over });

// 1. Steady state: plenty of food, hunger decays to floor, no events
let r = F.simulateConsumption({ foodF: 1000, citizens: [mk(1), mk(2)] }, 8, SPRING_MS); // 2h
assert.strictEqual(r.events.length, 0);
assert.ok(r.citizens.every(c => c.hunger === 20 || c.hunger < 30), 'hunger decays');
assert.ok(Math.abs((1000 - r.foodF) - 2 * 1.0 * 2) < 1e-6, 'exact upkeep deducted: ' + (1000 - r.foodF));

// 2. Upkeep modifiers: child 0.5, physical x1.2, greedy x1.5, winter x1.2
const WINTER_MS = new Date('2025-01-01T19:00:00Z').getTime(); // 18-24h UTC = winter
assert.strictEqual(F.upkeepPerHour(mk(1, { life_stage: 'child' })), 0.5);
assert.strictEqual(F.upkeepPerHour(mk(1, { role: 'farmer' })), 1.2);
assert.strictEqual(F.upkeepPerHour(mk(1, { visible_traits: ['greedy'] })), 1.5);
assert.ok(Math.abs(F.upkeepPerHour(mk(1), F.seasonAt(WINTER_MS)) - 1.2) < 1e-9, 'winter foodConsumption applies');

// 3. Food=0 onset: hunger climbs +5/hr, starving at 90, health drains after
r = F.simulateConsumption({ foodF: 0, citizens: [mk(1, { hunger: 85 })] }, 4, SPRING_MS); // 1h
assert.ok(Math.abs(r.citizens[0].hunger - 90) < 1e-9, 'hunger 85->90 in 1h');
assert.strictEqual(r.events.filter(e => e.type === 'starving_onset').length, 1);
const hpAfterOnset = r.citizens[0].health;
assert.ok(hpAfterOnset < 100, 'drain began at threshold');

// 4. Partial famine ordering: child fed first, then hungriest, id tiebreak
const kids = [mk(1, { hunger: 30, life_stage: 'child' }), mk(2, { hunger: 80 }), mk(3, { hunger: 80 }), mk(4, { hunger: 50 })];
// food covers child(0.125/quantum) + one adult(0.25) only
r = F.simulateConsumption({ foodF: 0.375, citizens: kids }, 1, SPRING_MS);
const by = Object.fromEntries(r.citizens.map(c => [c.id, c]));
assert.ok(by[1].hunger < 30, 'child fed');
assert.ok(by[2].hunger < 80, 'hungriest lower-id adult fed');
assert.ok(by[3].hunger > 80 && by[4].hunger > 50, 'others unfed');

// 5. Determinism: identical runs byte-identical; composability 8 = 4+4
const st = () => ({ foodF: 1.5, citizens: [mk(1, { hunger: 88 }), mk(2, { hunger: 95, starving: true, health: 40 }), mk(3, { life_stage: 'child', hunger: 60 })] });
const a = JSON.stringify(F.simulateConsumption(st(), 8, SPRING_MS));
const b = JSON.stringify(F.simulateConsumption(st(), 8, SPRING_MS));
assert.strictEqual(a, b, 'same inputs -> same outputs');
const half1 = F.simulateConsumption(st(), 4, SPRING_MS);
const half2 = F.simulateConsumption({ foodF: half1.foodF, citizens: half1.citizens.map(c => ({...c, _dirty:false})) }, 4, SPRING_MS + 4 * F.QUANTUM_MS);
const whole = F.simulateConsumption(st(), 8, SPRING_MS);
assert.ok(Math.abs(half2.foodF - whole.foodF) < 1e-9, 'window composability (food)');
for (let i = 0; i < 3; i++) {
  assert.ok(Math.abs(half2.citizens[i].hunger - whole.citizens[i].hunger) < 1e-9, 'composability hunger c' + (i+1));
  assert.ok(Math.abs(half2.citizens[i].health - whole.citizens[i].health) < 1e-9, 'composability health c' + (i+1));
}

// 6. Death + grace gate: 5 citizens (<= grace pop) at death's door -> 0 deaths, floored at 1
const dying = Array.from({length:5}, (_,i) => mk(i+1, { hunger: 100, health: 0.1, starving: true }));
r = F.simulateConsumption({ foodF: 0, citizens: dying.map(c=>({...c})) }, 1, SPRING_MS);
assert.strictEqual(r.deaths, 0, 'grace gate: no deaths at pop<=5');
assert.ok(r.citizens.every(c => c.health === 1), 'floored at health 1');
// 10 citizens -> cap = 2 deaths
const dying10 = Array.from({length:10}, (_,i) => mk(i+1, { hunger: 100, health: 0.1, starving: true }));
r = F.simulateConsumption({ foodF: 0, citizens: dying10 }, 1, SPRING_MS);
assert.strictEqual(r.deaths, 2, 'mercy cap 25% of 10 = 2');
assert.strictEqual(r.citizens.filter(c => c.life_stage === 'deceased').length, 2);
assert.strictEqual(r.events.filter(e => e.type === 'death').length, 2);
assert.ok(r.citizens.filter(c => c.life_stage !== 'deceased').every(c => c.health === 1), 'survivors at 1');

// 7. Recovery + hysteresis: fed starving citizen recovers below 75, regen only <= 40 hunger
const rec = [mk(1, { hunger: 100, health: 30, starving: true, happiness: 25 })];
r = F.simulateConsumption({ foodF: 10000, citizens: rec }, 4 * 3, SPRING_MS); // 3h fed: hunger 100->70
assert.ok(Math.abs(r.citizens[0].hunger - 70) < 1e-9, 'hunger falls 10/hr: ' + r.citizens[0].hunger);
assert.strictEqual(r.citizens[0].starving, false, 'condition lifted below 75');
assert.strictEqual(r.events.filter(e => e.type === 'recovered').length, 1);
assert.strictEqual(r.citizens[0].health, 30, 'no regen while hunger > 40');
r = F.simulateConsumption({ foodF: 10000, citizens: r.citizens.map(c=>({...c,_dirty:false})) }, 4 * 5, SPRING_MS); // 5 more hours: hunger 70->20 (3h to 40), regen for ~3h... 
assert.ok(r.citizens[0].health > 30, 'regen resumed once sated: ' + r.citizens[0].health);
assert.ok(r.citizens[0].happiness > 25 && r.citizens[0].happiness <= 70, 'stored happiness recovers toward 70: ' + r.citizens[0].happiness);

// 8. Seeded narrative: stable across runs, varies by citizen
const n1 = F.pickSeeded(['a','b','c'], 7, 12345), n2 = F.pickSeeded(['a','b','c'], 7, 12345);
assert.strictEqual(n1, n2, 'seeded pick stable');

// 9. Deceased consume nothing
r = F.simulateConsumption({ foodF: 100, citizens: [mk(1, { life_stage: 'deceased' })] }, 4, SPRING_MS);
assert.strictEqual(r.foodF, 100, 'deceased eat nothing');

console.log('ALL FAMINE TESTS PASSED');
