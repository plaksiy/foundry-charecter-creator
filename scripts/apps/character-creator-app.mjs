import {
  ABILITY_KEYS,
  ABILITY_METHODS,
  CLASS_COMPLEXITY,
  CLASS_ROLES,
  CLASS_THEME_COLORS,
  COMPLEXITY_LEVELS,
  EQUIPMENT_ITEM_TYPES,
  LIFESTYLE_TIERS,
  MAX_CLASS_LEVEL,
  MODULE_ID,
  ORIGIN_FEAT_SUBTYPE,
  PARTY_ROLES,
  POINT_BUY_BUDGET
} from "../constants.mjs";
import { CharacterDraft } from "../models/character-draft.mjs";
import {
  changeClassLevel,
  diffAbilities,
  hasItemOfType,
  hasUnresolvedAdvancement,
  itemsAtRiskFromLevelDecrease,
  itemsGrantedBy,
  removeItemWithAdvancement,
  snapshotAbilities,
  triggerAdvancement,
  unresolvedAdvancementTitles
} from "../models/choice-queue.mjs";
import { getStepItems, listPlayerVisiblePacks, setPlayerSourceVisibility } from "../services/compendium-sources.mjs";
import { formatGp, itemPriceInGp, redenominateGp, totalGpEquivalent } from "../services/currency.mjs";
import {
  areFeatsAllowedAtLevel,
  isAbilityGenerationMethodAllowed,
  isAlignmentKeyAllowed,
  isSpeciesBanned
} from "../services/house-rules.mjs";
import { branchLabel, getEquipmentBranches, resolveBranch } from "../services/starting-equipment.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * dnd5e's own class/species/background icon art is monochrome line art on a transparent
 * background (`systems/dnd5e/icons/classes/*.webp` etc. are white/gray silhouettes, not
 * painted color portraits), so using it as a full-bleed card background reads as
 * washed-out gray tiles. Every card gets a real, deterministic color instead (same name
 * always gets the same color, so it's stable across renders and sessions) - the icon
 * then sits as a small badge on top of that flat color rather than being stretched to
 * fill the card.
 * @param {string} name
 * @returns {string} a hex color
 */
const CARD_COLOR_PALETTE = [
  "#c2461f", "#d9b23f", "#4f9e5c", "#d1863f", "#7a9e3f", "#a34fd9",
  "#c94fae", "#3fb6a8", "#5b9e6f", "#6f4fae", "#8c1c5c", "#4f9ea3",
  "#6b7a4f", "#4f6fe0", "#6f93c9", "#c9a227", "#a8823f", "#df0000"
];
function hashCardColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CARD_COLOR_PALETTE[hash % CARD_COLOR_PALETTE.length];
}

/** Class cards use a curated thematic color (CLASS_THEME_COLORS) instead of the
 *  deterministic hash every other card type uses, falling back to the hash for any
 *  class the curated table doesn't cover (homebrew, third-party). */
function classCardColor(name) {
  return CLASS_THEME_COLORS[name] ?? hashCardColor(name);
}

/**
 * Decorate an item-list entry (already carrying uuid/name/img/ruleset from getStepItems)
 * with display-ready pill text for whatever real mechanical data was fetched alongside it
 * - real hit die / primary ability for classes, real speed for species. `null` for
 * whichever fields don't apply to that item's type (getStepItems always requests the same
 * field set regardless of step, so most entries only populate a subset).
 * @param {object} item
 */
function decorateCardPills(item) {
  const pills = [];
  if (item.hitDie) pills.push(`Hit Die ${item.hitDie}`);
  if (item.primaryAbilities?.length) {
    pills.push(item.primaryAbilities.map((key) => CONFIG.DND5E.abilities[key]?.label ?? key).join(" / "));
  }
  if (item.speed) pills.push(`${item.speed} ft Speed`);
  return { ...item, pills };
}

/**
 * Per-step rail icon, as raw inner-SVG path markup (no wrapping <svg> tag - shell.hbs
 * supplies that, via a triple-stash `{{{this.icon}}}`) so the icon set stays a single
 * static line-art vocabulary rather than depending on Font Awesome glyphs that may not
 * exist for a concept like "crossed swords".
 */
const STEP_DEFINITIONS = [
  {
    id: "ruleset",
    label: "DND-CC.Steps.Ruleset",
    icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'
  },
  {
    id: "class",
    label: "DND-CC.Steps.Class",
    icon: '<path d="M4 4 18 18"/><path d="M20 4 6 18"/><path d="M14.1 16.3 16.3 14.1"/><path d="M9.9 16.3 7.7 14.1"/><circle cx="18" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="1.3" fill="currentColor" stroke="none"/>'
  },
  {
    id: "species",
    label: "DND-CC.Steps.Species",
    icon: '<path d="M2 12c2.5-5 7-8 10-8s7.5 3 10 8c-2.5 5-7 8-10 8s-7.5-3-10-8Z"/><circle cx="12" cy="12" r="3"/>'
  },
  {
    id: "background",
    label: "DND-CC.Steps.Background",
    icon: '<rect x="6" y="3" width="12" height="4" rx="2"/><rect x="6" y="17" width="12" height="4" rx="2"/><path d="M8 7v10M16 7v10"/><path d="M9.5 10h5M9.5 13h3"/>'
  },
  {
    id: "abilities",
    label: "DND-CC.Steps.Abilities",
    icon: '<path d="M12 2 20 7v10l-8 5-8-5V7Z"/><path d="M4 7 12 12 20 7"/><path d="M12 12v10"/>'
  },
  {
    id: "feats",
    label: "DND-CC.Steps.Feats",
    icon: '<path d="M12 2 14 10 22 12 14 14 12 22 10 14 2 12 10 10Z"/>'
  },
  {
    id: "skills",
    label: "DND-CC.Steps.Skills",
    icon: '<path d="M6 20V13M12 20V9M18 20V5"/>'
  },
  {
    id: "spells",
    label: "DND-CC.Steps.Spells",
    icon: '<path d="M12 2c3 4 6 6 6 11a6 6 0 0 1-12 0c0-2.5 1.5-4 2.5-5 0 2.5 1 2.5 1 0-.5-3 .5-4.5 2.5-6Z"/>'
  },
  {
    id: "equipment",
    label: "DND-CC.Steps.Equipment",
    icon: '<path d="M7 8a5 5 0 0 1 10 0"/><rect x="4.5" y="6" width="15" height="15" rx="5"/><rect x="9" y="14" width="6" height="5" rx="2"/><path d="M9.5 6v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V6"/>'
  },
  {
    id: "about",
    label: "DND-CC.Steps.About",
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/><path d="M8 15c1.5 1.5 6.5 1.5 8 0"/>'
  },
  {
    id: "review",
    label: "DND-CC.Steps.Review",
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 6-6"/>'
  }
];

/** Steps that must be complete before the Review step will let the player finalize a character. */
const REQUIRED_STEPS = ["class", "species", "background", "abilities"];

