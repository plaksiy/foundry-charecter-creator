import { MODULE_ID } from "../constants.mjs";

/**
 * House rules restrict *how* a character can be built, on top of what content exists
 * (which is what compendium-sources.mjs already governs). GM-configured via
 * HouseRulesConfig, read here by whichever step each rule applies to.
 */
const DEFAULT_HOUSE_RULES = {
  abilityMethods: { standardArray: true, pointBuy: true, roll: true, manual: true },
  disallowedAlignments: [],
  minFeatLevel: 1,
  bannedSpecies: []
};

/** @returns {typeof DEFAULT_HOUSE_RULES} */
export function getHouseRules() {
  return foundry.utils.mergeObject(DEFAULT_HOUSE_RULES, game.settings.get(MODULE_ID, "houseRules") ?? {}, {
    inplace: false
  });
}

/** @param {"standardArray"|"pointBuy"|"roll"|"manual"} method */
export function isAbilityGenerationMethodAllowed(method) {
  return getHouseRules().abilityMethods[method] !== false;
}

/** @param {string} key - one of CONFIG.DND5E.alignments' keys, e.g. "lg" */
export function isAlignmentKeyAllowed(key) {
  return !getHouseRules().disallowedAlignments.includes(key);
}

/** @param {string} uuid - compendium uuid of a species item */
export function isSpeciesBanned(uuid) {
  return getHouseRules().bannedSpecies.includes(uuid);
}

/**
 * Whether feats are available at all at the given total character level.
 * `minFeatLevel: 0` is a dedicated "feats off entirely" sentinel, not "no minimum" -
 * matches the GM settings screen's own wording ("0 disables feats entirely").
 * @param {number} level - total character level (summed across every class)
 */
export function areFeatsAllowedAtLevel(level) {
  const { minFeatLevel } = getHouseRules();
  if (minFeatLevel <= 0) return false;
  return level >= minFeatLevel;
}
