// ══════════════════════════════════════════════════════════════════════════
//  CLAN PALETTE — banner swatches, emblems and the clan level table
//
//  Dual export: the same file is served as js/clan-palette.js in the
//  frontend (sets window.ClanPalette) and required here as a CommonJS
//  module. Keep the two copies byte-identical.
//
//  Banners store IDS from this registry ({ emblem, primary, secondary }),
//  never raw hex, and the server validates them against the unlock rules.
//  unlock: { level: n } today; { sku: '...' } is reserved for premium
//  swatches (Future — checked against a clan_unlocks table).
//
//  Spec 016 §5 (levels) and §9.1 (palette). Values are provisional.
// ══════════════════════════════════════════════════════════════════════════

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClanPalette = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CLAN_SWATCHES = [
    // Palette I — level 1
    { id: 'oak',      name: 'Oak',          hex: '#6b4a2b', unlock: { level: 1 } },
    { id: 'moss',     name: 'Moss',         hex: '#4f6b3a', unlock: { level: 1 } },
    { id: 'river',    name: 'River',        hex: '#3d6782', unlock: { level: 1 } },
    { id: 'berry',    name: 'Berry',        hex: '#8e2f3c', unlock: { level: 1 } },
    { id: 'heather',  name: 'Heather',      hex: '#6a4c7d', unlock: { level: 1 } },
    { id: 'wheat',    name: 'Wheat',        hex: '#c9a14a', unlock: { level: 1 } },
    { id: 'slate',    name: 'Slate',        hex: '#5b646c', unlock: { level: 1 } },
    { id: 'fox',      name: 'Fox',          hex: '#c0652b', unlock: { level: 1 } },
    // Palette II — level 2
    { id: 'fern',     name: 'Fern',         hex: '#7f9a4c', unlock: { level: 2 } },
    { id: 'dusk',     name: 'Dusk',         hex: '#3b3f6b', unlock: { level: 2 } },
    { id: 'rosehip',  name: 'Rosehip',      hex: '#b0454a', unlock: { level: 2 } },
    { id: 'birch',    name: 'Birch',        hex: '#d8cfb8', unlock: { level: 2 } },
    // Palette III — level 4
    { id: 'lichen',   name: 'Lichen',       hex: '#8fa89a', unlock: { level: 4 } },
    { id: 'ember',    name: 'Ember',        hex: '#a3361f', unlock: { level: 4 } },
    { id: 'bramble',  name: 'Bramble',      hex: '#4a2a3a', unlock: { level: 4 } },
    { id: 'tidepool', name: 'Tidepool',     hex: '#2f6f6a', unlock: { level: 4 } },
    // Palette IV — gilded, level 6
    { id: 'gilt',     name: 'Gilt',         hex: '#d4af50', unlock: { level: 6 } },
    { id: 'silver',   name: 'Moonsilver',   hex: '#b9c0c7', unlock: { level: 6 } },
    { id: 'copper',   name: 'Copper',       hex: '#b0703a', unlock: { level: 6 } },
    { id: 'ink',      name: 'Oak-gall Ink', hex: '#1f1b24', unlock: { level: 6 } },
  ];

  // Emoji placeholders until the emblem art lands (asset task).
  const CLAN_EMBLEMS = [
    // Set I — level 1
    { id: 'acorn',    name: 'Acorn',    glyph: '🌰', unlock: { level: 1 } },
    { id: 'leaf',     name: 'Leaf',     glyph: '🍃', unlock: { level: 1 } },
    { id: 'mushroom', name: 'Toadstool',glyph: '🍄', unlock: { level: 1 } },
    { id: 'wheat',    name: 'Sheaf',    glyph: '🌾', unlock: { level: 1 } },
    { id: 'shield',   name: 'Shield',   glyph: '🛡️', unlock: { level: 1 } },
    { id: 'lantern',  name: 'Lantern',  glyph: '🏮', unlock: { level: 1 } },
    // Set II — level 3
    { id: 'crown',    name: 'Crown',    glyph: '👑', unlock: { level: 3 } },
    { id: 'swords',   name: 'Swords',   glyph: '⚔️', unlock: { level: 3 } },
    { id: 'moon',     name: 'Moon',     glyph: '🌙', unlock: { level: 3 } },
    { id: 'feather',  name: 'Feather',  glyph: '🪶', unlock: { level: 3 } },
    // Set III — level 7
    { id: 'dragon',   name: 'Wyrm',     glyph: '🐉', unlock: { level: 7 } },
    { id: 'star',     name: 'Star',     glyph: '✨', unlock: { level: 7 } },
    { id: 'gem',      name: 'Gem',      glyph: '💎', unlock: { level: 7 } },
  ];

  // Level table (§5). Thresholds are on prestige_lifetime; caps are derived
  // from level here, never stored. claimRadius: claims must lie within this
  // many hexes of the clan's HQ tile — the smallest hex disk that holds the
  // tile cap with room to shape it (disk sizes 1/7/19/37/61/91), so no
  // territory can be stretched into a long line.
  const CLAN_LEVELS = [
    { level: 1,  lifetime: 0,     memberCap: 10, territoryCap: 1,  claimRadius: 0 },
    { level: 2,  lifetime: 500,   memberCap: 12, territoryCap: 4,  claimRadius: 1 },
    { level: 3,  lifetime: 1500,  memberCap: 15, territoryCap: 8,  claimRadius: 2 },
    { level: 4,  lifetime: 3500,  memberCap: 18, territoryCap: 13, claimRadius: 2 },
    { level: 5,  lifetime: 7000,  memberCap: 22, territoryCap: 19, claimRadius: 3 },
    { level: 6,  lifetime: 12000, memberCap: 26, territoryCap: 26, claimRadius: 3 },
    { level: 7,  lifetime: 20000, memberCap: 30, territoryCap: 34, claimRadius: 4 },
    { level: 8,  lifetime: 32000, memberCap: 34, territoryCap: 43, claimRadius: 4 },
    { level: 9,  lifetime: 50000, memberCap: 38, territoryCap: 53, claimRadius: 5 },
    { level: 10, lifetime: 75000, memberCap: 40, territoryCap: 64, claimRadius: 5 },
  ];
  const FORUM_UNLOCK_LEVEL = 2;
  const CHAT_UNLOCK_LEVEL  = 4;

  function levelRow(level) {
    return CLAN_LEVELS[Math.max(1, Math.min(CLAN_LEVELS.length, level | 0)) - 1];
  }
  function memberCap(level)    { return levelRow(level).memberCap; }
  function territoryCap(level) { return levelRow(level).territoryCap; }
  function claimRadius(level)  { return levelRow(level).claimRadius; }
  // First level whose claim radius reaches `dist`, or null if none does.
  function levelForRadius(dist) {
    const row = CLAN_LEVELS.find(r => r.claimRadius >= dist);
    return row ? row.level : null;
  }
  function levelForLifetime(lifetime) {
    let lv = 1;
    for (const row of CLAN_LEVELS) if (lifetime >= row.lifetime) lv = row.level;
    return lv;
  }
  function nextLevel(level) { return CLAN_LEVELS[level] || null; }

  function swatch(id) { return CLAN_SWATCHES.find(s => s.id === id) || null; }
  function emblem(id) { return CLAN_EMBLEMS.find(e => e.id === id) || null; }

  // Premium ({ sku }) entries stay locked until the clan_unlocks table exists.
  function isUnlocked(entry, level) {
    return !!entry && !!entry.unlock && typeof entry.unlock.level === 'number'
      && level >= entry.unlock.level;
  }

  // Validates a { emblem, primary, secondary } banner for a clan at `level`.
  // Returns { ok: true, banner } (only the known keys) or { ok: false, error }.
  function validateBanner(banner, level) {
    if (!banner || typeof banner !== 'object') return { ok: false, error: 'Choose a banner.' };
    const e = emblem(banner.emblem), p = swatch(banner.primary), s = swatch(banner.secondary);
    if (!e) return { ok: false, error: 'Unknown emblem.' };
    if (!p || !s) return { ok: false, error: 'Unknown banner colour.' };
    if (p.id === s.id) return { ok: false, error: 'Primary and secondary colours must differ.' };
    for (const x of [e, p, s]) {
      if (!isUnlocked(x, level)) {
        return { ok: false, error: `${x.name} unlocks at clan level ${x.unlock.level || '—'}.` };
      }
    }
    return { ok: true, banner: { emblem: e.id, primary: p.id, secondary: s.id } };
  }

  // Resolves stored ids to display values (hex/glyph) for API responses.
  function resolveBanner(banner) {
    const b = banner || {};
    const e = emblem(b.emblem), p = swatch(b.primary), s = swatch(b.secondary);
    return {
      emblem: e ? e.id : null, glyph: e ? e.glyph : '🏳️',
      primary: p ? p.id : null, primaryHex: p ? p.hex : '#5b646c',
      secondary: s ? s.id : null, secondaryHex: s ? s.hex : '#c9a14a',
    };
  }

  return {
    CLAN_SWATCHES, CLAN_EMBLEMS, CLAN_LEVELS, FORUM_UNLOCK_LEVEL, CHAT_UNLOCK_LEVEL,
    levelRow, memberCap, territoryCap, claimRadius, levelForRadius, levelForLifetime, nextLevel,
    swatch, emblem, isUnlocked, validateBanner, resolveBanner,
  };
});
