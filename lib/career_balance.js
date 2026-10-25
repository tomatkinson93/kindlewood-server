// ══════════════════════════════════════════════════════════════════════════
//  career_balance — the Dev Tools "📊 Careers" overview, server-wide.
//
//  overview() → {
//    classes:   [{ key, label, icon, citizens, levels: [count at Lv1..20],
//                  median_level, median_xp_per_hour, avg_hours, forks: { spec: n } }]
//    crafting:  { days: [{ day, basic, sturdy, fine, superior, legendary, smelted }] }  last 7 days
//    discoveries: { recipes, resources, by_source: { … } }                          last 7 days
//    research:  { towns_studying, finished_7d, by_project: { key: n } }
//    tuning:    lib/tuning all()
//  }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const C = require('./careers/classes');
const M = require('./career_math');

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

async function overview() {
  const rows = (await query(
    `SELECT cc.class_key, cc.level, cc.xp, cc.hours_worked, cc.spec
       FROM citizen_classes cc JOIN citizens c ON c.id = cc.citizen_id
      WHERE COALESCE(c.life_stage, 'adult') <> 'deceased'`)).rows;
  const classes = Object.entries(C.CLASSES).filter(([, d]) => d.assignedBy !== 'retired').map(([key, d]) => {
    const mine = rows.filter(r => r.class_key === key);
    const levels = Array.from({ length: M.MAX_LEVEL }, () => 0);
    for (const r of mine) levels[Math.max(1, Math.min(M.MAX_LEVEL, Number(r.level))) - 1]++;
    const rates = mine.filter(r => Number(r.hours_worked) >= 1).map(r => Number(r.xp) / Number(r.hours_worked));
    const forks = {};
    for (const r of mine) if (r.spec) forks[r.spec] = (forks[r.spec] || 0) + 1;
    return {
      key, label: d.label, icon: d.icon, citizens: mine.length, levels,
      median_level: median(mine.map(r => Number(r.level))),
      median_xp_per_hour: r1(median(rates)),
      avg_hours: mine.length ? r1(mine.reduce((a, r) => a + Number(r.hours_worked), 0) / mine.length) : null,
      forks,
    };
  });

  const craft = (await query(
    `SELECT to_char(finished_at, 'YYYY-MM-DD') AS day, quality,
            (recipe_snapshot->>'station') = 'smelter' AS smelted, COUNT(*)::int AS n
       FROM craft_jobs WHERE status = 'done' AND finished_at > NOW() - interval '7 days'
      GROUP BY 1, 2, 3 ORDER BY 1`)).rows;
  const days = {};
  for (const r of craft) {
    const d = days[r.day] = days[r.day] || { day: r.day, basic: 0, sturdy: 0, fine: 0, superior: 0, legendary: 0, smelted: 0 };
    if (r.smelted) d.smelted += r.n; else d[r.quality] = (d[r.quality] || 0) + r.n;
  }

  const rec = (await query(
    `SELECT source, COUNT(*)::int AS n FROM settlement_recipes WHERE learned_at > NOW() - interval '7 days' GROUP BY source`)).rows;
  const res = (await query(
    `SELECT source, COUNT(*)::int AS n FROM settlement_discoveries WHERE discovered_at > NOW() - interval '7 days' GROUP BY source`).catch(() => ({ rows: [] }))).rows;
  const by = {};
  for (const r of rec) by['recipe:' + r.source] = r.n;
  for (const r of res) by['resource:' + r.source] = r.n;

  const studying = Number((await query('SELECT COUNT(*)::int AS n FROM settlements WHERE research_active IS NOT NULL').catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  const fin = (await query(
    `SELECT project, COUNT(*)::int AS n FROM settlement_research WHERE done_at > NOW() - interval '7 days' GROUP BY project`).catch(() => ({ rows: [] }))).rows;

  return {
    classes,
    crafting: { days: Object.values(days) },
    discoveries: {
      recipes: rec.reduce((a, r) => a + (r.source === 'discovery' ? r.n : 0), 0),
      resources: res.reduce((a, r) => a + r.n, 0),
      by_source: by,
    },
    research: { towns_studying: studying, finished_7d: fin.reduce((a, r) => a + r.n, 0), by_project: Object.fromEntries(fin.map(r => [r.project, r.n])) },
    tuning: await require('./tuning').all(),
  };
}

module.exports = { overview };
