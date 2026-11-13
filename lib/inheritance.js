// ══════════════════════════════════════════════════════════════════════════
//  Death and inheritance (docs/PHASE_1_LIFE_CYCLE.md §4.4, §4.5, §4.8).
//
//    onDeath({ citizenId, settlementId, cause, at })   called by deaths.js for
//        every death: widows the partner, makes heirlooms of the gear, opens
//        an inheritance with the default heir, passes headship, and writes
//        the memorial or a gentle chronicle line.
//    candidates(settlementId, deceasedId)   who may inherit
//    choose(settlementId, deceasedId, heirId)   the player's answer; settles now
//    settleDue(settlementId)   settles open inheritances whose time is up with
//        their heir (the default unless the player chose): never punish being away
//    heirloomBonus(item, citizen)   +5%, +1% a generation, at most +10%, in the family
//
//  Default heir: the eldest adult child, then the partner, then the family
//  head. With no family left the gear simply stays in the town's stores.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const { query, withTransaction } = require('../db');

const CONFIG = {
  CHOOSE_HOURS: 24,          // how long the player has to pick another heir
  KNOWLEDGE_SHARE: 0.25,     // an heir in the same trade gains a quarter of the XP
  HEIRLOOM_BASE: 0.05,       // +5% for the first generation …
  HEIRLOOM_STEP: 0.01,       // … +1% for each one after …
  HEIRLOOM_MAX: 0.10,        // … at most +10%
  NOTABLE_LEVEL: 10,         // a class level that earns a memorial
};

const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";
const first = name => String(name || '').split(' ')[0] || 'Someone';
const arr = v => (Array.isArray(v) ? v : []);

// ── Heirlooms ───────────────────────────────────────────────────────────────
function heirloomBonus(item, citizen) {
  const h = item && item.metadata && item.metadata.heirloom;
  if (!h || !citizen || !h.family_id || Number(h.family_id) !== Number(citizen.family_id)) return 0;
  const gen = Math.max(1, Number(h.generations) || 1);
  return Math.min(CONFIG.HEIRLOOM_MAX, CONFIG.HEIRLOOM_BASE + CONFIG.HEIRLOOM_STEP * (gen - 1));
}

// ── Who inherits ────────────────────────────────────────────────────────────
// The living family, the partner and the children, with their relation.
async function candidates(settlementId, deceasedId, q = query) {
  const d = (await q('SELECT id, family_id, partner_id FROM citizens WHERE id = $1 AND settlement_id = $2', [deceasedId, settlementId])).rows[0];
  if (!d) return [];
  const rows = (await q(
    `SELECT id, name, role, born_at, life_stage, family_id, parent_ids, partner_id FROM citizens
      WHERE settlement_id = $1 AND ${LIVING} AND id <> $2
        AND (family_id = $3 OR id = $4 OR parent_ids @> $5::jsonb)
      ORDER BY born_at ASC, id ASC`,
    [settlementId, d.id, d.family_id, d.partner_id || 0, JSON.stringify([d.id])])).rows;
  return rows.map(r => ({
    id: r.id, name: r.name, role: r.role, adult: (r.life_stage || 'adult') === 'adult',
    relation: arr(r.parent_ids).map(Number).includes(Number(d.id)) ? 'child' : r.id === d.partner_id ? 'partner' : 'family',
  }));
}

async function defaultHeir(settlementId, deceasedId, q = query) {
  const list = await candidates(settlementId, deceasedId, q);
  const child = list.find(c => c.relation === 'child' && c.adult);   // eldest first (born_at ASC)
  if (child) return child.id;
  const partner = list.find(c => c.relation === 'partner');
  if (partner) return partner.id;
  const head = list.find(c => c.relation === 'family' && c.adult);   // the oldest living adult = the head
  if (head) return head.id;
  return list.length ? list[0].id : null;   // only children left: the eldest
}

