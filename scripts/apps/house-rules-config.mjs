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
      height: 760
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

    const classItems = await getStepItems("class", ["2014", "2024"]);
    const classOptions = classItems
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        uuid: item.uuid,
        name: item.name,
        banned: rules.bannedClasses.includes(item.uuid)
      }));

    const featItems = await getStepItems("feat", ["2014", "2024"]);
    const featOptions = featItems
      .filter((item) => item.typeValue === "feat")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        uuid: item.uuid,
        name: item.name,
        banned: rules.bannedFeats.includes(item.uuid)
      }));

    return {
      abilityMethodOptions,
      alignmentOptions,
      minFeatLevel: rules.minFeatLevel,
      speciesOptions,
      classOptions,
      featOptions,
      disableMulticlass: rules.disableMulticlass === true,
      allowSelfLevelUp: rules.allowSelfLevelUp === true,
      pointBuyBudget: rules.pointBuyBudget,
      pointBuyMin: rules.pointBuyMin,
      pointBuyMax: rules.pointBuyMax,
      allowRerolls: rules.allowRerolls !== false,
      bonusStartingGoldGp: rules.bonusStartingGoldGp || 0
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

    const bannedClasses = Object.values(data.classes ?? {})
      .filter((entry) => entry.banned === true)
      .map((entry) => entry.uuid);

    const bannedFeats = Object.values(data.feats ?? {})
      .filter((entry) => entry.banned === true)
      .map((entry) => entry.uuid);

    // A GM could type a min above the max (or vice versa) - swap rather than reject, so
    // Point Buy's own range check (pointBuyMin/pointBuyMax in character-draft.mjs) never
    // ends up with an inverted, permanently-impossible range from a simple typo.
    let pointBuyMin = Number(data.pointBuyMin);
    let pointBuyMax = Number(data.pointBuyMax);
    if (!Number.isFinite(pointBuyMin)) pointBuyMin = 8;
    if (!Number.isFinite(pointBuyMax)) pointBuyMax = 15;
    if (pointBuyMin > pointBuyMax) [pointBuyMin, pointBuyMax] = [pointBuyMax, pointBuyMin];

    const pointBuyBudget = Number(data.pointBuyBudget);
    const bonusStartingGoldGp = Number(data.bonusStartingGoldGp);

    await game.settings.set(MODULE_ID, "houseRules", {
      abilityMethods,
      disallowedAlignments,
      minFeatLevel: Number(data.minFeatLevel) || 0,
      bannedSpecies,
      bannedClasses,
      bannedFeats,
      disableMulticlass: data.disableMulticlass === true,
      allowSelfLevelUp: data.allowSelfLevelUp === true,
      pointBuyBudget: Number.isFinite(pointBuyBudget) ? pointBuyBudget : 27,
      pointBuyMin,
      pointBuyMax,
      allowRerolls: data.allowRerolls === true,
      bonusStartingGoldGp: Number.isFinite(bonusStartingGoldGp) ? Math.max(0, bonusStartingGoldGp) : 0
    });
  }
}
