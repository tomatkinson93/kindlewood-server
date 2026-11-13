// ══════════════════════════════════════════════════════════════════════════
//  outpost_events — now and then something happens at an outpost and the
//  player chooses what to do (outpost_events).
//
//  Each outpost rolls once an hour (outposts.event_roll_at): CHANCE per roll
//  while it has no open event, so about one every day and a half each. An
//  event waits EXPIRE_H hours for a choice; after that its `fallback` choice
//  happens by itself. Costs come from the town's stores; finds go into the
//  outpost's store (porters still carry them home).
//
//    rich_vein    hills, mountain   dig it out (timber) for ore / leave it
//    trader       any               sell some of the store at 1.5× / send on
//    wolves       forest, plains, marsh  fight (defence) / light fires (timber) / let them eat
//    traveller    any               give shelter (food): may join the town / turn away
//    cache        ruins, hills      dig (a little wealth, sometimes more) / leave
//    storm        any               shore up (timber) / ride it out (lose 10%)
//    harvest      plains, river, marsh  a bumper crop: food into the store
//
//  KINDS[k].make(o) → data (fixed when the event happens: amounts, the
//  resource); KINDS[k].choose(choice, ctx) → { outcome, … } inside a transaction.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const RD = require('./resource_defs');

const CHANCE = 1 / 36;
const EXPIRE_H = 12;
const ROLL_EVERY_MS = 3600 * 1000;
const TICK_EVERY_MS = 5 * 60 * 1000;

const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const lbl = k => RD.label(k).toLowerCase();

// ── Helpers inside a transaction ───────────────────────────────────────────
async function spend(q, sid, cost) {
  const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
  for (const [r, v] of Object.entries(cost)) if ((Number(s[r]) || 0) < v) return `Not enough ${lbl(r)} in town (need ${v}).`;
  const keys = Object.keys(cost);
  await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 2}`).join(', ')} WHERE id = $1`, [sid, ...keys.map(k => cost[k])]);
  return null;
}
async function addToStore(q, oid, add) {
  const keys = Object.keys(add).filter(k => RD.isResource(k) && add[k] > 0);
  if (!keys.length) return;
  await q(`UPDATE outposts SET store = COALESCE(store, '{}'::jsonb) || jsonb_build_object(${keys.map((k, i) => `'${k}', COALESCE((store->>'${k}')::float8, 0) + $${i + 2}`).join(', ')}) WHERE id = $1`,
    [oid, ...keys.map(k => add[k])]);
}
async function takeFromStore(q, oid, share) {
  const o = (await q('SELECT store FROM outposts WHERE id = $1 FOR UPDATE', [oid])).rows[0];
  const st = (o && o.store) || {};
  const lost = {};
  for (const [k, v] of Object.entries(st)) { const n = Math.floor((Number(v) || 0) * share); if (n > 0) lost[k] = n; }
  const keys = Object.keys(lost);
  if (keys.length) await q(`UPDATE outposts SET store = store || jsonb_build_object(${keys.map((k, i) => `'${k}', GREATEST(0, COALESCE((store->>'${k}')::float8, 0) - $${i + 2})`).join(', ')}) WHERE id = $1`, [oid, ...keys.map(k => lost[k])]);
  return lost;
}
const listOf = obj => Object.entries(obj).map(([k, v]) => `${v} ${lbl(k)}`).join(', ');

