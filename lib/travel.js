// ══════════════════════════════════════════════════════════════════════════
//  TRAVEL — every citizen journey a player should see on their world map
//
//  GET /api/travel (routes/travel.js) returns these for the map's travel
//  path layer (frontend js/travel.js + js/kwmap-travel.js). A journey is:
//    { id, kind, citizen: { name, species }, from: {q,r}, to: {q,r},
//      departs_at, arrives_at, returns_at,   // returns_at null → one way
//      icon, title, detail, cargo?, incoming?, open }
//  Whose: the viewer's own citizens, plus other towns' merchants carrying
//  goods the viewer bought. Endpoints come from the server because the far
//  end is often under fog on the client.
//
//  Each source is its own function; one failing (e.g. a pre-migration
//  column) is logged and skipped so the others still show.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');

const iso = d => (d ? new Date(d).toISOString() : null);
const at = (q, r) => (q == null || r == null ? null : { q: Number(q), r: Number(r) });
const RD = require('./resource_defs');
const RES_LABEL = Object.fromEntries(RD.KEYS.map(k => [k, RD.label(k).toLowerCase()]));
// Text fallbacks only (Windows 10 can't draw 🪵 🪨); the map draws resource images.
const RES_ICON = { ...Object.fromEntries(RD.EXTRA.map(k => [k, RD.icon(k)])), food: '🍎', timber: '🌲', stone: '🧱', metal: '⚙️' };

// Splits a round trip [start, end] at its midpoint: out, then back.
function roundTrip(start, end) {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  return { departs_at: iso(a), arrives_at: iso(a + (b - a) / 2), returns_at: iso(b) };
}

// Where a quest takes its party on the map. Today only NPC-given quests have
// a place (the NPC's town); tavern quests return null and are not drawn.
// When quests get fixed map locations, read them here.
function questDestination(row) {
  return at(row.npc_q, row.npc_r);
}

async function marketJourneys(me, species) {
  const r = await query(
    `SELECT t.*, ss.name AS seller_name, ss.tile_q AS sq, ss.tile_r AS sr,
            bs.name AS buyer_name, bs.tile_q AS bq, bs.tile_r AS br,
            su.species AS seller_species, c.name AS citizen_name
       FROM market_trips t
       JOIN settlements ss ON ss.id = t.seller_settlement_id
       JOIN settlements bs ON bs.id = t.buyer_settlement_id
       JOIN users su ON su.id = ss.user_id
       LEFT JOIN citizens c ON c.id = t.citizen_id
      WHERE (t.seller_settlement_id = $1 AND t.status IN ('outbound','returning'))
         OR (t.buyer_settlement_id = $1 AND t.status = 'outbound')`, [me.id]);
  return r.rows.map(t => {
    const mine = t.seller_settlement_id === me.id;
    const it = t.kind === 'item' ? t.item_snapshot : null;
    const res = it ? (it.name || 'goods') : (RES_LABEL[t.resource] || t.resource);
    const base = {
      id: 'market:' + t.id, kind: 'market', icon: '⚖️', open: 'market',
      from: at(t.sq, t.sr), to: at(t.bq, t.br),
      departs_at: iso(t.departs_at), arrives_at: iso(t.arrives_at),
      cargo: { resource: t.resource, item: it ? it.name : null, qty: t.qty, icon: (it && it.icon) || RES_ICON[t.resource] || '📦' },
      citizen: { name: t.citizen_name || 'A merchant', species: (mine ? species : t.seller_species) || null },
    };
    if (mine) return {
      ...base, returns_at: iso(t.returns_at),
      title: it ? `Carrying ${t.qty}× ${res} to ${t.buyer_name}` : `Carrying ${t.qty} ${res} to ${t.buyer_name}`,
      detail: `Sold for ${t.gold_paid} gold · back home with ${t.gold_paid - t.fee} after the market fee`,
    };
    return {
      ...base, returns_at: null, incoming: true,
      title: it ? `Bringing you ${t.qty}× ${res} from ${t.seller_name}` : `Bringing you ${t.qty} ${res} from ${t.seller_name}`,
      detail: `You paid ${t.gold_paid} gold`,
    };
  }).filter(j => j.from && j.to);
}

