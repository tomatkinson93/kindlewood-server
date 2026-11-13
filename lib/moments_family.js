// ══════════════════════════════════════════════════════════════════════════
//  Family moments (docs/PHASE_2_MOMENTS.md §3, M1–M8). Built on Phase 1:
//  ages and stages, families, apprenticeships, inheritance and settlers.
//
//    M1 name_baby      a couple can't agree on a name
//    M2 child_wish     a youth wants a different trade from their parent's
//    M3 proposal       two want to marry; the head of one family objects
//    M4 last_request   an old elder asks for one last thing
//    M5 who_inherits   (triggered at a death) the eldest, or the one in the trade?
//    M6 quarrel        two housemates fall out
//    M7 settler_gate   (triggered when a settler is due) a stranger asks to stay
//    M8 gifted_child   a youth shows a hidden knack
//
//  Every `choose` runs on the moment's transaction (x.q); nothing here may use
//  the shared pool for rows the transaction holds (see the 2026-11-13 deploy
//  deadlock).
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const LIFE = require('./life');

const LIVING = "COALESCE(life_stage, 'adult') <> 'deceased'";
const first = n => String(n || '').split(' ')[0] || 'Someone';
const surname = n => String(n || '').split(' ').slice(1).join(' ') || 'Woodkin';
const arr = v => (Array.isArray(v) ? v : []);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const C = () => require('./careers/classes');
const T = () => require('./careers/traits');
const trade = k => ((C().CLASSES[k] || {}).label || k || 'townsfolk').toLowerCase();
const a_an = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');

