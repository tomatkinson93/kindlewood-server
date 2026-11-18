// ═══════════════════════════════════════════════════════════════════════════
//  The guide (docs/PHASE_3_ONBOARDING.md): an elder of the player's species
//  who walks a new player through their first session, beat by beat.
//
//  A beat is one or two lines and, usually, one thing to do. The server
//  holds which beat a player is on and decides when it is done: either the
//  town shows it (a home stands, someone has the job), or a route noted it
//  (someone was moved into a home), or it is something that changes nothing
//  (a window opened), which the screen may report itself.
//
//  It never blocks: everything in the game works whatever the beat. The
//  tour can be skipped at any time, and skipping gives every gift the tour
//  would have given.
//
//    start(userId)                 a new town: the tour begins (routes/map.js)
//    view(userId)                  the beat to show, the elder, what is unlocked
//    advance(userId, key, did?)    past a beat with nothing to do, or one the screen reports
//    check(userId)                 has the town done what the beat asks? then on to the next
//    skip(userId) / replay(userId)
//    note(settlementId, key)       a route says "this happened" (lib/housing: moved_home)
//    holdsBeds(settlementId)       while the tour teaches moving in, homes do not fill themselves (lib/life.js)
//    finishNow(userId, siteId)     free, a few times, while the tour runs (building time)
//    later(userId, key)            a one-off line the first time something happens
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');
const RD = require('./resource_defs');

const CONFIG = {
  HOMES: 3,                       // homes the tour has the player build
  SCOUT_REWARD: { wealth: 30, food: 40 },   // what the first scout brings home
  HOLD_BEDS_DAYS: 2,              // an abandoned tour does not leave people homeless for ever
  PARTING_GIFT: { wealth: 100, food: 100 },
  FINISH_FREE: 6,                 // free "Finish now" during the tour
};
const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";

// The six elders. `hello` and `bye` are in their own voice; the rest of the
// script is shared for now (docs/PHASE_3_ONBOARDING.md §4.1).
const ELDERS = {
  Mice:    { name: 'Old Bramble',       hello: 'There you are! Welcome, welcome. I have been counting the days.', roofs: 'I have counted us twice: ten of us, and not one roof.', bye: 'A good first day. I do like a tidy day.' },
  Badgers: { name: 'Gran Holt',         hello: 'So you are the one in charge. Good. Welcome.', roofs: 'Ten of us, and no roof to speak of.', bye: 'A proper day\'s work. Do not expect praise every time.' },
  Otters:  { name: 'Uncle Reedy',       hello: 'Hello, hello! Welcome! Is it not a fine river?', roofs: 'Ten of us, a fine river, and nowhere dry to sleep.', bye: 'What a day! I am off to look at the water. You have done well.' },
  Moles:   { name: 'Deepa Loam',        hello: 'You came. Good. Welcome.', roofs: 'Ten of us. No homes yet.', bye: 'Enough for one day. It was well done.' },
  Foxes:   { name: 'Aunt Russet',       hello: 'Ah, our clever new leader. Welcome, my dear.', roofs: 'Ten of us, and not a roof between us. A bargain waiting to be struck.', bye: 'Well played. I shall be watching how you spend tomorrow.' },
  Hares:   { name: 'Thistle the Elder', hello: 'There you are, at last! Welcome!', roofs: 'Ten of us, no roofs, and the day is running.', bye: 'Done, and quicker than I feared. Catch your breath.' },
};
const elderOf = species => ELDERS[species] || ELDERS.Mice;