async function scoutJourneys(me, species) {
  const r = await query(
    `SELECT e.*, c.name AS citizen_name FROM expeditions e
       LEFT JOIN citizens c ON c.id = e.citizen_id
      WHERE e.settlement_id = $1 AND e.status = 'travelling'`, [me.id]);
  return r.rows.map(e => {
    const p0 = Array.isArray(e.path) && e.path[0];
    return {
      id: 'scout:' + e.id, kind: 'scout', icon: '🗺', open: 'expeditions',
      citizen: { name: e.citizen_name || 'A scout', species },
      from: p0 ? at(p0.q, p0.r) : at(me.tile_q, me.tile_r), to: at(e.target_q, e.target_r),
      departs_at: iso(e.started_at), arrives_at: iso(e.completes_at), returns_at: null,
      title: `Scouting (${e.target_q}, ${e.target_r})`,
      detail: 'Reveals the land around the target on arrival',
    };
  }).filter(j => j.from && j.to);
}

async function envoyJourneys(me, species) {
  const r = await query(
    // to_jsonb(d): the pending_* columns only exist after the admin migrate
    // endpoint has run, so read them without naming them in SQL.
    `SELECT to_jsonb(d) AS d, n.name AS npc_name, n.tile_q AS nq, n.tile_r AS nr, c.name AS citizen_name
       FROM diplomacy_relations d
       JOIN npc_settlements n ON n.id = d.npc_id
       LEFT JOIN citizens c ON c.id = d.citizen_id
      WHERE d.settlement_id = $1 AND (d.status = 'contact_sent' OR to_jsonb(d)->>'pending_action' IS NOT NULL)`, [me.id]);
  return r.rows.map(row => {
    const d = { ...row.d, npc_name: row.npc_name, nq: row.nq, nr: row.nr, citizen_name: row.citizen_name };
    const pending = d.pending_action && d.pending_arrives_at;
    const sent = pending ? d.pending_sent_at : d.contact_sent_at;
    const arrives = pending ? d.pending_arrives_at : d.contact_arrives_at;
    const what = d.pending_action === 'gift' ? 'Taking a gift to' : d.pending_action === 'goodwill' ? 'Carrying goodwill to' : 'Envoy to';
    return {
      id: 'envoy:' + d.id, kind: 'envoy', icon: '📨', open: 'diplomacy',
      citizen: { name: d.citizen_name || 'An envoy', species },
      from: at(me.tile_q, me.tile_r), to: at(d.nq, d.nr),
      departs_at: iso(sent), arrives_at: iso(arrives), returns_at: null,
      title: `${what} ${d.npc_name}`,
      detail: 'Diplomatic mission',
    };
  }).filter(j => j.from && j.to && j.departs_at && j.arrives_at);
}

async function questJourneys(me, species) {
  const r = await query(
    `SELECT q.id, q.quest_id, q.citizen_id, q.party_ids, q.started_at, q.completes_at,
            qd.title, qd.icon, n.name AS npc_name, n.tile_q AS npc_q, n.tile_r AS npc_r, c.name AS citizen_name
       FROM settlement_quests q
       LEFT JOIN quest_definitions qd ON qd.id = q.quest_id
       LEFT JOIN npc_settlements n ON n.id = qd.given_by_npc_id
       LEFT JOIN citizens c ON c.id = COALESCE(q.citizen_id, (q.party_ids->>0)::int)
      WHERE q.settlement_id = $1 AND q.status = 'active'`, [me.id]);
  return r.rows.map(q => {
    const to = questDestination(q);
    if (!to) return null;
    const party = Array.isArray(q.party_ids) ? q.party_ids.length : 0;
    return {
      id: 'quest:' + q.id, kind: 'quest', icon: q.icon || '⚔️', open: 'quests',
      citizen: { name: (q.citizen_name || 'A party') + (party > 1 ? ` + ${party - 1}` : ''), species },
      from: at(me.tile_q, me.tile_r), to,
      ...roundTrip(q.started_at, q.completes_at),
      title: `${q.title || 'Quest'} for ${q.npc_name}`,
      detail: party > 1 ? `Party of ${party}` : 'Quest',
    };
  }).filter(j => j && j.from);
}

