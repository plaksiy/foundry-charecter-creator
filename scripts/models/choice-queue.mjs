/**
 * Thin orchestration layer over dnd5e's own Advancement framework.
 *
 * This module does not resolve choices itself - dnd5e's AdvancementManager already
 * handles HP rolls, skill/tool proficiency picks, trait choices, subclass picks, item
 * grants, and scale values. Our job is only to trigger that flow against the draft
 * actor at the right time and report whether it completed.
 */

import { ABILITY_KEYS, MODULE_ID } from "../constants.mjs";
import { CharacterDraft } from "./character-draft.mjs";
import { getRulesetMismatchedSourceSlugs } from "../services/compendium-sources.mjs";

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
    //
    // While embedded, also force `animate: false` and hide `container` immediately -
    // even with `animate: false`, Foundry's own close() still sizes
    // the manager's real element down to a 0-height sliver for a noticeable stretch
    // (roughly half a second to a full second) before actually removing it, not just
    // during an eased CSS transition - `animate` only skips the transition, not this
    // resize-before-removal step itself. Inside a normal floating window that's
    // invisible (the whole window is going away anyway), but inside our bounded/clipped
    // embedded host it renders as a visibly broken, collapsed panel. Hiding the
    // container outright the instant a close is requested turns that into a blank gap
    // instead - far less jarring - until the caller's own `this.render()` replaces it
    // with the next step's real content. Outside our wizard (a vanilla native popup, no
    // `container`) this stays the normal animated close.
    const originalClose = manager.close.bind(manager);
    manager.close = async (options = {}) => {
      if (container?.isConnected) container.style.visibility = "hidden";
      const result = await originalClose(container ? { ...options, animate: false } : options);
      // originalClose only actually tears the manager down if the player confirms
      // dnd5e's own "Stop Advancement?" prompt (or there was nothing to confirm) -
      // declining leaves it rendered and still open. Resolving false unconditionally
      // here would tell the caller the flow was abandoned while the manager is still
      // genuinely mid-flow, and the caller's own post-await render() would then wipe
      // this container's host out from under a manager that never actually closed.
      if (!manager.rendered) resolve(false);
      else if (container?.isConnected) container.style.visibility = "";
      return result;
    };

    const rendering = manager.render(true);
    if (container) {
      rendering.then(() => {
        // A container can arrive here already carrying a leftover `visibility: hidden`
        // from a PRIOR manager's own close() (see above) - applies to any call site that
        // runs more than one manager through the same container in a row (e.g.
        // _selectItem's remove-then-add swap, _reviewClass's remove-then-add redo,
        // _changeOriginFeat's add-then-remove) without an app-level re-render in
        // between. Left uncleared, the new manager's own content renders correctly but
        // stays invisible until the caller's outer render() eventually fires. Clearing
        // it here is a no-op for the common single-manager-per-container case.
        container.style.visibility = "";
        // A manager whose steps are all `automatic` (a removeItemWithAdvancement
        // reversal, most commonly) can finish and call its own close() - which nulls
        // out `element` as part of ApplicationV2's own teardown - before this .then()
        // callback gets a turn to run, since close() can fire synchronously within the
        // same render() call for a fully-automatic flow. `container.append(undefined)`
        // still "succeeds" in that case, but per the Element.append() spec any non-Node
        // argument is coerced to a string first - stringifying `undefined` inserts a
        // literal "undefined" text node into the container. A species
        // swap's removal manager can leave exactly this stray text node sitting before
        // the next manager's own element once the container is visible again.
        if (manager.element) container.append(manager.element);
      });
    }
  });
}

// --- Embedded Subclass picker -----------------------------------------------
//
// The Subclass advancement step (shown inline as one of AdvancementManager's own steps,
// already embedded by the trick above) has its own internal "Browse" button that - unlike
// every choice this app resolves itself - dnd5e renders by calling
// `CompendiumBrowser.selectOne()` *directly*, bypassing our `runCompendiumBrowser` wrapper
// entirely (per `SubclassFlow.#browseCompendium`'s source). That
// meant clicking it always popped out a real floating window mid-wizard, and never got the
// ruleset-aware source filtering the Spells/Equipment pickers already have. Fixed the same
// way EmbeddedCompendiumBrowser fixes CompendiumBrowser itself: a thin subclass of dnd5e's
// real `SubclassFlow` that overrides just the `browse` action, swapped in for the real one
// via `SubclassAdvancement.metadata.apps.flow` - the actual class `AdvancementManager` asks
// for when it needs to render a Subclass step (`advancement.constructor.
// metadata.apps.flow` is what gets instantiated, read fresh from a *getter* each time, so
// simply overwriting `metadata.apps.flow` on a snapshot object doesn't stick - the getter
// itself has to be wrapped instead).

let embeddedSubclassFlowClass = null;
let subclassFlowPatched = false;