// ── The first session ──────────────────────────────────────────────────────
// say: the lines ({town}, {elder}, {a}, {a_partner}, {b}, {scout}, {hello},
//   {roofs}, {bye}, {tomorrow} are filled from the real town).
// point: what the screen rings (a named target, not a selector).
// until: what completes it. `client:` beats are reported by the screen
//   (they change nothing); the rest are checked here.
// area: the part of Home the beat happens in; the screen leads there first.
// when: 'building_time' → only where buildings take time and need a builder.
// give: a gift handed over as the beat begins. giveAt: the line (from 0) at which the elder hands it over,
//   so the screen can say "You received…" under that line and not before.
// A beat with no lines is a quiet wait: the chip says what is being waited for.
const BEATS = [
  { key: 'arrival', say: ['{hello}', 'This is {town}. I am {elder}, and I will show you about. It will not take long.'] },
  { key: 'look', say: ['Drag the view to look about. Those are your people. Press one of them.'], point: 'villager:any', until: 'client:selected:villager', hint: 'Press a villager' },
  { key: 'family', say: ['Everyone here belongs to a family. Press Family to see theirs.'], point: 'villager-menu:family', until: 'client:opened:families', hint: 'Press a villager, then Family' },
  { key: 'builder', when: 'building_time', say: ['Nothing gets built here without a builder.', 'Press {a}, choose Work, and give them the Builder\'s job.'], point: 'villager-menu:work', until: 'job:builder', hint: 'Make someone a builder' },
  { key: 'homes_gift', give: 'homes', giveAt: 1, say: ['{roofs}', 'So, roofs first. Here is timber and stone enough for three homes: my gift.', 'Homes go in the Neighbourhood. Press it, and walk over.'], point: 'building:neighbourhood', until: 'client:area:neighbourhood', hint: 'Go to the Neighbourhood' },
  { key: 'first_home', area: 'neighbourhood', say: ['Press Build, then an empty plot, and choose how the home should look.'], point: 'tool:build', until: 'homes:1', hint: 'Build a home' },
  { key: 'more_homes', area: 'neighbourhood', say: ['That is four beds. We are ten: two more homes, if you please.'], point: 'plot:any', until: 'homes:' + CONFIG.HOMES, hint: 'Build two more homes' },
  { key: 'move_in', area: 'neighbourhood', say: ['Three roofs, and nobody under them yet. Who lives where is yours to say.', 'Press a home, and use Move in to bring someone under its roof.'], point: 'house:any', until: 'note:moved_home', hint: 'Open a home and move someone in' },
  { key: 'scout_post', area: 'town', say: ['Good. The rest have found beds of their own; you can move anyone, any time.', 'Now: what lies beyond the camp? Walk back to town.', 'Press Build, then an empty plot, and choose the Scout Post.'], point: 'tool:build', until: 'built:scout_post', hint: 'Build a Scout Post' },
  { key: 'scout_job', say: ['A post wants a scout. Press {b}, choose Work, and give them the Scout\'s job.'], point: 'villager-menu:work', until: 'job:scout', hint: 'Make someone a scout' },
  { key: 'send', say: ['Now open The Land: the country around us. The mist is what nobody has seen yet.', 'Press a misty tile beside the camp, and dispatch your scout.'], point: 'land:fog', until: 'scout:sent', hint: 'On The Land, send your scout into the mist' },
  { key: 'families', say: ['{scout} is on the way, and will not be long.', 'Meanwhile, look in on the Families: who is courting, who is expecting.'], point: 'place:families', until: 'client:place:families', hint: 'Open Families' },
  { key: 'away', say: [], until: 'scout:back', hint: '{scout} is out scouting' },
  { key: 'back', give: 'scout', say: ['{scout} is back, and not empty-handed.', 'Open The Land again, and see what the mist was hiding.'], point: 'place:land', until: 'client:place:land', hint: 'Open The Land' },
  { key: 'moment', start: 'moment', say: ['Someone wants a word with you. It is yours to decide, and nothing here is wrong.', 'Press the card that has appeared.'], point: 'moment:first', until: 'moment:answered', hint: 'Press the waiting card and answer' },
  { key: 'goodbye', give: 'parting', giveAt: 2, say: ['{bye}', 'By tomorrow: {tomorrow}', 'Here is a little something for the stores. I will be about if you want me.'] },
];
// The beats during which homes are left for the player to fill (see holdsBeds).
const HOME_BEATS = ['arrival', 'look', 'family', 'builder', 'homes_gift', 'first_home', 'more_homes', 'move_in'];
const beat = key => BEATS.find(b => b.key === key) || null;

// One-off lines, the first time a thing happens (the screen says when).
const LATER = {
  merchant: ['A travelling merchant! Press the cart. Each trade can be made once, and they leave at dawn.'],
  lost: ['Someone has lost something today. If you spot it lying about, press it to give it back.'],
  broken: ['That building is broken, and gives nothing until a builder mends it. Press it for Repair now.'],
  road: ['A Tavern! That opens The Road: quests, battles and trade beyond our walls.'],
  clan: ['A Guild Hall. Now The Clan is open to you: neighbours to stand with.'],
  raid: ['Raiders are on their way. Open The Land to see when, and who can stand watch.'],
  season: ['The season is turning. The fields, the stores and the moments that come to you all change with it.'],
  birth: ['A child is born! Open Families to see whose.'],
};

