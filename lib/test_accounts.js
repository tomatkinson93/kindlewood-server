// ═══════════════════════════════════════════════════════════════════════════
//  Test accounts — a fresh account from one button on the login screen, for
//  trying the game as a new player without registering each time. Signing
//  out deletes it; one that is never signed out is cleared after a few days.
//
//  The button is the same as registering (anyone may register), so it gives
//  nothing a new account does not have. It is on a switch
//  (`test_login.on`, Dev Tools → Life → switches; on by default while the
//  game is in closed testing) and rate limited by the route.
//
//    available()          is the button offered
//    create()             → { userId, username } (species still to be chosen)
//    purge(userId)        delete the account and everything of its town;
//                         refuses anything that is not a test account
//    sweep(now)           delete test accounts older than KEEP_DAYS
//
//  Deleting: the schema has grown by many hands and not every table names
//  its owner with ON DELETE CASCADE. So purge does not keep a list of
//  tables. It asks the database for every column that names a town or a
//  player (…settlement_id, …user_id), deletes those rows, and when the
//  database refuses a delete because something still points at a row, it
//  reads which table that was from the refusal, clears that first and tries
//  again. Shared things that only point at the town are let go, not deleted
//  (a map tile, a clan's claim on land).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const TU = require('./tuning');

const CONFIG = {
  KEEP_DAYS: 3,          // a test account never signed out is cleared after this
  SWEEP_EVERY_MS: 3600e3,
  MAX_STEPS: 400,        // deletes one purge may make before it gives up
};
// Shared rows: the town's mark is taken off, the row stays.
const LET_GO = { tiles: true, clan_territory: true };
// Columns that name a town or a player.
const OWNED = /(^|_)(settlement_id|user_id)$/;
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(String(s))) throw new Error('bad name: ' + s); return '"' + s + '"'; };

class TestAccountError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const available = () => TU.switchOn('test_login.on').catch(() => false);

async function create() {
  if (!(await available())) throw new TestAccountError('Test accounts are switched off.', 403);
  const tag = crypto.randomBytes(4).toString('hex');
  const username = `Tester_${tag}`, email = `test_${tag}@test.kindlewood.invalid`;
  const hash = await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 6);   // nobody signs in to it by password
  return withTransaction(async c => {
    const u = (await c.query("INSERT INTO users (username, email, password_hash, species, is_test) VALUES ($1,$2,$3,'pending',TRUE) RETURNING id", [username, email, hash])).rows[0];
    await c.query('INSERT INTO settlements (user_id, name) VALUES ($1,$2)', [u.id, `${username}'s Camp`]);
    return { userId: u.id, username };
  });
}

// One delete that clears whatever stands in its way. `where` uses $1.
async function clear(c, state, table, where, id) {
  for (;;) {
    if (++state.steps > CONFIG.MAX_STEPS) throw new Error('test account purge: too many steps at ' + table);
    await c.query('SAVEPOINT kw_purge');
    try {
      await c.query(`DELETE FROM ${ident(table)} WHERE ${where}`, [id]);
      await c.query('RELEASE SAVEPOINT kw_purge');
      return;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT kw_purge');
      if (e.code !== '23503' || !e.constraint) throw e;
      // Something still points at these rows: find what, by the constraint the database named.
      const k = (await c.query(
        `SELECT cl.relname AS child, a.attname AS child_col, pl.relname AS parent, pa.attname AS parent_col
           FROM pg_constraint co
           JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_class pl ON pl.oid = co.confrelid
           JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
           JOIN pg_attribute pa ON pa.attrelid = co.confrelid AND pa.attnum = co.confkey[1]
          WHERE co.conname = $1 AND co.contype = 'f' AND pl.relname = $2 LIMIT 1`, [e.constraint, table])).rows[0];
      if (!k) throw e;
      const inner = `${ident(k.child_col)} IN (SELECT ${ident(k.parent_col)} FROM ${ident(table)} WHERE ${where})`;
      if (LET_GO[k.child]) await c.query(`UPDATE ${ident(k.child)} SET ${ident(k.child_col)} = NULL WHERE ${inner}`, [id]);
      else await clear(c, state, k.child, inner, id);
    }
  }
}

async function purge(userId) {
  userId = Number(userId);
  if (!Number.isInteger(userId)) return false;
  return withTransaction(async c => {
    const u = (await c.query('SELECT id, is_test FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!u || u.is_test !== true) return false;   // only ever a test account
    const s = (await c.query('SELECT id FROM settlements WHERE user_id = $1', [userId])).rows[0];
    const cols = (await c.query(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.data_type IN ('integer', 'bigint') ORDER BY c.table_name, c.column_name`)).rows
      .filter(r => OWNED.test(r.column_name) && r.table_name !== 'users' && !(r.table_name === 'settlements' && r.column_name === 'user_id'));
    const state = { steps: 0 };
    for (const r of cols) {
      const id = /user_id$/.test(r.column_name) ? userId : s && s.id;
      if (id == null) continue;
      const where = `${ident(r.column_name)} = $1`;
      if (LET_GO[r.table_name]) await c.query(`UPDATE ${ident(r.table_name)} SET ${ident(r.column_name)} = NULL WHERE ${where}`, [id]);
      else await clear(c, state, r.table_name, where, id);
    }
    if (s) await clear(c, state, 'settlements', '"id" = $1', s.id);
    await clear(c, state, 'users', '"id" = $1 AND is_test', userId);
    return true;
  });
}

let _swept = 0;
async function sweep(now = Date.now(), force = false) {
  if (!force && now - _swept < CONFIG.SWEEP_EVERY_MS) return 0;
  _swept = now;
  let n = 0;
  try {
    const old = (await query(`SELECT id FROM users WHERE is_test AND created_at < $1 ORDER BY id LIMIT 20`, [new Date(now - CONFIG.KEEP_DAYS * 86400e3).toISOString()])).rows;
    for (const u of old) { try { if (await purge(u.id)) n++; } catch (e) { console.error('[test accounts] sweep', u.id, e.message); } }
  } catch (e) { if (!(e && (e.code === '42703' || e.code === '42P01'))) console.error('[test accounts] sweep', e.message); }
  return n;
}

module.exports = { CONFIG, TestAccountError, available, create, purge, sweep, _OWNED: OWNED, _LET_GO: LET_GO };
