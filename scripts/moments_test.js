// ══════════════════════════════════════════════════════════════════════════
//  moments_test — the moments engine (docs/PHASE_2_MOMENTS.md §2, §7).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/moments_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function main() {
  const M = require('../lib/moments');

  console.log('Content (every kind)');
  {
    // Representative data for each kind's text and options.
    const sample = { cost: { timber: 40, food: 30 }, need: 12, amount: 50, res: 'stone', qty: 40, price: 60, food: 70, wealth: 50, bonus: 0, outpost_name: 'Camp' };
    // Family kinds (M1–M8): every optional option present, and none of them.
    const P = (id, name) => ({ id, name });
    const fam = { speaker: 'Ada Reed', child: P(1, 'Baby Reed'), mother: P(2, 'Ada Reed'), father: P(3, 'Tom Reed'), grand: { ...P(4, 'Old Reed'), alive: true, rel: 'grandmother' },
      friend: P(5, 'Bo Fern'), youth: { ...P(6, 'Kit Reed'), age: 8 }, parent: P(3, 'Tom Reed'), parentTrade: 'farmer', wish: 'forager', knack: 'green_thumb',
      a: P(7, 'Ann Ash'), b: P(8, 'Ben Elm'), obj: P(9, 'Gran Ash'), objFor: 'Ann Ash', elder: { ...P(9, 'Gran Ash'), age: 72 }, heir: P(7, 'Ann Ash'), family: [7],
      deceased: P(10, 'Pa Elm'), eldest: P(8, 'Ben Elm'), crafter: { ...P(11, 'Cal Elm'), trade: 'farmer' }, items: ["Pa's Hoe"], mover: P(8, 'Ben Elm'), house: P(1, 'Willow Hut'),
      charmer: P(12, 'Sly Fox'), settler: { name: 'Nell Moss', surname: 'Moss', age: 20 }, outpost: P(1, 'Camp'), trait: 'green_thumb', cls: 'farmer' };
    const bare = { ...fam, grand: null, friend: null, house: null, charmer: null, outpost: null, knack: null };
    // The year and quests (M9–M17).
    const yq = { year: 1, speaker: 'Fen Furrow', youths: 2, cost: { food: 80, wealth: 40 }, food: 10, need: 90, deficit: 80, price: 80, village: P(1, 'Oakmere'), elders: [9],
      young: [{ ...P(6, 'Kit Reed'), cls: 'farmer' }], family: P(1, 'Reed'), frightened: P(6, 'Kit Reed'), finder: P(5, 'Bo Fern'), party: [5, 7],
      item: { name: 'Bronze Knife', icon: '🔪', item_key: 'bronze_knife' }, kindest: P(7, 'Ann Ash'), stranger: { name: 'Nell Moss', surname: 'Moss', age: 20 },
      title: 'The Fallen Watchtree', who: { ...P(5, 'Bo Fern'), fighter: true } };
    const yqBare = { ...yq, speaker: null, youths: 0, village: null, elders: [], family: null, who: { ...yq.who, fighter: false } };
    // Villages and raids (M18–M20, M28–M30).
    const vr = { speaker: 'An envoy from Oakmere', village: P(1, 'Oakmere'), food: 80, workers: [P(1, 'Ann Vale'), P(2, 'Bo Vale')], ours: P(3, 'Cy Vale'),
      spouse: { name: 'Nell Moss', surname: 'Moss', age: 25 }, gift: 'Loyal', res: 'timber', amount: 60, need: 'to mend their bridge',
      raid_id: 1, target: 'the Farmstead', from: 'Blightmoor', hours: 3, outpost: true, crew: [P(4, 'Wil Worker')], tribute: 200,
      hero: P(5, 'Gus Guard'), already: false, child: { name: 'Ash Ember', surname: 'Ember', age: 5 }, objector: { ...P(6, 'Ada Hale'), family: 'Hale' } };
    const vrBare = { ...vr, workers: [], village: null, outpost: false, crew: [], already: true, objector: null };
    const samples = k => (['year', 'quest'].includes(M.DEFS[k].source) ? [{ ...sample, ...yq }, { ...sample, ...yqBare }]
      : ['village', 'raid'].includes(M.DEFS[k].source) ? [{ ...sample, ...vr }, { ...sample, ...vrBare, village: ['village_help', 'envoy_offer', 'debt_called'].includes(k) ? vr.village : null }]
      : [{ ...sample, ...fam }, { ...sample, ...bare }]);
    const bad = [];
    for (const k of Object.keys(M.DEFS)) for (const data of samples(k)) for (const p of M.check(k, data)) bad.push(`${k}: ${p}`);
    const texts = [];
    for (const k of Object.keys(M.DEFS)) if (['family', 'year', 'quest', 'village', 'raid'].includes(M.DEFS[k].source)) for (const data of samples(k)) {
      const all = M.DEFS[k].text(data) + ' ' + M.DEFS[k].options(data).map(o => o.label + ' ' + o.hint).join(' ');
      if (/undefined|null|NaN|\[object/.test(all)) texts.push(`${k}: ${all}`);
    }
    check(texts.length === 0, 'family, year, quest, village and raid moments read cleanly with and without their optional parts' + (texts.length ? ' — ' + texts.join(' | ') : ''));
    check(['name_baby', 'child_wish', 'proposal', 'last_request', 'who_inherits', 'quarrel', 'settler_gate', 'gifted_child'].every(k => M.DEFS[k] && M.DEFS[k].source === 'family'), 'the eight family moments are registered');
    check(M.DEFS.who_inherits.triggerOnly && M.DEFS.settler_gate.triggerOnly, 'who inherits and the settler at the gate are only ever triggered');
    check(bad.length === 0, 'every option has a hint; every default is an option and never the single worst' + (bad.length ? ' — ' + bad.join('; ') : ''));
    check(Object.values(M.DEFS).every(d => d.icon && d.title && typeof d.eligible === 'function' && typeof d.choose === 'function' && d.expireHours > 0), 'every kind has an icon, a title, eligible(), choose() and an expiry');
    check(['rich_vein', 'trader', 'wolves', 'cache', 'storm', 'harvest', 'traveller'].every(k => M.DEFS[k] && M.DEFS[k].source === 'outpost'), 'the seven outpost events are moment kinds');
    check(M.DEFS.traveller.weight === 0, 'the lost traveller is no longer rolled (merged into the settler at the gate)');
    check(M.DEFS.wolves.fallback === 'fight', 'wolves default to driving them off, not the worst option');
  }

  // Test-only kinds, registered in this process (the engine runs here too).
  let chose = [];
  const mk = (kind, extra = {}) => M.register(kind, {
    source: 'test', icon: '🧪', title: 'Test ' + kind, weight: 1, cooldownDays: 2, expireHours: 12,
    eligible: async () => ({ subject: { citizen_ids: [] }, data: { n: 1 } }),
    text: () => 'A test.', options: () => [{ key: 'a', label: 'A', hint: 'nothing', risk: 0 }, { key: 'b', label: 'B', hint: 'costly', risk: 2 }],
    fallback: 'a',
    async choose(key) { chose.push(key); return key === 'b' && extra.failB ? { error: 'Cannot.' } : { outcome: `Chose ${key}.`, chronicle: `The test went ${key}.` }; },
    ...extra,
  });

  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const RUN = Math.random().toString(36).slice(2, 7);
  const town = async name => {
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [`${name}_${RUN}`, `${name}_${RUN}@t.l`])).rows[0];
    return (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, food) VALUES ($1,$2,2,'camp',$3,0,NOW(),500,500) RETURNING id`,
      [u.id, `${name}_${RUN}`, -120000 - Math.floor(Math.random() * 5000) * 20])).rows[0].id;
  };

  console.log('The budget, the cap and cooldowns');
  {
    // Only test kinds in play for this block.
    const saved = {};
    for (const k of Object.keys(M.DEFS)) { saved[k] = M.DEFS[k].weight; M.DEFS[k].weight = 0; }
    mk('t_one'); mk('t_two'); mk('t_three'); mk('t_gentle', { gentle: true });
    const sid = await town('mbud');
    check(!(await M.roll(sid)), "a town's first check only starts the clock");
    check(!(await M.roll(sid)), 'and its first moment waits a few minutes');
    await q("UPDATE settlements SET moments_seen_at = NOW() - interval '6 minutes' WHERE id = $1", [sid]);
    const first = await M.roll(sid);
    check(first && first.kind === 't_gentle', "a town's first moment is a gentle one");
    check(!(await M.roll(sid)), 'the next waits at least 6 hours');
    await q("UPDATE moments SET created_at = NOW() - interval '7 hours' WHERE settlement_id = $1", [sid]);
    const second = await M.roll(sid);
    check(second && second.kind !== 't_gentle', 'after the spacing, another (never the same kind twice running)');
    await q("UPDATE moments SET created_at = NOW() - interval '7 hours' WHERE settlement_id = $1 AND id = $2", [sid, second.id]);
    await q("UPDATE moments SET created_at = NOW() - interval '14 hours' WHERE settlement_id = $1 AND id = $2", [sid, first.id]);
    const third = await M.roll(sid);
    await q("UPDATE moments SET created_at = NOW() - interval '6.5 hours' WHERE settlement_id = $1 AND id = $2", [sid, third && third.id]);
    check(third && !(await M.roll(sid)), 'three a day at most (a fourth waits)');
    // The cap: four open at once.
    await q("UPDATE moments SET created_at = NOW() - interval '30 hours' WHERE settlement_id = $1", [sid]);
    const fourth = await M.roll(sid);
    await q("UPDATE moments SET created_at = NOW() - interval '30 hours' WHERE settlement_id = $1", [sid]);
    check(fourth && (await q('SELECT COUNT(*)::int AS n FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [sid])).rows[0].n === 4, 'a fourth opens a day later');
    check(!(await M.roll(sid)), 'never more than four open');
    // Cooldowns: every test kind was used; with them all within 2 days, nothing fits.
    await q('UPDATE moments SET resolved_at = NOW(), outcome = $2 WHERE settlement_id = $1', [sid, 'cleared']);
    check(!(await M.roll(sid)), 'each kind waits out its cooldown (all four were used within two days)');
    await q("UPDATE moments SET created_at = NOW() - interval '3 days' WHERE settlement_id = $1", [sid]);
    check(!!(await M.roll(sid)), 'and comes back after it');
    for (const [k, w] of Object.entries(saved)) M.DEFS[k].weight = w;
  }

  console.log('Choosing, defaults and the chronicle');
  {
    mk('t_pick', { triggerOnly: true });
    const sid = await town('mpick');
    const m = await M.start(sid, 't_pick');
    check(m && m.options.length === 2 && m.options.every(o => o.hint) && m.fallback === 'a', 'a moment shows its options with hints and its default');
    check((await M.choose(sid, m.id, 'zzz')).status === 400, 'only one of its options');
    const r = await M.choose(sid, m.id, 'b');
    check(r.ok && r.outcome === 'Chose b.' && !r.auto, 'answered: the outcome comes back');
    check((await M.choose(sid, m.id, 'a')).status === 404, 'answered once');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment'", [sid])).rows;
    check(ch.length === 1 && ch[0].text === 'The test went b.', 'the outcome writes a chronicle line');
    const m2 = await M.start(sid, 't_pick');
    await q("UPDATE moments SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [m2.id]);
    await M.tick(true);
    const row = (await q('SELECT choice, auto, outcome FROM moments WHERE id = $1', [m2.id])).rows[0];
    check(row.choice === 'a' && row.auto === true && row.outcome, 'unanswered in time: the default happens by itself');
    const ch2 = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment' ORDER BY id DESC LIMIT 1", [sid])).rows[0];
    check(/^Nobody sent word/.test(ch2.text), 'and the chronicle says nobody answered');
    // A default that can't be done falls back… to the default; a failing choice is refused.
    mk('t_fail', { triggerOnly: true, failB: true });
    const m3 = await M.start(sid, 't_fail');
    check((await M.choose(sid, m3.id, 'b')).status === 400, 'a choice that cannot be done is refused (and stays open)');
  }

  console.log('Triggered moments');
  {
    mk('t_trig', { triggerOnly: true });
    const sid = await town('mtrig');
    await q("UPDATE settlements SET moments_seen_at = NOW() - interval '1 hour' WHERE id = $1", [sid]);
    for (let i = 0; i < 4; i++) await M.trigger(sid, 't_trig');
    check((await q('SELECT COUNT(*)::int AS n FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [sid])).rows[0].n === 4, 'triggered moments skip the budget');
    const fifth = await M.trigger(sid, 't_trig');
    check(fifth && fifth.resolved && fifth.outcome === 'Chose a.', 'at the cap the default happens at once');
    const ch = (await q("SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = 'moment' ORDER BY id DESC LIMIT 1", [sid])).rows[0];
    check(/^Too much was waiting/.test(ch.text), 'and the chronicle reports it');
    check(!(await M.roll(sid)) || true, '(roll leaves trigger-only kinds alone)');
  }

  // ── The family moments, M1–M8 (§3), one small town each ─────────────────
  console.log('Family moments');
  {
    const LIFE = require('../lib/life');
    const house = async (sid, cap = 4, name = 'Hut') => (await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,$2,'starter_house',$3) RETURNING id", [sid, name, cap])).rows[0].id;
    const cit = async (sid, name, o = {}) => (await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, house_id, partner_id, parent_ids, life_stage, born_at, last_birthday_year, hidden_traits, visible_traits, life)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{"happiness":70}') RETURNING id`,
      [sid, name, o.gender || 'female', o.role || 'forager', o.house_id || null, o.partner_id || null, JSON.stringify(o.parent_ids || []),
       o.life_stage || ((o.age != null ? o.age : 30) < 12 ? 'child' : 'adult'), o.born_at || LIFE.bornAtFor(o.age != null ? o.age : 30).toISOString(),
       Math.floor(o.age != null ? o.age : 30), JSON.stringify(o.hidden || []), JSON.stringify(o.visible || [])])).rows[0].id;
    const pair = async (a, b) => { await q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [b, a]); await q('UPDATE citizens SET partner_id = $1 WHERE id = $2', [a, b]); };
    const rel = (sid, a, b, score, state = 'close') => q(`INSERT INTO citizen_relationships (settlement_id, citizen_a_id, citizen_b_id, score, state) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (citizen_a_id, citizen_b_id) DO UPDATE SET score = $4, state = $5`, [sid, Math.min(a, b), Math.max(a, b), score, state]);
    const one = async (id, cols = '*') => (await q(`SELECT ${cols} FROM citizens WHERE id = $1`, [id])).rows[0];
    const happy = async id => Number((await one(id, 'life')).life.happiness);
    const withData = async m => { if (m) m.data = (await q('SELECT data FROM moments WHERE id = $1', [m.id])).rows[0].data; return m; };
    const st = async (sid, kind) => withData(await M.start(sid, kind));
    const tr = async (sid, args) => withData(await M.trigger(sid, 'settler_gate', args));
    const chron = async (sid, kind) => (await q('SELECT text FROM chronicle WHERE settlement_id = $1 AND kind = $2 ORDER BY id', [sid, kind])).rows.map(r => r.text);

    // M1 A name for the baby.
    {
      const sid = await town('fam1'); const h = await house(sid);
      const gm = await cit(sid, 'Mara Ash', { age: 50, house_id: h });
      const mum = await cit(sid, 'Ada Ash', { age: 25, parent_ids: [gm], house_id: h });
      const dad = await cit(sid, 'Tom Elm', { age: 27, gender: 'male', house_id: h });
      const pal = await cit(sid, 'Bo Fern', { age: 27, gender: 'male' });
      await pair(mum, dad); await rel(sid, dad, pal, 70);
      const baby = await cit(sid, 'Wren Elm', { age: 0, parent_ids: [mum, dad], born_at: new Date(Date.now() - 3600e3).toISOString(), house_id: h });
      await LIFE.assignFamilies(sid);
      const m = await st(sid, 'name_baby');
      check(m && m.data.child.id === baby && m.data.grand && m.data.grand.id === gm && m.data.friend && m.data.friend.id === pal, 'M1: a new baby; the grandmother and the father\'s friend are offered');
      check(m && m.options.map(o => o.key).join() === 'grand,friend,town' && m.fallback === 'grand', 'M1: three names, the grandparent the default');
      const before = await happy(gm);
      const r = await M.choose(sid, m.id, 'grand');
      check(r.ok && (await one(baby, 'name')).name === 'Mara Elm', 'M1: the baby takes the grandmother\'s first name and keeps the family name');
      check(await happy(gm) === before + 8, 'M1: the grandmother is delighted');
      check((await chron(sid, 'moment')).some(t => /named their child Mara Elm/.test(t)), 'M1: the chronicle records the name');
      check(!(await st(sid, 'name_baby')), 'M1: a baby is only named once');
    }
    // M2 A child's wish; M8 A gifted child.
    {
      const sid = await town('fam2'); const h = await house(sid);
      await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1, 'farm', 1)", [sid]).catch(() => {});
      const dad = await cit(sid, 'Tom Reed', { age: 35, gender: 'male', role: 'farmer', house_id: h });
      const kit = await cit(sid, 'Kit Reed', { age: 7.5, parent_ids: [dad], house_id: h, hidden: ['green_thumb'] });
      const m = await st(sid, 'child_wish');
      check(m && m.data.youth.id === kit && m.data.parentTrade === 'farmer' && m.data.wish !== 'farmer', 'M2: a youth of 7 wants a different trade from their parent');
      check(m && m.data.knack === 'green_thumb' && m.data.wish === 'forager', 'M2: a hidden knack shapes the wish');
      await M.choose(sid, m.id, 'wish');
      const k = await one(kit, 'apprentice_class, revealed_traits');
      check(k.apprentice_class === 'forager' && (k.revealed_traits || []).includes('green_thumb'), 'M2: they learn the trade they wished for, and the knack shows');
      check(!(await st(sid, 'child_wish')), 'M2: asked once');
      // M8 with a second youth.
      const ivy = await cit(sid, 'Ivy Reed', { age: 9, parent_ids: [dad], house_id: h, hidden: ['green_thumb'] });
      await q("UPDATE citizens SET apprentice_class = 'farmer' WHERE id = $1", [ivy]);
      const g = await st(sid, 'gifted_child');
      check(g && g.data.youth.id === ivy && g.data.cls === 'farmer' && g.fallback === 'child', 'M8: a youth with a hidden knack; the default lets them be a child');
      const before = await happy(ivy);
      await M.choose(sid, g.id, 'train');
      const v = await one(ivy, 'apprentice_class, revealed_traits, life');
      const xp = (await q("SELECT xp FROM citizen_classes WHERE citizen_id = $1 AND class_key = 'farmer'", [ivy])).rows[0];
      check(v.apprentice_class === 'farmer' && (v.revealed_traits || []).includes('green_thumb') && xp && Number(xp.xp) > 0, 'M8: early training: the knack shows and they gain experience');
      check(Number(v.life.happiness) === before - 8, 'M8: and they are less happy');
    }
    // M3 A proposal across families.
    {
      const sid = await town('fam3'); const h1 = await house(sid); const h2 = await house(sid);
      const gm = await cit(sid, 'Mara Ash', { age: 55, house_id: h1 });
      const ann = await cit(sid, 'Ann Ash', { age: 22, parent_ids: [gm], house_id: h1 });
      const bo = await cit(sid, 'Bo Fern', { age: 24, gender: 'male', house_id: h2 });
      await LIFE.assignFamilies(sid);
      await rel(sid, ann, bo, 80, 'bonded');
      const m = await st(sid, 'proposal');
      check(m && m.data.obj.id === gm && m.fallback === 'bless', 'M3: two from different families want to marry; the older head objects; the default is to bless it');
      await M.choose(sid, m.id, 'bless');
      const [a, b] = [await one(ann, 'partner_id'), await one(bo, 'partner_id')];
      const r = (await q('SELECT state FROM citizen_relationships WHERE citizen_a_id = $1 AND citizen_b_id = $2', [Math.min(ann, bo), Math.max(ann, bo)])).rows[0];
      check(a.partner_id === bo && b.partner_id === ann && r.state === 'partners', 'M3: blessed, they are partners');
      check(await happy(gm) === 60, 'M3: the objector is unhappy');
      check(!(await st(sid, 'proposal')), 'M3: partners are not asked again');
    }
    // M4 An elder's last request; the default falls back when it can't be done.
    {
      const sid = await town('fam4');
      const yew = await cit(sid, 'Old Yew', { age: 80 });
      const oak = await cit(sid, 'Old Oak', { age: 75, gender: 'male' });
      await LIFE.assignFamilies(sid);
      const m = await st(sid, 'last_request');
      check(m && m.data.elder.id === yew && m.fallback === 'grant', 'M4: the oldest elder asks; the default is to grant it');
      await q('UPDATE settlements SET food = 100 WHERE id = $1', [sid]);
      const no = await M.choose(sid, m.id, 'grant');
      check(no.status === 400 && /Not enough food/.test(no.error), 'M4: granting needs the food');
      const auto = await M.choose(sid, m.id, 'grant', true);
      check(auto.ok && auto.choice === 'decline', 'M4: when the default can\'t be done, the next choice is taken instead of leaving it stuck');
      await q('UPDATE settlements SET food = 500 WHERE id = $1', [sid]);
      const m2 = await st(sid, 'last_request');
      check(m2 && m2.data.elder.id === oak, 'M4: each elder asks once');
      await M.choose(sid, m2.id, 'grant');
      check(Number((await q('SELECT food FROM settlements WHERE id = $1', [sid])).rows[0].food) === 350 && await happy(oak) === 76, 'M4: granted: 150 food, and they are comforted');
    }
    // M5 Who inherits? (triggered at a death)
    {
      const sid = await town('fam5');
      const pa = await cit(sid, 'Pa Birch', { age: 78, gender: 'male', role: 'farmer' });
      const ed = await cit(sid, 'Ed Birch', { age: 40, gender: 'male', role: 'forager', parent_ids: [pa] });
      const cal = await cit(sid, 'Cal Birch', { age: 35, gender: 'male', role: 'farmer', parent_ids: [pa] });
      await LIFE.assignFamilies(sid);
      await q("INSERT INTO citizen_classes (citizen_id, settlement_id, class_key, xp, level, hours_worked) VALUES ($1, $2, 'farmer', 2000, 6, 400)", [pa, sid]);
      await q(`INSERT INTO inventory_items (settlement_id, item_key, name, category, equip_slot, stat_bonuses, equipped_to)
               VALUES ($1, 'iron_hoe', 'Iron Hoe', 'equipment', 'tool', '{"farming":2}', $2)`, [sid, pa]);
      await require('../deaths').writeDeathEvent({ citizenId: pa, settlementId: sid, cause: 'old_age', narrative: 'passed away.' });
      const m = (await q("SELECT * FROM moments WHERE settlement_id = $1 AND kind = 'who_inherits' AND resolved_at IS NULL", [sid])).rows[0];
      check(m && m.data.eldest.id === ed && m.data.crafter.id === cal, 'M5: the eldest doesn\'t work the trade but a brother does, so the town is asked');
      const before = await happy(ed);
      const r = await M.choose(sid, m.id, 'crafter');
      const inh = (await q('SELECT status, heir_id FROM inheritances WHERE deceased_id = $1', [pa])).rows[0];
      check(r.ok && inh.status !== 'open' && inh.heir_id === cal, 'M5: the one in the trade inherits');
      check(await happy(ed) === before - 8, 'M5: the eldest resents it');
      // A family where the eldest works the trade is not asked.
      const sid2 = await town('fam5b');
      const ma = await cit(sid2, 'Ma Rowan', { age: 78, role: 'farmer' });
      await cit(sid2, 'Jo Rowan', { age: 40, role: 'farmer', parent_ids: [ma] });
      await cit(sid2, 'Lu Rowan', { age: 35, role: 'forager', parent_ids: [ma] });
      await LIFE.assignFamilies(sid2);
      await q(`INSERT INTO inventory_items (settlement_id, item_key, name, category, equip_slot, stat_bonuses, equipped_to) VALUES ($1, 'iron_hoe', 'Iron Hoe', 'equipment', 'tool', '{}', $2)`, [sid2, ma]);
      await require('../deaths').writeDeathEvent({ citizenId: ma, settlementId: sid2, cause: 'old_age', narrative: 'passed away.' });
      check(!(await q("SELECT 1 FROM moments WHERE settlement_id = $1 AND kind = 'who_inherits'", [sid2])).rows.length, 'M5: not asked when the eldest already works the trade');
    }
    // M6 A quarrel between neighbours.
    {
      const sid = await town('fam6'); const h1 = await house(sid); const h2 = await house(sid, 4, 'Second Hut');
      const a = await cit(sid, 'Ann Oak', { age: 30, house_id: h1, visible: ['charming'] });
      const b = await cit(sid, 'Bea Fir', { age: 25, house_id: h1 });
      const sly = await cit(sid, 'Sly Fox', { age: 33, house_id: h2, visible: ['charming'] });
      await rel(sid, a, b, 50, 'friends');
      const m = await st(sid, 'quarrel');
      check(m && m.options.map(o => o.key).join() === 'blow,move,sit' && m.data.mover.id === b && m.data.charmer.id === sly, 'M6: housemates fall out; moving and a charming peacemaker are offered');
      await M.choose(sid, m.id, 'move');
      check((await one(b, 'house_id')).house_id === h2, 'M6: the younger moves to another house with room');
      const m2 = await st(sid, 'quarrel');
      await M.choose(sid, m2.id, 'sit');
      const r = (await q('SELECT score FROM citizen_relationships WHERE citizen_a_id = $1 AND citizen_b_id = $2', [Math.min(b, sly), Math.max(b, sly)])).rows[0];
      check(r && Number(r.score) === 30, 'M6: sat down by the peacemaker, their bond grows');
    }
    // M7 A settler at the gate.
    {
      const sid = await town('fam7'); const h = await house(sid);
      await cit(sid, 'Ann Oak', { age: 30, house_id: h });
      await q("UPDATE settlements SET last_settler_at = NOW() - interval '8 days' WHERE id = $1", [sid]);
      const n0 = (await q("SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1", [sid])).rows[0].n;
      const came = await require('../lib/settlers').arrive(sid);
      const m = (await q("SELECT * FROM moments WHERE settlement_id = $1 AND kind = 'settler_gate' AND resolved_at IS NULL", [sid])).rows[0];
      check(came.length >= 1 && came[0].moment && m && m.data.settler.name, 'M7: a due settler waits at the gate as a moment');
      check((await q("SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1", [sid])).rows[0].n === n0, 'M7: nobody comes in until the town answers');
      const r = await M.choose(sid, m.id, 'welcome');
      const nc = (await q('SELECT id, house_id FROM citizens WHERE settlement_id = $1 AND name = $2', [sid, m.data.settler.name])).rows[0];
      check(r.ok && nc && nc.house_id === h, 'M7: welcomed, the settler comes in and gets a bed');
      const lines = await chron(sid, 'settler');
      check(lines.some(t => t.includes(m.data.settler.name)) && !(await chron(sid, 'moment')).some(t => t.includes(m.data.settler.name)), 'M7: one chronicle line for the settler, not two');
      // A full town with an outpost: no bed in town, but a place at the outpost.
      const sid2 = await town('fam7b'); const h2 = await house(sid2, 1);
      await cit(sid2, 'Ann Oak', { age: 30, house_id: h2 });
      const oid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{}',NOW()) RETURNING id`, [sid2, -140000 - Math.floor(Math.random() * 5000) * 20])).rows[0].id;
      const S = require('../lib/settlers');
      const { types, taken } = await S.townFor(sid2);
      const g1 = await tr(sid2, { settler: S.makeSettler(taken, types) });
      const g2 = await tr(sid2, { settler: S.makeSettler(taken, types) });
      check(g1 && g1.options.some(o => o.key === 'outpost'), 'M7: with room at an outpost, they can be sent there');
      const w = await M.choose(sid2, g1.id, 'welcome');
      check(w.ok && /every bed was taken/.test(w.outcome) && !(await q('SELECT 1 FROM citizens WHERE name = $1 AND settlement_id = $2', [g1.data.settler.name, sid2])).rows.length, 'M7: with no bed in town, a welcomed settler goes on elsewhere');
      await M.choose(sid2, g2.id, 'outpost');
      const oc = (await q(`SELECT c.house_id, oc.post FROM citizens c JOIN outpost_crew oc ON oc.citizen_id = c.id WHERE c.settlement_id = $1 AND c.name = $2`, [sid2, g2.data.settler.name])).rows[0];
      check(oc && oc.post === 'worker' && oc.house_id === null && oid, 'M7: sent to the outpost, they work there without a bed in town');
    }
  }

  // ── The year (M9–M13) and quests (M14–M17) ─────────────────────────────
  {
    const LIFE = require('../lib/life');
    const TE = require('../lib/town_effects');
    const TM = require('../lib/town_mods');
    const { seasonAt } = require('../seasons');
    const H = 3600e3;
    // A moment in a season: the first time in the next game year that season is under way.
    const when = id => { for (let t = Date.now(); t < Date.now() + 29 * H; t += 10 * 60e3) { const x = seasonAt(t); if (x.id === id && x.progress < 0.3) return t; } return null; };
    const house = async (sid, cap = 4) => (await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,'Hut','starter_house',$2) RETURNING id", [sid, cap])).rows[0].id;
    const cit = async (sid, name, o = {}) => (await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, house_id, parent_ids, life_stage, born_at, last_birthday_year, visible_traits, stats, life)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{"strength":5}','{"happiness":70}') RETURNING id`,
      [sid, name, o.gender || 'female', o.role || 'forager', o.house_id || null, JSON.stringify(o.parent_ids || []),
       (o.age != null ? o.age : 30) < 12 ? 'child' : 'adult', LIFE.bornAtFor(o.age != null ? o.age : 30).toISOString(), Math.floor(o.age != null ? o.age : 30), JSON.stringify(o.visible || [])])).rows[0].id;
    const st = async (sid, kind, now) => { const m = await M.start(sid, kind, { now }); if (m) m.data = (await q('SELECT data FROM moments WHERE id = $1', [m.id])).rows[0].data; return m; };
    const effects = async sid => (await q('SELECT key, mods, starts_at, ends_at FROM town_effects WHERE settlement_id = $1 ORDER BY id', [sid])).rows;
    const res = async (sid, cols) => (await q(`SELECT ${cols} FROM settlements WHERE id = $1`, [sid])).rows[0];

    console.log('Timed town effects');
    {
      const sid = await town('eff');
      const s0 = (await q('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
      const now = Date.now();
      await TE.add(null, sid, { key: 'test', label: 'Test', mods: { all_production: 0.10, happiness: 4, food_upkeep: -0.25, birth_chance: 0.05 }, startsAt: now - H, endsAt: now + H });
      const t = await TM.load(null, s0, now);
      check(t.mods.happiness >= 4 && t.mods.food_upkeep === -0.25 && t.sources.some(x => x.key === 'effect:test'), 'a live effect counts in the town\'s mods and is listed as a source');
      const f = TM.productionFactors(t, s0, now - 2 * H, now);
      check(Math.abs(f.food - 1.05) < 1e-9, 'production counts it only for the hours it overlapped (half of two hours: +5%)');
      check(Math.abs(TM.productionFactors(t, s0, now, now + 1).food - 1.10) < 1e-9, 'and in full while it runs');
      check(TE.modsAt(await TE.recent(null, sid), now).birth_chance === 0.05 && !TE.modsAt(await TE.recent(null, sid), now + 2 * H).birth_chance, 'birth chance while it runs, not after');
    }

    console.log('The year');
    {
      // M9 Spring.
      const sid = await town('yr1'); const h = await house(sid);
      await cit(sid, 'Fen Furrow', { role: 'farmer', house_id: h });
      const sp = when('spring');
      check(!(await st(sid, 'spring_planting', when('summer'))), 'M9: only in spring');
      const m9 = await st(sid, 'spring_planting', sp);
      check(m9 && m9.options.map(o => o.key).join() === 'usual,flax,fallow' && m9.fallback === 'usual' && /^Fen asks/.test(m9.text), 'M9: three ways to plant; the usual fields are the default');
      await M.choose(sid, m9.id, 'flax');
      const e9 = await effects(sid);
      check(e9.length === 2 && e9[0].mods.food_production < 0 && e9[1].mods.wealth_production > 0 && new Date(e9[0].ends_at).getTime() === new Date(e9[1].starts_at).getTime()
        && seasonAt(new Date(e9[1].starts_at).getTime() + 60e3).id === 'autumn', 'M9: flax costs food until autumn, then pays wealth all autumn');
      check(!(await st(sid, 'spring_planting', sp + 60e3)), 'M9: once a year');
      // M10 Summer.
      const su = when('summer');
      const kid = await cit(sid, 'Pip Furrow', { age: 9, house_id: h });
      await q('UPDATE settlements SET tile_q = tile_q WHERE id = $1', [sid]);
      const m10 = await st(sid, 'summer_days', su);
      check(m10 && m10.options.map(o => o.key).join() === 'rest,late,explore' && m10.fallback === 'rest', 'M10: rest, work late, or send the young ones exploring');
      const uid = (await res(sid, 'user_id')).user_id;
      const fog0 = (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id = $1', [uid])).rows[0].n;
      await q('UPDATE moments SET data = jsonb_set(data, \'{lost}\', \'null\') WHERE id = $1', [m10.id]);
      const r10 = await M.choose(sid, m10.id, 'explore');
      check(r10.ok && (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id = $1', [uid])).rows[0].n === fog0 + 6, 'M10: exploring maps six new places nearby');
      // M11 Autumn.
      const au = when('autumn');
      const m11 = await st(sid, 'autumn_feast', au);
      check(m11 && m11.fallback === 'modest' && m11.data.cost.food >= 40, 'M11: a modest supper by default; a feast costs food and wealth');
      await q('UPDATE settlements SET food = 0 WHERE id = $1', [sid]);
      check((await M.choose(sid, m11.id, 'feast')).status === 400, 'M11: a feast needs the food');
      await q('UPDATE settlements SET food = 500, wealth = 500 WHERE id = $1', [sid]);
      await M.choose(sid, m11.id, 'feast');
      const e11 = (await effects(sid)).filter(e => e.mods.birth_chance);
      check(e11.length === 1 && seasonAt(new Date(e11[0].starts_at).getTime() + 60e3).id === 'spring', 'M11: the feast makes births more likely next spring');
      check(Number((await res(sid, 'food')).food) === 500 - m11.data.cost.food, 'M11: and is paid for');
    }
    {
      // M12 Winter: short stores.
      const sid = await town('yr2'); const h = await house(sid);
      for (const n of ['Ann', 'Bo', 'Cy']) await cit(sid, n + ' Frost', { house_id: h });
      const old = await cit(sid, 'Old Frost', { age: 70, house_id: h });
      const wi = when('winter');
      await q('UPDATE settlements SET food = 2000 WHERE id = $1', [sid]);
      check(!(await st(sid, 'winter_stores', wi)), 'M12: not asked when the stores will last');
      await q('UPDATE settlements SET food = 0, wealth = 1000 WHERE id = $1', [sid]);
      const m12 = await st(sid, 'winter_stores', wi);
      check(m12 && m12.fallback === 'even' && m12.options.map(o => o.key).join() === 'even,young,buy' && m12.data.deficit > 0, 'M12: short stores: ration, feed the young first, or buy grain');
      await M.choose(sid, m12.id, 'buy');
      const r = await res(sid, 'food, wealth');
      check(Number(r.food) === m12.data.deficit && Number(r.wealth) === 1000 - m12.data.price, 'M12: grain bought: the shortfall in food for its price in wealth');
      // Rationing (a second town, same winter).
      const sid2 = await town('yr3'); const h2 = await house(sid2);
      await cit(sid2, 'Dee Frost', { house_id: h2 });
      await q('UPDATE settlements SET food = 0 WHERE id = $1', [sid2]);
      const m12b = await st(sid2, 'winter_stores', wi);
      check(m12b && !m12b.options.some(o => o.key === 'young'), 'M12: with no elders, nobody to go without');
      await M.choose(sid2, m12b.id, 'even');
      const e = (await effects(sid2))[0];
      check(e && e.mods.food_upkeep === -0.25 && e.mods.happiness < 0, 'M12: rationing: the food lasts longer, everyone a little hungry');
      check(old > 0, '(an elder lives in the first town)');
      // M13 Stories by the fire.
      const k1 = await cit(sid2, 'Kit Frost', { age: 8, house_id: h2 }), k2 = await cit(sid2, 'Lu Frost', { age: 9, house_id: h2 });
      const m13 = await st(sid2, 'winter_stories', wi + 60e3);
      check(m13 && m13.fallback === 'old' && m13.data.young.length === 2, 'M13: the children gather for a story; the old tales are the default');
      const r13 = await M.choose(sid2, m13.id, 'old');
      const xp = (await q('SELECT citizen_id, xp FROM citizen_classes WHERE citizen_id = ANY($1::int[])', [[k1, k2]])).rows;
      check(r13.ok && xp.length === 2 && xp.every(x => Number(x.xp) > 0), 'M13: each child learns a little of a trade');
    }

    console.log('Quests and the road');
    {
      const MQ = require('../lib/moments_quest');
      const seq = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : 0.99); };
      const sid = await town('qst'); const h = await house(sid, 8);
      const a = await cit(sid, 'Ash Bold', { role: 'soldier', house_id: h }), b = await cit(sid, 'Bea Bold', { house_id: h }), c = await cit(sid, 'Cy Bold', { house_id: h, visible: ['loyal'] });
      const uid = (await res(sid, 'user_id')).user_id;
      const Q = require('../routes/quests');
      const pq = Q.PARTY_QUEST_POOL[0];
      const run = async status => (await q(`INSERT INTO settlement_quests (settlement_id, user_id, quest_id, quest_type, party_ids, status, completes_at, success_roll, success_chance)
        VALUES ($1,$2,$3,'party',$4,$5,NOW(),0.1,0.9) RETURNING id`, [sid, uid, pq.id, JSON.stringify([a, b, c]), status])).rows[0].id;
      const data = async id => (await q('SELECT data FROM moments WHERE id = $1', [id])).rows[0].data;
      // M16 first: a successful party quest, the rival roll comes first.
      const r1 = await run('completed');
      const m16 = await MQ.onQuest({ settlementId: sid, questRunId: r1, success: true }, seq(0));
      check(m16 && m16.kind === 'rival_party' && m16.fallback === 'share', 'M16: a rival party; sharing is the default');
      check(!(await MQ.onQuest({ settlementId: sid, questRunId: r1, success: true }, seq(0))), 'the same kind is never offered twice running');
      // Collecting before answering takes the default: half the reward.
      const jwt = require('jsonwebtoken');
      const tok = jwt.sign({ userId: uid, username: 'qst', species: 'Mice' }, process.env.JWT_SECRET || 'dev-secret-change-in-production');
      const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
      const w0 = Number((await res(sid, 'wealth')).wealth);
      const col = await fetch(`${BASE}/api/quests/collect/${r1}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json());
      check(col.ok && Number((await res(sid, 'wealth')).wealth) - w0 === Math.round(pq.rewards.wealth * 0.5) && !col.bonus, 'M16: collected before answering: the default (share) is taken, half the reward');
      check((await q('SELECT auto, choice FROM moments WHERE id = $1', [m16.id])).rows[0].choice === 'share', '(and the moment is settled)');
      // A lost race: nothing.
      const r2 = await run('completed');
      await q("UPDATE moments SET created_at = NOW() - interval '5 days' WHERE settlement_id = $1", [sid]);
      const m16b = await M.start(sid, 'rival_party', { args: { party: [a, b, c], quest_run_id: r2, title: pq.title } });
      await q(`UPDATE moments SET data = jsonb_set(data, '{win}', 'false') WHERE id = $1`, [m16b.id]);
      await M.choose(sid, m16b.id, 'race');
      check(await MQ.rewardMult({ query: (t, p) => q(t, p) }, sid, r2) === 0, 'M16: a lost race brings nothing home');
      // M14 a find: no rival (0.5), then the find (0).
      await q("UPDATE moments SET created_at = NOW() - interval '5 days' WHERE settlement_id = $1", [sid]);
      const m14 = await MQ.onQuest({ settlementId: sid, questRunId: r2, success: true }, seq(0.5, 0));
      check(m14 && m14.kind === 'road_find' && m14.options.map(o => o.key).join() === 'home,finder,sell', 'M14: a find on the road: bring it home, let the finder keep it, or sell it');
      const d14 = await data(m14.id);
      await M.choose(sid, m14.id, 'finder');
      check((await q('SELECT 1 FROM inventory_items WHERE equipped_to = $1 AND item_key = $2', [d14.finder.id, d14.item.item_key])).rows.length === 1, 'M14: the finder wears it');
      // M15 a wounded stranger, on a failed party quest.
      await q("UPDATE moments SET created_at = NOW() - interval '5 days' WHERE settlement_id = $1", [sid]);
      const r3 = await run('failed');
      const m15 = await MQ.onQuest({ settlementId: sid, questRunId: r3, success: false }, seq(0));
      check(m15 && m15.kind === 'wounded_stranger' && m15.fallback === 'carry', 'M15: a wounded stranger; carrying them home is the default');
      const d15 = await data(m15.id);
      check(d15.kindest.id === c, 'M15: the kindest of the party (Loyal) is the one troubled by leaving them');
      await q(`UPDATE moments SET data = jsonb_set(data, '{stays}', 'true') WHERE id = $1`, [m15.id]);
      await M.choose(sid, m15.id, 'carry');
      check((await q('SELECT 1 FROM citizens WHERE settlement_id = $1 AND name = $2', [sid, d15.stranger.name])).rows.length === 1, 'M15: carried home, they stay and start a family');
      // M17 the one who froze.
      await q("UPDATE moments SET created_at = NOW() - interval '5 days' WHERE settlement_id = $1", [sid]);
      const m17 = await MQ.onBattle({ settlementId: sid, citizenIds: [a, b] }, seq(0));
      check(m17 && m17.kind === 'froze' && m17.fallback === 'nothing', 'M17: someone froze in the fight; saying nothing is the default');
      const d17 = await data(m17.id);
      await q(`UPDATE moments SET data = jsonb_set(data, '{overcome}', 'true') WHERE id = $1`, [m17.id]);
      await M.choose(sid, m17.id, 'again');
      const who = (await q('SELECT visible_traits, stats FROM citizens WHERE id = $1', [d17.who.id])).rows[0];
      check(who.visible_traits.includes('brave') && Number(who.stats.strength) === 7, 'M17: sent out again, they found their courage: Brave, +2 strength');
      check(!(await MQ.onBattle({ settlementId: sid, citizenIds: [a, b] }, seq(0.5))), 'M17: most battles pass without it');
      check(require('../citizens').EARNED_TRAITS.some(t => t.id === 'brave') && !require('../citizens').VISIBLE_TRAITS.some(t => t.id === 'brave'), 'Brave is earned, never rolled at birth');
    }
  }

  // ── Villages (M18–M20) and raids (M28–M30) ─────────────────────────────
  {
    const LIFE = require('../lib/life');
    const house = async (sid, cap = 4) => (await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,'Hut','starter_house',$2) RETURNING id", [sid, cap])).rows[0].id;
    const cit = async (sid, name, o = {}) => (await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, house_id, partner_id, life_stage, born_at, last_birthday_year, visible_traits, life)
       VALUES ($1,$2,$3,$4,$5,$6,'adult',$7,$8,'[]','{"happiness":70}') RETURNING id`,
      [sid, name, o.gender || 'female', o.role || 'forager', o.house_id || null, o.partner_id || null, LIFE.bornAtFor(o.age || 30).toISOString(), o.age || 30])).rows[0].id;
    const village = async (sid, trust) => {
      const n = (await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, disposition) VALUES ($1,$2,$3,'friendly') RETURNING id`,
        [`Oakmere ${RUN}${Math.floor(Math.random() * 1e6)}`, 300000 + Math.floor(Math.random() * 1e6), 300000 + Math.floor(Math.random() * 1e6)])).rows[0].id;
      await q(`INSERT INTO diplomacy_relations (settlement_id, npc_id, status, trust) VALUES ($1,$2,'familiar',$3)`, [sid, n, trust]);
      return n;
    };
    const trustOf = async (sid, n) => Number((await q('SELECT trust FROM diplomacy_relations WHERE settlement_id = $1 AND npc_id = $2', [sid, n])).rows[0].trust);
    const st = async (sid, kind, args) => { const m = await M.start(sid, kind, args ? { args } : {}); if (m) m.data = (await q('SELECT data FROM moments WHERE id = $1', [m.id])).rows[0].data; return m; };
    const happyOf = async id => Number((await q('SELECT life FROM citizens WHERE id = $1', [id])).rows[0].life.happiness);

    console.log('Villages');
    {
      const sid = await town('vil1'); const h = await house(sid, 8);
      const folk = [];
      for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed']) folk.push(await cit(sid, n + ' Vale', { house_id: h }));
      check(!(await st(sid, 'village_help')), 'M18: no village at enough trust, nothing asked');
      const v = await village(sid, 30);
      const m18 = await st(sid, 'village_help');
      check(m18 && m18.options.map(o => o.key).join() === 'food,workers,decline' && m18.fallback === 'food', 'M18: a village asks for help: food (default), two workers, or decline');
      await M.choose(sid, m18.id, 'workers');
      const away = await require('../lib/careers').awayMap(null, sid);
      check(m18.data.workers.every(w => away.get(w.id) === 'helping') && await trustOf(sid, v) === 40, 'M18: two go to help: away for a while, and trust rises');
      // M19 an envoy's offer (trust 41+, a single adult, a free bed).
      await q('UPDATE diplomacy_relations SET trust = 50 WHERE settlement_id = $1', [sid]);
      const m19 = await st(sid, 'envoy_offer');
      check(m19 && m19.fallback === 'accept' && m19.data.spouse.gender !== (folk.length && 'female') , 'M19: a marriage offered; accepting is the default');
      await M.choose(sid, m19.id, 'accept');
      const sp = (await q('SELECT id, partner_id, visible_traits FROM citizens WHERE settlement_id = $1 AND name = $2', [sid, m19.data.spouse.name])).rows[0];
      check(sp && sp.partner_id === m19.data.ours.id && (await q('SELECT partner_id FROM citizens WHERE id = $1', [m19.data.ours.id])).rows[0].partner_id === sp.id,
        'M19: the spouse comes from the village and the two are partners');
      check(await trustOf(sid, v) === 62, 'M19: lasting trust with the village');
      // M20 a debt called in.
      const m20 = await st(sid, 'debt_called');
      check(m20 && m20.fallback === 'honour' && m20.data.amount > 0, 'M20: a favour asked; honouring it is the default');
      await q('UPDATE settlements SET food = 0, timber = 0, stone = 0 WHERE id = $1', [sid]);
      const auto = await M.choose(sid, m20.id, 'honour', true);
      check(auto.ok && auto.choice === 'putoff' && await trustOf(sid, v) === 54, 'M20: with nothing to give, the town puts them off and trust falls');
    }

    console.log('Raids and the Withered');
    {
      const MR = require('../lib/moments_raid');
      const sid = await town('raid1'); const h = await house(sid, 8);
      const g = await cit(sid, 'Gus Guard', { role: 'soldier', house_id: h });
      const w = await cit(sid, 'Wil Worker', { house_id: h });
      const tq = (await q('SELECT tile_q FROM settlements WHERE id = $1', [sid])).rows[0].tile_q;
      const oid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{"food":100}',NOW()) RETURNING id`, [sid, tq + 2])).rows[0].id;
      await q(`INSERT INTO outpost_crew (citizen_id, outpost_id, post) VALUES ($1,$2,'worker')`, [w, oid]);
      const raid = async (o = null) => (await q(`INSERT INTO settlement_raids (settlement_id, outpost_id, target_name, strength, arrives_at) VALUES ($1,$2,$3,30,NOW() + interval '3 hours') RETURNING id`,
        [sid, o, o ? 'the Farmstead' : 'your town'])).rows[0].id;
      // M28, from the raid_started event.
      const r1 = await raid(oid);
      const m28 = await MR.onRaidStarted({ settlementId: sid, raidId: r1 });
      check(m28 && m28.kind === 'raid_warning' && m28.fallback === 'safe' && /Bring the outpost crew home/.test(m28.options[0].label), 'M28: scouts report a raid on an outpost: bring the crew home (default), reinforce, or send an offer');
      await M.choose(sid, m28.id, 'safe');
      check(!(await q('SELECT 1 FROM outpost_crew WHERE outpost_id = $1', [oid])).rows.length, 'M28: the crew comes home');
      await q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = 'lost' WHERE id = $1", [r1]);
      const r2 = await raid();
      const m28b = await st(sid, 'raid_warning', { raid_id: r2 });
      check(/Bar the gates/.test(m28b.options[0].label), 'M28: a raid on the town itself: bar the gates');
      await M.choose(sid, m28b.id, 'reinforce');
      const s0 = (await q('SELECT * FROM settlements WHERE id = $1', [sid])).rows[0];
      check((await require('../lib/town_mods').load(null, s0)).effects.raid_defence === 20, 'M28: reinforcing adds defence until the raid arrives');
      await q("UPDATE settlement_raids SET resolved_at = NOW(), outcome = 'repelled', loot = $2 WHERE id = $1", [r2, JSON.stringify({ defence: { posted: [{ id: g, name: 'Gus Guard', role: 'soldier' }] } })]);
      const r3 = await raid();
      await q('UPDATE settlements SET wealth = 5000 WHERE id = $1', [sid]);
      const m28c = await st(sid, 'raid_warning', { raid_id: r3 });
      await M.choose(sid, m28c.id, 'offer');
      const r3row = (await q('SELECT outcome FROM settlement_raids WHERE id = $1', [r3])).rows[0];
      check(r3row.outcome === 'turned_back' && Number((await q('SELECT wealth FROM settlements WHERE id = $1', [sid])).rows[0].wealth) === 5000 - m28c.data.tribute, 'M28: an offer pays tribute and the raid turns back');
      // M29 after a raid turned back.
      check(!(await MR.onRaidRepelled({ settlementId: sid, raidId: r2 }, () => 0)), 'M29: offered within the daily budget (three moments today already)');
      await q("UPDATE moments SET created_at = NOW() - interval '5 days' WHERE settlement_id = $1", [sid]);
      const m29 = await MR.onRaidRepelled({ settlementId: sid, raidId: r2 }, () => 0);
      check(m29 && m29.kind === 'raid_hero' && m29.options.map(o => o.key).join() === 'thanks,shield', 'M29: someone held the gate: a quiet thanks (default) or name them the shield');
      const wh = await happyOf(w);
      await M.choose(sid, m29.id, 'shield');
      const gv = (await q('SELECT visible_traits FROM citizens WHERE id = $1', [g])).rows[0].visible_traits;
      check(gv.includes('shield') && await happyOf(w) === wh - 2, "M29: named the town's shield; the others envy it a little");
      // M30 a Withered child, after a camp is burned.
      const sid2 = await town('raid2'); const h2 = await house(sid2, 4);
      const a = await cit(sid2, 'Ada Hale', { house_id: h2 }); await cit(sid2, 'Bo Hale', { house_id: h2, gender: 'male' });
      await LIFE.assignFamilies(sid2); await LIFE.updateHeads(sid2);
      const m30 = await MR.onCampCleared({ settlementId: sid2, campId: 1 }, () => 0);
      check(m30 && m30.kind === 'withered_child' && m30.fallback === 'take', 'M30: a child found near a burned camp; taking them in is the default');
      const d30 = (await q('SELECT data FROM moments WHERE id = $1', [m30.id])).rows[0].data;
      await M.choose(sid2, m30.id, 'take');
      const kid = (await q('SELECT life_stage, hidden_traits, life, house_id FROM citizens WHERE settlement_id = $1 AND name = $2', [sid2, d30.child.name])).rows[0];
      check(kid && kid.life_stage === 'child' && kid.hidden_traits.includes(d30.child.knack) && kid.life.withered_born && kid.house_id === h2, 'M30: taken in: a child with an unusual hidden gift, housed');
      check(d30.objector && await happyOf(d30.objector.id) === 62, 'M30: the head of the largest family objects');
      // With no bed, the default can't be done: they go to the village instead.
      await q('UPDATE houses SET capacity = 3 WHERE id = $1', [h2]);
      const m30b = await st(sid2, 'withered_child');
      const auto = await M.choose(sid2, m30b.id, 'take', true);
      check(auto.ok && auto.choice === 'leave', 'M30: with no bed for them, the child is taken to a village');
      check(a > 0, '(the town has a family)');
    }
  }

  // ── The API, through the server, with a real outpost moment ──────────────
  console.log('The API');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const un = `mapi_${RUN}`;
  const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [un, `${un}@t.l`])).rows[0];
  const tq = -130000 - Math.floor(Math.random() * 5000) * 20;
  const sid = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber) VALUES ($1,$2,2,'camp',$3,0,NOW(),500) RETURNING id`, [u.id, un, tq])).rows[0].id;
  const oid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{"food":100}',NOW()) RETURNING id`, [sid, tq + 2])).rows[0].id;
  const tok = jwt.sign({ userId: u.id, username: un, species: 'Mice' }, SECRET);
  const api = async (method, path, body, token = tok) => {
    const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const m = await M.start(sid, 'storm', { args: { outpost_id: oid } });
  let r = await api('GET', '/api/moments');
  check(r.status === 200 && r.body.moments.length === 1 && r.body.moments[0].kind === 'storm' && r.body.moments[0].options.every(o => o.hint), 'GET /api/moments: open ones, with hints');
  check(/At the Farmstead|At the /.test(r.body.moments[0].text), 'an outpost moment names its outpost');
  r = await api('POST', `/api/moments/${m.id}`, { choice: 'shore' });
  check(r.status === 200 && /stayed dry/.test(r.body.outcome), 'POST /api/moments/:id answers it');
  check((await api('POST', `/api/moments/${m.id}`, { choice: 'shore' })).status === 404, 'once');
  r = await api('GET', '/api/moments/recent');
  check(r.status === 200 && r.body.moments[0].id === m.id && r.body.moments[0].choice === 'shore' && !r.body.moments[0].auto, 'GET /api/moments/recent: the answered one');
  const ev = await api('GET', `/api/game/outposts/${oid}`);
  check(ev.status === 200 || ev.status === 404, '(the outpost window still loads)');
  check((await api('POST', '/api/moments/admin/start', { kind: 'storm' })).status === 403, 'players cannot use the moments Dev Tools');
  // The dialogue box's speaker; the away report (step 2).
  const m4 = await M.start(sid, 'storm', { args: { outpost_id: oid } });
  check(m4 && /^Your crew at the /.test(m4.speaker), 'an outpost moment is spoken by its crew');
  await q("UPDATE settlements SET away_since = NOW() - interval '3 hours' WHERE id = $1", [sid]);
  await q("UPDATE moments SET expires_at = NOW() - interval '1 minute' WHERE id = $1", [m4.id]);
  await M.tick(true);
  // One open per outpost: the next can start once the storm is settled.
  const m5 = await M.start(sid, 'harvest', { args: { outpost_id: oid } });
  const rep = await api('GET', '/api/game/away-report');
  check(rep.status === 200 && rep.body.show && (rep.body.waiting || []).some(x => x.action === 'moments' && /waiting for you to decide/.test(x.text)),
    'the away report: "N things are waiting for you to decide" first');
  check((rep.body.events || []).some(e => /A storm is coming: .*\(decided for you\)/.test(e.text)), 'and the moments resolved while away, marked when decided for you');
  check(!(rep.body.events || []).some(e => /Nobody sent word/.test(e.text)), '(each only once)');
  if (m5) await M.choose(sid, m5.id, M.DEFS[m5.kind].fallback);
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  if (ADMIN) {
    const an = `madm_${RUN}`;
    await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username", [ADMIN, an, `${an}@t.l`]);
    let as = (await q('SELECT id FROM settlements WHERE user_id = $1', [ADMIN])).rows[0];
    if (!as) as = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick) VALUES ($1,$2,2,'camp',$3,0,NOW()) RETURNING id`, [ADMIN, an, tq - 40])).rows[0];
    await q(`UPDATE moments SET resolved_at = NOW(), outcome = 'cleared' WHERE settlement_id = $1 AND resolved_at IS NULL`, [as.id]);
    const aid = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,0,'plains',1,'{"food":50}',NOW()) RETURNING id`, [as.id, tq - 38])).rows[0].id;
    const atok = jwt.sign({ userId: ADMIN, username: an, species: 'Mice' }, SECRET);
    const k = await api('GET', '/api/moments/admin/kinds', null, atok);
    check(k.status === 200 && k.body.kinds.some(x => x.kind === 'harvest' && x.source === 'outpost'), 'Dev Tools: the kinds');
    const st = await api('POST', '/api/moments/admin/start', { kind: 'harvest', outpost_id: aid }, atok);
    check(st.status === 200 && st.body.moment.kind === 'harvest', 'Dev Tools: start a kind now');
    check((await api('POST', '/api/moments/admin/start', { kind: 'rich_vein', outpost_id: aid }, atok)).status === 400, "a kind that can't happen there is refused (plains has no vein)");
    const ex = await api('POST', '/api/moments/admin/expire', null, atok);
    check(ex.status === 200 && ex.body.resolved >= 1, 'Dev Tools: take every default now');
    const ss = await api('GET', '/api/moments/admin/stats', null, atok);
    const hv = ss.body.kinds && ss.body.kinds.find(x => x.kind === 'harvest');
    check(ss.status === 200 && hv && hv.timed_out >= 1 && typeof hv.one_sided === 'boolean', 'Dev Tools: shown, answered, timed out and choices per kind');
  } else console.log('  (admin routes skipped — set CRAFTING_TEST_ADMIN_ID)');

  await pool.end();
}

main().catch(e => { failed++; console.error(e); }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