export class CharacterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd-character-creator",
    classes: ["dnd-cc"],
    tag: "div",
    window: {
      title: "DND-CC.WindowTitle",
      icon: "fa-solid fa-hat-wizard",
      resizable: true
    },
    position: {
      width: 960,
      height: 680
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/character-creator/shell.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this.stepIndex = 0;
    /**
     * Which step ids have actually been opened at least once. Navigation between steps
     * is unrestricted, so a step's rail coloring can't just mean "already passed" -
     * instead it only turns done/warn once the player has genuinely visited it, so an
     * untouched step doesn't read as broken before anyone's looked at it.
     * @type {Set<string>}
     */
    this.visitedSteps = new Set([STEP_DEFINITIONS[0].id]);
    /** @type {CharacterDraft|null} set lazily in _prepareContext, since Actor.create() is async */
    this.draft = null;
    /**
     * Class step's complexity filter - "low"/"average"/"high"/"all". Pure UI-session
     * state, not a character choice, so it's a plain instance field rather than a
     * CharacterDraft flag (matches stepIndex just above).
     */
    this.classComplexityFilter = "all";
  }

  async _prepareContext(_options) {
    this.draft ??= await this._resolveDraft();

    const currentStep = STEP_DEFINITIONS[this.stepIndex];
    const stepContext = await this._prepareStepContext(currentStep.id);

    // A step only shows as done/warn (colored) once the player has actually opened it at
    // least once (`visitedSteps`) - flagging a step nobody has looked at yet as a warning
    // reads as broken, not helpful. Once visited, the color reflects the actor's real
    // current data (`_isStepComplete`), not whether it's still the current step or how it
    // was reached - navigation between steps is unrestricted, so "was this the most
    // recently visited one" isn't meaningful, but "does Class/Species/Background/
    // Abilities actually have what it needs" always is.
    const steps = STEP_DEFINITIONS.map((step, index) => {
      const visited = index !== this.stepIndex && this.visitedSteps.has(step.id);
      const complete = this._isStepComplete(step.id);
      return {
        id: step.id,
        label: game.i18n.localize(step.label),
        icon: step.icon,
        index: index + 1,
        active: index === this.stepIndex,
        done: visited,
        complete,
        // Only worth showing once the step has actually been visited and found
        // wanting - matches the done/warn coloring above, for the same reason.
        missingHint: visited && !complete ? this._stepMissingHint(step.id) : ""
      };
    });

    return {
      steps,
      characterName: this.draft.actor.name,
      characterImg: this.draft.actor.img,
      currentStepId: currentStep.id,
      currentStepLabel: game.i18n.localize(currentStep.label),
      stepCounterLabel: game.i18n.format("DND-CC.StepCounter", {
        current: this.stepIndex + 1,
        total: STEP_DEFINITIONS.length
      }),
      canGoBack: this.stepIndex > 0,
      canGoNext: this.stepIndex < STEP_DEFINITIONS.length - 1 && this._isStepComplete(currentStep.id),
      nextLabel: game.i18n.localize(
        this.stepIndex < STEP_DEFINITIONS.length - 1 ? "DND-CC.Next" : "DND-CC.Finish"
      ),
      ...stepContext
    };
  }

  /**
   * Step-specific template context. Steps without a real implementation yet just fall
   * through to the placeholder template.
   */
  async _prepareStepContext(stepId) {
    switch (stepId) {
      case "ruleset":
        return { partialPath: this._partialPath("step-ruleset"), ruleset: this.draft.ruleset };
      case "class":
        return { partialPath: this._partialPath("step-class"), ...(await this._prepareClassesContext()) };
      case "species":
        return {
          partialPath: this._partialPath("step-species"),
          ...(await this._prepareItemListContext({
            stepType: "race",
            dnd5eType: "race",
            listKey: "speciesItems",
            selectedNameKey: "selectedSpeciesName",
            filter: (item) => !isSpeciesBanned(item.uuid),
            groupLineages: true
          }))
        };
      case "background":
        return {
          partialPath: this._partialPath("step-background"),
          ...(await this._prepareItemListContext({
            stepType: "background",
            dnd5eType: "background",
            listKey: "backgroundItems",
            selectedNameKey: "selectedBackgroundName"
          }))
        };
      case "abilities":
        return { partialPath: this._partialPath("step-abilities"), ...this._prepareAbilitiesContext() };
      case "feats":
        return { partialPath: this._partialPath("step-feats"), ...(await this._prepareFeatsContext()) };
      case "skills":
        return { partialPath: this._partialPath("step-skills"), ...this._prepareSkillsContext() };
      case "spells":
        return { partialPath: this._partialPath("step-spells"), ...this._prepareSpellsContext() };
      case "equipment":
        return { partialPath: this._partialPath("step-equipment"), ...(await this._prepareEquipmentContext()) };
      case "about":
        return { partialPath: this._partialPath("step-about"), ...this._prepareAboutContext() };
      case "review":
        return { partialPath: this._partialPath("step-review"), ...(await this._prepareReviewContext()) };
      default:
        return { partialPath: this._partialPath("step-placeholder") };
    }
  }

  _partialPath(name) {
    return `modules/${MODULE_ID}/templates/character-creator/${name}.hbs`;
  }

  /**
   * Shared context builder for steps that are just "pick one item of a given dnd5e
   * type" - Class, Species, and Background.
   * @param {object} options
   * @param {string} options.stepType - key passed to getStepItems (STEP_ITEM_TYPES)
   * @param {string} options.dnd5eType - the actual dnd5e Item type to match on the actor
   * @param {string} options.listKey - context key the item list is exposed under
   * @param {string} options.selectedNameKey - context key the selected item's name is exposed under
   * @param {(item: object) => boolean} [options.filter] - optional extra exclusion (e.g. a house-rules ban list)
   */
  async _prepareItemListContext({ stepType, dnd5eType, listKey, selectedNameKey, filter, groupLineages }) {
    let items = await getStepItems(stepType, this.rulesetVersions);
    if (filter) items = items.filter(filter);
    const selected = this.draft.actor.items.find((item) => item.type === dnd5eType);

    let list = items
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        ...decorateCardPills(item),
        color: hashCardColor(item.name),
        selected: item.name === selected?.name
      }));

    if (groupLineages) list = this._groupLineageCards(list);

    return {
      [listKey]: list,
      [`${listKey}Groups`]: this._groupBySource(list),
      [selectedNameKey]: selected?.name ?? null,
      [`${selectedNameKey.replace(/Name$/, "")}Img`]: selected?.img ?? null,
      [`${selectedNameKey.replace(/Name$/, "")}Color`]: selected ? hashCardColor(selected.name) : null
    };
  }

  /**
   * Collapse pre-split lineage cards (e.g. "Elf, Drow" / "Elf, High" / "Elf, Wood",
   * "Tiefling, Abyssal" / "Tiefling, Chthonic" / "Tiefling, Infernal") into one parent
   * card per base name, matching how a player actually thinks about picking a species
   * ("Elf, then which kind") rather than showing every lineage as an unrelated top-level
   * card. This "Name, Lineage" naming is the real compendium convention dnd5e itself
   * uses for pre-split species - not every species uses it (Dragonborn,
   * Human, etc. are single un-split items and pass through untouched here). A base name
   * with only one surviving member (e.g. house-rules banned the other two lineages)
   * isn't a real group, so it's put back as a normal standalone card instead.
   * @param {object[]} list - already color/pill-decorated cards from _prepareItemListContext
   */
  _groupLineageCards(list) {
    const groups = new Map();
    const standalone = [];

    for (const card of list) {
      const match = card.name.match(/^(.+), (.+)$/);
      if (!match) {
        standalone.push(card);
        continue;
      }
      const base = match[1].trim();
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push({ ...card, lineageLabel: match[2].trim() });
    }

    const result = [...standalone];
    for (const [base, members] of groups) {
      if (members.length < 2) {
        result.push(...members);
        continue;
      }
      const sortedMembers = members.sort((a, b) => a.lineageLabel.localeCompare(b.lineageLabel));
      const selectedMember = sortedMembers.find((m) => m.selected);
      result.push({
        isLineageGroup: true,
        name: base,
        lineageCount: sortedMembers.length,
        img: sortedMembers[0].img,
        color: sortedMembers[0].color,
        ruleset: sortedMembers[0].ruleset,
        book: sortedMembers[0].book,
        custom: false,
        selected: !!selectedMember,
        selectedLineageLabel: selectedMember?.lineageLabel ?? null,
        // A lineage group has no single item of its own to describe - "Learn More" shows
        // whichever lineage is currently selected, or the first one alphabetically as a
        // representative starting point otherwise.
        learnMoreUuid: (selectedMember ?? sortedMembers[0]).uuid
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Class step context: every class currently on the draft actor - dnd5e's own
   * multiclassing rules let a character have more than one, so unlike Species/Background
   * this step is "add any number, remove any" rather than "pick one, swap freely" (see
   * _addClass/_removeClass, and _selectItem's doc comment for why that shared method no
   * longer covers class). Each class's own item level is always the real source of truth
   * (no draft flag needed to remember it, unlike the old single-class version of this
   * step) - only the still-pending "which level did the player pick before Advancement
   * resolved" moment during _applyClassLevel needs any bookkeeping, and that's entirely
   * local to that one call. Per-class level options are capped so the combined total
   * across every class can't exceed MAX_CLASS_LEVEL, since that cap is on total
   * character level, not per class.
   *
   * Also carries the Class step's two extra features: an optional complexity filter
   * over the "add a class" grid (`this.classComplexityFilter`, a pure UI-session field -
   * see the constructor), and a party role balance advisor reading the world's primary
   * party (`game.actors.party`, a real dnd5e getter) rather than inventing our own
   * "what counts as the party" concept - both are pure presentation, neither restricts
   * what the player can actually pick.
   */
  async _prepareClassesContext() {
    const classItems = this.draft.actor.items.filter((item) => item.type === "class");
    const totalLevel = classItems.reduce((sum, item) => sum + item.system.levels, 0);

    const classes = classItems.map((item) => {
      const maxForThisClass = Math.min(MAX_CLASS_LEVEL, item.system.levels + (MAX_CLASS_LEVEL - totalLevel));
      const levelOptions = [];
      for (let value = 1; value <= maxForThisClass; value++) {
        levelOptions.push({ value, selected: value === item.system.levels });
      }
      const missing = unresolvedAdvancementTitles(item, item.system.levels);
      return {
        ...decorateCardPills({
          hitDie: item.system.hd?.denomination ?? null,
          primaryAbilities: item.system.primaryAbility?.value?.length ? item.system.primaryAbility.value : null
        }),
        id: item.id,
        name: item.name,
        img: item.img,
        color: classCardColor(item.name),
        isOriginalClass: item.isOriginalClass,
        level: item.system.levels,
        levelOptions,
        missingChoices: missing,
        missingHint: missing.length
          ? game.i18n.format("DND-CC.Class.MissingChoices", { list: missing.join(", ") })
          : null
      };
    });

    const existingNames = new Set(classItems.map((item) => item.name));
    const items = await getStepItems("class", this.rulesetVersions);
    const addableClasses = items
      .filter((item) => !existingNames.has(item.name))
      .filter((item) => {
        if (this.classComplexityFilter === "all") return true;
        const complexity = CLASS_COMPLEXITY[item.name];
        return !complexity || complexity === this.classComplexityFilter;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ ...decorateCardPills(item), color: classCardColor(item.name) }));

    const complexityOptions = ["all", ...COMPLEXITY_LEVELS].map((key) => ({
      key,
      label: game.i18n.localize(`DND-CC.ClassExtras.Complexity${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      active: key === this.classComplexityFilter
    }));

    return {
      classes,
      totalLevel,
      hasClass: classes.length > 0,
      canAddClass: totalLevel < MAX_CLASS_LEVEL,
      addableClasses,
      addableClassGroups: this._groupBySource(addableClasses),
      complexityOptions,
      ...this._preparePartyAdvisorContext()
    };
  }

  /**
   * Group an already-decorated card list (Class step's addable grid) by its real
   * content source - the human-readable book/pack label ("Player's Handbook",
   * "Forge of the Artificer", "SRD 5.2") already carried on each card via
   * getStepItems' `book` field - so the grid reads as labeled per-source sections
   * instead of one flat, unsorted pile. World-item homebrew placeholders (no `book`)
   * get their own bucket, always sorted last; anything else unlabeled falls into a
   * generic "Other" bucket.
   * @param {object[]} list
   * @returns {{ label: string, entries: object[] }[]}
   */
  _groupBySource(list) {
    const homebrewLabel = game.i18n.localize("DND-CC.Homebrew");
    const otherLabel = game.i18n.localize("DND-CC.Source.Other");

    const groups = new Map();
    for (const card of list) {
      const label = card.custom ? homebrewLabel : (card.book || otherLabel);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(card);
    }

    // The core rulebook (PHB) sorts first as the primary/default source, every other
    // real book/module follows alphabetically, and "Other"/"Homebrew" always trail
    // last (in that order) since neither names a specific real source.
    const rank = (label) => {
      if (label === homebrewLabel) return 3;
      if (label === otherLabel) return 2;
      if (/^PHB\b/i.test(label)) return 0;
      return 1;
    };

    return Array.from(groups.entries())
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([label, entries]) => ({ label, entries }));
  }

  /**
   * Party role balance advisor: reads the world's primary party actor
   * (`game.actors.party.system.playerCharacters`, dnd5e's own PC-only member list),
   * aggregates which of PARTY_ROLES their classes already cover via the CLASS_ROLES
   * lookup, and surfaces whichever roles nobody covers yet. Purely advisory - never
   * filters or blocks anything, just a suggestion on the Class step.
   */
  _preparePartyAdvisorContext() {
    const party = game.actors.party;
    if (!party) return { partyAdvisor: { hasParty: false } };

    const covered = new Set();
    for (const member of party.system.playerCharacters) {
      for (const item of member.items) {
        if (item.type !== "class") continue;
        for (const role of CLASS_ROLES[item.name] ?? []) covered.add(role);
      }
    }

    const missing = PARTY_ROLES.filter((role) => !covered.has(role));
    const missingLabels = missing.map((role) => game.i18n.localize(`DND-CC.ClassExtras.PartyRole.${role}`));

    return {
      partyAdvisor: {
        hasParty: true,
        complete: missing.length === 0,
        missingText: missing.length
          ? game.i18n.format("DND-CC.ClassExtras.PartyAdvisorMissing", { roles: missingLabels.join(", ") })
          : null
      }
    };
  }

  /**
   * Feats step context: every feat item currently on the draft actor. Origin-subtype
   * feats (background's granted feat, or a species-granted origin pick like Human's
   * Versatile) get a swap control instead of plain text, since many background items
   * grant a fixed origin feat via a plain ItemGrant even though the real 2024 rule
   * lets the player pick freely among any origin feat.
   *
   * Filters on `system.type.value === "feat"`, not just the document type "feat" -
   * dnd5e also stores class features (Spellcasting, Metamagic, individual Metamagic
   * options, subclass features, ...) as document type "feat" with `system.type.value
   * === "class"` instead. Without this filter, a real Feat can end up buried under
   * several class-feature entries in the list.
   *
   * The origin-feat swap control is further gated by the GM's `minFeatLevel` house rule
   * (`areFeatsAllowedAtLevel`, checked against total character level across every
   * class) - an origin-subtype feat still displays either way, it just loses its swap
   * dropdown when not allowed yet.
   */
  async _prepareFeatsContext() {
    const featItems = this.draft.actor.items.filter((item) => item.system.type?.value === "feat");
    const hasOriginFeat = featItems.some((item) => item.system.type?.subtype === ORIGIN_FEAT_SUBTYPE);
    const totalLevel = this.draft.actor.items
      .filter((item) => item.type === "class")
      .reduce((sum, item) => sum + item.system.levels, 0);
    const canSwapOriginFeat = areFeatsAllowedAtLevel(totalLevel);

    let originFeatOptions = [];
    if (hasOriginFeat && canSwapOriginFeat) {
      const allFeats = await getStepItems("feat", this.rulesetVersions);
      originFeatOptions = allFeats
        .filter((item) => item.subtype === ORIGIN_FEAT_SUBTYPE)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const feats = featItems.map((item) => {
      const subtype = item.system.type?.subtype ?? null;
      const isOrigin = subtype === ORIGIN_FEAT_SUBTYPE;
      const canSwap = isOrigin && canSwapOriginFeat;

      return {
        id: item.id,
        name: item.name,
        img: item.img,
        color: hashCardColor(item.name),
        subtypeLabel: subtype ? (CONFIG.DND5E.featureTypes.feat?.subtypes[subtype] ?? null) : null,
        isOrigin,
        canSwap,
        options: canSwap
          ? originFeatOptions.map((option) => ({
              uuid: option.uuid,
              name: option.name,
              selected: option.name === item.name
            }))
          : null
      };
    });

    return { feats };
  }

  /**
   * Skills step context: a live, read-only table of all 18 skills. Every skill
   * proficiency choice (class picks, Skillful-style species traits, background grants,
   * feats like Skilled) is already resolved inline by whichever step's Advancement
   * flow granted it - dnd5e's own derived data (`actor.system.skills`) already
   * aggregates all of that into one place, so this step has nothing left to do but
   * display it, same as saving throws never get a screen of their own either.
   */
  _prepareSkillsContext() {
    const skills = Object.entries(CONFIG.DND5E.skills)
      .map(([key, config]) => {
        const skill = this.draft.actor.system.skills[key];
        return {
          key,
          label: config.label,
          abilityKey: config.ability,
          abilityLabel: CONFIG.DND5E.abilities[config.ability]?.label ?? config.ability,
          abilityOrder: ABILITY_KEYS.indexOf(config.ability),
          proficiencyLabel: CONFIG.DND5E.proficiencyLevels[String(skill.value)] ?? CONFIG.DND5E.proficiencyLevels["0"],
          isProficient: skill.value > 0,
          proficiencyTier: skill.value >= 2 ? "expertise" : skill.value >= 1 ? "prof" : skill.value > 0 ? "half" : "none",
          totalText: skill.total >= 0 ? `+${skill.total}` : `${skill.total}`,
          passive: skill.passive
        };
      })
      .sort((a, b) => a.abilityOrder - b.abilityOrder || a.label.localeCompare(b.label));

    return { skills };
  }

  /**
   * Spells step context. Cantrips/spells known by each of the draft actor's
   * spellcasting classes are grouped separately from anything granted by a feat/
   * background (e.g. Magic Initiate's spells) - dnd5e itself already tags every spell
   * item with a `system.sourceItem` string ("class:sorcerer", "feat:magic-initiate",
   * ...), set automatically on creation, so grouping needs no bookkeeping of our own.
   *
   * One group per entry in `actor.spellcastingClasses` (a real dnd5e getter keyed by
   * class identifier, already multiclass-aware) rather than assuming a single class -
   * a Wizard/Sorcerer multiclass shows two separate cantrip/spell groups here, each
   * with its own cap and its own "Add" picker restricted to that class's spell list.
   * Known simplification: `_maxSpellSlotLevel` caps every class's "add a spell" picker
   * to the actor's combined multiclass slot table rather than each class's own
   * single-class progression - correct for slots actually available to cast,
   * technically permissive for which spell *levels* a given class's own known-spells
   * list should be limited to.
   */
  _prepareSpellsContext() {
    const actor = this.draft.actor;
    const spellcastingClasses = actor.spellcastingClasses ?? {};
    const identifiers = Object.keys(spellcastingClasses);
    if (!identifiers.length) return { hasSpellcasting: false, spellcastingGroups: [] };

    const rollData = actor.getRollData();
    const classSourceKeys = new Set(identifiers.map((identifier) => `class:${identifier}`));

    const spellcastingGroups = identifiers.map((identifier) => {
      const classItem = spellcastingClasses[identifier];
      const spellcasting = classItem.system.spellcasting;

      const classSourceKey = `class:${identifier}`;
      const classSpellItems = actor.items.filter(
        (item) => item.type === "spell" && item.system.sourceItem === classSourceKey
      );
      const cantripItems = classSpellItems.filter((item) => item.system.level === 0);
      const leveledItems = classSpellItems.filter((item) => item.system.level > 0);

      const cantripsMax = rollData.scale?.[identifier]?.["cantrips-known"]?.value ?? 0;
      const preparedMax = spellcasting.preparation?.max ?? 0;

      return {
        identifier,
        className: classItem.name,
        cantrips: cantripsMax > 0
          ? {
              current: cantripItems.length,
              max: cantripsMax,
              canAdd: cantripItems.length < cantripsMax,
              items: cantripItems.map((item) => ({ id: item.id, name: item.name, img: item.img }))
            }
          : null,
        spells: preparedMax > 0
          ? {
              current: leveledItems.length,
              max: preparedMax,
              canAdd: leveledItems.length < preparedMax,
              items: leveledItems.map((item) => ({ id: item.id, name: item.name, img: item.img }))
            }
          : null
      };
    });

    const otherItems = actor.items.filter(
      (item) => item.type === "spell" && item.system.sourceItem && !classSourceKeys.has(item.system.sourceItem)
    );
    const otherGroupsMap = new Map();
    for (const item of otherItems) {
      const key = item.system.sourceItem;
      if (!otherGroupsMap.has(key)) otherGroupsMap.set(key, []);
      otherGroupsMap.get(key).push(item);
    }

    return {
      hasSpellcasting: true,
      spellcastingGroups,
      otherGroups: Array.from(otherGroupsMap.entries()).map(([key, items]) => ({
        label: this._humanizeSourceItem(key),
        items: items.map((item) => ({ id: item.id, name: item.name, img: item.img }))
      }))
    };
  }

  /** "feat:magic-initiate" -> "Magic Initiate" */
  _humanizeSourceItem(sourceItem) {
    const identifier = sourceItem.split(":")[1] ?? sourceItem;
    return identifier
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Highest spell level the draft actor can currently cast, read from dnd5e's own
   * derived slot data rather than recomputing class progression ourselves.
   */
  _maxSpellSlotLevel() {
    return Object.values(this.draft.actor.system.spells)
      .filter((slot) => slot.type === "spell" && slot.max > 0)
      .reduce((max, slot) => Math.max(max, slot.level ?? 0), 0);
  }

  /**
   * Add a cantrip or leveled spell to the draft actor's spellcasting class, via
   * dnd5e's own CompendiumBrowser.select - the exact same filter shape
   * ItemChoiceFlow's "browse" button builds for a class-spell-list restricted pick, so
   * results match what a Feats-step-style picker would offer. `system.method`/
   * `system.prepared` are set explicitly because a spell's compendium default
   * (`method: "always"`) wouldn't count against the class's known/prepared budget -
   * only `method` matching the class's own spellcasting type increments
   * `spellcasting.preparation.value`.
   * @param {string} identifier - class identifier, e.g. "wizard" (which spellcasting
   *   class's group the "Add" button was clicked in - relevant once multiclassed)
   * @param {"cantrip"|"spell"} kind
   */
  async _addClassSpell(identifier, kind) {
    const actor = this.draft.actor;
    const classItem = (actor.spellcastingClasses ?? {})[identifier];
    if (!classItem) return;

    const classSourceKey = `class:${identifier}`;

    // How many free slots are actually open for this kind right now - the browser lets
    // the player check as many boxes as fit, rather than forcing one pick + one reopen
    // per remaining slot.
    const existingOfKind = actor.items.filter(
      (item) => item.type === "spell" && item.system.sourceItem === classSourceKey
        && (kind === "cantrip" ? item.system.level === 0 : item.system.level > 0)
    ).length;
    const rollData = actor.getRollData();
    const capForKind = kind === "cantrip"
      ? (rollData.scale?.[identifier]?.["cantrips-known"]?.value ?? 0)
      : (classItem.system.spellcasting.preparation?.max ?? 0);
    const freeSlots = Math.max(1, capForKind - existingOfKind);

    const filters = { locked: { additional: {}, documentClass: "Item", types: new Set(["spell"]) } };
    filters.locked.additional.spelllist = { [`class:${identifier}`]: 1 };
    filters.locked.additional.level = kind === "cantrip"
      ? { min: 0, max: 0 }
      : { min: 1, max: this._maxSpellSlotLevel() };

    const { CompendiumBrowser } = dnd5e.applications;
    const result = await CompendiumBrowser.select({ filters, selection: { min: 1, max: freeSlots } });
    if (!result?.size) return;

    const toCreate = [];
    for (const uuid of result) {
      const item = await fromUuid(uuid);
      if (!item) continue;
      if (!(await this._confirmNotDuplicate(item.name))) continue;

      const data = item.toObject();
      data.system.method = classItem.system.spellcasting.type;
      data.system.prepared = 1;
      // Set explicitly rather than relying on dnd5e's own auto-detection (Item#_preCreate
      // only infers sourceItem when exactly one of the actor's spellcasting classes could
      // plausibly grant it - a shared-list cantrip on a multiclass actor with two
      // spellcasting classes would be left with no sourceItem at all, since dnd5e can't
      // tell which class it's for). We already know unambiguously which class's "Add"
      // button was clicked, so just say so.
      data.system.sourceItem = classSourceKey;
      toCreate.push(data);
    }
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

    this.render();
  }

  /**
   * Warn (without blocking) if the draft actor already has an item of this exact name
   * from a different source - the concrete case this exists for is a race/feat-granted
   * cantrip (e.g. a Tiefling's innate Fire Bolt-equivalent) being offered again as a
   * class spell pick. Duplicate spells/proficiencies generally don't stack under the
   * rules, so picking the same one twice just wastes a choice the player could have
   * spent elsewhere - this only exists to stop that happening by accident, not to
   * enforce anything, so declining the warning still lets the pick go through.
   * @param {string} name
   * @returns {Promise<boolean>} false only if the player backs out after being warned
   */
  async _confirmNotDuplicate(name) {
    const existing = this.draft.actor.items.find((item) => item.name === name);
    if (!existing) return true;

    const sourceLabel = existing.system.sourceItem
      ? this._humanizeSourceItem(existing.system.sourceItem)
      : game.i18n.localize("DND-CC.Duplicate.UnknownSource");

    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DND-CC.Duplicate.Title") },
      content: `<p>${game.i18n.format("DND-CC.Duplicate.Warning", { name, source: sourceLabel })}</p>`
    });
  }

  /** Spell items have no Advancement of their own, so a plain delete is enough. */
  async _removeSpell(itemId) {
    await this.draft.actor.deleteEmbeddedDocuments("Item", [itemId]);
    this.render();
  }

  /**
   * Equipment step context: the class's and background's starting-kit branches (see
   * starting-equipment.mjs for how the OR/AND tree gets normalized), any
   * weapon/armor/tool/focus category picks still pending within whichever branch is
   * currently selected, and the running inventory/currency/weight totals - the latter
   * two read straight from dnd5e's own derived data rather than summed by us.
   *
   * Only the character's *original* class grants starting equipment under the real
   * multiclassing rules - a second/third class only adds proficiencies, not another kit
   * - so this reads `item.isOriginalClass` (a real dnd5e getter backed by
   * `system.details.originalClass`, set automatically by AdvancementManager the moment
   * the very first class is added) rather than "any class item" like it used to when
   * only one class was possible. Falls back to the first class found if none is flagged
   * original for some reason, so a single-class draft never silently loses its kit.
   */
  async _prepareEquipmentContext() {
    const actor = this.draft.actor;
    const choices = this.draft.equipmentChoices;
    const classItems = actor.items.filter((item) => item.type === "class");
    const sourceItems = {
      class: classItems.find((item) => item.isOriginalClass) ?? classItems[0],
      background: actor.items.find((item) => item.type === "background")
    };

    const sources = [];
    for (const key of ["class", "background"]) {
      const sourceItem = sourceItems[key];
      if (!sourceItem) continue;

      const branches = getEquipmentBranches(sourceItem);
      if (!branches.length) continue;

      const selectedBranchId = choices[key];
      const selectedBranch = branches.find((branch) => branch._id === selectedBranchId) ?? null;

      const branchOptions = await Promise.all(
        branches.map(async (branch) => ({
          key,
          id: branch._id,
          label: branch.isWealth
            ? game.i18n.format("DND-CC.Equipment.WealthOption", { amount: branch.wealthAmount })
            : await branchLabel(branch),
          selected: branch._id === selectedBranchId
        }))
      );

      let pendingChoices = [];
      if (selectedBranch) {
        const { choices: pending } = resolveBranch(selectedBranch);
        pendingChoices = pending
          .filter((entry) => !actor.items.some((item) => item.flags?.[MODULE_ID]?.equipmentEntry === entry._id))
          .map((entry) => ({
            key,
            id: entry._id,
            label: entry.label,
            isFocus: entry.type === "focus",
            focusOptions: entry.type === "focus"
              ? Object.entries(CONFIG.DND5E.focusTypes[entry.key]?.itemIds ?? {}).map(([name, uuid]) => ({
                  uuid,
                  label: name.charAt(0).toUpperCase() + name.slice(1)
                }))
              : null
          }));
      }

      sources.push({
        key,
        sourceName: sourceItem.name,
        branches: branchOptions,
        selectedBranchId,
        pendingChoices
      });
    }

    const inventory = actor.items
      .filter((item) => EQUIPMENT_ITEM_TYPES.includes(item.type))
      .map((item) => {
        const purchasedGp = item.getFlag(MODULE_ID, "purchasedPriceGp");
        return {
          id: item.id,
          name: item.name,
          img: item.img,
          quantityText: item.system.quantity > 1 ? ` (${item.system.quantity})` : "",
          priceText: purchasedGp ? formatGp(purchasedGp) : null
        };
      });

    return {
      equipmentSources: sources,
      inventory,
      availableGpText: formatGp(totalGpEquivalent(actor.system.currency)),
      currencyText: ["pp", "gp", "ep", "sp", "cp"]
        .map((key) => `${actor.system.currency[key] ?? 0} ${key.toUpperCase()}`)
        .join(", "),
      weightText: `${actor.system.attributes.encumbrance?.value ?? 0} / ${actor.system.attributes.encumbrance?.max ?? 0}`
    };
  }

  /**
   * Pick (or switch to) one of a source's starting-kit branches: clears anything the
   * source previously granted, records the new choice, then creates whatever that
   * branch grants outright (linked items, currency) - any weapon/armor/tool/focus
   * category entries stay pending until resolved individually.
   * @param {"class"|"background"} source
   * @param {string} branchId
   */
  async _selectEquipmentBranch(source, branchId) {
    const sourceItem = this.draft.actor.items.find((item) => item.type === source);
    if (!sourceItem) return;

    await this._clearEquipmentSource(source, { resetChoice: false });

    const branch = getEquipmentBranches(sourceItem).find((candidate) => candidate._id === branchId);
    if (!branch) return;

    await this.draft.setEquipmentChoice(source, branchId);
    await this._applyEquipmentGrants(source, branchId, resolveBranch(branch).grants);

    this.render();
  }

  /** Create the "linked" item grants and apply the "currency" grants of one branch. */
  async _applyEquipmentGrants(source, branchId, grants) {
    const actor = this.draft.actor;
    const itemsToCreate = [];
    const currencyToAdd = {};

    for (const grant of grants) {
      if (grant.type === "currency") {
        currencyToAdd[grant.key] = (currencyToAdd[grant.key] ?? 0) + (grant.count ?? 0);
        continue;
      }

      const item = await fromUuid(grant.key);
      if (!item) continue;

      const data = item.toObject();
      data.system.quantity = grant.count ?? 1;
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentSource`, source);
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentBranch`, branchId);
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentEntry`, grant._id);
      itemsToCreate.push(data);
    }

    if (itemsToCreate.length) await actor.createEmbeddedDocuments("Item", itemsToCreate);

    if (Object.keys(currencyToAdd).length) {
      const updates = {};
      for (const [key, amount] of Object.entries(currencyToAdd)) {
        updates[`system.currency.${key}`] = (actor.system.currency[key] ?? 0) + amount;
      }
      await actor.update(updates);

      const granted = this.draft.equipmentCurrencyGranted[source] ?? {};
      for (const [key, amount] of Object.entries(currencyToAdd)) {
        granted[key] = (granted[key] ?? 0) + amount;
      }
      await this.draft.setEquipmentCurrencyGranted(source, granted);
    }
  }

  /**
   * Remove everything a source's chosen branch granted - tagged items plus exactly
   * the currency that branch added (not just zeroing currency outright, in case the
   * player topped it up some other way).
   */
  async _clearEquipmentSource(source, { resetChoice = true } = {}) {
    const actor = this.draft.actor;

    const taggedItems = actor.items.filter((item) => item.flags?.[MODULE_ID]?.equipmentSource === source);
    if (taggedItems.length) await actor.deleteEmbeddedDocuments("Item", taggedItems.map((item) => item.id));

    const grantedCurrency = this.draft.equipmentCurrencyGranted[source];
    if (grantedCurrency) {
      const updates = {};
      for (const [key, amount] of Object.entries(grantedCurrency)) {
        updates[`system.currency.${key}`] = Math.max(0, (actor.system.currency[key] ?? 0) - amount);
      }
      await actor.update(updates);
      await this.draft.setEquipmentCurrencyGranted(source, null);
    }

    if (resetChoice) {
      await this.draft.setEquipmentChoice(source, null);
      this.render();
    }
  }

  /** Locate a still-pending category-choice entry (and its branch) by id. */
  _findPendingEquipmentEntry(source, entryId) {
    const sourceItem = this.draft.actor.items.find((item) => item.type === source);
    if (!sourceItem) return {};

    const branchId = this.draft.equipmentChoices[source];
    const branch = getEquipmentBranches(sourceItem).find((candidate) => candidate._id === branchId);
    if (!branch) return {};

    const entry = resolveBranch(branch).choices.find((candidate) => candidate._id === entryId);
    return { entry, branch };
  }

  /**
   * Resolve a weapon/armor/tool category choice via dnd5e's own CompendiumBrowser,
   * filtered to the entry's item type and (when set) its specific subtype - confirmed
   * live the filter key is `additional.type.<subtype>` (e.g. "martialM"), the same
   * convention CompendiumBrowser uses for its own "Weapon Type" sidebar filter.
   */
  async _resolveEquipmentCategoryChoice(source, entryId) {
    const { entry, branch } = this._findPendingEquipmentEntry(source, entryId);
    if (!entry) return;

    const itemType = { weapon: "weapon", armor: "equipment", tool: "tool" }[entry.type];
    if (!itemType) return;

    const filters = { locked: { additional: {}, documentClass: "Item", types: new Set([itemType]) } };
    if (entry.key) filters.locked.additional.type = { [entry.key]: 1 };

    const { CompendiumBrowser } = dnd5e.applications;
    const result = await CompendiumBrowser.select({ filters, selection: { min: 1, max: 1 } });
    if (!result?.size) return;

    await this._grantEquipmentChoiceItem(source, branch._id, entry._id, Array.from(result)[0], entry.count ?? 1);
  }

  /**
   * Resolve a "focus" category choice (holy symbol, druidic focus, arcane focus) via
   * `CONFIG.DND5E.focusTypes` directly - it already gives the exact small item-UUID
   * pool per focus type, so no compendium browsing is needed here.
   */
  async _resolveEquipmentFocusChoice(source, entryId, uuid) {
    const { entry, branch } = this._findPendingEquipmentEntry(source, entryId);
    if (!entry) return;
    await this._grantEquipmentChoiceItem(source, branch._id, entry._id, uuid, entry.count ?? 1);
  }

  async _grantEquipmentChoiceItem(source, branchId, entryId, uuid, count) {
    const item = await fromUuid(uuid);
    if (!item) return;

    const data = item.toObject();
    data.system.quantity = count;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentSource`, source);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentBranch`, branchId);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.equipmentEntry`, entryId);
    await this.draft.actor.createEmbeddedDocuments("Item", [data]);

    this.render();
  }

  /**
   * Manual "add your own item" path. A priced item is a real purchase: its real
   * `system.price` (converted to a GP-equivalent via currency.mjs, reusing dnd5e's own
   * conversion rates) is deducted from the actor's actual currency, blocking the add
   * entirely if they can't afford it, so free gold-buying can't be used to cherry-pick
   * better value than the standard kits. An unpriced item (price.value is 0 or unset -
   * some gear, or anything homebrew) is still added for free, since there's no real
   * price to balance against. The purchase price is tagged on the created item
   * (`flags.<module>.purchasedPriceGp`) so removing it later can refund exactly what
   * was spent - see _removeEquipmentItem.
   */
  async _addManualEquipmentItem() {
    const { CompendiumBrowser } = dnd5e.applications;
    const filters = { locked: { documentClass: "Item", types: new Set(EQUIPMENT_ITEM_TYPES) } };
    const result = await CompendiumBrowser.select({ filters, selection: { min: 1, max: 1 } });
    if (!result?.size) return;

    const item = await fromUuid(Array.from(result)[0]);
    if (!item) return;

    const actor = this.draft.actor;
    const priceGp = itemPriceInGp(item);

    if (priceGp > 0) {
      const availableGp = totalGpEquivalent(actor.system.currency);
      if (availableGp < priceGp - 1e-6) {
        ui.notifications.warn(game.i18n.format("DND-CC.Equipment.CannotAfford", {
          item: item.name,
          price: formatGp(priceGp),
          available: formatGp(availableGp)
        }));
        return;
      }
      await actor.update({ "system.currency": redenominateGp(availableGp - priceGp) });
    }

    const data = item.toObject();
    if (priceGp > 0) foundry.utils.setProperty(data, `flags.${MODULE_ID}.purchasedPriceGp`, priceGp);
    await actor.createEmbeddedDocuments("Item", [data]);
    this.render();
  }

  async _removeEquipmentItem(itemId) {
    const actor = this.draft.actor;
    const refundGp = actor.items.get(itemId)?.getFlag(MODULE_ID, "purchasedPriceGp");
    if (refundGp) {
      const availableGp = totalGpEquivalent(actor.system.currency);
      await actor.update({ "system.currency": redenominateGp(availableGp + refundGp) });
    }
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
    this.render();
  }

  /** Write one field straight onto the draft actor - used by every plain About-step control. */
  async _updateAboutField(path, value) {
    await this.draft.actor.update({ [path]: value });
    this.render();
  }

  async _addLanguage(key) {
    const current = this.draft.actor.system.traits.languages.value;
    await this.draft.actor.update({ "system.traits.languages.value": Array.from(new Set([...current, key])) });
    this.render();
  }

  async _removeLanguage(key) {
    const current = this.draft.actor.system.traits.languages.value;
    await this.draft.actor.update({
      "system.traits.languages.value": Array.from(current).filter((existing) => existing !== key)
    });
    this.render();
  }

  /**
   * Ability Scores step context: the chosen generation method's controls plus a
   * base/bonus/total/modifier breakdown per ability. `base` is what the player
   * assigned this step; `bonus` is the running total of every delta a class/species/
   * background's Advancement has applied directly to the actor (tracked in
   * _selectItem via CharacterDraft#recordAbilityDelta) - kept separate so the
   * breakdown stays legible instead of just showing one opaque final number.
   */
  _prepareAbilitiesContext() {
    const method = this.draft.abilityMethod;
    const base = this.draft.abilityBaseScores;
    const bonus = this.draft.abilityBonus;
    const assignments = this.draft.abilityAssignments;
    const pool = this.draft.abilityPool;
    const isPoolMethod = method === "standardArray" || method === "roll";

    // Two rolls (or two Standard Array slots, though that array itself never repeats)
    // landing on the same value is a legitimate outcome - without this, every dropdown
    // would show indistinguishable duplicate options with no way to tell them apart.
    // Tag duplicate values with an occurrence number so each pool entry stays identifiable.
    const valueCounts = {};
    pool.forEach((value) => { valueCounts[value] = (valueCounts[value] ?? 0) + 1; });

    // A holder-per-index lookup, reused both per-ability (to build swap-capable select
    // options) and for the pool-summary strip (to show which ability currently holds
    // each rolled/array value at a glance, without opening every dropdown).
    const holderByIndex = {};
    for (const [k, i] of Object.entries(assignments)) holderByIndex[i] = k;

    const seenForSummary = {};
    const poolSummary = isPoolMethod
      ? pool.map((value, index) => {
          seenForSummary[value] = (seenForSummary[value] ?? 0) + 1;
          const holderKey = holderByIndex[index] ?? null;
          return {
            index,
            value,
            label: valueCounts[value] > 1 ? `${value} (#${seenForSummary[value]})` : `${value}`,
            holderLabel: holderKey ? (CONFIG.DND5E.abilities[holderKey]?.abbreviation ?? holderKey).toUpperCase() : null
          };
        })
      : [];

    const abilities = ABILITY_KEYS.map((key) => {
      const total = base[key] === null || base[key] === undefined ? null : base[key] + bonus[key];
      const mod = total === null ? null : Math.floor((total - 10) / 2);
      const hasValue = base[key] !== null && base[key] !== undefined;

      const seen = {};
      const isUnassigned = assignments[key] === undefined;
      // A <select> with no `selected` option defaults to displaying its first entry
      // regardless - without this placeholder, an untouched ability silently *looks*
      // assigned (e.g. shows "15") while `base[key]` stays null underneath, so the step
      // can never actually complete and there's no visible clue which ability is still
      // unset. Only shown until the player actually picks something for this ability.
      const poolOptions = isPoolMethod
        ? [
            ...(isUnassigned
              ? [{ index: "", value: null, label: game.i18n.localize("DND-CC.Abilities.ChoosePlaceholder"), selected: true }]
              : []),
            ...pool.map((value, index) => {
              seen[value] = (seen[value] ?? 0) + 1;
              return {
                index,
                value,
                label: valueCounts[value] > 1 ? `${value} (#${seen[value]})` : `${value}`,
                selected: assignments[key] === index
              };
            })
          ]
        : [];

      return {
        key,
        label: CONFIG.DND5E.abilities[key]?.label ?? key,
        base: base[key],
        bonusText: bonus[key] > 0 ? `+${bonus[key]}` : `${bonus[key]}`,
        totalText: total === null ? "-" : `${total}`,
        modText: mod === null ? "-" : mod >= 0 ? `+${mod}` : `${mod}`,
        poolOptions,
        // Roll only: this ability hasn't been rolled yet, so show a Roll button instead
        // of a value + reassignment select.
        needsRoll: method === "roll" && !hasValue
      };
    });

    return {
      abilityMethod: method,
      abilities,
      poolSummary,
      pointBuyRemaining: this.draft.pointBuyRemaining,
      pointBuyBudget: POINT_BUY_BUDGET,
      showAbilityTable: !!method,
      isAbilityStepComplete: this.draft.isAbilityAssignmentComplete,
      allowedAbilityMethods: Object.fromEntries(ABILITY_METHODS.map((key) => [key, isAbilityGenerationMethodAllowed(key)]))
    };
  }

  /**
   * About step context: alignment/physical characteristics, personality traits, the
   * biography rich text, Languages, and Lifestyle. Everything except Lifestyle reads
   * straight from dnd5e's own actor fields (`system.details.*`, `system.traits.languages`),
   * the same "no bookkeeping of our own" approach already used for Skills and saving
   * throws, since a species/background's Trait advancement (e.g. a background's
   * language choice) already writes straight into `system.traits.languages.value`.
   */
  _prepareAboutContext() {
    const details = this.draft.actor.system.details;

    const characteristics = ["gender", "eyes", "height", "weight", "age", "hair", "skin", "faith"].map((key) => ({
      key,
      label: game.i18n.localize(`DND-CC.About.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      value: details[key] ?? ""
    }));

    const alignmentOptions = Object.entries(CONFIG.DND5E.alignments)
      .filter(([key]) => isAlignmentKeyAllowed(key))
      .map(([, label]) => ({
        label,
        selected: label === details.alignment
      }));

    const personality = ["trait", "ideal", "bond", "flaw", "appearance"].map((key) => ({
      key,
      label: game.i18n.localize(`DND-CC.About.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      value: details[key] ?? ""
    }));

    return {
      characteristics,
      alignmentOptions,
      personality,
      biography: details.biography.value ?? "",
      actorUuid: this.draft.actor.uuid,
      ...this._prepareLanguagesContext(),
      lifestyles: LIFESTYLE_TIERS.map((tier) => ({
        key: tier.key,
        costLabel: tier.costLabel,
        label: game.i18n.localize(`DND-CC.About.LifestyleTier.${tier.key}`),
        selected: tier.key === this.draft.lifestyle
      }))
    };
  }

  /**
   * Languages section: the actor's known languages (read straight from
   * `system.traits.languages.value`, mapped through a flattened `CONFIG.DND5E.languages`
   * for a label - dnd5e keeps a pre-grouped display version at `.labels.languages` but it
   * loses the per-entry key, which the remove control needs) plus whatever's left to add.
   */
  _prepareLanguagesContext() {
    const flat = this._flattenLanguageOptions();
    const known = this.draft.actor.system.traits.languages.value;

    const languages = Array.from(known)
      .map((key) => ({ key, label: flat.get(key) ?? key }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const addableOptions = Array.from(flat.entries())
      .filter(([key]) => !known.has(key))
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      languages,
      addableLanguageOptions: addableOptions,
      languagesCustom: this.draft.actor.system.traits.languages.custom ?? ""
    };
  }

  /** Flatten CONFIG.DND5E.languages (a category tree) into a Map of selectable key -> localized label. */
  _flattenLanguageOptions() {
    const flat = new Map();
    const walk = (config) => {
      for (const [key, data] of Object.entries(config)) {
        if (typeof data === "string") flat.set(key, data);
        else if (data.selectable !== false) flat.set(key, data.label);
        if (data.children) walk(data.children);
      }
    };
    walk(CONFIG.DND5E.languages);
    return flat;
  }

  /**
   * Whether the current step has what it needs to allow moving on. Steps without a
   * completion requirement yet (placeholders) are always considered complete.
   *
   * For Class/Species/Background, "the item exists" alone isn't enough - dnd5e's own
   * AdvancementManager lets the player click past an unanswered Trait/ItemChoice/ASI
   * pick ("Next" is never disabled for those), so a class could land with its Fighting
   * Style or Skill Proficiencies never actually chosen and still read as "done."
   * hasUnresolvedAdvancement checks the real per-advancement value dnd5e itself tracks,
   * so the rail's warn state and the Review gate reflect what's actually still missing
   * rather than just item presence.
   */
  _isStepComplete(stepId) {
    if (stepId === "class") {
      const classItems = this.draft.actor.items.filter((item) => item.type === "class");
      if (!classItems.length) return false;
      return classItems.every((item) => !hasUnresolvedAdvancement(item, item.system.levels));
    }
    if (stepId === "species") {
      const item = this.draft.actor.items.find((item) => item.type === "race");
      return !!item && !hasUnresolvedAdvancement(item);
    }
    if (stepId === "background") {
      const item = this.draft.actor.items.find((item) => item.type === "background");
      return !!item && !hasUnresolvedAdvancement(item);
    }
    if (stepId === "abilities") return this.draft.isAbilityAssignmentComplete;
    return true;
  }

  /**
   * What's actually still missing for a required step, for the rail's own hover-info
   * icon - the same information the Class step's per-row hint already shows (see
   * missingHint in _prepareClassesContext), surfaced one level up so it's visible
   * without opening that step first. Empty when the step is complete or isn't one of
   * the required ones.
   * @param {string} stepId
   * @returns {string} localized hint text, or "" if nothing to show
   */
  _stepMissingHint(stepId) {
    if (stepId === "class") {
      const classItems = this.draft.actor.items.filter((item) => item.type === "class");
      if (!classItems.length) return game.i18n.localize("DND-CC.Rail.MissingClass");
      const missing = classItems.flatMap((item) => {
        const titles = unresolvedAdvancementTitles(item, item.system.levels);
        return titles.length && classItems.length > 1 ? [`${item.name}: ${titles.join(", ")}`] : titles;
      });
      return missing.length ? game.i18n.format("DND-CC.Class.MissingChoices", { list: missing.join(", ") }) : "";
    }
    if (stepId === "species") {
      const item = this.draft.actor.items.find((i) => i.type === "race");
      if (!item) return game.i18n.localize("DND-CC.Rail.MissingSpecies");
      const missing = unresolvedAdvancementTitles(item);
      return missing.length ? game.i18n.format("DND-CC.Class.MissingChoices", { list: missing.join(", ") }) : "";
    }
    if (stepId === "background") {
      const item = this.draft.actor.items.find((i) => i.type === "background");
      if (!item) return game.i18n.localize("DND-CC.Rail.MissingBackground");
      const missing = unresolvedAdvancementTitles(item);
      return missing.length ? game.i18n.format("DND-CC.Class.MissingChoices", { list: missing.join(", ") }) : "";
    }
    if (stepId === "abilities" && !this.draft.isAbilityAssignmentComplete) {
      return game.i18n.localize("DND-CC.Rail.MissingAbilities");
    }
    return "";
  }

  /**
   * Review step context: a read-only summary of every choice made so far, pulling from
   * the same context builders every other step already uses (abilities, skills, feats,
   * spells) rather than re-deriving any of it, plus the handful of top-line stats
   * (HP/AC/initiative/speed/size/passive perception) that are otherwise never shown
   * anywhere in the wizard - all read straight from dnd5e's own derived actor data, same
   * as everywhere else in this app. `canFinalize` mirrors the same REQUIRED_STEPS gate
   * `_finalizeCharacter` enforces, so the "Build Character" button can show a warning
   * banner instead of just silently failing when clicked.
   */
  async _prepareReviewContext() {
    const actor = this.draft.actor;
    const attributes = actor.system.attributes;
    const details = actor.system.details;

    const classItems = actor.items.filter((item) => item.type === "class");
    const speciesItem = actor.items.find((item) => item.type === "race");
    const backgroundItem = actor.items.find((item) => item.type === "background");

    const incompleteStepLabels = REQUIRED_STEPS.filter((id) => !this._isStepComplete(id)).map((id) =>
      game.i18n.localize(STEP_DEFINITIONS.find((step) => step.id === id).label)
    );

    const { feats } = await this._prepareFeatsContext();
    const equipment = actor.items
      .filter((item) => EQUIPMENT_ITEM_TYPES.includes(item.type))
      .map((item) => ({ id: item.id, name: item.name, quantityText: item.system.quantity > 1 ? ` (${item.system.quantity})` : "" }));

    const classSummary = classItems.map((item) => `${item.name} ${item.system.levels}`).join(" / ");

    return {
      characterName: actor.name,
      classSummary: classSummary || null,
      speciesName: speciesItem?.name ?? null,
      backgroundName: backgroundItem?.name ?? null,
      // Shown as full HP rather than the actor's real (possibly stale) current value - see
      // _finalizeCharacter for why current can lag behind max during creation.
      hpText: `${attributes.hp.max} / ${attributes.hp.max}`,
      ac: attributes.ac.value,
      proficiencyBonusText: `+${attributes.prof}`,
      initiativeText: attributes.init?.total >= 0 ? `+${attributes.init.total}` : `${attributes.init?.total}`,
      speed: attributes.movement?.walk,
      sizeLabel: CONFIG.DND5E.actorSizes[actor.system.traits.size]?.label ?? actor.system.traits.size,
      passivePerception: actor.system.skills.prc?.passive,
      alignment: details.alignment || null,
      abilities: this._prepareAbilitiesContext().abilities,
      proficientSkills: this._prepareSkillsContext().skills.filter((skill) => skill.isProficient),
      feats,
      ...this._prepareSpellsContext(),
      equipment,
      currencyText: ["pp", "gp", "ep", "sp", "cp"]
        .map((key) => `${actor.system.currency[key] ?? 0} ${key.toUpperCase()}`)
        .join(", "),
      incompleteStepLabels,
      canFinalize: incompleteStepLabels.length === 0,
      pendingReview: this.draft.pendingReview
    };
  }

  /**
   * PDF export context: everything the Review step already shows, plus the fuller
   * detail a standalone printable reference sheet should have that the in-wizard
   * summary deliberately keeps brief - the *full* 18-skill table (not just proficient
   * ones, reusing _prepareSkillsContext directly instead of _prepareReviewContext's
   * proficient-only filter) and the About step's physical/personality/backstory/
   * languages/lifestyle fields, none of which the Review step shows at all today.
   */
  async _preparePdfExportContext() {
    const reviewContext = await this._prepareReviewContext();
    const aboutContext = this._prepareAboutContext();

    return {
      ...reviewContext,
      skills: this._prepareSkillsContext().skills,
      characteristics: aboutContext.characteristics,
      personality: aboutContext.personality,
      biography: aboutContext.biography,
      languages: aboutContext.languages,
      lifestyleLabel: aboutContext.lifestyles.find((tier) => tier.selected)?.label ?? null
    };
  }

  /**
   * Render the PDF export template to a standalone HTML document in a new browser tab
   * and trigger the OS print dialog on it - Foundry has no built-in PDF generation
   * capability, and bundling a client-side PDF library (jsPDF or similar) felt like the
   * wrong tradeoff for this module's size/dependency footprint given every modern
   * browser's print dialog already offers "Save as PDF" as a print destination, so this
   * needs no library at all. The blank tab is opened *before* anything is awaited
   * (`window.open` right at the top of the handler, synchronously in the click event) -
   * opening it after an `await` risks the browser's popup blocker treating it as not
   * having come from a direct user gesture anymore.
   */
  async _exportToPdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      ui.notifications.warn(game.i18n.localize("DND-CC.Review.ExportPopupBlocked"));
      return;
    }

    const context = await this._preparePdfExportContext();
    const html = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/character-creator/pdf-export.hbs`,
      context
    );

    printWindow.document.write(html);
    printWindow.document.close();
  }

  /**
   * Export the same summary data the PDF export uses (see _preparePdfExportContext) to
   * a real Foundry JournalEntry instead of a print window - the other half of the
   * original "Local export: Journal Entry and PDF" idea, left outstanding when only PDF
   * got built. Reuses journal-export.hbs, a version of the same sections without the
   * print template's <style>/<script>/document-chrome wrapper, since a JournalEntryPage
   * only wants a plain HTML content fragment (Foundry's own journal view supplies the
   * styling, and a stored <script> tag wouldn't run from page content anyway).
   */
  async _exportToJournal() {
    const context = await this._preparePdfExportContext();
    const content = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/character-creator/journal-export.hbs`,
      context
    );

    const entry = await JournalEntry.create({
      name: context.characterName,
      pages: [{
        name: game.i18n.localize("DND-CC.Review.JournalPageName"),
        type: "text",
        text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }
      }]
    });

    ui.notifications.info(game.i18n.format("DND-CC.Review.ExportJournalSuccess", { name: context.characterName }));
    entry.sheet.render(true);
  }

  /**
   * "Start Over" - the wizard previously had no in-UI way to actually scrap an
   * in-progress character; the only way to discard a draft was the console
   * (CharacterDraft#discard already existed and is exactly what this calls - the gap
   * was purely a missing UI entry point). Gated behind a confirmation dialog since this
   * is a real, irreversible delete, same pattern as every other destructive confirm
   * already in this app (class removal, level decrease, finalize). Immediately starts a
   * brand new draft afterward rather than just closing the window, so declining to keep
   * the old character doesn't leave the player stranded with nothing open.
   */
  async _discardDraft() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DND-CC.Discard.Title") },
      content: `<p>${game.i18n.format("DND-CC.Discard.Confirm", { name: this.draft.actor.name })}</p>`
    });
    if (!confirmed) return;

    await this.draft.discard();
    this.draft = await this._resolveDraft();
    this.stepIndex = 0;
    this.visitedSteps = new Set([STEP_DEFINITIONS[0].id]);
    this.render();
  }

  /**
   * Resume the current user's in-progress draft, or start a new one.
   * @returns {Promise<CharacterDraft>}
   */
  async _resolveDraft() {
    const existing = CharacterDraft.findExisting();
    if (existing) return existing;

    return CharacterDraft.create({
      ruleset: game.settings.get(MODULE_ID, "defaultRuleset")
    });
  }

  /**
   * Run an async action (typically an actor update followed by a re-render) with a
   * visible busy state on the current step's body, instead of leaving the control that
   * triggered it with no feedback until the update round-trip and re-render both finish
   * - the Abilities step's Point Buy controls in particular can involve two sequential
   * actor updates per click (the flag write, then the derived-score sync), which is
   * enough of a gap on a loaded world to read as the wizard doing nothing. The class is
   * applied to the step body specifically (not the whole wizard window) so the
   * persistent identity bar and rail stay interactive throughout.
   * @param {() => Promise<void>} action
   */
  async _withBusy(action) {
    const body = this.element.querySelector(".dnd-cc-step-body");
    body?.classList.add("dnd-cc-busy");
    try {
      await action();
    } finally {
      // A finished action almost always re-renders, replacing this exact node - but
      // guard the removal anyway in case the action threw before ever calling render().
      body?.classList.remove("dnd-cc-busy");
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    root.querySelector(".dnd-cc-back")?.addEventListener("click", () => this._goToStep(this.stepIndex - 1));
    root.querySelector(".dnd-cc-next")?.addEventListener("click", () => this._goToStep(this.stepIndex + 1));

    // Persistent identity bar - name/portrait must be editable from the moment the
    // wizard opens (before Ruleset) and on every step after, per the "persistent wizard
    // shell" requirement, rather than gated to one step.
    root.querySelector("[data-identity-name]")?.addEventListener("change", async (event) => {
      const name = event.target.value.trim() || game.i18n.localize("DND-CC.WindowTitle");
      await this.draft.actor.update({ name });
      this.render();
    });

    root.querySelector("[data-overlay-close]")?.addEventListener("click", () => this._hideOverlay());

    root.querySelectorAll("[data-learn-more]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this._showItemDetail(el.dataset.learnMore);
      });
    });

    root.querySelectorAll("[data-add-custom]").forEach((el) => {
      el.addEventListener("click", () => this._showCustomItemForm(el.dataset.addCustom));
    });

    root.querySelectorAll("[data-choose-lineage]").forEach((el) => {
      el.addEventListener("click", () => this._showLineagePicker(el.dataset.chooseLineage));
    });

    root.querySelector("[data-open-source-filter]")?.addEventListener("click", () => this._showSourceFilter());
    root.querySelector("[data-discard-draft]")?.addEventListener("click", () => this._discardDraft());

    root.querySelector("[data-identity-portrait]")?.addEventListener("click", () => {
      const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
      new FilePickerImpl({
        type: "image",
        current: this.draft.actor.img,
        callback: async (path) => {
          await this.draft.actor.update({ img: path });
          this.render();
        }
      }).render(true);
    });

    root.querySelectorAll("[data-ruleset]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this.draft.setRuleset(el.dataset.ruleset);
        // Same "pick it, keep moving" auto-advance as Species/Background/first-Class -
        // Ruleset is a single click too, no reason to make the player also hit Next.
        this._goToStep(this.stepIndex + 1);
      });
    });

    root.querySelectorAll("[data-add-class]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._addClass(el.dataset.addClass);
      });
    });

    root.querySelectorAll("[data-remove-class]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._removeClass(el.dataset.removeClass);
      });
    });

    root.querySelectorAll("[data-review-class]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._reviewClass(el.dataset.reviewClass);
      });
    });

    root.querySelectorAll("[data-class-level]").forEach((el) => {
      el.addEventListener("change", async (event) => {
        await this._setClassLevel(el.dataset.classLevel, Number(event.currentTarget.value));
      });
    });

    root.querySelectorAll("[data-class-complexity]").forEach((el) => {
      el.addEventListener("click", () => {
        this.classComplexityFilter = el.dataset.classComplexity;
        this.render();
      });
    });

    root.querySelectorAll(".dnd-cc-step-species [data-uuid]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._selectItem(el.dataset.uuid, "race");
      });
    });

    root.querySelectorAll(".dnd-cc-step-background [data-uuid]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._selectItem(el.dataset.uuid, "background");
      });
    });

    root.querySelectorAll("[data-ability-method]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._withBusy(async () => {
          await this.draft.setAbilityMethod(el.dataset.abilityMethod);
          await this.render();
        });
      });
    });

    root.querySelectorAll("[data-ability-adjust]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._withBusy(async () => {
          const [key, direction] = el.dataset.abilityAdjust.split(":");
          await this.draft.adjustPointBuy(key, Number(direction));
          await this.render();
        });
      });
    });

    root.querySelectorAll("[data-ability-manual]").forEach((el) => {
      el.addEventListener("change", async () => {
        await this._withBusy(async () => {
          const value = el.value === "" ? null : Number(el.value);
          await this.draft.setAbilityBaseScore(el.dataset.abilityManual, value);
          await this.render();
        });
      });
    });

    root.querySelectorAll("[data-ability-pool]").forEach((el) => {
      el.addEventListener("change", async () => {
        if (el.value === "") return;
        await this._withBusy(async () => {
          await this.draft.assignAbilityPoolValue(el.dataset.abilityPool, Number(el.value));
          await this.render();
        });
      });
    });

    root.querySelectorAll("[data-ability-roll]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this._withBusy(async () => {
          await this.draft.rollAbility(el.dataset.abilityRoll);
          await this.render();
        });
      });
    });

    root.querySelectorAll("[data-origin-feat-select]").forEach((el) => {
      el.addEventListener("change", async () => {
        if (!el.value) return;
        await this._changeOriginFeat(el.dataset.originFeatSelect, el.value);
      });
    });

    root.querySelectorAll("[data-add-cantrip]").forEach((el) => {
      el.addEventListener("click", () => this._addClassSpell(el.dataset.addCantrip, "cantrip"));
    });

    root.querySelectorAll("[data-add-spell]").forEach((el) => {
      el.addEventListener("click", () => this._addClassSpell(el.dataset.addSpell, "spell"));
    });

    root.querySelectorAll("[data-remove-spell]").forEach((el) => {
      el.addEventListener("click", () => this._removeSpell(el.dataset.removeSpell));
    });

    root.querySelectorAll("[data-equipment-branch]").forEach((el) => {
      el.addEventListener("click", () => {
        const [source, branchId] = el.dataset.equipmentBranch.split(":");
        this._selectEquipmentBranch(source, branchId);
      });
    });

    root.querySelectorAll("[data-equipment-clear]").forEach((el) => {
      el.addEventListener("click", () => this._clearEquipmentSource(el.dataset.equipmentClear));
    });

    root.querySelectorAll("[data-equipment-choose]").forEach((el) => {
      el.addEventListener("click", () => {
        const [source, entryId] = el.dataset.equipmentChoose.split(":");
        this._resolveEquipmentCategoryChoice(source, entryId);
      });
    });

    root.querySelectorAll("[data-equipment-focus]").forEach((el) => {
      el.addEventListener("change", () => {
        if (!el.value) return;
        const [source, entryId] = el.dataset.equipmentFocus.split(":");
        this._resolveEquipmentFocusChoice(source, entryId, el.value);
      });
    });

    root.querySelector("[data-add-equipment]")?.addEventListener("click", () => this._addManualEquipmentItem());

    root.querySelectorAll("[data-remove-equipment]").forEach((el) => {
      el.addEventListener("click", () => this._removeEquipmentItem(el.dataset.removeEquipment));
    });

    root.querySelectorAll("[data-about-field]").forEach((el) => {
      el.addEventListener("change", () => {
        this._updateAboutField(`system.details.${el.dataset.aboutField}`, el.value);
      });
    });

    root.querySelector("[data-about-alignment]")?.addEventListener("change", (event) => {
      this._updateAboutField("system.details.alignment", event.currentTarget.value);
    });

    root.querySelector("prose-mirror[data-about-biography]")?.addEventListener("change", (event) => {
      this._updateAboutField("system.details.biography.value", event.target.value);
    });

    root.querySelector("[data-language-add]")?.addEventListener("change", (event) => {
      if (!event.currentTarget.value) return;
      this._addLanguage(event.currentTarget.value);
    });

    root.querySelectorAll("[data-language-remove]").forEach((el) => {
      el.addEventListener("click", () => this._removeLanguage(el.dataset.languageRemove));
    });

    root.querySelector("[data-language-custom]")?.addEventListener("change", (event) => {
      this._updateAboutField("system.traits.languages.custom", event.currentTarget.value);
    });

    root.querySelectorAll("[data-lifestyle]").forEach((el) => {
      el.addEventListener("click", async () => {
        await this.draft.setLifestyle(el.dataset.lifestyle);
        this.render();
      });
    });

    root.querySelectorAll("[data-step]").forEach((el) => {
      el.addEventListener("click", () => {
        // Any step is reachable directly from the rail, not just ones already passed -
        // jumping around never touches any data on its own (only an in-step action like
        // picking an item does), so there's nothing to protect by restricting movement.
        const index = STEP_DEFINITIONS.findIndex((step) => step.id === el.dataset.step);
        this._goToStep(index);
      });
    });

    root.querySelector("[data-finalize-character]")?.addEventListener("click", () => this._finalizeCharacter());
    root.querySelector("[data-export-pdf]")?.addEventListener("click", () => this._exportToPdf());
    root.querySelector("[data-export-journal]")?.addEventListener("click", () => this._exportToJournal());
  }

  /**
   * Show dnd5e's Advancement UI inline in our own step content instead of letting it
   * float as a separate popup window. Swaps the step's normal content (the class grid,
   * the species list, whatever's currently showing) for a bare host div, runs
   * `operation` against it (a callback that forwards the host into choice-queue.mjs's
   * `triggerAdvancement`/`removeItemWithAdvancement`/`changeClassLevel`, which render
   * the real `AdvancementManager` chromeless via
   * `{window: {frame: false, positioned: false}}` and relocate its element into the
   * host right after its first render), then lets the caller's own `this.render()`
   * afterward naturally rebuild the step content back to normal - no explicit teardown
   * needed here.
   *
   * Safe to swap step content directly via DOM manipulation, bypassing our own
   * Handlebars render cycle entirely, because nothing in this app calls `this.render()`
   * while `operation`'s promise is still pending (every call site already awaits the
   * advancement call before its own `this.render()`). The embedded manager's element
   * survives untouched across its own internal re-renders as the player clicks through
   * steps, precisely because nothing *else* is re-rendering our wizard's DOM out from
   * under it during that window.
   *
   * The host always includes its own Cancel button, since going frameless drops the
   * native popup's title-bar close (X) button along with the rest of the chrome -
   * clicking it finds whichever `AdvancementManager` instance is currently live and
   * calls `.close()` on it, which still shows dnd5e's own "Stop Advancement?"
   * confirmation first, exactly like the native popup's close button always did.
   * @param {(host: HTMLElement) => Promise<void>} operation
   */
  async _runEmbeddedAdvancement(operation) {
    const content = this.element.querySelector(".dnd-cc-content");

    const host = document.createElement("div");
    host.className = "dnd-cc-advancement-host";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "dnd-cc-advancement-cancel";
    cancelButton.innerHTML = `<i class="fa-solid fa-xmark"></i> ${game.i18n.localize("DND-CC.Advancement.Cancel")}`;
    cancelButton.addEventListener("click", () => {
      const manager = Array.from(foundry.applications.instances.values()).find(
        (app) => app.constructor.name === "AdvancementManager"
      );
      manager?.close();
    });

    const body = document.createElement("div");
    body.className = "dnd-cc-advancement-body";

    host.append(cancelButton, body);
    content.replaceChildren(host);

    await operation(body);
  }

  /** Minimal HTML-escape for the handful of real item strings (names, ruleset tags)
   *  interpolated into the raw-DOM detail/custom overlay markup below. */
  _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[c]);
  }

  /**
   * Real feature names granted at/near level 1 of a class/species/background item, read
   * straight from its own ItemGrant advancement entries rather than any hand-authored
   * flavor text (no SRD text is copied anywhere in this module). Species/background
   * items don't have levels, so every ItemGrant on them is included; a class's
   * later-level features are deliberately left out here, this is a quick-glance summary
   * only, not a full feature list (which is what the real compendium page is for - see
   * the "Open in Compendium" link this feeds).
   * @param {Item5e} item
   * @param {number} limit
   * @returns {Promise<string[]>}
   */
  async _getItemGrantFeatureNames(item, limit = 5) {
    // item.system.advancement is the raw AdvancementCollection (no .byId of its own) -
    // the id/level/type-grouped views (.byId/.byLevel/.byType) live on the separate
    // item.advancement convenience getter instead.
    const advancements = Object.values(item.advancement?.byId ?? {})
      .filter((a) => a.type === "ItemGrant" && (a.level ?? 1) <= 1)
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

    const uuids = [];
    for (const grant of advancements) {
      for (const entry of grant.configuration?.items ?? []) {
        if (entry.uuid) uuids.push(entry.uuid);
      }
    }

    const names = [];
    for (const uuid of uuids.slice(0, limit)) {
      const granted = await fromUuid(uuid);
      if (granted) names.push(granted.name);
    }
    return names;
  }

  /** Show arbitrary content in the wizard's own in-shell overlay (never a floating
   *  popup window - matches the rest of the app's "nothing pops out" design). */
  _showOverlay(contentEl) {
    const root = this.element;
    const overlay = root.querySelector("[data-overlay]");
    const panel = root.querySelector("[data-overlay-panel]");
    panel.replaceChildren(contentEl);
    overlay.hidden = false;
    panel.querySelector("[data-overlay-close]")?.addEventListener("click", () => this._hideOverlay());
    panel.querySelector("[data-open-compendium]")?.addEventListener("click", async (event) => {
      const opened = await fromUuid(event.currentTarget.dataset.openCompendium);
      opened?.sheet?.render(true);
    });
  }

  _hideOverlay() {
    const overlay = this.element.querySelector("[data-overlay]");
    if (overlay) overlay.hidden = true;
  }

  /**
   * "Learn More" detail panel for a Class/Species/Background card. Built from real,
   * already-available data only (the same hit die/primary ability/speed pills the
   * cards show, plus real granted-feature names via _getItemGrantFeatureNames) rather
   * than hand-authored flavor text, since this has to work for any class/species/
   * background in any compendium a GM has enabled, not a fixed set. "Open in
   * Compendium" opens the real item sheet.
   * @param {string} uuid
   */
  async _showItemDetail(uuid) {
    const item = await fromUuid(uuid);
    if (!item) return;

    const pills = decorateCardPills({
      hitDie: item.system.hd?.denomination ?? null,
      primaryAbilities: item.system.primaryAbility?.value?.length ? item.system.primaryAbility.value : null,
      speed: item.system.movement?.walk ?? null
    }).pills;
    const features = await this._getItemGrantFeatureNames(item);
    const ruleset = item.system.source?.label ?? item.system.source?.rules ?? null;
    const esc = this._escapeHtml.bind(this);

    const wrapper = document.createElement("div");
    wrapper.className = "dnd-cc-detail-modal";
    wrapper.innerHTML = `
      <div class="dnd-cc-detail-header" style="background-color:${esc(item.type === "class" ? classCardColor(item.name) : hashCardColor(item.name))}">
        <div class="dnd-cc-detail-icon"><img src="${esc(item.img)}" alt="" /></div>
        <div class="dnd-cc-detail-title">
          <span class="dnd-cc-detail-name">${esc(item.name)}</span>
          ${ruleset ? `<span class="dnd-cc-card-edition">${esc(ruleset)}</span>` : ""}
        </div>
        <button type="button" class="dnd-cc-detail-close" data-overlay-close aria-label="${esc(game.i18n.localize("DND-CC.Close"))}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dnd-cc-detail-body">
        ${pills.length ? `<div class="dnd-cc-pill-row">${pills.map((p) => `<span class="dnd-cc-pill">${esc(p)}</span>`).join("")}</div>` : ""}
        ${features.length ? `
          <div class="dnd-cc-section-label">${esc(game.i18n.localize("DND-CC.Detail.Features"))}</div>
          <ul class="dnd-cc-detail-features">${features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ` : ""}
        <button type="button" class="dnd-cc-detail-open-compendium" data-open-compendium="${esc(item.uuid)}">
          <i class="fa-solid fa-book"></i> ${esc(game.i18n.localize("DND-CC.Detail.OpenInCompendium"))}
        </button>
      </div>
    `;

    this._showOverlay(wrapper);
  }

  /**
   * The "which lineage" sub-picker a grouped species card (see _groupLineageCards)
   * opens instead of selecting directly - re-fetches and re-filters the real species
   * list rather than trusting a cached copy, so it can't show a lineage a house rule
   * banned or that a compendium toggle removed since the grid last rendered. Picking a
   * lineage runs the exact same _selectItem flow as any other species card (real
   * Advancement, real auto-advance) - this is only a UI detour, not a different data path.
   * @param {string} baseName - e.g. "Elf"
   */
  async _showLineagePicker(baseName) {
    const items = await getStepItems("race", this.rulesetVersions);
    const members = items
      .filter((item) => {
        const match = item.name.match(/^(.+), (.+)$/);
        return match && match[1].trim() === baseName && !isSpeciesBanned(item.uuid);
      })
      .map((item) => ({ ...item, lineageLabel: item.name.split(",")[1].trim(), color: hashCardColor(item.name) }))
      .sort((a, b) => a.lineageLabel.localeCompare(b.lineageLabel));

    const esc = this._escapeHtml.bind(this);
    const wrapper = document.createElement("div");
    wrapper.className = "dnd-cc-detail-modal dnd-cc-lineage-picker";
    wrapper.innerHTML = `
      <div class="dnd-cc-detail-header">
        <div class="dnd-cc-detail-title">
          <span class="dnd-cc-detail-name">${esc(game.i18n.format("DND-CC.Lineage.PickerTitle", { base: baseName }))}</span>
        </div>
        <button type="button" class="dnd-cc-detail-close" data-overlay-close aria-label="${esc(game.i18n.localize("DND-CC.Close"))}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dnd-cc-detail-body">
        <ul class="dnd-cc-lineage-grid">
          ${members.map((m) => `
            <li class="dnd-cc-lineage-card" style="background-color:${esc(m.color)}" data-lineage-select="${esc(m.uuid)}">
              <div class="dnd-cc-card-icon"><img src="${esc(m.img)}" alt="" /></div>
              <span class="dnd-cc-lineage-name">${esc(m.lineageLabel)}</span>
            </li>
          `).join("")}
        </ul>
      </div>
    `;

    wrapper.querySelectorAll("[data-lineage-select]").forEach((el) => {
      el.addEventListener("click", async () => {
        this._hideOverlay();
        await this._selectItem(el.dataset.lineageSelect, "race");
      });
    });

    this._showOverlay(wrapper);
  }

  /**
   * The in-wizard "Sources" panel - a per-user narrowing on top of whatever the GM has
   * already enabled in Compendium Sources. Lists every GM-enabled pack with a checkbox
   * bound to setPlayerSourceVisibility; a pack the GM disabled entirely never appears
   * here at all, so this can only narrow the GM's allowlist, never expand it. Toggling
   * re-renders the whole wizard so the currently-viewed step's card grid updates live,
   * matching "live filter toggle during the wizard" rather than a settings-menu screen.
   */
  _showSourceFilter() {
    const packs = listPlayerVisiblePacks();
    const esc = this._escapeHtml.bind(this);

    const wrapper = document.createElement("div");
    wrapper.className = "dnd-cc-detail-modal dnd-cc-sources-panel";
    wrapper.innerHTML = `
      <div class="dnd-cc-detail-header">
        <div class="dnd-cc-detail-title">
          <span class="dnd-cc-detail-name">${esc(game.i18n.localize("DND-CC.Sources.PanelTitle"))}</span>
        </div>
        <button type="button" class="dnd-cc-detail-close" data-overlay-close aria-label="${esc(game.i18n.localize("DND-CC.Close"))}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dnd-cc-detail-body">
        <p class="dnd-cc-step-intro">${esc(game.i18n.localize("DND-CC.Sources.PanelHint"))}</p>
        ${packs.length ? `
          <ul class="dnd-cc-sources-list">
            ${packs.map((pack) => `
              <li class="dnd-cc-sources-row">
                <label>
                  <input type="checkbox" data-source-toggle="${esc(pack.id)}" ${pack.visible ? "checked" : ""} />
                  <span>${esc(pack.label)}</span>
                  ${pack.source ? `<span class="dnd-cc-sources-row-source">${esc(pack.source)}</span>` : ""}
                </label>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="dnd-cc-empty-state">${esc(game.i18n.localize("DND-CC.Sources.NoneEnabled"))}</p>`}
      </div>
    `;

    wrapper.querySelectorAll("[data-source-toggle]").forEach((el) => {
      el.addEventListener("change", async () => {
        await setPlayerSourceVisibility(el.dataset.sourceToggle, el.checked);
        // A full render regenerates the whole shell (including a fresh, empty overlay),
        // since the currently-viewed step's card grid needs to reflect the new filter
        // immediately - reopen the panel right after so toggling several sources in a
        // row doesn't close it between each click.
        await this.render();
        this._showSourceFilter();
      });
    });

    this._showOverlay(wrapper);
  }

  /**
   * "Add Custom" - creates a bare, unadvanced world Item as a homebrew placeholder (per
   * explicit user decision: a quick stub the GM finishes by hand in Foundry afterward,
   * not a full in-wizard authoring flow). It's a real Item with a real UUID, so it slots
   * into the exact same list/select/advancement machinery as any compendium entry -
   * getStepItems already includes matching world items (see compendium-sources.mjs) -
   * except picking it just adds the bare item with no cascade, since it has no
   * Advancement of its own.
   * @param {"class"|"race"|"background"} dnd5eType
   */
  _showCustomItemForm(dnd5eType) {
    const esc = this._escapeHtml.bind(this);
    const wrapper = document.createElement("div");
    wrapper.className = "dnd-cc-detail-modal dnd-cc-custom-form";
    wrapper.innerHTML = `
      <div class="dnd-cc-detail-header">
        <div class="dnd-cc-detail-title">
          <span class="dnd-cc-detail-name">${esc(game.i18n.localize("DND-CC.AddCustom"))}</span>
        </div>
        <button type="button" class="dnd-cc-detail-close" data-overlay-close aria-label="${esc(game.i18n.localize("DND-CC.Close"))}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="dnd-cc-detail-body">
        <p class="dnd-cc-step-intro">${esc(game.i18n.localize("DND-CC.CustomForm.Hint"))}</p>
        <label class="dnd-cc-identity-label">${esc(game.i18n.localize("DND-CC.CustomForm.Name"))}</label>
        <input type="text" class="dnd-cc-identity-name" data-custom-name placeholder="${esc(game.i18n.localize("DND-CC.CustomForm.NamePlaceholder"))}" />
        <button type="button" class="dnd-cc-detail-open-compendium" data-custom-create>
          <i class="fa-solid fa-plus"></i> ${esc(game.i18n.localize("DND-CC.CustomForm.Create"))}
        </button>
      </div>
    `;

    wrapper.querySelector("[data-custom-create]").addEventListener("click", async () => {
      const name = wrapper.querySelector("[data-custom-name]").value.trim();
      if (!name) return;
      // Flagged so getStepItems' world-item sweep only ever offers items a player
      // actually created through this form - an unrelated world Item (a GM's
      // in-progress draft, an import tool's leftover copy) shouldn't silently become a
      // pickable "homebrew" option for every player just by existing in the world.
      const created = await Item.create({ type: dnd5eType, name, flags: { [MODULE_ID]: { homebrewStub: true } } });
      this._hideOverlay();
      this.render();
      created.sheet.render(true);
    });

    this._showOverlay(wrapper);
  }

  /**
   * Replace whatever item of the given dnd5e type is currently on the draft (if any)
   * with the newly picked one, then run dnd5e's own Advancement flow for it. Used for
   * Species and Background - the "pick exactly one, swap freely" steps. Class no longer
   * goes through this method: a character can have more than one class, so it needs its
   * own add/remove pair instead of a replace (see _addClass/_removeClass below).
   *
   * Removal goes through removeItemWithAdvancement rather than a plain delete, so
   * whatever the old item's Advancement granted (other items, traits, scale values)
   * gets cleaned up too instead of left behind as orphans - a plain
   * deleteEmbeddedDocuments would leave granted items like a species's feats behind.
   *
   * The old item is removed *before* the new one is added - this is the only order
   * that actually works: dnd5e itself rejects a second race/background item outright
   * while one is already on the actor ("Only a single Species can be added to a Player
   * Character", from dnd5e's own validation) - a race/background genuinely can't have
   * both on the actor even briefly, unlike class, which is why this method doesn't
   * share _addClass/_removeClass's add-then-remove pattern. The real risk this creates
   * - cancelling the new item's flow after the old one is already gone, leaving neither
   * - is handled by asking first (see _confirmItemReplace) rather than by reordering,
   * since reordering isn't available here the way it was for _changeOriginFeat's feat
   * swap.
   * @param {string} uuid
   * @param {string} dnd5eType
   */
  async _selectItem(uuid, dnd5eType) {
    const item = await fromUuid(uuid);
    if (!item) return;

    const existing = this.draft.actor.items.find((i) => i.type === dnd5eType);
    if (existing && existing.name === item.name) return;
    if (existing) {
      const confirmed = await this._confirmItemReplace(existing, item);
      if (!confirmed) return;
    }

    let added = false;
    await this._runEmbeddedAdvancement(async (host) => {
      if (existing) {
        const beforeRemove = snapshotAbilities(this.draft.actor);
        await removeItemWithAdvancement(this.draft.actor, existing.id, host);
        await this.draft.recordAbilityDelta(diffAbilities(beforeRemove, snapshotAbilities(this.draft.actor)));
      }

      const before = snapshotAbilities(this.draft.actor);
      added = await triggerAdvancement(this.draft.actor, item.toObject(), host);
      await this.draft.recordAbilityDelta(diffAbilities(before, snapshotAbilities(this.draft.actor)));
    });

    // Auto-advance only on a genuinely completed pick, not just "some item of this type
    // exists" (which would also be true if the flow was cancelled and the old item was
    // correctly left in place - that's not a reason to move forward).
    if (added) this._goToStep(this.stepIndex + 1);
    else this.render();
  }

  /**
   * Warn before replacing an already-picked Species/Background, listing exactly what
   * it currently accounts for (itemsGrantedBy walks the same real
   * `flags.dnd5e.advancementOrigin` records itemsAtRiskFromLevelDecrease already reads
   * for Class) - so re-opening an already-completed step to look something up doesn't
   * risk silently losing everything if a card gets clicked. Skipped entirely when the
   * existing item granted nothing worth mentioning (nothing to lose).
   * @param {Item} existing
   * @param {Item} incoming
   * @returns {Promise<boolean>}
   */
  async _confirmItemReplace(existing, incoming) {
    const granted = itemsGrantedBy(this.draft.actor, existing.id);
    if (!granted.length) return true;

    const itemList = `<ul>${granted.map((granted_) => `<li>${granted_.name}</li>`).join("")}</ul>`;
    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DND-CC.ReplaceItem.Title") },
      content: `<p>${game.i18n.format("DND-CC.ReplaceItem.Warning", { old: existing.name, incoming: incoming.name })}</p>${itemList}`
    });
  }

  /**
   * Poll for an item of `dnd5eType` not among `excludeIds` to actually show up on the
   * draft actor - a real race between the Advancement completion hook and the new
   * item's creation actually landing locally: the hook this app's `triggerAdvancement`
   * waits on can fire a moment before `actor.items` locally reflects the new document,
   * so code that looks the new item up right afterward can find nothing (or, if it then
   * acts on that missing/stale state, silently skip work that should have happened). 20
   * tries at 100ms is generous relative to how fast the item typically shows up - if it
   * genuinely never arrives, the caller's own not-found handling (skip the follow-up
   * step, leave the old item in place, etc.) is the safe failure mode.
   * @param {string} dnd5eType
   * @param {string|Set<string>} excludeIds - a single id, or a set of ids, to exclude
   * @returns {Promise<Item|undefined>}
   */
  async _waitForNewItem(dnd5eType, excludeIds) {
    const isExcluded = excludeIds instanceof Set ? (id) => excludeIds.has(id) : (id) => id === excludeIds;
    const find = () => this.draft.actor.items.find((i) => i.type === dnd5eType && !isExcluded(i.id));
    for (let attempt = 0; attempt < 20; attempt++) {
      const found = find();
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return find();
  }

  /**
   * Wait for a just-removed class item to actually finish being removed, including the
   * actor's own reactive follow-up. Deleting a class item doesn't just delete the item -
   * Actor5e reacts to the deletion by re-picking `system.details.originalClass` (the
   * highest-level remaining class, or none) via its own separate `actor.update()` call,
   * not bundled into the same transaction as the deletion itself. `removeItemWithAdvancement`
   * only waits for the deletion's own advancement flow to finish, not for that follow-up
   * update - starting a new item's advancement flow before it lands clones an actor whose
   * `originalClass` still points at the just-deleted item, which makes dnd5e treat the new
   * item as a genuine second class (multiclass) instead of the character's first, granting
   * the reduced multiclass proficiency set and skipping choices multiclassing doesn't grant
   * (e.g. Skill Proficiencies) even though the actor has no other class at all.
   * @param {string} removedClassId
   * @returns {Promise<void>}
   */
  async _waitForClassRemoval(removedClassId) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const stillPresent = this.draft.actor.items.has(removedClassId);
      const staleOriginalClass = this.draft.actor.system.details.originalClass === removedClassId;
      if (!stillPresent && !staleOriginalClass) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Add a new class to the draft actor (multiclassing) - always starts at level 1 and
   * never touches any class already on the actor, unlike _selectItem's replace
   * semantics for Species/Background.
   * @param {string} uuid
   */
  async _addClass(uuid) {
    const item = await fromUuid(uuid);
    if (!item) return;

    await this._runEmbeddedAdvancement(async (host) => {
      const before = snapshotAbilities(this.draft.actor);
      await triggerAdvancement(this.draft.actor, item.toObject(), host);
      await this.draft.recordAbilityDelta(diffAbilities(before, snapshotAbilities(this.draft.actor)));
    });

    // Only auto-advance past Class on the character's very first class - multiclassing
    // (a second, third, ... class) should leave the player on this step to keep adding,
    // remove, or adjust levels, not force them forward every time.
    const classCount = this.draft.actor.items.filter((i) => i.type === "class").length;
    if (classCount === 1) this._goToStep(this.stepIndex + 1);
    else this.render();
  }

  /**
   * Remove one of the actor's classes entirely, reversing everything its Advancement
   * granted. Warns first via the same at-risk-items dialog a level decrease uses (see
   * _confirmClassReversal) since removing a class outright can lose just as much as
   * decreasing one to level 1 would - arguably more, since the class itself goes too.
   * @param {string} itemId
   */
  async _removeClass(itemId) {
    const classItem = this.draft.actor.items.get(itemId);
    if (!classItem) return;

    const confirmed = await this._confirmClassReversal(classItem, {
      title: "DND-CC.Class.RemoveTitle",
      introKey: "DND-CC.Class.RemoveWarning",
      introData: { name: classItem.name },
      newLevel: 0
    });
    if (!confirmed) return;

    await this._runEmbeddedAdvancement(async (host) => {
      const before = snapshotAbilities(this.draft.actor);
      await removeItemWithAdvancement(this.draft.actor, itemId, host);
      await this.draft.recordAbilityDelta(diffAbilities(before, snapshotAbilities(this.draft.actor)));
    });

    this.render();
  }

  /**
   * Bring one class item to `level`, running dnd5e's own Advancement for whatever
   * levels that spans (subclass picks, ASI-or-feat choices, class features - confirmed
   * live cascading through multiple levels in one flow). Leveling down reverses
   * automatically with no player interaction, so a decrease asks for confirmation first
   * and lists what would be lost - otherwise the player could lose a subclass, feats, or
   * Metamagic picks with zero warning.
   * @param {string} classItemId
   * @param {number} level
   * @returns {Promise<boolean>} false only when the player declined a level-decrease
   *   confirmation; true otherwise (including the no-op case where level is unchanged)
   */
  async _applyClassLevel(classItemId, level) {
    const classItem = this.draft.actor.items.get(classItemId);
    if (!classItem) return true;

    const delta = level - classItem.system.levels;
    if (delta === 0) return true;

    if (delta < 0) {
      const confirmed = await this._confirmClassReversal(classItem, {
        title: "DND-CC.Class.LevelDecreaseTitle",
        introKey: "DND-CC.Class.LevelDecreaseWarning",
        introData: { level },
        newLevel: level
      });
      if (!confirmed) return false;
    }

    await this._runEmbeddedAdvancement(async (host) => {
      const before = snapshotAbilities(this.draft.actor);
      await changeClassLevel(this.draft.actor, classItem.id, delta, host);
      await this.draft.recordAbilityDelta(diffAbilities(before, snapshotAbilities(this.draft.actor)));
    });
    return true;
  }

  /**
   * Warn before a class-level decrease (or a full class removal, see _removeClass)
   * actually reverses anything, listing the specific items that would be removed
   * (computed via itemsAtRiskFromLevelDecrease, which reads dnd5e's own per-advancement
   * `flags.dnd5e.advancementOrigin` records rather than guessing) plus a note if any
   * Ability Score Improvement points would be undone. Nothing at risk (e.g. dropping
   * from level 2 to 1 before hitting any real choices, or removing a fresh level-1
   * class) skips the dialog entirely - a full removal is the same operation as
   * decreasing to level 0, so `_removeClass` just calls this with `newLevel: 0`.
   * @param {Item} classItem
   * @param {object} options
   * @param {string} options.title - localization key for the dialog title
   * @param {string} options.introKey - localization key for the warning's intro line
   * @param {object} options.introData - format data for introKey
   * @param {number} options.newLevel - the level being reversed down to (0 for a full removal)
   * @returns {Promise<boolean>}
   */
  async _confirmClassReversal(classItem, { title, introKey, introData, newLevel }) {
    const { items, losesAbilityImprovement } = itemsAtRiskFromLevelDecrease(this.draft.actor, classItem, newLevel);
    if (!items.length && !losesAbilityImprovement) return true;

    const itemList = items.length
      ? `<ul>${items.map((item) => `<li>${item.name}</li>`).join("")}</ul>`
      : "";
    const abilityWarning = losesAbilityImprovement
      ? `<p>${game.i18n.localize("DND-CC.Class.LevelDecreaseAbilityWarning")}</p>`
      : "";
    const content = `<p>${game.i18n.format(introKey, introData)}</p>${itemList}${abilityWarning}`;

    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(title) },
      content
    });
  }

  /** Handle a class row's level selector changing on the Class step. */
  async _setClassLevel(classItemId, level) {
    await this._applyClassLevel(classItemId, level);
    this.render();
  }

  /**
   * Redo an already-added class's own Advancement from level 1 back up to its current
   * level, so a choice left unanswered earlier (surfaced by the missing-choices hint
   * next to its name) has a real way to get resolved instead of only being flagged.
   * dnd5e has an API that looks purpose-built for exactly this,
   * `AdvancementManager.forModifyChoices`, but it never actually populates its own
   * `.element` the way `forNewItem`/`forDeletedItem`/`forLevelChange` do, so embedding
   * it the same way just produces an empty host. Removing and re-adding the class
   * (reusing the same primitives every other swap in this app already relies on) redoes
   * every choice from scratch rather than only the missing one, which is more
   * disruptive than a true "resume where I left off" would be, but it's a real, working
   * path instead of a broken one.
   *
   * The re-add uses a blanked copy of the class's own data, not the original resolved
   * one - dnd5e's Advancement flow skips prompting for a choice whose value is already
   * populated, so reusing the original data verbatim would silently carry every old
   * pick forward instead of actually re-asking. `system.advancement` on plain item data
   * is a plain object keyed by advancement id, not an array.
   *
   * The original class is removed before the blank copy is added, never the other way
   * around: dnd5e grants a reduced multiclass proficiency set (for example a Barbarian
   * gets only Shields rather than the full Light/Medium/Shields list) to a class added
   * while another item sharing its identifier is already on the actor - correct for a
   * genuine second class, but also triggered by an add-then-remove redo, since the
   * blank copy would briefly coexist with the original. Removing first avoids the actor
   * ever holding two copies of the same class at once - see _waitForClassRemoval, which
   * also waits out Actor5e's own follow-up update to `system.details.originalClass`
   * after the removal, since that can lag behind the item deletion itself and cause the
   * same misclassification. The trade-off is the cancellation risk this design would
   * otherwise reintroduce: if the new copy's own flow is cancelled, the original is
   * restored from its intact data through a real advancement pass rather than a plain
   * recreate, since a Trait/ItemGrant advancement's resolved value only lands on the
   * actor's real derived traits (armor/weapon proficiencies, etc.) as a side effect of
   * a manager flow actually running - recreating the item directly leaves those derived
   * traits empty even though its own stored advancement values look complete. This
   * restore pass is still much lighter than the original redo, since every step already
   * shows its previous answer and only needs to be clicked through.
   * @param {string} classItemId
   */
  async _reviewClass(classItemId) {
    const classItem = this.draft.actor.items.get(classItemId);
    if (!classItem) return;

    const level = classItem.system.levels;
    const originalItemData = classItem.toObject();
    delete originalItemData._id;
    const blankItemData = foundry.utils.deepClone(originalItemData);
    for (const advancement of Object.values(blankItemData.system.advancement ?? {})) {
      advancement.value = {};
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("DND-CC.Class.ReviewTitle") },
      content: `<p>${game.i18n.format("DND-CC.Class.ReviewWarning", { name: classItem.name, level })}</p>`
    });
    if (!confirmed) return;

    const priorClassIds = new Set(this.draft.actor.items.filter((i) => i.type === "class").map((i) => i.id));

    await this._runEmbeddedAdvancement(async (host) => {
      const beforeRemove = snapshotAbilities(this.draft.actor);
      await removeItemWithAdvancement(this.draft.actor, classItemId, host);
      await this.draft.recordAbilityDelta(diffAbilities(beforeRemove, snapshotAbilities(this.draft.actor)));
      await this._waitForClassRemoval(classItemId);

      const beforeAdd = snapshotAbilities(this.draft.actor);
      const added = await triggerAdvancement(this.draft.actor, blankItemData, host);
      await this.draft.recordAbilityDelta(diffAbilities(beforeAdd, snapshotAbilities(this.draft.actor)));

      if (!added) {
        // Cancelled before even finishing level 1 - restore what was there instead of
        // leaving the actor with no class at all.
        const beforeRestore = snapshotAbilities(this.draft.actor);
        await triggerAdvancement(this.draft.actor, originalItemData, host);
        await this.draft.recordAbilityDelta(diffAbilities(beforeRestore, snapshotAbilities(this.draft.actor)));
        return;
      }

      if (level <= 1) return;

      // Same race _selectItem/_changeOriginFeat guard against: looking this up right
      // after triggerAdvancement resolves can miss the item entirely.
      const newClassItem = await this._waitForNewItem("class", priorClassIds);
      if (!newClassItem) return;

      const beforeLevel = snapshotAbilities(this.draft.actor);
      await changeClassLevel(this.draft.actor, newClassItem.id, level - 1, host);
      await this.draft.recordAbilityDelta(diffAbilities(beforeLevel, snapshotAbilities(this.draft.actor)));
      // If the re-level itself gets cancelled partway, the new class is simply left at
      // whatever level it reached rather than trying to restore the original on top of
      // an already-partially-leveled copy - a valid class at the wrong level is a safer
      // state than juggling two reversals in a row, and the level dropdown can always
      // finish the job afterward.
    });

    this.render();
  }

  /**
   * Swap an origin-subtype feat (background's granted feat, or a species-granted
   * origin pick) for a different one the player chose from the Feats step.
   *
   * Adds the new feat first and only removes the old one once that flow actually
   * completes, same reasoning as _selectItem above: a feat with its own nested choice
   * (e.g. Magic Initiate's spellcasting-ability/cantrip picks) can be cancelled
   * mid-flow via dnd5e's own "Stop Advancement" dialog, and removing the old feat first
   * would leave the character with neither.
   * @param {string} oldItemId
   * @param {string} uuid
   */
  async _changeOriginFeat(oldItemId, uuid) {
    const item = await fromUuid(uuid);
    if (!item) return;

    await this._runEmbeddedAdvancement(async (host) => {
      const before = snapshotAbilities(this.draft.actor);
      const added = await triggerAdvancement(this.draft.actor, item.toObject(), host);
      await this.draft.recordAbilityDelta(diffAbilities(before, snapshotAbilities(this.draft.actor)));

      if (added) {
        // Same race guarded against in _selectItem - wait for the new feat to actually
        // be visible before reversing the old one.
        const newItem = await this._waitForNewItem("feat", oldItemId);
        if (newItem) {
          const beforeRemove = snapshotAbilities(this.draft.actor);
          await removeItemWithAdvancement(this.draft.actor, oldItemId, host);
          await this.draft.recordAbilityDelta(diffAbilities(beforeRemove, snapshotAbilities(this.draft.actor)));
        }
      }
    });

    this.render();
  }

  _goToStep(index) {
    if (index < 0 || index >= STEP_DEFINITIONS.length) return;
    this.stepIndex = index;
    this.visitedSteps.add(STEP_DEFINITIONS[index].id);
    // Every caller (rail clicks, Back/Next, the various "pick it, keep moving"
    // auto-advances) goes through here, so wrapping this one spot covers all of them -
    // switching steps re-renders the whole wizard shell, not just the destination
    // step's own content, and on a heavier world that round-trip is worth showing
    // feedback for rather than leaving the old step looking unresponsive.
    this._withBusy(() => this.render());
  }

  /**
   * Review step's "Build Character" action: unflags the draft actor as a finished
   * character (CharacterDraft#finalize) rather than creating a new one - the draft has
   * been a real, fully-populated Actor all along, so finalizing is just removing the
   * flag that hides it from the Actor Directory and marks it a work in progress. Blocked
   * (with a warning listing what's missing) if any of REQUIRED_STEPS isn't done yet, in
   * case the player jumped straight to Review via the step tracker.
   *
   * If the `requireGmReview` world setting is on and the current user isn't a GM (a GM
   * building their own character skips the gate - there's no one else to review it for),
   * this doesn't finalize directly: it flags the draft as pending review and whispers the
   * GM an actionable chat card instead (see main.mjs's renderChatMessageHTML handler for
   * the approval side). The draft stays hidden from the Actor Directory either way, since
   * `isDraft` is only ever cleared by a real finalize.
   */
  async _finalizeCharacter() {
    const missing = REQUIRED_STEPS.filter((id) => !this._isStepComplete(id));
    if (missing.length) {
      ui.notifications.warn(game.i18n.localize("DND-CC.Review.IncompleteWarning"));
      return;
    }

    const requiresReview = game.settings.get(MODULE_ID, "requireGmReview") && !game.user.isGM;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(requiresReview ? "DND-CC.Review.SubmitReviewTitle" : "DND-CC.Review.FinalizeTitle") },
      content: `<p>${game.i18n.format(
        requiresReview ? "DND-CC.Review.SubmitReviewConfirm" : "DND-CC.Review.FinalizeConfirm",
        { name: this.draft.actor.name }
      )}</p>`
    });
    if (!confirmed) return;

    const actor = this.draft.actor;

    // Current HP can end up lagging behind max at this point - dnd5e's HitPointsAdvancement
    // sets current = max at the moment the Class step grants it, but a later step (e.g.
    // Species granting a flat per-level HP bonus like Dwarven Toughness) can raise max
    // afterward without current following, since current isn't derived data. A brand new
    // character should always start at full health regardless of pick order, so top it
    // off here.
    if (actor.system.attributes.hp.value < actor.system.attributes.hp.max) {
      await actor.update({ "system.attributes.hp.value": actor.system.attributes.hp.max });
    }

    if (requiresReview) {
      await this.draft.setPendingReview(true);
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="dnd-cc-review-chat-card">
            <p>${game.i18n.format("DND-CC.Review.PendingReviewMessage", { player: game.user.name, name: actor.name })}</p>
            <button type="button" data-action="dnd-cc-approve-review" data-actor-id="${actor.id}">
              <i class="fa-solid fa-check"></i> ${game.i18n.localize("DND-CC.Review.ApproveButton")}
            </button>
          </div>
        `
      });
      ui.notifications.info(game.i18n.format("DND-CC.Review.SubmitReviewSuccess", { name: actor.name }));
      this.render();
      return;
    }

    await this.draft.finalize();
    ui.actors.render();
    ui.notifications.info(game.i18n.format("DND-CC.Review.FinalizeSuccess", { name: actor.name }));
    this.close();
    actor.sheet.render(true);
  }

  /**
   * Which rules version(s) later steps should filter compendium content by.
   * @returns {("2014"|"2024")[]}
   */
  get rulesetVersions() {
    return this.draft?.rulesetVersions ?? [];
  }
}