function getEmbeddedSubclassFlowClass() {
  if (!embeddedSubclassFlowClass) {
    const { SubclassFlow } = dnd5e.applications.advancement;
    embeddedSubclassFlowClass = class EmbeddedSubclassFlow extends SubclassFlow {
      static DEFAULT_OPTIONS = {
        actions: { browse: EmbeddedSubclassFlow.#browse }
      };

      /**
       * Replaces `SubclassFlow`'s own private `#browseCompendium` action - `this` is the
       * live Flow instance (ApplicationV2's action dispatch calls handlers with the app
       * as `this` even though they're declared `static`, matching dnd5e's own native
       * handler, which reads `this.item`/`this.advancement`/`this.level` the same way).
       * Only embeds when the *parent* AdvancementManager is itself running chromeless
       * (our own embedding signal, see EMBEDDED_WINDOW_OPTIONS) - outside our wizard
       * (a vanilla native level-up, or another module driving Advancement directly) this
       * falls through to the exact original behavior, so the patch is invisible there.
       */
      static async #browse(event, target) {
        const filters = {
          locked: {
            additional: { class: { [this.item.identifier]: 1 } },
            types: new Set(["subclass"])
          }
        };

        const embedded = this.manager?.options?.window?.frame === false;
        if (!embedded) {
          const result = await dnd5e.applications.CompendiumBrowser.selectOne({ filters }, this.manager?._detachOptions());
          if (result) {
            await this.advancement.apply(this.level, { uuid: result });
            this.render();
          }
          return;
        }

        const draft = new CharacterDraft(this.advancement.actor);
        const excludedSourceSlugs = await getRulesetMismatchedSourceSlugs(draft.rulesetVersions);

        const host = document.createElement("div");
        host.className = "dnd-cc-advancement-body dnd-cc-browser-body";

        // A player whose homebrew subclass doesn't exist yet used to have to cancel out
        // of this exact screen, go create it from the Class step's own separate "Add
        // Custom Subclass" tile, then come back - this does it right here instead. The
        // parent class's own identifier (this.item.identifier) is already known from
        // context, so unlike the Class-step version of this form there's nothing to ask
        // except a name. Applies the new stub immediately via the same
        // advancement.apply(...) path a real compendium pick already uses - no drag-
        // and-drop needed, since Subclass advancement grants by uuid either way.
        const addCustomButton = document.createElement("button");
        addCustomButton.type = "button";
        addCustomButton.className = "dnd-cc-browser-add-custom";
        addCustomButton.innerHTML = `<i class="fa-solid fa-plus"></i> ${game.i18n.localize("DND-CC.AddCustomSubclass")}`;
        addCustomButton.addEventListener("click", async () => {
          // Same "Create Items" world-permission gap _showCustomItemForm's own create
          // handler guards against - a non-GM player lacks it by default in Foundry.
          if (!game.user.can("ITEM_CREATE")) {
            ui.notifications.warn(game.i18n.localize("DND-CC.CustomForm.NoCreatePermission"));
            return;
          }

          const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("DND-CC.AddCustomSubclass") },
            content: `
              <p>${game.i18n.format("DND-CC.CustomForm.HintSubclassQuick", { className: this.item.name })}</p>
              <input type="text" name="custom-subclass-name" style="width: 100%;" autofocus />
            `,
            ok: {
              label: game.i18n.localize("DND-CC.CustomForm.Create"),
              callback: (_event, button) => button.form.elements["custom-subclass-name"].value.trim()
            }
          }).catch(() => null);
          if (!name) return;

          let created;
          try {
            created = await Item.create({
              type: "subclass",
              name,
              flags: { [MODULE_ID]: { homebrewStub: true } },
              system: { classIdentifier: this.item.identifier }
            });
          } catch (error) {
            console.error(`${MODULE_ID} | Failed to create custom subclass`, error);
            ui.notifications.error(game.i18n.localize("DND-CC.CustomForm.CreateFailed"));
            return;
          }

          await this.advancement.apply(this.level, { uuid: created.uuid });
          created.sheet.render(true);

          // The embedded browser is still open underneath, mid-await inside
          // runCompendiumBrowser below - closing it here resolves that promise with
          // null (same as a real Cancel), which is correct: the choice this browser was
          // showing is already resolved a different way now.
          const browserApp = Array.from(foundry.applications.instances.values()).find(
            (a) => a.constructor.name === "EmbeddedCompendiumBrowser"
          );
          browserApp?.close();
        });

        this.element.replaceChildren(addCustomButton, host);

        const result = await runCompendiumBrowser({ filters, selection: { min: 1, max: 1 } }, host, excludedSourceSlugs);
        if (result?.size) {
          await this.advancement.apply(this.level, { uuid: Array.from(result)[0] });
        }
        // Always re-render, success or cancel - the host div stays swapped in for the
        // flow's own real content otherwise, same rule every other embedded-browser call
        // site in this app already follows. render() only replaces the flow's own
        // named "content" part - it never touches this host, which was inserted as a
        // plain sibling via replaceChildren, not as a recognized part - so a render()
        // alone leaves it sitting in the DOM forever (hidden via runCompendiumBrowser's
        // own close() wrapper, but still occupying its full layout height), reading as
        // a large empty gap above the real content. Removing it explicitly is required.
        host.remove();
        this.render();
      }
    };
  }
  return embeddedSubclassFlowClass;
}

