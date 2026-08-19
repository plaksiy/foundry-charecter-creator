/**
 * Thin orchestration layer over dnd5e's own Advancement framework.
 *
 * This module does not resolve choices itself - dnd5e's AdvancementManager already
 * handles HP rolls, skill/tool proficiency picks, trait choices, subclass picks, item
 * grants, and scale values. Our job is only to trigger that flow against the draft
 * actor at the right time and report whether it completed.
 */

import { ABILITY_KEYS } from "../constants.mjs";

/**
 * Read the actor's current ability score values, for diffing around an advancement
 * flow that might include an Ability Score Improvement (e.g. a 2024 background).
 * @param {Actor} actor
 * @returns {Record<string, number>}
 */
export function snapshotAbilities(actor) {
  return Object.fromEntries(ABILITY_KEYS.map((key) => [key, actor.system.abilities[key].value]));
}

/**
 * Per-ability delta between two snapshots, e.g. what an advancement flow just added
 * (or, on reversal, subtracted) directly onto the actor's ability values.
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @returns {Record<string, number>}
 */
export function diffAbilities(before, after) {
  return Object.fromEntries(ABILITY_KEYS.map((key) => [key, after[key] - before[key]]));
}

/**
 * Options that make an AdvancementManager (or one of its per-step Flow apps) render as
 * bare, chromeless content instead of a floating window. No subclassing needed -
 * `AdvancementManager.forNewItem`/etc. all pass their `options` argument straight to
 * `new this(actor, options)`, which merges into the class's own `DEFAULT_OPTIONS` the
 * same way any ApplicationV2 constructor option does. dnd5e's own `AdvancementFlow`
 * already uses this exact `{frame:false, positioned:false}` pair to render each step's
 * content bare inside the (normally floating) Manager - this applies the same trick one
 * level up, to embed the whole Manager inside our own wizard.
 */
const EMBEDDED_WINDOW_OPTIONS = { window: { frame: false, positioned: false } };

/**
 * Render an already-constructed AdvancementManager and wait for it to finish.
 * @param {AdvancementManager} manager
 * @param {HTMLElement} [container] - if given, the manager renders bare (no title bar,
 *   no close button, no draggable/positioned window chrome) and its element is moved
 *   into this container right after its first render, instead of floating as a normal
 *   popup window. `_insertElement` (which is what puts a freshly-rendered Application's
 *   element into `document.body`) only ever runs on an app's *first* render - every
 *   subsequent internal re-render as the player clicks through steps just updates
 *   content in place, wherever the element currently lives in the DOM - so relocating
 *   it once after the first render is enough for it to stay put through the entire
 *   flow. `manager.close()` (called by dnd5e itself on completion, or by our own Cancel
 *   button - see `_runEmbeddedAdvancement` in character-creator-app.mjs) still
 *   correctly tears the element out of wherever it ended up, embedded or not.
 * @returns {Promise<boolean>} resolves true if the flow completed, false if the player
 *   closed it without finishing.
 */
function runAdvancementManager(manager, container) {
  return new Promise((resolve) => {
    Hooks.once("dnd5e.advancementManagerComplete", (completedManager) => {
      if (completedManager === manager) resolve(true);
    });

    // dnd5e calls manager.close() itself on completion (after firing the hook above)
    // and the player closing the window without finishing goes through the same
    // path, so wrap close() to catch the "player just closed it" case. Resolving
    // twice is harmless - the first resolve() call wins, the rest are no-ops.
    const originalClose = manager.close.bind(manager);
    manager.close = async (options) => {
      const result = await originalClose(options);
      resolve(false);
      return result;
    };

    const rendering = manager.render(true);
    if (container) rendering.then(() => container.append(manager.element));
  });
}

/**
 * Run dnd5e's Advancement flow for adding `itemData` to `actor`.
 * @param {Actor} actor
 * @param {object} itemData - plain item data, e.g. from `item.toObject()`
 * @param {HTMLElement} [container] - see runAdvancementManager
 * @returns {Promise<boolean>} resolves true if the player completed the flow, false if
 *   they closed it without finishing.
 */
export async function triggerAdvancement(actor, itemData, container) {
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = await AdvancementManager.forNewItem(actor, itemData, container ? EMBEDDED_WINDOW_OPTIONS : {});
  return runAdvancementManager(manager, container);
}

/**
 * Remove an item from the actor, reversing everything its Advancement granted (other
 * granted items, traits, scale values, etc.) rather than leaving orphans behind.
 * dnd5e's reversal steps are all marked `automatic`, so this resolves without the
 * player needing to click through anything - it's not a second popup.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {HTMLElement} [container] - see runAdvancementManager
 */
