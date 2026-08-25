import { ABILITY_KEYS, MODULE_ID, POINT_BUY_BUDGET, POINT_BUY_COST, STANDARD_ARRAY } from "../constants.mjs";

const DRAFT_FLAG = "isDraft";
const RULESET_FLAG = "ruleset";
const ABILITY_METHOD_FLAG = "abilityMethod";
const ABILITY_BASE_FLAG = "abilityBaseScores";
const ABILITY_BONUS_FLAG = "abilityBonus";
const ABILITY_ROLLS_FLAG = "abilityRolls";
const ABILITY_ASSIGNMENTS_FLAG = "abilityAssignments";
const EQUIPMENT_CHOICE_FLAG = "equipmentChoice";
const EQUIPMENT_CURRENCY_FLAG = "equipmentCurrencyGranted";
const LIFESTYLE_FLAG = "lifestyle";
const PENDING_REVIEW_FLAG = "pendingReview";
const CURRENT_STEP_FLAG = "currentStep";
const ABANDONED_FLAG = "abandoned";

/**
 * Wraps the in-progress character as a real, persisted Foundry Actor.
 *
 * dnd5e's Advancement framework needs a genuine persisted Actor to work correctly: a
 * `{temporary: true}` Actor causes "Failed data preparation" errors throughout dnd5e's
 * derived-data pipeline and AdvancementManager silently fails to render. A real Actor
 * also gives autosave for free, since every advancement step already persists to the
 * actor document as part of its normal flow.
 *
 * The draft actor is flagged so it can be told apart from finished characters and
 * filtered out of the normal Actor Directory listing.
 */
export class CharacterDraft {
  constructor(actor) {
    this.actor = actor;
  }

  static async create({ name = game.i18n.localize("DND-CC.WindowTitle"), ruleset = null } = {}) {
    const actor = await Actor.create({
      name,
      type: "character",
      ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      flags: {
        [MODULE_ID]: { [DRAFT_FLAG]: true, [RULESET_FLAG]: ruleset }
      }
    });
    return new CharacterDraft(actor);
  }

  /**
   * Find an in-progress draft the current user owns, if any.
   * @returns {CharacterDraft|null}
   */
  static findExisting() {
    const actor = game.actors.find(
      (a) => a.isOwner && a.getFlag(MODULE_ID, DRAFT_FLAG) && !a.getFlag(MODULE_ID, ABANDONED_FLAG)
    );
    return actor ? new CharacterDraft(actor) : null;
  }

  static isDraft(actor) {
    return actor?.getFlag(MODULE_ID, DRAFT_FLAG) === true;
  }

  get id() {
    return this.actor.id;
  }

  get ruleset() {
    return this.actor.getFlag(MODULE_ID, RULESET_FLAG) ?? null;
  }

  async setRuleset(value) {
    await this.actor.setFlag(MODULE_ID, RULESET_FLAG, value);
  }

  /**
   * @returns {("2014"|"2024")[]}
   */
  get rulesetVersions() {
    if (this.ruleset === "both") return ["2014", "2024"];
    return this.ruleset ? [this.ruleset] : [];
  }

  // --- Starting equipment -------------------------------------------------
  //
  // Equipment isn't granted through dnd5e's Advancement framework - no Equipment step
  // appears anywhere in a class/background's Advancement flow - so unlike every other
  // step there's no actor-state source of truth for "which starting kit did the player
  // pick" - we track it ourselves. `equipmentChoice` remembers the
  // chosen branch id per granting source (class/background); `equipmentCurrencyGranted`
  // remembers exactly how much currency that branch added, so switching to a different
  // branch (or clearing) can subtract precisely that amount rather than just zeroing
  // the actor's currency (which could clobber money the player added some other way).

  get equipmentChoices() {
    return { class: null, background: null, ...(this.actor.getFlag(MODULE_ID, EQUIPMENT_CHOICE_FLAG) ?? {}) };
  }