function patchSubclassFlowEmbedding() {
  if (subclassFlowPatched) return;
  subclassFlowPatched = true;

  const SubclassAdvancement = CONFIG.DND5E?.advancementTypes?.Subclass?.documentClass;
  const descriptor = SubclassAdvancement && Object.getOwnPropertyDescriptor(SubclassAdvancement, "metadata");
  if (!descriptor?.get) return;

  Object.defineProperty(SubclassAdvancement, "metadata", {
    configurable: true,
    get() {
      const metadata = descriptor.get.call(this);
      metadata.apps = { ...metadata.apps, flow: getEmbeddedSubclassFlowClass() };
      return metadata;
    }
  });
}

// --- Embedded "browse for a feat instead" (Ability Score Improvement) -------
//
// The level-up ASI-or-feat choice (including the 2024 rules' Epic Boon pick at level
// 19+) has the exact same "calls CompendiumBrowser directly, bypassing our wrapper"
// problem as the Subclass picker above - `AbilityScoreImprovementFlow`'s own `browse`
// action opens a real floating window regardless of the parent AdvancementManager's own
// embedded/chromeless state. Same fix, same shape: a thin subclass overriding only the
// `browse` action, swapped in via `AbilityScoreImprovementAdvancement.metadata.apps.flow`
// (also a getter, patched the same way). The non-embedded branch is copied verbatim from
// dnd5e's own `#browseCompendium` (including the prerequisite-validation step) so a
// vanilla native level-up (or another module driving Advancement directly) sees no
// behavior change at all.

let embeddedAbilityScoreImprovementFlowClass = null;
let abilityScoreImprovementFlowPatched = false;

function getEmbeddedAbilityScoreImprovementFlowClass() {
  if (!embeddedAbilityScoreImprovementFlowClass) {
    const { AbilityScoreImprovementFlow } = dnd5e.applications.advancement;
    embeddedAbilityScoreImprovementFlowClass = class EmbeddedAbilityScoreImprovementFlow extends AbilityScoreImprovementFlow {
      static DEFAULT_OPTIONS = {
        actions: { browse: EmbeddedAbilityScoreImprovementFlow.#browse }
      };

      static async #browse(event, target) {
        const filters = {
          locked: {
            additional: { category: { feat: 1 } },
            arbitrary: [{ k: "system.prerequisites.level", o: "lte", v: this.advancement.actor.system.details.level }],
            types: new Set(["feat"])
          }
        };

        const applyFeat = async (uuid) => {
          if (!uuid) return;
          const item = await fromUuid(uuid);
          const isValid = item.system.validatePrerequisites?.(this.advancement.actor, { showMessage: true });
          if (isValid === true) {
            await this.advancement.apply(this.level, { retainedItems: this.retainedData?.retainedItems, type: "feat", uuid });
          }
        };

        const embedded = this.manager?.options?.window?.frame === false;
        if (!embedded) {
          const result = await dnd5e.applications.CompendiumBrowser.selectOne({ filters, tab: "feats" }, this.manager?._detachOptions());
          await applyFeat(result);
          if (result) this.render();
          return;
        }

        const draft = new CharacterDraft(this.advancement.actor);
        const excludedSourceSlugs = await getRulesetMismatchedSourceSlugs(draft.rulesetVersions);

        const host = document.createElement("div");
        host.className = "dnd-cc-advancement-body dnd-cc-browser-body";
        this.element.replaceChildren(host);

        const result = await runCompendiumBrowser({ filters, selection: { min: 1, max: 1 } }, host, excludedSourceSlugs);
        await applyFeat(result?.size ? Array.from(result)[0] : null);
        // See EmbeddedSubclassFlow's own #browse for why this is required, not
        // optional - render() alone leaves this host (a plain sibling, not a
        // recognized part) sitting in the DOM as a large hidden-but-still-laid-out gap.
        host.remove();
        this.render();
      }
    };
  }
  return embeddedAbilityScoreImprovementFlowClass;
}

function patchAbilityScoreImprovementFlowEmbedding() {
  if (abilityScoreImprovementFlowPatched) return;
  abilityScoreImprovementFlowPatched = true;

  const ASIAdvancement = CONFIG.DND5E?.advancementTypes?.AbilityScoreImprovement?.documentClass;
  const descriptor = ASIAdvancement && Object.getOwnPropertyDescriptor(ASIAdvancement, "metadata");
  if (!descriptor?.get) return;

  Object.defineProperty(ASIAdvancement, "metadata", {
    configurable: true,
    get() {
      const metadata = descriptor.get.call(this);
      metadata.apps = { ...metadata.apps, flow: getEmbeddedAbilityScoreImprovementFlowClass() };
      return metadata;
    }
  });
}

// --- Embedded ItemChoice browse (Magic Initiate's spells, Metamagic-as-choice, a
// generic "pick N of this type" advancement, ...) --------------------------------
//
// Same problem, same fix, one more time - `ItemChoiceFlow`'s own `browse` action is
// what a feat/class's own nested "choose N items" advancement uses (Magic Initiate's
// cantrip/spell pick is the concrete case that motivated this), and it calls
// CompendiumBrowser directly too. Filter-construction copied verbatim from dnd5e's own
// `#browseCompendium` (type/level/spell-list restrictions) - only the non-embedded
// fallback and the embedded branch differ from the original.

