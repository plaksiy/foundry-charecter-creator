import { MODULE_ID } from "../constants.mjs";
import { STEP_DEFINITIONS } from "./character-creator-app.mjs";
import { getOrderedStepDefinitions } from "../services/step-order.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-facing step-reorder screen. Not a standard declarative form submission like
 * HouseRulesConfig/CompendiumSourcesConfig - drag-and-drop reorder state lives in the
 * DOM's own element order, not in individual form field values, so Save reads the
 * current `<li>` order directly instead of going through FormData/expandObject.
 */
export class StepOrderConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd-cc-step-order",
    classes: ["dnd-cc", "dnd-cc-step-order"],
    window: {
      title: "DND-CC.StepOrder.Title",
      icon: "fa-solid fa-arrow-down-up-across-line",
      resizable: true
    },
    position: {
      width: 440,
      height: 620
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/step-order/shell.hbs`
    }
  };

  async _prepareContext(_options) {
    return { steps: this._stepRows(getOrderedStepDefinitions(STEP_DEFINITIONS)) };
  }

  _stepRows(definitions) {
    return definitions.map((step) => ({
      id: step.id,
      label: game.i18n.localize(step.label),
      icon: step.icon,
      iconViewBox: step.iconViewBox
    }));
  }

  _rowHTML(step) {
    return `
      <li class="dnd-cc-order-row" draggable="true" data-step-id="${step.id}">
        <i class="fa-solid fa-grip-lines dnd-cc-order-handle" aria-hidden="true"></i>
        <span class="dnd-cc-order-icon" aria-hidden="true"><svg viewBox="${step.iconViewBox}">${step.icon}</svg></span>
        <span class="dnd-cc-order-label">${step.label}</span>
        <span class="dnd-cc-order-buttons">
          <button type="button" data-move="up" aria-label="${game.i18n.localize("DND-CC.StepOrder.MoveUp")}"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" data-move="down" aria-label="${game.i18n.localize("DND-CC.StepOrder.MoveDown")}"><i class="fa-solid fa-chevron-down"></i></button>
        </span>
      </li>`;
  }

  /** Wires drag-and-drop and up/down reordering on whatever rows are currently in the list - re-run after a reset rebuilds the list's innerHTML, since those are fresh elements. */
  _wireRows(list) {
    let dragged = null;
    list.querySelectorAll(".dnd-cc-order-row").forEach((row) => {
      row.addEventListener("dragstart", () => {
        dragged = row;
        row.classList.add("dnd-cc-dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dnd-cc-dragging"));
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (!dragged || dragged === row) return;
        const before = row.compareDocumentPosition(dragged) & Node.DOCUMENT_POSITION_FOLLOWING;
        row.parentElement.insertBefore(dragged, before ? row : row.nextSibling);
      });
      row.querySelector("[data-move='up']")?.addEventListener("click", () => {
        const sibling = row.previousElementSibling;
        if (!sibling) return;
        row.parentElement.insertBefore(row, sibling);
        row.querySelector("[data-move='up']")?.focus();
      });
      row.querySelector("[data-move='down']")?.addEventListener("click", () => {
        const sibling = row.nextElementSibling;
        if (!sibling) return;
        row.parentElement.insertBefore(sibling, row);
        row.querySelector("[data-move='down']")?.focus();
      });
    });
  }

  _onRender(_context, _options) {
    const root = this.element;
    const list = root.querySelector(".dnd-cc-order-list");
    if (!list) return;
    this._wireRows(list);

    root.querySelector("[data-action='reset']")?.addEventListener("click", () => {
      list.innerHTML = this._stepRows(STEP_DEFINITIONS)
        .map((step) => this._rowHTML(step))
        .join("");
      this._wireRows(list);
    });

    root.querySelector(".dnd-cc-save-button")?.addEventListener("click", async () => {
      const order = Array.from(list.querySelectorAll(".dnd-cc-order-row")).map((row) => row.dataset.stepId);
      await game.settings.set(MODULE_ID, "stepOrder", order);
      ui.notifications.info(game.i18n.localize("DND-CC.StepOrder.Saved"));
      this.close();
    });
  }
}
