import { ABILITY_METHODS, MODULE_ID } from "../constants.mjs";
import { getHouseRules } from "../services/house-rules.mjs";
import { getStepItems } from "../services/compendium-sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HouseRulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dnd-cc-house-rules",
    classes: ["dnd-cc", "dnd-cc-house-rules"],
    tag: "form",
    window: {
      title: "DND-CC.HouseRules.Title",
      icon: "fa-solid fa-gavel",
      resizable: true
    },
    position: {
      width: 640,
      height: 680
    },
    form: {
      handler: HouseRulesConfig.onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/house-rules/shell.hbs`
    }
  };

  async _prepareContext(_options) {
    const rules = getHouseRules();

    const abilityMethodOptions = ABILITY_METHODS.map((key) => ({
      key,
      label: game.i18n.localize(`DND-CC.Abilities.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
      allowed: rules.abilityMethods[key] !== false
    }));

    const alignmentOptions = Object.entries(CONFIG.DND5E.alignments).map(([key, label]) => ({
      key,
      label,
      disallowed: rules.disallowedAlignments.includes(key)
    }));

    // Both rulesets, regardless of the world's default - a ban should hold no matter
    // which ruleset a given character later picks.
    const speciesItems = await getStepItems("race", ["2014", "2024"]);
    const speciesOptions = speciesItems
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        uuid: item.uuid,
        name: item.name,
        banned: rules.bannedSpecies.includes(item.uuid)
      }));

    return {
      abilityMethodOptions,
      alignmentOptions,
      minFeatLevel: rules.minFeatLevel,
      speciesOptions
    };
  }

  static async onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    const abilityMethods = {};
    for (const key of ABILITY_METHODS) abilityMethods[key] = data.abilityMethods?.[key] === true;

    const disallowedAlignments = Object.entries(data.alignments ?? {})
      .filter(([, disallowed]) => disallowed === true)
      .map(([key]) => key);

    // Indexed rather than keyed by uuid - a raw compendium uuid contains dots
    // ("Compendium.dnd5e.origins24.Item...."), which expandObject would otherwise split
    // into nested objects instead of treating as one key, same reason compendium-sources-
    // config.mjs indexes its own pack rows instead of keying by pack collection id.
    const bannedSpecies = Object.values(data.species ?? {})
      .filter((entry) => entry.banned === true)
      .map((entry) => entry.uuid);

    await game.settings.set(MODULE_ID, "houseRules", {
      abilityMethods,
      disallowedAlignments,
      minFeatLevel: Number(data.minFeatLevel) || 0,
      bannedSpecies
    });
  }
}