let embeddedItemChoiceFlowClass = null;
let itemChoiceFlowPatched = false;

function getEmbeddedItemChoiceFlowClass() {
  if (!embeddedItemChoiceFlowClass) {
    const { ItemChoiceFlow } = dnd5e.applications.advancement;
    embeddedItemChoiceFlowClass = class EmbeddedItemChoiceFlow extends ItemChoiceFlow {
      static DEFAULT_OPTIONS = {
        actions: { browse: EmbeddedItemChoiceFlow.#browse }
      };

      static async #browse(event, target) {
        const config = this.advancement.configuration;
        const { current, max } = this.counts;
        if (current >= max) {
          ui.notifications.warn("DND5E.ADVANCEMENT.ItemChoice.Warning.MaxSelected", { localize: true });
          return;
        }

        const filters = { locked: { additional: {}, documentClass: "Item" } };
        if (config.type) {
          filters.locked.types = new Set([config.type]);
          if ((config.type === "feat") && config.restriction.type) {
            const typeConfig = CONFIG.DND5E.featureTypes[config.restriction.type];
            const subtype = typeConfig.subtypes?.[config.restriction.subtype];
            filters.locked.additional.category = { [config.restriction.type]: 1 };
            if (subtype) filters.locked.additional.subtype = { [config.restriction.subtype]: 1 };
          }
        } else {
          filters.locked.types = this.advancement.constructor.VALID_TYPES;
        }

        if (config.type === "feat") {
          filters.locked.arbitrary = [{ k: "system.prerequisites.level", o: "lte", v: this.featureLevel }];
        } else if ((config.type === "spell") && (config.restriction.level !== "")) {
          if (config.restriction.level === "available") {
            filters.locked.additional.level = { max: this._maxSpellSlotLevel() };
          } else {
            filters.locked.additional.level = {
              min: Number(config.restriction.level),
              max: Number(config.restriction.level)
            };
          }
        }

        if ((config.type === "spell") && config.restriction.list.size) {
          filters.locked.additional.spelllist = config.restriction.list.reduce((obj, list) => {
            obj[list] = 1;
            return obj;
          }, {});
        }

        const selectionOptions = { filters, selection: { min: 1, max: max - current } };

        const applySelection = async (result) => {
          if (!result?.size) return;
          const selected = Array.from(result).filter((uuid) => !this.selected.has(uuid));
          await this.advancement.apply(this.level, { selected });
        };

        const embedded = this.manager?.options?.window?.frame === false;
        if (!embedded) {
          const result = await dnd5e.applications.CompendiumBrowser.select(selectionOptions, this.manager?._detachOptions());
          await applySelection(result);
          if (result?.size) this.render();
          return;
        }

        const draft = new CharacterDraft(this.advancement.actor);
        const excludedSourceSlugs = await getRulesetMismatchedSourceSlugs(draft.rulesetVersions);

        const host = document.createElement("div");
        host.className = "dnd-cc-advancement-body dnd-cc-browser-body";
        this.element.replaceChildren(host);

        const result = await runCompendiumBrowser(selectionOptions, host, excludedSourceSlugs);
        await applySelection(result);
        // See EmbeddedSubclassFlow's own #browse for why this is required, not
        // optional - render() alone leaves this host (a plain sibling, not a
        // recognized part) sitting in the DOM as a large hidden-but-still-laid-out gap.
        // Especially visible here since ItemChoice can repeat this cycle several times
        // in a row (e.g. "choose 2 cantrips"), stacking one orphaned host per pick.
        host.remove();
        this.render();
      }
    };
  }
  return embeddedItemChoiceFlowClass;
}

function patchItemChoiceFlowEmbedding() {
  if (itemChoiceFlowPatched) return;
  itemChoiceFlowPatched = true;

  const ItemChoiceAdvancement = CONFIG.DND5E?.advancementTypes?.ItemChoice?.documentClass;
  const descriptor = ItemChoiceAdvancement && Object.getOwnPropertyDescriptor(ItemChoiceAdvancement, "metadata");
  if (!descriptor?.get) return;

  Object.defineProperty(ItemChoiceAdvancement, "metadata", {
    configurable: true,
    get() {
      const metadata = descriptor.get.call(this);
      metadata.apps = { ...metadata.apps, flow: getEmbeddedItemChoiceFlowClass() };
      return metadata;
    }
  });
}

/**
 * Apply all three embedding patches (Subclass, Ability Score Improvement, ItemChoice).
 * Must run *before* `AdvancementManager.forNewItem`/`forLevelChange`/`forDeletedItem`
 * construct their manager, not after - `AdvancementManager` resolves
 * each step's Flow class (`advancement.constructor.metadata.apps.flow`) at construction
 * time, not lazily when the player actually reaches that step. Patching only at the
 * start of `runAdvancementManager` (i.e. after the manager already existed) meant the
 * very first Ability-Score-Improvement-or-feat / ItemChoice / Subclass step reached in
 * an entire page session - whichever one happened to be the first manager ever
 * constructed - still got the *original*, unpatched Flow class and popped a real
 * floating CompendiumBrowser once, before quietly self-correcting for every manager
 * after that. Each individual patch function still only ever applies once (its own
 * module-level `*Patched` flag), so calling this from all three call sites below is
 * cheap and safe.
 */