class GuideError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const first = n => String(n || '').split(' ')[0] || 'someone';

// ── Pure rules ─────────────────────────────────────────────────────────────
// The beats a town will meet, in order. `ctx`: { building_time }.
const beatsFor = ctx => BEATS.filter(b => !b.when || (b.when === 'building_time' && ctx && ctx.building_time));
// The beat after `key` (or the first), or null at the end.
function nextBeat(key, ctx) {
  const list = beatsFor(ctx), i = list.findIndex(b => b.key === key);
  return key == null ? list[0] : i < 0 ? list[0] : list[i + 1] || null;
}
// A line with its names filled in; a name that is missing reads plainly.
function fill(line, names) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => (names && names[k] != null && names[k] !== '' ? names[k] : { a: 'one of them', b: 'one of them', scout: 'Your scout', a_partner: 'their partner' }[k] || ''));
}
// What the gifts are worth together (for a skip). `given`: keys already given.
function owed(given, gifts) {
  const out = {};
  for (const [k, g] of Object.entries(gifts)) if (!(given || []).includes(k)) for (const [r, v] of Object.entries(g || {})) out[r] = (out[r] || 0) + v;
  return out;
}

// ── The town ───────────────────────────────────────────────────────────────
const townOf = async (q, userId) => (await q('SELECT s.*, u.species AS user_species, u.username FROM settlements s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1', [userId])).rows[0] || null;
const rowOf = async (q, userId) => (await q('SELECT * FROM guide_progress WHERE user_id = $1', [userId])).rows[0] || null;
const buildingTime = s => require('./construction').enabled(s).catch(() => false);
async function give(q, sid, res) {
  const keys = Object.keys(res || {}).filter(k => RD.isResource(k) && res[k] > 0);
  if (keys.length) await q(`UPDATE settlements SET ${keys.map((k, i) => `${k} = ${k} + $${i + 2}`).join(', ')} WHERE id = $1`, [sid, ...keys.map(k => Math.round(res[k]))]);
  return Object.fromEntries(keys.map(k => [k, Math.round(res[k])]));
}
// What three homes cost this town now (each costs more than the last).
async function homesGift(sid, have = 0) {
  const N = require('./neighbourhoods'), out = {};
  for (let i = have; i < CONFIG.HOMES; i++) for (const [r, v] of Object.entries(await N.nextCost(sid, i))) out[r] = (out[r] || 0) + v;
  return out;
}
async function gifts(q, s) {
  const homes = Number((await q('SELECT COUNT(*)::int AS n FROM houses WHERE settlement_id = $1', [s.id])).rows[0].n);
  return { homes: await homesGift(s.id, homes), scout: CONFIG.SCOUT_REWARD, parting: CONFIG.PARTING_GIFT };
}
// Who the lines name: someone with a partner, a forager for the first job.
async function cast(q, sid) {
  const cs = (await q(`SELECT id, name, role, partner_id, life_stage FROM citizens WHERE settlement_id = $1 AND ${LIVING} ORDER BY id`, [sid])).rows;
  const grown = cs.filter(c => (c.life_stage || 'adult') === 'adult');
  const a = grown.find(c => c.partner_id) || grown[0] || cs[0] || null;
  const partner = a && a.partner_id ? cs.find(c => c.id === Number(a.partner_id)) : null;
  const b = grown.find(c => (c.role === 'forager' || c.role === 'idle' || !c.role) && (!a || c.id !== a.id) && (!partner || c.id !== partner.id)) || grown.find(c => !a || c.id !== a.id) || a;
  return { a: a ? { id: a.id, name: a.name } : null, a_partner: partner ? { id: partner.id, name: partner.name } : null, b: b ? { id: b.id, name: b.name } : null };
}
// What will have happened by tomorrow, from the real town.
async function tomorrow(q, s) {
  const bits = [];
  if ((await q("SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = 'lumber_camp'", [s.id])).rows.length) bits.push('the Lumber Camp will have filled the timber store');
  else bits.push('the stores will have filled a little (a Lumber Camp would fill them faster)');
  const pair = (await q(`SELECT a.name AS a, b.name AS b FROM citizen_relationships r JOIN citizens a ON a.id = r.citizen_a_id JOIN citizens b ON b.id = r.citizen_b_id
                          WHERE r.settlement_id = $1 AND r.state NOT IN ('partners') AND a.partner_id IS NULL AND b.partner_id IS NULL ORDER BY r.score DESC LIMIT 1`, [s.id]).catch(() => ({ rows: [] }))).rows[0];
  if (pair) bits.push(`${first(pair.a)} and ${first(pair.b)} may have grown closer`);
  try { const M = require('./merchant'), { gameDay } = require('./social'); const d = gameDay(Date.now()).day, n = M.nextVisit(s.id, d) - d; bits.push(n <= 1 ? 'a merchant\'s cart is due' : `a merchant is due in ${n} days`); } catch (e) { /* none */ }
  bits.push('someone will want a word with you');
  return bits.slice(0, 3).join('; ') + '.';
}
// Has the town done what `until` asks?
async function met(q, s, until, data) {
  const [kind, arg] = String(until || '').split(':');
  const has = async (sql, p) => (await q(sql, p)).rows.length > 0;
  if (kind === 'homes') return Number((await q('SELECT COUNT(*)::int AS n FROM houses WHERE settlement_id = $1', [s.id])).rows[0].n) >= Number(arg);
  if (kind === 'built') return has('SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = $2 AND level > 0', [s.id, arg]);
  if (kind === 'job') return has(`SELECT 1 FROM citizens WHERE settlement_id = $1 AND role = $2 AND ${LIVING}`, [s.id, arg]);
  if (kind === 'note') return (data.notes || []).includes(arg);
  if (kind === 'scout') {
    // A scout sent since the tour began; "back" once that trip is finished (the worker finishes them, and so does this).
    const since = data.began || new Date(0).toISOString();
    if (arg === 'sent') return has('SELECT 1 FROM expeditions WHERE settlement_id = $1 AND started_at >= $2', [s.id, since]);
    if (await has("SELECT 1 FROM expeditions WHERE settlement_id = $1 AND started_at >= $2 AND status = 'complete'", [s.id, since])) return true;
    return false;
  }
  if (kind === 'moment') return has('SELECT 1 FROM moments WHERE settlement_id = $1 AND resolved_at IS NOT NULL AND NOT COALESCE(auto, FALSE) AND resolved_at >= $2', [s.id, data.began || new Date(0).toISOString()]);
  return false;
}
// Entering a beat: its gift, and anything it starts.
async function enter(q, s, b, data) {
  const out = {};
  if (b.give && !(data.given || []).includes(b.give)) {
    out.given = await give(q, s.id, (await gifts(q, s))[b.give]);
    data.given = (data.given || []).concat(b.give);
    (data.gifts = data.gifts || {})[b.give] = out.given;   // so the box can say what was received, again if asked
  }
  if (b.start === 'moment') out.startMoment = true;   // after the transaction (lib/moments has its own)
  (data.beats = data.beats || {})[b.key] = new Date().toISOString();
  return out;
}
// Something to answer, now: whatever is already waiting, or else the tour's own first moment (lib/moments_guide.js),
// which can always start. Asked by the villager the tour has been naming, where there is one.
async function startMoment(sid, askerId = null) {
  try {
    const M = require('./moments');
    if ((await M.open(sid)).length) return;
    await M.start(sid, 'guide_first_evening', { args: { asker_id: askerId } });
  } catch (e) { console.error('[guide] moment:', e.message); }
}
// The scout the tour is waiting on: their trip, newest first. → { name, back_at, status } or null.
async function scoutTrip(q, s, data) {
  const r = (await q(`SELECT e.status, e.completes_at, c.name FROM expeditions e LEFT JOIN citizens c ON c.id = e.citizen_id
                       WHERE e.settlement_id = $1 AND e.started_at >= $2 ORDER BY e.id DESC LIMIT 1`, [s.id, data.began || new Date(0).toISOString()]).catch(() => ({ rows: [] }))).rows[0];
  return r ? { name: r.name || '', back_at: r.completes_at, status: r.status } : null;
}
const mark = (userId, key) => require('./milestones').mark(userId, key).catch(() => {});

