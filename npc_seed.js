// ══════════════════════════════════════════════
//  NPC SETTLEMENT SEEDER
// ══════════════════════════════════════════════
const { query } = require('./db');
const mapgen = require('./mapgen');

// The Great Kingdom tiles: center (0,0) + all 6 neighbours
const KINGDOM_CENTER = { q: 0, r: 0 };
const HEX_DIRS = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
function kingdomTiles() {
  const tiles = [KINGDOM_CENTER];
  HEX_DIRS.forEach(([dq,dr]) => {
    const q = ((KINGDOM_CENTER.q + dq) % mapgen.MAP_W + mapgen.MAP_W) % mapgen.MAP_W;
    const r = ((KINGDOM_CENTER.r + dr) % mapgen.MAP_H + mapgen.MAP_H) % mapgen.MAP_H;
    tiles.push({ q, r });
  });
  return tiles;
}

const NPC_SETTLEMENTS = [
  // ── The Great Kingdom ────────────────────────────────────────────────────
  {
    name: 'Ironhaven',
    tile_q: 0, tile_r: 0,
    faction: 'kingdom', species: 'all', tier: 'city',
    disposition: 'friendly',
    is_kingdom: true,
    description: 'The ancient seat of power from which all peoples came. Mighty walls, bustling markets, and the Grand Arena draw travellers from every corner of the realm.',
  },
  // ── Friendly NPC Villages — one per playable species ─────────────────────
  {
    name: 'Bramblehollow',
    tile_q: 8, tile_r: 12,
    faction: 'neutral', species: 'mice', tier: 'village',
    disposition: 'friendly',
    description: 'A quiet mice settlement tucked between the roots of ancient oaks. Known for fine cheese and sharper wits.',
  },
  {
    name: 'Stoneback Ridge',
    tile_q: 28, tile_r: 6,
    faction: 'neutral', species: 'badger', tier: 'town',
    disposition: 'neutral',
    description: 'A badger town carved into the hillside. Suspicious of outsiders but willing to trade — at fair prices.',
  },
  {
    name: 'Fernwatch',
    tile_q: 15, tile_r: 30,
    faction: 'neutral', species: 'squirrel', tier: 'village',
    disposition: 'friendly',
    description: 'Squirrel-built platforms wind through the canopy here. Renowned scouts and traders in rare woodland goods.',
  },
  {
    name: 'Saltmarsh Ford',
    tile_q: 32, tile_r: 22,
    faction: 'neutral', species: 'otter', tier: 'village',
    disposition: 'friendly',
    description: 'Otter fisher-folk who control the river crossings. Cheerful, well-armed, and not above a toll.',
  },
  {
    name: 'Emberclaw Keep',
    tile_q: 6, tile_r: 25,
    faction: 'neutral', species: 'weasel', tier: 'village',
    disposition: 'neutral',
    description: 'A weasel stronghold with sharp blades and sharper politics. Neither friendly nor hostile — yet.',
  },
  // ── Withered — hostile, non-playable ─────────────────────────────────────
  {
    name: "The Rot Warrens",
    tile_q: 20, tile_r: 18,
    faction: 'hostile', species: 'withered', tier: 'village',
    disposition: 'hostile',
    description: 'What were once mice are now hollow, dark-infused things. They attack on sight. No parley is possible.',
  },
  {
    name: "Blightscar Hollow",
    tile_q: 35, tile_r: 35,
    faction: 'hostile', species: 'withered', tier: 'village',
    disposition: 'hostile',
    description: 'A festering wound on the land. The Withered here are larger and more organised than elsewhere — a danger to all.',
  },
];

async function seedNpcSettlements() {
  // Check if already seeded
  const existing = await query('SELECT COUNT(*) FROM npc_settlements');
  if (parseInt(existing.rows[0].count) > 0) return 0;

  const kTiles = kingdomTiles();
  let count = 0;

  for (const npc of NPC_SETTLEMENTS) {
    const kingdomTilesJson = npc.is_kingdom
      ? JSON.stringify(kTiles.filter(t => !(t.q === npc.tile_q && t.r === npc.tile_r)))
      : JSON.stringify([]);

    await query(
      `INSERT INTO npc_settlements
         (name, tile_q, tile_r, faction, species, tier, disposition, description, is_kingdom, kingdom_tiles)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tile_q,tile_r) DO NOTHING`,
      [npc.name, npc.tile_q, npc.tile_r, npc.faction, npc.species,
       npc.tier, npc.disposition, npc.description, npc.is_kingdom || false, kingdomTilesJson]
    );
    count++;
  }
  return count;
}

module.exports = { seedNpcSettlements, kingdomTiles, KINGDOM_CENTER };