function patchEmbeddedAdvancementFlows() {
  patchSubclassFlowEmbedding();
  patchAbilityScoreImprovementFlowEmbedding();
  patchItemChoiceFlowEmbedding();
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
  patchEmbeddedAdvancementFlows();
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = await AdvancementManager.forNewItem(actor, itemData, container ? EMBEDDED_WINDOW_OPTIONS : {});

  if (!manager.steps.length) {
    // An item with no Advancement at all (e.g. a flat-benefit feat like Alert) makes
    // `forNewItem` produce a manager with zero steps - calling
    // `manager.render(true)` on that throws ("Cannot read properties of null (reading
    // 'flow')", dnd5e's own render logic assumes a current step always exists) rather
    // than rendering an empty-but-harmless panel, permanently stalling the embedded host
    // with no way to recover short of closing the wizard. `removeItemWithAdvancement`
    // below already guards the equivalent case for removal - this mirrors it for adding.
    await actor.createEmbeddedDocuments("Item", [itemData]);
    return true;
  }

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
  patchEmbeddedAdvancementFlows();
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = AdvancementManager.forDeletedItem(actor, itemId, container ? EMBEDDED_WINDOW_OPTIONS : {});

  if (!manager.steps.length) {
    // Nothing to reverse (item granted no advancement) - just delete it directly.
    await actor.deleteEmbeddedDocuments("Item", [itemId]);
    return;
  }

  await runAdvancementManager(manager, container);
}

// --- Embedded CompendiumBrowser --------------------------------------------
//
// Same chromeless-embedding technique as AdvancementManager above, applied to dnd5e's
// other big popup-window Application - the spell/equipment picker. Needs one extra step
// AdvancementManager didn't: CompendiumBrowser's own `_renderFrame` override assumes a
// real header exists (it injects a GM-only "Configure Sources" cog button next to the
// close button), which throws under `{window: {frame: false}}` since the base frame is
// then just an empty element with no header at all. A thin subclass skips straight to
// the base ApplicationV2 frame instead of calling that override - the "Configure
// Sources" cog is still reachable from this module's own Compendium Sources settings
// screen, so nothing is lost by skipping it here.

let embeddedCompendiumBrowserClass = null;

function getEmbeddedCompendiumBrowserClass() {
  if (!embeddedCompendiumBrowserClass) {
    const { CompendiumBrowser } = dnd5e.applications;
    embeddedCompendiumBrowserClass = class EmbeddedCompendiumBrowser extends CompendiumBrowser {
      async _renderFrame(options) {
        return foundry.applications.api.ApplicationV2.prototype._renderFrame.call(this, options);
      }
    };
  }
  return embeddedCompendiumBrowserClass;
}

/**
 * Run dnd5e's CompendiumBrowser for a single pick, embedded chromeless in `container`
 * instead of floating as a separate popup window - mirrors `CompendiumBrowser.select()`
 * exactly (same options shape, same resolved value), just relocated into the wizard's
 * own step content when a container is given.
 * @param {object} options - the {filters, selection} shape CompendiumBrowser.select() takes
 * @param {HTMLElement} [container] - see runAdvancementManager
 * @param {string[]} [excludedSourceSlugs] - extra `system.source.slug` values (beyond the
 *   always-excluded generic SRD pair) to default-exclude from the Source filter, e.g.
 *   from getRulesetMismatchedSourceSlugs - see collapseFiltersByDefault below.
 * @returns {Promise<Set<string>|null>} the selected UUID set, or null if the player
 *   closed without selecting.
 */
export function runCompendiumBrowser(options, container, excludedSourceSlugs) {
  if (!container) return dnd5e.applications.CompendiumBrowser.select(options);

  const EmbeddedCompendiumBrowser = getEmbeddedCompendiumBrowserClass();
  const browser = new EmbeddedCompendiumBrowser({ ...options, ...EMBEDDED_WINDOW_OPTIONS });

  // Same "hide the container and skip the animation" fix as runAdvancementManager
  // above - covers both the Cancel button and dnd5e's own closeOnSubmit call after a
  // real Select, since both ultimately call this same instance's close().
  const originalClose = browser.close.bind(browser);
  browser.close = (opts = {}) => {
    if (container.isConnected) container.style.visibility = "hidden";
    return originalClose({ ...opts, animate: false });
  };

  return new Promise((resolve) => {
    browser.addEventListener("close", () => resolve(browser.selected?.size ? browser.selected : null), { once: true });
    browser.render({ force: true }).then(async () => {
      // Same leftover-hidden-container reset as runAdvancementManager above, for the
      // same reason - a container reused across more than one embedded app in a row
      // without an app-level re-render in between.
      container.style.visibility = "";
      if (!browser.element) return;
      container.append(browser.element);
      await collapseFiltersByDefault(browser.element, excludedSourceSlugs);
      arrangeEmbeddedBrowserFilters(browser.element);
    });
  });
}

