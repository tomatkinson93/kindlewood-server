// scripts/clan_phase3_test.js — checks for spec 016 Phase 3 (territory).
// Drives a running server over HTTP (same DATABASE_URL). Throwaway DB only.
//
// Usage:
//   DATABASE_URL=postgres://… CLAN_TEST_BASE=http://localhost:3999 \
//     node scripts/clan_phase3_test.js

'use strict';

const { Pool } = require('pg');
const BASE = process.env.CLAN_TEST_BASE || 'http://localhost:3000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, p) => pool.query(t, p);
const RUN = Math.random().toString(36).slice(2, 7);
let passed = 0, failed = 0, seq = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

let W, H;
const wrap = (v, n) => ((v % n) + n) % n;
// Axial neighbours, wrapped.
const nb = (x, y, i) => {
  const d = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]][i];
  return [wrap(x + d[0], W), wrap(y + d[1], H)];
};

async function player(name, home, { hall = false, reveal = 3 } = {}) {
  const username = `${name}${RUN}${seq++}`;
  const r = await api(null, 'POST', '/api/auth/register', { username, email: username + '@t.l', password: 'password123', species: 'Mice' });
  const u = (await q('SELECT id FROM users WHERE username=$1', [username])).rows[0];
  const s = (await q(`UPDATE settlements SET tile_q=$2, tile_r=$3, world_version=2, tier='town', wealth=9000
    WHERE user_id=$1 RETURNING id`, [u.id, home[0], home[1]])).rows[0];
  if (hall) await q("INSERT INTO buildings (settlement_id,type,level) VALUES ($1,'guild_hall',1)", [s.id]);
  for (let dq = -reveal; dq <= reveal; dq++) for (let dr = -reveal; dr <= reveal; dr++) {
    if (Math.abs(dq + dr) > reveal) continue;
    await q('INSERT INTO fog_of_war (user_id,tile_q,tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [u.id, wrap(home[0] + dq, W), wrap(home[1] + dr, H)]);
  }
  return { username, token: r.data.token, id: u.id, settlementId: s.id, home };
}
async function found(p) {
  const r = await api(p.token, 'POST', '/api/clans', { name: `T${RUN}${seq++}`, banner: { emblem: 'acorn', primary: 'river', secondary: 'wheat' } });
  if (r.status !== 200) throw new Error('found failed ' + JSON.stringify(r.data));
  return r.data.clan_id;
}
const fund = (clanId, level, prestige) => q('UPDATE clans SET level=$2, prestige=$3, prestige_lifetime=GREATEST(prestige_lifetime,$3) WHERE id=$1', [clanId, level, prestige]);
const claim = (p, t) => api(p.token, 'POST', '/api/clans/territory/claim', { q: t[0], r: t[1] });
const tilesOf = clanId => q('SELECT q, r FROM clan_territory WHERE clan_id=$1', [clanId]).then(r => r.rows);
// Home tiles whose whole neighbourhood (radius 4) is empty — no settlements,
// NPCs or clan land from this or earlier runs — and not near another home
// picked this run, so each test's tiles are its own.
const picked = [];
const disk = (x, y, rad) => {
  const out = [];
  for (let dq = -rad; dq <= rad; dq++) for (let dr = -rad; dr <= rad; dr++) {
    if (Math.abs(dq + dr) <= rad) out.push([wrap(x + dq, W), wrap(y + dr, H)]);
  }
  return out;
};
async function freeHome() {
  const busy = new Set((await q(`
    SELECT tile_q AS x, tile_r AS y FROM settlements WHERE tile_q IS NOT NULL
    UNION SELECT tile_q, tile_r FROM npc_settlements
    UNION SELECT (k->>'q')::int, (k->>'r')::int FROM npc_settlements, jsonb_array_elements(kingdom_tiles) k
    UNION SELECT q, r FROM clan_territory`)).rows.map(t => `${t.x},${t.y}`));
  for (const [x, y] of picked) for (const [a, b] of disk(x, y, 4)) busy.add(`${a},${b}`);
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    if (disk(x, y, 4).every(([a, b]) => !busy.has(`${a},${b}`))) { picked.push([x, y]); return [x, y]; }
  }
  throw new Error('Map is too crowded for isolated test homes — reset the test database.');
}

