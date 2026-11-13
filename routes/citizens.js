const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const { VISIBLE_TRAITS, EARNED_TRAITS, HIDDEN_TRAITS } = require('../citizens');
const { calculateHappinessFactors } = require('../happiness');
const { getCurrentSeason } = require('../seasons');

const router = express.Router();

// Famine ladder display thresholds — must match famine.js
// (HUNGRY_THRESHOLD=70, STARVING_THRESHOLD=90).
function hungerStateOf(c) {
  const h = c.life?.hunger ?? 0;
  return h >= 90 ? 'starving' : h >= 70 ? 'hungry' : 'fed';
}

// Get all citizens for the player's settlement
router.get('/', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Careers: credit passive XP first (gated, cheap when nothing's due).
    const careers = require('../lib/careers');
    await careers.settle(settlement.id);
    let careerInfo = new Map();
    try { careerInfo = careers.summaries(await careers.loadState(null, settlement.id)); }
    catch (e) { console.error('[careers] summaries failed:', e.message); }

    const citizensRes = await query(
      `SELECT * FROM citizens WHERE settlement_id=$1 ORDER BY born_at ASC`,
      [settlement.id]
    );

    // Get active expeditions for this settlement
    const expRes = await query(
      "SELECT citizen_id, target_q, target_r, completes_at FROM expeditions WHERE settlement_id=$1 AND status='travelling'",
      [settlement.id]
    );
    const expByCitizen = {};
    expRes.rows.forEach(e => { expByCitizen[e.citizen_id] = e; });

    // Get active party quests — citizens in party_ids are also busy
    const partyQuestRes = await query(
      "SELECT quest_id, party_ids, completes_at FROM settlement_quests WHERE settlement_id=$1 AND status='active' AND quest_type='party'",
      [settlement.id]
    );
    const questByCitizen = {};
    partyQuestRes.rows.forEach(q => {
      (q.party_ids || []).forEach(cid => {
        questByCitizen[cid] = { quest_id: q.quest_id, completes_at: q.completes_at };
      });
    });
    // Also solo quests
    const soloQuestRes = await query(
      "SELECT citizen_id, quest_id, completes_at FROM settlement_quests WHERE settlement_id=$1 AND status='active' AND (quest_type IS NULL OR quest_type='solo')",
      [settlement.id]
    );
    soloQuestRes.rows.forEach(q => {
      if (q.citizen_id) questByCitizen[q.citizen_id] = { quest_id: q.quest_id, completes_at: q.completes_at };
    });
    // Clan quests (forming parties included — the citizen waits at the hall).
    try {
      const clanQuestRes = await query(
        `SELECT s.citizen_id, r.quest_key, r.status, r.completes_at FROM clan_quest_slots s
           JOIN clan_quest_runs r ON r.id = s.run_id WHERE s.settlement_id = $1 AND s.active`, [settlement.id]);
      const defs = clanQuestRes.rows.length ? await require('../lib/clan_quests').loadDefs() : [];
      clanQuestRes.rows.forEach(q => {
        const def = defs.find(d => d.key === q.quest_key);
        questByCitizen[q.citizen_id] = {
          quest_id: 'clan:' + q.quest_key, completes_at: q.completes_at, clan: true,
          title: def ? def.title : q.quest_key, forming: q.status === 'forming',
        };
      });
    } catch (e) { /* pre-migration */ }

    // Market merchants — working an order (at home) or on a trade run.
    const tradeByCitizen = {};
    try {
      const tradeRes = await query(
        `SELECT m.citizen_id, m.order_id, o.resource, NULL::timestamptz AS completes_at, NULL AS status
           FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
          WHERE o.seller_settlement_id = $1
         UNION ALL
         SELECT t.citizen_id, t.order_id, t.resource,
                CASE WHEN t.status = 'outbound' THEN t.arrives_at ELSE t.returns_at END, t.status
           FROM market_trips t WHERE t.seller_settlement_id = $1 AND t.status IN ('outbound','returning')`,
        [settlement.id]);
      tradeRes.rows.forEach(t => {
        const prev = tradeByCitizen[t.citizen_id];
        if (!prev || t.status) tradeByCitizen[t.citizen_id] = {
          order_id: t.order_id, resource: t.resource, on_road: !!t.status, status: t.status, completes_at: t.completes_at,
        };
      });
    } catch (e) { /* pre-migration */ }
    // Shopkeepers mind a shop (Market v2): busy, but at home.
    try {
      const keepRes = await query('SELECT citizen_id, venue FROM shop_keepers WHERE settlement_id = $1', [settlement.id]);
      keepRes.rows.forEach(k => { if (!tradeByCitizen[k.citizen_id]) tradeByCitizen[k.citizen_id] = { shop: k.venue, on_road: false }; });
      const runRes = await query(
        `SELECT citizen_id, kind, status, CASE WHEN status = 'outbound' THEN arrives_at ELSE returns_at END AS completes_at
           FROM market_runs WHERE settlement_id = $1 AND status IN ('outbound','returning')`, [settlement.id]);
      runRes.rows.forEach(r => { tradeByCitizen[r.citizen_id] = { porter: r.kind, on_road: true, status: r.status, completes_at: r.completes_at }; });
    } catch (e) { /* pre-migration */ }
    // Working an outpost (lib/outpost_state): busy, out of town.
    const outpostByCitizen = {};
    try {
      const { OUTPOST_CONFIG } = require('../outposts_config');
      const oRes = await query(`SELECT o.id, o.terrain, o.tile_q, o.tile_r, oc.citizen_id, oc.post FROM outpost_crew oc JOIN outposts o ON o.id = oc.outpost_id
                                 WHERE o.settlement_id = $1`, [settlement.id]);
      oRes.rows.forEach(o => { outpostByCitizen[o.citizen_id] = { id: o.id, terrain: o.terrain, q: o.tile_q, r: o.tile_r, post: o.post, name: (OUTPOST_CONFIG[o.terrain] || {}).name || 'Outpost' }; });
    } catch (e) { /* pre-migration */ }
    // Carrying goods home from an outpost (lib/outpost_store): away.
    const haulByCitizen = {};
    try {
      const { OUTPOST_CONFIG } = require('../outposts_config');
      const hRes = await query(`SELECT h.citizen_id, h.outpost_id, h.standing, h.status, h.kind, o.terrain,
                                       h.returns_at, CASE WHEN h.status = 'outbound' THEN h.arrives_at ELSE h.returns_at END AS completes_at
                                  FROM outpost_hauls h LEFT JOIN outposts o ON o.id = h.outpost_id
                                 WHERE h.settlement_id = $1 AND h.status IN ('outbound','returning')`, [settlement.id]);
      hRes.rows.forEach(h => { haulByCitizen[h.citizen_id] = { outpost_id: h.outpost_id, outpost_name: (OUTPOST_CONFIG[h.terrain] || {}).name || 'Outpost', status: h.status, standing: !!h.standing, kind: h.kind || 'haul', completes_at: h.kind === 'return' ? h.returns_at : h.completes_at }; });
    } catch (e) { /* pre-migration */ }

    // Build lookup maps for happiness context
    const season = getCurrentSeason();
    // Happening modifiers right now (real clock; happiness + birth chance).
    const hMods = require('../lib/happening_effects').modifiersAt(await require('../lib/happenings').loadLive(), Date.now());
    const settRes = await query('SELECT food FROM settlements WHERE id=$1', [settlement.id]);
    const lowFood = (settRes.rows[0]?.food ?? 999) < 50;

    // House residents map: house_id -> [citizen_ids]
    const houseResidents = {};
    citizensRes.rows.forEach(c => {
      if (c.house_id) {
        if (!houseResidents[c.house_id]) houseResidents[c.house_id] = [];
        houseResidents[c.house_id].push(c.id);
      }
    });

    // Partner house lookup
    const partnerHouseMap = {};
    citizensRes.rows.forEach(c => { if (c.house_id) partnerHouseMap[c.id] = c.house_id; });

    // Children per house
    const houseChildCount = {};
    citizensRes.rows.filter(c => c.life_stage === 'child' && c.house_id).forEach(c => {
      houseChildCount[c.house_id] = (houseChildCount[c.house_id] || 0) + 1;
    });

    // Ages and stages (lib/life.js), the town's free beds, each couple's children.
    const LIFE = require('../lib/life');
    const now = Date.now();
    const bedInfo = await LIFE.beds(settlement.id);
    const coupleKids = {};
    for (const k of citizensRes.rows) {
      const [x, y] = LIFE.parentsOf(k).sort((m, n) => m - n);
      if (!x || !y) continue;
      const e = coupleKids[`${x}_${y}`] || (coupleKids[`${x}_${y}`] = { children: 0, lastChildAt: null });
      e.children++;
      const t = k.born_at ? new Date(k.born_at).getTime() : null;
      if (t && (!e.lastChildAt || t > e.lastChildAt)) e.lastChildAt = t;
    }

    // The dead: memorial lines and inheritances (lib/inheritance). The living:
    // heirlooms they carry, and the bonus when it is their family's.
    const H = require('../lib/inheritance');
    const memorials = {};
    (await query(`SELECT citizen_ids, text FROM chronicle WHERE settlement_id = $1 AND kind = 'death' ORDER BY at ASC`, [settlement.id]).catch(() => ({ rows: [] }))).rows
      .forEach(r => { const id = (r.citizen_ids || [])[0]; if (id) memorials[id] = r.text; });
    const inheritances = {};
    for (const r of (await query(`SELECT * FROM inheritances WHERE settlement_id = $1`, [settlement.id]).catch(() => ({ rows: [] }))).rows) inheritances[r.deceased_id] = r;
    const gearRows = (await query(`SELECT id, name, equipped_to, metadata FROM inventory_items WHERE settlement_id = $1 AND (equipped_to IS NOT NULL OR metadata ? 'heirloom')`, [settlement.id]).catch(() => ({ rows: [] }))).rows;
    const nameById = Object.fromEntries(citizensRes.rows.map(x => [x.id, x.name]));
    const inheritanceOf = async c => {
      const r = inheritances[c.id];
      if (!r) return null;
      return {
        status: r.status, heir_id: r.heir_id, heir_name: nameById[r.heir_id] || null,
        default_heir_id: r.default_heir_id, settle_at: r.settle_at,
        trade: r.class_key, xp: Number(r.xp) || 0,
        items: (r.item_ids || []).map(id => (gearRows.find(g => g.id === Number(id)) || {}).name).filter(Boolean),
        candidates: r.status === 'open' ? await H.candidates(settlement.id, c.id) : [],
      };
    };
    const deadExtras = {};
    for (const c of citizensRes.rows) if (c.life_stage === 'deceased') deadExtras[c.id] = await inheritanceOf(c);

    const citizens = citizensRes.rows.map(c => {
      const context = {
        season,
        lowFood,
        onExpedition: !!expByCitizen[c.id] || !!questByCitizen[c.id] || !!tradeByCitizen[c.id]?.on_road,
        partnerHouseId: c.partner_id ? partnerHouseMap[c.partner_id] : null,
        houseChildCount: houseChildCount[c.house_id] || 0,
        // Someone else in the house is an elder (60+).
        elderInHouse: c.house_id && citizensRes.rows.some(o => o.id !== c.id && o.house_id === c.house_id && LIFE.stageOf(o, now) === 'elder')
          ? LIFE.CONFIG.ELDER_HOME_HAPPINESS : 0,
        happeningHappiness: hMods.happiness || 0,
        jobMood: (careerInfo.get(c.id) || {}).job_mood || 0,
      };
      const { factors, base, delta, computed } = calculateHappinessFactors(c, context);
      // Breeding status — only for partnered adults
      let breedingStatus = null;
      if (c.partner_id && c.life_stage === 'adult') {
        const partner = citizensRes.rows.find(p => p.id === c.partner_id);
        const isMale   = c.gender === 'male';
        const isFemale = c.gender === 'female';
        const partnerIsMale   = partner?.gender === 'male';
        const partnerIsFemale = partner?.gender === 'female';
        const canBreed = (isMale && partnerIsFemale) || (isFemale && partnerIsMale);

        if (canBreed) {
          // The rules simulation.js applies (docs/PHASE_1_LIFE_CYCLE.md §4.6):
          // a free bed anywhere in town, both fertile, the gap, four at most.
          const sameHouse = c.house_id && partner?.house_id && c.house_id === partner.house_id;
          const myHappy   = (c.life?.happiness ?? 70) + (hMods.happiness || 0);
          const ptHappy   = (partner?.life?.happiness ?? 70) + (hMods.happiness || 0);
          const happyOk   = myHappy >= 60 && ptHappy >= 60;
          const ck = c.id < c.partner_id ? `${c.id}_${c.partner_id}` : `${c.partner_id}_${c.id}`;
          const lifeBlockers = partner ? LIFE.birthBlockers(c, partner, coupleKids[ck] || {}, now) : ['Partner not found'];
          const bedFree = bedInfo.free > 0;

          // Calculate chance
          let chance = 0.04;
          if (bedFree && happyOk && !lifeBlockers.length) {
            chance += season.birthChanceBonus || 0;
            chance += hMods.birth_chance || 0;
            const avgHappy = (myHappy + ptHappy) / 2;
            chance += Math.floor((avgHappy - 60) / 10) * 0.04;
            chance = Math.min(0.35, Math.max(0, chance));
          } else {
            chance = 0;
          }

          breedingStatus = {
            canBreed,
            sameHouse,
            happyOk,
            myHappy,
            partnerHappy: ptHappy,
            partnerName: partner?.name || 'Partner',
            chance: Math.round(chance * 100),
            season: season.id,
            seasonBonus: Math.round((season.birthChanceBonus || 0) * 100),
            bedFree,
            blockers: [
              !bedFree     ? 'No free bed in town (build a Willow Hut)' : null,
              !happyOk     ? 'Happiness too low (need 60+)' : null,
              ...lifeBlockers,
            ].filter(Boolean),
          };
        }
      }

      return {
        id: c.id,
        name: c.name,
        gender: c.gender,
        generation: c.generation,
        role: c.role,
        stats: c.life_stage === 'child' ? {} : (c.stats || {}),
        skills: c.life_stage === 'child' ? {} : (c.skills || {}),
        // Age moves from born_at; the stored life.age is no longer read (§4.1).
        life: { ...(c.life || {}), age: Math.floor(LIFE.ageOf(c, now)) },
        age: Math.floor(LIFE.ageOf(c, now)),
        stage: LIFE.stageOf(c, now),
        family_id: c.family_id || null,
        heirlooms: gearRows.filter(g => g.equipped_to === c.id && g.metadata && g.metadata.heirloom).map(g => ({
          name: g.name, from: g.metadata.heirloom.from_name, generations: g.metadata.heirloom.generations || 1,
          bonus: Math.round(H.heirloomBonus(g, c) * 100),   // 0 when carried outside the family
        })),
        ...(c.life_stage === 'deceased' ? {
          died_at: c.died_at || null, death_cause: c.death_cause || null,
          memorial: memorials[c.id] || null, inheritance: deadExtras[c.id] || null,
        } : {}),
        visible_traits: c.visible_traits || [],
        revealed_hidden_traits: [],
        ...(careerInfo.get(c.id) || {}),
        born_at: c.born_at,
        house_id: c.house_id || null,
        partner_id: c.partner_id || null,
        life_stage: c.life_stage || 'adult',
        parent_ids: c.parent_ids || [],
        expedition: expByCitizen[c.id] || null,
        active_quest: questByCitizen[c.id] || null,
        trade: tradeByCitizen[c.id] || null,
        outpost: outpostByCitizen[c.id] || null,
        haul: haulByCitizen[c.id] || null,
        happiness_factors: factors,
        happiness_computed: computed,
        breeding_status: breedingStatus,
        hunger_state: hungerStateOf(c),   // famine ladder badge (fed|hungry|starving)
      };
    });

    res.json({ ok: true, citizens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch citizens.' });
  }
});

// Get a single citizen
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];

    const citizenRes = await query(
      'SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2',
      [req.params.id, settlement.id]
    );
    const c = citizenRes.rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });

    res.json({
      ok: true,
      citizen: {
        id: c.id, name: c.name, gender: c.gender, generation: c.generation,
        role: c.role, stats: c.stats || {}, skills: c.skills || {},
        life: { ...(c.life || {}), age: Math.floor(require('../lib/life').ageOf(c)) }, repro: c.repro || {},
        age: Math.floor(require('../lib/life').ageOf(c)),
        stage: require('../lib/life').stageOf(c),
        visible_traits: c.visible_traits || [],
        revealed_hidden_traits: c.revealed_traits || [],
        born_at: c.born_at,
        hunger_state: hungerStateOf(c),
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch citizen.' });
  }
});