/**
 * Collapse every filter group and exclude the generic SRD source packs (plus any
 * ruleset-mismatched book, see excludedSourceSlugs) by default, so the results grid is
 * visible immediately instead of buried under a fully-expanded filter sidebar (Level,
 * School, several Spell List groups, Properties, and Source all expanded at once, a real
 * complaint from live use).
 * @param {HTMLElement} browserElement
 * @param {string[]} [excludedSourceSlugs]
 */
async function collapseFiltersByDefault(browserElement, excludedSourceSlugs = []) {
  const sidebar = browserElement.querySelector(".sidebar");
  if (!sidebar) return;

  sidebar.querySelectorAll('[data-action="toggleCollapsed"]').forEach((toggle) => toggle.click());

  // excludedSourceSlugs (from getRulesetMismatchedSourceSlugs) already covers both a
  // ruleset mismatch AND a generic SRD book being redundant once a real named module
  // covers the same ruleset - conditionally, not a hardcoded always-exclude, so a GM
  // running on bundled SRD content alone (no fuller book installed) still sees it
  // normally. Excluded by default rather than locked, so a player who wants one back
  // can still re-include it with two more clicks on the Source filter like any other
  // source. A slug this particular browser instance never actually offers (not part of
  // its own tab/type) just has no matching filter-state element, a harmless no-op.
  for (const slug of excludedSourceSlugs) {
    await clickFilterStateToExclude(sidebar, `additional.source.${slug}`);
  }
}

/**
 * Click a `<filter-state>` 3-state toggle (0 unset -> 1 require -> -1 exclude) twice to
 * land on "exclude". dnd5e fully replaces
 * `[data-application-part="filters"]` with a brand new element after EVERY filter change
 * (not just once after the browser's first paint, which is what an earlier version of
 * this function assumed) - reusing the same element reference for a second `.click()`
 * therefore silently no-ops on an already-detached node instead of advancing its state,
 * which is why a straight `el.click(); el.click();` reliably got stuck on "require"
 * instead of ever reaching "exclude". Re-queries the element fresh before each click and
 * waits for the replacement (or a timeout, in case this particular click doesn't trigger
 * one - e.g. the filter doesn't exist at all for this browser's tab/type context) before
 * issuing the next one.
 *
 * The Source filter's own list of `<filter-state>` options is itself populated
 * asynchronously the first time a CompendiumBrowser instance is ever created in a
 * session (it has to index every enabled pack to know what sources even exist) -
 * genuinely slower than our own code reaching this point on a
 * cold first open, so a plain immediate `querySelector` for the target filter-state can
 * come up empty even though the exact same lookup succeeds instantly on a second open
 * later in the same session (the index is cached after the first build). The old
 * behavior gave up the moment that first lookup came back empty, which is exactly why
 * the SRD/ruleset exclusion silently didn't apply on a session's very first embedded
 * browser open. Waits for the element to actually exist (bounded by a timeout, in case
 * this filter genuinely doesn't exist for this browser's tab/type) before giving up.
 * @param {HTMLElement} sidebar
 * @param {string} filterName
 */
async function clickFilterStateToExclude(sidebar, filterName) {
  for (let step = 0; step < 2; step++) {
    const el = await waitForFilterStateElement(sidebar, filterName);
    if (!el) return;
    const filtersPart = sidebar.querySelector('[data-application-part="filters"]');
    const replaced = waitForFiltersPartReplacement(sidebar, filtersPart);
    el.click();
    await replaced;
  }
}

/**
 * Resolves with the live `filter-state[name="filterName"]` element inside `sidebar`'s
 * filters part once it exists, or `null` after a timeout - see clickFilterStateToExclude
 * for why this can't just be a single immediate querySelector.
 * @param {HTMLElement} sidebar
 * @param {string} filterName
 * @param {number} [timeoutMs]
 * @returns {Promise<HTMLElement|null>}
 */
function waitForFilterStateElement(sidebar, filterName, timeoutMs = 2000) {
  const selector = `[data-application-part="filters"] filter-state[name="${filterName}"]`;
  const existing = sidebar.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const finish = (el) => {
      clearTimeout(timeout);
      observer.disconnect();
      resolve(el ?? null);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    const observer = new MutationObserver(() => {
      const el = sidebar.querySelector(selector);
      if (el) finish(el);
    });
    observer.observe(sidebar, { childList: true, subtree: true });
  });
}

/** Resolves once `[data-application-part="filters"]` inside `sidebar` is a different element than `staleElement`, or after a short timeout. */
function waitForFiltersPartReplacement(sidebar, staleElement) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    };
    const timeout = setTimeout(finish, 600);
    const observer = new MutationObserver(() => {
      if (sidebar.querySelector('[data-application-part="filters"]') !== staleElement) finish();
    });
    observer.observe(sidebar, { childList: true });
  });
}

