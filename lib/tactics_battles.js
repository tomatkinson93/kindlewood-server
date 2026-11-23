// ══════════════════════════════════════════════════════════════════════════
//  tactics_battles — a battle on a board, kept by the server
//  (docs/TACTICS.md §9, Phase 2: "the server decides").
//
//  A battle is stored as its two sides (frozen when it begins) and the
//  player's choices in order. The rules are lib/tactics_engine.js, the same
//  file the browser runs (frontend js/tactics-engine.js, kept identical).
//  Every choice the browser sends is played here on top of the ones before
//  it; one the rules refuse is turned away and nothing is stored. Creatures
//  need no entries: their mind is part of the rules.
//
//  So the browser shows the battle and the server owns it: a reload picks it
//  up where it was, and the result is the server's.
//
//    create(userId, opts)            a new battle (ends the town's last one, if still open)
//    current(userId)                 the town's open battle, or null
//    get(userId, id)                 one of the town's battles
//    act(userId, id, n, action)      the player's n-th choice (n counts from 0)
//    leave(userId, id)               walk away: the battle ends as 'left'
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query, withTransaction } = require('../db');
const E = require('./tactics_engine');
const SETUP = require('./tactics_setup');
const err = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const MAX_ACTIONS = 2000;      // far beyond any real battle; a guard, not a rule

const townOf = async (userId, run) => (await (run || query)('SELECT id FROM settlements WHERE user_id=$1', [userId])).rows[0];

// What the browser needs: the two sides, the choices so far, and the board's fingerprint after them.
function view(row, state) {
  const st = state || E.replay(row.setup, row.actions).state;
  return {
    id: Number(row.id), status: row.status, source: row.source, seed: Number(row.seed), land: row.land, tier: row.tier, fight: row.fight,
    setup: row.setup, actions: row.actions, count: row.actions.length, check: E.checksum(st), result: row.result || null,
    dungeon_run_id: row.dungeon_run_id || null,
  };
}
// Only what a choice may hold is kept, so nothing else can be stored through it.
function clean(a) {
  if (!a || typeof a !== 'object') return null;
  const int = v => (Number.isInteger(Number(v)) ? Number(v) : null);
  if (a.t === 'move') { const x = int(a.x), y = int(a.y); return x == null || y == null ? null : { t: 'move', x, y }; }
  if (a.t === 'use') { const x = int(a.x), y = int(a.y); return x == null || y == null || typeof a.key !== 'string' || a.key.length > 40 ? null : { t: 'use', key: a.key, x, y }; }
  if (a.t === 'undo') return { t: 'undo' };
  if (a.t === 'end') return E.DIRS[a.face] ? { t: 'end', face: a.face } : { t: 'end' };
  return null;
}

async function create(userId, opts = {}) {
  const built = await SETUP.build(userId, opts);
  const setup = { seed: built.seed, land: built.land, tier: built.tier, skull: built.skull, name: built.name, band: built.band || null, fight: built.fight, level: built.level, species: built.species, party: built.party, enemies: built.enemies };
  return withTransaction(async client => {
    const s = await townOf(userId, (t, p) => client.query(t, p));
    if (!s) throw err(404, 'No settlement.');
    // A dungeon's battle is not pushed aside for a practice one.
    if ((await client.query(`SELECT 1 FROM tactics_battles WHERE settlement_id=$1 AND status='active' AND source='dungeon'`, [s.id])).rows.length) throw err(400, 'Your party is in a fight in a dungeon. Finish it, or flee, first.');
    await client.query(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE settlement_id=$1 AND status='active'`, [s.id]);
    const row = (await client.query(
      `INSERT INTO tactics_battles (settlement_id, user_id, source, seed, land, tier, fight, setup) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [s.id, userId, 'practice', setup.seed, setup.land, setup.tier, setup.fight, JSON.stringify(setup)])).rows[0];
    return view(row);
  });
}
async function current(userId) {
  const s = await townOf(userId);
  if (!s) return null;
  const row = (await query(`SELECT * FROM tactics_battles WHERE settlement_id=$1 AND status='active'`, [s.id])).rows[0];
  return row ? view(row) : null;
}
async function get(userId, id) {
  const s = await townOf(userId);
  const row = s && (await query('SELECT * FROM tactics_battles WHERE id=$1 AND settlement_id=$2', [id, s.id])).rows[0];
  if (!row) throw err(404, 'No such battle.');
  // Opening a dungeon's fight again is the player coming back to it: the run is not idle.
  if (row.status === 'active' && row.dungeon_run_id) await require('./dungeons').touch(row.dungeon_run_id);
  return view(row);
}

