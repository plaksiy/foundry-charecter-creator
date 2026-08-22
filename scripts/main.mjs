import { CharacterCreatorApp } from "./apps/character-creator-app.mjs";
import { CompendiumSourcesConfig } from "./apps/compendium-sources-config.mjs";
import { HouseRulesConfig } from "./apps/house-rules-config.mjs";
import { GmProgressDashboard } from "./apps/gm-progress-dashboard.mjs";
import { StepOrderConfig } from "./apps/step-order-config.mjs";
import { CharacterDraft } from "./models/character-draft.mjs";
import { MODULE_ID } from "./constants.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing module`);

  game.settings.register(MODULE_ID, "defaultRuleset", {
    name: "DND-CC.Settings.DefaultRuleset.Name",
    hint: "DND-CC.Settings.DefaultRuleset.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "2014": "DND-CC.Ruleset.2014",
      "2024": "DND-CC.Ruleset.2024",
      "both": "DND-CC.Ruleset.Both"
    },
    default: "2024"
  });

  game.settings.register(MODULE_ID, "compendiumSources", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Per-user narrowing on top of the GM's world-scoped allowlist above - managed live
  // from inside the wizard (see _showSourceFilter in character-creator-app.mjs), not a
  // config:true settings-menu entry, since it's a live per-step filter, not a one-time
  // world configuration choice.
  game.settings.register(MODULE_ID, "playerSourceFilter", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Accessibility controls, managed live from the wizard's own header (see
  // _prepareAccessibilityContext/the data-font-scale and data-toggle-imagery handlers in
  // character-creator-app.mjs), not config:true settings-menu entries - both are viewing
  // preferences a player adjusts in the moment, not a one-time world/client configuration
  // choice buried in a settings screen they'd have to know to go find.
  game.settings.register(MODULE_ID, "fontScale", {
    scope: "client",
    config: false,
    type: String,
    default: "1"
  });

  game.settings.register(MODULE_ID, "reduceImagery", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.registerMenu(MODULE_ID, "compendiumSourcesMenu", {
    name: "DND-CC.CompendiumSources.MenuName",
    label: "DND-CC.CompendiumSources.MenuLabel",
    hint: "DND-CC.CompendiumSources.MenuHint",
    icon: "fa-solid fa-book-atlas",
    type: CompendiumSourcesConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, "requireGmReview", {
    name: "DND-CC.Settings.RequireGmReview.Name",
    hint: "DND-CC.Settings.RequireGmReview.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "houseRules", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "houseRulesMenu", {
    name: "DND-CC.HouseRules.MenuName",
    label: "DND-CC.HouseRules.MenuLabel",
    hint: "DND-CC.HouseRules.MenuHint",
    icon: "fa-solid fa-gavel",
    type: HouseRulesConfig,
    restricted: true
  });

  // One shared order for every player and the GM alike - a per-table preference, not a
  // per-player one, so it's world-scoped like compendiumSources/houseRules above.
  game.settings.register(MODULE_ID, "stepOrder", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, "stepOrderMenu", {
    name: "DND-CC.StepOrder.MenuName",
    label: "DND-CC.StepOrder.MenuLabel",
    hint: "DND-CC.StepOrder.MenuHint",
    icon: "fa-solid fa-arrow-down-up-across-line",
    type: StepOrderConfig,
    restricted: true
  });

  // Personal viewing preference, same client-scoped/config:false pattern as
  // fontScale/reduceImagery above - adjusted live from the wizard's own toolbar, not a
  // settings-menu entry.
  game.settings.register(MODULE_ID, "accentColor", {
    scope: "client",
    config: false,
    type: String,
    default: "neutral"
  });

  const loadTemplates = foundry.applications.handlebars.loadTemplates;
  loadTemplates([
    `modules/${MODULE_ID}/templates/character-creator/step-ruleset.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-identity.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-class.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-species.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-background.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-abilities.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-feats.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-skills.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-spells.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-equipment.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-about.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-review.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/pdf-export.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/journal-export.hbs`,
    `modules/${MODULE_ID}/templates/character-creator/step-placeholder.hbs`,
    `modules/${MODULE_ID}/templates/compendium-sources/shell.hbs`,
    `modules/${MODULE_ID}/templates/house-rules/shell.hbs`,
    `modules/${MODULE_ID}/templates/gm-progress/shell.hbs`,
    `modules/${MODULE_ID}/templates/step-order/shell.hbs`
  ]);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});

Hooks.on("renderActorDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  const header = root.querySelector(".directory-header .action-buttons") ?? root.querySelector(".directory-header");
  if (!header || header.querySelector(".dnd-cc-open-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("dnd-cc-open-button");
  button.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> ${game.i18n.localize("DND-CC.OpenButton")}`;
  button.addEventListener("click", () => new CharacterCreatorApp().render(true));

  header.appendChild(button);
});

// GM Progress Dashboard entry point - a GM-only button next to "Create Character" so
// it's discoverable at the exact moment it's useful (session zero, watching the
// Actor Directory fill up with drafts) rather than buried in Module Settings.
Hooks.on("renderActorDirectory", (_app, html) => {
  if (!game.user.isGM) return;

  const root = html instanceof HTMLElement ? html : html[0];
  const header = root.querySelector(".directory-header .action-buttons") ?? root.querySelector(".directory-header");
  if (!header || header.querySelector(".dnd-cc-progress-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("dnd-cc-open-button", "dnd-cc-progress-button");
  button.innerHTML = `<i class="fa-solid fa-clipboard-list"></i> ${game.i18n.localize("DND-CC.GmProgress.ButtonLabel")}`;
  button.addEventListener("click", () => new GmProgressDashboard().render(true));

  header.appendChild(button);
});

Hooks.on("renderActorDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  for (const actor of game.actors) {
    if (!CharacterDraft.isDraft(actor)) continue;
    root.querySelector(`.directory-item[data-entry-id="${actor.id}"]`)?.classList.add("dnd-cc-draft-hidden");
  }
});

// "Level Up" - reopens the wizard on an already-finished character instead of a fresh
// draft (see the `levelUp`/`_levelUpActor` handling in character-creator-app.mjs), so a
// player can add class levels (and resolve whatever that unlocks - ASI, subclass, new
// spells) through the same embedded-Advancement UI used at creation, instead of dnd5e's
// native popups. Only offered on a real PC's own sheet (never a draft mid-creation - that
// already has its own wizard open) and only to whoever actually owns the actor. Injected
// as a plain button styled like a native header-control (matching the existing
// copyUuid/toggleControls buttons already in this header) rather than going through
// ApplicationV2's own header-controls option, since that's a static per-class option list
// on dnd5e's own sheet class, not something a hook can append to.
Hooks.on("renderCharacterActorSheet", (app, _html) => {
  const actor = app.actor;
  if (!actor?.isOwner || CharacterDraft.isDraft(actor)) return;

  const header = app.element.querySelector(".window-header");
  if (!header || header.querySelector(".dnd-cc-levelup-header-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("header-control", "icon", "fa-solid", "fa-angles-up", "dnd-cc-levelup-header-button");
  button.dataset.tooltip = game.i18n.localize("DND-CC.LevelUp.SheetButtonTitle");
  button.setAttribute("aria-label", game.i18n.localize("DND-CC.LevelUp.SheetButtonLabel"));
  button.addEventListener("click", () => new CharacterCreatorApp({ actor }).render(true));

  header.insertBefore(button, header.querySelector('[data-action="close"]'));
});

// GM co-review gate (see `requireGmReview` setting): a player's "Build Character" whispers
// the GM this chat card instead of finalizing directly when the setting is on. Only wired
// for GM users - a non-GM who happens to see their own whisper (Foundry always shows a
// message to its own author) gets an inert, visibly disabled button instead of a live one,
// so a player can never self-approve their own submission.
Hooks.on("renderChatMessageHTML", (_message, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  const button = root.querySelector('[data-action="dnd-cc-approve-review"]');
  if (!button) return;

  if (!game.user.isGM) {
    button.disabled = true;
    return;
  }

  button.addEventListener("click", async () => {
    const actor = game.actors.get(button.dataset.actorId);
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("DND-CC.Review.ApproveActorMissing"));
      return;
    }

    button.disabled = true;
    await new CharacterDraft(actor).finalize();
    ui.actors.render();
    button.innerHTML = `<i class="fa-solid fa-check-double"></i> ${game.i18n.localize("DND-CC.Review.ApprovedLabel")}`;
    ui.notifications.info(game.i18n.format("DND-CC.Review.FinalizeSuccess", { name: actor.name }));
    actor.sheet.render(true);
  });
});

globalThis.dndCharacterCreator = { CharacterCreatorApp, MODULE_ID };