// ── The events ─────────────────────────────────────────────────────────────
const KINDS = {
  rich_vein: {
    terrains: ['hills', 'mountain'], icon: '⛏️', title: 'A rich vein',
    make: (o, rng) => { const res = o.terrain === 'mountain' ? 'metal' : 'stone'; return { res, amount: ri(rng, 40, 80), cost: { timber: 60 } }; },
    text: d => `The crew have struck a rich seam. Shoring it up to dig it out would take ${d.cost.timber} timber from town, for about ${d.amount} ${lbl(d.res)}.`,
    options: d => [{ key: 'dig', label: `Dig it out (${d.cost.timber} timber)` }, { key: 'leave', label: 'Leave it' }],
    fallback: 'leave',
    async choose(c, x) {
      if (c === 'dig') { const no = await spend(x.q, x.sid, x.d.cost); if (no) return { error: no }; await addToStore(x.q, x.o.id, { [x.d.res]: x.d.amount }); return { outcome: `They dug out ${x.d.amount} ${lbl(x.d.res)} — it's in the outpost's store.` }; }
      return { outcome: 'The seam was left for another day.' };
    },
  },
  trader: {
    terrains: null, icon: '🧳', title: 'A wandering trader',
    make: (o, rng) => {
      const st = o.store || {};
      const top = Object.entries(st).filter(([k, v]) => RD.isResource(k) && k !== 'wealth' && Number(v) >= 10).sort((a, b) => b[1] - a[1])[0];
      if (!top) return null;
      const qty = Math.min(Math.floor(Number(top[1])), ri(rng, 40, 80));
      const price = Math.max(1, Math.round(qty * (RD.def(top[0]).ref_price || 1) * 1.5));
      return { res: top[0], qty, price };
    },
    text: d => `A trader with a laden cart stops by and offers ${d.price} wealth for ${d.qty} ${lbl(d.res)} from the store — half as much again as the going rate.`,
    options: d => [{ key: 'sell', label: `Sell (${d.qty} ${lbl(d.res)} → ${d.price} wealth)` }, { key: 'decline', label: 'Send them on their way' }],
    fallback: 'decline',
    async choose(c, x) {
      if (c !== 'sell') return { outcome: 'The trader went on their way.' };
      const o = (await x.q('SELECT store FROM outposts WHERE id = $1 FOR UPDATE', [x.o.id])).rows[0];
      const have = Math.floor(Number(((o && o.store) || {})[x.d.res]) || 0);
      if (have < x.d.qty) return { error: `The store only has ${have} ${lbl(x.d.res)} now.` };
      await x.q(`UPDATE outposts SET store = store || jsonb_build_object('${x.d.res}', COALESCE((store->>'${x.d.res}')::float8, 0) - $2) WHERE id = $1`, [x.o.id, x.d.qty]);
      await addToStore(x.q, x.o.id, { wealth: x.d.price });
      return { outcome: `Sold ${x.d.qty} ${lbl(x.d.res)} for ${x.d.price} wealth (in the outpost's store).` };
    },
  },
  wolves: {
    terrains: ['forest', 'plains', 'marsh'], icon: '🐺', title: 'Wolves at the store',
    make: () => ({ cost: { timber: 40 }, need: 12 }),
    text: d => `A pack of wolves circles the store at night. Your crew can try to drive them off (it needs defence of about ${d.need}), keep fires burning (${d.cost.timber} timber from town), or let them take what they will.`,
    options: d => [{ key: 'fight', label: 'Drive them off' }, { key: 'fires', label: `Light fires (${d.cost.timber} timber)` }, { key: 'let', label: 'Let them eat' }],
    fallback: 'let',
    async choose(c, x) {
      if (c === 'fires') { const no = await spend(x.q, x.sid, x.d.cost); if (no) return { error: no }; return { outcome: 'The fires kept the wolves at bay all night.' }; }
      if (c === 'fight') {
        const D = require('./defences');
        const s = (await x.q('SELECT * FROM settlements WHERE id = $1', [x.sid])).rows[0];
        const def = await D.outpostDefence(s, x.o, { query: x.q });
        const crew = (await D.crewOf(x.o.id, { query: x.q })).length;
        const power = def.own + crew * 4;
        if (power >= x.d.need) return { outcome: `The crew drove the wolves off (defence ${power}).`, reward: true };
        const lost = await takeFromStore(x.q, x.o.id, 0.1);
        return { outcome: `Too few to see them off (defence ${power} of ${x.d.need}): the wolves scattered the store${Object.keys(lost).length ? ` — lost ${listOf(lost)}` : ''}.` };
      }
      const lost = await takeFromStore(x.q, x.o.id, 0.2);
      return { outcome: Object.keys(lost).length ? `The wolves helped themselves: lost ${listOf(lost)}.` : 'The wolves found nothing worth taking.' };
    },
  },
  traveller: {
    terrains: null, icon: '🧳', title: 'A lost traveller',
    make: (o, rng) => ({ cost: { food: 30 }, joins: rng() < 0.5 }),
    text: d => `A tired traveller asks your crew for a meal and a place by the fire (${d.cost.food} food from town). Some who are taken in decide to stay.`,
    options: d => [{ key: 'shelter', label: `Give them shelter (${d.cost.food} food)` }, { key: 'away', label: 'Turn them away' }],
    fallback: 'away',
    async choose(c, x) {
      if (c !== 'shelter') return { outcome: 'The traveller trudged on alone.' };
      const no = await spend(x.q, x.sid, x.d.cost); if (no) return { error: no };
      if (!x.d.joins) return { outcome: 'Fed and rested, the traveller thanked you and went on their way.' };
      const { generateCitizen } = require('../citizens');
      const c2 = generateCitizen(1);
      const life = require('./life');
      await x.q(`INSERT INTO citizens (settlement_id, name, gender, generation, role, stats, skills, life, repro, visible_traits, hidden_traits, born_at, last_birthday_year)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [x.sid, c2.name, c2.gender, c2.generation, c2.role, JSON.stringify(c2.stats), JSON.stringify(c2.skills), JSON.stringify(c2.life), JSON.stringify(c2.repro),
         JSON.stringify(c2.visible_traits), JSON.stringify(c2.hidden_traits), life.bornAtFor(c2.life.age).toISOString(), Math.floor(c2.life.age)]);
      await life.assignFamilies(x.sid, x.q);
      await life.recount(x.sid, x.q).catch(() => {});
      await life.autoHouse(x.sid, {}, x.q).catch(() => {});
      return { outcome: `${c2.name} liked what they saw and has settled in your town.`, joined: c2.name };
    },
  },
  cache: {
    terrains: ['ruins', 'hills'], icon: '🏺', title: 'A buried cache',
    make: (o, rng) => ({ wealth: ri(rng, 40, 120), bonus: rng() < 0.25 ? ri(rng, 80, 160) : 0 }),
    text: () => 'Digging turned up the corner of an old chest. It could be worth uncovering.',
    options: () => [{ key: 'dig', label: 'Dig it up' }, { key: 'leave', label: 'Leave it be' }],
    fallback: 'leave',
    async choose(c, x) {
      if (c !== 'dig') return { outcome: 'The chest was left in the earth.' };
      const w = x.d.wealth + x.d.bonus;
      await addToStore(x.q, x.o.id, { wealth: w });
      return { outcome: x.d.bonus ? `Old coin, and plenty of it: ${w} wealth into the outpost's store!` : `A handful of old coin: ${w} wealth into the outpost's store.` };
    },
  },
  storm: {
    terrains: null, icon: '⛈️', title: 'A storm is coming',
    make: () => ({ cost: { timber: 40 } }),
    text: d => `Black clouds are rolling in. The crew can shore up the store (${d.cost.timber} timber from town) or ride it out and lose some of what's stored.`,
    options: d => [{ key: 'shore', label: `Shore up the store (${d.cost.timber} timber)` }, { key: 'ride', label: 'Ride it out' }],
    fallback: 'ride',
    async choose(c, x) {
      if (c === 'shore') { const no = await spend(x.q, x.sid, x.d.cost); if (no) return { error: no }; return { outcome: 'The store stayed dry through the storm.' }; }
      const lost = await takeFromStore(x.q, x.o.id, 0.1);
      return { outcome: Object.keys(lost).length ? `The storm spoiled ${listOf(lost)}.` : 'The storm blew through; there was little to spoil.' };
    },
  },
  harvest: {
    terrains: ['plains', 'river', 'marsh'], icon: '🌻', title: 'A bumper crop',
    make: (o, rng) => ({ food: ri(rng, 50, 100) }),
    text: d => `The land has been generous this year — about ${d.food} extra food is ready to gather.`,
    options: () => [{ key: 'gather', label: 'Gather it in' }],
    fallback: 'gather',
    async choose(c, x) { await addToStore(x.q, x.o.id, { food: x.d.food }); return { outcome: `${x.d.food} food gathered into the outpost's store.` }; },
  },
};

function present(e) {
  const k = KINDS[e.kind];
  if (!k) return null;
  return { id: e.id, kind: e.kind, icon: k.icon, title: k.title, text: k.text(e.data || {}), options: k.options(e.data || {}),
    expires_at: e.expires_at, fallback: k.fallback, outpost_id: e.outpost_id };
}

// Open events for a settlement (or one outpost).
async function openFor(sid, outpostId = null) {
  const r = await query(`SELECT * FROM outpost_events WHERE settlement_id = $1 AND resolved_at IS NULL ${outpostId ? 'AND outpost_id = $2' : ''} ORDER BY created_at`,
    outpostId ? [sid, outpostId] : [sid]).catch(() => ({ rows: [] }));
  return r.rows.map(present).filter(Boolean);
}

// Start one now (`kind` for Dev Tools; else a fitting one at random).
async function start(o, settlement, kind = null, rng = Math.random) {
  const fits = Object.keys(KINDS).filter(k => !KINDS[k].terrains || KINDS[k].terrains.includes(o.terrain));
  const pick = kind || fits[Math.floor(rng() * fits.length)];
  const def = KINDS[pick];
  if (!def) return null;
  const data = def.make(o, rng);
  if (!data) return null;
  const r = await query(`INSERT INTO outpost_events (settlement_id, outpost_id, kind, data, expires_at) VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5)) RETURNING *`,
    [settlement.id, o.id, pick, JSON.stringify(data), EXPIRE_H]);
  const e = present(r.rows[0]);
  const name = (require('../outposts_config').OUTPOST_CONFIG[o.terrain] || {}).name || 'outpost';
  await query('INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1, $2, $3)', [settlement.id, 'outpost_event', `${e.icon} ${e.title} at the ${name} — your crew are waiting for word.`]).catch(() => {});
  try { require('./event_bus').publish(settlement.id, { type: 'outpost_event', event: e, outpost_name: name }); } catch (err) { /* no stream */ }
  return e;
}

// The player's choice (or the fallback, when `auto`).
async function choose(sid, eventId, choice, auto = false) {
  return withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const e = (await q('SELECT * FROM outpost_events WHERE id = $1 AND settlement_id = $2 AND resolved_at IS NULL FOR UPDATE', [eventId, sid])).rows[0];
    if (!e) return { status: 404, error: 'That has already been settled.' };
    const def = KINDS[e.kind];
    if (!def) return { status: 400, error: 'Unknown event.' };
    if (!def.options(e.data || {}).some(x => x.key === choice)) return { status: 400, error: 'Not one of the choices.' };
    const o = (await q('SELECT * FROM outposts WHERE id = $1', [e.outpost_id])).rows[0];
    let res = o ? await def.choose(choice, { q, sid, o, d: e.data || {} }) : { outcome: 'The outpost is gone.' };
    if (res.error && auto) res = await def.choose(def.fallback, { q, sid, o, d: e.data || {} });
    if (res.error) return { status: 400, error: res.error };
    await q('UPDATE outpost_events SET resolved_at = NOW(), choice = $2, outcome = $3 WHERE id = $1', [e.id, choice, res.outcome]);
    if (auto) await q('INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1, $2, $3)', [sid, 'outpost_event', `${def.icon} ${def.title}: nobody sent word, so — ${res.outcome}`]).catch(() => {});
    return { ok: true, outcome: res.outcome, joined: res.joined || null };
  });
}