// The player's n-th choice. Sent twice (a retry after a lost answer), it is
// taken once. Out of step, the browser is told where the battle really
// stands (409, with the battle) and plays itself back to there.
async function act(userId, id, n, action) {
  const a = clean(action);
  let hook = null, practice = null;
  const out = await withTransaction(async client => {
    const s = await townOf(userId, (t, p) => client.query(t, p));
    const row = s && (await client.query('SELECT * FROM tactics_battles WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [id, s.id])).rows[0];
    if (!row) throw err(404, 'No such battle.');
    const done = row.actions.length;
    n = Number(n);
    if (Number.isInteger(n) && n < done && a && JSON.stringify(row.actions[n]) === JSON.stringify(a)) return { ...view(row), repeated: true };
    if (!a) throw err(400, 'That is not a move the game knows.', { battle: view(row) });
    if (n !== done) throw err(409, 'The battle has moved on.', { battle: view(row) });
    if (row.status !== 'active') throw err(400, 'That battle is over.', { battle: view(row) });
    if (done >= MAX_ACTIONS) throw err(400, 'That battle has gone on too long.', { battle: view(row) });
    const { state, bad } = E.replay(row.setup, row.actions);
    if (bad !== -1) throw err(500, 'The stored battle no longer replays.');
    if (!E.apply(state, a)) throw err(400, 'The rules do not allow that.', { battle: view(row) });
    const over = state.status !== 'active';
    const up = (await client.query(
      `UPDATE tactics_battles SET actions = actions || $2::jsonb, status=$3, result=$4, ended_at = CASE WHEN $5 THEN NOW() ELSE NULL END, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [row.id, JSON.stringify([a]), over ? state.status : 'active', over ? JSON.stringify(E.resultOf(state)) : null, over])).rows[0];
    // A dungeon's battle that has just ended is settled with its run, in this same transaction (lib/dungeons.js).
    if (over && up.source === 'dungeon' && up.dungeon_run_id) hook = await require('./dungeons').boardResolved(client, up, state);
    else if (up.source === 'dungeon' && up.dungeon_run_id) await client.query('UPDATE dungeon_runs SET last_action_at=NOW() WHERE id=$1', [up.dungeon_run_id]);
    // A practice battle that is won: what it would have taught, to show and not to keep.
    if (over && up.source !== 'dungeon' && state.status === 'victory') {
      practice = { sid: s.id, tier: up.tier, keys: (up.setup.enemies || []).map(e => e.key),
        units: state.units.filter(u => u.side === 'player' && u.citizen_id).map(u => ({ citizen_id: u.citizen_id, cls: u.cls, down: !!u.down })) };
    }
    return view(up, state);
  });
  // Once it has committed: injuries, the chronicle and the rest of an ending; and what the screen shows next.
  if (hook) {
    out.dungeon = await require('./dungeons').afterBoard(hook);
    out.rewards = out.dungeon.rewards || null;
    out.rolls = out.dungeon.rolls || [];
  } else if (practice) {
    const XP = require('./tactics_xp'), xp = XP.xpOf(practice.keys, practice.tier);
    out.rewards = { kept: false, xp, party: await XP.preview(practice.sid, practice.units, xp).catch(() => []) };
  }
  // Kept with the battle's record, so it can be read again.
  if (out.rewards || (out.rolls && out.rolls.length)) {
    await query(`UPDATE tactics_battles SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id=$1`, [out.id, JSON.stringify({ rewards: out.rewards || null, rolls: out.rolls || [] })]).catch(() => {});
  }
  return out;
}
async function leave(userId, id) {
  const s = await townOf(userId);
  // Walking out of a dungeon's battle is fleeing the dungeon: the run ends and half the loot is dropped.
  const mine = s && (await query(`SELECT source, status FROM tactics_battles WHERE id=$1 AND settlement_id=$2`, [id, s.id])).rows[0];
  if (mine && mine.source === 'dungeon' && mine.status === 'active') { const r = await require('./dungeons').flee(userId); return { ...(await get(userId, id)), dungeon: { run: r.run, ended: true } }; }
  const row = s && (await query(`UPDATE tactics_battles SET status='left', ended_at=NOW(), updated_at=NOW() WHERE id=$1 AND settlement_id=$2 AND status='active' RETURNING *`, [id, s.id])).rows[0];
  if (row) return view(row);
  return get(userId, id);       // already over (or not this town's: 404)
}

module.exports = { create, current, get, act, leave, view, clean, MAX_ACTIONS };