  async setEquipmentChoice(source, branchId) {
    const choices = this.equipmentChoices;
    choices[source] = branchId;
    await this.actor.setFlag(MODULE_ID, EQUIPMENT_CHOICE_FLAG, choices);
  }

  get equipmentCurrencyGranted() {
    return { class: null, background: null, ...(this.actor.getFlag(MODULE_ID, EQUIPMENT_CURRENCY_FLAG) ?? {}) };
  }

  async setEquipmentCurrencyGranted(source, amounts) {
    const granted = this.equipmentCurrencyGranted;
    granted[source] = amounts;
    await this.actor.setFlag(MODULE_ID, EQUIPMENT_CURRENCY_FLAG, granted);
  }

  // --- Ability scores ---------------------------------------------------
  //
  // dnd5e's own Advancement (e.g. a background's Ability Score Improvement) writes
  // straight onto `system.abilities.X.value` with no separate bookkeeping of where a
  // point came from. To satisfy the "show a breakdown by source" requirement, we keep
  // our own base/bonus split: `abilityBaseScores` is what the player assigned via the
  // chosen generation method here, `abilityBonus` is the running total of every delta
  // an item's Advancement has applied (tracked by the wizard app around each
  // triggerAdvancement/removeItemWithAdvancement call - see recordAbilityDelta). The
  // actor's real value is always kept in sync as base + bonus.

  get abilityMethod() {
    return this.actor.getFlag(MODULE_ID, ABILITY_METHOD_FLAG) ?? null;
  }

  /**
   * Switch generation method, resetting the base scores to that method's starting
   * point (all unset, except Point Buy which starts every ability at 8).
   * @param {"standardArray"|"pointBuy"|"roll"|"manual"} method
   */
  async setAbilityMethod(method) {
    await this.actor.setFlag(MODULE_ID, ABILITY_METHOD_FLAG, method);
    const defaultBase = method === "pointBuy" ? 8 : null;
    await this.actor.setFlag(
      MODULE_ID,
      ABILITY_BASE_FLAG,
      Object.fromEntries(ABILITY_KEYS.map((key) => [key, defaultBase]))
    );
    await this.actor.unsetFlag(MODULE_ID, ABILITY_ROLLS_FLAG);
    await this.actor.unsetFlag(MODULE_ID, ABILITY_ASSIGNMENTS_FLAG);
    await this._syncAbilityScores();
  }

  get abilityBaseScores() {
    return {
      str: null, dex: null, con: null, int: null, wis: null, cha: null,
      ...(this.actor.getFlag(MODULE_ID, ABILITY_BASE_FLAG) ?? {})
    };
  }

  get abilityBonus() {
    return {
      str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
      ...(this.actor.getFlag(MODULE_ID, ABILITY_BONUS_FLAG) ?? {})
    };
  }

  /**
   * Fold in a per-ability delta that an item's Advancement flow just applied (or, on
   * reversal, un-applied) directly to the actor. Called by the wizard app around every
   * class/species/background selection and removal.
   * @param {Record<string, number>} delta
   */
  async recordAbilityDelta(delta) {
    const current = this.abilityBonus;
    const next = Object.fromEntries(ABILITY_KEYS.map((key) => [key, current[key] + (delta[key] ?? 0)]));
    await this.actor.setFlag(MODULE_ID, ABILITY_BONUS_FLAG, next);
    await this._syncAbilityScores();
  }

  /** @param {"str"|"dex"|"con"|"int"|"wis"|"cha"} key @param {number|null} value */
  async setAbilityBaseScore(key, value) {
    const base = this.abilityBaseScores;
    base[key] = value;
    await this.actor.setFlag(MODULE_ID, ABILITY_BASE_FLAG, base);
    await this._syncAbilityScores();
  }