// Worker: roll for new events, settle expired ones.
let _last = 0;
async function tick(rng = Math.random) {
  if (Date.now() - _last < TICK_EVERY_MS) return;
  _last = Date.now();
  try {
    const due = (await query("SELECT id, settlement_id, kind FROM outpost_events WHERE resolved_at IS NULL AND expires_at <= NOW() LIMIT 100")).rows;
    for (const e of due) await choose(e.settlement_id, e.id, (KINDS[e.kind] || {}).fallback, true).catch(() => {});
    const roll = (await query(
      `SELECT o.*, s.user_id FROM outposts o JOIN settlements s ON s.id = o.settlement_id
        WHERE (o.event_roll_at IS NULL OR o.event_roll_at <= NOW() - make_interval(secs => $1))
          AND NOT EXISTS (SELECT 1 FROM outpost_events e WHERE e.outpost_id = o.id AND e.resolved_at IS NULL)
        LIMIT 300`, [ROLL_EVERY_MS / 1000])).rows;
    for (const o of roll) {
      await query('UPDATE outposts SET event_roll_at = NOW() WHERE id = $1', [o.id]);
      if (rng() < CHANCE) await start(o, { id: o.settlement_id }, null, rng).catch(() => {});
    }
  } catch (e) {
    if (!(e && (e.code === '42P01' || e.code === '42703'))) console.error('[outpost_events] tick', e.message);
  }
}

module.exports = { KINDS, CHANCE, EXPIRE_H, start, choose, openFor, present, tick };
