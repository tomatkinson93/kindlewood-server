'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  Social: Talk to… and Praise (docs/HOME_SCENE.md Part F, F.1 and F.2).
//
//  The player can send one villager to talk to another about a topic (or
//  about anything), once a day per villager, and praise three villagers a
//  day. Everything is rolled and counted here, so every device shows the same
//  town and a second one gains nothing.
//
//    TOPICS                         the sixteen things villagers talk about
//    interestsFor(id, parents)      a citizen's three likes and one dull topic (pure)
//    chance(topic, speaker, listener, opts)   how likely they get along (pure)
//    gameDay(now)                   the day number; a day turns at dawn
//    ensure(sid, q)                 every living citizen has interests
//    state(sid, now)                who has talked and been praised today, and
//                                   what the player has learned of each villager
//    talk(sid, speakerId, listenerId, topic|null, now)
//    praise(sid, citizenId, now)
//
//  Interests are learned through chats: a topic shows for a villager only
//  once a chat has touched it (citizen_interests.known). They are never sent
//  with the citizens.
// ══════════════════════════════════════════════════════════════════════════
const { query, withTransaction } = require('../db');

const TOPICS = [
  { key: 'fishing',     label: 'Fishing',          icon: '🎣' },
  { key: 'gardening',   label: 'Gardening',        icon: '🌱' },
  { key: 'cooking',     label: 'Cooking',          icon: '🍲' },
  { key: 'music',       label: 'Music',            icon: '🎵' },
  { key: 'stories',     label: 'Old stories',      icon: '📖' },
  { key: 'stars',       label: 'The stars',        icon: '⭐' },
  { key: 'woodcarving', label: 'Woodcarving',      icon: '🪵' },
  { key: 'foraging',    label: 'Foraging',         icon: '🍄' },
  { key: 'weather',     label: 'The weather',      icon: '🌦️' },
  { key: 'gossip',      label: 'Gossip',           icon: '🗣️' },
  { key: 'games',       label: 'Games',            icon: '🎲' },
  { key: 'dancing',     label: 'Dancing',          icon: '💃' },
  { key: 'herbs',       label: 'Herbs',            icon: '🌿' },
  { key: 'building',    label: 'Building',         icon: '🧱' },
  { key: 'far_places',  label: 'Far places',       icon: '🧭' },
  { key: 'harvest',     label: 'The harvest',      icon: '🌾' },
];
const KEYS = TOPICS.map(t => t.key);
const isTopic = k => KEYS.includes(k);
const labelOf = k => (TOPICS.find(t => t.key === k) || { label: k }).label;

const CONFIG = {
  BASE: 0.5,                 // the chance two villagers get along
  LISTENER_LIKES: 0.20, SPEAKER_LIKES: 0.10,
  LISTENER_DULL: -0.30, SPEAKER_DULL: -0.15,
  CHARMING: 0.10,            // a Charming speaker
  MIN: 0.10, MAX: 0.90,
  GOOD_BOND: 3, BAD_BOND: -2, GOOD_HAPPY: 1,
  PRAISE_PER_DAY: 3, PRAISE_HAPPY: 2,
  DAWN_HOUR: 9,              // a day turns at dawn (lib/day_cycle: dawn is 09:00 UTC)
  KEEP_DAYS: 30,             // how long a chat or a praise stays on record
};
const DAY_MS = 24 * 3600e3;
const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";

