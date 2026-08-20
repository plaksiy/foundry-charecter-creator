import { MODULE_ID } from "../constants.mjs";
import { PACK_CATEGORIES, RULESET_TAG_CHOICES, listConfigurablePacks } from "../services/compendium-sources.mjs";

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

    // `index` is a stable position in the flat list, carried through into each grouped
    // section below and used for the form field names ("packs.{index}.id" etc.) instead
    // of Handlebars' own `@index` - that resets to 0 within each group's own {{#each}},
    // which would collide two different packs onto the same "packs.0.*" field names the
    // moment there's more than one category.
    const packs = listConfigurablePacks().map((pack, index) => ({
      ...pack,
      index,
      rulesetOptions: RULESET_TAG_CHOICES.map((value) => ({
        value,
        label: rulesetLabels[value],
        selected: value === pack.ruleset
      }))
    }));

    // Grouped Core Rules / Expanded Rules / Homebrew / Legacy sections instead of one
    // flat table, in that fixed display order regardless of how many packs land in
    // each - an empty category is simply omitted rather than shown as an empty section.
    const categoryGroups = PACK_CATEGORIES.map((category) => ({
      category,
      label: game.i18n.localize(`DND-CC.CompendiumSources.Category.${category}`),
      packs: packs.filter((pack) => pack.category === category)
    })).filter((group) => group.packs.length);

    return { packs, categoryGroups };
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