  /** Point Buy: nudge one ability up or down within the 8-15 range and 27-point budget. */
  async adjustPointBuy(key, direction) {
    const base = this.abilityBaseScores;
    const next = (base[key] ?? 8) + direction;
    if (next < 8 || next > 15) return;

    const spent = ABILITY_KEYS.reduce(
      (sum, k) => sum + POINT_BUY_COST[k === key ? next : (base[k] ?? 8)],
      0
    );
    if (spent > POINT_BUY_BUDGET) return;

    base[key] = next;
    await this.actor.setFlag(MODULE_ID, ABILITY_BASE_FLAG, base);
    await this._syncAbilityScores();
  }

  get pointBuyRemaining() {
    const base = this.abilityBaseScores;
    const spent = ABILITY_KEYS.reduce((sum, key) => sum + (POINT_BUY_COST[base[key] ?? 8] ?? 0), 0);
    return POINT_BUY_BUDGET - spent;
  }

  /**
   * The pool of numbers the player assigns to abilities for Standard Array and Roll.
   * Standard Array's pool is the fixed 6-value constant, available in full immediately.
   * Roll's pool starts empty and grows one entry at a time as each ability gets its own
   * individual roll (see rollAbility) - there is no single "roll all six" action.
   * Indexed (not value-keyed) so duplicate rolled values stay distinguishable.
   * @returns {number[]}
   */
  get abilityPool() {
    if (this.abilityMethod === "standardArray") return STANDARD_ARRAY;
    if (this.abilityMethod === "roll") return this.actor.getFlag(MODULE_ID, ABILITY_ROLLS_FLAG) ?? [];
    return [];
  }

  /** @returns {Record<string, number>} ability key -> index into abilityPool */
  get abilityAssignments() {
    return this.actor.getFlag(MODULE_ID, ABILITY_ASSIGNMENTS_FLAG) ?? {};
  }

