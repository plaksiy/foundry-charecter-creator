export const MODULE_ID = "foundryvtt-dnd-charecter-creator";

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export const POINT_BUY_BUDGET = 27;

export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const MAX_CLASS_LEVEL = 20;

export const ORIGIN_FEAT_SUBTYPE = "origin";

export const EQUIPMENT_ITEM_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

/**
 * 100 invented, generic fantasy character names for the Identity step's "Randomize"
 * button - a mix of short single names and two-part names, so both short one-word
 * options and longer ones are available. None of these are
 * drawn from any book, setting, or media property - safe, structural placeholder data
 * the same way LIFESTYLE_TIERS/CLASS_COMPLEXITY are, not narrative content.
 */
export const NAME_EXAMPLES = [
  "Finn", "Vex", "Orin", "Sable", "Bram", "Lyra", "Dax", "Wren", "Kael", "Rue",
  "Torin", "Isolde", "Garrick", "Nyx", "Fenn", "Sorin", "Thistle", "Roswyn", "Cade", "Marlow",
  "Kaelith Duskbane", "Torvin Ironbeard", "Sable Nightwhisper", "Bram Thistlewood", "Isolde Ravenscroft",
  "Garrick Stormwake", "Orin Ashfall", "Wren Hollowmere", "Dax Emberlyn", "Rue Thornfield",
  "Sorin Blackwood", "Roswyn Faircastle", "Cade Wintermoor", "Marlow Duskhollow", "Fenn Greycairn",
  "Lyra Moonwhisper", "Kael Stonebrook", "Nyx Fellwood", "Thistle Brambleworth", "Vex Ironhollow",
  "Aldric", "Briar", "Corwin", "Delphine", "Edric", "Faelan", "Gideon", "Halcyon", "Ivo", "Junia",
  "Kestrel", "Lior", "Maren", "Niall", "Ondine", "Percival", "Quillon", "Rhiannon", "Soren", "Tessaly",
  "Ulric", "Vesper", "Wystan", "Xanthe", "Yara", "Zephyrine", "Aeliana", "Bastian", "Calla", "Dorian",
  "Elowen Hartley", "Finnian Oakmoor", "Greta Stonewell", "Hollis Fenwick", "Ines Duskraven",
  "Jorah Wildmere", "Kira Ashgrove", "Lucan Thornbury", "Mira Blackfern", "Nash Ravenwood",
  "Odessa Vale", "Piers Hollowgate", "Quinby Fairwind", "Rosaline Grimhold", "Silas Northgate",
  "Talon", "Una", "Varek", "Wisp", "Xylas", "Yorick", "Zara", "Brynn", "Cassian", "Della",
  "Emberly", "Fable", "Grimm", "Hale", "Iris", "Jasper", "Kip", "Larke", "Moss", "Nell"
];

/**
 * Lifestyle Expenses tiers (identical table in both the 2014 and 2024 rules). dnd5e's
 * own actor data model has no field for this, so it's tracked as a draft flag instead
 * of an actor property. Cost is in GP-equivalent per day; costLabel is the display
 * form in whichever denomination reads cleanest.
 */
export const LIFESTYLE_TIERS = [
  { key: "wretched", costPerDay: 0, costLabel: "0" },
  { key: "squalid", costPerDay: 0.1, costLabel: "1 SP" },
  { key: "poor", costPerDay: 0.2, costLabel: "2 SP" },
  { key: "modest", costPerDay: 1, costLabel: "1 GP" },
  { key: "comfortable", costPerDay: 2, costLabel: "2 GP" },
  { key: "wealthy", costPerDay: 4, costLabel: "4 GP" },
  { key: "aristocratic", costPerDay: 10, costLabel: "10+ GP" }
];

export const ABILITY_METHODS = ["standardArray", "pointBuy", "roll", "manual"];

export const COMPLEXITY_LEVELS = ["low", "average", "high"];

/**
 * How demanding each of the 12 core 2024 PHB classes is to play, for the Class step's
 * optional complexity filter. A difficulty-tier judgment call, not rules text, matched
 * by class item name. A class not listed here (homebrew, third-party) is treated as
 * unrated and always shown, so the filter never hides content it doesn't understand.
 */
export const CLASS_COMPLEXITY = {
  Barbarian: "low",
  Fighter: "low",
  Rogue: "low",
  Bard: "average",
  Cleric: "average",
  Monk: "average",
  Paladin: "average",
  Ranger: "average",
  Warlock: "average",
  Druid: "high",
  Sorcerer: "high",
  Wizard: "high",
  Artificer: "high"
};

