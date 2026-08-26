import { MAX_CLASS_LEVEL, MODULE_ID } from "../constants.mjs";
import { CharacterDraft, getNonGmOwners } from "../models/character-draft.mjs";
import { isStepComplete } from "../models/choice-queue.mjs";
import { CharacterCreatorApp, REQUIRED_STEPS, STEP_DEFINITIONS } from "./character-creator-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-facing screen listing every player's in-progress draft at a glance: which step
 * they're on and which required steps are still incomplete, so a GM running session
 * zero can see who's stuck without having to ask or peek over a shoulder. Reuses
 * isStepComplete/STEP_DEFINITIONS/REQUIRED_STEPS directly from the wizard itself rather
 * than re-deriving completeness rules here - this screen only ever reads actor data
 * that a real, currently-open CharacterCreatorApp would compute the exact same way.
 *
 * "Open" on a row reopens the wizard pointed at that specific draft (the same
 * options.actor mechanism Level Up uses), so a GM can actually help resolve whatever a
 * player is stuck on rather than just observing - character-creator-app.mjs's
 * constructor tells this case apart from a real Level Up via CharacterDraft.isDraft,
 * and skips the ability/ruleset bootstrap that only makes sense for a finished
 * character (see _resolveDraft).
 */
/** @returns {string} the real, non-GM owner's name, or a localized "Unowned" fallback. */
function ownerNameFor(actor) {
  const owner = getNonGmOwners(actor)[0] ?? null;
  return owner ? owner.name : game.i18n.localize("DND-CC.GmProgress.NoOwner");
}

