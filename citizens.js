// ── Citizen generation system ──

const MALE_NAMES = [
  "Alder","Bram","Cedric","Dain","Edric","Fenn","Garrick","Hale","Ivor","Jory",
  "Kellan","Loric","Merric","Nyle","Orin","Perrin","Quill","Roder","Soren","Thane",
  "Ulric","Varyn","Wick","Xander","Yorick","Zane","Arlo","Bennet","Corin","Dorian",
  "Elden","Flint","Gavin","Harkin","Isen","Jasper","Keir","Linden","Milo","Noren",
  "Orris","Pike","Quorin","Riven","Sylas","Torin","Ulden","Varro","Wren","Zorin",
  "Basil","Crispin","Darrow","Ember","Falk","Greeley","Hob","Igan","Jonty","Kip",
  "Ludo","Moss","Nib","Ollin","Pip","Rook","Samwell","Tobin","Umber","Vick",
  "Willet","Yarrow","Zeb","Ash","Birch","Clay","Dew","Elm","Frost","Glen",
  "Heath","Iron","Jun","Knox","Leaf","Marl","North","Oak","Pine","Reed"
];

const FEMALE_NAMES = [
  "Ayla","Briony","Celia","Daphne","Elara","Faye","Gwen","Hazel","Iris","Juna",
  "Kiera","Liora","Mira","Nessa","Orla","Poppy","Quilla","Rhea","Sylvie","Tara",
  "Una","Vera","Willow","Xena","Yara","Zinnia","Arden","Blythe","Clover","Delia",
  "Eira","Flora","Greta","Holly","Isla","Juniper","Kaia","Luna","Mabel","Nola",
  "Opal","Petra","Quinn","Rosie","Sable","Tilly","Ursa","Violet","Wren","Zara",
  "Bramble","Cinder","Daisy","Ember","Fern","Glimmer","Honey","Ivory","Jewel","Kestrel",
  "Lark","Meadow","Nettle","Olive","Pearl","Rue","Snow","Thistle","Umber","Velvet",
  "Willow","Yarrow","Zephyr","Amber","Blossom","Dewdrop","Eden","Frostine","Gossamer","Hearth"
];

const LAST_NAMES = [
  "Bramblefoot","Oakenshade","Thistlewhisk","Mossburrow","Fernbrook","Dewglen","Stonepaw","Riverroot",
  "Ashenfur","Willowtail","Briarcloak","Cinderwhisk","Greenholt","Meadowrun","Stormfur","Duskwarren",
  "Silverpaw","Brightburrow","Emberfall","Hollowroot","Ironclaw","Mistgrove","Nightfur","Sunburrow",
  "Amberleaf","Barkhide","Cloudrunner","Dawnwhisk","Elderroot","Frostfur","Goldleaf","Hearthwhisk",
  "Ivorytail","Juniperpaw","Keeneye","Leafrunner","Moonburrow","Northfur","Oakstride","Pinecloak",
  "Quickwhisk","Rainfur","Softpaw","Thornhide","Umberfall","Valefoot","Windrunner","Yewbranch",
  "Boulderback","Creekwhisk","Driftfur","Echofoot","Flintpaw","Grovekeeper","Hillrunner","Ironroot",
  "Jaggedclaw","Knollburrow","Lakestride","Marshpaw","Noblefur","Oakenpaw","Pebblefoot","Quarryclaw",
  "Ridgewhisk","Stonehide","Timberfur","Underroot","Valeclaw","Wheatfur","Yarrowpaw","Zephyrclaw"
];

const VISIBLE_TRAITS = [
  { id: 'strong',       label: 'Strong',       desc: 'Born with exceptional physical power.',        effect: { strength: 3 } },
  { id: 'quick',        label: 'Quick',        desc: 'Moves faster than most of their kin.',         effect: { agility: 3 } },
  { id: 'hardy',        label: 'Hardy',        desc: 'Built to endure hardship without complaint.',  effect: { endurance: 3 } },
  { id: 'genius',       label: 'Genius',       desc: 'An unusually sharp and curious mind.',         effect: { intelligence: 3 } },
  { id: 'charming',     label: 'Charming',     desc: 'Others naturally warm to their presence.',     effect: { charisma: 3 } },
  { id: 'frail',        label: 'Frail',        desc: 'Struggles with physical demands.',             effect: { endurance: -2 } },
  { id: 'clumsy',       label: 'Clumsy',       desc: 'Their hands and feet rarely agree.',           effect: { agility: -2 } },
  { id: 'slow_learner', label: 'Slow Learner', desc: 'Skills take longer to develop.',              effect: { intelligence: -2 } },
  { id: 'night_worker', label: 'Night Worker', desc: 'Thrives after dark, sluggish at dawn.',        effect: {} },
  { id: 'greedy',       label: 'Greedy',       desc: 'Eats more than their share, but works hard.', effect: {} },
  { id: 'loyal',        label: 'Loyal',        desc: 'Their presence lifts the whole settlement.',  effect: { charisma: 1 } },
  { id: 'wanderer',     label: 'Wanderer',     desc: 'Restless. Best suited to the open road.',     effect: { agility: 1 } },
];