async function clanQuestJourneys(me, species) {
  const r = await query(
    `SELECT s.run_id, s.role_index, r.quest_key, r.started_at, r.completes_at, c.name AS citizen_name,
            cl.name AS clan_name, cl.hq_q, cl.hq_r
       FROM clan_quest_slots s
       JOIN clan_quest_runs r ON r.id = s.run_id
       JOIN clans cl ON cl.id = r.clan_id
       LEFT JOIN citizens c ON c.id = s.citizen_id
      WHERE s.settlement_id = $1 AND s.active AND r.status = 'active' AND r.started_at IS NOT NULL`, [me.id]);
  if (!r.rows.length) return [];
  let defs = [];
  try { defs = await require('./clan_quests').loadDefs(); } catch (_) {}
  return r.rows.map(x => {
    const def = defs.find(d => d.key === x.quest_key);
    return {
      id: `clan:${x.run_id}:${x.role_index}`, kind: 'clan_quest', icon: '🛡️', open: 'clan',
      citizen: { name: x.citizen_name || 'A clansfolk', species },
      from: at(me.tile_q, me.tile_r), to: at(x.hq_q, x.hq_r),
      ...roundTrip(x.started_at, x.completes_at),
      title: `${def ? def.title : 'Clan quest'} at the ${x.clan_name} hall`,
      detail: 'Clan quest',
    };
  }).filter(j => j.from && j.to);
}

// Porters: your own (Ironhaven runs, pickups) out and back, plus other
// towns' porters walking to your stalls (incoming, one way).
async function porterJourneys(me, species) {
  const r = await query(
    `SELECT m.*, c.name AS citizen_name, s.tile_q AS sq, s.tile_r AS sr, s.name AS from_name, u.species AS from_species
       FROM market_runs m
       JOIN settlements s ON s.id = m.settlement_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN citizens c ON c.id = m.citizen_id
      WHERE (m.settlement_id = $1 AND m.status IN ('outbound','returning'))
         OR (m.target_settlement_id = $1 AND m.status = 'outbound')`, [me.id]);
  return r.rows.map(m => {
    const mine = m.settlement_id === me.id;
    const it = m.item_snapshot || {};
    const what = m.resource && !m.item_snapshot ? `${m.qty} ${m.resource}` : `${m.qty}× ${it.name || 'goods'}`;
    const base = {
      id: 'run:' + m.id, kind: 'porter', icon: m.kind === 'ironhaven' ? '🏰' : '🧺', open: 'market',
      citizen: { name: m.citizen_name || 'A porter', species: (mine ? species : m.from_species) || null },
      from: at(m.sq, m.sr), to: at(m.target_q, m.target_r),
      departs_at: iso(m.departs_at), arrives_at: iso(m.arrives_at),
      cargo: { item: it.name || null, resource: m.resource || null, qty: m.qty, icon: it.icon || RES_ICON[m.resource] || '📦' },
    };
    if (m.kind === 'fill') base.icon = '📮';
    if (m.kind === 'npc') {
      return { ...base, icon: '🏘️', returns_at: iso(m.returns_at),
        title: m.side === 'buy' ? `Buying ${what} from ${m.target_name}` : `Selling ${what} to ${m.target_name}`,
        detail: m.side === 'buy' ? `Paid ${m.gold} gold · goods come home with the porter` : `Brings home ${m.gold} gold` };
    }
    if (!mine) return { ...base, returns_at: null, incoming: true,
      title: m.kind === 'fill' ? `Bringing you ${what} from ${m.from_name}` : `Coming from ${m.from_name} to buy ${what}`,
      detail: m.kind === 'fill' ? 'Filling your wanted order' : 'A porter collecting from your stall' };
    return { ...base, returns_at: iso(m.returns_at),
      title: m.kind === 'ironhaven' ? `Selling ${what} to ${m.target_name}`
        : m.kind === 'fill' ? `Delivering ${what} to ${m.target_name}` : `Collecting ${what} from ${m.target_name}`,
      detail: m.kind === 'pickup' ? `Paid ${m.gold} gold` : `Brings home ${m.kind === 'fill' ? m.gold - m.fee : m.gold} gold` };
  }).filter(j => j.from && j.to);
}

const SOURCES = { market: marketJourneys, porter: porterJourneys, scout: scoutJourneys, envoy: envoyJourneys, quest: questJourneys, clan_quest: clanQuestJourneys };

// All journeys for settlement `me` (a settlements row), soonest arrival first.
async function journeysFor(me, species) {
  if (!me || me.tile_q == null) return [];
  const sp = species ? String(species).toLowerCase() : null;
  const lists = await Promise.all(Object.entries(SOURCES).map(([name, fn]) =>
    fn(me, sp).catch(e => { console.error(`[travel] ${name} failed:`, e.message); return []; })));
  const out = [].concat(...lists);
  const end = j => new Date(j.returns_at || j.arrives_at).getTime();
  return out.filter(j => end(j) > Date.now() - 5000).sort((a, b) => end(a) - end(b));
}

module.exports = { journeysFor, questDestination, roundTrip, SOURCES };
