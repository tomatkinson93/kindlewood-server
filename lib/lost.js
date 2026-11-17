// ═══════════════════════════════════════════════════════════════════════════
//  A lost thing each day (docs/HOME_SCENE.md Part F, F.8; step 22).
//
//  Once per game day a villager in each town has lost one small thing. The
//  player finds it in the Home scene and clicks it; the owner is a little
//  happier, the town gets a small thank-you, and the chronicle notes it.
//
//  Everything that counts is here: which thing, whose it is, whether it has
//  been found, and what finding it gives. One per town per day, whichever
//  device finds it. The scene decides only where to draw it, from `seed`, so
//  every device draws it in the same place.
//
//    today(sid, now)       the day's thing (made the first time it is asked for), or null
//    giveBack(sid, now)    the player found it: reward, chronicle, news
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');
const { gameDay } = require('./social');

const CONFIG = {
  HAPPY: 3,          // the owner's happiness when it comes back
  KEEP_DAYS: 30,
};
// What can be lost. `gives`: the town's thank-you. `child`: a child's thing.
const THINGS = [
  { key: 'basket', label: 'a basket', icon: '🧺', gives: { food: 15 }, thanks: 'shared out what was in it' },
  { key: 'ribbon', label: 'a ribbon', icon: '🎀', gives: { wealth: 5 }, thanks: 'left a few coins in thanks' },
  { key: 'purse', label: 'a coin purse', icon: '👛', gives: { wealth: 12 }, thanks: 'gave a share of it to the town' },
  { key: 'toy', label: 'a wooden toy', icon: '🪀', gives: { wealth: 3 }, child: true, thanks: 'was all smiles' },
];
const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";

class LostError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

function seeded(n) {
  let a = (n >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const first = name => String(name || '').split(' ')[0];
const thing = key => THINGS.find(t => t.key === key) || THINGS[0];

// The day's thing for a town. `citizens`: [{ id, name, life_stage }], the
// living. → { kind, owner_id, owner_name, seed } or null (nobody to lose
// anything). The same town and day always give the same answer. Pure.
function pick(sid, day, citizens) {
  const list = (citizens || []).slice().sort((a, b) => a.id - b.id);
  if (!list.length) return null;
  const r = seeded(Math.imul(Number(sid) | 0, 0x9E3779B1) ^ Math.imul(Number(day) | 0, 0x85EBCA6B) ^ 0x1057);
  const kids = list.filter(c => c.life_stage === 'child'), grown = list.filter(c => c.life_stage !== 'child');
  let t = THINGS[Math.floor(r() * THINGS.length)];
  if (t.child && !kids.length) { const rest = THINGS.filter(x => !x.child); t = rest[Math.floor(r() * rest.length)]; }
  const pool = t.child ? kids : grown.length ? grown : list;
  const owner = pool[Math.floor(r() * pool.length)];
  return { kind: t.key, owner_id: owner.id, owner_name: owner.name, seed: Math.floor(r() * 2147483647) };
}
// What the player is told. `row`: a lost_things row. Pure.
function view(row, resets) {
  if (!row) return null;
  const t = thing(row.kind);
  return {
    id: row.id, day: row.day, kind: t.key, label: t.label, icon: t.icon,
    owner_id: row.owner_id, owner_name: row.owner_name, seed: row.seed,
    found: !!row.found_at, reward: row.reward || null, resets_at: resets,
    line: row.found_at ? `${first(row.owner_name)} has ${t.label} back.` : `${first(row.owner_name)} has lost ${t.label}.`,
  };
}

async function today(sid, now = Date.now(), q = query) {
  const { day, resets } = gameDay(now);
  const get = async () => (await q('SELECT * FROM lost_things WHERE settlement_id = $1 AND day = $2', [sid, day])).rows[0];
  let row = await get();
  if (!row) {
    const cs = (await q(`SELECT id, name, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIVING}`, [sid])).rows;
    const p = pick(sid, day, cs);
    if (!p) return null;
    // Two devices asking at once: the table's own one-a-day rule keeps one.
    await q(`INSERT INTO lost_things (settlement_id, day, kind, owner_id, owner_name, seed) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (settlement_id, day) DO NOTHING`, [sid, day, p.kind, p.owner_id, p.owner_name, p.seed]);
    await q('DELETE FROM lost_things WHERE settlement_id = $1 AND day < $2', [sid, day - CONFIG.KEEP_DAYS]);
    row = await get();
  }
  return view(row, resets);
}

async function giveBack(sid, now = Date.now()) {
  const { day, resets } = gameDay(now);
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const row = (await q('SELECT * FROM lost_things WHERE settlement_id = $1 AND day = $2 FOR UPDATE', [sid, day])).rows[0];
    if (!row) throw new LostError('Nothing is lost today.', 404);
    if (row.found_at) throw new LostError('It has already been given back.', 409);
    const t = thing(row.kind), RD = require('./resource_defs');
    const owner = row.owner_id ? (await q(`SELECT id, name FROM citizens WHERE id = $1 AND settlement_id = $2 AND ${LIVING}`, [row.owner_id, sid])).rows[0] : null;
    const keys = Object.keys(t.gives).filter(k => RD.isResource(k));
    if (keys.length) await q(`UPDATE settlements SET ${keys.map((k, i) => `${k} = ${k} + $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(k => t.gives[k]), sid]);
    if (owner) {
      await q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}',
                 to_jsonb(LEAST(100, GREATEST(0, COALESCE((life->>'happiness')::numeric, 70) + $2)))) WHERE id = $1`, [owner.id, CONFIG.HAPPY]);
    }
    const reward = { ...t.gives, happiness: owner ? CONFIG.HAPPY : 0 };
    const upd = (await q('UPDATE lost_things SET found_at = $2, reward = $3 WHERE id = $1 RETURNING *', [row.id, new Date(now).toISOString(), JSON.stringify(reward)])).rows[0];
    const name = first(row.owner_name);
    const text = owner ? `${name} lost ${t.label}; it was found and given back, and ${name} ${t.thanks}.` : `${t.label[0].toUpperCase() + t.label.slice(1)} that had been ${name}'s was found and given to the family.`;
    await require('./chronicle').write(sid, { kind: 'town', text, citizenIds: owner ? [owner.id] : [] }, q);
    await q(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'lost', $2, $3)`, [sid, `🔎 ${text}`, JSON.stringify(owner ? [owner.id] : [])]);
    return view(upd, resets);
  });
  try { require('./event_bus').publish(sid, { type: 'lost', thing: out }); } catch (e) { /* no stream */ }
  return out;
}

module.exports = { CONFIG, THINGS, LostError, pick, view, today, giveBack };