// ── At a death ──────────────────────────────────────────────────────────────
async function onDeath({ citizenId, settlementId, cause = 'other', at = null }) {
  const LIFE = require('./life');
  const d = (await query('SELECT * FROM citizens WHERE id = $1 AND settlement_id = $2', [citizenId, settlementId])).rows[0];
  if (!d) return null;
  const now = at ? new Date(at).getTime() : Date.now();

  // Was this the family head (its oldest adult) before they died?
  const wasHead = d.family_id ? !!(await query(
    `SELECT 1 FROM (SELECT id FROM citizens WHERE family_id = $1 AND (life_stage = 'adult' OR id = $2)
                     ORDER BY born_at ASC, id ASC LIMIT 1) h WHERE h.id = $2`, [d.family_id, d.id])).rows[0] : false;
  const classRows = (await query('SELECT class_key, level, xp, hours_worked FROM citizen_classes WHERE citizen_id = $1', [d.id]).catch(() => ({ rows: [] }))).rows;
  const topLevel = classRows.reduce((m, r) => Math.max(m, Number(r.level) || 0), 0);
  const notable = wasHead || topLevel >= CONFIG.NOTABLE_LEVEL;

  // A widowed partner can partner again (§4.5).
  await query(`UPDATE citizens SET partner_id = NULL WHERE partner_id = $1 AND settlement_id = $2 AND ${LIVING}`, [d.id, settlementId]);

  // Heirlooms: each piece they had on, named for them and tagged. It goes
  // to the stores now; the heir takes it up when the inheritance settles.
  const gear = (await query('SELECT id, name, metadata FROM inventory_items WHERE equipped_to = $1 AND settlement_id = $2', [d.id, settlementId]).catch(() => ({ rows: [] }))).rows;
  const itemIds = [];
  for (const g of gear) {
    const meta = g.metadata || {};
    const prev = meta.heirloom || null;
    const base = prev && prev.base_name ? prev.base_name : g.name;
    const heirloom = { from_id: d.id, from_name: d.name, family_id: d.family_id || null, since: new Date(now).toISOString(),
      generations: prev ? (Number(prev.generations) || 1) + 1 : 1, base_name: base };
    await query(`UPDATE inventory_items SET equipped_to = NULL, name = $2, metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('heirloom', $3::jsonb) WHERE id = $1`,
      [g.id, `${first(d.name)}'s ${base}`, JSON.stringify(heirloom)]);
    itemIds.push(g.id);
  }

  // Knowledge: the XP in their own trade, a quarter of which the heir may gain.
  const own = classRows.find(r => r.class_key === d.role);
  const heir = await defaultHeir(settlementId, d.id);
  let inheritanceId = null;
  if (heir) {
    const r = await query(
      `INSERT INTO inheritances (settlement_id, deceased_id, family_id, default_heir_id, heir_id, class_key, xp, item_ids, settle_at)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7, $8::timestamptz + make_interval(hours => $9))
       ON CONFLICT (deceased_id) DO NOTHING RETURNING id`,
      [settlementId, d.id, d.family_id || null, heir, own ? d.role : null, own ? Number(own.xp) || 0 : 0, JSON.stringify(itemIds),
       new Date(Math.min(now, Date.now())).toISOString(), CONFIG.CHOOSE_HOURS]);
    inheritanceId = r.rows[0] ? r.rows[0].id : null;
  }
  // Headship passes to the oldest living adult.
  await LIFE.updateHeads(settlementId).catch(() => {});

  // Ceremony: a memorial for the head of a family or a master of a trade;
  // everyone else one gentle line (§4.4).
  const age = Math.floor(LIFE.ageOf(d, now));
  const text = notable ? memorialLine(d, { age, wasHead, top: classRows.find(r => r.class_key === d.role) || null, cause, heirName: heir ? await nameOf(heir) : null, items: gear.length })
                       : gentleLine(d, { age, cause });
  await require('./chronicle').write(settlementId, { kind: 'death', text, citizenIds: [d.id], familyId: d.family_id, at: now });
  // Old age writes its own event (a toast). Combat and starvation already write theirs.
  if (notable || cause === 'old_age') {
    await query(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [settlementId, notable ? 'memorial' : 'death_old_age', `${notable ? '🕯' : '🍂'} ${text}`, JSON.stringify([d.id]),
       new Date(Math.min(now, Date.now())).toISOString()]).catch(() => {});
  }
  return { inheritanceId, heir, notable, items: itemIds.length };
}

async function nameOf(id) {
  const r = await query('SELECT name FROM citizens WHERE id = $1', [id]).catch(() => ({ rows: [] }));
  return r.rows[0] ? r.rows[0].name : null;
}

function tradeLabel(role) {
  const C = require('./careers/classes');
  return (C.CLASSES[role] && C.CLASSES[role].label || role || 'townsfolk').toLowerCase();
}

function gentleLine(d, { age, cause }) {
  if (cause === 'old_age') return `${d.name} passed away peacefully at ${age}.`;
  if (cause === 'combat') return `${d.name} fell far from home, aged ${age}.`;
  if (cause === 'starvation') return `${d.name} was lost in the hungry days, aged ${age}.`;
  return `${d.name} died, aged ${age}.`;
}

function memorialLine(d, { age, wasHead, top, cause, heirName, items }) {
  const M = require('./career_math');
  const parts = [];
  const how = cause === 'old_age' ? 'passed away peacefully' : cause === 'combat' ? 'fell far from home' : cause === 'starvation' ? 'was lost in the hungry days' : 'died';
  parts.push(`${d.name} ${how} at ${age}.`);
  const roles = [];
  if (top && Number(top.level) >= 1) {
    const years = M.serviceYears ? M.serviceYears(Number(top.hours_worked) || 0) : null;
    roles.push(`a ${tradeLabel(d.role)} of level ${top.level}${years ? ` with ${years} years at the work` : ''}`);
  }
  if (wasHead) roles.push(`head of the ${String(d.name).split(' ')[1] || 'their'} family`);
  if (roles.length) parts.push(`They were ${roles.join(', and ')}.`);
  if (heirName) parts.push(items ? `Their things pass to ${heirName}.` : `${heirName} carries on for them.`);
  parts.push('They will be remembered.');
  return parts.join(' ');
}