export async function removeItemWithAdvancement(actor, itemId, container) {
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = AdvancementManager.forDeletedItem(actor, itemId, container ? EMBEDDED_WINDOW_OPTIONS : {});

  if (!manager.steps.length) {
    // Nothing to reverse (item granted no advancement) - just delete it directly.
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
    return;
  }

  await runAdvancementManager(manager, container);
}

/**
 * Whether an item of the given type has already been added to the actor (e.g. to
 * decide if the Class step's "Next" button should be enabled).
 * @param {Actor} actor
 * @param {string} type - dnd5e item type, e.g. "class", "race", "background"
 */
export function hasItemOfType(actor, type) {
  return actor.items.some((item) => item.type === type);
}

/**
 * Every real player choice on `item` that's still unanswered. dnd5e's own
 * AdvancementManager deliberately never disables "Next"/"Complete" for an unanswered
 * Trait/ItemChoice/AbilityScoreImprovement/Subclass pick (e.g. a Fighter's Fighting
 * Style, a Dragonborn's damage resistance, a class's Skill Proficiencies, a level-3
 * subclass pick), so an item can land on the actor with a genuine choice silently left
 * empty. "The item exists" is therefore not the same as "everything about it is
 * actually chosen" - this reads the real per-advancement `value` dnd5e itself tracks,
 * the same data its own reversal logic (itemsAtRiskFromLevelDecrease, below) already
 * reads, rather than re-deriving anything.
 * @param {Item} item
 * @param {number} [level=Infinity] - the character's relevant level for this item (a
 *   class's own `system.levels`; left at Infinity for level-less items - species,
 *   background, feats - which only ever have level-1-equivalent choices)
 * @returns {string[]} the title of each advancement still missing a real choice
 */
export function unresolvedAdvancementTitles(item, level = Infinity) {
  const titles = [];
  for (const advancement of Object.values(item.advancement?.byId ?? {})) {
    if (typeof advancement.level === "number" && advancement.level > level) continue;

    if (advancement.type === "Trait") {
      const required = (advancement.configuration?.choices ?? []).reduce((sum, c) => sum + (c.count ?? 0), 0);
      if (required > 0 && countEntries(advancement.value?.chosen) < required) titles.push(advancement.title);
    }

    if (advancement.type === "ItemChoice") {
      const choices = advancement.configuration?.choices ?? {};
      const required = Object.entries(choices)
        .filter(([atLevel, c]) => Number(atLevel) <= level && c?.count)
        .reduce((sum, [, c]) => sum + c.count, 0);
      if (required === 0) continue;

      // `value.added` shows up in two different shapes depending on whether the
      // advancement can apply at more than one level: a flat {itemId: uuid} map when
      // there's only ever one choice tier (e.g. a Fighting Style), or a level-keyed
      // {level: {itemId: uuid}} map when it repeats (e.g. Metamagic). Counting values
      // that are themselves objects as nested per-level entries, and anything else as
      // one flat entry, covers both without needing to know in advance which shape a
      // given advancement uses.
      let added = 0;
      for (const entry of entryValues(advancement.value?.added)) {
        added += entry && typeof entry === "object" ? countEntries(entry) : 1;
      }
      if (added < required) titles.push(advancement.title);
    }

    if (advancement.type === "AbilityScoreImprovement" && countEntries(advancement.value) === 0) {
      titles.push(advancement.title);
    }

    if (advancement.type === "Subclass" && !advancement.value?.uuid) {
      titles.push(advancement.title || "Subclass");
    }
  }
  return titles;
}

/**
 * Whether `item` has any real player choice still unanswered - see
 * unresolvedAdvancementTitles for the full explanation and the exact data checked.
 * @param {Item} item
 * @param {number} [level=Infinity]
 * @returns {boolean}
 */
export function hasUnresolvedAdvancement(item, level = Infinity) {
  return unresolvedAdvancementTitles(item, level).length > 0;
}

/**
 * How many entries a dnd5e-tracked "chosen"/"added" collection actually holds. These
 * show up as a real `Set` for some Trait configurations (e.g. a Weapon Mastery pick), a
 * plain object for others, and occasionally a `Map`. A naive `.length` check silently
 * reads `undefined` (treated as empty) on anything but a real array, which would
 * misreport a genuinely-completed choice as unresolved. Handles all three shapes so the
 * count is right regardless of which one a given advancement happens to use.
 * @param {Set|Map|object|Array|null|undefined} value
 * @returns {number}
 */
function countEntries(value) {
  if (!value) return 0;
  if (value instanceof Set || value instanceof Map) return value.size;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 0;
}