/**
 * Class card accent colors, for the Class step's card grid and detail overlay - each
 * keyed to the actual dominant non-neutral color in that class's real dnd5e/PHB icon art
 * (e.g. Cleric's icon background is a bright blue starfield, Sorcerer's is electric-blue
 * lightning, Wizard's is gold-lit), not a generic per-class stereotype. Fighter/Monk/
 * Paladin/Ranger were kept as explicit prior user choices even where they diverge from
 * their icon's own dominant tone - a deliberate design decision from an earlier round,
 * not an oversight. A class not listed here (homebrew, third-party) falls back to the
 * deterministic name-hash color every other card type uses (hashCardColor).
 */
export const CLASS_THEME_COLORS = {
  Barbarian: "#b25a2f",
  Bard: "#8a6fae",
  Cleric: "#4f8fd9",
  Druid: "#4f7a3f",
  Fighter: "#5c7185",
  Monk: "#a67c52",
  Paladin: "#d98a3f",
  Ranger: "#1f4f38",
  Rogue: "#2f3a52",
  Sorcerer: "#3f6fd9",
  Warlock: "#3f7a8a",
  Wizard: "#c9a53f",
  Artificer: "#2f8f9e"
};

/**
 * A plain, light, neutral gray - the card color for any species/background entry with
 * no curated color below (most often real Eberron-specific content, or an SRD entry
 * that only has a generic icon-library image rather than real illustrated art to look
 * at and pick a color from). Deliberately not run through hashCardColor's colorful
 * palette the way Feats still are - an unreviewed entry should read as genuinely
 * unthemed, not accidentally land on a color that looks like a deliberate pick.
 */
export const NEUTRAL_CARD_COLOR = "#a8a49c";

/**
 * Species card accent colors, picked the same way as CLASS_THEME_COLORS - the actual
 * dominant non-neutral color in that species's real PHB icon art. Only covers species
 * with real illustrated art actually looked at; anything else falls back to
 * NEUTRAL_CARD_COLOR (see hashCardColor's caller in character-creator-app.mjs).
 */
export const SPECIES_THEME_COLORS = {
  Human: "#c17a4a",
  Dwarf: "#c9a227",
  "Elf, High": "#5fa8a3",
  "Elf, Wood": "#5c9e5c",
  "Elf, Drow": "#7a4f9e",
  "Gnome, Forest": "#5c9e4f",
  "Gnome, Rock": "#b23f7a",
  Halfling: "#d9a627",
  Dragonborn: "#c9502f",
  "Tiefling, Infernal": "#c97a2f",
  "Tiefling, Abyssal": "#c93f3f",
  "Tiefling, Chthonic": "#a888b0",
  Goliath: "#6f8299",
  Orc: "#b8942f",
  Aasimar: "#d4b04f",
  Changeling: "#b8703f",
  Kalashtar: "#2f9e8a",
  Khoravar: "#a8322f",
  Shifter: "#8a2f3f",
  Warforged: "#3f6f8a"
};

/** Background card accent colors - same "actually looked at the real art" approach as
 *  SPECIES_THEME_COLORS/CLASS_THEME_COLORS. */
export const BACKGROUND_THEME_COLORS = {
  Acolyte: "#d9a24f",
  Criminal: "#3a4f7a",
  Sage: "#6f5fae",
  Soldier: "#c9702f",
  Artisan: "#3f8a99",
  Charlatan: "#c9427f",
  Entertainer: "#b06f3f",
  Farmer: "#5c9e4f",
  Guard: "#3f9ea3",
  Guide: "#4f8a4f",
  Hermit: "#c9822f",
  Merchant: "#8a6142",
  Noble: "#8a2f3f",
  Sailor: "#3fa38a",
  Scribe: "#a3792f",
  Wayfarer: "#3f7a99"
};

export const PARTY_ROLES = ["tank", "damage", "support", "healer"];

/**
 * Which party roles each of the 12 core 2024 PHB classes typically covers, for the
 * party role balance advisor. A class not listed here just contributes no role
 * coverage, rather than being excluded from anything.
 */
export const CLASS_ROLES = {
  Barbarian: ["tank", "damage"],
  Fighter: ["tank", "damage"],
  Paladin: ["tank", "healer"],
  Cleric: ["healer", "support"],
  Druid: ["healer", "support"],
  Bard: ["support", "healer"],
  Ranger: ["damage", "support"],
  Rogue: ["damage"],
  Monk: ["damage", "tank"],
  Sorcerer: ["damage"],
  Warlock: ["damage", "support"],
  Wizard: ["support", "damage"]
};