// ── Small effects (on the moment's transaction) ────────────────────────────
async function happy(q, ids, delta) {
  ids = arr(ids).filter(Boolean);
  if (!ids.length || !delta) return;
  await q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}',
             to_jsonb(LEAST(100, GREATEST(0, COALESCE((life->>'happiness')::numeric, 70) + $2)))) WHERE id = ANY($1::int[])`, [ids, delta]);
}
const stateOf = s => (s >= 90 ? 'partners' : s >= 75 ? 'bonded' : s >= 60 ? 'close' : s >= 40 ? 'friends' : s >= 20 ? 'acquaintances' : 'strangers');
async function bond(q, sid, a, b, delta) {
  const [x, y] = [Math.min(a, b), Math.max(a, b)];
  const r = (await q('SELECT score, state FROM citizen_relationships WHERE citizen_a_id = $1 AND citizen_b_id = $2', [x, y])).rows[0];
  const score = Math.max(0, Math.min(100, (r ? Number(r.score) : 20) + delta));
  const state = r && r.state === 'partners' ? 'partners' : stateOf(Math.min(score, 89));
  await q(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score = $4, state = $5, last_updated = NOW()`, [sid, x, y, Math.round(score), state]);
}
async function living(ctx) {
  return (await ctx.q(`SELECT id, name, gender, role, born_at, life_stage, parent_ids, partner_id, family_id, house_id,
                              visible_traits, hidden_traits, revealed_traits, apprentice_class, life
                         FROM citizens WHERE settlement_id = $1 AND ${LIVING}`, [ctx.sid])).rows;
}
// Kinds already asked about these citizens (so nobody is asked twice).
async function askedAbout(ctx, kind, days = 3650) {
  const r = await ctx.q(`SELECT subject FROM moments WHERE settlement_id = $1 AND kind = $2 AND created_at > NOW() - make_interval(days => $3)`, [ctx.sid, kind, days]);
  const ids = new Set();
  for (const row of r.rows) arr((row.subject || {}).citizen_ids).forEach(i => ids.add(Number(i)));
  return ids;
}
async function spend(q, sid, cost) {
  const s = (await q('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [sid])).rows[0];
  for (const [r, v] of Object.entries(cost)) if ((Number(s[r]) || 0) < v) return `Not enough ${r} in town (need ${v}).`;
  const keys = Object.keys(cost);
  await q(`UPDATE settlements SET ${keys.map((r, i) => `${r} = ${r} - $${i + 2}`).join(', ')} WHERE id = $1`, [sid, ...keys.map(k => cost[k])]);
  return null;
}

// ── M1 A name for the baby ─────────────────────────────────────────────────
M.register('name_baby', {
  source: 'family', icon: '🍼', title: 'A name for the baby', weight: 3, cooldownDays: 1, expireHours: 24, gentle: true,
  async eligible(ctx) {
    const town = await living(ctx);
    const byId = new Map(town.map(c => [c.id, c]));
    const done = await askedAbout(ctx, 'name_baby');
    const babies = town.filter(c => c.life_stage === 'child' && c.born_at && ctx.now - new Date(c.born_at).getTime() < 3 * 24 * 3600e3
      && !done.has(c.id) && LIFE.parentsOf(c).length === 2 && LIFE.parentsOf(c).every(p => byId.has(p)))
      .sort((a, b) => new Date(b.born_at) - new Date(a.born_at));
    const baby = babies[0];
    if (!baby) return null;
    const ps = LIFE.parentsOf(baby).map(id => byId.get(id));
    const mother = ps.find(p => p.gender === 'female') || ps[0], father = ps.find(p => p !== mother);
    // A grandparent on the mother's side (the dead count: a name can honour them).
    const gps = LIFE.parentsOf(mother);
    const gp = gps.length ? (await ctx.q('SELECT id, name, gender, life_stage FROM citizens WHERE id = ANY($1::int[]) ORDER BY (gender = \'female\') DESC LIMIT 1', [gps])).rows[0] : null;
    // The father's closest friend outside the family.
    const fr = (await ctx.q(
      `SELECT CASE WHEN r.citizen_a_id = $1 THEN r.citizen_b_id ELSE r.citizen_a_id END AS id, r.score FROM citizen_relationships r
        WHERE (r.citizen_a_id = $1 OR r.citizen_b_id = $1) AND r.state <> 'partners' ORDER BY r.score DESC LIMIT 5`, [father.id])).rows
      .map(r => byId.get(Number(r.id))).find(c => c && c.id !== mother.id && !LIFE.kin(c, father) && c.id !== baby.id);
    return {
      subject: { citizen_ids: [baby.id, mother.id, father.id], family_id: baby.family_id },
      data: { speaker: mother.name, child: { id: baby.id, name: baby.name }, mother: { id: mother.id, name: mother.name }, father: { id: father.id, name: father.name },
        grand: gp ? { id: gp.id, name: gp.name, alive: gp.life_stage !== 'deceased', rel: gp.gender === 'female' ? 'grandmother' : 'grandfather' } : null,
        friend: fr ? { id: fr.id, name: fr.name } : null },
    };
  },
  text: d => `${first(d.mother.name)} and ${first(d.father.name)} have a new baby, and they can't agree what to call them.`,
  options: d => [
    d.grand ? { key: 'grand', label: `After ${first(d.grand.name)}, the baby's ${d.grand.rel}`, hint: d.grand.alive ? `${first(d.grand.name)} will be delighted` : 'a name to remember them by', risk: 0 }
            : { key: 'grand', label: `After ${first(d.mother.name)} herself`, hint: `${first(d.mother.name)} will be pleased`, risk: 0 },
    ...(d.friend ? [{ key: 'friend', label: `After ${first(d.friend.name)}, ${first(d.father.name)}'s old friend`, hint: 'the two friends grow closer', risk: 0 }] : []),
    { key: 'town', label: 'Let the town choose', hint: 'a cheerful day for everyone', risk: 0 },
  ],
  fallback: 'grand',
  async choose(key, x) {
    const d = x.d;
    let firstName = first(d.child.name), honour = '';
    if (key === 'grand') {
      firstName = d.grand ? first(d.grand.name) : first(d.mother.name);
      honour = d.grand ? `after ${d.grand.alive ? 'their' : 'their late'} ${d.grand.rel}, ${first(d.grand.name)}` : `after ${first(d.mother.name)}`;
      await happy(x.q, [d.grand && d.grand.alive ? d.grand.id : d.mother.id], 8);
    } else if (key === 'friend' && d.friend) {
      firstName = first(d.friend.name);
      honour = `after ${first(d.father.name)}'s friend ${first(d.friend.name)}`;
      await bond(x.q, x.sid, d.father.id, d.friend.id, 12);
    } else {
      honour = 'with the whole town cheering';
      await x.q(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}', to_jsonb(LEAST(100, COALESCE((life->>'happiness')::numeric, 70) + 3)))
                 WHERE settlement_id = $1 AND ${LIVING}`, [x.sid]);
    }
    const name = `${firstName} ${surname(d.child.name)}`;
    await x.q('UPDATE citizens SET name = $1 WHERE id = $2 AND settlement_id = $3', [name, d.child.id, x.sid]);
    return { outcome: `The baby is named ${name}, ${honour}.`, chronicle: `${first(d.mother.name)} and ${first(d.father.name)} named their child ${name}, ${honour}.` };
  },
});

// ── M2 A child's wish ──────────────────────────────────────────────────────
M.register('child_wish', {
  source: 'family', icon: '🎒', title: "A child's wish", weight: 3, cooldownDays: 4, expireHours: 24,
  async eligible(ctx) {
    const town = await living(ctx);
    const byId = new Map(town.map(c => [c.id, c]));
    const done = await askedAbout(ctx, 'child_wish');
    const types = (await ctx.q('SELECT type FROM buildings WHERE settlement_id = $1', [ctx.sid])).rows.map(r => r.type);
    const youths = town.filter(c => LIFE.stageOf(c, ctx.now) === 'youth' && LIFE.ageOf(c, ctx.now) < 9 && !c.apprentice_class && !done.has(c.id));
    for (const y of youths) {
      const pTrade = LIFE.defaultTrade(y, byId);
      if (!pTrade) continue;
      const parent = LIFE.parentsOf(y).map(id => byId.get(id)).find(p => p && p.role === pTrade);
      // The wish: a hidden knack's trade if there is one, else another trade the town has.
      const knack = arr(y.hidden_traits).find(t => T().APTITUDES[t] && !arr(y.revealed_traits).includes(t));
      const knackClass = knack ? T().APTITUDES[knack].classes.find(k => k !== pTrade && C().needsMet(C().CLASSES[k], types)) : null;
      const others = C().ASSIGNABLE.filter(k => k !== pTrade && C().needsMet(C().CLASSES[k], types));
      const wish = knackClass || (others.length ? pick(ctx.rng, others) : null);
      if (!wish) continue;
      return { subject: { citizen_ids: [y.id], family_id: y.family_id },
        data: { speaker: y.name, youth: { id: y.id, name: y.name, age: Math.floor(LIFE.ageOf(y, ctx.now)) }, parent: { id: parent ? parent.id : null, name: parent ? parent.name : 'their parent' },
          parentTrade: pTrade, wish, knack: knackClass ? knack : null } };
    }
    return null;
  },
  text: d => `${first(d.youth.name)}, ${d.youth.age}, wants to learn to be ${a_an(trade(d.wish))} ${trade(d.wish)}, not ${a_an(trade(d.parentTrade))} ${trade(d.parentTrade)} like ${first(d.parent.name)}.`,
  options: d => [
    { key: 'parent', label: `Follow ${first(d.parent.name)} as ${a_an(trade(d.parentTrade))} ${trade(d.parentTrade)}`, hint: 'taught at home; unhappy for a while', risk: 1 },
    { key: 'wish', label: `Let them learn to be ${a_an(trade(d.wish))} ${trade(d.wish)}`, hint: 'a teacher may be harder to find; may show a hidden knack', risk: 1 },
  ],
  fallback: 'parent',
  async choose(key, x) {
    const d = x.d;
    const cls = key === 'wish' ? d.wish : d.parentTrade;
    await x.q('UPDATE citizens SET apprentice_class = $1, mentor_id = NULL WHERE id = $2 AND settlement_id = $3', [cls, d.youth.id, x.sid]);
    let extra = '';
    if (key === 'wish') {
      await happy(x.q, [d.youth.id], 6);
      if (d.knack) {
        await x.q(`UPDATE citizens SET revealed_traits = COALESCE(revealed_traits, '[]'::jsonb) || $2::jsonb WHERE id = $1 AND NOT (COALESCE(revealed_traits, '[]'::jsonb) ? $3)`,
          [d.youth.id, JSON.stringify([d.knack]), d.knack]);
        extra = ` It turns out they have a real knack for it (${(T().APTITUDES[d.knack] || {}).label || d.knack}).`;
      }
    } else await happy(x.q, [d.youth.id], -8);
    return { outcome: `${first(d.youth.name)} will learn to be ${a_an(trade(cls))} ${trade(cls)}.${extra}`,
      chronicle: `${d.youth.name} took up an apprenticeship as ${a_an(trade(cls))} ${trade(cls)}${key === 'wish' ? ', as they wished' : `, like ${first(d.parent.name)}`}.${extra}` };
  },
});

// ── M3 A proposal across families ──────────────────────────────────────────
M.register('proposal', {
  source: 'family', icon: '💍', title: 'A proposal across families', weight: 2, cooldownDays: 5, expireHours: 24,
  async eligible(ctx) {
    const town = await living(ctx);
    const byId = new Map(town.map(c => [c.id, c]));
    const rels = (await ctx.q(`SELECT citizen_a_id, citizen_b_id, score FROM citizen_relationships WHERE settlement_id = $1 AND score >= 75 AND state <> 'partners' ORDER BY score DESC`, [ctx.sid])).rows;
    const open = await askedAbout(ctx, 'proposal', 30);
    for (const r of rels) {
      const a = byId.get(r.citizen_a_id), b = byId.get(r.citizen_b_id);
      if (!a || !b || a.partner_id || b.partner_id || open.has(a.id) || open.has(b.id)) continue;
      if (a.life_stage !== 'adult' || b.life_stage !== 'adult' || LIFE.kin(a, b) || !a.family_id || a.family_id === b.family_id) continue;
      // The objector: the oldest adult of either family, older than the pair.
      const heads = town.filter(c => c.life_stage === 'adult' && c.id !== a.id && c.id !== b.id && (c.family_id === a.family_id || c.family_id === b.family_id))
        .sort((x, y) => new Date(x.born_at) - new Date(y.born_at));
      const obj = heads[0];
      if (!obj || new Date(obj.born_at) >= new Date(a.born_at) || new Date(obj.born_at) >= new Date(b.born_at)) continue;
      const of = obj.family_id === a.family_id ? a : b;
      return { subject: { citizen_ids: [a.id, b.id, obj.id], family_id: obj.family_id },
        data: { speaker: a.name, a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, obj: { id: obj.id, name: obj.name }, objFor: of.name } };
    }
    return null;
  },
  text: d => `${first(d.a.name)} and ${first(d.b.name)} want to marry, but ${d.obj.name} thinks ${first(d.objFor)} could do better.`,
  options: d => [
    { key: 'bless', label: 'Give your blessing', hint: `${first(d.obj.name)} will be unhappy`, risk: 1 },
    { key: 'wait', label: 'Ask them to wait a season', hint: 'they may drift apart', risk: 1 },
  ],
  fallback: 'bless',
  async choose(key, x) {
    const d = x.d;
    if (key === 'wait') {
      await happy(x.q, [d.obj.id], 5);
      await bond(x.q, x.sid, d.a.id, d.b.id, -15);
      return { outcome: `${first(d.a.name)} and ${first(d.b.name)} agreed to wait. ${first(d.obj.name)} is content; the two are a little cooler.`,
        chronicle: `${d.a.name} and ${d.b.name} were asked to wait before marrying.` };
    }
    const pair = (await x.q('SELECT id, partner_id, life_stage FROM citizens WHERE id = ANY($1::int[]) FOR UPDATE', [[d.a.id, d.b.id]])).rows;
    if (pair.length < 2 || pair.some(p => p.partner_id || p.life_stage === 'deceased')) {
      return { outcome: `Things had already changed: ${first(d.a.name)} and ${first(d.b.name)} did not marry after all.` };
    }
    await x.q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [d.b.id, d.a.id]);
    await x.q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [d.a.id, d.b.id]);
    const [lo, hi] = [Math.min(d.a.id, d.b.id), Math.max(d.a.id, d.b.id)];
    await x.q(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,95,'partners')
               ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score = GREATEST(citizen_relationships.score, 95), state = 'partners'`, [x.sid, lo, hi]);
    await happy(x.q, [d.obj.id], -10);
    await LIFE.autoHouse(x.sid, { couples: [[d.a.id, d.b.id]] }, x.q).catch(() => {});
    return { outcome: `${first(d.a.name)} and ${first(d.b.name)} are partners now. ${first(d.obj.name)} grumbles.`,
      chronicle: `${d.a.name} and ${d.b.name} married with the town's blessing, over ${first(d.obj.name)}'s doubts.` };
  },
});

// ── M4 An elder's last request ─────────────────────────────────────────────
const REQUESTS = ['one last feast with the whole family', 'a supper of the old dishes, the way they were made when they were young', 'a gathering by the fire to hear the old songs once more'];
M.register('last_request', {
  source: 'family', icon: '🕯', title: "An elder's last request", weight: 2, cooldownDays: 6, expireHours: 24,
  async eligible(ctx) {
    const town = await living(ctx);
    const done = await askedAbout(ctx, 'last_request', 60);
    const elders = town.filter(c => c.life_stage === 'adult' && LIFE.ageOf(c, ctx.now) >= LIFE.CONFIG.DEATH_FROM && !done.has(c.id))
      .sort((a, b) => new Date(a.born_at) - new Date(b.born_at));
    const e = elders[0];
    if (!e) return null;
    const fam = town.filter(c => c.family_id && c.family_id === e.family_id && c.id !== e.id).map(c => c.id);
    const kids = town.filter(c => LIFE.parentsOf(c).includes(e.id) && c.life_stage === 'adult').sort((a, b) => new Date(a.born_at) - new Date(b.born_at));
    return { subject: { citizen_ids: [e.id], family_id: e.family_id },
      data: { speaker: e.name, elder: { id: e.id, name: e.name, age: Math.floor(LIFE.ageOf(e, ctx.now)) }, wish: pick(ctx.rng, REQUESTS), family: fam,
        heir: kids[0] ? { id: kids[0].id, name: kids[0].name } : null, cost: { food: 150 } } };
  },
  text: d => `${d.elder.name}, ${d.elder.age}, feels their years and asks for ${d.wish}.`,
  options: d => [
    { key: 'grant', label: 'Grant it', hint: `${d.cost.food} food; the family is comforted`, risk: 1 },
    { key: 'decline', label: 'Decline gently', hint: 'nothing spent; the family is a little sad', risk: 1 },
  ],
  fallback: 'grant',
  async choose(key, x) {
    const d = x.d;
    if (key === 'grant') {
      const no = await spend(x.q, x.sid, d.cost);
      if (no) return { error: no };
      await happy(x.q, [d.elder.id, ...arr(d.family)], 6);
      return { outcome: `${first(d.elder.name)} had their wish. The family will remember it.`, chronicle: `${d.elder.name} was granted ${d.wish}.` };
    }
    await happy(x.q, [d.heir ? d.heir.id : null, ...arr(d.family).slice(0, 2)].filter(Boolean), -6);
    return { outcome: `${first(d.elder.name)} understood. ${d.heir ? first(d.heir.name) + ' is sad about it.' : ''}`.trim(), chronicle: `${d.elder.name} asked for ${d.wish}, and was gently refused.` };
  },
});

// ── M5 Who inherits? (triggered by lib/inheritance at a death) ────────────
// args: { deceased_id }. Only when the eldest adult child doesn't work the
// trade and another child does, and there are heirlooms.
M.register('who_inherits', {
  source: 'family', icon: '🗝', title: 'Who inherits?', weight: 0, triggerOnly: true, cooldownDays: 0, expireHours: 24,
  async eligible(ctx) {
    const d = (await ctx.q('SELECT id, name, role, family_id FROM citizens WHERE id = $1 AND settlement_id = $2', [ctx.deceased_id, ctx.sid])).rows[0];
    if (!d) return null;
    const inh = (await ctx.q(`SELECT item_ids, class_key FROM inheritances WHERE deceased_id = $1 AND status = 'open'`, [d.id])).rows[0];
    if (!inh || !arr(inh.item_ids).length) return null;
    const kids = (await ctx.q(`SELECT id, name, role, born_at FROM citizens WHERE settlement_id = $1 AND ${LIVING} AND life_stage = 'adult' AND parent_ids @> $2::jsonb ORDER BY born_at ASC`,
      [ctx.sid, JSON.stringify([d.id])])).rows;
    if (kids.length < 2) return null;
    const eldest = kids[0];
    const crafter = kids.find(k => k.id !== eldest.id && k.role === (inh.class_key || d.role));
    if (!crafter || eldest.role === (inh.class_key || d.role)) return null;
    const items = (await ctx.q('SELECT name FROM inventory_items WHERE id = ANY($1::int[])', [arr(inh.item_ids).map(Number)])).rows.map(r => r.name);
    return { subject: { citizen_ids: [d.id, eldest.id, crafter.id], family_id: d.family_id },
      data: { speaker: eldest.name, deceased: { id: d.id, name: d.name }, eldest: { id: eldest.id, name: eldest.name }, crafter: { id: crafter.id, name: crafter.name, trade: inh.class_key || d.role }, items } };
  },
  text: d => `${d.deceased.name} left ${d.items.join(', ')}. ${first(d.eldest.name)} is the eldest, but ${first(d.crafter.name)} works as ${a_an(trade(d.crafter.trade))} ${trade(d.crafter.trade)}.`,
  options: d => [
    { key: 'eldest', label: `${first(d.eldest.name)}, the eldest`, hint: `tradition; ${first(d.crafter.name)} is put out`, risk: 1 },
    { key: 'crafter', label: `${first(d.crafter.name)}, who works the trade`, hint: `the heirloom works for them now; ${first(d.eldest.name)} resents it`, risk: 1 },
  ],
  fallback: 'eldest',
  async choose(key, x) {
    const d = x.d;
    const heir = key === 'crafter' ? d.crafter : d.eldest;
    const other = key === 'crafter' ? d.eldest : d.crafter;
    let note = '';
    try { await require('./inheritance').choose(x.sid, d.deceased.id, heir.id); }
    catch (e) {
      if (e && e.status === 404) note = ' (Their things had already been passed on.)';
      else return { error: (e && e.message) || 'That could not be done.' };
    }
    if (!note) await happy(x.q, [other.id], key === 'crafter' ? -8 : -5);
    return { outcome: `${first(heir.name)} takes up ${first(d.deceased.name)}'s things.${note}`, chronicle: note ? false : `${heir.name} was chosen to inherit ${d.deceased.name}'s ${d.items.join(', ')}.` };
  },
});

// ── M6 A quarrel between neighbours ────────────────────────────────────────
M.register('quarrel', {
  source: 'family', icon: '💢', title: 'A quarrel between neighbours', weight: 2, cooldownDays: 4, expireHours: 24,
  async eligible(ctx) {
    const town = await living(ctx);
    const adults = town.filter(c => c.life_stage === 'adult' && c.house_id);
    const pairs = [];
    for (let i = 0; i < adults.length; i++) for (let j = i + 1; j < adults.length; j++) {
      const a = adults[i], b = adults[j];
      if (a.house_id !== b.house_id || a.partner_id === b.id || LIFE.parentsOf(a).includes(b.id) || LIFE.parentsOf(b).includes(a.id)) continue;
      pairs.push([a, b]);
    }
    if (!pairs.length) return null;
    const [a, b] = pick(ctx.rng, pairs);
    const mover = new Date(a.born_at) > new Date(b.born_at) ? a : b;   // the younger
    const houses = (await ctx.q(`SELECT h.id, h.name, h.capacity, (SELECT COUNT(*) FROM citizens c WHERE c.house_id = h.id AND ${LIVING})::int AS n
                                   FROM houses h WHERE h.settlement_id = $1 AND h.id <> $2`, [ctx.sid, a.house_id])).rows.filter(h => h.n < h.capacity);
    const charmer = town.find(c => c.life_stage === 'adult' && c.id !== a.id && c.id !== b.id && arr(c.visible_traits).includes('charming'));
    return { subject: { citizen_ids: [a.id, b.id], family_id: a.family_id },
      data: { speaker: a.name, a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, mover: { id: mover.id, name: mover.name },
        house: houses[0] ? { id: houses[0].id, name: houses[0].name } : null, charmer: charmer ? { id: charmer.id, name: charmer.name } : null } };
  },
  text: d => `${first(d.a.name)} and ${first(d.b.name)} share a roof, and they've fallen out over whose turn it is to fetch the water.`,
  options: d => [
    { key: 'blow', label: 'Let it blow over', hint: 'their bond suffers', risk: 1 },
    ...(d.house ? [{ key: 'move', label: `Move ${first(d.mover.name)} to ${d.house.name}`, hint: 'peace kept; a new home for one', risk: 1 }] : []),
    ...(d.charmer ? [{ key: 'sit', label: `Ask ${first(d.charmer.name)} to sit them down`, hint: `their bond grows; ${first(d.charmer.name)} gives up an evening`, risk: 1 }] : []),
  ],
  fallback: 'blow',
  async choose(key, x) {
    const d = x.d;
    if (key === 'move' && d.house) {
      const h = (await x.q(`SELECT h.capacity, (SELECT COUNT(*) FROM citizens c WHERE c.house_id = h.id AND ${LIVING})::int AS n FROM houses h WHERE h.id = $1 AND h.settlement_id = $2`, [d.house.id, x.sid])).rows[0];
      if (!h || h.n >= h.capacity) return { error: `${d.house.name} is full now.` };
      await x.q('UPDATE citizens SET house_id = $1 WHERE id = $2 AND settlement_id = $3', [d.house.id, d.mover.id, x.sid]);
      return { outcome: `${first(d.mover.name)} moved to ${d.house.name}. The quarrel is over.`, chronicle: `${d.mover.name} moved to ${d.house.name} after a quarrel with ${first(d.mover.id === d.a.id ? d.b.name : d.a.name)}.` };
    }
    if (key === 'sit' && d.charmer) {
      await bond(x.q, x.sid, d.a.id, d.b.id, 10);
      await happy(x.q, [d.charmer.id], -3);
      return { outcome: `${first(d.charmer.name)} talked it through with them. They're friends again, better than before.`, chronicle: `${d.charmer.name} made peace between ${d.a.name} and ${d.b.name}.` };
    }
    await bond(x.q, x.sid, d.a.id, d.b.id, -12);
    return { outcome: `The quarrel blew over, but ${first(d.a.name)} and ${first(d.b.name)} are cooler with each other now.`, chronicle: `${d.a.name} and ${d.b.name} fell out over the water.` };
  },
});

// ── M7 A settler at the gate (triggered by lib/settlers) ──────────────────
// args: { settler } — rolled by settlers.makeSettler, kept in the data.
M.register('settler_gate', {
  source: 'family', icon: '🧳', title: 'A settler at the gate', weight: 0, triggerOnly: true, cooldownDays: 0, expireHours: 24,
  async eligible(ctx) {
    const t = ctx.settler;
    if (!t) return null;
    // Could they go straight to an outpost? One with a free worker's place.
    let outpost = null;
    try {
      const s = ctx.settlement;
      const list = await require('./outpost_state').load({ query: ctx.q }, s);
      const slots = o => Math.max(1, Number(o.level) || 1) + Math.round((o.bfx && o.bfx.worker_slots) || 0);   // as routes/outposts
      const o = list.find(o => (o.workers || []).length < slots(o));
      if (o) outpost = { id: o.id, name: o.name || 'outpost' };
    } catch (e) { outpost = null; }
    return { subject: { citizen_ids: [] }, data: { speaker: t.name, settler: t, outpost } };
  },
  text: d => `${d.settler.name}, ${d.settler.age}, has walked a long way and asks to settle here.`,
  options: d => [
    { key: 'welcome', label: 'Welcome them', hint: 'a new adult and a new family line', risk: 0 },
    ...(d.outpost ? [{ key: 'outpost', label: `Welcome them to work the ${d.outpost.name}`, hint: 'straight to the outpost, no bed needed; less happy', risk: 0 }] : []),
    { key: 'away', label: 'Turn them away', hint: 'nothing changes', risk: 0 },
  ],
  fallback: 'welcome',
  async choose(key, x) {
    const d = x.d;
    if (key === 'away') return { outcome: `${first(d.settler.name)} thanked you and went on their way.`, chronicle: `${d.settler.name} asked to settle and was turned away.` };
    const b = await x.q(`SELECT (SELECT COALESCE(SUM(capacity), 0) FROM houses WHERE settlement_id = $1)::int AS beds,
                                (SELECT COUNT(*) FROM citizens WHERE settlement_id = $1 AND ${LIVING})::int AS n`, [x.sid]);
    // An outpost worker sleeps at the outpost; the town needs a bed for anyone else.
    if (key !== 'outpost' && b.rows[0].n >= b.rows[0].beds) return { outcome: `By the time word came, every bed was taken; ${first(d.settler.name)} went on to another town.` };
    const s = (await x.q('SELECT id, name FROM settlements WHERE id = $1', [x.sid])).rows[0];
    // admitOne uses the shared pool; it touches only new rows and this town's
    // counts, which the moment's transaction does not hold.
    const came = await require('./settlers').admitOne(s, { ...d.settler, at: Date.now() }, { noHouse: key === 'outpost' });
    if (key === 'outpost' && d.outpost) {
      await require('../db').query(`INSERT INTO outpost_crew (citizen_id, outpost_id, post) VALUES ($1, $2, 'worker') ON CONFLICT DO NOTHING`, [came.id, d.outpost.id]).catch(() => {});
      await require('../db').query(`UPDATE citizens SET life = jsonb_set(COALESCE(life, '{}'::jsonb), '{happiness}', to_jsonb(GREATEST(0, COALESCE((life->>'happiness')::numeric, 70) - 10))) WHERE id = $1`, [came.id]);
      return { outcome: `${first(d.settler.name)} has settled and gone straight to work the ${d.outpost.name}.`, chronicle: false };
    }
    return { outcome: `${first(d.settler.name)} has settled in your town and starts the ${d.settler.surname} family.`, chronicle: false };
  },
});

// ── M8 A gifted child ──────────────────────────────────────────────────────
M.register('gifted_child', {
  source: 'family', icon: '✨', title: 'A gifted child', weight: 1, cooldownDays: 7, expireHours: 24, gentle: true,
  async eligible(ctx) {
    const town = await living(ctx);
    const done = await askedAbout(ctx, 'gifted_child');
    for (const y of town.filter(c => LIFE.stageOf(c, ctx.now) === 'youth' && !done.has(c.id))) {
      const t = arr(y.hidden_traits).find(k => T().APTITUDES[k] && !arr(y.revealed_traits).includes(k));
      if (!t) continue;
      const cls = T().APTITUDES[t].classes[0];
      return { subject: { citizen_ids: [y.id], family_id: y.family_id },
        data: { speaker: y.name, youth: { id: y.id, name: y.name, age: Math.floor(LIFE.ageOf(y, ctx.now)) }, trait: t, cls, xp: 200 } };
    }
    return null;
  },
  text: d => `${first(d.youth.name)}, ${d.youth.age}, has an unusual gift for the ${trade(d.cls)}'s work. Everyone has noticed.`,
  options: d => [
    { key: 'child', label: 'Let them be a child', hint: 'happier; the gift will show in time', risk: 0 },
    { key: 'train', label: `Start training them as ${a_an(trade(d.cls))} ${trade(d.cls)} now`, hint: 'more skill at 12; less happy', risk: 1 },
  ],
  fallback: 'child',
  async choose(key, x) {
    const d = x.d;
    if (key === 'train') {
      await x.q('UPDATE citizens SET apprentice_class = $1 WHERE id = $2 AND settlement_id = $3', [d.cls, d.youth.id, x.sid]);
      await x.q(`UPDATE citizens SET revealed_traits = COALESCE(revealed_traits, '[]'::jsonb) || $2::jsonb WHERE id = $1 AND NOT (COALESCE(revealed_traits, '[]'::jsonb) ? $3)`,
        [d.youth.id, JSON.stringify([d.trait]), d.trait]);
      await require('./careers').grantXp(x.client, x.sid, [{ citizenId: d.youth.id, classKey: d.cls, xp: d.xp }], []);
      await happy(x.q, [d.youth.id], -8);
      return { outcome: `${first(d.youth.name)} has started early training as ${a_an(trade(d.cls))} ${trade(d.cls)}.`, chronicle: `${d.youth.name} began training early as ${a_an(trade(d.cls))} ${trade(d.cls)}.` };
    }
    await happy(x.q, [d.youth.id], 8);
    return { outcome: `${first(d.youth.name)} goes on playing. The gift will keep.`, chronicle: `${d.youth.name}'s gift was left to grow in its own time.` };
  },
});