async function main() {
  const dims = (await q('SELECT map_w, map_h FROM world_meta WHERE id=1')).rows[0];
  W = dims.map_w; H = dims.map_h;
  console.log(`Clan Phase 3 tests against ${BASE} (${W}×${H}, run ${RUN})`);

  console.log('Founding & gates');
  const A = await player('a', await freeHome(), { hall: true });
  const ca = await found(A);
  const seed = await tilesOf(ca);
  check(seed.length === 1 && seed[0].q === A.home[0] && seed[0].r === A.home[1], 'founding seeds the HQ tile');
  const t1 = nb(...A.home, 0);
  const capped = await claim(A, t1);
  check(capped.status === 400 && /level/i.test(capped.data.error), 'level 1 (cap 1) → cannot claim beyond HQ');
  await fund(ca, 2, 60);
  const poor = await claim(A, t1);
  check(poor.status === 400 && /75 prestige/.test(poor.data.error), 'second tile costs 75; 60 prestige → 400');
  await fund(ca, 2, 1000);
  const ok1 = await claim(A, t1);
  check(ok1.status === 200 && ok1.data.cost === 75 && ok1.data.next_cost === 100, 'adjacent claim → 200, cost 75, next 100');
  check(Number((await q('SELECT prestige FROM clans WHERE id=$1', [ca])).rows[0].prestige) === 925, 'prestige deducted');
  const dup = await claim(A, t1);
  check(dup.status === 409, 'own tile again → 409');
  const far = await claim(A, [wrap(A.home[0] - 2, W), A.home[1]]);   // revealed, 2 from HQ
  check(far.status === 400 && /border/.test(far.data.error), 'non-adjacent → 400');

  const unseen = nb(...nb(...nb(...nb(...t1, 0), 0), 0), 0);   // 5 steps east of HQ
  await q('DELETE FROM fog_of_war WHERE user_id=$1 AND tile_q=$2 AND tile_r=$3', [A.id, ...nb(...t1, 0)]);
  const fog = await claim(A, nb(...t1, 0));
  check(fog.status === 400 && /explored/.test(fog.data.error), 'unrevealed target → 400');
  void unseen;

  console.log('Blocked tiles');
  const foreignHome = nb(...A.home, 3);
  const B = await player('b', foreignHome);
  const fh = await claim(A, foreignHome);
  check(fh.status === 400 && /settlement/.test(fh.data.error), "non-member's home → 400");
  const npcTile = nb(...A.home, 1);
  await q(`INSERT INTO npc_settlements (name, species, tier, tile_q, tile_r, disposition) VALUES ('Test Hamlet ${RUN}','Mice','village',$1,$2,'friendly')`, npcTile)
    .catch(async () => q(`INSERT INTO npc_settlements (name, tile_q, tile_r) VALUES ('Test Hamlet ${RUN}',$1,$2)`, npcTile));
  const npc = await claim(A, npcTile);
  check(npc.status === 400 && /NPC/.test(npc.data.error), 'NPC settlement → 400' + (npc.status === 400 && /NPC/.test(npc.data.error) ? '' : ` [${npc.status} ${JSON.stringify(npc.data)}]`));
  const annexHost = await freeHome();
  const annex = nb(...A.home, 2);
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, is_kingdom, kingdom_tiles) VALUES ('Test Crown ${RUN}',$1,$2,true,$3::jsonb)`,
    [annexHost[0], annexHost[1], JSON.stringify([{ q: annex[0], r: annex[1] }])]);
  const ann = await claim(A, annex);
  check(ann.status === 400 && /NPC/.test(ann.data.error), 'kingdom annex tile → 400');

  // Member's own home inside the target is allowed.
  const memberHome = nb(...A.home, 4);
  const Mh = await player('mh', memberHome);
  const iv = await api(A.token, 'POST', '/api/clans/invites', { username: Mh.username });
  await api(Mh.token, 'POST', `/api/clans/invites/${iv.data.invite_id}/accept`);
  const mine = await claim(A, memberHome);
  check(mine.status === 200, "a clanmate's home tile can be claimed");

  console.log('Permissions');
  const rc = await claim(Mh, nb(...A.home, 5));
  check(rc.status === 403, 'recruit cannot claim');
  await q("UPDATE clan_members SET rank='officer' WHERE user_id=$1", [Mh.id]);
  // officer needs the tile revealed on their own map
  const oc = await claim(Mh, nb(...A.home, 5));
  check(oc.status === 200, 'officer can claim (tile in their own revealed area)');

  console.log('Wrap seam');
  let seamHome = null;
  for (let y = 0; y < H && !seamHome; y++) {
    const busy = await q(`SELECT 1 FROM settlements WHERE tile_r=$1 AND tile_q IN (0,$2)
      UNION SELECT 1 FROM clan_territory WHERE r=$1 AND q IN (0,$2)
      UNION SELECT 1 FROM npc_settlements WHERE tile_r=$1 AND tile_q IN (0,$2)`, [y, W - 1]);
    if (!busy.rows.length) seamHome = [0, y];
  }
  if (!seamHome) { console.log('  skip  no free seam row'); } else {
    const S = await player('seam', seamHome, { hall: true });
    const cs = await found(S); await fund(cs, 2, 1000);
    const across = await claim(S, [W - 1, seamHome[1]]);
    check(across.status === 200, `claim across the wrap seam (q=0 → q=${W - 1}) → 200`);
  }

  console.log('Reach (claim radius by level)');
  const F = await player('f', await freeHome(), { hall: true });
  const cf = await found(F); await fund(cf, 2, 5000);
  const f1 = nb(...F.home, 0), f2 = nb(...f1, 0);            // 1 and 2 east of HQ
  const r1 = await claim(F, f1);
  check(r1.status === 200, 'level 2: tile 1 from the hall → 200');
  const r2 = await claim(F, f2);
  check(r2.status === 400 && /within 1 tile/.test(r2.data.error) && /level 3 reaches/.test(r2.data.error),
    'level 2: adjacent to owned land but 2 from the hall → 400 with the level that reaches it');
  await fund(cf, 3, 5000);
  const r3 = await claim(F, f2);
  check(r3.status === 200, 'level 3: same tile (radius 2) → 200');
  const me3 = await api(F.token, 'GET', '/api/clans/me');
  check(me3.data.territory.radius === 2, '/me reports the claim radius');

  console.log('Concurrency');
  const C = await player('c', await freeHome(), { hall: true });
  const cc = await found(C); await fund(cc, 2, 5000);
  for (const i of [0, 1]) {                                               // 3 of 4 tiles
    const r = await claim(C, nb(...C.home, i));
    if (r.status !== 200) throw new Error('setup claim failed: ' + JSON.stringify(r.data));
  }
  const race = await Promise.all([2, 3, 4].map(i => claim(C, nb(...C.home, i))));
  check(race.filter(r => r.status === 200).length === 1 && (await tilesOf(cc)).length === 4,
    'three parallel claims for the last slot → exactly one' + ` [${race.map(r => r.status + ' ' + (r.data.error || '')).join(' | ')}]`);

  const D = await player('d', await freeHome(), { hall: true });
  const E = await player('e', nb(...nb(...D.home, 0), 0), { hall: true });  // two east: shared neighbour nb(D,0)
  const cd = await found(D), ce = await found(E);
  await fund(cd, 2, 1000); await fund(ce, 2, 1000);
  const shared = nb(...D.home, 0);
  const both = await Promise.all([claim(D, shared), claim(E, shared)]);
  const owners = (await q('SELECT clan_id FROM clan_territory WHERE q=$1 AND r=$2', shared)).rows;
  check(both.map(r => r.status).sort().join() === '200,409' && owners.length === 1,
    'two clans claim one tile in parallel → one 200, one 409, one row');

  console.log('Connectivity');
  let connected = true;
  const clans = (await q('SELECT DISTINCT clan_id FROM clan_territory')).rows.map(r => r.clan_id);
  for (const id of clans) {
    const tiles = await tilesOf(id);
    const key = t => `${t.q},${t.r}`;
    const set = new Set(tiles.map(key)), seen = new Set([key(tiles[0])]), stack = [tiles[0]];
    while (stack.length) {
      const t = stack.pop();
      for (let i = 0; i < 6; i++) {
        const [x, y] = nb(t.q, t.r, i), k = `${x},${y}`;
        if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push({ q: x, r: y }); }
      }
    }
    if (seen.size !== set.size) connected = false;
  }
  check(connected, 'every clan is one connected component');

  console.log('/world payload');
  const world = await api(A.token, 'GET', '/api/map/world');
  const tiles = world.data.tiles;
  const at = (x, y) => tiles.find(t => t.q === x && t.r === y);
  const hq = at(...A.home);
  check(hq.clan_territory && hq.clan_territory.mine === true && /^#/.test(hq.clan_territory.primary), 'own HQ tile carries clan_territory (mine, hex colour)');
  const fogged = tiles.filter(t => t.terrain === 'fog');
  check(fogged.length > 0 && fogged.every(t => t.clan_territory === null), 'fogged tiles never carry clan_territory');
  const worldB = await api(B.token, 'GET', '/api/map/world');
  const bView = worldB.data.tiles.find(t => t.q === A.home[0] && t.r === A.home[1]);
  check(bView.clan_territory && bView.clan_territory.mine === false, "a neighbour sees the clan's tile as foreign");

  const me = await api(A.token, 'GET', '/api/clans/me');
  check(me.data.territory && me.data.territory.cap === 4 && me.data.territory.count === 4, '/me reports territory count and cap');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exitCode = failed ? 1 : 0;
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