// Update citizen role (careers: time so far is credited to the old job; a
// job needs its building — lib/careers/classes.js).
// ── POST /api/citizens/:id/heir { heir_id } ──────────────────────────────
// Answer an inheritance (until moments exist): who takes up the dead
// citizen's things. Settles at once; unanswered, the default heir inherits
// when the time is up (docs/PHASE_1_LIFE_CYCLE.md §4.8).
router.post('/:id/heir', requireAuth, async (req, res) => {
  try {
    const sRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = sRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const heirId = Number((req.body || {}).heir_id);
    if (!Number.isInteger(heirId) || heirId <= 0) return res.status(400).json({ error: 'Choose an heir.' });
    const r = await require('../lib/inheritance').choose(settlement.id, Number(req.params.id), heirId);
    res.json({ ok: true, heir_id: r && r.heir ? r.heir.id : null, worn: r ? r.worn : [], gained: r ? r.gained : 0 });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to pass on their things.' });
  }
});

// ── POST /api/citizens/:id/apprentice { class, mentor_id? } ──────────────
// A youth (7–11) chooses the trade they learn and, optionally, who teaches
// them (docs/PHASE_1_LIFE_CYCLE.md §4.2). Without a mentor_id the best free
// adult of that trade teaches them (one mentor, two youths at most).
router.post('/:id/apprentice', requireAuth, async (req, res) => {
  try {
    const LIFE = require('../lib/life');
    const C = require('../lib/careers/classes');
    const sRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = sRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const body = req.body || {};
    const classKey = typeof body.class === 'string' ? body.class : null;
    if (!classKey || !C.ASSIGNABLE.includes(classKey)) return res.status(400).json({ error: 'Choose a trade.' });
    const c = (await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [req.params.id, settlement.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });
    if (LIFE.stageOf(c) !== 'youth') return res.status(400).json({ error: `Only youths (${LIFE.CONFIG.YOUTH_FROM}–${LIFE.CONFIG.ADULT_FROM - 1}) can take up an apprenticeship.` });
    let mentorId = null;
    if (body.mentor_id != null && body.mentor_id !== '') {
      const m = (await query(
        `SELECT id, role, life_stage FROM citizens WHERE id=$1 AND settlement_id=$2 AND life_stage = 'adult'`, [body.mentor_id, settlement.id])).rows[0];
      if (!m || m.role !== classKey) return res.status(400).json({ error: 'A mentor must be an adult working that trade.' });
      mentorId = m.id;
    }
    await query('UPDATE citizens SET apprentice_class=$1, mentor_id=$2 WHERE id=$3', [classKey, mentorId, c.id]);
    // What it comes to, with everyone else's apprenticeships considered.
    const careers = require('../lib/careers');
    const state = await careers.loadState(null, settlement.id);
    const a = LIFE.apprenticeships(state.citizens, state.classRows).get(c.id) || {};
    res.json({ ok: true, apprentice: { class_key: a.classKey, chosen: a.chosen, mentor_id: a.mentorId, mentor_name: a.mentorName, rate: a.rate, hint: a.hint },
      note: mentorId && a.mentorId !== mentorId ? 'That mentor already teaches two youths; another will teach for now.' : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set the apprenticeship.' });
  }
});

router.patch('/:id/role', requireAuth, async (req, res) => {
  try {
    const { role } = req.body;
    const careers = require('../lib/careers');
    const C = require('../lib/careers/classes');
    if (!C.VALID_ROLES.includes(role) || (C.CLASSES[role] && C.CLASSES[role].assignedBy))
      return res.status(400).json({ error: 'Invalid role.' });

    const settlementRes = await query(
      'SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]
    );
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });
    const cRes = await query('SELECT id, name, life_stage FROM citizens WHERE id=$1 AND settlement_id=$2', [req.params.id, settlement.id]);
    const cit = cRes.rows[0];
    if (!cit) return res.status(404).json({ error: 'Citizen not found.' });
    if ((cit.life_stage || 'adult') !== 'adult') return res.status(400).json({ error: `${cit.name} can't take a job.` });

    // Away on something: can't be reassigned until they're home.
    const away = (await careers.awayMap(null, settlement.id)).get(cit.id);
    const AWAY_MSG = {
      expedition: 'is out scouting', quest: 'is on a quest', clan_quest: 'is on a clan quest',
      porter: 'is out carrying goods', trade: 'is on a trade run', envoy: 'is away as an envoy',
    };
    if (away) return res.status(400).json({ error: `${cit.name} ${AWAY_MSG[away] || 'is away'} and can't be reassigned until they return.` });
    if ((await require('../lib/crafting').busyCitizenIds([cit.id])).length)
      return res.status(400).json({ error: `${cit.name} has crafting queued — cancel it at their workshop first.` });

    const events = [];
    await withTransaction(async client => {
      // Merchants (set by the Market) at home leave their order; keepers their shop.
      await client.query(
        `DELETE FROM market_order_merchants m USING citizens c
          WHERE m.citizen_id = c.id AND c.id = $1 AND c.settlement_id = $2`, [cit.id, settlement.id]
      ).catch(() => {});
      await client.query(
        `DELETE FROM shop_keepers k USING citizens c
          WHERE k.citizen_id = c.id AND c.id = $1 AND c.settlement_id = $2`, [cit.id, settlement.id]
      ).catch(() => {});
      await careers.setRole(client, settlement.id, [cit.id], role, events);
    });
    careers.publish(settlement.id, events);
    res.json({ ok: true, role });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// Export trait data for frontend reference
router.get('/meta/traits', async (req, res) => {
  res.json({ ok: true, visible: VISIBLE_TRAITS.concat(EARNED_TRAITS), hidden: HIDDEN_TRAITS.map(t => ({ id: t.id, label: '???' })) });
});


// ── Family tree for a citizen ──────────────────
router.get('/:id/family', requireAuth, async (req, res) => {
  try {
    const settlementRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const settlement = settlementRes.rows[0];
    if (!settlement) return res.status(404).json({ error: 'No settlement.' });

    // Get the citizen
    const cRes = await query('SELECT * FROM citizens WHERE id=$1 AND settlement_id=$2', [req.params.id, settlement.id]);
    const c = cRes.rows[0];
    if (!c) return res.status(404).json({ error: 'Citizen not found.' });

    // Get all citizens in settlement (for resolving names/relations)
    const allRes = await query('SELECT id, name, gender, life_stage, generation, parent_ids, partner_id, house_id FROM citizens WHERE settlement_id=$1', [settlement.id]);
    const all = allRes.rows;
    const byId = Object.fromEntries(all.map(x => [x.id, x]));

    // Parents
    const parentIds = c.parent_ids || [];
    const parents = parentIds.map(pid => byId[pid]).filter(Boolean);

    // Grandparents
    const grandparents = [];
    for (const p of parents) {
      const gpIds = p.parent_ids || [];
      gpIds.forEach(gpid => { const gp = byId[gpid]; if (gp) grandparents.push({ ...gp, via: p.id }); });
    }

    // Siblings (share at least one parent)
    const siblings = all.filter(x => {
      if (x.id === c.id) return false;
      const xParents = x.parent_ids || [];
      return xParents.some(pid => parentIds.includes(pid));
    });

    // Children (this citizen is in their parent_ids)
    const children = all.filter(x => (x.parent_ids || []).includes(c.id));

    // Grandchildren
    const grandchildren = [];
    children.forEach(child => {
      all.filter(x => (x.parent_ids || []).includes(child.id)).forEach(gc => {
        grandchildren.push({ ...gc, via: child.id });
      });
    });

    // Partner
    const partner = c.partner_id ? byId[c.partner_id] : null;

    const slim = (x) => x ? { id: x.id, name: x.name, gender: x.gender, life_stage: x.life_stage, generation: x.generation } : null;

    res.json({
      ok: true,
      subject: slim(c),
      partner: slim(partner),
      parents: parents.map(slim),
      grandparents: grandparents.map(x => ({ ...slim(x), via: x.via })),
      siblings: siblings.map(slim),
      children: children.map(slim),
      grandchildren: grandchildren.map(x => ({ ...slim(x), via: x.via })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch family tree.' });
  }
});

module.exports = router;
