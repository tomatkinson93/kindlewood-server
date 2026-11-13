// ══════════════════════════════════════════════════════════════════════════
//  Outpost moments (docs/PHASE_2_MOMENTS.md §3, M21–M27): the seven outpost
//  events from R6c, now ordinary moment kinds (source 'outpost'). Outposts no
//  longer roll their own; the town's daily budget picks them like any other.
//  The definitions (text, options, choose) stay in lib/outpost_events.js.
//
//  M24 (the lost traveller) merged into M7 (a settler at the gate) now that
//  Phase 1's settlers exist: it is no longer rolled, but open ones resolve.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const M = require('./moments');
const OE = require('./outpost_events');

const WEIGHT = { rich_vein: 2, trader: 2, wolves: 2, cache: 1, storm: 2, harvest: 2, traveller: 0 };

for (const [kind, k] of Object.entries(OE.KINDS)) {
  M.register(kind, {
    source: 'outpost', icon: k.icon, title: k.title,
    weight: WEIGHT[kind] ?? 1, cooldownDays: 2, expireHours: OE.EXPIRE_H,
    gentle: kind === 'harvest' || kind === 'cache',
    // An outpost of the town with fitting land and no moment already open there.
    async eligible(ctx) {
      const os = (await ctx.q(
        `SELECT o.* FROM outposts o WHERE o.settlement_id = $1
            AND NOT EXISTS (SELECT 1 FROM moments m WHERE m.settlement_id = o.settlement_id AND m.resolved_at IS NULL AND (m.subject->>'outpost_id')::int = o.id)
            ${ctx.outpost_id ? 'AND o.id = $2' : ''}`,
        ctx.outpost_id ? [ctx.sid, ctx.outpost_id] : [ctx.sid]).catch(() => ({ rows: [] }))).rows
        .filter(o => !k.terrains || k.terrains.includes(o.terrain));
      if (!os.length) return null;
      const o = os[Math.floor(ctx.rng() * os.length)];
      const data = k.make(o, ctx.rng);
      if (!data) return null;
      const name = (require('../outposts_config').OUTPOST_CONFIG[o.terrain] || {}).name || 'outpost';
      return { subject: { outpost_id: o.id }, data: { ...data, outpost_name: name } };
    },
    text: d => `At the ${d.outpost_name || 'outpost'}: ${k.text(d)}`,
    options: d => k.options(d),
    fallback: k.fallback,
    async choose(key, x) {
      const o = x.subject.outpost_id ? (await x.q('SELECT * FROM outposts WHERE id = $1 AND settlement_id = $2', [x.subject.outpost_id, x.sid])).rows[0] : null;
      if (!o) return { outcome: 'The outpost is gone; nothing came of it.' };
      const res = await k.choose(key, { q: x.q, sid: x.sid, o, d: x.d });
      if (res.error) return res;
      return { ...res, chronicle: `${k.title} at the ${x.d.outpost_name || 'outpost'}: ${res.outcome}` };
    },
  });
}