  /**
   * Roll (or reroll) 4d6-drop-lowest for one specific ability and post the result to
   * chat so it's visible to the table (a lightweight anti-cheat log; a GM-gated
   * reroll-approval flow is a possible future addition, not built yet). Deliberately
   * per-ability rather than rolling all six at once, so it feels like rolling dice for
   * one stat at a time rather than a single bulk action.
   * @param {"str"|"dex"|"con"|"int"|"wis"|"cha"} key
   */
  async rollAbility(key) {
    const roll = await new Roll("4d6kh3").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.format("DND-CC.Abilities.RollLogMessage", {
        name: this.actor.name,
        ability: CONFIG.DND5E.abilities[key]?.label ?? key
      })
    });

    const pool = [...this.abilityPool];
    const assignments = this.abilityAssignments;
    const existingIndex = assignments[key];

    let index;
    if (existingIndex !== undefined && existingIndex !== null) {
      // Reroll: overwrite this ability's own slot in place rather than growing the pool,
      // so any other ability that had swapped a value with this one isn't disturbed.
      pool[existingIndex] = roll.total;
      index = existingIndex;
    } else {
      index = pool.length;
      pool.push(roll.total);
      assignments[key] = index;
    }

    await this.actor.setFlag(MODULE_ID, ABILITY_ROLLS_FLAG, pool);
    await this.actor.setFlag(MODULE_ID, ABILITY_ASSIGNMENTS_FLAG, assignments);

    const base = this.abilityBaseScores;
    base[key] = roll.total;
    await this.actor.setFlag(MODULE_ID, ABILITY_BASE_FLAG, base);
    await this._syncAbilityScores();
  }

  /**
   * Assign one Standard Array/Roll pool entry (by index) to an ability. If another
   * ability already holds that index, the two abilities swap values instead of the
   * pick being blocked - picking a value that's "taken" is how you trade two stats,
   * not a dead end.
   */
  async assignAbilityPoolValue(key, index) {
    const assignments = this.abilityAssignments;
    const holderKey = ABILITY_KEYS.find((k) => k !== key && assignments[k] === index);
    const previousIndex = assignments[key] ?? null;

    assignments[key] = index;
    if (holderKey) {
      if (previousIndex === null) delete assignments[holderKey];
      else assignments[holderKey] = previousIndex;
    }
    await this.actor.setFlag(MODULE_ID, ABILITY_ASSIGNMENTS_FLAG, assignments);

    const pool = this.abilityPool;
    const base = this.abilityBaseScores;
    base[key] = pool[index] ?? null;
    if (holderKey) base[holderKey] = previousIndex === null ? null : pool[previousIndex] ?? null;
    await this.actor.setFlag(MODULE_ID, ABILITY_BASE_FLAG, base);
    await this._syncAbilityScores();
  }

  /** Whether every ability has an assigned base score (and, for pool methods, no duplicates). */
  get isAbilityAssignmentComplete() {
    const method = this.abilityMethod;
    if (!method) return false;

    const base = this.abilityBaseScores;
    if (ABILITY_KEYS.some((key) => base[key] === null || base[key] === undefined)) return false;

    if (method === "standardArray" || method === "roll") {
      const assignments = this.abilityAssignments;
      const usedIndices = new Set(ABILITY_KEYS.map((key) => assignments[key]));
      if (usedIndices.size !== ABILITY_KEYS.length) return false;
    }

    return true;
  }

  /** Push base + bonus back onto the actor's real ability values, skipping unassigned ones. */
  async _syncAbilityScores() {
    const base = this.abilityBaseScores;
    const bonus = this.abilityBonus;
    const updates = {};
    for (const key of ABILITY_KEYS) {
      if (base[key] === null || base[key] === undefined) continue;
      updates[`system.abilities.${key}.value`] = base[key] + bonus[key];
    }
    if (Object.keys(updates).length) await this.actor.update(updates);
  }

  // --- About step ---------------------------------------------------------
  //
  // Lifestyle has no equivalent field on dnd5e's own actor data model (see
  // LIFESTYLE_TIERS in constants.mjs), so it's tracked as a draft flag, the same
  // pattern as equipmentChoice above. Everything
  // else on the About step (alignment, personality traits, physical characteristics,
  // biography, languages) reads/writes dnd5e's own actor fields directly and needs no
  // flag of its own.

  get lifestyle() {
    return this.actor.getFlag(MODULE_ID, LIFESTYLE_FLAG) ?? null;
  }

  async setLifestyle(key) {
    await this.actor.setFlag(MODULE_ID, LIFESTYLE_FLAG, key);
  }

  /**
   * For a character with no ruleset choice recorded (never built through this wizard,
   * so it never visited the Ruleset step), default to "both" rather than leaving it
   * null - null resolves to an empty rulesetVersions array, which getStepItems reads as
   * "match nothing," so the Class/Species/Background grids would silently show zero
   * cards until someone happened to visit Ruleset and pick one. "Both" is the safer
   * default for a character that already exists outside this wizard's normal flow: show
   * everything rather than guess a specific edition. A no-op if a ruleset is already set.
   */
  async ensureRuleset() {
    if (this.ruleset) return;
    await this.setRuleset("both");
  }

  /**
   * For a character not built through this wizard (or otherwise missing the base/bonus
   * ability tracking - see the "Ability scores" section above), snapshot its current
   * ability scores as the base with zero bonus so future recordAbilityDelta calls (e.g.
   * an Ability Score Improvement picked while leveling up) compute correctly instead of
   * silently no-oping - _syncAbilityScores skips any key whose base is still null. A
   * no-op if abilityMethod is already set, so this is safe to call unconditionally
   * whenever the Level Up flow opens on an existing actor.
   */
  async ensureAbilityBaseline() {
    if (this.abilityMethod) return;
    const base = Object.fromEntries(
      ABILITY_KEYS.map((key) => [key, this.actor.system.abilities[key].value])
    );
    await this.actor.setFlag(MODULE_ID, ABILITY_METHOD_FLAG, "manual");
    await this.actor.setFlag(MODULE_ID, ABILITY_BASE_FLAG, base);
    await this.actor.setFlag(MODULE_ID, ABILITY_BONUS_FLAG, Object.fromEntries(ABILITY_KEYS.map((key) => [key, 0])));
  }

  // --- Current step tracking -----------------------------------------------
  //
  // Which step id the wizard last showed for this actor. Written on every render (see
  // _prepareContext in character-creator-app.mjs), read back to resume a reopened draft
  // where the player actually left off instead of always restarting at Ruleset, and by
  // the GM Progress Dashboard (gm-progress-dashboard.mjs) to show every player's
  // in-progress draft at a glance without needing to ask or peek over a shoulder.

  get currentStepId() {
    return this.actor.getFlag(MODULE_ID, CURRENT_STEP_FLAG) ?? null;
  }

  async setCurrentStepId(stepId) {
    if (this.currentStepId === stepId) return;
    await this.actor.setFlag(MODULE_ID, CURRENT_STEP_FLAG, stepId);
  }

  /**
   * Discard the draft entirely (e.g. the player cancels character creation). Real,
   * permanent deletion - only ever safe to call as a GM. A non-GM user cannot delete an
   * Actor document at all in Foundry's default permission model, even
   * with full Owner-level ownership on that specific actor ("User player lacks
   * permission to delete Actor", straight from Foundry's own access check) - Actor
   * deletion is gated by role, not by per-document ownership. See abandon() for the
   * path a non-GM player's own "Start Over" actually uses.
   */
  async discard() {
    await this.actor.delete();
  }

  /**
   * The non-GM equivalent of discard() - a player can't delete their own draft actor
   * (see discard()'s own note), so "Start Over" for a real player instead flags the
   * draft as abandoned and leaves the document in place. An abandoned draft is still
   * isDraft (so it stays hidden from the Actor Directory, same hook as any other draft)
   * but findExisting() now skips it, so it can never resurface as "your current draft"
   * - a fresh CharacterDraft.create() right after this is what actually gives the
   * player a new character to work with. Real cleanup (deleting the abandoned actor for
   * good) is left to a GM, who always has delete permission - see the GM Progress
   * Dashboard's own Delete action.
   */
  async abandon() {
    await this.actor.setFlag(MODULE_ID, ABANDONED_FLAG, true);
  }

  get abandoned() {
    return this.actor.getFlag(MODULE_ID, ABANDONED_FLAG) === true;
  }

  /** Mark the draft as a finished character. */
  async finalize() {
    await this.actor.unsetFlag(MODULE_ID, DRAFT_FLAG);
    await this.actor.unsetFlag(MODULE_ID, PENDING_REVIEW_FLAG);
  }

  // --- GM co-review gate ---------------------------------------------------
  //
  // Optional, off by default (see the `requireGmReview` world setting). When on, a
  // non-GM player's "Build Character" doesn't finalize directly - it flags the draft as
  // pending review and whispers the GM an actionable chat card instead (see
  // _finalizeCharacter/main.mjs's chat-card click handler). The draft stays a draft
  // (still hidden from the Actor Directory) until the GM actually approves it.

  get pendingReview() {
    return this.actor.getFlag(MODULE_ID, PENDING_REVIEW_FLAG) === true;
  }

  async setPendingReview(value) {
    await this.actor.setFlag(MODULE_ID, PENDING_REVIEW_FLAG, value);
  }
}

/**
 * Every real, non-GM User with OWNER-level access on `actor` - "who does this character
 * actually belong to," as opposed to `actor.isOwner` (checks only the *current* user) or
 * a bare permissions dump (which can't tell a genuine player owner from a GM who happens
 * to also hold OWNER, e.g. from opening the actor's own permissions sheet). Shared by the
 * GM Progress Dashboard's "owner" column and the XP-threshold level-up notification
 * (main.mjs), both of which need the real player(s) a character belongs to, not just
 * whoever is online right now.
 * @param {Actor} actor
 * @returns {User[]}
 */
export function getNonGmOwners(actor) {
  return Object.entries(actor.ownership)
    .filter(([, level]) => level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    .map(([userId]) => game.users.get(userId))
    .filter((user) => user && !user.isGM);
}
