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
  bannedSpecies: [],
  bannedClasses: [],
  bannedFeats: [],
  disableMulticlass: false,
  allowSelfLevelUp: false,
  pointBuyBudget: 27,
  pointBuyMin: 8,
  pointBuyMax: 15,
  allowRerolls: true,
  bonusStartingGoldGp: 0
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
 * Hide a specific class (e.g. an NPC-flavored class from a supplement a GM doesn't want
 * offered at their table) without disabling the whole compendium pack it lives in - the
 * same "ban individual items, not whole sources" need bannedSpecies already covers, just
 * for classes.
 * @param {string} uuid - compendium uuid of a class item
 */
export function isClassBanned(uuid) {
  return getHouseRules().bannedClasses.includes(uuid);
}

/**
 * Hide a specific feat (e.g. a supplement feat a GM considers too strong or off-theme)
 * from the Feats step's "Browse Feats" grid - same "ban individual items, not whole
 * sources" precedent as bannedSpecies/bannedClasses.
 * @param {string} uuid - compendium uuid of a feat item
 */
export function isFeatBanned(uuid) {
  return getHouseRules().bannedFeats.includes(uuid);
}

/**
 * Whether a character may add a second (or further) class at this table. Off by
 * default - multiclassing stays available unless a GM explicitly turns it off. Checked
 * only where a *new* class would be added (the addable-class grid and its own randomize
 * button); an already-multiclassed character built before this rule was turned on keeps
 * every class it already has, since this only gates adding more, not removing what's
 * already there.
 * @returns {boolean}
 */
export function isMulticlassDisabled() {
  return getHouseRules().disableMulticlass === true;
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

/**
 * Whether a player is allowed to open Level Up on their own finished character once
 * they've earned enough XP, rather than always waiting on the GM. Off by default - the
 * XP-threshold notification (see main.mjs's updateActor hook) always reaches the GM
 * either way; this only controls whether the *player* is also whispered their own
 * actionable "Open Level Up" chat card.
 * @returns {boolean}
 */
export function isSelfLevelUpAllowed() {
  return getHouseRules().allowSelfLevelUp === true;
}

/**
 * Point Buy's real min/max ability score range and point budget - defaults match the
 * standard 5e rules (8-15 range, 27 points) but a GM can widen or narrow either, e.g.
 * for a higher-power table. Read fresh on every call (not cached) so a mid-session GM
 * change takes effect immediately, same as every other house rule here.
 * @returns {{ min: number, max: number, budget: number }}
 */
export function getPointBuyRange() {
  const rules = getHouseRules();
  return { min: rules.pointBuyMin, max: rules.pointBuyMax, budget: rules.pointBuyBudget };
}

/**
 * Whether the Roll ability-score method allows rerolling a value already rolled for an
 * ability - on by default, since the existing anti-cheat chat log (CharacterDraft#
 * rollAbility posts every roll/reroll publicly) already makes a reroll visible to the
 * table rather than something that needs blocking outright. Off lets a GM enforce
 * "first roll stands" instead.
 * @returns {boolean}
 */
export function isRerollAllowed() {
  return getHouseRules().allowRerolls !== false;
}

/**
 * Extra starting gold (in GP-equivalent) a GM grants on top of whatever a character's
 * class/background kit or "take gold instead" branch already provides - 0 by default,
 * since the standard rules have no such bonus. Applied once per draft the first time the
 * Equipment step is opened (see CharacterDraft#ensureBonusStartingGold), not re-applied
 * on every render.
 * @returns {number}
 */
export function getBonusStartingGoldGp() {
  return getHouseRules().bonusStartingGoldGp || 0;
}