// ── What the screen is told ────────────────────────────────────────────────
async function present(q, userId, row, s, extra = {}) {
  const species = s.user_species && ELDERS[s.user_species] ? s.user_species : 'Mice', e = elderOf(species);
  const has = async type => (await q('SELECT 1 FROM buildings WHERE settlement_id = $1 AND type = $2', [s.id, type])).rows.length > 0;
  // The Road opens with a Tavern and The Clan with a Guild Hall, for towns founded with the tour; older towns have everything.
  const gated = !!(row && row.data && row.data.unlock);
  const unlock = { road: !gated || await has('tavern'), clan: !gated || await has('guild_hall') };
  const out = { state: row ? row.state : 'none', elder: { name: e.name, species }, unlock, ...extra };
  if (!row || row.state !== 'active') return out;
  const data = row.data || {}, bt = await buildingTime(s), list = beatsFor({ building_time: bt }), b = beat(row.step) || list[0];
  const names = { town: s.name, elder: e.name, hello: e.hello, bye: e.bye,
    a: data.cast && data.cast.a ? first(data.cast.a.name) : '', a_partner: data.cast && data.cast.a_partner ? first(data.cast.a_partner.name) : '', b: data.cast && data.cast.b ? first(data.cast.b.name) : '',
    roofs: e.roofs, scout: '', tomorrow: b.key === 'goodbye' ? await tomorrow(q, s) : '' };
  const trip = ['send', 'families', 'away', 'back'].includes(b.key) ? await scoutTrip(q, s, data) : null;
  names.scout = trip && trip.name ? first(trip.name) : names.b;
  out.beat = { key: b.key, n: list.findIndex(x => x.key === b.key) + 1, of: list.length, say: b.say.map(l => fill(l, names)), point: b.point || null, area: b.area || null, hint: b.hint ? fill(b.hint, names) : null,
    until: b.until || null, client: !!(b.until && b.until.startsWith('client:')), who: { a: data.cast && data.cast.a ? data.cast.a.id : null, b: data.cast && data.cast.b ? data.cast.b.id : null },
    // What this beat gave (said under the elder's line), and when a quiet wait should end.
    gift: b.give && data.gifts && data.gifts[b.give] && Object.keys(data.gifts[b.give]).length ? data.gifts[b.give] : null, gift_at: b.giveAt || 0,
    wait_until: b.key === 'away' && trip && trip.status === 'travelling' ? trip.back_at : null };
  // Free "Finish now" while the tour runs (building time): what could be finished, and how many are left.
  out.finish = { left: Math.max(0, CONFIG.FINISH_FREE - (data.finish_used || 0)), sites: [] };
  if (bt && out.finish.left) {
    try { out.finish.sites = (await q("SELECT id, kind, building_type FROM construction_sites WHERE settlement_id = $1 AND status = 'open' ORDER BY position, id LIMIT 3", [s.id])).rows.map(r => ({ id: r.id, kind: r.kind, type: r.building_type })); } catch (err) { out.finish.sites = []; }
  }
  return out;
}