/** Values of a Set/Map/plain-object/Array uniformly, for the same reason as countEntries. */
function entryValues(value) {
  if (!value) return [];
  if (value instanceof Map) return Array.from(value.values());
  if (value instanceof Set || Array.isArray(value)) return Array.from(value);
  if (typeof value === "object") return Object.values(value);
  return [];
}

/**
 * Preview what would be removed if `classItem`'s level were lowered to `newLevel`,
 * so the wizard can warn the player before actually reversing anything.
 *
 * Every item dnd5e grants gets a `flags.dnd5e.advancementOrigin` of
 * `"<originItemId>.<advancementId>"` pointing at its immediate parent - for a granted
 * Metamagic option, that's the class item plus the Metamagic ItemChoice advancement,
 * not the "Metamagic" feature item itself, even though that's the item that visually
 * "grants" it in the UI. Most advancement types (ItemGrant, AbilityScoreImprovement,
 * Subclass, Trait) carry a single fixed `advancement.level`, but a type like ItemChoice
 * can apply repeatedly across several levels (Sorcerer's Metamagic grants more options
 * at 2, 10, 14, 18), and its runtime `.value.added` is keyed by level
 * (`{"2": {itemId: uuid}}`), so for those we look up the specific level the specific
 * item was added at instead of trusting one static `.level`.
 * With multiclassing, an actor can have more than one subclass item (one per class
 * that's reached its subclass level) - `classItem.subclass` (a real dnd5e getter that
 * matches on `system.classIdentifier`) picks the one that actually belongs to the class
 * being decreased, rather than grabbing an arbitrary/wrong one off the actor.
 * @param {Actor} actor
 * @param {Item} classItem
 * @param {number} newLevel
 * @returns {{ items: Item[], losesAbilityImprovement: boolean }}
 */
export function itemsAtRiskFromLevelDecrease(actor, classItem, newLevel) {
  const sources = [classItem, classItem.subclass].filter(Boolean);
  const currentLevel = classItem.system.levels;

  let losesAbilityImprovement = false;
  for (const source of sources) {
    for (const advancement of Object.values(source.advancement.byId)) {
      if (advancement.type === "AbilityScoreImprovement" && advancement.level > newLevel && advancement.level <= currentLevel) {
        losesAbilityImprovement = true;
      }
    }
  }

  const items = actor.items.filter((item) => {
    const origin = item.flags?.dnd5e?.advancementOrigin;
    if (!origin) return false;

    const [originItemId, advancementId] = origin.split(".");
    const source = sources.find((candidate) => candidate.id === originItemId);
    const advancement = source?.advancement.byId[advancementId];
    if (!advancement) return false;

    if (typeof advancement.level === "number") return advancement.level > newLevel;

    for (const [levelKey, added] of Object.entries(advancement.value?.added ?? {})) {
      if (item.id in added) return Number(levelKey) > newLevel;
    }
    return false;
  });

  return { items, losesAbilityImprovement };
}

/**
 * Every item on `actor` that traces back to `sourceItemId` via dnd5e's own
 * `flags.dnd5e.advancementOrigin` - i.e. everything that item's Advancement granted,
 * directly or through a cascade (a background's Origin Feat, that feat's own granted
 * spells, etc.). Used to warn before replacing a level-less item (Species, Background)
 * that has no "decrease to a lower level" concept the way a class does - the only
 * question is "what does this item currently account for," not "at what level."
 * @param {Actor} actor
 * @param {string} sourceItemId
 * @returns {Item[]}
 */
export function itemsGrantedBy(actor, sourceItemId) {
  return actor.items.filter((item) => item.flags?.dnd5e?.advancementOrigin?.startsWith(`${sourceItemId}.`));
}

/**
 * Move a class item up or down by `levelDelta` levels, running whatever Advancement
 * that spans (subclass picks, ASI-or-feat choices, class features, HP, scale values -
 * leveling a Sorcerer from 1 to 3 cascades through Metamagic at 2 and a subclass pick
 * at 3 inside one continuous flow). A negative delta reverses cleanly and
 * automatically with no player interaction, exactly like removeItemWithAdvancement.
 * @param {Actor} actor
 * @param {string} classItemId
 * @param {number} levelDelta - positive to level up, negative to level down
 * @param {HTMLElement} [container] - see runAdvancementManager
 * @returns {Promise<boolean>} resolves true if completed, false if cancelled (only
 *   possible when leveling up, since leveling down never needs player input)
 */
export async function changeClassLevel(actor, classItemId, levelDelta, container) {
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = AdvancementManager.forLevelChange(actor, classItemId, levelDelta, container ? EMBEDDED_WINDOW_OPTIONS : {});
  return runAdvancementManager(manager, container);
}