class SocialError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// ── Pure rules ─────────────────────────────────────────────────────────────
function seeded(n) {
  let a = (n >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Three likes and one dull topic, the same every time for the same citizen.
// `parents`: their parents' interests ({ likes }), if known: a child takes one
// liked topic from each, and one of their own, so interests run in families.
function interestsFor(id, parents = []) {
  const rand = seeded(Number(id) * 2654435761 + 97);
  const pick = list => list[Math.floor(rand() * list.length)];
  const likes = [];
  for (const p of parents.slice(0, 2)) {
    const from = ((p && p.likes) || []).filter(k => isTopic(k) && !likes.includes(k));
    if (from.length) likes.push(pick(from));
  }
  while (likes.length < 3) { const k = pick(KEYS); if (!likes.includes(k)) likes.push(k); }
  const rest = KEYS.filter(k => !likes.includes(k));
  return { likes, dull: pick(rest) };
}
// How likely two villagers get along over a topic. speaker and listener:
// { likes, dull }; opts.charming: the speaker is Charming.
function chance(topic, speaker, listener, opts = {}) {
  const C = CONFIG;
  let p = C.BASE;
  if (listener.likes.includes(topic)) p += C.LISTENER_LIKES;
  if (speaker.likes.includes(topic)) p += C.SPEAKER_LIKES;
  if (listener.dull === topic) p += C.LISTENER_DULL;
  if (speaker.dull === topic) p += C.SPEAKER_DULL;
  if (opts.charming) p += C.CHARMING;
  return Math.round(Math.max(C.MIN, Math.min(C.MAX, p)) * 100) / 100;
}
// How a villager felt about a topic: 'likes', 'dull' or 'fine'.
const feels = (who, topic) => (who.likes.includes(topic) ? 'likes' : who.dull === topic ? 'dull' : 'fine');
// The day number: a day turns at dawn. `resets`: when the next one starts.
function gameDay(now = Date.now()) {
  const shifted = now - CONFIG.DAWN_HOUR * 3600e3;
  const day = Math.floor(shifted / DAY_MS);
  return { day, resets: (day + 1) * DAY_MS + CONFIG.DAWN_HOUR * 3600e3 };
}

// ── Interests ──────────────────────────────────────────────────────────────
const parentsOf = c => { const p = c.parent_ids; return (Array.isArray(p) ? p : typeof p === 'string' ? (() => { try { return JSON.parse(p); } catch (_) { return []; } })() : []).map(Number); };
// Gives interests to every living citizen who has none, parents before
// children (so a child can take after them). → Map(id → { likes, dull }).
async function ensure(sid, q = query) {
  const have = new Map((await q(`SELECT i.citizen_id, i.likes, i.dull, i.known FROM citizen_interests i JOIN citizens c ON c.id = i.citizen_id WHERE c.settlement_id = $1`, [sid])).rows
    .map(r => [r.citizen_id, { likes: r.likes, dull: r.dull, known: r.known || [] }]));
  const need = (await q(`SELECT c.id, c.parent_ids FROM citizens c WHERE c.settlement_id = $1 AND ${LIVING}
                           AND NOT EXISTS (SELECT 1 FROM citizen_interests i WHERE i.citizen_id = c.id) ORDER BY c.born_at NULLS FIRST, c.id`, [sid])).rows;
  for (const c of need) {
    const it = interestsFor(c.id, parentsOf(c).map(id => have.get(id)).filter(Boolean));
    await q('INSERT INTO citizen_interests (citizen_id, likes, dull) VALUES ($1, $2, $3) ON CONFLICT (citizen_id) DO NOTHING', [c.id, JSON.stringify(it.likes), it.dull]);
    have.set(c.id, { ...it, known: [] });
  }
  return have;
}

// What the player has learned: for each villager a chat has touched, those
// topics and how they felt. `interests`: Map(id → { likes, dull, known }).
// → { id: { likes: [..], dull: key|null, fine: [..] } }
function learned(interests) {
  const out = {};
  for (const [id, it] of interests) {
    const known = (it.known || []).filter(isTopic);
    if (!known.length) continue;
    out[id] = { likes: known.filter(k => it.likes.includes(k)), dull: known.includes(it.dull) ? it.dull : null, fine: known.filter(k => feels(it, k) === 'fine') };
  }
  return out;
}

// ── Reading ────────────────────────────────────────────────────────────────
async function state(sid, now = Date.now(), q = query) {
  const { day, resets } = gameDay(now);
  const interests = await ensure(sid, q);
  const [chats, praise] = await Promise.all([
    q('SELECT speaker_id, listener_id, topic, got_along, delta FROM citizen_chats WHERE settlement_id = $1 AND day = $2 ORDER BY id', [sid, day]),
    q('SELECT citizen_id FROM citizen_praise WHERE settlement_id = $1 AND day = $2', [sid, day]),
  ]);
  const today = chats.rows;
  return {
    day, resets_at: resets,
    topics: TOPICS,
    talked: today.map(c => c.speaker_id),
    chats_today: today.map(c => ({ speaker_id: c.speaker_id, listener_id: c.listener_id, topic: c.topic, got_along: c.got_along, delta: c.delta })),
    praised: praise.rows.map(r => r.citizen_id),
    praise_left: Math.max(0, CONFIG.PRAISE_PER_DAY - praise.rows.length),
    praise_per_day: CONFIG.PRAISE_PER_DAY,
    known: learned(interests),
  };
}

// One villager's bond with everyone else, for choosing who they talk to.
// → { otherId: { score, state } }
async function bonds(sid, citizenId, q = query) {
  const id = Number(citizenId);
  if (!Number.isInteger(id)) throw new SocialError('Choose a villager.');
  const rows = (await q(`SELECT citizen_a_id AS a, citizen_b_id AS b, score, state FROM citizen_relationships
                          WHERE settlement_id = $1 AND (citizen_a_id = $2 OR citizen_b_id = $2)`, [sid, id])).rows;
  const out = {};
  for (const r of rows) out[r.a === id ? r.b : r.a] = { score: Number(r.score), state: r.state };
  return out;
}

// ── Changing ───────────────────────────────────────────────────────────────
const stateOf = s => (s >= 90 ? 'partners' : s >= 75 ? 'bonded' : s >= 60 ? 'close' : s >= 40 ? 'friends' : s >= 20 ? 'acquaintances' : 'strangers');
async function bond(q, sid, a, b, delta) {
  const [x, y] = [Math.min(a, b), Math.max(a, b)];
  const r = (await q('SELECT score, state FROM citizen_relationships WHERE citizen_a_id = $1 AND citizen_b_id = $2 FOR UPDATE', [x, y])).rows[0];
  const before = r ? Number(r.score) : 0;
  const score = Math.max(0, Math.min(100, before + delta));
  // A chat never makes or unmakes partners: that stays with the simulation.
  const st = r && r.state === 'partners' ? 'partners' : stateOf(Math.min(score, 89));
  await q(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score = $4, state = $5, last_updated = NOW()`, [sid, x, y, Math.round(score), st]);
  return { before: Math.round(before), score: Math.round(score), state: st };
}
async function happy(q, ids, delta) {
  await q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}',
             to_jsonb(LEAST(100, GREATEST(0, COALESCE((life->>'happiness')::numeric, 70) + $2)))) WHERE id = ANY($1::int[])`, [ids, delta]);
}
async function present(q, sid, ids) {
  const rows = (await q(`SELECT id, name, visible_traits FROM citizens WHERE settlement_id = $1 AND id = ANY($2::int[]) AND ${LIVING}`, [sid, ids])).rows;
  if (rows.length !== new Set(ids).size) throw new SocialError('That villager is not in your town.', 404);
  const away = await require('./careers').awayMap(null, sid).catch(() => new Map());
  for (const c of rows) if (away.has(c.id)) throw new SocialError(`${c.name.split(' ')[0]} is away from town.`);
  return new Map(rows.map(c => [c.id, c]));
}

// Sends `speakerId` to talk to `listenerId` about `topic` (null: anything,
// and the server picks). `rng` for tests. → the outcome.
async function talk(sid, speakerId, listenerId, topic = null, now = Date.now(), rng = Math.random) {
  speakerId = Number(speakerId); listenerId = Number(listenerId);
  if (!Number.isInteger(speakerId) || !Number.isInteger(listenerId)) throw new SocialError('Choose who talks to whom.');
  if (speakerId === listenerId) throw new SocialError('Nobody can be sent to talk to themselves.');
  if (topic != null && !isTopic(topic)) throw new SocialError('That is not something they talk about.');
  const { day, resets } = gameDay(now);
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const who = await present(q, sid, [speakerId, listenerId]);
    const done = (await q('SELECT 1 FROM citizen_chats WHERE speaker_id = $1 AND day = $2', [speakerId, day])).rows.length;
    if (done) throw new SocialError(`${who.get(speakerId).name.split(' ')[0]} has had their chat for today. Try again tomorrow morning.`, 409);
    const interests = await ensure(sid, q);
    const sp = interests.get(speakerId), li = interests.get(listenerId);
    const picked = topic != null;
    const about = picked ? topic : KEYS[Math.floor(rng() * KEYS.length)];
    const charming = (who.get(speakerId).visible_traits || []).includes('charming');
    const p = chance(about, sp, li, { charming });
    const good = rng() < p;
    const delta = good ? CONFIG.GOOD_BOND : CONFIG.BAD_BOND;
    const b = await bond(q, sid, speakerId, listenerId, delta);
    if (good) await happy(q, [speakerId, listenerId], CONFIG.GOOD_HAPPY);
    await q(`INSERT INTO citizen_chats (settlement_id, speaker_id, listener_id, topic, picked, got_along, delta, day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sid, speakerId, listenerId, about, picked, good, b.score - b.before, day]);
    // Both now show how they feel about it; days long past are cleared.
    await q('UPDATE citizen_interests SET known = known || to_jsonb($2::text) WHERE citizen_id = ANY($1::int[]) AND NOT known ? $2', [[speakerId, listenerId], about]);
    await q('DELETE FROM citizen_chats WHERE settlement_id = $1 AND day < $2', [sid, day - CONFIG.KEEP_DAYS]);
    await q('DELETE FROM citizen_praise WHERE settlement_id = $1 AND day < $2', [sid, day - CONFIG.KEEP_DAYS]);
    return {
      speaker: { id: speakerId, name: who.get(speakerId).name, felt: feels(sp, about) },
      listener: { id: listenerId, name: who.get(listenerId).name, felt: feels(li, about) },
      topic: about, topic_label: labelOf(about), icon: (TOPICS.find(t => t.key === about) || {}).icon, picked,
      got_along: good, delta: b.score - b.before, bond: b.score, bond_state: b.state, resets_at: resets,
    };
  });
  try { require('./event_bus').publish(sid, { type: 'social', what: 'talk', ...out }); } catch (e) { /* no stream */ }
  return out;
}

// Praise: a little happiness, three a day per town, a villager once a day.
async function praise(sid, citizenId, now = Date.now()) {
  citizenId = Number(citizenId);
  if (!Number.isInteger(citizenId)) throw new SocialError('Choose who to praise.');
  const { day, resets } = gameDay(now);
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [sid]);
    const who = await present(q, sid, [citizenId]);
    const today = (await q('SELECT citizen_id FROM citizen_praise WHERE settlement_id = $1 AND day = $2', [sid, day])).rows.map(r => r.citizen_id);
    if (today.includes(citizenId)) throw new SocialError(`${who.get(citizenId).name.split(' ')[0]} has been praised today.`, 409);
    if (today.length >= CONFIG.PRAISE_PER_DAY) throw new SocialError(`You have praised ${CONFIG.PRAISE_PER_DAY} villagers today. Try again tomorrow morning.`, 409);
    await q('INSERT INTO citizen_praise (settlement_id, citizen_id, day) VALUES ($1,$2,$3)', [sid, citizenId, day]);
    await happy(q, [citizenId], CONFIG.PRAISE_HAPPY);
    return { citizen: { id: citizenId, name: who.get(citizenId).name }, happiness: CONFIG.PRAISE_HAPPY, praise_left: CONFIG.PRAISE_PER_DAY - today.length - 1, resets_at: resets };
  });
  try { require('./event_bus').publish(sid, { type: 'social', what: 'praise', ...out }); } catch (e) { /* no stream */ }
  return out;
}

module.exports = { TOPICS, CONFIG, SocialError, interestsFor, chance, feels, gameDay, learned, ensure, state, bonds, talk, praise, isTopic };