async function start(userId, opts = {}) {
  const s = await townOf(query, userId);
  if (!s) return null;
  const c = await cast(query, s.id), b = beatsFor({ building_time: await buildingTime(s) })[0];
  const data = { unlock: true, cast: c, began: new Date().toISOString(), beats: { [b.key]: new Date().toISOString() }, given: [], notes: [] };
  await query(`INSERT INTO guide_progress (user_id, step, state, data) VALUES ($1,$2,'active',$3)
               ON CONFLICT (user_id) DO ${opts.replay ? "UPDATE SET step = $2, state = 'active', updated_at = NOW(), data = guide_progress.data || jsonb_build_object('cast', $3::jsonb->'cast', 'began', $3::jsonb->'began', 'notes', '[]'::jsonb)" : 'NOTHING'}`, [userId, b.key, JSON.stringify(data)]);
  mark(userId, 'guide_started');
  return view(userId);
}
async function view(userId) {
  const s = await townOf(query, userId);
  if (!s) throw new GuideError('No settlement.', 404);
  return present(query, userId, await rowOf(query, userId), s);
}

// Moves a player on from the beat they are on. `test(b, data)` says whether they may.
async function step(userId, test) {
  const after = [];
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = await townOf(q, userId);
    if (!s) throw new GuideError('No settlement.', 404);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [s.id]);
    const row = (await q('SELECT * FROM guide_progress WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!row || row.state !== 'active') return present(q, userId, row, s);
    const data = row.data || {}, ctx = { building_time: await buildingTime(s) };
    let b = beat(row.step) || beatsFor(ctx)[0];
    const just = [];
    // One beat at a time for the player; but beats the town has already done are passed without stopping.
    for (let i = 0; i < BEATS.length + 1; i++) {
      const ok = i === 0 ? await test(b, data, q, s) : !!(b.until && !b.until.startsWith('client:') && await met(q, s, b.until, data));
      if (!ok) break;
      mark(userId, 'guide:' + b.key);
      // Someone was moved in by hand: the rest find their own beds now (homes were held for the player until here).
      if (b.key === 'move_in') after.push(() => require('./life').autoHouse(s.id).catch(e => console.error('[guide] beds:', e.message)));
      const nx = nextBeat(b.key, ctx);
      if (!nx) {
        await q("UPDATE guide_progress SET state = 'done', data = $2, updated_at = NOW() WHERE user_id = $1", [userId, JSON.stringify(data)]);
        mark(userId, 'guide_done');
        return present(q, userId, { ...row, state: 'done', data }, s, { just, finished: true });
      }
      const e = await enter(q, s, nx, data);
      if (e.given && Object.keys(e.given).length) just.push({ beat: nx.key, given: e.given });
      if (e.startMoment) after.push(() => startMoment(s.id, data.cast && data.cast.a ? data.cast.a.id : null));
      if (nx.key === 'scout_post') mark(userId, 'guide_homes');
      b = nx;
    }
    await q('UPDATE guide_progress SET step = $2, data = $3, updated_at = NOW() WHERE user_id = $1', [userId, b.key, JSON.stringify(data)]);
    return present(q, userId, { ...row, step: b.key, data }, s, { just });
  });
  for (const f of after) await f();
  return out;
}
// Past a beat with nothing to do (its key must be the one they are on), or
// one the screen reports (`did` must be what the beat waits for).
const advance = (userId, key, did = null) => step(userId, async b => {
  if (b.key !== key) return false;
  if (!b.until) return true;
  return b.until.startsWith('client:') && did === b.until.slice(7);
});
// Has the town done what the beat asks?
async function check(userId) {
  // Outside the tour's own transaction: both of these take locks of their own.
  try {
    const row = await rowOf(query, userId);
    if (row && row.state === 'active' && ['send', 'families', 'away'].includes(row.step)) {
      const s = await townOf(query, userId);
      if (s && (await query("SELECT 1 FROM expeditions WHERE settlement_id = $1 AND status = 'travelling' AND completes_at <= NOW() LIMIT 1", [s.id])).rows.length) {
        await require('../routes/expeditions').completeExpeditions(s.id, userId);
      }
    } else if (row && row.state === 'active' && row.step === 'moment') {
      // The one that was waiting may have run out and been decided for them: there is always one to answer.
      const s = await townOf(query, userId);
      if (s) await startMoment(s.id, row.data && row.data.cast && row.data.cast.a ? row.data.cast.a.id : null);
    }
  } catch (e) { console.error('[guide] check:', e.message); }
  return step(userId, async (b, data, q, s) => !!(b.until && !b.until.startsWith('client:') && await met(q, s, b.until, data)));
}