// ── Settling ───────────────────────────────────────────────────────────────
// Gives the heir their inheritance: the knowledge (a quarter of the XP in a
// shared trade) and the heirlooms (worn if that slot is free, else left in
// the stores). Atomic: the row is claimed first, so it settles once.
async function settle(inheritanceId, heirId = null) {
  const events = [];
  const result = await withTransaction(async client => {
    const q = (t, p) => client.query(t, p);
    const inh = (await q(`SELECT * FROM inheritances WHERE id = $1 AND status = 'open' FOR UPDATE`, [inheritanceId])).rows[0];
    if (!inh) return null;
    const heir = Number(heirId || inh.heir_id || inh.default_heir_id) || null;
    const h = heir ? (await q(`SELECT id, name, role, family_id FROM citizens WHERE id = $1 AND settlement_id = $2 AND ${LIVING} FOR UPDATE`, [heir, inh.settlement_id])).rows[0] : null;
    await q(`UPDATE inheritances SET status = 'settled', settled_at = NOW(), heir_id = $2 WHERE id = $1`, [inh.id, h ? h.id : null]);
    if (!h) return { inh, heir: null, gained: 0, worn: [] };
    // Knowledge.
    let gained = 0;
    if (inh.class_key && h.role === inh.class_key && Number(inh.xp) > 0) {
      gained = Math.round(Number(inh.xp) * CONFIG.KNOWLEDGE_SHARE * 100) / 100;
      await require('./careers').grantXp(client, inh.settlement_id, [{ citizenId: h.id, classKey: inh.class_key, xp: gained }], events);
    }
    // Heirlooms: worn where the heir has nothing in that slot.
    const worn = [];
    for (const id of arr(inh.item_ids)) {
      const it = (await q('SELECT id, name, equip_slot FROM inventory_items WHERE id = $1 AND settlement_id = $2 AND equipped_to IS NULL', [id, inh.settlement_id])).rows[0];
      if (!it || !it.equip_slot) continue;
      const busy = (await q('SELECT 1 FROM inventory_items WHERE equipped_to = $1 AND equip_slot = $2', [h.id, it.equip_slot])).rows[0];
      if (busy) continue;
      await q('UPDATE inventory_items SET equipped_to = $1 WHERE id = $2', [h.id, it.id]);
      worn.push(it.name);
    }
    return { inh, heir: h, gained, worn };
  });
  if (!result || !result.heir) return result;
  const { inh, heir, gained, worn } = result;
  const d = (await query('SELECT name FROM citizens WHERE id = $1', [inh.deceased_id])).rows[0] || { name: 'someone' };
  const bits = [];
  if (worn.length) bits.push(`now carries ${worn.join(', ')}`);
  if (gained) bits.push(`learned from their ${tradeLabel(inh.class_key)}'s craft`);
  const text = `${heir.name} inherits from ${d.name}${bits.length ? ' and ' + bits.join(' and ') : ''}.`;
  await require('./chronicle').write(inh.settlement_id, { kind: 'inheritance', text, citizenIds: [heir.id, inh.deceased_id], familyId: inh.family_id });
  await query(`INSERT INTO settlement_events (settlement_id, type, message, citizen_ids) VALUES ($1, 'inheritance', $2, $3)`,
    [inh.settlement_id, `📜 ${text}`, JSON.stringify([heir.id, inh.deceased_id])]).catch(() => {});
  require('./milestones').town(inh.settlement_id, 'first_inheritance').catch(() => {});
  try { require('./careers').publish(inh.settlement_id, events); } catch (_) { /* no stream */ }
  return result;
}

// The player's answer (until moments exist): this heir, settled now.
async function choose(settlementId, deceasedId, heirId) {
  const inh = (await query(`SELECT id FROM inheritances WHERE settlement_id = $1 AND deceased_id = $2 AND status = 'open'`, [settlementId, deceasedId])).rows[0];
  if (!inh) { const e = new Error('There is nothing left to pass on.'); e.status = 404; throw e; }
  const ok = (await candidates(settlementId, deceasedId)).some(c => c.id === Number(heirId));
  if (!ok) { const e = new Error('An heir must be living family: a child, the partner or someone of their family.'); e.status = 400; throw e; }
  return settle(inh.id, Number(heirId));
}

async function settleDue(settlementId) {
  const due = (await query(`SELECT id FROM inheritances WHERE settlement_id = $1 AND status = 'open' AND settle_at <= NOW()`, [settlementId]).catch(() => ({ rows: [] }))).rows;
  const out = [];
  for (const r of due) out.push(await settle(r.id).catch(e => { console.error('[inheritance] settle failed:', e.message); return null; }));
  return out.filter(Boolean);
}

module.exports = { CONFIG, heirloomBonus, candidates, defaultHeir, onDeath, settle, choose, settleDue, memorialLine, gentleLine };
