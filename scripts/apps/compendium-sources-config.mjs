import { MODULE_ID } from "../constants.mjs";
import { RULESET_TAG_CHOICES, listConfigurablePacks } from "../services/compendium-sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CompendiumSourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd-cc-compendium-sources",
    classes: ["dnd-cc", "dnd-cc-compendium-sources"],
    tag: "form",
    window: {
      title: "DND-CC.CompendiumSources.Title",
      icon: "fa-solid fa-book-atlas",
      resizable: true
    },
    position: {
      width: 680,
      height: 640
    },
    form: {
      handler: CompendiumSourcesConfig.onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/compendium-sources/shell.hbs`
    }
  };

  async _prepareContext(_options) {
    const rulesetLabels = Object.fromEntries(
      RULESET_TAG_CHOICES.map((value) => [value, game.i18n.localize(`DND-CC.CompendiumSources.Ruleset.${value}`)])
    );

    const packs = listConfigurablePacks().map((pack) => ({
      ...pack,
      rulesetOptions: RULESET_TAG_CHOICES.map((value) => ({
        value,
        label: rulesetLabels[value],
        selected: value === pack.ruleset
      }))
    }));

    return { packs };
  }

  static async onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const entries = Object.values(data.packs ?? {});

    const config = {};
    for (const entry of entries) {
      if (!entry.id) continue;
      config[entry.id] = {
        enabled: entry.enabled === true,
        ruleset: entry.ruleset ?? "auto"
      };
    }

    await game.settings.set(MODULE_ID, "compendiumSources", config);
  }
}
