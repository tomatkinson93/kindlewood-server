'use strict';
// ══════════════════════════════════════════════════════════════════════════
//  House styles (docs/HOME_SCENE.md C.4, docs/ART_GUIDE.md §3).
//
//  A style is looks only. Every house holds the same beds whatever it looks
//  like, and that must stay so for ever: when paid or festival styles arrive
//  they are never worth beds or happiness.
//
//  `source` says where a style comes from: 'base' (everyone has it) now;
//  later 'festival', 'shop', …. owns() is the one place that decides whether
//  a town may use a style, so a later shop needs no redesign.
// ══════════════════════════════════════════════════════════════════════════
const STYLES = {
  thatch: { key: 'thatch', label: 'Thatched cottage', source: 'base' },
  timber: { key: 'timber', label: 'Timber-frame house', source: 'base' },
  stone:  { key: 'stone',  label: 'Stone cottage', source: 'base' },
  burrow: { key: 'burrow', label: 'Turf-roof burrow', source: 'base' },
};
const DEFAULT = 'thatch';
// Houses from before styles are given these in turn, so an old town isn't a
// row of identical cottages. (The burrow has no daytime drawing yet.)
const MIXED = ['thatch', 'timber', 'stone'];

const isStyle = key => Object.prototype.hasOwnProperty.call(STYLES, key);
// Whether a town may use a style. `owned`: extra keys it has earned or
// bought (none exist yet).
function owns(key, owned = []) {
  const s = STYLES[key];
  return !!s && (s.source === 'base' || owned.includes(key));
}
const catalogue = (owned = []) => Object.values(STYLES).map(s => ({ ...s, owned: owns(s.key, owned) }));

module.exports = { STYLES, DEFAULT, MIXED, isStyle, owns, catalogue };