const HIDDEN_TRAITS = [
  { id: 'latent_strength',  label: 'Latent Strength',  desc: 'A strength not yet revealed.' },
  { id: 'natural_leader',   label: 'Natural Leader',   desc: 'Others follow without knowing why.' },
  { id: 'fertile',          label: 'Fertile',          desc: 'Exceptionally likely to have children.' },
  { id: 'sickly',           label: 'Sickly',           desc: 'Prone to illness and weakness.' },
  { id: 'long_lived',       label: 'Long-lived',       desc: 'Time treats them gently.' },
];

const SKILLS = ['farming','woodcutting','fishing','mining','crafting','scouting','combat'];
const ROLES = ['farmer','woodcutter','fisher','miner','crafter','scout','soldier','idle'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollStat(base = 5, variance = 4) {
  // Roll between (base - variance) and (base + variance), clamped 1-20
  return Math.max(1, Math.min(20, base + rand(-variance, variance)));
}

function generateCitizen(generation = 1) {
  const isFemale = Math.random() < 0.5;
  const firstName = pickRandom(isFemale ? FEMALE_NAMES : MALE_NAMES);
  const lastName = pickRandom(LAST_NAMES);
  const name = `${firstName} ${lastName}`;

  // Core stats (1-20 range)
  const stats = {
    strength:     rollStat(8, 5),
    agility:      rollStat(8, 5),
    endurance:    rollStat(8, 5),
    intelligence: rollStat(8, 5),
    charisma:     rollStat(8, 5),
  };

  // Skills (1-10 range, low at start)
  const skills = {};
  for (const skill of SKILLS) {
    skills[skill] = rand(1, 5);
  }

  // Life stats
  const age = rand(16, 35);
  const life = {
    age,
    health:    rand(70, 100),
    happiness: rand(60, 90),
    hunger:    rand(20, 50),
    energy:    rand(60, 100),
  };

  // Reproduction
  const repro = {
    fertility:        rand(30, 80),
    genetic_quality:  rand(40, 80),
    compatibility:    rand(30, 70),
  };

  // Visible traits (0-2 per citizen, weighted toward 0-1)
  const numVisible = Math.random() < 0.15 ? 2 : Math.random() < 0.45 ? 1 : 0;
  const visibleTraits = [];
  const shuffled = [...VISIBLE_TRAITS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < numVisible; i++) {
    visibleTraits.push(shuffled[i].id);
    // Apply trait effects to stats
    const effect = shuffled[i].effect || {};
    for (const [stat, val] of Object.entries(effect)) {
      if (stats[stat] !== undefined) {
        stats[stat] = Math.max(1, Math.min(20, stats[stat] + val));
      }
    }
  }

  // Hidden traits (rare, 0-1 per citizen, ~20% chance)
  const hiddenTraits = [];
  if (Math.random() < 0.2) {
    hiddenTraits.push(pickRandom(HIDDEN_TRAITS).id);
  }

  // Starting role based on highest skill
  const topSkill = Object.entries(skills).sort((a,b) => b[1]-a[1])[0][0];
  const roleMap = {
    farming: 'farmer', woodcutting: 'woodcutter', fishing: 'fisher',
    mining: 'miner', crafting: 'crafter', scouting: 'scout', combat: 'soldier',
  };
  const role = roleMap[topSkill] || 'idle';

  return {
    name,
    gender: isFemale ? 'female' : 'male',
    generation,
    role,
    stats,
    skills,
    life,
    repro,
    visible_traits: visibleTraits,
    hidden_traits: hiddenTraits,
  };
}

function generateStartingCitizens(count = 10) {
  return Array.from({ length: count }, () => generateCitizen(1));
}

module.exports = { generateStartingCitizens, generateCitizen, VISIBLE_TRAITS, HIDDEN_TRAITS, SKILLS };
