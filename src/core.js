
/* ============================================================================
   GUARDIAN OF THE HEARTH — CORE (Phase 2)
   Layers shipped in this phase:
     01_CONFIG        game/economy configuration (data only, frozen)
     02_DOMAIN        pure functions: ids, rng, leveling, loot, streaks,
                      rewards, time, canonical hashing
     02b_VALIDATION   entity validators + status-transition rules
     03_DB            schema definition, migrations, IndexedDB backend,
                      backend-agnostic DB wrapper
     04_REPOSITORIES  repository layer (the ONLY code that touches the DB)
     05_SERVICES      SeedService, BackupService (more services in Phase 3+)
     09_TESTSUITE     shared verification suite (runs in node AND on-device)

   Dependency rule: lower layers never import from higher layers.
   No UI code lives in this module. No direct DB access outside repositories.
   ========================================================================== */
(function (root) {
  'use strict';

  const GOTH = {};

  /* ==========================================================================
     01_CONFIG — every balance number lives here. Logic never hardcodes values.
     ========================================================================== */
  const CONFIG = {
    DB: { name: 'guardian_hearth', version: 1, testName: 'guardian_hearth_test' },

    LIMITS: {
      LEVEL_CAP: 200,
      MAX_GOLD: 1000000000,
      MAX_BUNDLE_FIELD: 100000,   // per-field ceiling on any reward bundle value
      MAX_QTY: 1000000,
      NAME_MIN: 1,
      NAME_MAX: 24,
      NOTE_MAX: 300,
    },

    SECURITY: {
      ALGO: 'PBKDF2-SHA256',
      PBKDF2_ITERATIONS: 310000,
      SALT_BYTES: 16,
      PARENT_SESSION_MS: 5 * 60 * 1000,
      MAX_PIN_ATTEMPTS: 3,
      LOCKOUT_BASE_MS: 60 * 1000,
      AUDIT_GENESIS: 'GENESIS',
    },

    // XP required to go from level L to L+1 = base + per * (L - offset),
    // for the first band whose upTo >= L. Bands per Phase 1 spec §5.
    XP_BANDS: [
      { upTo: 10, base: 60, per: 20, offset: 0 },
      { upTo: 25, base: 260, per: 35, offset: 10 },
      { upTo: 50, base: 800, per: 60, offset: 25 },
      { upTo: Infinity, base: 2300, per: 100, offset: 50 },
    ],

    ECONOMY: {
      BASE_MAX_ENERGY: 100,
      SANCTUARY_ENERGY_PER_LEVEL: 10,
      AFFECTION_MAX: 100,
      BUILDING_COST_GROWTH: 1.6,
      CRAFT_ENERGY_COST: 10,
      DUNGEON_ENERGY: { SHORT: 15, MEDIUM: 30, LONG: 50 },
      // First-time welcome gift so a new young keeper can play & feel rewarded right away.
      // Uses only real resources: full energy, starter coins, loot crates, a few materials.
      STARTER_GRANT: {
        energyToFull: true,
        gold: 200,
        affection: 15,
        lootCrates: 3,
        materials: [
          { itemId: 'itm_wood', qty: 5 },
          { itemId: 'itm_stone', qty: 5 },
          { itemId: 'itm_crystal', qty: 1 },
        ],
      },
    },

    RARITY_WEIGHTS: { COMMON: 50, UNCOMMON: 27, RARE: 13, EPIC: 6, LEGENDARY: 3, MYTHIC: 1 },

    STREAK: { DECAY_PER_MISSED_DAY: 0.8 },
    DAYNIGHT: {
      // Phase boundaries in local hours [start, end). Derived from the device clock.
      PHASES: [
        { id: 'dawn',    from: 5,  to: 8,  name: 'Dawn' },
        { id: 'day',     from: 8,  to: 17, name: 'Day' },
        { id: 'dusk',    from: 17, to: 20, name: 'Dusk' },
        { id: 'night',   from: 20, to: 24, name: 'Night' },
        { id: 'night',   from: 0,  to: 5,  name: 'Night' },
      ],
      // Sky gradient (top -> bottom) per phase, drawn as an overlay above the island art.
      SKY: {
        dawn:  ['rgba(255,180,120,0.42)', 'rgba(255,150,170,0.20)', 'rgba(90,70,110,0.10)'],
        day:   ['rgba(150,200,255,0.14)', 'rgba(255,255,255,0.0)',  'rgba(255,240,200,0.06)'],
        dusk:  ['rgba(255,140,70,0.40)',  'rgba(180,90,140,0.30)',  'rgba(40,40,90,0.30)'],
        night: ['rgba(10,16,48,0.66)',    'rgba(20,24,60,0.55)',    'rgba(8,10,30,0.62)'],
      },
      // How much the whole island is dimmed/cooled per phase (brightness, saturate).
      LIGHT: {
        dawn:  { bright: 0.96, sat: 1.04 },
        day:   { bright: 1.06, sat: 1.08 },
        dusk:  { bright: 0.92, sat: 1.10 },
        night: { bright: 0.66, sat: 0.86 },
      },
      // The Hearth is the soul of the world: it glows strongest in the dark.
      HEARTH_GLOW: { dawn: 0.5, day: 0.28, dusk: 0.7, night: 1.0 },
      // Celestial body: sun by day, moon by night, arcing across the sky.
      SHOW_STARS: { dawn: 0.2, day: 0, dusk: 0.35, night: 1 },
      WINDOWS_LIT: { dawn: 0.3, day: 0, dusk: 0.6, night: 1 },
      CROSSFADE_MS: 1500,
    },
    FLAME: {
      FAMILY_ID: 'FAMILY',
      KEY: 'family.flame',
      SOURCES: { KINDNESS: 6, GRATITUDE: 8, FAMILY_QUEST: 12, ACHIEVEMENT: 15, EVOLUTION: 25 },
      GRATITUDE_QUEST_ID: 'qst_gratitude',
      EVOLUTION_LEVELS: [10, 25],
      STAGES: [
        { at: 0, name: 'The Sleeping Spark' },
        { at: 60, name: 'The Gentle Hearth' },
        { at: 240, name: 'The Singing Forest' },
        { at: 700, name: 'The Ancient Memory' },
        { at: 1800, name: 'The Eternal Flame' },
      ],
      MEMORIES: [
        { at: 700, text: 'Even the smallest light can guide another through darkness.' },
        { at: 1000, text: 'A kind heart creates the strongest magic.' },
        { at: 1400, text: 'You were never restoring my flame, little Keeper. You were becoming it.' },
        { at: 1800, text: 'I am Shia, the First Flame. I have been with your family all along.' },
      ],
      CELEBRATION: { AUTO_DISMISS_MS: 0 },
      VISUALS: {
        FIREFLIES: [4, 7, 10, 13, 13],
        WARMTH: [1.0, 1.04, 1.08, 1.12, 1.16],
        BRIGHT: [1.0, 1.02, 1.05, 1.08, 1.1],
        SHRINE_PX: [12, 18, 26, 34, 44],
        SHRINE_GLOW: [10, 16, 24, 34, 48],
      },
    },

    SPECIES: {
      DRAGON: { emoji: '🐉', flavor: 'Bold keeper of ember and sky.' },
      WOLF: { emoji: '🐺', flavor: 'Loyal sentinel of the night watch.' },
      FOX: { emoji: '🦊', flavor: 'Clever scout of hidden paths.' },
      OWL: { emoji: '🦉', flavor: 'Wise reader of moonlit pages.' },
      TURTLE: { emoji: '🐢', flavor: 'Patient warden of the shore.' },
      BEAR: { emoji: '🐻', flavor: 'Gentle giant of the deep wood.' },
      PHOENIX: { emoji: '🪶', flavor: 'Radiant flame that always returns.' },
    },

    // Default reward bundles per quest category (parents tune these later).
    REWARD_DEFAULTS: {
      HYDRATION: { coins: 5, energy: 5, xp: 10, affection: 0, materials: [], lootCrates: 0 },
      HEALTH: { coins: 10, energy: 8, xp: 15, affection: 0, materials: [], lootCrates: 0 },
      LEARNING: { coins: 15, energy: 10, xp: 25, affection: 0, materials: [], lootCrates: 0 },
      RESPONSIBILITY: { coins: 15, energy: 10, xp: 20, affection: 0, materials: [], lootCrates: 0 },
      KINDNESS: { coins: 20, energy: 8, xp: 25, affection: 5, materials: [], lootCrates: 0 },
      FITNESS: { coins: 15, energy: 10, xp: 20, affection: 0, materials: [], lootCrates: 0 },
    },

    MAX_PER_DAY_DEFAULTS: { HYDRATION: 4, HEALTH: 2, LEARNING: 3, RESPONSIBILITY: 3, KINDNESS: 3, FITNESS: 2 },

    ITEMS: [
      // Materials
      { id: 'itm_wood', name: 'Hearthwood', rarity: 'COMMON', type: 'MATERIAL', description: 'Sturdy timber for building.' },
      { id: 'itm_stone', name: 'River Stone', rarity: 'COMMON', type: 'MATERIAL', description: 'Smooth stone from the shallows.' },
      { id: 'itm_fiber', name: 'Wild Fiber', rarity: 'COMMON', type: 'MATERIAL', description: 'Tough strands for rope and cloth.' },
      { id: 'itm_clay', name: 'Soft Clay', rarity: 'UNCOMMON', type: 'MATERIAL', description: 'Shapes into bricks and pots.' },
      { id: 'itm_iron', name: 'Iron Chunk', rarity: 'UNCOMMON', type: 'MATERIAL', description: 'Raw metal for the forge.' },
      { id: 'itm_herbs', name: 'Healing Herbs', rarity: 'UNCOMMON', type: 'MATERIAL', description: 'Fragrant leaves with gentle power.' },
      { id: 'itm_crystal', name: 'Glow Crystal', rarity: 'RARE', type: 'MATERIAL', description: 'Hums softly with stored light.' },
      { id: 'itm_moonpetal', name: 'Moonpetal', rarity: 'RARE', type: 'MATERIAL', description: 'Blooms only under a full moon.' },
      { id: 'itm_starsteel', name: 'Starsteel Ingot', rarity: 'EPIC', type: 'MATERIAL', description: 'Forged from a fallen star.' },
      { id: 'itm_phoenix_feather', name: 'Phoenix Feather', rarity: 'LEGENDARY', type: 'MATERIAL', description: 'Warm to the touch, never burns out.' },
      { id: 'itm_aether_shard', name: 'Aether Shard', rarity: 'MYTHIC', type: 'MATERIAL', description: 'A splinter of the world between worlds.' },
      { id: 'itm_loot_crate', name: 'Mystery Loot Crate', rarity: 'UNCOMMON', type: 'MATERIAL', description: 'Sealed tight. Opens in the Workshop.' },
      // Food
      { id: 'itm_berry', name: 'Sunberry', rarity: 'COMMON', type: 'FOOD', description: 'Sweet and a little fizzy.' },
      { id: 'itm_apple', name: 'Orchard Apple', rarity: 'COMMON', type: 'FOOD', description: 'Crisp guardian favorite.' },
      { id: 'itm_honey', name: 'Wild Honey', rarity: 'UNCOMMON', type: 'FOOD', description: 'Golden energy in a jar.' },
      { id: 'itm_royal_stew', name: 'Royal Stew', rarity: 'RARE', type: 'FOOD', description: 'A feast fit for a guardian.' },
      // Equipment
      { id: 'itm_wood_sword', name: 'Training Sword', rarity: 'COMMON', type: 'EQUIPMENT', description: 'Every hero starts somewhere.' },
      { id: 'itm_leather_cap', name: 'Leather Cap', rarity: 'COMMON', type: 'EQUIPMENT', description: 'Simple, dependable headgear.' },
      { id: 'itm_iron_shield', name: 'Iron Shield', rarity: 'UNCOMMON', type: 'EQUIPMENT', description: 'Holds the line at the Hearth.' },
      { id: 'itm_scout_boots', name: 'Scout Boots', rarity: 'UNCOMMON', type: 'EQUIPMENT', description: 'Quiet steps on any path.' },
      { id: 'itm_runed_blade', name: 'Runed Blade', rarity: 'RARE', type: 'EQUIPMENT', description: 'Old letters glow along the edge.' },
      { id: 'itm_guardian_plate', name: 'Guardian Plate', rarity: 'EPIC', type: 'EQUIPMENT', description: 'Armor of the sworn protectors.' },
      { id: 'itm_dawn_crown', name: 'Crown of Dawn', rarity: 'LEGENDARY', type: 'EQUIPMENT', description: 'Morning light, made to wear.' },
      // Cosmetics
      { id: 'itm_red_scarf', name: 'Red Scarf', rarity: 'COMMON', type: 'COSMETIC', description: 'Adventure-ready neckwear.' },
      { id: 'itm_party_hat', name: 'Party Hat', rarity: 'UNCOMMON', type: 'COSMETIC', description: 'For level-up celebrations.' },
      { id: 'itm_star_cape', name: 'Star Cape', rarity: 'RARE', type: 'COSMETIC', description: 'A night sky that follows you.' },
      { id: 'itm_mythic_aura', name: 'Mythic Aura', rarity: 'MYTHIC', type: 'COSMETIC', description: 'You shimmer. Everyone notices.' },
    ],

    // Default quest catalog. reward overrides start from REWARD_DEFAULTS.
    QUESTS: [
      { id: 'qst_water_glass', title: 'Drink a glass of water', category: 'HYDRATION', icon: '💧', maxPerDay: 4 },
      { id: 'qst_water_refill', title: 'Refill your water bottle', category: 'HYDRATION', icon: '🚰', maxPerDay: 2 },
      { id: 'qst_water_goal', title: 'Finish your daily water goal', category: 'HYDRATION', icon: '🌊', maxPerDay: 1, reward: { coins: 15, energy: 12, xp: 25 } },
      { id: 'qst_brush_teeth', title: 'Brush your teeth', category: 'HEALTH', icon: '🪥', maxPerDay: 2 },
      { id: 'qst_bath', title: 'Take a bath or shower', category: 'HEALTH', icon: '🛁', maxPerDay: 1 },
      { id: 'qst_sleep_time', title: 'Get to bed on time', category: 'HEALTH', icon: '🌙', maxPerDay: 1, reward: { coins: 15, energy: 10, xp: 20 } },
      { id: 'qst_read_15', title: 'Read for 15 minutes', category: 'LEARNING', icon: '📚', maxPerDay: 3 },
      { id: 'qst_homework', title: 'Finish your homework', category: 'LEARNING', icon: '✏️', maxPerDay: 1, reward: { coins: 20, energy: 12, xp: 35 } },
      { id: 'qst_practice', title: 'Practice math or language', category: 'LEARNING', icon: '🧠', maxPerDay: 2 },
      { id: 'qst_make_bed', title: 'Make your bed', category: 'RESPONSIBILITY', icon: '🛏️', maxPerDay: 1 },
      { id: 'qst_clean_room', title: 'Tidy your room', category: 'RESPONSIBILITY', icon: '🧹', maxPerDay: 1 },
      { id: 'qst_feed_pets', title: 'Feed the pets / help with laundry', category: 'RESPONSIBILITY', icon: '🧺', maxPerDay: 2 },
      { id: 'qst_help_sibling', title: 'Help a sibling', category: 'KINDNESS', icon: '🤝', maxPerDay: 3 },
      { id: 'qst_help_parent', title: 'Help a parent', category: 'KINDNESS', icon: '💛', maxPerDay: 3 },
      { id: 'qst_gratitude', title: 'Share one thing you are grateful for', category: 'KINDNESS', icon: '🙏', maxPerDay: 2 },
      { id: 'qst_exercise', title: 'Exercise for 15 minutes', category: 'FITNESS', icon: '💪', maxPerDay: 2 },
      { id: 'qst_walk', title: 'Take an outdoor walk', category: 'FITNESS', icon: '🚶', maxPerDay: 2 },
      { id: 'qst_stretch', title: 'Morning stretch', category: 'FITNESS', icon: '🤸', maxPerDay: 1 },
    ],

    // Dungeon DEFINITIONS only in Phase 2 (the resolver ships in Phase 4).
    // Balance note: first dungeon unlocks at L1 (Phase 1 doc said L3) so new
    // guardians get an early win; remaining gates unchanged.
    DUNGEONS: [
      { id: 'dgn_glade', name: 'Whispering Glade', tier: 'SHORT', unlockLevel: 1, durationMin: 10, gold: [5, 15], xp: [8, 16], lootRolls: 1 },
      { id: 'dgn_tide', name: 'Tide Caverns', tier: 'SHORT', unlockLevel: 8, durationMin: 20, gold: [12, 30], xp: [15, 30], lootRolls: 2 },
      { id: 'dgn_ember', name: 'Ember Hollow', tier: 'MEDIUM', unlockLevel: 15, durationMin: 45, gold: [25, 60], xp: [30, 60], lootRolls: 2 },
      { id: 'dgn_sky', name: 'Sky Bastion', tier: 'MEDIUM', unlockLevel: 25, durationMin: 90, gold: [50, 120], xp: [60, 120], lootRolls: 3 },
      { id: 'dgn_void', name: 'Voidwalk Ruins', tier: 'LONG', unlockLevel: 40, durationMin: 180, gold: [120, 300], xp: [150, 300], lootRolls: 4 },
    ],

    // Achievements read named counters; adding one is pure data.
    ACHIEVEMENTS: [
      { id: 'ach_first_approval', name: 'First Spark', description: 'Earn your first approved reward.', condition: { counterKey: 'global.approvals', target: 1 } },
      { id: 'ach_approvals_100', name: 'Keeper of the Flame', description: '100 approved quests.', condition: { counterKey: 'global.approvals', target: 100 } },
      { id: 'ach_water_100', name: '100 Waters', description: 'Complete 100 hydration quests.', condition: { counterKey: 'cat.HYDRATION', target: 100 } },
      { id: 'ach_water_500', name: 'River Heart', description: 'Complete 500 hydration quests.', condition: { counterKey: 'cat.HYDRATION', target: 500 } },
      { id: 'ach_read_30', name: '30 Days of Pages', description: 'Complete 30 learning quests.', condition: { counterKey: 'cat.LEARNING', target: 30 } },
      { id: 'ach_kind_50', name: '50 Kindness Acts', description: 'Complete 50 kindness quests.', condition: { counterKey: 'cat.KINDNESS', target: 50 } },
      { id: 'ach_chores_100', name: '100 Chores', description: 'Complete 100 responsibility quests.', condition: { counterKey: 'cat.RESPONSIBILITY', target: 100 } },
      { id: 'ach_fit_50', name: 'Strong Guardian', description: 'Complete 50 fitness quests.', condition: { counterKey: 'cat.FITNESS', target: 50 } },
      { id: 'ach_streak_30', name: 'Moon Cycle', description: 'Reach a 30-day best streak.', condition: { counterKey: 'streak.global.best', target: 30 } },
      { id: 'ach_streak_365', name: '365 Day Streak', description: 'Reach a 365-day best streak.', condition: { counterKey: 'streak.global.best', target: 365 } },
    ],

    BUILDINGS: {
      HOME: { name: 'Home', baseCost: 100, maxLevel: 10, materials: { common: 'itm_wood', uncommon: 'itm_clay', rare: 'itm_crystal' } },
      GARDEN: { name: 'Garden', baseCost: 80, maxLevel: 10, materials: { common: 'itm_fiber', uncommon: 'itm_herbs', rare: 'itm_moonpetal' } },
      WORKSHOP: { name: 'Workshop', baseCost: 120, maxLevel: 10, materials: { common: 'itm_wood', uncommon: 'itm_iron', rare: 'itm_crystal' } },
      HARBOR: { name: 'Harbor', baseCost: 200, maxLevel: 8, materials: { common: 'itm_stone', uncommon: 'itm_iron', rare: 'itm_starsteel' } },
      RUINS: { name: 'Ancient Ruins', baseCost: 300, maxLevel: 5, materials: { common: 'itm_stone', uncommon: 'itm_clay', rare: 'itm_phoenix_feather' } },
      SANCTUARY: { name: 'Pet Sanctuary', baseCost: 150, maxLevel: 10, materials: { common: 'itm_fiber', uncommon: 'itm_herbs', rare: 'itm_crystal' } },
    },
  };

  function deepFreeze(obj) {
    Object.getOwnPropertyNames(obj).forEach(function (k) {
      const v = obj[k];
      if (v && typeof v === 'object') deepFreeze(v);
    });
    return Object.freeze(obj);
  }
  deepFreeze(CONFIG);

  /* ==========================================================================
     02_DOMAIN — pure functions only. No I/O, no DB, no UI.
     ========================================================================== */
  const ENUMS = {
    ROLE: ['CHILD', 'PARENT'],
    SUBMISSION_STATUS: ['PENDING', 'APPROVED', 'REJECTED'],
    RARITY: ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'],
    QUEST_CATEGORY: ['HYDRATION', 'HEALTH', 'LEARNING', 'RESPONSIBILITY', 'KINDNESS', 'FITNESS'],
    SPECIES: Object.keys(CONFIG.SPECIES),
    BUILDING_TYPE: Object.keys(CONFIG.BUILDINGS),
    ITEM_TYPE: ['EQUIPMENT', 'MATERIAL', 'COSMETIC', 'FOOD'],
    DUNGEON_TIER: ['SHORT', 'MEDIUM', 'LONG'],
  };

  const Ids = {
    uuid: function () {
      const c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (c && c.randomUUID) return c.randomUUID();
      // RFC4122 v4 fallback built on getRandomValues.
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    },
  };

  // Deterministic RNG: xmur3 string hash -> mulberry32 stream.
  const RNG = {
    seedFromString: function (str) {
      let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    },
    mulberry32: function (seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  const Leveling = {
    xpToNext: function (level) {
      if (!Number.isInteger(level) || level < 1) throw new ValidationError('BAD_LEVEL', 'level must be int >= 1');
      for (const band of CONFIG.XP_BANDS) {
        if (level <= band.upTo) return band.base + band.per * (level - band.offset);
      }
      throw new ValidationError('BAD_LEVEL', 'no band'); // unreachable: last band is Infinity
    },
    totalXpForLevel: function (level) {
      let sum = 0;
      for (let l = 1; l < level; l++) sum += Leveling.xpToNext(l);
      return sum;
    },
    levelFromTotalXp: function (totalXp) {
      let level = 1;
      let remaining = totalXp;
      while (level < CONFIG.LIMITS.LEVEL_CAP) {
        const need = Leveling.xpToNext(level);
        if (remaining < need) break;
        remaining -= need;
        level++;
      }
      return { level: level, intoLevel: remaining, toNext: Leveling.xpToNext(level) };
    },
    // Pure: returns the new guardian fields after gaining XP (xp is lifetime total).
    applyXp: function (guardian, amount) {
      const before = Leveling.levelFromTotalXp(guardian.xp);
      const newTotal = guardian.xp + amount;
      const after = Leveling.levelFromTotalXp(newTotal);
      return {
        xp: newTotal,
        level: after.level,
        leveledUp: after.level > before.level,
        levelsGained: after.level - before.level,
      };
    },
  };

  const Cosmetics = {
    // Dress-up catalog for the princess avatar. slot = where it layers.
    // source: 'free' (owned at start) | 'raid' (from adventures) | 'legendary' (chore reward)
    CATALOG: {
      // ----- DRESSES -----
      dress_pink:   { slot: 'dress', name: 'Pink Dress',      art: 'dress-pink.png',   rarity: 'common',    source: 'free' },
      dress_blue:   { slot: 'dress', name: 'Blue Gown',       art: 'dress-blue.png',   rarity: 'uncommon',  source: 'raid' },
      dress_purple: { slot: 'dress', name: 'Sparkle Dress',   art: 'dress-purple.png', rarity: 'rare',      source: 'raid' },
      dress_green:  { slot: 'dress', name: 'Garden Dress',    art: 'dress-green.png',  rarity: 'uncommon',  source: 'raid' },
      dress_gold:   { slot: 'dress', name: 'Royal Gown',      art: 'dress-gold.png',   rarity: 'legendary', source: 'legendary' },
      // ----- CROWNS -----
      crown_flower:   { slot: 'crown', name: 'Flower Crown',   art: 'crown-flower.png',   rarity: 'common',    source: 'free' },
      crown_silver:   { slot: 'crown', name: 'Silver Tiara',   art: 'crown-silver.png',   rarity: 'uncommon',  source: 'raid' },
      crown_pink:     { slot: 'crown', name: 'Pink Tiara',     art: 'crown-pink.png',     rarity: 'uncommon',  source: 'raid' },
      crown_rosegold: { slot: 'crown', name: 'Rose Crown',     art: 'crown-rosegold.png', rarity: 'rare',      source: 'raid' },
      crown_gold:     { slot: 'crown', name: 'Golden Crown',   art: 'crown-gold.png',     rarity: 'rare',      source: 'raid' },
      crown_magic:    { slot: 'crown', name: 'Magic Crown',    art: 'crown-magic.png',    rarity: 'legendary', source: 'legendary' },
    },
    // the items every new princess owns immediately
    starterIds: function () {
      var out = [];
      var cat = Cosmetics.CATALOG;
      for (var k in cat) { if (cat[k].source === 'free') out.push(k); }
      return out;
    },
    bySlot: function (slot) {
      var out = [];
      var cat = Cosmetics.CATALOG;
      for (var k in cat) { if (cat[k].slot === slot) out.push(Object.assign({ id: k }, cat[k])); }
      return out;
    },
    get: function (id) { return Cosmetics.CATALOG[id] || null; },
  };

  const Building = {
    // What materials does <type> need to go from <currentLevel> to <currentLevel+1>?
    // Early levels: common only. Mid: common + uncommon. High: uncommon + rare.
    // Quantities scale gently so it always feels achievable from a few raids.
    materialCostFor: function (type, currentLevel) {
      const def = CONFIG.BUILDINGS[type];
      if (!def || !def.materials) return [];
      const L = currentLevel; // level we're upgrading FROM (0-indexed)
      const out = [];
      if (L <= 2) {
        out.push({ itemId: def.materials.common, qty: 3 + L * 2 }); // 3,5,7
      } else if (L <= 5) {
        out.push({ itemId: def.materials.common, qty: 6 });
        out.push({ itemId: def.materials.uncommon, qty: 2 + (L - 3) }); // 2,3,4
      } else {
        out.push({ itemId: def.materials.uncommon, qty: 4 });
        out.push({ itemId: def.materials.rare, qty: 1 + Math.floor((L - 6) / 2) }); // 1,1,2,2...
      }
      return out;
    },
  };

  const Loot = {
    rollRarity: function (rand, weights) {
      const w = weights || CONFIG.RARITY_WEIGHTS;
      let total = 0;
      for (const r of ENUMS.RARITY) total += (w[r] || 0);
      let pick = rand() * total;
      for (const r of ENUMS.RARITY) {
        pick -= (w[r] || 0);
        if (pick < 0) return r;
      }
      return ENUMS.RARITY[0];
    },
    pickItemOfRarity: function (rand, rarity, itemPool) {
      const pool = itemPool.filter(function (i) { return i.rarity === rarity; });
      if (pool.length === 0) return null;
      return pool[Math.floor(rand() * pool.length)];
    },
    rollInt: function (rand, min, max) {
      return min + Math.floor(rand() * (max - min + 1));
    },
    // Pure, deterministic dungeon resolver: the same run (same seed) always
    // produces the same result, on any device, any number of times.
    resolveDungeon: function (run, def, itemPool) {
      const rand = RNG.mulberry32(run.seed);
      const gold = Loot.rollInt(rand, def.gold[0], def.gold[1]);
      const xp = Loot.rollInt(rand, def.xp[0], def.xp[1]);
      const byItem = {};
      for (let i = 0; i < def.lootRolls; i++) {
        const rarity = Loot.rollRarity(rand);
        let item = Loot.pickItemOfRarity(rand, rarity, itemPool);
        if (!item) {
          // No item of that rarity in the pool: walk down to the nearest one.
          const idx = ENUMS.RARITY.indexOf(rarity);
          for (let r = idx - 1; r >= 0 && !item; r--) {
            item = Loot.pickItemOfRarity(rand, ENUMS.RARITY[r], itemPool);
          }
        }
        if (item) byItem[item.id] = (byItem[item.id] || 0) + 1;
      }
      const drops = Object.keys(byItem).map(function (id) { return { itemId: id, qty: byItem[id] }; });
      return { gold: gold, xp: xp, drops: drops };
    },
  };

  const TimeUtil = {
    todayStr: function (d) {
      const dt = d || new Date();
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    },
    localMidnightMs: function (d) {
      const dt = d ? new Date(d) : new Date();
      dt.setHours(0, 0, 0, 0);
      return dt.getTime();
    },
    dayDiff: function (fromStr, toStr) {
      const a = fromStr.split('-').map(Number);
      const b = toStr.split('-').map(Number);
      const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
      return Math.round(ms / 86400000);
    },
  };

  const Streaks = {
    // Pure: returns updated streak fields after activity on `dayStr`.
    // Missed days decay the streak (never hard-reset); `best` never decreases.
    applyActivity: function (streak, dayStr) {
      let current = streak.current;
      if (!streak.lastActiveDay) {
        current = 1;
      } else {
        const diff = TimeUtil.dayDiff(streak.lastActiveDay, dayStr);
        if (diff < 0) throw new ValidationError('TIME_BACKWARDS', 'activity day precedes last active day');
        if (diff === 0) {
          return { current: current, best: streak.best, lastActiveDay: streak.lastActiveDay };
        }
        if (diff === 1) {
          current = current + 1;
        } else {
          current = Streaks.decayed(current, diff - 1) + 1;
        }
      }
      return { current: current, best: Math.max(streak.best, current), lastActiveDay: dayStr };
    },
    decayed: function (current, missedDays) {
      let v = current;
      for (let i = 0; i < missedDays; i++) v = Math.floor(v * CONFIG.STREAK.DECAY_PER_MISSED_DAY);
      return v;
    },
    // Display-only effective streak without recording activity.
    effectiveCurrent: function (streak, todayStrVal) {
      if (!streak.lastActiveDay) return 0;
      const diff = TimeUtil.dayDiff(streak.lastActiveDay, todayStrVal);
      if (diff <= 1) return streak.current;
      return Streaks.decayed(streak.current, diff - 1);
    },
  };

  const Rewards = {
    emptyBundle: function () {
      return { coins: 0, energy: 0, xp: 0, affection: 0, materials: [], lootCrates: 0 };
    },
    normalizeBundle: function (partial) {
      const b = Rewards.emptyBundle();
      const src = partial || {};
      ['coins', 'energy', 'xp', 'affection', 'lootCrates'].forEach(function (k) {
        if (src[k] !== undefined) b[k] = src[k];
      });
      if (src.materials !== undefined) b.materials = src.materials;
      Validation.validateBundle(b);
      return b;
    },
    addBundles: function (a, b) {
      const out = Rewards.emptyBundle();
      ['coins', 'energy', 'xp', 'affection', 'lootCrates'].forEach(function (k) { out[k] = a[k] + b[k]; });
      const byItem = {};
      (a.materials || []).concat(b.materials || []).forEach(function (m) {
        byItem[m.itemId] = (byItem[m.itemId] || 0) + m.qty;
      });
      out.materials = Object.keys(byItem).map(function (id) { return { itemId: id, qty: byItem[id] }; });
      return out;
    },
  };

  // Resolve a quest's effective reward bundle (defaults + per-quest override).
  function questRewardBundle(quest) {
    const base = CONFIG.REWARD_DEFAULTS[quest.category];
    return Rewards.normalizeBundle(Object.assign({}, base, quest.reward || {}));
  }

  // Pure submission rule used by QuestService in Phase 4 and tested now.
  function canSubmitQuest(quest, todaysNonRejectedCount) {
    if (!quest.active) return { ok: false, reason: 'QUEST_INACTIVE' };
    if (todaysNonRejectedCount >= quest.maxPerDay) return { ok: false, reason: 'MAX_PER_DAY_REACHED' };
    return { ok: true };
  }

  /* ---- Canonical JSON + SHA-256 (used by backup checksum now, audit chain in P3) */
  const Canon = {
    stringify: function canon(v) {
      if (v === null) return 'null';
      const t = typeof v;
      if (t === 'number') {
        if (!isFinite(v)) throw new ValidationError('BAD_JSON', 'non-finite number');
        return JSON.stringify(v);
      }
      if (t === 'boolean' || t === 'string') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (t === 'object') {
        const keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
        return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
      }
      throw new ValidationError('BAD_JSON', 'unsupported type: ' + t);
    },
  };

  async function sha256Hex(str) {
    const c = (root.crypto && root.crypto.subtle) ? root.crypto : globalThis.crypto;
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  /* ==========================================================================
     02b_VALIDATION — every write passes through here. Closed-world: writes to
     unknown stores or with unknown shapes are rejected.
     ========================================================================== */
  class ValidationError extends Error {
    constructor(code, message) {
      super(code + ': ' + message);
      this.name = 'ValidationError';
      this.code = code;
    }
  }

  const V = {
    str: function (v, field, min, max) {
      if (typeof v !== 'string') throw new ValidationError('BAD_TYPE', field + ' must be string');
      if (min !== undefined && v.length < min) throw new ValidationError('TOO_SHORT', field);
      if (max !== undefined && v.length > max) throw new ValidationError('TOO_LONG', field);
      return v;
    },
    int: function (v, field, min, max) {
      if (!Number.isInteger(v)) throw new ValidationError('BAD_TYPE', field + ' must be integer');
      if (min !== undefined && v < min) throw new ValidationError('OUT_OF_RANGE', field + ' < ' + min);
      if (max !== undefined && v > max) throw new ValidationError('OUT_OF_RANGE', field + ' > ' + max);
      return v;
    },
    bool: function (v, field) {
      if (typeof v !== 'boolean') throw new ValidationError('BAD_TYPE', field + ' must be boolean');
      return v;
    },
    oneOf: function (v, field, list) {
      if (list.indexOf(v) === -1) throw new ValidationError('BAD_ENUM', field + ' must be one of ' + list.join('|'));
      return v;
    },
    hex64: function (v, field) {
      if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) {
        if (v !== CONFIG.SECURITY.AUDIT_GENESIS) throw new ValidationError('BAD_HASH', field + ' must be sha256 hex or GENESIS');
      }
      return v;
    },
  };

  const Validation = {
    Error: ValidationError,

    validateBundle: function (b) {
      if (!b || typeof b !== 'object') throw new ValidationError('BAD_TYPE', 'bundle must be object');
      const MAX = CONFIG.LIMITS.MAX_BUNDLE_FIELD;
      ['coins', 'energy', 'xp', 'affection', 'lootCrates'].forEach(function (k) {
        V.int(b[k], 'bundle.' + k, 0, MAX);
      });
      if (!Array.isArray(b.materials)) throw new ValidationError('BAD_TYPE', 'bundle.materials must be array');
      b.materials.forEach(function (m, i) {
        V.str(m.itemId, 'bundle.materials[' + i + '].itemId', 1, 64);
        V.int(m.qty, 'bundle.materials[' + i + '].qty', 1, CONFIG.LIMITS.MAX_QTY);
      });
      return b;
    },

    assertSubmissionTransition: function (fromStatus, toStatus) {
      if (fromStatus !== 'PENDING') {
        throw new ValidationError('IMMUTABLE_DECISION', 'submission already ' + fromStatus + '; decisions are final');
      }
      if (toStatus !== 'APPROVED' && toStatus !== 'REJECTED') {
        throw new ValidationError('BAD_TRANSITION', 'PENDING may only become APPROVED or REJECTED');
      }
    },

    validators: {
      users: function (o) {
        V.str(o.id, 'id', 1); V.oneOf(o.role, 'role', ENUMS.ROLE);
        V.str(o.name, 'name', CONFIG.LIMITS.NAME_MIN, CONFIG.LIMITS.NAME_MAX);
        V.str(o.avatar, 'avatar', 0, 16); V.int(o.createdAt, 'createdAt', 0);
      },
      credentials: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1);
        V.str(o.pinHash, 'pinHash', 16); V.str(o.salt, 'salt', 8);
        V.int(o.iterations, 'iterations', 100000);
        V.oneOf(o.algo, 'algo', [CONFIG.SECURITY.ALGO]);
        if (o.failedAttempts !== undefined) V.int(o.failedAttempts, 'failedAttempts', 0);
        if (o.lockoutUntil !== undefined) V.int(o.lockoutUntil, 'lockoutUntil', 0);
        if (o.lockoutCount !== undefined) V.int(o.lockoutCount, 'lockoutCount', 0);
      },
      guardians: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1);
        V.str(o.name, 'name', CONFIG.LIMITS.NAME_MIN, CONFIG.LIMITS.NAME_MAX);
        V.oneOf(o.species, 'species', ENUMS.SPECIES);
        V.int(o.level, 'level', 1, CONFIG.LIMITS.LEVEL_CAP);
        V.int(o.xp, 'xp', 0); V.int(o.energy, 'energy', 0);
        V.int(o.maxEnergy, 'maxEnergy', 1);
        if (o.energy > o.maxEnergy) throw new ValidationError('OUT_OF_RANGE', 'energy > maxEnergy');
        V.int(o.gold, 'gold', 0, CONFIG.LIMITS.MAX_GOLD);
        V.int(o.affection, 'affection', 0, CONFIG.ECONOMY.AFFECTION_MAX);
      },
      items: function (o) {
        V.str(o.id, 'id', 1); V.str(o.name, 'name', 1, 48);
        V.oneOf(o.rarity, 'rarity', ENUMS.RARITY);
        V.oneOf(o.type, 'type', ENUMS.ITEM_TYPE);
        V.str(o.description, 'description', 0, 160);
      },
      inventory: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1); V.str(o.itemId, 'itemId', 1);
        V.int(o.qty, 'qty', 1, CONFIG.LIMITS.MAX_QTY);
      },
      quests: function (o) {
        V.str(o.id, 'id', 1); V.str(o.title, 'title', 1, 80);
        V.oneOf(o.category, 'category', ENUMS.QUEST_CATEGORY);
        Validation.validateBundle(o.reward);
        V.int(o.maxPerDay, 'maxPerDay', 1, 50);
        V.bool(o.active, 'active'); V.str(o.icon, 'icon', 0, 8);
      },
      submissions: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1); V.str(o.questId, 'questId', 1);
        V.oneOf(o.status, 'status', ENUMS.SUBMISSION_STATUS);
        V.int(o.submittedAt, 'submittedAt', 0);
        if (o.status === 'PENDING') {
          if (o.decidedAt !== undefined || o.decidedBy !== undefined) {
            throw new ValidationError('BAD_SHAPE', 'pending submission cannot carry decision fields');
          }
        } else {
          V.int(o.decidedAt, 'decidedAt', 0); V.str(o.decidedBy, 'decidedBy', 1);
        }
        if (o.note !== undefined) V.str(o.note, 'note', 0, CONFIG.LIMITS.NOTE_MAX);
      },
      rewardTransactions: function (o) {
        V.str(o.id, 'id', 1); V.str(o.submissionId, 'submissionId', 1); V.str(o.userId, 'userId', 1);
        Validation.validateBundle(o.bundle); V.int(o.createdAt, 'createdAt', 0);
        if (o.applied !== undefined) V.bool(o.applied, 'applied');
      },
      achievements: function (o) {
        V.str(o.id, 'id', 1); V.str(o.name, 'name', 1, 64); V.str(o.description, 'description', 0, 160);
        if (!o.condition || typeof o.condition !== 'object') throw new ValidationError('BAD_TYPE', 'condition');
        V.str(o.condition.counterKey, 'condition.counterKey', 1, 64);
        V.int(o.condition.target, 'condition.target', 1);
        if (o.rewardBundle !== undefined) Validation.validateBundle(o.rewardBundle);
      },
      achievementProgress: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1); V.str(o.achievementId, 'achievementId', 1);
        V.int(o.progress, 'progress', 0);
        if (o.unlockedAt !== undefined) V.int(o.unlockedAt, 'unlockedAt', 0);
      },
      buildings: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1);
        V.oneOf(o.type, 'type', ENUMS.BUILDING_TYPE);
        const def = CONFIG.BUILDINGS[o.type];
        V.int(o.level, 'level', 0, def.maxLevel);
      },
      dungeonRuns: function (o) {
        V.str(o.id, 'id', 1); V.str(o.guardianId, 'guardianId', 1); V.str(o.dungeonId, 'dungeonId', 1);
        V.int(o.seed, 'seed', 0); V.int(o.startedAt, 'startedAt', 0); V.int(o.endsAt, 'endsAt', 0);
        if (o.endsAt < o.startedAt) throw new ValidationError('OUT_OF_RANGE', 'endsAt before startedAt');
        V.bool(o.claimed, 'claimed');
        if (o.claimed === true && o.result === undefined) {
          throw new ValidationError('BAD_SHAPE', 'a claimed run must persist its result');
        }
        if (o.result !== undefined) {
          V.int(o.result.gold, 'result.gold', 0); V.int(o.result.xp, 'result.xp', 0);
          if (!Array.isArray(o.result.drops)) throw new ValidationError('BAD_TYPE', 'result.drops');
          o.result.drops.forEach(function (d, i) {
            V.str(d.itemId, 'result.drops[' + i + '].itemId', 1);
            V.int(d.qty, 'result.drops[' + i + '].qty', 1, CONFIG.LIMITS.MAX_QTY);
          });
        }
      },
      streaks: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1);
        V.oneOf(o.scope, 'scope', ['GLOBAL'].concat(ENUMS.QUEST_CATEGORY));
        V.int(o.current, 'current', 0); V.int(o.best, 'best', 0);
        if (o.best < o.current) throw new ValidationError('OUT_OF_RANGE', 'best < current');
        if (o.lastActiveDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.lastActiveDay)) {
          throw new ValidationError('BAD_DATE', 'lastActiveDay must be YYYY-MM-DD');
        }
      },
      counters: function (o) {
        V.str(o.id, 'id', 1); V.str(o.userId, 'userId', 1);
        V.str(o.key, 'key', 1, 64); V.int(o.value, 'value', 0);
      },
      auditLogs: function (o) {
        V.str(o.id, 'id', 1); V.str(o.parentId, 'parentId', 1);
        V.str(o.action, 'action', 1, 64); V.str(o.entity, 'entity', 1, 32); V.str(o.entityId, 'entityId', 1);
        V.int(o.timestamp, 'timestamp', 0);
        if (o.reason !== undefined) V.str(o.reason, 'reason', 0, CONFIG.LIMITS.NOTE_MAX);
        V.hex64(o.prevHash, 'prevHash'); V.hex64(o.hash, 'hash');
        if (o.hash === CONFIG.SECURITY.AUDIT_GENESIS) throw new ValidationError('BAD_HASH', 'hash cannot be GENESIS');
      },
      meta: function (o) {
        V.str(o.key, 'key', 1, 64);
        if (o.value === undefined) throw new ValidationError('BAD_SHAPE', 'meta.value required');
      },
    },

    validateForStore: function (store, obj) {
      const fn = Validation.validators[store];
      if (!fn) throw new ValidationError('UNKNOWN_STORE', 'no validator for store ' + store);
      if (!obj || typeof obj !== 'object') throw new ValidationError('BAD_TYPE', 'record must be object');
      fn(obj);
      return obj;
    },
  };

  /* ==========================================================================
     03_DB — schema definition + migrations + IndexedDB backend + wrapper.
     The wrapper is backend-agnostic so tests can run against a memory backend
     and the app runs against IndexedDB. (Flutter port later: this is the seam.)
     ========================================================================== */
  const SCHEMA = {
    version: CONFIG.DB.version,
    stores: {
      users: { keyPath: 'id', indexes: { role: 'role' } },
      credentials: { keyPath: 'id', indexes: { userId: 'userId' } },
      guardians: { keyPath: 'id', indexes: { userId: 'userId' } },
      items: { keyPath: 'id', indexes: { rarity: 'rarity', type: 'type' } },
      inventory: { keyPath: 'id', indexes: { userId: 'userId', user_item: ['userId', 'itemId'] } },
      quests: { keyPath: 'id', indexes: { category: 'category' } },
      submissions: { keyPath: 'id', indexes: { userId: 'userId', status: 'status', user_status: ['userId', 'status'], submittedAt: 'submittedAt' } },
      rewardTransactions: { keyPath: 'id', indexes: { userId: 'userId', submissionId: 'submissionId' } },
      achievements: { keyPath: 'id', indexes: {} },
      achievementProgress: { keyPath: 'id', indexes: { userId: 'userId', user_achievement: ['userId', 'achievementId'] } },
      buildings: { keyPath: 'id', indexes: { userId: 'userId', user_type: ['userId', 'type'] } },
      dungeonRuns: { keyPath: 'id', indexes: { guardianId: 'guardianId' } },
      streaks: { keyPath: 'id', indexes: { userId: 'userId', user_scope: ['userId', 'scope'] } },
      counters: { keyPath: 'id', indexes: { userId: 'userId', user_key: ['userId', 'key'] } },
      auditLogs: { keyPath: 'id', indexes: { parentId: 'parentId', timestamp: 'timestamp' } },
      meta: { keyPath: 'key', indexes: {} },
    },
  };
  const STORE_NAMES = Object.keys(SCHEMA.stores);

  // Structural migrations keyed by oldVersion. v0 -> v1 creates everything.
  // Future versions append functions here; they run in order inside the
  // upgrade transaction. Data seeding happens post-open via SeedService.
  const MIGRATIONS = {
    0: function createInitialSchema(idb) {
      STORE_NAMES.forEach(function (name) {
        if (idb.objectStoreNames.contains(name)) return;
        const def = SCHEMA.stores[name];
        const store = idb.createObjectStore(name, { keyPath: def.keyPath });
        Object.keys(def.indexes).forEach(function (idxName) {
          store.createIndex(idxName, def.indexes[idxName], { unique: false });
        });
      });
    },
  };

  function createIdbBackend(dbName) {
    let dbRef = null;
    function promisify(req) {
      return new Promise(function (resolve, reject) {
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return {
      name: dbName,
      open: function () {
        return new Promise(function (resolve, reject) {
          const req = indexedDB.open(dbName, SCHEMA.version);
          req.onupgradeneeded = function (ev) {
            const idb = req.result;
            for (let v = ev.oldVersion; v < SCHEMA.version; v++) {
              if (MIGRATIONS[v]) MIGRATIONS[v](idb);
            }
          };
          req.onsuccess = function () {
            dbRef = req.result;
            dbRef.onversionchange = function () { dbRef.close(); };
            resolve();
          };
          req.onerror = function () { reject(req.error); };
          req.onblocked = function () { reject(new Error('DB open blocked by another tab')); };
        });
      },
      close: function () { if (dbRef) { dbRef.close(); dbRef = null; } },
      // Runs fn(ctx) inside ONE IndexedDB transaction. Rule: inside fn, only
      // await ctx.* operations — any foreign await lets the tx auto-commit.
      run: function (storeNames, mode, fn) {
        return new Promise(function (resolve, reject) {
          let out;
          let fnErr = null;
          const tx = dbRef.transaction(storeNames, mode);
          tx.oncomplete = function () { fnErr ? reject(fnErr) : resolve(out); };
          tx.onerror = function () { reject(fnErr || tx.error); };
          tx.onabort = function () { reject(fnErr || tx.error || new Error('TX_ABORTED')); };
          const ctx = {
            get: function (s, k) { return promisify(tx.objectStore(s).get(k)); },
            getAll: function (s) { return promisify(tx.objectStore(s).getAll()); },
            byIndex: function (s, idx, val) { return promisify(tx.objectStore(s).index(idx).getAll(val)); },
            put: function (s, v) { return promisify(tx.objectStore(s).put(v)); },
            del: function (s, k) { return promisify(tx.objectStore(s).delete(k)); },
            clear: function (s) { return promisify(tx.objectStore(s).clear()); },
            count: function (s) { return promisify(tx.objectStore(s).count()); },
          };
          Promise.resolve()
            .then(function () { return fn(ctx); })
            .then(function (v) { out = v; })
            .catch(function (e) {
              fnErr = e;
              try { tx.abort(); } catch (_) { /* already finished */ }
            });
        });
      },
      destroy: function () {
        this.close();
        return promisify(indexedDB.deleteDatabase(dbName));
      },
    };
  }

  // Backend-agnostic wrapper used by repositories.
  function makeDB(backend) {
    return {
      backend: backend,
      open: function () { return backend.open(); },
      close: function () { return backend.close && backend.close(); },
      destroy: function () { return backend.destroy && backend.destroy(); },
      atomic: function (stores, fn) { return backend.run(stores, 'readwrite', fn); },
      read: function (stores, fn) { return backend.run(stores, 'readonly', fn); },
      get: function (s, k) { return backend.run([s], 'readonly', function (c) { return c.get(s, k); }); },
      getAll: function (s) { return backend.run([s], 'readonly', function (c) { return c.getAll(s); }); },
      byIndex: function (s, idx, val) { return backend.run([s], 'readonly', function (c) { return c.byIndex(s, idx, val); }); },
      count: function (s) { return backend.run([s], 'readonly', function (c) { return c.count(s); }); },
      clearAllStores: function () {
        return backend.run(STORE_NAMES, 'readwrite', function (c) {
          return STORE_NAMES.reduce(function (p, s) { return p.then(function () { return c.clear(s); }); }, Promise.resolve());
        });
      },
    };
  }

  /* ==========================================================================
     04_REPOSITORIES — the only layer allowed to touch the DB. Every write is
     validated. Invariants live here as defense-in-depth even though services
     (Phase 3/4) enforce role rules too.
     ========================================================================== */
  function makeRepositories(db) {
    function vput(ctx, store, obj) {
      Validation.validateForStore(store, obj);
      return ctx.put(store, obj);
    }

    // Shared bundle application — runs INSIDE an existing transaction context.
    // The single place where coins/energy/XP/affection/materials hit a guardian.
    async function applyBundleInCtx(c, userId, bundle) {
      const rows = await c.byIndex('guardians', 'userId', userId);
      const g = rows[0];
      if (!g) throw new ValidationError('NOT_FOUND', 'guardian for user ' + userId);
      const lv = Leveling.applyXp(g, bundle.xp);
      g.xp = lv.xp; g.level = lv.level;
      g.gold = Math.min(CONFIG.LIMITS.MAX_GOLD, g.gold + bundle.coins);
      g.energy = Math.min(g.maxEnergy, g.energy + bundle.energy);
      g.affection = Math.min(CONFIG.ECONOMY.AFFECTION_MAX, g.affection + bundle.affection);
      await vput(c, 'guardians', g);

      const grants = bundle.materials.slice();
      if (bundle.lootCrates > 0) grants.push({ itemId: 'itm_loot_crate', qty: bundle.lootCrates });
      for (const m of grants) {
        const existing = await c.byIndex('inventory', 'user_item', [userId, m.itemId]);
        if (existing.length) {
          existing[0].qty = Math.min(CONFIG.LIMITS.MAX_QTY, existing[0].qty + m.qty);
          await vput(c, 'inventory', existing[0]);
        } else {
          await vput(c, 'inventory', { id: Ids.uuid(), userId: userId, itemId: m.itemId, qty: m.qty });
        }
      }
      return { guardian: g, leveledUp: lv.leveledUp, levelsGained: lv.levelsGained };
    }

    const UserRepo = {
      create: function (fields) {
        const user = {
          id: Ids.uuid(), role: fields.role, name: fields.name,
          avatar: fields.avatar || '🙂', createdAt: Date.now(),
        };
        return db.atomic(['users'], function (c) { return vput(c, 'users', user); }).then(function () { return user; });
      },
      get: function (id) { return db.get('users', id); },
      list: function () { return db.getAll('users'); },
      listByRole: function (role) { return db.byIndex('users', 'role', role); },
      updateProfile: function (id, fields) {
        return db.atomic(['users'], async function (c) {
          const u = await c.get('users', id);
          if (!u) throw new ValidationError('NOT_FOUND', 'user ' + id);
          if (fields.name !== undefined) u.name = fields.name;
          if (fields.avatar !== undefined) u.avatar = fields.avatar;
          await vput(c, 'users', u);
          return u;
        });
      },
      // Removes a user and all owned records. Audit logs are intentionally
      // retained: history is immutable.
      removeCascade: function (userId) {
        const stores = ['users', 'credentials', 'guardians', 'inventory', 'submissions',
          'rewardTransactions', 'achievementProgress', 'buildings', 'streaks', 'counters', 'dungeonRuns'];
        return db.atomic(stores, async function (c) {
          const guardians = await c.byIndex('guardians', 'userId', userId);
          for (const g of guardians) {
            const runs = await c.byIndex('dungeonRuns', 'guardianId', g.id);
            for (const r of runs) await c.del('dungeonRuns', r.id);
            await c.del('guardians', g.id);
          }
          const byUser = ['credentials', 'inventory', 'submissions', 'rewardTransactions',
            'achievementProgress', 'buildings', 'streaks', 'counters'];
          for (const s of byUser) {
            const rows = await c.byIndex(s, 'userId', userId);
            for (const r of rows) await c.del(s, r.id);
          }
          await c.del('users', userId);
        });
      },
    };

    const CredentialRepo = {
      setForUser: function (userId, cred) {
        return db.atomic(['credentials', 'users'], async function (c) {
          const u = await c.get('users', userId);
          if (!u) throw new ValidationError('NOT_FOUND', 'user ' + userId);
          const existing = await c.byIndex('credentials', 'userId', userId);
          const row = {
            id: existing.length ? existing[0].id : Ids.uuid(),
            userId: userId, pinHash: cred.pinHash, salt: cred.salt,
            iterations: cred.iterations, algo: cred.algo,
          };
          await vput(c, 'credentials', row);
          return row;
        });
      },
      getByUser: function (userId) {
        return db.byIndex('credentials', 'userId', userId).then(function (rows) { return rows[0] || null; });
      },
      // Persists PIN attempt/lockout state so a page reload cannot reset it.
      recordAuthState: function (userId, fields) {
        return db.atomic(['credentials'], async function (c) {
          const rows = await c.byIndex('credentials', 'userId', userId);
          const cred = rows[0];
          if (!cred) throw new ValidationError('NOT_FOUND', 'credentials for user ' + userId);
          ['failedAttempts', 'lockoutUntil', 'lockoutCount'].forEach(function (k) {
            if (fields[k] !== undefined) cred[k] = fields[k];
          });
          await vput(c, 'credentials', cred);
          return cred;
        });
      },
    };

    const GuardianRepo = {
      createForUser: function (userId, fields, opts) {
        const sg = (opts && opts.starter) ? (CONFIG.ECONOMY.STARTER_GRANT || {}) : {};
        const g = {
          id: Ids.uuid(), userId: userId, name: fields.name, species: fields.species,
          level: 1, xp: 0,
          energy: sg.energyToFull ? CONFIG.ECONOMY.BASE_MAX_ENERGY : 0,
          maxEnergy: CONFIG.ECONOMY.BASE_MAX_ENERGY,
          gold: sg.gold || 0, affection: sg.affection || 0,
        };
        return db.atomic(['guardians', 'users'], async function (c) {
          const u = await c.get('users', userId);
          if (!u) throw new ValidationError('NOT_FOUND', 'user ' + userId);
          const existing = await c.byIndex('guardians', 'userId', userId);
          if (existing.length) throw new ValidationError('ALREADY_EXISTS', 'user already has a guardian');
          await vput(c, 'guardians', g);
          return g;
        });
      },
      getByUser: function (userId) {
        return db.byIndex('guardians', 'userId', userId).then(function (rows) { return rows[0] || null; });
      },
      get: function (id) { return db.get('guardians', id); },
      // Applies a reward bundle atomically: gold/xp/energy/affection on the
      // guardian, materials + crates into inventory. Energy clamps at max.
      applyBundle: function (userId, bundle) {
        Validation.validateBundle(bundle);
        return db.atomic(['guardians', 'inventory'], function (c) {
          return applyBundleInCtx(c, userId, bundle);
        });
      },
      spendEnergy: function (guardianId, amount) {
        V.int(amount, 'amount', 1);
        return db.atomic(['guardians'], async function (c) {
          const g = await c.get('guardians', guardianId);
          if (!g) throw new ValidationError('NOT_FOUND', 'guardian ' + guardianId);
          if (g.energy < amount) throw new ValidationError('INSUFFICIENT_ENERGY', 'have ' + g.energy + ', need ' + amount);
          g.energy -= amount;
          await vput(c, 'guardians', g);
          return g;
        });
      },
      spendGold: function (guardianId, amount) {
        V.int(amount, 'amount', 1);
        return db.atomic(['guardians'], async function (c) {
          const g = await c.get('guardians', guardianId);
          if (!g) throw new ValidationError('NOT_FOUND', 'guardian ' + guardianId);
          if (g.gold < amount) throw new ValidationError('INSUFFICIENT_GOLD', 'have ' + g.gold + ', need ' + amount);
          g.gold -= amount;
          await vput(c, 'guardians', g);
          return g;
        });
      },
    };

    const ItemRepo = {
      bulkSeed: function (items) {
        return db.atomic(['items'], async function (c) {
          for (const it of items) await vput(c, 'items', it);
        });
      },
      get: function (id) { return db.get('items', id); },
      list: function () { return db.getAll('items'); },
      listByRarity: function (r) { return db.byIndex('items', 'rarity', r); },
      listByType: function (t) { return db.byIndex('items', 'type', t); },
    };

    const InventoryRepo = {
      listByUser: function (userId) { return db.byIndex('inventory', 'userId', userId); },
      addItem: function (userId, itemId, qty) {
        V.int(qty, 'qty', 1);
        return db.atomic(['inventory', 'items'], async function (c) {
          const item = await c.get('items', itemId);
          if (!item) throw new ValidationError('NOT_FOUND', 'item ' + itemId);
          const existing = await c.byIndex('inventory', 'user_item', [userId, itemId]);
          if (existing.length) {
            existing[0].qty = Math.min(CONFIG.LIMITS.MAX_QTY, existing[0].qty + qty);
            await vput(c, 'inventory', existing[0]);
            return existing[0];
          }
          const row = { id: Ids.uuid(), userId: userId, itemId: itemId, qty: qty };
          await vput(c, 'inventory', row);
          return row;
        });
      },
      removeItem: function (userId, itemId, qty) {
        V.int(qty, 'qty', 1);
        return db.atomic(['inventory'], async function (c) {
          const existing = await c.byIndex('inventory', 'user_item', [userId, itemId]);
          const row = existing[0];
          if (!row || row.qty < qty) throw new ValidationError('INSUFFICIENT_ITEMS', itemId);
          row.qty -= qty;
          if (row.qty === 0) { await c.del('inventory', row.id); return null; }
          await vput(c, 'inventory', row);
          return row;
        });
      },
      // ONE atomic transaction: consume one item, grant another. Used by
      // crate opening so a crash can never eat the crate without the prize.
      consumeAndGrant: function (userId, consumeItemId, grantItemId, grantQty) {
        V.int(grantQty, 'grantQty', 1);
        return db.atomic(['inventory', 'items'], async function (c) {
          const grantItem = await c.get('items', grantItemId);
          if (!grantItem) throw new ValidationError('NOT_FOUND', 'item ' + grantItemId);
          const have = await c.byIndex('inventory', 'user_item', [userId, consumeItemId]);
          const row = have[0];
          if (!row || row.qty < 1) throw new ValidationError('INSUFFICIENT_ITEMS', consumeItemId);
          row.qty -= 1;
          if (row.qty === 0) await c.del('inventory', row.id);
          else await vput(c, 'inventory', row);
          const target = await c.byIndex('inventory', 'user_item', [userId, grantItemId]);
          if (target.length) {
            target[0].qty = Math.min(CONFIG.LIMITS.MAX_QTY, target[0].qty + grantQty);
            await vput(c, 'inventory', target[0]);
            return target[0];
          }
          const fresh = { id: Ids.uuid(), userId: userId, itemId: grantItemId, qty: grantQty };
          await vput(c, 'inventory', fresh);
          return fresh;
        });
      },
    };

    const QuestRepo = {
      bulkSeed: function (quests) {
        return db.atomic(['quests'], async function (c) {
          for (const q of quests) await vput(c, 'quests', q);
        });
      },
      get: function (id) { return db.get('quests', id); },
      list: function () { return db.getAll('quests'); },
      listActive: function () {
        return db.getAll('quests').then(function (all) { return all.filter(function (q) { return q.active; }); });
      },
      create: function (fields) {
        const q = {
          id: Ids.uuid(), title: fields.title, category: fields.category,
          reward: Rewards.normalizeBundle(fields.reward),
          maxPerDay: fields.maxPerDay || CONFIG.MAX_PER_DAY_DEFAULTS[fields.category] || 1,
          active: true, icon: fields.icon || '⭐',
        };
        return db.atomic(['quests'], function (c) { return vput(c, 'quests', q); }).then(function () { return q; });
      },
      setActive: function (id, active) {
        return db.atomic(['quests'], async function (c) {
          const q = await c.get('quests', id);
          if (!q) throw new ValidationError('NOT_FOUND', 'quest ' + id);
          q.active = active;
          await vput(c, 'quests', q);
          return q;
        });
      },
    };

    const SubmissionRepo = {
      // Invariant: rows are ALWAYS born PENDING with no decision fields.
      // There is no code path that creates an APPROVED submission directly.
      createPending: function (userId, questId) {
        return db.atomic(['submissions', 'users', 'quests'], async function (c) {
          const u = await c.get('users', userId);
          if (!u) throw new ValidationError('NOT_FOUND', 'user ' + userId);
          const q = await c.get('quests', questId);
          if (!q) throw new ValidationError('NOT_FOUND', 'quest ' + questId);
          if (!q.active) throw new ValidationError('QUEST_INACTIVE', questId);
          const sub = { id: Ids.uuid(), userId: userId, questId: questId, status: 'PENDING', submittedAt: Date.now() };
          await vput(c, 'submissions', sub);
          return sub;
        });
      },
      get: function (id) { return db.get('submissions', id); },
      listByStatus: function (status) { return db.byIndex('submissions', 'status', status); },
      listByUser: function (userId) { return db.byIndex('submissions', 'userId', userId); },
      listByUserAndStatus: function (userId, status) { return db.byIndex('submissions', 'user_status', [userId, status]); },
      countTodayNonRejected: function (userId, questId, now) {
        const midnight = TimeUtil.localMidnightMs(now);
        return db.byIndex('submissions', 'userId', userId).then(function (rows) {
          return rows.filter(function (s) {
            return s.questId === questId && s.submittedAt >= midnight && s.status !== 'REJECTED';
          }).length;
        });
      },
      // Invariant: only PENDING -> APPROVED|REJECTED, decided exactly once,
      // and the decider must be an existing PARENT user.
      decide: function (submissionId, decision) {
        return db.atomic(['submissions', 'users'], async function (c) {
          const sub = await c.get('submissions', submissionId);
          if (!sub) throw new ValidationError('NOT_FOUND', 'submission ' + submissionId);
          Validation.assertSubmissionTransition(sub.status, decision.status);
          const decider = await c.get('users', decision.decidedBy);
          if (!decider || decider.role !== 'PARENT') {
            throw new ValidationError('FORBIDDEN', 'decisions require a PARENT user');
          }
          sub.status = decision.status;
          sub.decidedAt = Date.now();
          sub.decidedBy = decision.decidedBy;
          if (decision.note !== undefined) sub.note = decision.note;
          await vput(c, 'submissions', sub);
          return sub;
        });
      },
    };

    const RewardTransactionRepo = {
      // Invariant: a reward transaction can only exist for an APPROVED
      // submission, and only one per submission. Born with applied:false;
      // the applyTransaction step below releases it exactly once.
      createForSubmission: function (submission, bundle) {
        Validation.validateBundle(bundle);
        return db.atomic(['rewardTransactions', 'submissions'], async function (c) {
          const sub = await c.get('submissions', submission.id);
          if (!sub) throw new ValidationError('NOT_FOUND', 'submission ' + submission.id);
          if (sub.status !== 'APPROVED') throw new ValidationError('FORBIDDEN', 'rewards require an APPROVED submission');
          const existing = await c.byIndex('rewardTransactions', 'submissionId', sub.id);
          if (existing.length) throw new ValidationError('ALREADY_EXISTS', 'reward already released for submission');
          const row = { id: Ids.uuid(), submissionId: sub.id, userId: sub.userId, bundle: bundle, createdAt: Date.now(), applied: false };
          await vput(c, 'rewardTransactions', row);
          return row;
        });
      },
      // ONE atomic transaction that releases a reward: guardian stats,
      // inventory grants, GLOBAL streak, and counters all move together, and
      // the applied flag flips in the same commit. Idempotent: a transaction
      // already applied (or a legacy row without the flag) is a no-op, which
      // makes crash recovery safe to run any number of times.
      applyTransaction: function (txnId, info) {
        V.oneOf(info.category, 'category', ENUMS.QUEST_CATEGORY);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(info.dayStr)) throw new ValidationError('BAD_DATE', 'dayStr must be YYYY-MM-DD');
        return db.atomic(['rewardTransactions', 'guardians', 'inventory', 'streaks', 'counters'], async function (c) {
          const txn = await c.get('rewardTransactions', txnId);
          if (!txn) throw new ValidationError('NOT_FOUND', 'rewardTransaction ' + txnId);
          if (txn.applied !== false) return { alreadyApplied: true, transaction: txn };

          const applied = await applyBundleInCtx(c, txn.userId, txn.bundle);

          const srows = await c.byIndex('streaks', 'user_scope', [txn.userId, 'GLOBAL']);
          const streak = srows[0] || { id: Ids.uuid(), userId: txn.userId, scope: 'GLOBAL', current: 0, best: 0 };
          Object.assign(streak, Streaks.applyActivity(streak, info.dayStr));
          await vput(c, 'streaks', streak);

          const catRows = await c.byIndex('streaks', 'user_scope', [txn.userId, info.category]);
          const catStreak = catRows[0] || { id: Ids.uuid(), userId: txn.userId, scope: info.category, current: 0, best: 0 };
          Object.assign(catStreak, Streaks.applyActivity(catStreak, info.dayStr));
          await vput(c, 'streaks', catStreak);

          async function bump(key, by) {
            const rows = await c.byIndex('counters', 'user_key', [txn.userId, key]);
            const row = rows[0] || { id: Ids.uuid(), userId: txn.userId, key: key, value: 0 };
            row.value += by;
            await vput(c, 'counters', row);
          }
          async function maxify(key, candidate) {
            const rows = await c.byIndex('counters', 'user_key', [txn.userId, key]);
            const row = rows[0] || { id: Ids.uuid(), userId: txn.userId, key: key, value: 0 };
            row.value = Math.max(row.value, candidate);
            await vput(c, 'counters', row);
          }
          await bump('global.approvals', 1);
          await bump('cat.' + info.category, 1);
          await maxify('streak.global.best', streak.best);

          // The First Flame: family-shared, fed only by approved acts.
          async function bumpFamily(by) {
            if (!by) return;
            const rows = await c.byIndex('counters', 'user_key', [CONFIG.FLAME.FAMILY_ID, CONFIG.FLAME.KEY]);
            const row = rows[0] || { id: Ids.uuid(), userId: CONFIG.FLAME.FAMILY_ID, key: CONFIG.FLAME.KEY, value: 0 };
            row.value += by;
            await vput(c, 'counters', row);
          }
          let flamePts = CONFIG.FLAME.SOURCES[info.category] || 0;
          if (info.questId === CONFIG.FLAME.GRATITUDE_QUEST_ID) flamePts = CONFIG.FLAME.SOURCES.GRATITUDE;
          if (info.familyQuest) flamePts = CONFIG.FLAME.SOURCES.FAMILY_QUEST;
          const newLevel = applied.guardian.level;
          const oldLevel = newLevel - applied.levelsGained;
          CONFIG.FLAME.EVOLUTION_LEVELS.forEach(function (t) {
            if (oldLevel < t && newLevel >= t) flamePts += CONFIG.FLAME.SOURCES.EVOLUTION;
          });
          await bumpFamily(flamePts);

          txn.applied = true;
          await vput(c, 'rewardTransactions', txn);
          return {
            alreadyApplied: false, transaction: txn, guardian: applied.guardian,
            leveledUp: applied.leveledUp, levelsGained: applied.levelsGained, streak: streak,
          };
        });
      },
      listUnapplied: function () {
        return db.getAll('rewardTransactions').then(function (rows) {
          return rows.filter(function (t) { return t.applied === false; });
        });
      },
      listByUser: function (userId) { return db.byIndex('rewardTransactions', 'userId', userId); },
      getBySubmission: function (submissionId) {
        return db.byIndex('rewardTransactions', 'submissionId', submissionId).then(function (r) { return r[0] || null; });
      },
    };

    const AchievementRepo = {
      bulkSeed: function (defs) {
        return db.atomic(['achievements'], async function (c) {
          for (const a of defs) await vput(c, 'achievements', a);
        });
      },
      list: function () { return db.getAll('achievements'); },
    };

    const AchievementProgressRepo = {
      listByUser: function (userId) { return db.byIndex('achievementProgress', 'userId', userId); },
      upsert: function (userId, achievementId, progress, unlockedAt) {
        return db.atomic(['achievementProgress'], async function (c) {
          const existing = await c.byIndex('achievementProgress', 'user_achievement', [userId, achievementId]);
          const row = existing[0] || { id: Ids.uuid(), userId: userId, achievementId: achievementId, progress: 0 };
          row.progress = progress;
          if (unlockedAt !== undefined && row.unlockedAt === undefined) row.unlockedAt = unlockedAt;
          await vput(c, 'achievementProgress', row);
          return row;
        });
      },
    };

    const BuildingRepo = {
      listByUser: function (userId) { return db.byIndex('buildings', 'userId', userId); },
      ensureDefaults: function (userId) {
        return db.atomic(['buildings'], async function (c) {
          const existing = await c.byIndex('buildings', 'user_type', [userId, 'HOME']);
          if (existing.length) return existing[0];
          const row = { id: Ids.uuid(), userId: userId, type: 'HOME', level: 1 };
          await vput(c, 'buildings', row);
          return row;
        });
      },
      setLevel: function (userId, type, level) {
        return db.atomic(['buildings'], async function (c) {
          const existing = await c.byIndex('buildings', 'user_type', [userId, type]);
          const row = existing[0] || { id: Ids.uuid(), userId: userId, type: type, level: 0 };
          row.level = level;
          await vput(c, 'buildings', row);
          return row;
        });
      },
      // ONE atomic transaction: material spend + gold spend + building level +
      // (for SANCTUARY) the guardian's max-energy bump — all commit together or not at all.
      upgrade: function (userId, type) {
        V.oneOf(type, 'type', ENUMS.BUILDING_TYPE);
        return db.atomic(['buildings', 'guardians', 'inventory'], async function (c) {
          const def = CONFIG.BUILDINGS[type];
          const existing = await c.byIndex('buildings', 'user_type', [userId, type]);
          const b = existing[0] || { id: Ids.uuid(), userId: userId, type: type, level: 0 };
          if (b.level >= def.maxLevel) throw new ValidationError('MAX_LEVEL', def.name + ' is already at max level');
          const cost = Math.round(def.baseCost * Math.pow(CONFIG.ECONOMY.BUILDING_COST_GROWTH, b.level));
          const grows = await c.byIndex('guardians', 'userId', userId);
          const g = grows[0];
          if (!g) throw new ValidationError('NOT_FOUND', 'guardian for user ' + userId);
          // --- MATERIAL REQUIREMENT (GOTH 1.1): check the child has the needed materials ---
          const matReq = Building.materialCostFor(type, b.level); // [{itemId, qty}, ...]
          const shortages = [];
          for (var mi = 0; mi < matReq.length; mi++) {
            const need = matReq[mi];
            const invRows = await c.byIndex('inventory', 'user_item', [userId, need.itemId]);
            const have = invRows[0] ? invRows[0].qty : 0;
            if (have < need.qty) shortages.push({ itemId: need.itemId, need: need.qty, have: have });
          }
          if (shortages.length) {
            const e = new ValidationError('INSUFFICIENT_MATERIALS', def.name + ' needs more materials');
            e.shortages = shortages; e.cost = cost; e.materials = matReq;
            throw e;
          }
          // --- COIN REQUIREMENT (kept as secondary cost) ---
          if (g.gold < cost) {
            const e = new ValidationError('INSUFFICIENT_GOLD', 'needs ' + cost + ' gold, have ' + g.gold);
            e.cost = cost;
            throw e;
          }
          // --- CONSUME materials, then coins, then level up (all in this atomic txn) ---
          for (var mc = 0; mc < matReq.length; mc++) {
            const need2 = matReq[mc];
            const rows2 = await c.byIndex('inventory', 'user_item', [userId, need2.itemId]);
            const row2 = rows2[0];
            row2.qty -= need2.qty;
            if (row2.qty === 0) { await c.del('inventory', row2.id); }
            else { await vput(c, 'inventory', row2); }
          }
          g.gold -= cost;
          b.level += 1;
          if (type === 'SANCTUARY') {
            g.maxEnergy = CONFIG.ECONOMY.BASE_MAX_ENERGY + b.level * CONFIG.ECONOMY.SANCTUARY_ENERGY_PER_LEVEL;
          }
          await vput(c, 'guardians', g);
          await vput(c, 'buildings', b);
          return { building: b, guardian: g, cost: cost, materialsCost: matReq };
        });
      },
    };

    const DungeonRepo = {
      // DEV ONLY: fast-forward a run so it's immediately claimable (used by the dev menu).
      devSetEndsAt: function (runId, ts) {
        return db.atomic(['dungeonRuns'], async function (c) {
          const r = await c.get('dungeonRuns', runId);
          if (r) {
            // keep startedAt <= endsAt (validation requires it); pull startedAt back if needed
            const startedAt = Math.min(r.startedAt, ts - 1000);
            await c.put('dungeonRuns', Object.assign({}, r, { startedAt: startedAt, endsAt: ts }));
          }
        });
      },
      createRun: function (fields) {
        const run = {
          id: Ids.uuid(), guardianId: fields.guardianId, dungeonId: fields.dungeonId,
          seed: fields.seed, startedAt: fields.startedAt, endsAt: fields.endsAt, claimed: false,
        };
        return db.atomic(['dungeonRuns'], function (c) { return vput(c, 'dungeonRuns', run); }).then(function () { return run; });
      },
      // ONE atomic transaction: guardian gold/xp, inventory drops, the dungeon
      // counter, and the claimed flag flip together. Idempotent — claiming an
      // already-claimed run is a no-op, so retries and crashes are safe.
      claimRun: function (runId, result) {
        return db.atomic(['dungeonRuns', 'guardians', 'inventory', 'counters'], async function (c) {
          const run = await c.get('dungeonRuns', runId);
          if (!run) throw new ValidationError('NOT_FOUND', 'dungeonRun ' + runId);
          if (run.claimed) return { alreadyClaimed: true, run: run };
          const g = await c.get('guardians', run.guardianId);
          if (!g) throw new ValidationError('NOT_FOUND', 'guardian ' + run.guardianId);
          const lv = Leveling.applyXp(g, result.xp);
          g.xp = lv.xp; g.level = lv.level;
          g.gold = Math.min(CONFIG.LIMITS.MAX_GOLD, g.gold + result.gold);
          await vput(c, 'guardians', g);
          for (const d of result.drops) {
            const existing = await c.byIndex('inventory', 'user_item', [g.userId, d.itemId]);
            if (existing.length) {
              existing[0].qty = Math.min(CONFIG.LIMITS.MAX_QTY, existing[0].qty + d.qty);
              await vput(c, 'inventory', existing[0]);
            } else {
              await vput(c, 'inventory', { id: Ids.uuid(), userId: g.userId, itemId: d.itemId, qty: d.qty });
            }
          }
          const crows = await c.byIndex('counters', 'user_key', [g.userId, 'global.dungeons']);
          const counter = crows[0] || { id: Ids.uuid(), userId: g.userId, key: 'global.dungeons', value: 0 };
          counter.value += 1;
          await vput(c, 'counters', counter);
          run.claimed = true;
          run.result = { gold: result.gold, xp: result.xp, drops: result.drops };
          await vput(c, 'dungeonRuns', run);
          return { alreadyClaimed: false, run: run, guardian: g, leveledUp: lv.leveledUp, levelsGained: lv.levelsGained };
        });
      },
      listByGuardian: function (gid) { return db.byIndex('dungeonRuns', 'guardianId', gid); },
      get: function (id) { return db.get('dungeonRuns', id); },
    };

    const StreakRepo = {
      getOrCreate: function (userId, scope) {
        return db.atomic(['streaks'], async function (c) {
          const existing = await c.byIndex('streaks', 'user_scope', [userId, scope]);
          if (existing.length) return existing[0];
          const row = { id: Ids.uuid(), userId: userId, scope: scope, current: 0, best: 0 };
          await vput(c, 'streaks', row);
          return row;
        });
      },
      save: function (row) {
        return db.atomic(['streaks'], function (c) { return vput(c, 'streaks', row); }).then(function () { return row; });
      },
      listByUser: function (userId) { return db.byIndex('streaks', 'userId', userId); },
    };

    const CounterRepo = {
      increment: function (userId, key, by) {
        V.int(by, 'by', 1);
        return db.atomic(['counters'], async function (c) {
          const existing = await c.byIndex('counters', 'user_key', [userId, key]);
          const row = existing[0] || { id: Ids.uuid(), userId: userId, key: key, value: 0 };
          row.value += by;
          await vput(c, 'counters', row);
          return row;
        });
      },
      get: function (userId, key) {
        return db.byIndex('counters', 'user_key', [userId, key]).then(function (r) { return r[0] || null; });
      },
      setMax: function (userId, key, candidate) {
        return db.atomic(['counters'], async function (c) {
          const existing = await c.byIndex('counters', 'user_key', [userId, key]);
          const row = existing[0] || { id: Ids.uuid(), userId: userId, key: key, value: 0 };
          row.value = Math.max(row.value, candidate);
          await vput(c, 'counters', row);
          return row;
        });
      },
      listByUser: function (userId) { return db.byIndex('counters', 'userId', userId); },
    };

    const AuditRepo = {
      // Append-only by construction: no update or delete methods exist.
      // The entry's prevHash must equal the live chain head — checked inside
      // the same transaction that advances the head, so forks cannot form.
      append: function (entry) {
        // Shape validation first (precise errors for malformed entries), then
        // the head check inside the transaction guards against forks.
        Validation.validateForStore('auditLogs', entry);
        return db.atomic(['auditLogs', 'meta'], async function (c) {
          const headRow = await c.get('meta', 'auditHead');
          const head = headRow ? headRow.value : CONFIG.SECURITY.AUDIT_GENESIS;
          if (entry.prevHash !== head) {
            throw new ValidationError('CHAIN_CONFLICT', 'prevHash does not match the current audit head');
          }
          await vput(c, 'auditLogs', entry);
          await vput(c, 'meta', { key: 'auditHead', value: entry.hash });
          return entry;
        });
      },
      list: function () { return db.getAll('auditLogs'); },
    };

    const MetaRepo = {
      get: function (key) { return db.get('meta', key).then(function (r) { return r ? r.value : undefined; }); },
      set: function (key, value) {
        return db.atomic(['meta'], function (c) { return vput(c, 'meta', { key: key, value: value }); });
      },
    };

    return {
      users: UserRepo, credentials: CredentialRepo, guardians: GuardianRepo,
      items: ItemRepo, inventory: InventoryRepo, quests: QuestRepo,
      submissions: SubmissionRepo, rewardTransactions: RewardTransactionRepo,
      achievements: AchievementRepo, achievementProgress: AchievementProgressRepo,
      buildings: BuildingRepo, dungeons: DungeonRepo, streaks: StreakRepo,
      counters: CounterRepo, audit: AuditRepo, meta: MetaRepo,
    };
  }

  /* ==========================================================================
     05_SERVICES (Phase 2 scope) — SeedService + BackupService.
     Auth / Approval / Quest / Dungeon services arrive in Phases 3–4.
     ========================================================================== */
  function makeSeedService(db, repos) {
    return {
      seedIfEmpty: async function () {
        const seeded = await repos.meta.get('seeded');
        if (seeded) return { seeded: false };
        const quests = CONFIG.QUESTS.map(function (q) {
          return {
            id: q.id, title: q.title, category: q.category,
            reward: questRewardBundle(q),
            maxPerDay: q.maxPerDay !== undefined ? q.maxPerDay : CONFIG.MAX_PER_DAY_DEFAULTS[q.category],
            active: true, icon: q.icon,
          };
        });
        await repos.items.bulkSeed(CONFIG.ITEMS);
        await repos.quests.bulkSeed(quests);
        await repos.achievements.bulkSeed(CONFIG.ACHIEVEMENTS);
        await repos.meta.set('schemaVersion', SCHEMA.version);
        await repos.meta.set('installId', Ids.uuid());
        await repos.meta.set('auditHead', CONFIG.SECURITY.AUDIT_GENESIS);
        await repos.meta.set('seeded', true);
        return { seeded: true, items: CONFIG.ITEMS.length, quests: quests.length, achievements: CONFIG.ACHIEVEMENTS.length };
      },
    };
  }

  function makeBackupService(db) {
    const FORMAT = 'goth-backup';
    return {
      export: async function () {
        const data = {};
        for (const s of STORE_NAMES) data[s] = await db.getAll(s);
        const checksum = await sha256Hex(Canon.stringify(data));
        return { format: FORMAT, version: 1, exportedAt: Date.now(), checksum: checksum, data: data };
      },
      // Full-replace import. Validates format, checksum, and EVERY record
      // through the validation layer before any write happens.
      importReplace: async function (backup) {
        if (!backup || backup.format !== FORMAT) throw new ValidationError('BAD_BACKUP', 'unrecognized backup format');
        if (backup.version !== 1) throw new ValidationError('BAD_BACKUP', 'unsupported backup version');
        if (!backup.data || typeof backup.data !== 'object') throw new ValidationError('BAD_BACKUP', 'missing data');
        const checksum = await sha256Hex(Canon.stringify(backup.data));
        if (checksum !== backup.checksum) throw new ValidationError('CHECKSUM_MISMATCH', 'backup is corrupted or was modified');
        const counts = {};
        for (const s of STORE_NAMES) {
          const rows = backup.data[s] || [];
          rows.forEach(function (r) { Validation.validateForStore(s, r); });
          counts[s] = rows.length;
        }
        await db.atomic(STORE_NAMES, async function (c) {
          for (const s of STORE_NAMES) {
            await c.clear(s);
            const rows = backup.data[s] || [];
            for (const r of rows) await c.put(s, r);
          }
        });
        return counts;
      },
    };
  }

  /* --------------------------------------------------------------------------
     AuthService — parent PIN security.
     PBKDF2-SHA256, 310k iterations, 16-byte random salt. The PIN itself is
     never stored or logged. Lockout state persists in the credentials row so
     a page reload cannot reset it. Parent sessions live in memory only with a
     sliding 5-minute inactivity timeout — closing the app kills them.
     -------------------------------------------------------------------------- */
  function makeAuthService(repos, opts) {
    const now = (opts && opts.now) || function () { return Date.now(); };
    const sessions = new Map(); // token -> { token, parentId, expiresAt }
    const PIN_RE = /^\d{4,12}$/;

    function cryptoObj() { return (root.crypto && root.crypto.subtle) ? root.crypto : globalThis.crypto; }

    async function derive(pin, saltHex, iterations) {
      const key = await cryptoObj().subtle.importKey(
        'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await cryptoObj().subtle.deriveBits(
        { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iterations, hash: 'SHA-256' }, key, 256);
      return bytesToHex(new Uint8Array(bits));
    }

    function constantTimeEqual(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return diff === 0;
    }

    function assertPinPolicy(pin) {
      if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
        throw new ValidationError('BAD_PIN', 'PIN must be 4-12 digits');
      }
    }

    // Core check: throws LOCKED_OUT / WRONG_PIN / NO_CREDENTIALS; returns the
    // user id on success. Used by both verifyPin (opens session) and changePin.
    async function checkPin(userId, pin) {
      assertPinPolicy(pin);
      const cred = await repos.credentials.getByUser(userId);
      if (!cred) throw new ValidationError('NO_CREDENTIALS', 'no PIN configured for this user');
      const t = now();
      if (cred.lockoutUntil !== undefined && t < cred.lockoutUntil) {
        const e = new ValidationError('LOCKED_OUT', 'too many attempts — try again later');
        e.retryInMs = cred.lockoutUntil - t;
        throw e;
      }
      const hash = await derive(pin, cred.salt, cred.iterations);
      if (constantTimeEqual(hash, cred.pinHash)) {
        await repos.credentials.recordAuthState(userId, { failedAttempts: 0, lockoutUntil: 0, lockoutCount: 0 });
        return userId;
      }
      const failed = (cred.failedAttempts || 0) + 1;
      if (failed >= CONFIG.SECURITY.MAX_PIN_ATTEMPTS) {
        const lockoutCount = (cred.lockoutCount || 0) + 1;
        const lockoutMs = CONFIG.SECURITY.LOCKOUT_BASE_MS * Math.pow(2, lockoutCount - 1);
        await repos.credentials.recordAuthState(userId, { failedAttempts: 0, lockoutCount: lockoutCount, lockoutUntil: t + lockoutMs });
        const e = new ValidationError('LOCKED_OUT', 'too many attempts — locked for ' + Math.round(lockoutMs / 1000) + 's');
        e.retryInMs = lockoutMs;
        throw e;
      }
      await repos.credentials.recordAuthState(userId, { failedAttempts: failed });
      const e = new ValidationError('WRONG_PIN', 'incorrect PIN');
      e.attemptsLeft = CONFIG.SECURITY.MAX_PIN_ATTEMPTS - failed;
      throw e;
    }

    return {
      setupPin: async function (parentUserId, pin) {
        assertPinPolicy(pin);
        const user = await repos.users.get(parentUserId);
        if (!user) throw new ValidationError('NOT_FOUND', 'user ' + parentUserId);
        if (user.role !== 'PARENT') throw new ValidationError('FORBIDDEN', 'only PARENT users can hold a PIN');
        const saltBytes = new Uint8Array(CONFIG.SECURITY.SALT_BYTES);
        cryptoObj().getRandomValues(saltBytes);
        const salt = bytesToHex(saltBytes);
        const pinHash = await derive(pin, salt, CONFIG.SECURITY.PBKDF2_ITERATIONS);
        return repos.credentials.setForUser(parentUserId, {
          pinHash: pinHash, salt: salt,
          iterations: CONFIG.SECURITY.PBKDF2_ITERATIONS, algo: CONFIG.SECURITY.ALGO,
          failedAttempts: 0, lockoutUntil: 0, lockoutCount: 0,
        });
      },
      // Verifies the PIN and opens a parent session on success.
      verifyPin: async function (userId, pin) {
        await checkPin(userId, pin);
        const session = { token: Ids.uuid(), parentId: userId, expiresAt: now() + CONFIG.SECURITY.PARENT_SESSION_MS };
        sessions.set(session.token, session);
        return Object.assign({}, session);
      },
      // Asserts a live parent session; sliding expiry — each use extends it.
      requireSession: function (token) {
        const s = sessions.get(token);
        if (!s) throw new ValidationError('SESSION_INVALID', 'no parent session — unlock with your PIN');
        if (now() > s.expiresAt) {
          sessions.delete(token);
          throw new ValidationError('SESSION_EXPIRED', 'parent session timed out — unlock again');
        }
        s.expiresAt = now() + CONFIG.SECURITY.PARENT_SESSION_MS;
        return Object.assign({}, s);
      },
      getSession: function (token) {
        const s = sessions.get(token);
        if (!s || now() > s.expiresAt) return null;
        return Object.assign({}, s);
      },
      endSession: function (token) { sessions.delete(token); },
      endAllSessions: function () { sessions.clear(); },
      changePin: async function (userId, oldPin, newPin) {
        await checkPin(userId, oldPin);
        return this.setupPin(userId, newPin);
      },
    };
  }

  /* --------------------------------------------------------------------------
     AuditService — writes the tamper-evident chain.
     hash = SHA-256(prevHash + canonicalJSON(entry-without-hash)), head tracked
     in meta.auditHead. Appends are serialized through a queue so two writes
     can never race the head; AuditRepo re-checks the head transactionally.
     -------------------------------------------------------------------------- */
  function makeAuditService(repos) {
    let queue = Promise.resolve();
    return {
      append: function (fields) {
        const job = queue.then(async function () {
          const head = (await repos.meta.get('auditHead')) || CONFIG.SECURITY.AUDIT_GENESIS;
          const body = {
            id: Ids.uuid(), parentId: fields.parentId, action: fields.action,
            entity: fields.entity, entityId: fields.entityId,
            timestamp: Date.now(), prevHash: head,
          };
          if (fields.reason !== undefined) body.reason = fields.reason;
          const hash = await sha256Hex(head + Canon.stringify(body));
          return repos.audit.append(Object.assign({}, body, { hash: hash }));
        });
        queue = job.catch(function () { /* keep the queue alive after a failure */ });
        return job;
      },
    };
  }

  /* --------------------------------------------------------------------------
     IntegrityService — walks the audit chain from GENESIS, recomputing every
     hash and following the links. Any edited, removed, reordered, or forked
     entry breaks verification. Runs at boot and on parent-dashboard open.
     -------------------------------------------------------------------------- */
  function makeIntegrityService(repos) {
    return {
      verifyChain: async function () {
        const entries = await repos.audit.list();
        const head = (await repos.meta.get('auditHead')) || CONFIG.SECURITY.AUDIT_GENESIS;
        const byPrev = new Map();
        for (const e of entries) {
          if (byPrev.has(e.prevHash)) {
            return { valid: false, reason: 'FORKED_CHAIN', length: entries.length, verified: 0, head: head };
          }
          byPrev.set(e.prevHash, e);
        }
        let cursor = CONFIG.SECURITY.AUDIT_GENESIS;
        let verified = 0;
        while (byPrev.has(cursor)) {
          const e = byPrev.get(cursor);
          const body = {};
          Object.keys(e).forEach(function (k) { if (k !== 'hash') body[k] = e[k]; });
          const expected = await sha256Hex(e.prevHash + Canon.stringify(body));
          if (expected !== e.hash) {
            return { valid: false, reason: 'TAMPERED_ENTRY', length: entries.length, verified: verified, head: head };
          }
          cursor = e.hash;
          verified++;
        }
        if (verified !== entries.length) {
          return { valid: false, reason: 'ORPHANED_ENTRIES', length: entries.length, verified: verified, head: head };
        }
        if (cursor !== head) {
          return { valid: false, reason: 'HEAD_MISMATCH', length: entries.length, verified: verified, head: head };
        }
        return { valid: true, length: entries.length, verified: verified, head: head };
      },
    };
  }

  /* --------------------------------------------------------------------------
     RewardApprovalService — THE single gate. The only code path in the entire
     application through which quest rewards reach a child. Every call asserts
     a live parent session; every decision is audit-chained; reward release is
     idempotent and crash-recoverable via the applied flag.
     -------------------------------------------------------------------------- */
  function makeApprovalService(repos, auth, audit) {
    async function loadDecisionContext(submissionId) {
      const sub = await repos.submissions.get(submissionId);
      if (!sub) throw new ValidationError('NOT_FOUND', 'submission ' + submissionId);
      const quest = await repos.quests.get(sub.questId);
      if (!quest) throw new ValidationError('NOT_FOUND', 'quest ' + sub.questId);
      return { sub: sub, quest: quest };
    }
    return {
      approve: async function (token, submissionId, note) {
        const session = auth.requireSession(token);
        const ctx = await loadDecisionContext(submissionId);
        const guardian = await repos.guardians.getByUser(ctx.sub.userId);
        if (!guardian) throw new ValidationError('NOT_FOUND', 'guardian for user ' + ctx.sub.userId);
        const decided = await repos.submissions.decide(submissionId, {
          status: 'APPROVED', decidedBy: session.parentId, note: note,
        });
        const txn = await repos.rewardTransactions.createForSubmission(decided, ctx.quest.reward);
        const released = await repos.rewardTransactions.applyTransaction(txn.id, {
          category: ctx.quest.category, dayStr: TimeUtil.todayStr(),
        });
        await audit.append({
          parentId: session.parentId, action: 'SUBMISSION_APPROVED',
          entity: 'submissions', entityId: submissionId, reason: note,
        });
        return {
          submission: decided, transaction: released.transaction,
          guardian: released.guardian, leveledUp: released.leveledUp,
          levelsGained: released.levelsGained, streak: released.streak,
        };
      },
      reject: async function (token, submissionId, note) {
        const session = auth.requireSession(token);
        await loadDecisionContext(submissionId);
        const decided = await repos.submissions.decide(submissionId, {
          status: 'REJECTED', decidedBy: session.parentId, note: note,
        });
        await audit.append({
          parentId: session.parentId, action: 'SUBMISSION_REJECTED',
          entity: 'submissions', entityId: submissionId, reason: note,
        });
        return { submission: decided };
      },
      // Crash recovery: completes any approval interrupted between its steps.
      // Safe to run at every boot — fully idempotent.
      recoverUnfinished: async function () {
        let recovered = 0;
        const approved = await repos.submissions.listByStatus('APPROVED');
        for (const sub of approved) {
          const existing = await repos.rewardTransactions.getBySubmission(sub.id);
          if (!existing) {
            const quest = await repos.quests.get(sub.questId);
            if (!quest) continue;
            await repos.rewardTransactions.createForSubmission(sub, quest.reward);
          }
        }
        const unapplied = await repos.rewardTransactions.listUnapplied();
        for (const txn of unapplied) {
          const sub = await repos.submissions.get(txn.submissionId);
          if (!sub) continue;
          const quest = await repos.quests.get(sub.questId);
          if (!quest) continue;
          const res = await repos.rewardTransactions.applyTransaction(txn.id, {
            category: quest.category, dayStr: TimeUtil.todayStr(),
          });
          if (!res.alreadyApplied) {
            recovered++;
            await audit.append({
              parentId: sub.decidedBy, action: 'REWARD_RECOVERED',
              entity: 'rewardTransactions', entityId: txn.id,
            });
          }
        }
        return { recovered: recovered };
      },
    };
  }

  /* --------------------------------------------------------------------------
     Phase 4 — Game services. All game rules live here against the repos;
     no UI, no direct DB access. Dungeon timing takes an injectable clock.
     -------------------------------------------------------------------------- */
  function makeQuestService(repos) {
    return {
      // Quest board for a child: each active quest with today's usage.
      listForChild: async function (userId, now) {
        const quests = await repos.quests.listActive();
        const out = [];
        for (const q of quests) {
          const used = await repos.submissions.countTodayNonRejected(userId, q.id, now);
          out.push({ quest: q, usedToday: used, remainingToday: Math.max(0, q.maxPerDay - used) });
        }
        return out;
      },
      // The ONLY kid-facing entry point for quest completion. Creates a
      // PENDING submission; rewards exist only after a parent approves.
      submit: async function (userId, questId, now) {
        const quest = await repos.quests.get(questId);
        if (!quest) throw new ValidationError('NOT_FOUND', 'quest ' + questId);
        const used = await repos.submissions.countTodayNonRejected(userId, questId, now);
        const check = canSubmitQuest(quest, used);
        if (!check.ok) {
          const msg = check.reason === 'MAX_PER_DAY_REACHED'
            ? quest.title + ' — daily limit reached (' + quest.maxPerDay + '/day)'
            : quest.title + ' is not active right now';
          throw new ValidationError(check.reason, msg);
        }
        return repos.submissions.createPending(userId, questId);
      },
    };
  }

  function makeDungeonService(repos, opts) {
    const now = (opts && opts.now) || function () { return Date.now(); };
    function defOf(dungeonId) {
      const def = CONFIG.DUNGEONS.find(function (d) { return d.id === dungeonId; });
      if (!def) throw new ValidationError('NOT_FOUND', 'dungeon ' + dungeonId);
      return def;
    }
    return {
      listForGuardian: async function (guardianId) {
        const g = await repos.guardians.get(guardianId);
        if (!g) throw new ValidationError('NOT_FOUND', 'guardian ' + guardianId);
        const runs = await repos.dungeons.listByGuardian(guardianId);
        const activeRun = runs.find(function (r) { return !r.claimed; }) || null;
        return {
          now: now(),
          activeRun: activeRun,
          dungeons: CONFIG.DUNGEONS.map(function (d) {
            return {
              def: d,
              unlocked: g.level >= d.unlockLevel,
              energyCost: CONFIG.ECONOMY.DUNGEON_ENERGY[d.tier],
            };
          }),
        };
      },
      // Starts an expedition: level gate, one-at-a-time, energy paid up front.
      // (If the app dies between the energy spend and run creation, the energy
      // is lost rather than a free run granted — the safer failure for a game
      // whose currency is parent-approved effort.)
      start: async function (guardianId, dungeonId) {
        const g = await repos.guardians.get(guardianId);
        if (!g) throw new ValidationError('NOT_FOUND', 'guardian ' + guardianId);
        const def = defOf(dungeonId);
        if (g.level < def.unlockLevel) {
          throw new ValidationError('DUNGEON_LOCKED', def.name + ' unlocks at level ' + def.unlockLevel);
        }
        const runs = await repos.dungeons.listByGuardian(guardianId);
        if (runs.some(function (r) { return !r.claimed; })) {
          throw new ValidationError('RUN_IN_PROGRESS', 'finish and claim the current expedition first');
        }
        const energyCost = CONFIG.ECONOMY.DUNGEON_ENERGY[def.tier];
        await repos.guardians.spendEnergy(guardianId, energyCost);
        const startedAt = now();
        const run = await repos.dungeons.createRun({
          guardianId: guardianId, dungeonId: dungeonId,
          seed: RNG.seedFromString(guardianId + '|' + dungeonId + '|' + startedAt),
          startedAt: startedAt, endsAt: startedAt + def.durationMin * 60000,
        });
        return { run: run, energyCost: energyCost };
      },
      claim: async function (runId) {
        const run = await repos.dungeons.get(runId);
        if (!run) throw new ValidationError('NOT_FOUND', 'dungeonRun ' + runId);
        if (run.claimed) throw new ValidationError('ALREADY_CLAIMED', 'rewards already collected for this expedition');
        if (now() < run.endsAt) {
          const e = new ValidationError('RUN_NOT_FINISHED', 'the expedition is still underway');
          e.remainingMs = run.endsAt - now();
          throw e;
        }
        const def = defOf(run.dungeonId);
        const result = Loot.resolveDungeon(run, def, CONFIG.ITEMS);
        return repos.dungeons.claimRun(runId, result);
      },
    };
  }

  function makeLootService(repos) {
    return {
      crateCount: async function (userId) {
        const inv = await repos.inventory.listByUser(userId);
        const row = inv.find(function (i) { return i.itemId === 'itm_loot_crate'; });
        return row ? row.qty : 0;
      },
      // Deterministic when given a seed string (used by tests); random otherwise.
      openCrate: async function (userId, seedStr) {
        const rand = RNG.mulberry32(RNG.seedFromString(seedStr || Ids.uuid()));
        const pool = CONFIG.ITEMS.filter(function (i) { return i.id !== 'itm_loot_crate'; });
        let rarity = Loot.rollRarity(rand);
        let item = Loot.pickItemOfRarity(rand, rarity, pool);
        if (!item) { item = pool[0]; rarity = item.rarity; }
        await repos.inventory.consumeAndGrant(userId, 'itm_loot_crate', item.id, 1);
        return { item: item, rarity: rarity };
      },
    };
  }

  function makeBuildingService(repos) {
    function costFor(type, currentLevel) {
      const def = CONFIG.BUILDINGS[type];
      return Math.round(def.baseCost * Math.pow(CONFIG.ECONOMY.BUILDING_COST_GROWTH, currentLevel));
    }
    return {
      costFor: costFor,
      overview: async function (userId) {
        const rows = await repos.buildings.listByUser(userId);
        const byType = {};
        rows.forEach(function (r) { byType[r.type] = r; });
        return ENUMS.BUILDING_TYPE.map(function (t) {
          const def = CONFIG.BUILDINGS[t];
          const level = byType[t] ? byType[t].level : 0;
          return {
            type: t, name: def.name, level: level, maxLevel: def.maxLevel,
            nextCost: level >= def.maxLevel ? null : costFor(t, level),
            nextMaterials: level >= def.maxLevel ? null : Building.materialCostFor(t, level),
          };
        });
      },
      upgrade: function (userId, type) { return repos.buildings.upgrade(userId, type); },
    };
  }

  function makeAchievementService(repos) {
    return {
      // Reads counters, updates progress rows, unlocks exactly once.
      evaluate: async function (userId) {
        const defs = await repos.achievements.list();
        const counters = await repos.counters.listByUser(userId);
        const cmap = {};
        counters.forEach(function (c) { cmap[c.key] = c.value; });
        const progress = await repos.achievementProgress.listByUser(userId);
        const pmap = {};
        progress.forEach(function (p) { pmap[p.achievementId] = p; });
        const newlyUnlocked = [];
        for (const def of defs) {
          const value = cmap[def.condition.counterKey] || 0;
          const capped = Math.min(value, def.condition.target);
          const prev = pmap[def.id];
          const unlocked = value >= def.condition.target;
          const alreadyUnlocked = prev && prev.unlockedAt !== undefined;
          if (prev && prev.progress === capped && (!unlocked || alreadyUnlocked)) continue;
          await repos.achievementProgress.upsert(userId, def.id, capped, unlocked ? Date.now() : undefined);
          if (unlocked && !alreadyUnlocked) newlyUnlocked.push(def);
        }
        for (let i = 0; i < newlyUnlocked.length; i++) {
          await repos.counters.increment(CONFIG.FLAME.FAMILY_ID, CONFIG.FLAME.KEY, CONFIG.FLAME.SOURCES.ACHIEVEMENT);
        }
        return { newlyUnlocked: newlyUnlocked };
      },
      listForUser: async function (userId) {
        const defs = await repos.achievements.list();
        const progress = await repos.achievementProgress.listByUser(userId);
        const pmap = {};
        progress.forEach(function (p) { pmap[p.achievementId] = p; });
        return defs.map(function (d) {
          const p = pmap[d.id];
          return {
            def: d, target: d.condition.target,
            progress: p ? p.progress : 0,
            unlockedAt: p ? p.unlockedAt : undefined,
          };
        });
      },
    };
  }

  function makeServices(db, repos, opts) {
    const auth = makeAuthService(repos, opts);
    const audit = makeAuditService(repos);
    return {
      seed: makeSeedService(db, repos),
      backup: makeBackupService(db),
      auth: auth,
      audit: audit,
      integrity: makeIntegrityService(repos),
      approval: makeApprovalService(repos, auth, audit),
      quest: makeQuestService(repos),
      dungeon: makeDungeonService(repos, opts),
      loot: makeLootService(repos),
      building: makeBuildingService(repos),
      achievement: makeAchievementService(repos),
    };
  }

  /* ==========================================================================
     06_STATE — Phase 5. One state tree, typed actions, a pure reducer, async
     thunks that call services, and selectors. The UI (Phase 6) may only
     dispatch actions and read state through selectors — nothing else.
     ========================================================================== */
  const T = Object.freeze({
    BOOTING: 'app/booting', BOOTED: 'app/booted', BOOT_FAILED: 'app/bootFailed',
    TICK: 'app/tick',
    USERS_LOADED: 'users/loaded', ITEMS_LOADED: 'items/loaded',
    PIN_STATUS: 'session/pinStatus',
    PARENT_LOADED: 'parent/overviewLoaded',
    CHILD_SELECTED: 'child/selected', CHILD_HYDRATED: 'child/hydrated',
    SESSION_OPENED: 'session/opened', SESSION_REFRESHED: 'session/refreshed',
    SESSION_CLOSED: 'session/closed',
    CHAIN_VERIFIED: 'chain/verified',
    GATE_REVEALED: 'ui/gateRevealed', GATE_HIDDEN: 'ui/gateHidden',
    TOAST_SHOW: 'ui/toastShow', TOAST_CLEAR: 'ui/toastClear',
    CELEBRATION_SHOW: 'ui/celebrationShow', CELEBRATION_CLEAR: 'ui/celebrationClear',
  });

  function initialState(now) {
    return {
      boot: 'LOADING', bootInfo: null, now: now || Date.now(),
      mode: 'CHILD_MODE', session: null, parentHasPin: false,
      parentQueue: [], family: [],
      flame: 0,
      users: [], activeChildId: null, itemsById: {},
      guardian: null, questBoard: [], pending: [],
      inventory: [], crates: 0,
      dungeon: { list: [], activeRun: null },
      buildings: [], achievements: [], streaks: [],
      chain: null,
      ui: { gateRevealed: false, toast: null, gateToast: null, celebration: null },
    };
  }

  function emptyBundle() {
    return {
      guardian: null, questBoard: [], pending: [], inventory: [], crates: 0,
      dungeon: { list: [], activeRun: null }, buildings: [], achievements: [], streaks: [],
      flame: 0,
    };
  }

  function reduce(state, action) {
    switch (action.type) {
      case T.BOOTING: return Object.assign({}, state, { boot: 'LOADING' });
      case T.BOOTED: return Object.assign({}, state, { boot: 'READY', bootInfo: action.info });
      case T.BOOT_FAILED: return Object.assign({}, state, { boot: 'ERROR', bootInfo: { error: action.error } });
      case T.TICK: {
        const next = Object.assign({}, state, { now: action.now });
        if (state.session && action.now > state.session.expiresAt) {
          next.session = null;
          next.mode = 'CHILD_MODE';
          next.ui = Object.assign({}, state.ui, { gateToast: { kind: 'bad', text: 'Parent session timed out. Unlock again.' } });
        }
        return next;
      }
      case T.USERS_LOADED: return Object.assign({}, state, { users: action.users });
      case T.ITEMS_LOADED: return Object.assign({}, state, { itemsById: action.itemsById });
      case T.PIN_STATUS: return Object.assign({}, state, { parentHasPin: !!action.hasPin });
      case T.PARENT_LOADED: return Object.assign({}, state, { parentQueue: action.queue, family: action.family });
      case T.CHILD_SELECTED: return Object.assign({}, state, { activeChildId: action.childId });
      case T.CHILD_HYDRATED: {
        const b = action.bundle || emptyBundle();
        return Object.assign({}, state, {
          guardian: b.guardian, questBoard: b.questBoard, pending: b.pending,
          flame: b.flame || 0,
          inventory: b.inventory, crates: b.crates, dungeon: b.dungeon,
          buildings: b.buildings, achievements: b.achievements, streaks: b.streaks,
        });
      }
      case T.SESSION_OPENED: return Object.assign({}, state, { session: action.session, mode: 'PARENT_MODE' });
      case T.SESSION_REFRESHED: return Object.assign({}, state, { session: action.session });
      case T.SESSION_CLOSED: {
        const ui = action.reason === 'EXPIRED'
          ? Object.assign({}, state.ui, { gateToast: { kind: 'bad', text: 'Parent session ended — unlock again.' } })
          : state.ui;
        return Object.assign({}, state, { session: null, mode: 'CHILD_MODE', ui: ui });
      }
      case T.CHAIN_VERIFIED: return Object.assign({}, state, { chain: action.chain });
      case T.GATE_REVEALED: return Object.assign({}, state, { ui: Object.assign({}, state.ui, { gateRevealed: true }) });
      case T.GATE_HIDDEN: return Object.assign({}, state, { ui: Object.assign({}, state.ui, { gateRevealed: false }) });
      case T.TOAST_SHOW: {
        const patch = action.scope === 'gate'
          ? { gateToast: { kind: action.kind, text: action.text } }
          : { toast: { kind: action.kind, text: action.text } };
        return Object.assign({}, state, { ui: Object.assign({}, state.ui, patch) });
      }
      case T.TOAST_CLEAR: {
        const patch = action.scope === 'gate' ? { gateToast: null } : { toast: null };
        return Object.assign({}, state, { ui: Object.assign({}, state.ui, patch) });
      }
      case T.CELEBRATION_SHOW: return Object.assign({}, state, { ui: Object.assign({}, state.ui, { celebration: action.celebration }) });
      case T.CELEBRATION_CLEAR: return Object.assign({}, state, { ui: Object.assign({}, state.ui, { celebration: null }) });
      default: return state;
    }
  }

  /* ---- thunk helpers ---- */
  function toastOk(dispatch, scope, text) {
    dispatch({ type: T.TOAST_SHOW, scope: scope, kind: 'ok', text: text });
  }
  function failToast(dispatch, scope, e) {
    const code = (e && e.code) || 'ERROR';
    let text = (e && e.message) || String(e);
    if (code === 'WRONG_PIN' && e.attemptsLeft !== undefined) {
      text = 'Incorrect PIN. ' + e.attemptsLeft + ' attempt' + (e.attemptsLeft === 1 ? '' : 's') + ' left before lockout.';
    }
    if (code === 'LOCKED_OUT') {
      text = 'Locked out. Try again in ' + Math.ceil((e.retryInMs || 0) / 1000) + 's.';
    }
    dispatch({ type: T.TOAST_SHOW, scope: scope, kind: 'bad', text: text });
    return { ok: false, code: code, message: text };
  }
  function requireStoreSession(dispatch, getState) {
    const s = getState().session;
    if (!s) {
      failToast(dispatch, 'gate', { code: 'SESSION_REQUIRED', message: 'Unlock parent mode first.' });
      return null;
    }
    return s;
  }
  function touchSession(dispatch, ctx, token) {
    const fresh = ctx.services.auth.getSession(token);
    if (fresh) dispatch({ type: T.SESSION_REFRESHED, session: fresh });
    else dispatch({ type: T.SESSION_CLOSED, reason: 'EXPIRED' });
  }
  async function loadUsers(ctx) {
    const kids = await ctx.repos.users.listByRole('CHILD');
    const parents = await ctx.repos.users.listByRole('PARENT');
    return kids.concat(parents);
  }
  async function loadBundle(ctx, childId) {
    const bundle = emptyBundle();
    const guardian = await ctx.repos.guardians.getByUser(childId);
    bundle.guardian = guardian || null;
    bundle.questBoard = await ctx.services.quest.listForChild(childId);
    bundle.pending = (await ctx.repos.submissions.listByUserAndStatus(childId, 'PENDING'))
      .sort(function (a, b) { return a.submittedAt - b.submittedAt; });
    bundle.inventory = await ctx.repos.inventory.listByUser(childId);
    bundle.crates = await ctx.services.loot.crateCount(childId);
    bundle.buildings = await ctx.services.building.overview(childId);
    bundle.achievements = await ctx.services.achievement.listForUser(childId);
    bundle.streaks = await ctx.repos.streaks.listByUser(childId);
    const flameRow = await ctx.repos.counters.get(CONFIG.FLAME.FAMILY_ID, CONFIG.FLAME.KEY);
    bundle.flame = flameRow ? flameRow.value : 0;
    if (guardian) {
      const dz = await ctx.services.dungeon.listForGuardian(guardian.id);
      bundle.dungeon = { list: dz.dungeons, activeRun: dz.activeRun };
    }
    return bundle;
  }

  const Actions = {
    /* plain creators */
    tick: function (now) { return { type: T.TICK, now: now }; },
    revealGate: function () { return { type: T.GATE_REVEALED }; },
    hideGate: function () { return { type: T.GATE_HIDDEN }; },
    clearToast: function (scope) { return { type: T.TOAST_CLEAR, scope: scope }; },
    clearCelebration: function () { return { type: T.CELEBRATION_CLEAR }; },

    /* boot & hydration */
    boot: function () {
      return async function (dispatch, getState, ctx) {
        dispatch({ type: T.BOOTING });
        try {
          const seed = await ctx.services.seed.seedIfEmpty();
          const recovery = await ctx.services.approval.recoverUnfinished();
          const chain = await ctx.services.integrity.verifyChain();
          dispatch({ type: T.CHAIN_VERIFIED, chain: chain });
          const items = await ctx.repos.items.list();
          const itemsById = {};
          items.forEach(function (i) { itemsById[i.id] = i; });
          dispatch({ type: T.ITEMS_LOADED, itemsById: itemsById });
          const users = await loadUsers(ctx);
          dispatch({ type: T.USERS_LOADED, users: users });
          const parent = users.find(function (u) { return u.role === 'PARENT'; });
          const cred = parent ? await ctx.repos.credentials.getByUser(parent.id) : null;
          dispatch({ type: T.PIN_STATUS, hasPin: !!cred });
          await healTimeTravel(ctx);
          const savedId = await ctx.repos.meta.get('app.activeChildId');
          let child = savedId ? users.find(function (u) { return u.id === savedId && u.role === 'CHILD'; }) : null;
          if (!child) {
            // Adopt an orphaned child (e.g. data created before the store era)
            // so the hearth never boots into an empty, unpickable state.
            child = users.find(function (u) { return u.role === 'CHILD'; }) || null;
            if (child) await ctx.repos.meta.set('app.activeChildId', child.id);
          }
          dispatch({ type: T.CHILD_SELECTED, childId: child ? child.id : null });
          dispatch({ type: T.CHILD_HYDRATED, bundle: child ? await loadBundle(ctx, child.id) : null });
          dispatch({ type: T.BOOTED, info: { seed: seed, recovery: recovery } });
          return { ok: true, seed: seed, recovery: recovery, chain: chain };
        } catch (e) {
          dispatch({ type: T.BOOT_FAILED, error: (e && e.message) || String(e) });
          return { ok: false, code: (e && e.code) || 'BOOT_ERROR', message: (e && e.message) || String(e) };
        }
      };
    },
    refreshChild: function () {
      return async function (dispatch, getState, ctx) {
        const id = getState().activeChildId;
        dispatch({ type: T.CHILD_HYDRATED, bundle: id ? await loadBundle(ctx, id) : null });
        return { ok: true };
      };
    },

    /* children */
    createChild: function (name, avatar, guardianName, species) {
      return async function (dispatch, getState, ctx) {
        try {
          const child = await ctx.repos.users.create({ role: 'CHILD', name: name, avatar: avatar || '🧒' });
          await ctx.repos.guardians.createForUser(child.id, { name: guardianName, species: species }, { starter: !STARTER_DISABLED });
          // Welcome gift: starter crates + materials so a new keeper can play right away.
          // (Energy + gold are granted at guardian creation.) Uses the real reward pipeline.
          try {
            const sg = STARTER_DISABLED ? null : CONFIG.ECONOMY.STARTER_GRANT;
            if (sg && (sg.lootCrates || (sg.materials && sg.materials.length))) {
              await ctx.repos.guardians.applyBundle(child.id, {
                coins: 0, energy: 0, xp: 0, affection: 0,
                materials: sg.materials || [], lootCrates: sg.lootCrates || 0,
              });
            }
          } catch (e) { /* starter gift is best-effort; never block child creation */ }
          await ctx.repos.meta.set('app.activeChildId', child.id);
          dispatch({ type: T.USERS_LOADED, users: await loadUsers(ctx) });
          dispatch({ type: T.CHILD_SELECTED, childId: child.id });
          dispatch({ type: T.CHILD_HYDRATED, bundle: await loadBundle(ctx, child.id) });
          return { ok: true, child: child };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },
    selectChild: function (childId) {
      return async function (dispatch, getState, ctx) {
        await ctx.repos.meta.set('app.activeChildId', childId);
        dispatch({ type: T.CHILD_SELECTED, childId: childId });
        dispatch({ type: T.CHILD_HYDRATED, bundle: await loadBundle(ctx, childId) });
        return { ok: true };
      };
    },
    removeChild: function (childId) {
      return async function (dispatch, getState, ctx) {
        const s = requireStoreSession(dispatch, getState);
        if (!s) return { ok: false, code: 'SESSION_REQUIRED', message: 'Unlock parent mode first.' };
        try {
          await ctx.repos.users.removeCascade(childId);
          dispatch({ type: T.USERS_LOADED, users: await loadUsers(ctx) });
          if (getState().activeChildId === childId) {
            await ctx.repos.meta.set('app.activeChildId', '');
            dispatch({ type: T.CHILD_SELECTED, childId: null });
            dispatch({ type: T.CHILD_HYDRATED, bundle: null });
          }
          touchSession(dispatch, ctx, s.token);
          toastOk(dispatch, 'gate', 'Child removed (audit history retained by design).');
          return { ok: true };
        } catch (e) { return failToast(dispatch, 'gate', e); }
      };
    },

    /* quests */
    submitQuest: function (questId) {
      return async function (dispatch, getState, ctx) {
        try {
          const sub = await ctx.services.quest.submit(getState().activeChildId, questId);
          toastOk(dispatch, 'main', 'Sent to the Keeper for approval ✉️');
          await Actions.refreshChild()(dispatch, getState, ctx);
          return { ok: true, submission: sub };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },

    /* parent gate */
    setupParent: function (name, pin) {
      return async function (dispatch, getState, ctx) {
        try {
          const parent = await ctx.repos.users.create({ role: 'PARENT', name: name || 'Keeper', avatar: '🛡️' });
          await ctx.services.auth.setupPin(parent.id, pin);
          dispatch({ type: T.USERS_LOADED, users: await loadUsers(ctx) });
          dispatch({ type: T.PIN_STATUS, hasPin: true });
          toastOk(dispatch, 'gate', 'Parent created and PIN set (PBKDF2-SHA256, 310k iterations). Now unlock with it.');
          return { ok: true, parent: parent };
        } catch (e) { return failToast(dispatch, 'gate', e); }
      };
    },
    setupPin: function (pin) {
      return async function (dispatch, getState, ctx) {
        const parent = getState().users.find(function (u) { return u.role === 'PARENT'; });
        if (!parent) return failToast(dispatch, 'gate', { code: 'NO_PARENT', message: 'No parent account exists yet.' });
        try {
          await ctx.services.auth.setupPin(parent.id, pin);
          dispatch({ type: T.PIN_STATUS, hasPin: true });
          toastOk(dispatch, 'gate', 'PIN set. Now unlock with it.');
          return { ok: true };
        } catch (e) { return failToast(dispatch, 'gate', e); }
      };
    },
    unlock: function (pin) {
      return async function (dispatch, getState, ctx) {
        const parent = getState().users.find(function (u) { return u.role === 'PARENT'; });
        if (!parent) return failToast(dispatch, 'gate', { code: 'NO_PARENT', message: 'No parent account exists yet.' });
        try {
          const session = await ctx.services.auth.verifyPin(parent.id, pin);
          dispatch({ type: T.SESSION_OPENED, session: session });
          toastOk(dispatch, 'gate', 'Parent mode unlocked. Session expires after 5 idle minutes.');
          return { ok: true, session: session };
        } catch (e) { return failToast(dispatch, 'gate', e); }
      };
    },
    lock: function () {
      return async function (dispatch, getState, ctx) {
        const s = getState().session;
        if (s) ctx.services.auth.endSession(s.token);
        dispatch({ type: T.SESSION_CLOSED });
        toastOk(dispatch, 'gate', 'Locked. The approval gate is closed.');
        return { ok: true };
      };
    },

    /* decisions */
    approve: function (submissionId) {
      return async function (dispatch, getState, ctx) {
        const s = requireStoreSession(dispatch, getState);
        if (!s) return { ok: false, code: 'SESSION_REQUIRED', message: 'Unlock parent mode first.' };
        try {
          const preFlame = getState().flame || 0;
          const r = await ctx.services.approval.approve(s.token, submissionId);
          toastOk(dispatch, 'main', r.leveledUp
            ? 'Approved — rewards released. LEVEL UP to ' + r.guardian.level + '! 🎉'
            : 'Approved — rewards released to ' + r.guardian.name + '.');
          if (r.leveledUp) {
            dispatch({ type: T.CELEBRATION_SHOW, celebration: { type: 'levelUp', level: r.guardian.level } });
          }
          await Actions.evaluateAchievements()(dispatch, getState, ctx);
          dispatch({ type: T.CHAIN_VERIFIED, chain: await ctx.services.integrity.verifyChain() });
          touchSession(dispatch, ctx, s.token);
          await Actions.refreshChild()(dispatch, getState, ctx);
          if (getState().mode === 'PARENT_MODE') { await Actions.loadParentOverview()(dispatch, getState, ctx); }
          const postFlame = getState().flame || 0;
          if (Flame.stageIndex(postFlame) > Flame.stageIndex(preFlame)) {
            const fd = Flame.describe(postFlame);
            dispatch({ type: T.CELEBRATION_SHOW, celebration: { type: 'flame', stage: fd.stage, name: fd.name } });
          }
          return { ok: true, result: r };
        } catch (e) {
          if (e && (e.code === 'SESSION_EXPIRED' || e.code === 'SESSION_INVALID')) {
            dispatch({ type: T.SESSION_CLOSED, reason: 'EXPIRED' });
            return { ok: false, code: e.code, message: e.message };
          }
          return failToast(dispatch, 'main', e);
        }
      };
    },
    reject: function (submissionId, note) {
      return async function (dispatch, getState, ctx) {
        const s = requireStoreSession(dispatch, getState);
        if (!s) return { ok: false, code: 'SESSION_REQUIRED', message: 'Unlock parent mode first.' };
        try {
          await ctx.services.approval.reject(s.token, submissionId, note || 'not quite yet');
          toastOk(dispatch, 'main', 'Rejected — nothing was granted.');
          dispatch({ type: T.CHAIN_VERIFIED, chain: await ctx.services.integrity.verifyChain() });
          touchSession(dispatch, ctx, s.token);
          await Actions.refreshChild()(dispatch, getState, ctx);
          if (getState().mode === 'PARENT_MODE') { await Actions.loadParentOverview()(dispatch, getState, ctx); }
          return { ok: true };
        } catch (e) {
          if (e && (e.code === 'SESSION_EXPIRED' || e.code === 'SESSION_INVALID')) {
            dispatch({ type: T.SESSION_CLOSED, reason: 'EXPIRED' });
            return { ok: false, code: e.code, message: e.message };
          }
          return failToast(dispatch, 'main', e);
        }
      };
    },

    /* game */
    startDungeon: function (dungeonId) {
      return async function (dispatch, getState, ctx) {
        const g = getState().guardian;
        if (!g) return failToast(dispatch, 'main', { code: 'NO_GUARDIAN', message: 'No guardian selected.' });
        try {
          const r = await ctx.services.dungeon.start(g.id, dungeonId);
          toastOk(dispatch, 'main', 'Expedition started! ' + g.name + ' paid ' + r.energyCost + ' ⚡ and is on the way.');
          await Actions.refreshChild()(dispatch, getState, ctx);
          return { ok: true, run: r.run };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },
    claimDungeon: function (runId) {
      return async function (dispatch, getState, ctx) {
        try {
          const r = await ctx.services.dungeon.claim(runId);
          const itemsById = getState().itemsById;
          const drops = r.run.result.drops.map(function (d) {
            const it = itemsById[d.itemId];
            return (it ? it.name : d.itemId) + ' ×' + d.qty;
          }).join(', ');
          toastOk(dispatch, 'main', '🎒 Expedition complete! +' + r.run.result.gold + ' gold · +' + r.run.result.xp + ' xp · ' + (drops || 'no drops') + (r.leveledUp ? ' · LEVEL UP! 🎉' : ''));
          // (The W2.6 RaidReturn celebration now provides the reward reveal in the UI.)
          await Actions.evaluateAchievements()(dispatch, getState, ctx);
          await Actions.refreshChild()(dispatch, getState, ctx);
          return { ok: true, result: r.run.result, leveledUp: r.leveledUp };
        } catch (e) {
          if (e && e.code === 'RUN_NOT_FINISHED') {
            const secs = Math.max(0, Math.ceil((e.remainingMs || 0) / 1000));
            const msg = 'Still underway — ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + ' to go.';
            dispatch({ type: T.TOAST_SHOW, scope: 'main', kind: 'bad', text: msg });
            return { ok: false, code: e.code, message: msg, remainingMs: e.remainingMs };
          }
          return failToast(dispatch, 'main', e);
        }
      };
    },
    openCrate: function () {
      return async function (dispatch, getState, ctx) {
        try {
          const r = await ctx.services.loot.openCrate(getState().activeChildId);
          toastOk(dispatch, 'main', '📦 Crate opened: ' + r.item.name + ' (' + r.rarity + ')!');
          dispatch({ type: T.CELEBRATION_SHOW, celebration: { type: 'crate', item: r.item, rarity: r.rarity } });
          await Actions.refreshChild()(dispatch, getState, ctx);
          return { ok: true, item: r.item, rarity: r.rarity };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },
    upgradeBuilding: function (type) {
      return async function (dispatch, getState, ctx) {
        try {
          const r = await ctx.services.building.upgrade(getState().activeChildId, type);
          toastOk(dispatch, 'main', '🔨 ' + r.building.type + ' upgraded to level ' + r.building.level + ' for ' + r.cost + ' gold.' + (type === 'SANCTUARY' ? ' Max energy is now ' + r.guardian.maxEnergy + ' ⚡.' : ''));
          await Actions.refreshChild()(dispatch, getState, ctx);
          return { ok: true, building: r.building };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },
    evaluateAchievements: function () {
      return async function (dispatch, getState, ctx) {
        const id = getState().activeChildId;
        if (!id) return { ok: true, newlyUnlocked: [] };
        const res = await ctx.services.achievement.evaluate(id);
        if (res.newlyUnlocked.length) {
          dispatch({ type: T.CELEBRATION_SHOW, celebration: { type: 'achievement', defs: res.newlyUnlocked } });
          toastOk(dispatch, 'main', '🏅 Achievement unlocked: ' + res.newlyUnlocked.map(function (d) { return d.name; }).join(', '));
        }
        return { ok: true, newlyUnlocked: res.newlyUnlocked };
      };
    },

    /* integrity & backup */
    verifyChain: function () {
      return async function (dispatch, getState, ctx) {
        const chain = await ctx.services.integrity.verifyChain();
        dispatch({ type: T.CHAIN_VERIFIED, chain: chain });
        dispatch({ type: T.TOAST_SHOW, scope: 'gate', kind: chain.valid ? 'ok' : 'bad',
          text: chain.valid
            ? 'Audit chain VALID — ' + chain.length + ' entries verified back to GENESIS.'
            : 'Audit chain INVALID (' + chain.reason + ') — verified ' + chain.verified + ' of ' + chain.length + '.' });
        return { ok: chain.valid, chain: chain };
      };
    },
    recoverRewards: function () {
      return async function (dispatch, getState, ctx) {
        const r = await ctx.services.approval.recoverUnfinished();
        toastOk(dispatch, 'gate', r.recovered === 0
          ? 'Nothing to recover — all approvals fully applied.'
          : 'Recovered ' + r.recovered + ' interrupted reward release(s).');
        await Actions.refreshChild()(dispatch, getState, ctx);
        return { ok: true, recovered: r.recovered };
      };
    },
    exportBackup: function () {
      return async function (dispatch, getState, ctx) {
        try {
          const data = await ctx.services.backup.export();
          toastOk(dispatch, 'main', 'Backup exported. Keep the file somewhere safe.');
          return { ok: true, data: data };
        } catch (e) { return failToast(dispatch, 'main', e); }
      };
    },
    importBackup: function (backup) {
      return async function (dispatch, getState, ctx) {
        try {
          const restored = await ctx.services.backup.importReplace(backup);
          const total = Object.keys(restored).reduce(function (sum, k) { return sum + restored[k]; }, 0);
          await Actions.boot()(dispatch, getState, ctx);
          toastOk(dispatch, 'main', 'Backup verified and restored: ' + total + ' records.');
          return { ok: true, total: total };
        } catch (e) {
          const r = failToast(dispatch, 'main', e);
          r.message += ' Nothing was changed.';
          return r;
        }
      };
    },
    loadParentOverview: function () {
      return async function (dispatch, getState, ctx) {
        const kids = await ctx.repos.users.listByRole('CHILD');
        const quests = await ctx.repos.quests.list();
        const qmap = {};
        quests.forEach(function (q) { qmap[q.id] = q; });
        const queue = [];
        const family = [];
        for (const kid of kids) {
          const g = await ctx.repos.guardians.getByUser(kid.id);
          const pend = (await ctx.repos.submissions.listByUserAndStatus(kid.id, 'PENDING'))
            .sort(function (a, b) { return a.submittedAt - b.submittedAt; });
          const streaks = await ctx.repos.streaks.listByUser(kid.id);
          const glob = streaks.find(function (x) { return x.scope === 'GLOBAL'; });
          family.push({ child: kid, guardian: g || null, streak: glob ? glob.current : 0, pendingCount: pend.length });
          pend.forEach(function (sub) {
            const q = qmap[sub.questId];
            queue.push({
              submission: sub, child: kid,
              questTitle: q ? q.title : sub.questId,
              questIcon: q ? q.icon : '⭐',
              reward: q ? q.reward : null,
            });
          });
        }
        queue.sort(function (a, b) { return a.submission.submittedAt - b.submission.submittedAt; });
        dispatch({ type: T.PARENT_LOADED, queue: queue, family: family });
        return { ok: true, queue: queue, family: family };
      };
    },
    changePin: function (oldPin, newPin) {
      return async function (dispatch, getState, ctx) {
        const parent = getState().users.find(function (u) { return u.role === 'PARENT'; });
        if (!parent) return failToast(dispatch, 'gate', { code: 'NO_PARENT', message: 'No parent account exists yet.' });
        try {
          await ctx.services.auth.changePin(parent.id, oldPin, newPin);
          toastOk(dispatch, 'gate', 'PIN changed.');
          return { ok: true };
        } catch (e) { return failToast(dispatch, 'gate', e); }
      };
    },
    repairTime: function () {
      return async function (dispatch, getState, ctx) {
        const fixed = await healTimeTravel(ctx);
        toastOk(dispatch, 'main', fixed > 0
          ? 'Repaired ' + fixed + ' time-travelled record' + (fixed === 1 ? '' : 's') + '.'
          : 'No time damage found.');
        await Actions.refreshChild()(dispatch, getState, ctx);
        if (getState().mode === 'PARENT_MODE') { await Actions.loadParentOverview()(dispatch, getState, ctx); }
        return { ok: true, fixed: fixed };
      };
    },
  };

  const TimeOfDay = {
    phaseAt: function (date) {
      const h = date.getHours() + date.getMinutes() / 60;
      const phases = CONFIG.DAYNIGHT.PHASES;
      for (let i = 0; i < phases.length; i++) {
        if (h >= phases[i].from && h < phases[i].to) return phases[i];
      }
      return phases[phases.length - 1];
    },
    // 0..1 progress of the celestial arc within the lit part of the day (for sun/moon position)
    arc: function (date) {
      const h = date.getHours() + date.getMinutes() / 60;
      const ph = TimeOfDay.phaseAt(date);
      if (ph.id === 'night') {
        // moon arc spans dusk-end(20) -> dawn-start(5) wrapping midnight
        let t = (h >= 20) ? (h - 20) : (h + 4);
        return Math.max(0, Math.min(1, t / 9));
      }
      // sun arc spans dawn-start(5) -> dusk-end(20)
      return Math.max(0, Math.min(1, (h - 5) / 15));
    },
    describe: function (date) {
      const d = date || new Date();
      const ph = TimeOfDay.phaseAt(d);
      const C = CONFIG.DAYNIGHT;
      return {
        id: ph.id,
        name: ph.name,
        arc: TimeOfDay.arc(d),
        sky: C.SKY[ph.id],
        light: C.LIGHT[ph.id],
        hearthGlow: C.HEARTH_GLOW[ph.id],
        stars: C.SHOW_STARS[ph.id],
        windows: C.WINDOWS_LIT[ph.id],
        isNight: ph.id === 'night',
      };
    },
  };

  const Flame = {
    stageIndex: function (points) {
      const st = CONFIG.FLAME.STAGES;
      let idx = 0;
      for (let i = 0; i < st.length; i++) { if (points >= st[i].at) idx = i; }
      return idx;
    },
    describe: function (points) {
      const st = CONFIG.FLAME.STAGES;
      const idx = Flame.stageIndex(points);
      const cur = st[idx];
      const next = st[idx + 1] || null;
      return {
        points: points,
        stage: idx,
        name: cur.name,
        nextName: next ? next.name : null,
        nextAt: next ? next.at : null,
        progress: next ? Math.min(1, (points - cur.at) / (next.at - cur.at)) : 1,
        memories: CONFIG.FLAME.MEMORIES.filter(function (m) { return points >= m.at; }),
      };
    },
  };

  async function healTimeTravel(ctx) {
    // Repairs records stamped in the future by dev-clock fast-forwarding.
    // Future streak days make every approval throw TIME_BACKWARDS, which
    // strands submissions as PENDING and silently exhausts daily limits.
    const now = Date.now();
    const grace = 5 * 60000;
    const today = TimeUtil.todayStr(new Date(now));
    const subs = await ctx.db.getAll('submissions');
    const streaks = await ctx.db.getAll('streaks');
    const runs = await ctx.db.getAll('dungeonRuns');
    let fixed = 0;
    await ctx.db.atomic(['submissions', 'streaks', 'dungeonRuns'], async function (c) {
      for (const s of subs) {
        const cp = Object.assign({}, s);
        let ch = false;
        if (cp.submittedAt > now + grace) { cp.submittedAt = now; ch = true; }
        if (cp.decidedAt !== undefined && cp.decidedAt > now + grace) { cp.decidedAt = now; ch = true; }
        if (ch) { await c.put('submissions', cp); fixed++; }
      }
      for (const st of streaks) {
        if (st.lastActiveDay !== undefined && st.lastActiveDay > today) {
          await c.put('streaks', Object.assign({}, st, { lastActiveDay: today }));
          fixed++;
        }
      }
      for (const r of runs) {
        if (r.startedAt > now + grace) {
          const delta = r.startedAt - now;
          await c.put('dungeonRuns', Object.assign({}, r, { startedAt: r.startedAt - delta, endsAt: r.endsAt - delta }));
          fixed++;
        }
      }
    });
    return fixed;
  }

  function makeStore(ctx) {
    const now = ctx.now || function () { return Date.now(); };
    const fullCtx = Object.assign({}, ctx, { now: now });
    let state = initialState(now());
    const listeners = new Set();
    function getState() { return state; }
    function dispatch(action) {
      if (typeof action === 'function') return action(dispatch, getState, fullCtx);
      const next = reduce(state, action);
      if (next !== state) {
        state = next;
        listeners.forEach(function (l) {
          try { l(state); } catch (e) { /* a broken listener must never break the store */ }
        });
      }
      return action;
    }
    function subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    }
    return { getState: getState, dispatch: dispatch, subscribe: subscribe };
  }

  const Selectors = {
    selectChildren: function (s) { return s.users.filter(function (u) { return u.role === 'CHILD'; }); },
    selectParent: function (s) { return s.users.find(function (u) { return u.role === 'PARENT'; }) || null; },
    selectActiveChild: function (s) { return s.users.find(function (u) { return u.id === s.activeChildId; }) || null; },
    selectGuardian: function (s) { return s.guardian; },
    selectQuestBoard: function (s) { return s.questBoard; },
    selectPending: function (s) { return s.pending; },
    selectGlobalStreak: function (s) {
      const row = s.streaks.find(function (x) { return x.scope === 'GLOBAL'; });
      return row ? row.current : 0;
    },
    selectCrates: function (s) { return s.crates; },
    selectBuildings: function (s) { return s.buildings; },
    selectAchievements: function (s) { return s.achievements; },
    selectInventoryDetailed: function (s) {
      return s.inventory.map(function (row) {
        return { itemId: row.itemId, qty: row.qty, item: s.itemsById[row.itemId] || null };
      });
    },
    selectDungeonView: function (s) {
      const run = s.dungeon.activeRun;
      return s.dungeon.list.map(function (d) {
        const isActive = !!(run && run.dungeonId === d.def.id);
        return {
          def: d.def, unlocked: d.unlocked, energyCost: d.energyCost,
          isActive: isActive,
          remainingMs: isActive ? Math.max(0, run.endsAt - s.now) : 0,
          claimable: isActive && s.now >= run.endsAt,
          runId: isActive ? run.id : null,
          blocked: !!run && !isActive,
        };
      });
    },
    selectActiveRun: function (s) { return s.dungeon.activeRun; },
    selectIsParentMode: function (s) { return s.mode === 'PARENT_MODE' && !!s.session; },
    selectCanApprove: function (s) { return !!(s.session && s.now <= s.session.expiresAt); },
    selectSessionRemainingMs: function (s) { return s.session ? Math.max(0, s.session.expiresAt - s.now) : 0; },
    selectChain: function (s) { return s.chain; },
  };

  /* ==========================================================================
     09_TESTSUITE — one suite, two homes: runs under node (memory backend)
     during development and on-device (real IndexedDB) via the harness UI.
     ========================================================================== */
  function approxEqual(a, b, tol) { return Math.abs(a - b) <= tol; }

  function fakeClock(startMs) {
    return {
      t: startMs,
      now: function () { return this.t; },
      tick: function (ms) { this.t += ms; },
    };
  }

  function makeAssert(failures) {
    return {
      ok: function (cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); },
      equal: function (a, b, msg) {
        if (a !== b) throw new Error('ASSERT ' + msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
      },
      deepEqual: function (a, b, msg) {
        const ca = Canon.stringify(a); const cb = Canon.stringify(b);
        if (ca !== cb) throw new Error('ASSERT ' + msg + ' — values differ');
      },
      throwsCode: async function (fn, code, msg) {
        try { await fn(); } catch (e) {
          if (e && e.code === code) return e;
          throw new Error('ASSERT ' + msg + ' — threw ' + (e && (e.code || e.message)) + ' instead of ' + code);
        }
        throw new Error('ASSERT ' + msg + ' — expected ' + code + ' but nothing was thrown');
      },
    };
  }

  const TESTS = [
    /* ---- CONFIG integrity ---- */
    { name: 'config: rarity weights sum to 100', db: false, fn: function (t) {
      let sum = 0; ENUMS.RARITY.forEach(function (r) { sum += CONFIG.RARITY_WEIGHTS[r]; });
      t.equal(sum, 100, 'weight sum');
    } },
    { name: 'config: CONFIG is deep-frozen', db: false, fn: function (t) {
      let threw = false;
      try { CONFIG.RARITY_WEIGHTS.COMMON = 999; } catch (e) { threw = true; }
      t.ok(threw && CONFIG.RARITY_WEIGHTS.COMMON === 50, 'mutation rejected');
    } },
    { name: 'config: every default quest validates against schema', db: false, fn: function (t) {
      CONFIG.QUESTS.forEach(function (q) {
        const full = {
          id: q.id, title: q.title, category: q.category, reward: questRewardBundle(q),
          maxPerDay: q.maxPerDay !== undefined ? q.maxPerDay : CONFIG.MAX_PER_DAY_DEFAULTS[q.category],
          active: true, icon: q.icon,
        };
        Validation.validateForStore('quests', full);
      });
      t.equal(CONFIG.QUESTS.length, 18, 'quest count');
    } },
    { name: 'config: items, dungeons, achievements validate; crate item exists', db: false, fn: function (t) {
      CONFIG.ITEMS.forEach(function (i) { Validation.validateForStore('items', i); });
      CONFIG.ACHIEVEMENTS.forEach(function (a) { Validation.validateForStore('achievements', a); });
      CONFIG.DUNGEONS.forEach(function (d) {
        t.ok(ENUMS.DUNGEON_TIER.indexOf(d.tier) !== -1, 'tier ' + d.id);
        t.ok(d.gold[0] <= d.gold[1] && d.xp[0] <= d.xp[1], 'ranges ' + d.id);
      });
      t.ok(CONFIG.ITEMS.some(function (i) { return i.id === 'itm_loot_crate'; }), 'crate item present');
    } },

    /* ---- Domain: leveling ---- */
    { name: 'leveling: band boundaries match spec', db: false, fn: function (t) {
      t.equal(Leveling.xpToNext(1), 80, 'L1');
      t.equal(Leveling.xpToNext(10), 260, 'L10');
      t.equal(Leveling.xpToNext(11), 295, 'L11');
      t.equal(Leveling.xpToNext(25), 785, 'L25');
      t.equal(Leveling.xpToNext(26), 860, 'L26');
      t.equal(Leveling.xpToNext(50), 2300, 'L50');
      t.equal(Leveling.xpToNext(51), 2400, 'L51');
    } },
    { name: 'leveling: levelFromTotalXp inverts totalXpForLevel', db: false, fn: function (t) {
      [1, 2, 5, 10, 11, 25, 26, 49, 50, 51, 80].forEach(function (L) {
        const total = Leveling.totalXpForLevel(L);
        t.equal(Leveling.levelFromTotalXp(total).level, L, 'exact L' + L);
        if (total > 0) t.equal(Leveling.levelFromTotalXp(total - 1).level, L - 1, 'one-below L' + L);
      });
    } },
    { name: 'leveling: applyXp reports level-ups', db: false, fn: function (t) {
      const g = { xp: 0, level: 1 };
      const r = Leveling.applyXp(g, 80);
      t.equal(r.level, 2, 'level'); t.ok(r.leveledUp, 'leveledUp'); t.equal(r.levelsGained, 1, 'gained');
      const r2 = Leveling.applyXp({ xp: r.xp, level: r.level }, 10);
      t.ok(!r2.leveledUp, 'no level-up on small gain');
    } },

    /* ---- Domain: RNG + loot ---- */
    { name: 'rng: same seed yields identical stream', db: false, fn: function (t) {
      const seed = RNG.seedFromString('guardian-123|dgn_glade|1718000000000');
      const a = RNG.mulberry32(seed); const b = RNG.mulberry32(seed);
      for (let i = 0; i < 50; i++) t.equal(a(), b(), 'draw ' + i);
    } },
    { name: 'loot: rarity rolls are deterministic and respect weights', db: false, fn: function (t) {
      const r1 = RNG.mulberry32(42); const r2 = RNG.mulberry32(42);
      for (let i = 0; i < 20; i++) t.equal(Loot.rollRarity(r1), Loot.rollRarity(r2), 'deterministic ' + i);
      const rand = RNG.mulberry32(7);
      const counts = {};
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const r = Loot.rollRarity(rand);
        counts[r] = (counts[r] || 0) + 1;
      }
      ENUMS.RARITY.forEach(function (r) {
        const expected = CONFIG.RARITY_WEIGHTS[r] / 100;
        const got = (counts[r] || 0) / N;
        t.ok(approxEqual(got, expected, 0.02), r + ' within tolerance (got ' + got.toFixed(3) + ')');
      });
    } },
    { name: 'loot: pickItemOfRarity only returns matching rarity', db: false, fn: function (t) {
      const rand = RNG.mulberry32(9);
      for (let i = 0; i < 30; i++) {
        const item = Loot.pickItemOfRarity(rand, 'RARE', CONFIG.ITEMS);
        t.equal(item.rarity, 'RARE', 'rarity match');
      }
      t.equal(Loot.pickItemOfRarity(rand, 'MYTHIC', []), null, 'empty pool -> null');
    } },

    /* ---- Domain: streaks ---- */
    { name: 'streaks: consecutive days increment, same day idempotent', db: false, fn: function (t) {
      let s = { current: 0, best: 0 };
      s = Object.assign({}, s, Streaks.applyActivity(s, '2026-06-01'));
      t.equal(s.current, 1, 'day1');
      s = Object.assign({}, s, Streaks.applyActivity(s, '2026-06-02'));
      t.equal(s.current, 2, 'day2');
      s = Object.assign({}, s, Streaks.applyActivity(s, '2026-06-02'));
      t.equal(s.current, 2, 'same day no change');
      t.equal(s.best, 2, 'best tracks');
    } },
    { name: 'streaks: missed days decay 20% per day, never hard-reset, best preserved', db: false, fn: function (t) {
      let s = { current: 10, best: 10, lastActiveDay: '2026-06-01' };
      const after = Streaks.applyActivity(s, '2026-06-04'); // 2 missed days
      t.equal(after.current, Math.floor(Math.floor(10 * 0.8) * 0.8) + 1, 'decayed then +1'); // floor(8*0.8)=6 -> 7
      t.equal(after.current, 7, 'expected 7');
      t.equal(after.best, 10, 'best never decreases');
      t.equal(Streaks.effectiveCurrent({ current: 10, best: 10, lastActiveDay: '2026-06-01' }, '2026-06-04'), 6, 'display decay');
    } },

    /* ---- Domain: bundles + canonical hashing ---- */
    { name: 'bundles: normalize fills defaults; invalid bundles rejected', db: false, fn: async function (t) {
      const b = Rewards.normalizeBundle({ coins: 5 });
      t.equal(b.energy, 0, 'default energy');
      t.deepEqual(b.materials, [], 'default materials');
      await t.throwsCode(function () { Rewards.normalizeBundle({ coins: -1 }); }, 'OUT_OF_RANGE', 'negative coins');
      await t.throwsCode(function () { Rewards.normalizeBundle({ coins: 1.5 }); }, 'BAD_TYPE', 'float coins');
      await t.throwsCode(function () { Rewards.normalizeBundle({ materials: [{ itemId: 'x', qty: 0 }] }); }, 'OUT_OF_RANGE', 'zero qty material');
      const sum = Rewards.addBundles(Rewards.normalizeBundle({ coins: 2, materials: [{ itemId: 'itm_wood', qty: 1 }] }),
        Rewards.normalizeBundle({ coins: 3, materials: [{ itemId: 'itm_wood', qty: 2 }] }));
      t.equal(sum.coins, 5, 'coins add');
      t.deepEqual(sum.materials, [{ itemId: 'itm_wood', qty: 3 }], 'materials merge');
    } },
    { name: 'canon/sha256: key order does not change checksum', db: false, fn: async function (t) {
      const a = await sha256Hex(Canon.stringify({ b: 1, a: [1, 2, { z: 1, y: 2 }] }));
      const b = await sha256Hex(Canon.stringify({ a: [1, 2, { y: 2, z: 1 }], b: 1 }));
      t.equal(a, b, 'stable checksum');
      t.ok(/^[0-9a-f]{64}$/.test(a), 'hex64');
    } },
    { name: 'validation: submission transition rules are final', db: false, fn: async function (t) {
      Validation.assertSubmissionTransition('PENDING', 'APPROVED');
      Validation.assertSubmissionTransition('PENDING', 'REJECTED');
      await t.throwsCode(function () { Validation.assertSubmissionTransition('APPROVED', 'REJECTED'); }, 'IMMUTABLE_DECISION', 'no re-decide');
      await t.throwsCode(function () { Validation.assertSubmissionTransition('PENDING', 'PENDING'); }, 'BAD_TRANSITION', 'no pending->pending');
    } },
    { name: 'validation: quest submit rule enforces maxPerDay + active', db: false, fn: function (t) {
      const q = { active: true, maxPerDay: 2 };
      t.ok(canSubmitQuest(q, 0).ok, 'fresh ok');
      t.ok(canSubmitQuest(q, 1).ok, 'second ok');
      t.equal(canSubmitQuest(q, 2).reason, 'MAX_PER_DAY_REACHED', 'third blocked');
      t.equal(canSubmitQuest({ active: false, maxPerDay: 2 }, 0).reason, 'QUEST_INACTIVE', 'inactive blocked');
    } },

    /* ---- DB + repositories ---- */
    { name: 'db: seed populates catalog exactly once', db: true, fn: async function (t, env) {
      const r1 = await env.services.seed.seedIfEmpty();
      t.ok(r1.seeded, 'first seed runs');
      t.equal(r1.quests, 18, 'quests seeded');
      const r2 = await env.services.seed.seedIfEmpty();
      t.ok(!r2.seeded, 'second seed is a no-op');
      t.equal(await env.db.count('items'), CONFIG.ITEMS.length, 'item count');
      t.equal(await env.db.count('achievements'), CONFIG.ACHIEVEMENTS.length, 'achievement count');
      t.equal(await env.repos.meta.get('auditHead'), CONFIG.SECURITY.AUDIT_GENESIS, 'audit head at genesis');
    } },
    { name: 'repos: user create/list/update; invalid role and long name rejected', db: true, fn: async function (t, env) {
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Mila', avatar: '🦊' });
      t.ok(u.id, 'id assigned');
      const listed = await env.repos.users.listByRole('CHILD');
      t.equal(listed.length, 1, 'listByRole');
      await env.repos.users.updateProfile(u.id, { name: 'Mila Rose' });
      t.equal((await env.repos.users.get(u.id)).name, 'Mila Rose', 'updated');
      await t.throwsCode(function () { return env.repos.users.create({ role: 'ADMIN', name: 'X' }); }, 'BAD_ENUM', 'bad role');
      await t.throwsCode(function () { return env.repos.users.create({ role: 'CHILD', name: 'x'.repeat(40) }); }, 'TOO_LONG', 'long name');
    } },
    { name: 'repos: guardian creation is one-per-user and starts at L1', db: true, fn: async function (t, env) {
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Theo' });
      const g = await env.repos.guardians.createForUser(u.id, { name: 'Ember', species: 'DRAGON' });
      t.equal(g.level, 1, 'L1'); t.equal(g.energy, 0, 'no free energy');
      await t.throwsCode(function () { return env.repos.guardians.createForUser(u.id, { name: 'Two', species: 'WOLF' }); }, 'ALREADY_EXISTS', 'single guardian');
      await t.throwsCode(function () { return env.repos.guardians.createForUser('ghost', { name: 'X', species: 'WOLF' }); }, 'NOT_FOUND', 'user must exist');
    } },
    { name: 'repos: applyBundle clamps energy, levels up, grants materials + crates', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Ava' });
      await env.repos.guardians.createForUser(u.id, { name: 'Pip', species: 'FOX' });
      const bundle = Rewards.normalizeBundle({ coins: 30, energy: 150, xp: 85, affection: 3, lootCrates: 2, materials: [{ itemId: 'itm_wood', qty: 5 }] });
      const res = await env.repos.guardians.applyBundle(u.id, bundle);
      t.equal(res.guardian.energy, CONFIG.ECONOMY.BASE_MAX_ENERGY, 'energy clamped at max');
      t.equal(res.guardian.gold, 30, 'gold credited');
      t.equal(res.guardian.level, 2, 'leveled to 2 (85 >= 80)');
      t.ok(res.leveledUp, 'leveledUp flag');
      const inv = await env.repos.inventory.listByUser(u.id);
      const wood = inv.find(function (i) { return i.itemId === 'itm_wood'; });
      const crates = inv.find(function (i) { return i.itemId === 'itm_loot_crate'; });
      t.equal(wood.qty, 5, 'wood granted'); t.equal(crates.qty, 2, 'crates granted');
    } },
    { name: 'repos: spendEnergy/spendGold refuse overdrafts atomically', db: true, fn: async function (t, env) {
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Noa' });
      const g = await env.repos.guardians.createForUser(u.id, { name: 'Tide', species: 'TURTLE' });
      await env.repos.guardians.applyBundle(u.id, Rewards.normalizeBundle({ energy: 20, coins: 10 }));
      await t.throwsCode(function () { return env.repos.guardians.spendEnergy(g.id, 25); }, 'INSUFFICIENT_ENERGY', 'energy overdraft');
      await t.throwsCode(function () { return env.repos.guardians.spendGold(g.id, 11); }, 'INSUFFICIENT_GOLD', 'gold overdraft');
      const after = await env.repos.guardians.get(g.id);
      t.equal(after.energy, 20, 'energy unchanged after failed spend');
      t.equal(after.gold, 10, 'gold unchanged after failed spend');
      await env.repos.guardians.spendEnergy(g.id, 15);
      t.equal((await env.repos.guardians.get(g.id)).energy, 5, 'valid spend works');
    } },
    { name: 'repos: inventory merges via compound index and blocks negatives', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Iri' });
      await env.repos.inventory.addItem(u.id, 'itm_berry', 2);
      await env.repos.inventory.addItem(u.id, 'itm_berry', 3);
      const inv = await env.repos.inventory.listByUser(u.id);
      t.equal(inv.length, 1, 'merged row'); t.equal(inv[0].qty, 5, 'qty 5');
      await t.throwsCode(function () { return env.repos.inventory.removeItem(u.id, 'itm_berry', 9); }, 'INSUFFICIENT_ITEMS', 'no negatives');
      const left = await env.repos.inventory.removeItem(u.id, 'itm_berry', 5);
      t.equal(left, null, 'row removed at zero');
      await t.throwsCode(function () { return env.repos.inventory.addItem(u.id, 'itm_fake', 1); }, 'NOT_FOUND', 'unknown item');
    } },
    { name: 'repos: submissions are born PENDING; quest must exist and be active', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Eli' });
      const sub = await env.repos.submissions.createPending(u.id, 'qst_water_glass');
      t.equal(sub.status, 'PENDING', 'pending');
      t.equal(sub.decidedAt, undefined, 'no decision fields');
      await env.repos.quests.setActive('qst_bath', false);
      await t.throwsCode(function () { return env.repos.submissions.createPending(u.id, 'qst_bath'); }, 'QUEST_INACTIVE', 'inactive quest');
      await t.throwsCode(function () { return env.repos.submissions.createPending(u.id, 'qst_nope'); }, 'NOT_FOUND', 'unknown quest');
      t.equal(await env.repos.submissions.countTodayNonRejected(u.id, 'qst_water_glass'), 1, 'today count');
    } },
    { name: 'security invariant: only a PARENT can decide; decisions are final', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Kai' });
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      const sub = await env.repos.submissions.createPending(child.id, 'qst_make_bed');
      await t.throwsCode(function () {
        return env.repos.submissions.decide(sub.id, { status: 'APPROVED', decidedBy: child.id });
      }, 'FORBIDDEN', 'child cannot approve');
      const decided = await env.repos.submissions.decide(sub.id, { status: 'APPROVED', decidedBy: parent.id });
      t.equal(decided.status, 'APPROVED', 'approved');
      await t.throwsCode(function () {
        return env.repos.submissions.decide(sub.id, { status: 'REJECTED', decidedBy: parent.id });
      }, 'IMMUTABLE_DECISION', 'cannot re-decide');
    } },
    { name: 'security invariant: rewards require APPROVED submission, exactly once', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Lia' });
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Michel' });
      await env.repos.guardians.createForUser(child.id, { name: 'Luno', species: 'OWL' });
      const sub = await env.repos.submissions.createPending(child.id, 'qst_read_15');
      const bundle = Rewards.normalizeBundle({ coins: 15, energy: 10, xp: 25 });
      await t.throwsCode(function () {
        return env.repos.rewardTransactions.createForSubmission(sub, bundle);
      }, 'FORBIDDEN', 'no reward while pending');
      await env.repos.submissions.decide(sub.id, { status: 'APPROVED', decidedBy: parent.id });
      const txn = await env.repos.rewardTransactions.createForSubmission(sub, bundle);
      t.ok(txn.id, 'reward released');
      await t.throwsCode(function () {
        return env.repos.rewardTransactions.createForSubmission(sub, bundle);
      }, 'ALREADY_EXISTS', 'no double release');
    } },
    { name: 'repos: streaks + counters persist through their repos', db: true, fn: async function (t, env) {
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Rio' });
      let s = await env.repos.streaks.getOrCreate(u.id, 'GLOBAL');
      Object.assign(s, Streaks.applyActivity(s, '2026-06-09'));
      await env.repos.streaks.save(s);
      Object.assign(s, Streaks.applyActivity(s, '2026-06-10'));
      await env.repos.streaks.save(s);
      const again = await env.repos.streaks.getOrCreate(u.id, 'GLOBAL');
      t.equal(again.current, 2, 'streak persisted');
      await env.repos.counters.increment(u.id, 'cat.HYDRATION', 1);
      await env.repos.counters.increment(u.id, 'cat.HYDRATION', 1);
      await env.repos.counters.setMax(u.id, 'streak.global.best', again.best);
      t.equal((await env.repos.counters.get(u.id, 'cat.HYDRATION')).value, 2, 'counter sums');
      t.equal((await env.repos.counters.get(u.id, 'streak.global.best')).value, 2, 'best mirrored');
    } },
    { name: 'repos: audit log accepts only well-formed chain entries; append-only API', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      const prev = await env.repos.meta.get('auditHead');
      const body = { id: Ids.uuid(), parentId: parent.id, action: 'TEST', entity: 'submissions', entityId: 'x', timestamp: Date.now(), prevHash: prev };
      const hash = await sha256Hex(prev + Canon.stringify(body));
      await env.repos.audit.append(Object.assign({}, body, { hash: hash }));
      t.equal(await env.repos.meta.get('auditHead'), hash, 'head advanced');
      await t.throwsCode(function () {
        return env.repos.audit.append({ id: Ids.uuid(), parentId: parent.id, action: 'BAD', entity: 'x', entityId: 'y', timestamp: Date.now(), prevHash: 'nothex', hash: hash });
      }, 'BAD_HASH', 'malformed prevHash rejected');
      t.equal(typeof env.repos.audit.update, 'undefined', 'no update method exists');
      t.equal(typeof env.repos.audit.remove, 'undefined', 'no delete method exists');
    } },
    { name: 'repos: cascade delete removes child data, keeps audit history', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const u = await env.repos.users.create({ role: 'CHILD', name: 'Zee' });
      const g = await env.repos.guardians.createForUser(u.id, { name: 'Boop', species: 'BEAR' });
      await env.repos.inventory.addItem(u.id, 'itm_apple', 1);
      await env.repos.submissions.createPending(u.id, 'qst_walk');
      await env.repos.dungeons.createRun({ guardianId: g.id, dungeonId: 'dgn_glade', seed: 1, startedAt: 1, endsAt: 2 });
      await env.repos.users.removeCascade(u.id);
      t.equal(await env.repos.users.get(u.id), undefined, 'user gone');
      t.equal((await env.repos.inventory.listByUser(u.id)).length, 0, 'inventory gone');
      t.equal((await env.repos.submissions.listByUser(u.id)).length, 0, 'submissions gone');
      t.equal((await env.repos.dungeons.listByGuardian(g.id)).length, 0, 'runs gone');
    } },
    { name: 'db: validation layer blocks writes that bypass shape rules', db: true, fn: async function (t, env) {
      await t.throwsCode(function () {
        return env.db.atomic(['guardians'], function (c) {
          return c.put('guardians', { id: 'hack' }); // raw put used here ONLY to prove repos won't accept it
        }).then(function () {
          return env.repos.guardians.applyBundle('nobody', Rewards.normalizeBundle({ coins: 1 }));
        });
      }, 'NOT_FOUND', 'raw row has no userId index value; repos cannot reach it');
      await t.throwsCode(function () {
        return env.repos.streaks.save({ id: 'x', userId: 'u', scope: 'GLOBAL', current: 5, best: 3 });
      }, 'OUT_OF_RANGE', 'best < current rejected');
    } },
    { name: 'backup: export -> wipe -> import restores identical data', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Mira' });
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      await env.repos.guardians.createForUser(child.id, { name: 'Sol', species: 'PHOENIX' });
      const sub = await env.repos.submissions.createPending(child.id, 'qst_gratitude');
      await env.repos.submissions.decide(sub.id, { status: 'APPROVED', decidedBy: parent.id });
      const before = await env.services.backup.export();
      await env.db.clearAllStores();
      t.equal(await env.db.count('users'), 0, 'wiped');
      const counts = await env.services.backup.importReplace(before);
      t.equal(counts.users, 2, 'users restored');
      const after = await env.services.backup.export();
      t.equal(after.checksum, before.checksum, 'checksum identical after round-trip');
      const restoredSub = await env.repos.submissions.get(sub.id);
      t.equal(restoredSub.status, 'APPROVED', 'decision survived');
    } },
    { name: 'backup: tampered or corrupted files are refused before any write', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const backup = await env.services.backup.export();
      const tampered = JSON.parse(JSON.stringify(backup));
      tampered.data.meta.push({ key: 'evil', value: true });
      await t.throwsCode(function () { return env.services.backup.importReplace(tampered); }, 'CHECKSUM_MISMATCH', 'tamper detected');
      await t.throwsCode(function () { return env.services.backup.importReplace({ format: 'zip' }); }, 'BAD_BACKUP', 'wrong format');
      t.ok((await env.db.count('items')) === CONFIG.ITEMS.length, 'data untouched after refusals');
    } },

    /* ---- Phase 3: AuthService ---- */
    { name: 'auth: PIN setup stores PBKDF2 credentials, never the PIN; parent-only', db: true, fn: async function (t, env) {
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Kid' });
      await env.services.auth.setupPin(parent.id, '482915');
      const cred = await env.repos.credentials.getByUser(parent.id);
      t.ok(/^[0-9a-f]{64}$/.test(cred.pinHash), 'hash is 256-bit hex');
      t.ok(cred.pinHash.indexOf('482915') === -1, 'PIN not embedded in hash');
      t.equal(cred.salt.length, CONFIG.SECURITY.SALT_BYTES * 2, '16-byte salt');
      t.equal(cred.iterations, 310000, 'OWASP iteration count');
      t.equal(cred.algo, 'PBKDF2-SHA256', 'algo recorded');
      await t.throwsCode(function () { return env.services.auth.setupPin(child.id, '482915'); }, 'FORBIDDEN', 'children cannot hold a PIN');
      await t.throwsCode(function () { return env.services.auth.setupPin(parent.id, 'abcd'); }, 'BAD_PIN', 'digits only');
      await t.throwsCode(function () { return env.services.auth.setupPin(parent.id, '12'); }, 'BAD_PIN', 'too short');
    } },
    { name: 'auth: correct PIN opens a session; wrong PIN counts attempts and resets on success', db: true, fn: async function (t, env) {
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Michel' });
      await env.services.auth.setupPin(parent.id, '7341');
      const err = await t.throwsCode(function () { return env.services.auth.verifyPin(parent.id, '0000'); }, 'WRONG_PIN', 'wrong rejected');
      t.equal(err.attemptsLeft, 2, 'attempts tracked');
      const session = await env.services.auth.verifyPin(parent.id, '7341');
      t.ok(session.token, 'session token issued');
      t.equal(env.services.auth.requireSession(session.token).parentId, parent.id, 'session resolves to parent');
      t.equal((await env.repos.credentials.getByUser(parent.id)).failedAttempts, 0, 'counter reset on success');
    } },
    { name: 'auth: three failures lock out; lockout escalates and persists in the DB', db: true, fn: async function (t, env) {
      const clock = fakeClock(1750000000000);
      const auth = makeAuthService(env.repos, { now: function () { return clock.t; } });
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      await auth.setupPin(parent.id, '991122');
      await t.throwsCode(function () { return auth.verifyPin(parent.id, '111111'); }, 'WRONG_PIN', 'miss 1');
      await t.throwsCode(function () { return auth.verifyPin(parent.id, '222222'); }, 'WRONG_PIN', 'miss 2');
      const lock = await t.throwsCode(function () { return auth.verifyPin(parent.id, '333333'); }, 'LOCKED_OUT', 'miss 3 locks');
      t.equal(lock.retryInMs, CONFIG.SECURITY.LOCKOUT_BASE_MS, 'first lockout is 60s');
      await t.throwsCode(function () { return auth.verifyPin(parent.id, '991122'); }, 'LOCKED_OUT', 'even the right PIN waits');
      const cred = await env.repos.credentials.getByUser(parent.id);
      t.ok(cred.lockoutUntil > clock.t, 'lockout persisted in DB (reload-proof)');
      clock.tick(CONFIG.SECURITY.LOCKOUT_BASE_MS + 1000);
      await t.throwsCode(function () { return auth.verifyPin(parent.id, '111111'); }, 'WRONG_PIN', 'released after wait');
      await t.throwsCode(function () { return auth.verifyPin(parent.id, '222222'); }, 'WRONG_PIN', 'miss again');
      const lock2 = await t.throwsCode(function () { return auth.verifyPin(parent.id, '333333'); }, 'LOCKED_OUT', 'second lockout');
      t.equal(lock2.retryInMs, CONFIG.SECURITY.LOCKOUT_BASE_MS * 2, 'second lockout doubles to 120s');
      clock.tick(CONFIG.SECURITY.LOCKOUT_BASE_MS * 2 + 1000);
      const session = await auth.verifyPin(parent.id, '991122');
      t.ok(session.token, 'recovers fully after lockout');
    } },
    { name: 'auth: sessions slide on use and expire after 5 idle minutes', db: true, fn: async function (t, env) {
      const clock = fakeClock(1750000000000);
      const auth = makeAuthService(env.repos, { now: function () { return clock.t; } });
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      await auth.setupPin(parent.id, '5566');
      const s = await auth.verifyPin(parent.id, '5566');
      clock.tick(4 * 60 * 1000);
      t.ok(auth.requireSession(s.token), 'alive at 4 min');
      clock.tick(4 * 60 * 1000);
      t.ok(auth.requireSession(s.token), 'sliding window extended it');
      clock.tick(6 * 60 * 1000);
      await t.throwsCode(function () { return Promise.resolve().then(function () { return auth.requireSession(s.token); }); }, 'SESSION_EXPIRED', 'expires after idle');
      await t.throwsCode(function () { return Promise.resolve().then(function () { return auth.requireSession('not-a-token'); }); }, 'SESSION_INVALID', 'unknown token rejected');
      const s2 = await auth.verifyPin(parent.id, '5566');
      auth.endSession(s2.token);
      await t.throwsCode(function () { return Promise.resolve().then(function () { return auth.requireSession(s2.token); }); }, 'SESSION_INVALID', 'ended session is gone');
    } },
    { name: 'auth: changing the PIN requires the old PIN', db: true, fn: async function (t, env) {
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      await env.services.auth.setupPin(parent.id, '1234');
      await t.throwsCode(function () { return env.services.auth.changePin(parent.id, '9999', '4321'); }, 'WRONG_PIN', 'old PIN required');
      await env.services.auth.changePin(parent.id, '1234', '4321');
      await t.throwsCode(function () { return env.services.auth.verifyPin(parent.id, '1234'); }, 'WRONG_PIN', 'old PIN dead');
      t.ok((await env.services.auth.verifyPin(parent.id, '4321')).token, 'new PIN works');
    } },

    /* ---- Phase 3: audit chain ---- */
    { name: 'audit: service appends a chain that verifies end-to-end', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const e1 = await env.services.audit.append({ parentId: parent.id, action: 'A', entity: 'meta', entityId: 'x' });
      t.equal(e1.prevHash, CONFIG.SECURITY.AUDIT_GENESIS, 'first entry links to GENESIS');
      await env.services.audit.append({ parentId: parent.id, action: 'B', entity: 'meta', entityId: 'y', reason: 'because' });
      const e3 = await env.services.audit.append({ parentId: parent.id, action: 'C', entity: 'meta', entityId: 'z' });
      const report = await env.services.integrity.verifyChain();
      t.ok(report.valid, 'chain valid');
      t.equal(report.length, 3, 'three entries');
      t.equal(report.head, e3.hash, 'head is the last hash');
    } },
    { name: 'audit: editing any past entry is detected by verifyChain', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const first = await env.services.audit.append({ parentId: parent.id, action: 'SUBMISSION_APPROVED', entity: 'submissions', entityId: 's1' });
      await env.services.audit.append({ parentId: parent.id, action: 'SUBMISSION_REJECTED', entity: 'submissions', entityId: 's2' });
      // Simulate out-of-band tampering: a raw write that bypasses the repos
      // entirely (only possible with direct DB access — exactly the threat
      // the chain exists to detect).
      const hacked = Object.assign({}, first, { action: 'SUBMISSION_REJECTED' });
      await env.db.atomic(['auditLogs'], function (c) { return c.put('auditLogs', hacked); });
      const report = await env.services.integrity.verifyChain();
      t.ok(!report.valid, 'tampering detected');
      t.equal(report.reason, 'TAMPERED_ENTRY', 'reason reported');
    } },
    { name: 'audit: appends with a stale head are rejected (no forks)', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      await env.services.audit.append({ parentId: parent.id, action: 'A', entity: 'meta', entityId: 'x' });
      const stale = {
        id: Ids.uuid(), parentId: parent.id, action: 'B', entity: 'meta', entityId: 'y',
        timestamp: Date.now(), prevHash: CONFIG.SECURITY.AUDIT_GENESIS,
      };
      const hash = await sha256Hex(stale.prevHash + Canon.stringify(stale));
      await t.throwsCode(function () {
        return env.repos.audit.append(Object.assign({}, stale, { hash: hash }));
      }, 'CHAIN_CONFLICT', 'stale prevHash refused');
    } },

    /* ---- Phase 3: the approval gate ---- */
    { name: 'gate: approval releases rewards exactly once — guardian, streaks, counters, audit', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Mila' });
      await env.repos.guardians.createForUser(child.id, { name: 'Ember', species: 'DRAGON' });
      await env.services.auth.setupPin(parent.id, '246810');
      const session = await env.services.auth.verifyPin(parent.id, '246810');
      const sub = await env.repos.submissions.createPending(child.id, 'qst_water_glass');
      const quest = await env.repos.quests.get('qst_water_glass');

      const result = await env.services.approval.approve(session.token, sub.id, 'good job!');
      t.equal(result.submission.status, 'APPROVED', 'submission approved');
      t.equal(result.submission.decidedBy, parent.id, 'decided by the parent');
      t.equal(result.transaction.applied, true, 'reward marked applied');
      t.equal(result.guardian.gold, quest.reward.coins, 'coins landed');
      t.equal(result.guardian.energy, quest.reward.energy, 'energy landed');
      t.equal(result.guardian.xp, quest.reward.xp, 'xp landed');
      t.equal(result.streak.current, 1, 'streak started');
      t.equal((await env.repos.counters.get(child.id, 'global.approvals')).value, 1, 'approval counter');
      t.equal((await env.repos.counters.get(child.id, 'cat.HYDRATION')).value, 1, 'category counter');
      const chain = await env.services.integrity.verifyChain();
      t.ok(chain.valid && chain.length === 1, 'decision audit-chained');
      await t.throwsCode(function () {
        return env.services.approval.approve(session.token, sub.id);
      }, 'IMMUTABLE_DECISION', 'cannot approve twice');
    } },
    { name: 'gate: rejection grants nothing and is audited', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Michel' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Theo' });
      await env.repos.guardians.createForUser(child.id, { name: 'Pip', species: 'FOX' });
      await env.services.auth.setupPin(parent.id, '1357');
      const session = await env.services.auth.verifyPin(parent.id, '1357');
      const sub = await env.repos.submissions.createPending(child.id, 'qst_make_bed');
      const result = await env.services.approval.reject(session.token, sub.id, 'bed still messy');
      t.equal(result.submission.status, 'REJECTED', 'rejected');
      const g = await env.repos.guardians.getByUser(child.id);
      t.equal(g.gold + g.xp + g.energy, 0, 'no rewards moved');
      t.equal(await env.repos.rewardTransactions.getBySubmission(sub.id), null, 'no transaction exists');
      t.equal(await env.repos.counters.get(child.id, 'global.approvals'), null, 'no counters moved');
      const chain = await env.services.integrity.verifyChain();
      t.ok(chain.valid && chain.length === 1, 'rejection audit-chained');
    } },
    { name: 'gate: a live parent session is mandatory — children have no path to one', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const clock = fakeClock(1750000000000);
      const auth = makeAuthService(env.repos, { now: function () { return clock.t; } });
      const approval = makeApprovalService(env.repos, auth, env.services.audit);
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Ava' });
      await env.repos.guardians.createForUser(child.id, { name: 'Sol', species: 'PHOENIX' });
      const sub = await env.repos.submissions.createPending(child.id, 'qst_read_15');
      await t.throwsCode(function () { return approval.approve('forged-token', sub.id); }, 'SESSION_INVALID', 'forged token refused');
      await auth.setupPin(parent.id, '8642');
      const session = await auth.verifyPin(parent.id, '8642');
      clock.tick(6 * 60 * 1000);
      await t.throwsCode(function () { return approval.approve(session.token, sub.id); }, 'SESSION_EXPIRED', 'expired session refused');
      t.equal((await env.repos.submissions.get(sub.id)).status, 'PENDING', 'submission untouched by failed attempts');
      // And the repo layer backstops even a hypothetical service bypass:
      await t.throwsCode(function () {
        return env.repos.submissions.decide(sub.id, { status: 'APPROVED', decidedBy: child.id });
      }, 'FORBIDDEN', 'child id can never decide');
    } },
    { name: 'gate: crash recovery completes interrupted approvals exactly once', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Noa' });
      await env.repos.guardians.createForUser(child.id, { name: 'Tide', species: 'TURTLE' });
      const quest = await env.repos.quests.get('qst_exercise');
      // Crash scenario A: decided, but the app died before the transaction was created.
      const subA = await env.repos.submissions.createPending(child.id, 'qst_exercise');
      await env.repos.submissions.decide(subA.id, { status: 'APPROVED', decidedBy: parent.id });
      // Crash scenario B: transaction created but never applied.
      const subB = await env.repos.submissions.createPending(child.id, 'qst_walk');
      const decidedB = await env.repos.submissions.decide(subB.id, { status: 'APPROVED', decidedBy: parent.id });
      const questB = await env.repos.quests.get('qst_walk');
      await env.repos.rewardTransactions.createForSubmission(decidedB, questB.reward);

      const first = await env.services.approval.recoverUnfinished();
      t.equal(first.recovered, 2, 'both interrupted approvals completed');
      const g1 = await env.repos.guardians.getByUser(child.id);
      t.equal(g1.gold, quest.reward.coins + questB.reward.coins, 'rewards from both landed');
      const again = await env.services.approval.recoverUnfinished();
      t.equal(again.recovered, 0, 'second run recovers nothing');
      const g2 = await env.repos.guardians.getByUser(child.id);
      t.equal(g2.gold, g1.gold, 'no double application — idempotent');
      t.ok((await env.services.integrity.verifyChain()).valid, 'recovery entries chain cleanly');
    } },

    /* ---- Phase 4: game services ---- */
    { name: 'game: quest service enforces daily limits; rejection frees the slot', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Mila' });
      const sub1 = await env.services.quest.submit(child.id, 'qst_make_bed');
      t.equal(sub1.status, 'PENDING', 'born pending');
      await t.throwsCode(function () { return env.services.quest.submit(child.id, 'qst_make_bed'); }, 'MAX_PER_DAY_REACHED', 'limit 1/day');
      const board = await env.services.quest.listForChild(child.id);
      const bed = board.find(function (b) { return b.quest.id === 'qst_make_bed'; });
      t.equal(bed.remainingToday, 0, 'board shows zero remaining');
      await env.repos.submissions.decide(sub1.id, { status: 'REJECTED', decidedBy: parent.id });
      const sub2 = await env.services.quest.submit(child.id, 'qst_make_bed');
      t.equal(sub2.status, 'PENDING', 'rejected slot freed');
      await t.throwsCode(function () { return env.services.quest.submit(child.id, 'qst_nope'); }, 'NOT_FOUND', 'unknown quest');
    } },
    { name: 'game: dungeon start gates on level, energy, and one run at a time', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Theo' });
      const g = await env.repos.guardians.createForUser(child.id, { name: 'Ember', species: 'DRAGON' });
      await t.throwsCode(function () { return env.services.dungeon.start(g.id, 'dgn_glade'); }, 'INSUFFICIENT_ENERGY', 'no free raids');
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ energy: 50 }));
      await t.throwsCode(function () { return env.services.dungeon.start(g.id, 'dgn_tide'); }, 'DUNGEON_LOCKED', 'level gate (needs 8)');
      const started = await env.services.dungeon.start(g.id, 'dgn_glade');
      t.equal(started.energyCost, CONFIG.ECONOMY.DUNGEON_ENERGY.SHORT, 'short tier cost');
      t.equal((await env.repos.guardians.get(g.id)).energy, 35, 'energy paid up front');
      await t.throwsCode(function () { return env.services.dungeon.start(g.id, 'dgn_glade'); }, 'RUN_IN_PROGRESS', 'one expedition at a time');
    } },
    { name: 'game: dungeon resolver is fully deterministic from the seed', db: false, fn: function (t) {
      const def = CONFIG.DUNGEONS[0];
      const run = { seed: RNG.seedFromString('guardian-x|dgn_glade|1750000000000') };
      const a = Loot.resolveDungeon(run, def, CONFIG.ITEMS);
      const b = Loot.resolveDungeon(run, def, CONFIG.ITEMS);
      t.deepEqual(a, b, 'same seed, same result');
      t.ok(a.gold >= def.gold[0] && a.gold <= def.gold[1], 'gold in range');
      t.ok(a.xp >= def.xp[0] && a.xp <= def.xp[1], 'xp in range');
      const totalDrops = a.drops.reduce(function (s, d) { return s + d.qty; }, 0);
      t.equal(totalDrops, def.lootRolls, 'every roll lands an item');
    } },
    { name: 'game: claim waits for the timer and applies rewards exactly once', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const clock = fakeClock(1750000000000);
      const dungeon = makeDungeonService(env.repos, { now: function () { return clock.t; } });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Ava' });
      const g = await env.repos.guardians.createForUser(child.id, { name: 'Tide', species: 'TURTLE' });
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ energy: 30 }));
      const started = await dungeon.start(g.id, 'dgn_glade');
      const blocked = await t.throwsCode(function () { return dungeon.claim(started.run.id); }, 'RUN_NOT_FINISHED', 'timer enforced');
      t.ok(blocked.remainingMs > 0, 'remaining time reported');
      clock.tick(10 * 60000 + 1000);
      const claimed = await dungeon.claim(started.run.id);
      t.ok(!claimed.alreadyClaimed, 'first claim applies');
      const after = await env.repos.guardians.get(g.id);
      t.equal(after.gold, claimed.run.result.gold, 'gold landed');
      t.equal(after.xp, claimed.run.result.xp, 'xp landed');
      const inv = await env.repos.inventory.listByUser(child.id);
      const invTotal = inv.reduce(function (s, r) { return s + r.qty; }, 0);
      const dropTotal = claimed.run.result.drops.reduce(function (s, d) { return s + d.qty; }, 0);
      t.equal(invTotal, dropTotal, 'all drops in the satchel');
      t.equal((await env.repos.counters.get(child.id, 'global.dungeons')).value, 1, 'dungeon counter');
      await t.throwsCode(function () { return dungeon.claim(started.run.id); }, 'ALREADY_CLAIMED', 'service refuses re-claim');
      const repoRetry = await env.repos.dungeons.claimRun(started.run.id, claimed.run.result);
      t.ok(repoRetry.alreadyClaimed, 'repo retry is a no-op');
      t.equal((await env.repos.guardians.get(g.id)).gold, after.gold, 'no double rewards');
    } },
    { name: 'game: loot crates open atomically and deterministically', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Iri' });
      await env.repos.guardians.createForUser(child.id, { name: 'Pip', species: 'FOX' });
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ lootCrates: 2 }));
      t.equal(await env.services.loot.crateCount(child.id), 2, 'two crates held');
      const rand = RNG.mulberry32(RNG.seedFromString('demo-crate-1'));
      const pool = CONFIG.ITEMS.filter(function (i) { return i.id !== 'itm_loot_crate'; });
      const expected = Loot.pickItemOfRarity(rand, Loot.rollRarity(rand), pool);
      const opened = await env.services.loot.openCrate(child.id, 'demo-crate-1');
      t.equal(opened.item.id, expected.id, 'seeded open is deterministic');
      t.ok(opened.item.id !== 'itm_loot_crate', 'crates never drop crates');
      t.equal(await env.services.loot.crateCount(child.id), 1, 'one crate consumed');
      const inv = await env.repos.inventory.listByUser(child.id);
      t.ok(inv.some(function (r) { return r.itemId === opened.item.id && r.qty >= 1; }), 'prize granted');
      await env.services.loot.openCrate(child.id, 'demo-crate-2');
      await t.throwsCode(function () { return env.services.loot.openCrate(child.id); }, 'INSUFFICIENT_ITEMS', 'no crates, no prize');
    } },
    { name: 'game: building upgrades follow the cost curve atomically', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Noa' });
      await env.repos.guardians.createForUser(child.id, { name: 'Boop', species: 'BEAR' });
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ coins: 300 }));
      await env.repos.inventory.addItem(child.id, 'itm_wood', 50); // GOTH 1.1: HOME needs Hearthwood
      await env.repos.inventory.addItem(child.id, 'itm_stone', 50); // RUINS materials for the max-level check
      await env.repos.inventory.addItem(child.id, 'itm_clay', 50);
      await env.repos.inventory.addItem(child.id, 'itm_phoenix_feather', 50);
      t.equal(env.services.building.costFor('HOME', 0), 100, 'L0 cost');
      t.equal(env.services.building.costFor('HOME', 1), 160, 'L1 cost (×1.6)');
      const u1 = await env.services.building.upgrade(child.id, 'HOME');
      t.equal(u1.cost, 100, 'charged base'); t.equal(u1.guardian.gold, 200, 'gold spent');
      const u2 = await env.services.building.upgrade(child.id, 'HOME');
      t.equal(u2.cost, 160, 'curve applied'); t.equal(u2.building.level, 2, 'level 2');
      const broke = await t.throwsCode(function () { return env.services.building.upgrade(child.id, 'HOME'); }, 'INSUFFICIENT_GOLD', 'cannot afford 256');
      t.equal(broke.cost, 256, 'cost reported');
      const g = await env.repos.guardians.getByUser(child.id);
      t.equal(g.gold, 40, 'gold untouched by failed upgrade');
      await env.repos.buildings.setLevel(child.id, 'RUINS', 5);
      await t.throwsCode(function () { return env.services.building.upgrade(child.id, 'RUINS'); }, 'MAX_LEVEL', 'cap enforced');
      const overview = await env.services.building.overview(child.id);
      t.equal(overview.find(function (b) { return b.type === 'RUINS'; }).nextCost, null, 'maxed shows no next cost');
    } },
    { name: 'game: sanctuary levels raise the guardian energy cap', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Rio' });
      await env.repos.guardians.createForUser(child.id, { name: 'Sol', species: 'PHOENIX' });
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ coins: 1000 }));
      await env.repos.inventory.addItem(child.id, 'itm_fiber', 50); // GOTH 1.1: SANCTUARY needs Wild Fiber
      await env.services.building.upgrade(child.id, 'SANCTUARY');
      t.equal((await env.repos.guardians.getByUser(child.id)).maxEnergy, 110, '+10 per level');
      await env.services.building.upgrade(child.id, 'SANCTUARY');
      const g = await env.repos.guardians.getByUser(child.id);
      t.equal(g.maxEnergy, 120, 'level 2 cap');
      const filled = await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ energy: 999 }));
      t.equal(filled.guardian.energy, 120, 'energy clamps at the new cap');
    } },
    { name: 'game: achievements unlock from counters exactly once', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Zee' });
      await env.repos.counters.increment(child.id, 'cat.HYDRATION', 1);
      const first = await env.services.achievement.evaluate(child.id);
      t.equal(first.newlyUnlocked.length, 0, 'progress without unlock');
      await env.repos.counters.increment(child.id, 'global.approvals', 1);
      const second = await env.services.achievement.evaluate(child.id);
      t.equal(second.newlyUnlocked.length, 1, 'first approval unlocks First Spark');
      t.equal(second.newlyUnlocked[0].id, 'ach_first_approval', 'correct badge');
      const rows = await env.services.achievement.listForUser(child.id);
      const spark = rows.find(function (r) { return r.def.id === 'ach_first_approval'; });
      t.ok(spark.unlockedAt !== undefined, 'unlock timestamp set');
      const third = await env.services.achievement.evaluate(child.id);
      t.equal(third.newlyUnlocked.length, 0, 'no re-unlock');
      const sparkAgain = (await env.services.achievement.listForUser(child.id)).find(function (r) { return r.def.id === 'ach_first_approval'; });
      t.equal(sparkAgain.unlockedAt, spark.unlockedAt, 'timestamp stable');
    } },
    { name: 'game: approvals advance category streaks alongside the global one', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Michel' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Kai' });
      await env.repos.guardians.createForUser(child.id, { name: 'Luno', species: 'OWL' });
      await env.services.auth.setupPin(parent.id, '4321');
      const session = await env.services.auth.verifyPin(parent.id, '4321');
      const s1 = await env.services.quest.submit(child.id, 'qst_water_glass');
      await env.services.approval.approve(session.token, s1.id);
      const s2 = await env.services.quest.submit(child.id, 'qst_brush_teeth');
      await env.services.approval.approve(session.token, s2.id);
      const streaks = await env.repos.streaks.listByUser(child.id);
      function scope(s) { return streaks.find(function (r) { return r.scope === s; }); }
      t.equal(scope('GLOBAL').current, 1, 'global streak (same day stays 1)');
      t.equal(scope('HYDRATION').current, 1, 'hydration streak');
      t.equal(scope('HEALTH').current, 1, 'health streak');
    } },
    { name: 'game: validator demands a result on claimed runs', db: false, fn: async function (t) {
      const base = { id: 'r1', guardianId: 'g1', dungeonId: 'dgn_glade', seed: 1, startedAt: 1, endsAt: 2 };
      await t.throwsCode(function () {
        Validation.validateForStore('dungeonRuns', Object.assign({}, base, { claimed: true }));
      }, 'BAD_SHAPE', 'claimed without result rejected');
      Validation.validateForStore('dungeonRuns', Object.assign({}, base, {
        claimed: true, result: { gold: 5, xp: 8, drops: [{ itemId: 'itm_wood', qty: 1 }] },
      }));
      t.ok(true, 'claimed with result validates');
    } },
    { name: 'game: full loop — submit, approve, raid, claim, achieve, chain intact', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Cristian' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Demo Kid' });
      const g = await env.repos.guardians.createForUser(child.id, { name: 'Pip', species: 'FOX' });
      await env.services.auth.setupPin(parent.id, '2468');
      const session = await env.services.auth.verifyPin(parent.id, '2468');
      for (let i = 0; i < 4; i++) {
        const sub = await env.services.quest.submit(child.id, 'qst_water_glass');
        await env.services.approval.approve(session.token, sub.id);
      }
      await t.throwsCode(function () { return env.services.quest.submit(child.id, 'qst_water_glass'); }, 'MAX_PER_DAY_REACHED', '4/day cap holds');
      let guardian = await env.repos.guardians.get(g.id);
      t.equal(guardian.energy, 20, 'four approvals = 20 energy');
      t.equal(guardian.gold, 20, 'and 20 gold');
      const clock = fakeClock(Date.now());
      const dungeon = makeDungeonService(env.repos, { now: function () { return clock.t; } });
      const started = await dungeon.start(g.id, 'dgn_glade');
      clock.tick(10 * 60000 + 1000);
      const claimed = await dungeon.claim(started.run.id);
      guardian = await env.repos.guardians.get(g.id);
      t.equal(guardian.gold, 20 + claimed.run.result.gold, 'raid gold stacked on quest gold');
      const ach = await env.services.achievement.evaluate(child.id);
      t.ok(ach.newlyUnlocked.some(function (d) { return d.id === 'ach_first_approval'; }), 'First Spark unlocked');
      t.equal((await env.repos.counters.get(child.id, 'global.approvals')).value, 4, 'approval counter');
      t.equal((await env.repos.counters.get(child.id, 'global.dungeons')).value, 1, 'dungeon counter');
      const chain = await env.services.integrity.verifyChain();
      t.ok(chain.valid && chain.length === 4, 'four decisions, chain intact');
    } },

    /* ---- Phase 5: state store ---- */
    { name: 'store: boot hydrates app state from an empty database', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      const r = await store.dispatch(Actions.boot());
      t.ok(r.ok, 'boot succeeds');
      const s = store.getState();
      t.equal(s.boot, 'READY', 'ready');
      t.equal(s.users.length, 0, 'no users yet');
      t.equal(s.activeChildId, null, 'no active child');
      t.ok(s.chain && s.chain.valid && s.chain.length === 0, 'empty chain valid');
      t.ok(!!s.itemsById['itm_loot_crate'], 'item catalog loaded into state');
    } },
    { name: 'store: createChild selects and persists across store reboots', db: true, fn: async function (t, env) {
      const ctx = { db: env.db, repos: env.repos, services: env.services };
      const store = makeStore(ctx);
      await store.dispatch(Actions.boot());
      const made = await store.dispatch(Actions.createChild('Mila', '🧒', 'Pip', 'FOX'));
      t.ok(made.ok, 'child created');
      t.equal(store.getState().guardian.name, 'Pip', 'guardian hydrated');
      const store2 = makeStore(ctx);
      await store2.dispatch(Actions.boot());
      const s2 = store2.getState();
      t.equal(s2.activeChildId, made.child.id, 'active child persisted to meta');
      t.equal(s2.guardian.species, 'FOX', 'bundle rehydrated on reboot');
    } },
    { name: 'store: submitQuest flows into pending and the quest board', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.createChild('Theo', '🧒', 'Ember', 'DRAGON'));
      const r = await store.dispatch(Actions.submitQuest('qst_water_glass'));
      t.ok(r.ok, 'submitted');
      const s = store.getState();
      t.equal(s.pending.length, 1, 'pending in state');
      t.equal(s.pending[0].status, 'PENDING', 'born pending');
      const water = s.questBoard.find(function (b) { return b.quest.id === 'qst_water_glass'; });
      t.equal(water.remainingToday, 3, 'board count updated');
      t.equal(s.guardian.energy, 0, 'no rewards before approval');
    } },
    { name: 'store: unlock rejects wrong PINs without opening a session', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.setupParent('Keeper', '1234'));
      t.ok(store.getState().parentHasPin, 'pin status tracked');
      const bad = await store.dispatch(Actions.unlock('9999'));
      t.ok(!bad.ok && bad.code === 'WRONG_PIN', 'wrong pin refused');
      const s1 = store.getState();
      t.equal(s1.session, null, 'no session opened');
      t.equal(s1.mode, 'CHILD_MODE', 'still child mode');
      t.ok(s1.ui.gateToast && s1.ui.gateToast.kind === 'bad', 'gate toast set');
      const good = await store.dispatch(Actions.unlock('1234'));
      t.ok(good.ok, 'correct pin unlocks');
      const s2 = store.getState();
      t.ok(s2.session && s2.session.token, 'session in state');
      t.equal(s2.mode, 'PARENT_MODE', 'mode switched');
    } },
    { name: 'store: approve through the store updates everything at once', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.createChild('Ava', '🧒', 'Luno', 'OWL'));
      await store.dispatch(Actions.submitQuest('qst_water_glass'));
      await store.dispatch(Actions.setupParent('Keeper', '4321'));
      await store.dispatch(Actions.unlock('4321'));
      const subId = store.getState().pending[0].id;
      const r = await store.dispatch(Actions.approve(subId));
      t.ok(r.ok, 'approved');
      const s = store.getState();
      t.equal(s.pending.length, 0, 'pending cleared');
      t.equal(s.guardian.energy, 5, 'energy released');
      t.equal(s.guardian.gold, 5, 'gold released');
      t.equal(Selectors.selectGlobalStreak(s), 1, 'streak in state');
      t.ok(s.chain.valid && s.chain.length === 1, 'chain re-verified in state');
      const spark = s.achievements.find(function (a) { return a.def.id === 'ach_first_approval'; });
      t.ok(spark && spark.unlockedAt !== undefined, 'achievement unlocked');
      t.ok(s.ui.celebration && s.ui.celebration.type === 'achievement', 'celebration queued');
    } },
    { name: 'store: approving without a live session changes nothing', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.createChild('Noa', '🧒', 'Boop', 'BEAR'));
      await store.dispatch(Actions.submitQuest('qst_make_bed'));
      const before = store.getState();
      const r = await store.dispatch(Actions.approve(before.pending[0].id));
      t.ok(!r.ok && r.code === 'SESSION_REQUIRED', 'refused without session');
      const after = store.getState();
      t.deepEqual(after.guardian, before.guardian, 'guardian untouched');
      t.equal(after.pending.length, 1, 'submission still pending');
      t.equal(after.chain.length, 0, 'no audit entries');
    } },
    { name: 'store: dungeons are fully drivable through actions', db: true, fn: async function (t, env) {
      const clock = fakeClock(1750000000000);
      const services = makeServices(env.db, env.repos, { now: function () { return clock.t; } });
      const store = makeStore({ db: env.db, repos: env.repos, services: services, now: function () { return clock.t; } });
      await store.dispatch(Actions.boot());
      const made = await store.dispatch(Actions.createChild('Rio', '🧒', 'Sol', 'PHOENIX'));
      await env.repos.guardians.applyBundle(made.child.id, Rewards.normalizeBundle({ energy: 30 }));
      await store.dispatch(Actions.refreshChild());
      const started = await store.dispatch(Actions.startDungeon('dgn_glade'));
      t.ok(started.ok, 'started');
      let s = store.getState();
      t.ok(s.dungeon.activeRun, 'active run in state');
      t.equal(s.guardian.energy, 15, 'energy paid');
      const early = await store.dispatch(Actions.claimDungeon(s.dungeon.activeRun.id));
      t.ok(!early.ok && early.code === 'RUN_NOT_FINISHED', 'timer enforced through store');
      clock.tick(10 * 60000 + 1000);
      store.dispatch(Actions.tick(clock.t));
      const view = Selectors.selectDungeonView(store.getState());
      t.ok(view.find(function (d) { return d.def.id === 'dgn_glade'; }).claimable, 'selector says claimable');
      const claimed = await store.dispatch(Actions.claimDungeon(s.dungeon.activeRun.id));
      t.ok(claimed.ok, 'claimed');
      s = store.getState();
      t.equal(s.guardian.gold, claimed.result.gold, 'gold in state');
      t.equal(s.dungeon.activeRun, null, 'run cleared after claim');
      t.ok(s.inventory.length > 0, 'drops in state inventory');
    } },
    { name: 'store: crates and buildings mutate state snapshots', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const made = await store.dispatch(Actions.createChild('Iri', '🧒', 'Ash', 'WOLF'));
      await env.repos.guardians.applyBundle(made.child.id, Rewards.normalizeBundle({ coins: 300, lootCrates: 1 }));
      await env.repos.inventory.addItem(made.child.id, 'itm_wood', 50); // GOTH 1.1: HOME needs Hearthwood
      await store.dispatch(Actions.refreshChild());
      t.equal(store.getState().crates, 1, 'crate in state');
      const opened = await store.dispatch(Actions.openCrate());
      t.ok(opened.ok, 'opened');
      let s = store.getState();
      t.equal(s.crates, 0, 'crate consumed in state');
      t.ok(s.inventory.some(function (r) { return r.itemId === opened.item.id; }), 'prize in state');
      const up = await store.dispatch(Actions.upgradeBuilding('HOME'));
      t.ok(up.ok, 'upgraded');
      s = store.getState();
      t.equal(s.buildings.find(function (b) { return b.type === 'HOME'; }).level, 1, 'level in state');
      t.equal(s.guardian.gold, 200, 'gold spent in state');
    } },
    { name: 'store: selectors derive views the UI can render directly', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const made = await store.dispatch(Actions.createChild('Zee', '🧒', 'Shelly', 'TURTLE'));
      await env.repos.guardians.applyBundle(made.child.id, Rewards.normalizeBundle({ energy: 20, lootCrates: 1 }));
      await store.dispatch(Actions.refreshChild());
      const inv = Selectors.selectInventoryDetailed(store.getState());
      t.ok(inv.length === 1 && inv[0].item && inv[0].item.name, 'inventory joined with catalog');
      await store.dispatch(Actions.startDungeon('dgn_glade'));
      store.dispatch(Actions.tick(Date.now()));
      const view = Selectors.selectDungeonView(store.getState());
      const glade = view.find(function (d) { return d.def.id === 'dgn_glade'; });
      t.ok(glade.isActive && glade.remainingMs > 0 && !glade.claimable, 'countdown derived');
      t.ok(view.find(function (d) { return d.def.id === 'dgn_tide'; }).blocked, 'other dungeons blocked');
      t.ok(!Selectors.selectCanApprove(store.getState()), 'cannot approve locked');
      await store.dispatch(Actions.setupParent('Keeper', '2468'));
      await store.dispatch(Actions.unlock('2468'));
      store.dispatch(Actions.tick(Date.now()));
      t.ok(Selectors.selectCanApprove(store.getState()), 'can approve unlocked');
    } },
    { name: 'store: reducer is pure — unknown actions are identity, tick moves only the clock', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const s1 = store.getState();
      store.dispatch({ type: '@@unknown/action' });
      t.ok(store.getState() === s1, 'unknown action preserves identity');
      store.dispatch(Actions.tick(s1.now + 5000));
      const s2 = store.getState();
      t.ok(s2 !== s1, 'tick produces a new state object');
      t.equal(s2.now, s1.now + 5000, 'clock advanced');
      t.ok(s2.users === s1.users && s2.questBoard === s1.questBoard, 'untouched slices keep their references');
    } },
    { name: 'store: switching children swaps the whole bundle', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const a = await store.dispatch(Actions.createChild('Kid A', '🧒', 'Pip', 'FOX'));
      await env.repos.guardians.applyBundle(a.child.id, Rewards.normalizeBundle({ energy: 50 }));
      await store.dispatch(Actions.refreshChild());
      t.equal(store.getState().guardian.energy, 50, 'A charged');
      await store.dispatch(Actions.createChild('Kid B', '🧒', 'Luno', 'OWL'));
      let s = store.getState();
      t.equal(s.guardian.name, 'Luno', 'B active after creation');
      t.equal(s.guardian.energy, 0, 'B starts empty');
      await store.dispatch(Actions.selectChild(a.child.id));
      s = store.getState();
      t.equal(s.guardian.name, 'Pip', 'switched back to A');
      t.equal(s.guardian.energy, 50, 'A bundle restored');
      t.equal(Selectors.selectChildren(s).length, 2, 'both kids in state');
    } },
    { name: 'store: session expiry on tick closes parent mode', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.setupParent('Keeper', '1357'));
      await store.dispatch(Actions.unlock('1357'));
      const exp = store.getState().session.expiresAt;
      store.dispatch(Actions.tick(exp + 1));
      const s = store.getState();
      t.equal(s.session, null, 'session cleared by the clock');
      t.equal(s.mode, 'CHILD_MODE', 'mode dropped to child');
      t.ok(s.ui.gateToast && s.ui.gateToast.kind === 'bad', 'expiry surfaced');
    } },
    { name: 'store: parent overview aggregates every child into one queue', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const a = await store.dispatch(Actions.createChild('Kid A', '🧒', 'Pip', 'FOX'));
      await store.dispatch(Actions.submitQuest('qst_water_glass'));
      await store.dispatch(Actions.createChild('Kid B', '🧒', 'Luno', 'OWL'));
      await store.dispatch(Actions.submitQuest('qst_make_bed'));
      await store.dispatch(Actions.setupParent('Keeper', '8642'));
      await store.dispatch(Actions.unlock('8642'));
      await store.dispatch(Actions.loadParentOverview());
      let s = store.getState();
      t.equal(s.family.length, 2, 'both kids in the family view');
      t.equal(s.parentQueue.length, 2, 'queue spans children');
      t.ok(s.parentQueue[0].questTitle && s.parentQueue[0].child.name, 'queue rows carry names');
      t.equal(s.family.reduce(function (n, f) { return n + f.pendingCount; }, 0), 2, 'pending counts add up');
      const first = s.parentQueue[0];
      const r = await store.dispatch(Actions.approve(first.submission.id));
      t.ok(r.ok, 'approve from the queue works');
      s = store.getState();
      t.equal(s.parentQueue.length, 1, 'queue auto-refreshes after a decision');
      t.ok(s.parentQueue[0].child.id !== first.child.id || s.parentQueue[0].submission.id !== first.submission.id, 'decided row gone');
    } },
    { name: 'store: changePin rotates the credential', db: true, fn: async function (t, env) {
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      await store.dispatch(Actions.setupParent('Keeper', '1111'));
      await store.dispatch(Actions.unlock('1111'));
      const ch = await store.dispatch(Actions.changePin('1111', '2222'));
      t.ok(ch.ok, 'pin changed');
      await store.dispatch(Actions.lock());
      const bad = await store.dispatch(Actions.unlock('1111'));
      t.ok(!bad.ok && bad.code === 'WRONG_PIN', 'old pin refused');
      const good = await store.dispatch(Actions.unlock('2222'));
      t.ok(good.ok, 'new pin unlocks');
    } },

    /* ---- Phase 7: tamper evidence, invariants, hardening ---- */
    { name: 'tamper: editing a decision in place is detected and located', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Mila' });
      await env.repos.guardians.createForUser(child.id, { name: 'Pip', species: 'FOX' });
      await env.services.auth.setupPin(parent.id, '9753');
      const session = await env.services.auth.verifyPin(parent.id, '9753');
      for (let i = 0; i < 2; i++) {
        const sub = await env.services.quest.submit(child.id, 'qst_water_glass');
        await env.services.approval.approve(session.token, sub.id);
      }
      t.ok((await env.services.integrity.verifyChain()).valid, 'chain valid before the attack');
      const entries = (await env.repos.audit.list()).sort(function (a, b) { return a.timestamp - b.timestamp; });
      // Simulate a DevTools attacker: raw write, bypassing every repository.
      await env.db.atomic(['auditLogs'], async function (c) {
        const evil = Object.assign({}, entries[0], { entityId: 'forged-' + entries[0].entityId });
        await c.put('auditLogs', evil);
      });
      const report = await env.services.integrity.verifyChain();
      t.ok(!report.valid, 'tampering detected');
      t.equal(report.reason, 'TAMPERED_ENTRY', 'named for what it is');
      t.equal(report.verified, 0, 'located at the first link');
    } },
    { name: 'tamper: rewriting the chain head is detected', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Theo' });
      await env.repos.guardians.createForUser(child.id, { name: 'Ember', species: 'DRAGON' });
      await env.services.auth.setupPin(parent.id, '8642');
      const session = await env.services.auth.verifyPin(parent.id, '8642');
      const sub = await env.services.quest.submit(child.id, 'qst_make_bed');
      await env.services.approval.approve(session.token, sub.id);
      await env.db.atomic(['meta'], async function (c) {
        await c.put('meta', { key: 'auditHead', value: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
      });
      const report = await env.services.integrity.verifyChain();
      t.ok(!report.valid, 'head rewrite detected');
      t.equal(report.reason, 'HEAD_MISMATCH', 'head no longer matches the verified chain');
    } },
    { name: 'tamper: deleting a link strands the entries after it', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Ava' });
      await env.repos.guardians.createForUser(child.id, { name: 'Luno', species: 'OWL' });
      await env.services.auth.setupPin(parent.id, '2468');
      const session = await env.services.auth.verifyPin(parent.id, '2468');
      for (let i = 0; i < 3; i++) {
        const sub = await env.services.quest.submit(child.id, 'qst_water_glass');
        await env.services.approval.approve(session.token, sub.id);
      }
      const entries = (await env.repos.audit.list()).sort(function (a, b) { return a.timestamp - b.timestamp; });
      await env.db.atomic(['auditLogs'], async function (c) {
        await c.del('auditLogs', entries[1].id);
      });
      const report = await env.services.integrity.verifyChain();
      t.ok(!report.valid, 'missing link detected');
      t.equal(report.reason, 'ORPHANED_ENTRIES', 'later entries cannot connect to the chain');
      t.equal(report.verified, 1, 'only the first link still verifies');
    } },
    { name: 'streaks: consecutive days climb, missed days decay gently, best never falls', db: false, fn: function (t) {
      let s = { current: 0, best: 0, lastActiveDay: undefined };
      s = Object.assign(s, Streaks.applyActivity(s, '2026-06-01'));
      s = Object.assign(s, Streaks.applyActivity(s, '2026-06-02'));
      s = Object.assign(s, Streaks.applyActivity(s, '2026-06-03'));
      t.equal(s.current, 3, 'three days running');
      const again = Streaks.applyActivity(s, '2026-06-03');
      t.equal(again.current, 3, 'same day is a no-op');
      s = Object.assign(s, Streaks.applyActivity(s, '2026-06-05'));
      t.equal(s.current, Math.floor(3 * CONFIG.STREAK.DECAY_PER_MISSED_DAY) + 1, 'one missed day decays then counts today');
      t.equal(s.best, 3, 'best is never reduced');
      let threw = null;
      try { Streaks.applyActivity(s, '2026-06-01'); } catch (e) { threw = e; }
      t.ok(threw && threw.code === 'TIME_BACKWARDS', 'time cannot run backwards');
    } },
    { name: 'economy: two hundred seeded raids stay inside the configured bounds', db: false, fn: function (t) {
      const def = CONFIG.DUNGEONS[2];
      for (let i = 0; i < 200; i++) {
        const r = Loot.resolveDungeon({ seed: RNG.seedFromString('sweep-' + i) }, def, CONFIG.ITEMS);
        if (r.gold < def.gold[0] || r.gold > def.gold[1]) return t.ok(false, 'gold out of range at seed ' + i);
        if (r.xp < def.xp[0] || r.xp > def.xp[1]) return t.ok(false, 'xp out of range at seed ' + i);
        const total = r.drops.reduce(function (s, d) { return s + d.qty; }, 0);
        if (total !== def.lootRolls) return t.ok(false, 'drop count drifted at seed ' + i);
      }
      t.ok(true, '200/200 inside bounds');
      const rand = RNG.mulberry32(RNG.seedFromString('rarity-census'));
      const counts = {};
      for (let i = 0; i < 3000; i++) {
        const r = Loot.rollRarity(rand);
        counts[r] = (counts[r] || 0) + 1;
      }
      t.ok((counts.COMMON || 0) > 1000, 'commons dominate (' + counts.COMMON + '/3000)');
      t.ok((counts.MYTHIC || 0) < 150, 'mythics stay mythic (' + (counts.MYTHIC || 0) + '/3000)');
      t.ok((counts.COMMON || 0) > (counts.MYTHIC || 0) * 5, 'distribution is shaped as configured');
    } },
    { name: 'limits: balances clamp at their caps instead of overflowing', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Noa' });
      await env.repos.guardians.createForUser(child.id, { name: 'Boop', species: 'BEAR' });
      const filled = await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ energy: 99999 }));
      t.equal(filled.guardian.energy, filled.guardian.maxEnergy, 'energy clamps at the cap');
      await env.repos.inventory.addItem(child.id, 'itm_wood', CONFIG.LIMITS.MAX_QTY);
      const row = await env.repos.inventory.addItem(child.id, 'itm_wood', 5);
      t.equal(row.qty, CONFIG.LIMITS.MAX_QTY, 'inventory clamps at MAX_QTY');
      let threw = null;
      try { Rewards.normalizeBundle({ coins: -5 }); Validation.validateBundle(Rewards.normalizeBundle({ coins: -5 })); } catch (e) { threw = e; }
      t.ok(threw, 'negative bundles are refused');
    } },
    { name: 'gate: a decided submission can never be decided again', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Rio' });
      await env.repos.guardians.createForUser(child.id, { name: 'Sol', species: 'PHOENIX' });
      await env.services.auth.setupPin(parent.id, '1357');
      const session = await env.services.auth.verifyPin(parent.id, '1357');
      const sub = await env.services.quest.submit(child.id, 'qst_water_glass');
      await env.services.approval.approve(session.token, sub.id);
      let threw = null;
      try { await env.services.approval.approve(session.token, sub.id); } catch (e) { threw = e; }
      t.ok(threw && threw.code, 'second approval refused (' + (threw && threw.code) + ')');
      threw = null;
      try { await env.services.approval.reject(session.token, sub.id, 'changed my mind'); } catch (e) { threw = e; }
      t.ok(threw && threw.code, 'reject-after-approve refused (' + (threw && threw.code) + ')');
      const fresh = await env.repos.submissions.get(sub.id);
      t.equal(fresh.status, 'APPROVED', 'decision is immutable');
      const chain = await env.services.integrity.verifyChain();
      t.ok(chain.valid && chain.length === 1, 'exactly one decision on the chain');
    } },
    { name: 'data: reseeding an existing world changes nothing', db: true, fn: async function (t, env) {
      const first = await env.services.seed.seedIfEmpty();
      t.ok(first.seeded, 'first boot seeds');
      const quests1 = (await env.repos.quests.list()).length;
      const items1 = (await env.repos.items.list()).length;
      const second = await env.services.seed.seedIfEmpty();
      t.ok(!second.seeded, 'second boot recognizes the world');
      t.equal((await env.repos.quests.list()).length, quests1, 'quest catalog stable');
      t.equal((await env.repos.items.list()).length, items1, 'item catalog stable');
      t.ok((await env.repos.meta.get('schemaVersion')) !== undefined, 'schema version recorded');
    } },
    { name: 'validation: hostile shapes are refused at the door', db: true, fn: async function (t, env) {
      let threw = null;
      try { await env.repos.users.create({ role: 'CHILD', name: 'x'.repeat(200) }); } catch (e) { threw = e; }
      t.ok(threw, 'absurd names refused');
      threw = null;
      try { await env.repos.users.create({ role: 'WIZARD', name: 'Hax' }); } catch (e) { threw = e; }
      t.ok(threw, 'unknown roles refused');
      threw = null;
      try {
        Validation.validateForStore('guardians', {
          id: 'g1', userId: 'u1', name: 'Pip', species: 'FOX',
          level: 1, xp: 0, energy: NaN, maxEnergy: 100, gold: 0, affection: 0,
        });
      } catch (e) { threw = e; }
      t.ok(threw, 'NaN balances refused');
    } },
    { name: 'backup: the audit chain and credentials survive a full round-trip', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Iri' });
      await env.repos.guardians.createForUser(child.id, { name: 'Ash', species: 'WOLF' });
      await env.services.auth.setupPin(parent.id, '4680');
      const session = await env.services.auth.verifyPin(parent.id, '4680');
      for (let i = 0; i < 2; i++) {
        const sub = await env.services.quest.submit(child.id, 'qst_water_glass');
        await env.services.approval.approve(session.token, sub.id);
      }
      const backup = await env.services.backup.export();
      await env.db.clearAllStores();
      t.equal((await env.repos.audit.list()).length, 0, 'world wiped');
      await env.services.backup.importReplace(backup);
      const chain = await env.services.integrity.verifyChain();
      t.ok(chain.valid && chain.length === 2, 'chain restored and still verifies');
      const back = await env.services.auth.verifyPin(parent.id, '4680');
      t.ok(back && back.token, 'credentials restored — the PIN still opens the gate');
      const g = await env.repos.guardians.getByUser(child.id);
      t.equal(g.energy, 10, 'guardian balances restored exactly');
    } },
    { name: 'store: boot adopts an orphaned child automatically', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const kid = await env.repos.users.create({ role: 'CHILD', name: 'Legacy Kid' });
      await env.repos.guardians.createForUser(kid.id, { name: 'Pip', species: 'FOX' });
      // No app.activeChildId was ever written — data from before the store era.
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const s = store.getState();
      t.equal(s.activeChildId, kid.id, 'first child adopted as active');
      t.ok(s.guardian && s.guardian.name === 'Pip', 'bundle hydrated for the adopted child');
      t.equal(await env.repos.meta.get('app.activeChildId'), kid.id, 'adoption persisted');
    } },
    { name: 'recovery: time-travelled records are healed at boot', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const kid = await env.repos.users.create({ role: 'CHILD', name: 'Tess' });
      await env.repos.guardians.createForUser(kid.id, { name: 'Pip', species: 'FOX' });
      await env.services.auth.setupPin(parent.id, '5151');
      const future = Date.now() + 3 * 86400000;
      await env.db.atomic(['submissions', 'streaks'], async function (c) {
        await c.put('submissions', { id: 'sub_tt', userId: kid.id, questId: 'qst_water_glass', status: 'PENDING', submittedAt: future });
        await c.put('streaks', { id: 'stk_tt', userId: kid.id, scope: 'GLOBAL', current: 4, best: 4, lastActiveDay: '2999-12-31' });
      });
      const store = makeStore({ db: env.db, repos: env.repos, services: env.services });
      await store.dispatch(Actions.boot());
      const subs = await env.db.getAll('submissions');
      const tt = subs.find(function (s) { return s.id === 'sub_tt'; });
      t.ok(tt.submittedAt <= Date.now() + 1000, 'future submission clamped back to now');
      const session = await env.services.auth.verifyPin(parent.id, '5151');
      await env.services.approval.approve(session.token, 'sub_tt');
      const g = await env.repos.guardians.getByUser(kid.id);
      t.ok(g.energy > 0, 'approval succeeds after healing — no TIME_BACKWARDS');
      const streaks = await env.repos.streaks.listByUser(kid.id);
      const glob = streaks.find(function (x) { return x.scope === 'GLOBAL'; });
      t.ok(glob.lastActiveDay <= TimeUtil.todayStr(new Date()), 'streak day pulled back to today');
      t.ok(glob.best >= 4, 'best streak preserved');
    } },
    { name: 'flame: only approved kindness feeds the family flame', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Mila' });
      await env.repos.guardians.createForUser(child.id, { name: 'Ember', species: 'DRAGON' });
      await env.services.auth.setupPin(parent.id, '2468');
      const session = await env.services.auth.verifyPin(parent.id, '2468');
      const F = CONFIG.FLAME;
      const s1 = await env.repos.submissions.createPending(child.id, 'qst_water_glass');
      await env.services.approval.approve(session.token, s1.id);
      t.equal(await env.repos.counters.get(F.FAMILY_ID, F.KEY), null, 'hydration does not feed the flame');
      const s2 = await env.repos.submissions.createPending(child.id, 'qst_help_parent');
      await env.services.approval.approve(session.token, s2.id);
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.KINDNESS, 'kindness feeds it');
      const s3 = await env.repos.submissions.createPending(child.id, 'qst_gratitude');
      await env.services.approval.approve(session.token, s3.id);
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.KINDNESS * 2, 'gratitude flows at the kindness rate until quest plumbing (F3)');
      const ev = await env.services.achievement.evaluate(child.id);
      t.ok(ev.newlyUnlocked.some(function (d) { return d.id === 'ach_first_approval'; }), 'First Spark unlocked');
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.KINDNESS * 2 + F.SOURCES.ACHIEVEMENT, 'achievement adds its spark');
      await env.services.achievement.evaluate(child.id);
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.KINDNESS * 2 + F.SOURCES.ACHIEVEMENT, 'no double-spark on re-evaluate');
    } },
    { name: 'daynight: phases and hearth glow derive from the clock', db: false, fn: function (t) {
      function at(h, m) { const d = new Date(2025, 0, 15, h, m || 0); return TimeOfDay.describe(d); }
      t.equal(at(6).id, 'dawn', '6am is dawn');
      t.equal(at(12).id, 'day', 'noon is day');
      t.equal(at(18).id, 'dusk', '6pm is dusk');
      t.equal(at(22).id, 'night', '10pm is night');
      t.equal(at(2).id, 'night', '2am is night');
      t.ok(at(22).hearthGlow > at(12).hearthGlow, 'hearth burns brighter at night than noon');
      t.equal(at(22).hearthGlow, 1, 'hearth at full glow at night');
      t.ok(at(2).isNight, '2am flagged as night');
      t.ok(at(12).stars === 0, 'no stars at noon');
      t.ok(at(22).arc >= 0 && at(22).arc <= 1, 'moon arc within range');
    } },
    { name: 'flame: stages and memories map to thresholds', db: false, fn: function (t) {
      const checks = [[0, 0], [59, 0], [60, 1], [239, 1], [240, 2], [699, 2], [700, 3], [1799, 3], [1800, 4], [99999, 4]];
      checks.forEach(function (c) { t.equal(Flame.stageIndex(c[0]), c[1], c[0] + ' pts -> stage ' + c[1]); });
      t.equal(Flame.describe(1000).memories.length, 2, 'two whispers unlocked at 1000');
      t.equal(Flame.describe(1800).memories.length, 4, 'all four at 1800 — Shia speaks');
      t.equal(Flame.describe(150).progress, 0.5, 'meter halfway through stage 1');
      t.equal(Flame.describe(0).name, 'The Sleeping Spark', 'stage names wired');
    } },
    { name: 'flame: evolution crossings spark it, and it survives backup', db: true, fn: async function (t, env) {
      await env.services.seed.seedIfEmpty();
      const parent = await env.repos.users.create({ role: 'PARENT', name: 'Keeper' });
      const child = await env.repos.users.create({ role: 'CHILD', name: 'Theo' });
      await env.repos.guardians.createForUser(child.id, { name: 'Pip', species: 'FOX' });
      await env.services.auth.setupPin(parent.id, '1357');
      const session = await env.services.auth.verifyPin(parent.id, '1357');
      await env.repos.guardians.applyBundle(child.id, Rewards.normalizeBundle({ xp: 1430 }));
      t.equal((await env.repos.guardians.getByUser(child.id)).level, 9, 'one homework away from evolution');
      const sub = await env.repos.submissions.createPending(child.id, 'qst_homework');
      await env.services.approval.approve(session.token, sub.id);
      const F = CONFIG.FLAME;
      t.equal((await env.repos.guardians.getByUser(child.id)).level, 10, 'crossed into stage two');
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.EVOLUTION, 'evolution sparked the family flame');
      const backup = await env.services.backup.export();
      await env.db.clearAllStores();
      await env.services.backup.importReplace(backup);
      t.equal((await env.repos.counters.get(F.FAMILY_ID, F.KEY)).value, F.SOURCES.EVOLUTION, 'flame survives a backup round-trip');
    } },
  ];

  // Tests verify mechanics on a clean L1 baseline, so they disable the welcome grant.
  let STARTER_DISABLED = false;
  const TestSuite = {
    count: TESTS.length,
    // makeEnv: async () => { db, repos, services, reset() } — injected by the
    // host (node: memory backend; browser harness: real IndexedDB test DB).
    runAll: async function (makeEnv, onResult) {
      const results = [];
      STARTER_DISABLED = true; // tests use the clean baseline
      const env = await makeEnv();
      for (const test of TESTS) {
        const t = makeAssert();
        const started = Date.now();
        let ok = true; let error = null;
        try {
          if (test.db) await env.reset();
          await test.fn(t, env);
        } catch (e) {
          ok = false; error = (e && e.message) || String(e);
        }
        const rec = { name: test.name, ok: ok, ms: Date.now() - started, error: error };
        results.push(rec);
        if (onResult) onResult(rec);
      }
      if (env.close) await env.close();
      return results;
    },
  };

  /* ==========================================================================
     Public surface
     ========================================================================== */
  GOTH.CONFIG = CONFIG;
  GOTH.ENUMS = ENUMS;
  GOTH.SCHEMA = SCHEMA;
  GOTH.STORE_NAMES = STORE_NAMES;
  GOTH.Flame = Flame;
  GOTH.TimeOfDay = TimeOfDay;
  GOTH.Ids = Ids;
  GOTH.RNG = RNG;
  GOTH.Leveling = Leveling;
  GOTH.Loot = Loot;
  GOTH.Building = Building;
  GOTH.Cosmetics = Cosmetics;
  GOTH.TimeUtil = TimeUtil;
  GOTH.Streaks = Streaks;
  GOTH.Rewards = Rewards;
  GOTH.questRewardBundle = questRewardBundle;
  GOTH.canSubmitQuest = canSubmitQuest;
  GOTH.Canon = Canon;
  GOTH.sha256Hex = sha256Hex;
  GOTH.Validation = Validation;
  GOTH.ValidationError = ValidationError;
  GOTH.createIdbBackend = createIdbBackend;
  GOTH.makeDB = makeDB;
  GOTH.makeRepositories = makeRepositories;
  GOTH.makeAuthService = makeAuthService;
  GOTH.makeAuditService = makeAuditService;
  GOTH.makeIntegrityService = makeIntegrityService;
  GOTH.makeApprovalService = makeApprovalService;
  GOTH.makeQuestService = makeQuestService;
  GOTH.makeDungeonService = makeDungeonService;
  GOTH.makeLootService = makeLootService;
  GOTH.makeBuildingService = makeBuildingService;
  GOTH.makeAchievementService = makeAchievementService;
  GOTH.makeStore = makeStore;
  GOTH.Actions = Actions;
  GOTH.Selectors = Selectors;
  GOTH.Selectors.selectFlame = function (state) { return Flame.describe(state.flame || 0); };
  GOTH.Selectors.selectTimeOfDay = function () { return TimeOfDay.describe(new Date()); };
  GOTH.ActionTypes = T;
  GOTH.initialState = initialState;
  GOTH.makeServices = makeServices;
  GOTH.TestSuite = TestSuite;

  root.GOTH = GOTH;
})(typeof self !== 'undefined' ? self : globalThis);