async function skip(userId) {
  let sid = null;
  const out = await withTransaction(async c => {
    const q = (t, p) => c.query(t, p);
    const s = await townOf(q, userId);
    if (!s) throw new GuideError('No settlement.', 404);
    await q('SELECT id FROM settlements WHERE id = $1 FOR UPDATE', [s.id]);
    const row = (await q('SELECT * FROM guide_progress WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!row || row.state !== 'active') return present(q, userId, row, s);
    const data = row.data || {}, all = await gifts(q, s);
    const given = await give(q, s.id, owed(data.given, all));
    data.given = Object.keys(all);
    await q("UPDATE guide_progress SET state = 'skipped', data = $2, updated_at = NOW() WHERE user_id = $1", [userId, JSON.stringify(data)]);
    mark(userId, 'guide_skipped');
    sid = s.id;
    return present(q, userId, { ...row, state: 'skipped', data }, s, { just: Object.keys(given).length ? [{ beat: 'skip', given }] : [], skipped: true });
  });
  // Homes were being left for the player to fill: with the tour over, everyone finds a bed.
  if (sid) await require('./life').autoHouse(sid).catch(e => console.error('[guide] beds:', e.message));
  return out;
}
// Again from the start. Gifts already given are not given twice, and beats the town has done are passed as they come.
async function replay(userId) {
  if (!(await rowOf(query, userId))) await query("INSERT INTO guide_progress (user_id, step, state, data) VALUES ($1,'arrival','done','{}') ON CONFLICT DO NOTHING", [userId]);
  return start(userId, { replay: true });
}
// A route says something happened in this town (kept until the tour ends).
async function note(settlementId, key) {
  try {
    await query(`UPDATE guide_progress g SET data = jsonb_set(g.data, '{notes}', COALESCE(g.data->'notes', '[]'::jsonb) || to_jsonb($2::text)), updated_at = NOW()
                  FROM settlements s WHERE s.id = $1 AND g.user_id = s.user_id AND g.state = 'active' AND NOT COALESCE(g.data->'notes', '[]'::jsonb) ? $2`, [settlementId, key]);
  } catch (e) { if (!(e && e.code === '42P01')) console.error('[guide] note:', e.message); }
}

// While the tour is teaching "who lives where is yours to say", new homes are not filled by themselves
// (lib/life.js autoHouse asks here). Only for a town founded with the tour, only until the player has moved
// someone in by hand, and never for longer than HOLD_BEDS_DAYS: a tour left half-way leaves nobody homeless.
async function holdsBeds(settlementId, q = query) {
  try {
    return (await q(`SELECT 1 FROM guide_progress g JOIN settlements s ON s.user_id = g.user_id
                      WHERE s.id = $1 AND g.state = 'active' AND g.step = ANY($2) AND COALESCE((g.data->>'unlock')::boolean, FALSE)
                        AND NOT COALESCE(g.data->'notes', '[]'::jsonb) ? 'moved_home'
                        AND g.started_at > NOW() - make_interval(days => $3)`, [settlementId, HOME_BEATS, CONFIG.HOLD_BEDS_DAYS])).rows.length > 0;
  } catch (e) { if (!(e && e.code === '42P01')) console.error('[guide] beds:', e.message); return false; }
}

// ── Finish now (building time), free while the tour runs ───────────────────
async function finishNow(userId, siteId) {
  const s = await townOf(query, userId);
  if (!s) throw new GuideError('No settlement.', 404);
  const used = await withTransaction(async c => {
    const row = (await c.query('SELECT * FROM guide_progress WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!row || row.state !== 'active') throw new GuideError('The tour has ended: builders finish things in their own time now.', 409);
    const n = (row.data.finish_used || 0) + 1;
    if (n > CONFIG.FINISH_FREE) throw new GuideError('That was the last of my help with the building. The builders will see to the rest.', 409);
    await c.query('UPDATE guide_progress SET data = jsonb_set(data, \'{finish_used}\', to_jsonb($2::int)), updated_at = NOW() WHERE user_id = $1', [userId, n]);
    return n;
  });
  const CN = require('./construction');
  try { await CN.finishNow(s.id, siteId == null ? null : Number(siteId)); }
  catch (e) {
    // Nothing was finished: the help is not used up.
    await query('UPDATE guide_progress SET data = jsonb_set(data, \'{finish_used}\', to_jsonb($2::int)) WHERE user_id = $1', [userId, used - 1]);
    if (e instanceof CN.SiteError) throw new GuideError(e.message, e.status || 400);
    throw e;
  }
  return check(userId);
}

// ── One-off lines later ────────────────────────────────────────────────────
async function later(userId, key) {
  if (!LATER[key]) throw new GuideError('Nothing to say about that.', 404);
  const s = await townOf(query, userId);
  if (!s) throw new GuideError('No settlement.', 404);
  const r = await query(`UPDATE guide_progress SET data = jsonb_set(data, '{later}', COALESCE(data->'later', '[]'::jsonb) || to_jsonb($2::text)), updated_at = NOW()
                          WHERE user_id = $1 AND state <> 'active' AND NOT COALESCE(data->'later', '[]'::jsonb) ? $2 RETURNING user_id`, [userId, key]);
  const e = elderOf(s.user_species);
  return { say: r.rows.length ? LATER[key].map(l => fill(l, { town: s.name, elder: e.name })) : null, elder: { name: e.name, species: ELDERS[s.user_species] ? s.user_species : 'Mice' } };
}

module.exports = { CONFIG, ELDERS, BEATS, LATER, GuideError, elderOf, beatsFor, nextBeat, fill, owed, HOME_BEATS, start, view, advance, check, skip, replay, note, holdsBeds, finishNow, later };
