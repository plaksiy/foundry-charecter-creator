import { MODULE_ID } from "../constants.mjs";
import { CharacterDraft } from "../models/character-draft.mjs";
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
      width: 760,
      height: 560
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/gm-progress/shell.hbs`
    }
  };

  async _prepareContext(_options) {
    const drafts = game.actors.filter((actor) => CharacterDraft.isDraft(actor));

    const rows = drafts.map((actor) => {
      // Prefer a real, non-GM owner - a draft can end up with the GM also holding
      // explicit OWNER-level access (e.g. this dashboard's own "Open" action doesn't
      // grant that, but nothing stops a GM from adding themselves via the actor's own
      // permissions sheet), and attributing it to "Gamemaster" in that case would be
      // actively misleading on a screen whose whole point is "who does this belong to."
      const ownerUsers = Object.entries(actor.ownership)
        .filter(([, level]) => level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        .map(([userId]) => game.users.get(userId))
        .filter(Boolean);
      const ownerUser = ownerUsers.find((user) => !user.isGM) ?? ownerUsers[0] ?? null;

      const draft = new CharacterDraft(actor);
      const currentStepDef = STEP_DEFINITIONS.find((step) => step.id === draft.currentStepId) ?? STEP_DEFINITIONS[0];
      const missingLabels = REQUIRED_STEPS.filter((id) => !isStepComplete(actor, id)).map((id) =>
        game.i18n.localize(STEP_DEFINITIONS.find((step) => step.id === id).label)
      );

      return {
        id: actor.id,
        name: actor.name,
        ownerName: ownerUser ? ownerUser.name : game.i18n.localize("DND-CC.GmProgress.NoOwner"),
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

    return { rows, hasRows: rows.length > 0 };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    root.querySelector("[data-refresh]")?.addEventListener("click", () => this.render());

    root.querySelectorAll("[data-open-draft]").forEach((el) => {
      el.addEventListener("click", () => {
        const actor = game.actors.get(el.dataset.openDraft);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.GmProgress.ActorMissing"));
          this.render();
          return;
        }
        new CharacterCreatorApp({ actor }).render(true);
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
