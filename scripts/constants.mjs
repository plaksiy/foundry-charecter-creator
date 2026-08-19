export const MODULE_ID = "foundryvtt-dnd-charecter-creator";

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export const POINT_BUY_BUDGET = 27;

export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const MAX_CLASS_LEVEL = 20;

export const ORIGIN_FEAT_SUBTYPE = "origin";

export const EQUIPMENT_ITEM_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

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
 * Thematic accent color per class, for the Class step's card grid and detail overlay -
 * a curated judgment call (not rules text), matched by class item name. A class not
 * listed here (homebrew, third-party) falls back to the deterministic name-hash color
 * every other card type still uses (see hashCardColor in character-creator-app.mjs).
 */
export const CLASS_THEME_COLORS = {
  Barbarian: "#8b1a1a",
  Bard: "#c9427f",
  Cleric: "#e8c84f",
  Druid: "#4f7a3f",
  Fighter: "#5c7185",
  Monk: "#a67c52",
  Paladin: "#d98a3f",
  Ranger: "#1f4f38",
  Rogue: "#2a2433",
  Sorcerer: "#d9622f",
  Warlock: "#5c2f7a",
  Wizard: "#2f5fae",
  Artificer: "#2f8f9e"
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