export class GmProgressDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd-cc-gm-progress",
    classes: ["dnd-cc", "dnd-cc-gm-progress"],
    tag: "div",
    window: {
      title: "DND-CC.GmProgress.Title",
      icon: "fa-solid fa-clipboard-list",
      resizable: true
    },
    position: {
      width: 980,
      height: 760
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/gm-progress/shell.hbs`
    }
  };

  /**
   * Live-updating: re-renders itself whenever a player's draft (or a finished PC) actor
   * changes, instead of requiring the GM to click Refresh - a GM watching this while
   * several players build characters at once wants the rows to move on their own.
   * Debounced (a single advancement step can fire several rapid actor updates in a row,
   * e.g. a Trait/ItemGrant cascade) and scoped to `type === "character"` so an unrelated
   * NPC/vehicle update elsewhere in the world doesn't trigger a redraw.
   * Registered in `_onFirstRender` (once per open dashboard, not per render) and torn
   * down in `_onClose` so a closed-and-reopened dashboard never accumulates duplicate
   * listeners across its own lifetime.
   */
  #hookIds = [];

  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    const scheduleRender = foundry.utils.debounce(() => this.render(), 200);
    const onActorChange = (actor) => {
      if (actor.type === "character") scheduleRender();
    };
    this.#hookIds = [
      ["updateActor", Hooks.on("updateActor", onActorChange)],
      ["createActor", Hooks.on("createActor", onActorChange)],
      ["deleteActor", Hooks.on("deleteActor", onActorChange)]
    ];
  }

  _onClose(options) {
    super._onClose?.(options);
    for (const [hook, id] of this.#hookIds) Hooks.off(hook, id);
    this.#hookIds = [];
  }

  async _prepareContext(_options) {
    const drafts = game.actors.filter((actor) => CharacterDraft.isDraft(actor));

    const rows = drafts.map((actor) => {
      // Prefer a real, non-GM owner - a draft can end up with the GM also holding
      // explicit OWNER-level access (e.g. this dashboard's own "Open" action doesn't
      // grant that, but nothing stops a GM from adding themselves via the actor's own
      // permissions sheet), and attributing it to "Gamemaster" in that case would be
      // actively misleading on a screen whose whole point is "who does this belong to."
      const ownerName = ownerNameFor(actor);

      const draft = new CharacterDraft(actor);
      const currentStepDef = STEP_DEFINITIONS.find((step) => step.id === draft.currentStepId) ?? STEP_DEFINITIONS[0];
      const missingLabels = REQUIRED_STEPS.filter((id) => !isStepComplete(actor, id)).map((id) =>
        game.i18n.localize(STEP_DEFINITIONS.find((step) => step.id === id).label)
      );

      return {
        id: actor.id,
        name: actor.name,
        ownerName,
        currentStepLabel: game.i18n.localize(currentStepDef.label),
        missingLabels,
        missingText: missingLabels.join(", "),
        ready: missingLabels.length === 0,
        // A player can't delete their own draft (Foundry reserves Actor deletion for
        // GMs regardless of ownership - see CharacterDraft#discard's own note), so
        // "Start Over" for a non-GM just abandons it instead. Abandoned drafts still
        // show up here (a GM should be able to see and clean up what players left
        // behind) with their own status instead of a fake "current step."
        abandoned: draft.abandoned
      };
    });

    rows.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));

    const levelingMode = game.settings.get("dnd5e", "levelingMode");
    const tracksXp = levelingMode !== "noxp";

    const finished = game.actors.filter((actor) => actor.type === "character" && !CharacterDraft.isDraft(actor));
    const finishedRows = finished.map((actor) => {
      const classItems = actor.items.filter((item) => item.type === "class");
      const totalLevel = classItems.reduce((sum, item) => sum + item.system.levels, 0);
      const classLevel = classItems.length
        ? classItems.map((item) => `${item.name} ${item.system.levels}`).join(" / ")
        : "-";
      const species = actor.items.find((item) => item.type === "race")?.name ?? "-";
      const background = actor.items.find((item) => item.type === "background")?.name ?? "-";
      const hp = actor.system.attributes?.hp;
      const xp = actor.system.details?.xp;
      // xp.max is dnd5e's own real derived "XP needed for the *next* level"
      // (Actor5e#prepareDerivedData: `xp.max = getLevelExp(currentLevel)`) - no separate
      // threshold lookup of our own needed. Infinity at the world's max level, so a
      // plain >= comparison naturally never reports "ready" there.
      const xpReady = tracksXp && xp && xp.max !== Infinity && xp.value >= xp.max;

      return {
        id: actor.id,
        name: actor.name,
        ownerName: ownerNameFor(actor),
        classLevel,
        species,
        background,
        hpText: hp ? `${hp.value} / ${hp.max}` : "-",
        tracksXp,
        xpText: xp ? `${xp.value} / ${xp.max === Infinity ? "-" : xp.max}` : "-",
        xpReady,
        // The quick level control below (see shell.hbs / _onRender's own
        // [data-level-adjust] handler) always opens a fresh Level Up session with the
        // change already queued rather than mutating the actor here directly - applying
        // a level change needs the real embedded Advancement flow rendered somewhere
        // (HP roll, ASI, subclass pick, ...), which this table row has nowhere to show.
        totalLevel,
        levelPercent: Math.round((totalLevel / MAX_CLASS_LEVEL) * 100),
        canLevelDown: classItems.length > 0 && totalLevel > 1,
        canLevelUp: classItems.length > 0 && totalLevel < MAX_CLASS_LEVEL
      };
    });
    finishedRows.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));

    return { rows, hasRows: rows.length > 0, finishedRows, hasFinishedRows: finishedRows.length > 0, tracksXp };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    root.querySelector("[data-refresh]")?.addEventListener("click", () => this.render());

    // Level Up reuses the exact same open call as a draft's "Open" - CharacterCreatorApp
    // itself already tells the two cases apart (CharacterDraft.isDraft(actor)) and opens
    // in Level Up mode automatically for a real, finished character.
    root.querySelectorAll("[data-open-draft], [data-levelup-actor]").forEach((el) => {
      el.addEventListener("click", () => {
        const actor = game.actors.get(el.dataset.openDraft ?? el.dataset.levelupActor);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.GmProgress.ActorMissing"));
          this.render();
          return;
        }
        new CharacterCreatorApp({ actor }).render(true);
      });
    });

    // Quick level control (the finished-characters table's own progress bar + +/- + "add
    // N" controls) - opens a fresh Level Up session with the requested delta already
    // queued (see CharacterCreatorApp's pendingLevelDelta option/_applyPendingLevelDelta),
    // rather than mutating the actor from here directly, so the GM lands in whatever real
    // embedded Advancement flow that change triggers instead of it happening silently.
    root.querySelectorAll("[data-level-adjust]").forEach((el) => {
      el.addEventListener("click", () => {
        const actor = game.actors.get(el.dataset.levelAdjust);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.GmProgress.ActorMissing"));
          this.render();
          return;
        }
        new CharacterCreatorApp({ actor, pendingLevelDelta: Number(el.dataset.delta) }).render(true);
      });
    });

    root.querySelectorAll("[data-level-add-apply]").forEach((el) => {
      el.addEventListener("click", () => {
        const actorId = el.dataset.levelAddApply;
        const input = root.querySelector(`[data-level-add-input="${actorId}"]`);
        const amount = Number(input?.value);
        if (!Number.isInteger(amount) || amount < 1) return;

        const actor = game.actors.get(actorId);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.GmProgress.ActorMissing"));
          this.render();
          return;
        }
        new CharacterCreatorApp({ actor, pendingLevelDelta: amount }).render(true);
      });
    });

    root.querySelectorAll("[data-delete-draft]").forEach((el) => {
      el.addEventListener("click", async () => {
        const actor = game.actors.get(el.dataset.deleteDraft);
        if (!actor) {
          this.render();
          return;
        }
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: game.i18n.localize("DND-CC.GmProgress.DeleteTitle") },
          content: `<p>${game.i18n.format("DND-CC.GmProgress.DeleteConfirm", { name: actor.name })}</p>`
        });
        if (!confirmed) return;
        await actor.delete();
        this.render();
      });
    });
  }
}
