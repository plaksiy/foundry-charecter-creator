import { CharacterCreatorApp } from "./apps/character-creator-app.mjs";
import { CompendiumSourcesConfig } from "./apps/compendium-sources-config.mjs";
import { HouseRulesConfig } from "./apps/house-rules-config.mjs";
import { GmProgressDashboard } from "./apps/gm-progress-dashboard.mjs";
import { StepOrderConfig } from "./apps/step-order-config.mjs";
import { CharacterDraft, getNonGmOwners } from "./models/character-draft.mjs";
import { isSelfLevelUpAllowed } from "./services/house-rules.mjs";
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
//
// Registered on the native sheet's own render hook *and* both of Tidy 5e Sheets' own
// class-specific render hooks (`Tidy5eCharacterSheet`, the legacy skin, and
// `Tidy5eCharacterSheetQuadrone`, its current one) - Tidy5e's own header uses the exact
// same `.header-control`/`[data-action="close"]` convention as the native sheet (both
// ultimately extend ApplicationV2's own header), so one shared handler covers all three
// without needing sheet-specific styling or markup.
function addLevelUpHeaderButton(app) {
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
}
Hooks.on("renderCharacterActorSheet", addLevelUpHeaderButton);
Hooks.on("renderTidy5eCharacterSheet", addLevelUpHeaderButton);
Hooks.on("renderTidy5eCharacterSheetQuadrone", addLevelUpHeaderButton);

// XP-threshold level-up notification: whenever a finished character's XP changes and
// crosses into "enough to level up," whisper both the GM and the character's own player
// an actionable chat card - being informed doesn't grant any new power, only the button
// itself does (see renderChatMessageHTML below, which disables it for a non-GM viewer
// unless the `allowSelfLevelUp` house rule allows self-service). `xp.max` is dnd5e's own
// real derived "XP needed for the *next* level" (Actor5e#prepareDerivedData:
// `xp.max = getLevelExp(currentLevel)`), so eligibility is a plain `value >= max` read
// off the actor's own already-computed data - no separate threshold table of our own needed.
// `game.user.isActiveGM` (not a plain isGM check) ensures exactly one connected client
// fires this, even if more than one GM happens to be online - `updateActor` fires on every
// client, and a plain isGM guard would send one duplicate chat card per online GM.
Hooks.on("updateActor", async (actor, changes) => {
  if (!game.user.isActiveGM) return;
  if (actor.type !== "character" || CharacterDraft.isDraft(actor)) return;
  if (!foundry.utils.hasProperty(changes, "system.details.xp.value")) return;
  if (game.settings.get("dnd5e", "levelingMode") === "noxp") return;

  const xp = actor.system.details.xp;
  if (!xp || xp.max === Infinity || xp.value < xp.max) return;

  // Notify once per threshold, not once per unrelated actor update after that - re-fires
  // naturally once the GM actually levels the character (xp.max moves to the next
  // threshold, which no longer matches the stored flag).
  if (actor.getFlag(MODULE_ID, "xpNotifiedThreshold") === xp.max) return;
  await actor.setFlag(MODULE_ID, "xpNotifiedThreshold", xp.max);

  const whisperIds = new Set(ChatMessage.getWhisperRecipients("GM").map((u) => u.id));
  for (const owner of getNonGmOwners(actor)) whisperIds.add(owner.id);

  await ChatMessage.create({
    whisper: Array.from(whisperIds),
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="dnd-cc-review-chat-card">
        <p>${game.i18n.format("DND-CC.LevelUp.XpReadyMessage", { name: actor.name, value: xp.value, max: xp.max })}</p>
        <button type="button" data-action="dnd-cc-open-levelup" data-actor-id="${actor.id}">
          <i class="fa-solid fa-angles-up"></i> ${game.i18n.localize("DND-CC.LevelUp.OpenButton")}
        </button>
      </div>
    `
  });
});

// GM co-review gate (see `requireGmReview` setting): a player's "Build Character" whispers
// the GM this chat card instead of finalizing directly when the setting is on. Only wired
// for GM users - a non-GM who happens to see their own whisper (Foundry always shows a
// message to its own author) gets an inert, visibly disabled button instead of a live one,
// so a player can never self-approve their own submission.
Hooks.on("renderChatMessageHTML", (_message, html) => {
  const root = html instanceof HTMLElement ? html : html[0];

  const approveButton = root.querySelector('[data-action="dnd-cc-approve-review"]');
  if (approveButton) {
    if (!game.user.isGM) {
      approveButton.disabled = true;
    } else {
      approveButton.addEventListener("click", async () => {
        const actor = game.actors.get(approveButton.dataset.actorId);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.Review.ApproveActorMissing"));
          return;
        }

        approveButton.disabled = true;
        await new CharacterDraft(actor).finalize();
        ui.actors.render();
        approveButton.innerHTML = `<i class="fa-solid fa-check-double"></i> ${game.i18n.localize("DND-CC.Review.ApprovedLabel")}`;
        ui.notifications.info(game.i18n.format("DND-CC.Review.FinalizeSuccess", { name: actor.name }));
        actor.sheet.render(true);
      });
    }
  }

  // XP-ready level-up card - now always whispered to both the GM and the character's own
  // player (see the updateActor hook above), but the button itself only opens the wizard
  // for the GM, or for the owning player when the `allowSelfLevelUp` house rule allows
  // self-service - otherwise it's an inert, visibly disabled button, same pattern as the
  // GM co-review approval button above, so the player is informed without being able to
  // act on it themselves unless the table's rules actually allow that.
  const levelUpButton = root.querySelector('[data-action="dnd-cc-open-levelup"]');
  if (levelUpButton) {
    if (!game.user.isGM && !isSelfLevelUpAllowed()) {
      levelUpButton.disabled = true;
    } else {
      levelUpButton.addEventListener("click", () => {
        const actor = game.actors.get(levelUpButton.dataset.actorId);
        if (!actor) {
          ui.notifications.warn(game.i18n.localize("DND-CC.Review.ApproveActorMissing"));
          return;
        }
        new CharacterCreatorApp({ actor }).render(true);
      });
    }
  }
});

globalThis.dndCharacterCreator = { CharacterCreatorApp, MODULE_ID };