/**
 * Collapses the sidebar's filter panel down to Search + Price (moved into one row
 * together) plus a single "Filters" toggle covering everything else (Attunement,
 * Weapon Mastery, Rarity, Properties, Source, ...) - the default panel (search on its
 * own row, then every filter group stacked below, several of them already
 * collapsed-but-still-taking-a-header's-worth-of-space) reads as cluttered for what's
 * usually just "type a name and go."
 *
 * Unlike collapseFiltersByDefault's plain clicks, a one-time DOM move here doesn't
 * hold on its own - dnd5e re-renders `[data-application-part=
 * "filters"]` fresh at least once after the browser's first paint (its own locked-
 * type-filter initialization triggers it), which silently undoes a physical move of
 * the price filter out of that container and replaces the container itself, wiping
 * the "more filters" class along with it - the search part doesn't get this same
 * treatment and stays put once moved. A MutationObserver on the sidebar re-applies
 * the filters-side move (guarded by a `dccArranged` marker so an already-processed
 * filters element is never touched twice) every time that part gets replaced,
 * instead of a single fire-and-hope pass.
 * @param {HTMLElement} browserElement
 */
function arrangeEmbeddedBrowserFilters(browserElement) {
  const sidebar = browserElement.querySelector(".sidebar");
  if (!sidebar) return;

  let searchRow = sidebar.querySelector(".dnd-cc-browser-search-row");
  if (!searchRow) {
    const searchPart = sidebar.querySelector('[data-application-part="search"]');
    if (!searchPart) return;
    searchRow = document.createElement("div");
    searchRow.className = "dnd-cc-browser-search-row";
    searchPart.replaceWith(searchRow);
    searchRow.append(searchPart);
  }

  const applyFilters = () => {
    const filtersPart = sidebar.querySelector('[data-application-part="filters"]');
    if (!filtersPart || filtersPart.dataset.dccArranged) return;
    filtersPart.dataset.dccArranged = "true";

    // dnd5e replaces the whole `filters` part with a fresh element at least once after
    // the browser's first paint (its own locked-type-filter init), so this can run more
    // than once - each pass's own price filter must replace whatever an earlier pass
    // already moved into searchRow, not pile up alongside it - without
    // this cleanup, several re-renders leave several duplicate price-range rows stacked
    // in the search row.
    searchRow.querySelectorAll('.filter[data-filter-id="price"]').forEach((el) => el.remove());
    const priceFilter = filtersPart.querySelector('.filter[data-filter-id="price"]');
    if (priceFilter) searchRow.append(priceFilter);

    if (!filtersPart.children.length) {
      filtersPart.remove();
      return;
    }

    let toggle = searchRow.querySelector(":scope > .dnd-cc-browser-filters-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "dnd-cc-browser-filters-toggle";
      toggle.innerHTML = '<i class="fa-solid fa-sliders"></i> ' + game.i18n.localize("DND-CC.Equipment.MoreFilters");
      // Looks up the filters part fresh on every click rather than closing over the
      // element resolved here - a later re-render swaps in a new filtersPart
      // element (see above) without this toggle being recreated, so a closed-over
      // reference would silently keep toggling a detached, no-longer-visible one.
      toggle.addEventListener("click", () => sidebar.querySelector('[data-application-part="filters"]')?.classList.toggle("is-open"));
      searchRow.append(toggle);
    }

    filtersPart.classList.add("dnd-cc-browser-more-filters");
  };

  applyFilters();
  new MutationObserver(applyFilters).observe(sidebar, { childList: true });
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
 * Every real player choice on `item` that's still unanswered - dnd5e's own
 * AdvancementManager deliberately never disables "Next"/"Complete" for an
 * unanswered Trait/ItemChoice/AbilityScoreImprovement/Subclass pick (e.g. a Fighter's
 * Fighting Style, a Dragonborn's damage resistance, a class's Skill Proficiencies, a
 * level-3 subclass pick), so an item can land on the actor with a genuine choice
 * silently left empty. "The item exists" is therefore not the same as "everything
 * about it is actually chosen" - this reads the real per-advancement `value` dnd5e
 * itself tracks, the same data its own reversal logic (itemsAtRiskFromLevelDecrease,
 * above) already reads, rather than re-deriving anything.
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

    // A class can carry two versions of the same grant - one restricted to when it's
    // the actor's original class, one to when it isn't (e.g. Bard's real 2024 data:
    // 3 skills + 3 tools as an original class, only 1 skill + 1 tool as a multiclass
    // pick, matching the real multiclassing proficiency table) - dnd5e's own
    // AdvancementManager already filters its step list by this exact getter
    // (`AdvancementManager.flowsForLevel`), so a "secondary" grant on an original-class
    // item (or vice versa) never gets a step to answer in the first place. Skipping it
    // here too, instead of just here-locally reading `configuration.choices`, is what
    // stops a genuinely inapplicable grant from being reported as a missed choice -
    // an original-class Bard's own "secondary" 1-skill/
    // 1-tool grants never appear as steps during a normal add, yet still carry an empty
    // `value` forever since nothing ever resolves them.
    if (!advancement.appliesToClass) continue;

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

      // `value.added` shows up two different shapes in the wild depending on whether
      // the advancement can apply at more than one level: a flat {itemId: uuid} map
      // when there's only ever one choice tier (e.g. a Fighting Style), or a
      // level-keyed {level: {itemId: uuid}} map when it repeats (e.g. Metamagic).
      // Counting values that are themselves objects as nested
      // per-level entries, and anything else as one flat entry, covers both without
      // needing to know in advance which shape a given advancement uses.
      let added = 0;
      for (const entry of entryValues(advancement.value?.added)) {
        added += entry && typeof entry === "object" ? countEntries(entry) : 1;
      }
      if (added < required) titles.push(advancement.title);
    }

    if (advancement.type === "AbilityScoreImprovement") {
      // A real completed choice is either `value.assignments` (points actually spent
      // on abilities) or `value.feat` ("choose a feat instead," the real 2024 option at
      // some levels), per dnd5e's own AbilityScoreImprovement#
      // apply(). An untouched advancement still carries `value: {type: "asi"}` (dnd5e
      // sets `type` eagerly, before any real choice is made), which has one real key
      // and would satisfy a naive `countEntries(value) === 0` check even though
      // nothing was actually chosen and the actor's ability scores are unchanged.
      // `countEntries` isn't reused here since both real shapes are plain objects the
      // count would treat as "non-empty" the moment they exist at all.
      const hasAssignments = advancement.value?.assignments && Object.keys(advancement.value.assignments).length > 0;
      const hasFeat = advancement.value?.feat && Object.keys(advancement.value.feat).length > 0;
      if (!hasAssignments && !hasFeat) titles.push(advancement.title);
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
 * Whether a given wizard step is genuinely complete for an actor - the real check
 * REQUIRED_STEPS gating uses, extracted here (rather than kept as a CharacterCreatorApp
 * method) so it works from anywhere that only has an actor, not a live wizard instance:
 * the GM Progress Dashboard reads this for every player's draft at once, none of which
 * have an open CharacterCreatorApp to call a method on.
 * @param {Actor} actor
 * @param {string} stepId
 * @returns {boolean}
 */
export function isStepComplete(actor, stepId) {
  if (stepId === "class") {
    const classItems = actor.items.filter((item) => item.type === "class");
    if (!classItems.length) return false;
    return classItems.every((item) => !hasUnresolvedAdvancement(item, item.system.levels));
  }
  if (stepId === "species") {
    const item = actor.items.find((item) => item.type === "race");
    return !!item && !hasUnresolvedAdvancement(item);
  }
  if (stepId === "background") {
    const item = actor.items.find((item) => item.type === "background");
    return !!item && !hasUnresolvedAdvancement(item);
  }
  if (stepId === "abilities") return new CharacterDraft(actor).isAbilityAssignmentComplete;
  if (stepId === "feats") {
    const featItems = actor.items.filter((item) => item.system.type?.value === "feat");
    return featItems.every((item) => !hasUnresolvedAdvancement(item));
  }
  return true;
}

/**
 * How many entries a dnd5e-tracked "chosen"/"added" collection actually holds -
 * these show up as a real `Set` for some Trait configurations (e.g. a
 * Weapon Mastery pick), a plain object for others, and occasionally a `Map`. A naive
 * `.length` check silently reads `undefined` (=> treated as empty) on anything but a
 * real array, which misreports a genuinely-completed choice (a real Set
 * with entries) as unresolved. Handles all three shapes so the count is right
 * regardless of which one a given advancement happens to use.
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
 * A short, plain-text preview of what a class (and its subclass, if any) grants at
 * `targetLevel` - shown on the Class step's "Level Up" card before the player commits,
 * so raising a level isn't a blind action. Built from the exact same generic
 * `advancement.levels`/`advancement.title` data dnd5e itself already tracks on every
 * Advancement type (the base `Advancement#levels` getter, confirmed by reading dnd5e's
 * own source: `[this.level]` for a single-level type, every level 1-20 for HitPoints,
 * whatever multi-level set an ItemChoice like Metamagic actually configures) rather
 * than guessing per-type what
 * "gains a level" even means. Reuses the same `[classItem, classItem.subclass]` source
 * pair itemsAtRiskFromLevelDecrease already uses, for the same multiclass-subclass
 * reason documented there.
 * @param {Item} classItem
 * @param {number} targetLevel
 * @returns {string[]} plain-text advancement titles that apply at targetLevel, deduped
 */
export function previewClassLevelGains(classItem, targetLevel) {
  const sources = [classItem, classItem.subclass].filter(Boolean);
  const titles = [];
  for (const source of sources) {
    for (const advancement of Object.values(source.advancement.byId)) {
      if (!advancement.levels.includes(targetLevel)) continue;
      if (!titles.includes(advancement.title)) titles.push(advancement.title);
    }
  }
  return titles;
}

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
  patchEmbeddedAdvancementFlows();
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = AdvancementManager.forLevelChange(actor, classItemId, levelDelta, container ? EMBEDDED_WINDOW_OPTIONS : {});
  return runAdvancementManager(manager, container);
}
