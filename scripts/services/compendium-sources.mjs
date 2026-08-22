import { MODULE_ID } from "../constants.mjs";

/**
 * dnd5e Item document "type" values relevant to each wizard step.
 * @type {Record<string, string[]>}
 */
export const STEP_ITEM_TYPES = {
  race: ["race"],
  class: ["class"],
  subclass: ["subclass"],
  background: ["background"],
  feat: ["feat"],
  equipment: ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"]
};

export const RULESET_TAG_CHOICES = ["auto", "2014", "2024", "both"];

function getPackConfig() {
  return game.settings.get(MODULE_ID, "compendiumSources");
}

function isPackEnabled(pack, config) {
  const entry = config[pack.collection];
  if (!entry) return true;
  return entry.enabled !== false;
}

// --- Player-facing source filter -----------------------------------------
//
// A per-user (client-scoped) narrowing on top of the GM's world-scoped allowlist above -
// a player can hide a GM-enabled pack from their own wizard view (e.g. they don't want
// to see a partner-content pack they don't own the book for), but can never see a pack
// the GM has disabled. Managed live from inside the wizard itself (see
// _showSourceFilter in character-creator-app.mjs), not a separate settings-menu screen.

function getPlayerSourceFilter() {
  return game.settings.get(MODULE_ID, "playerSourceFilter") ?? {};
}

/** @returns {boolean} whether the current user has personally hidden this pack. */
function isPackVisibleToPlayer(pack) {
  return getPlayerSourceFilter()[pack.collection] !== false;
}

/** Toggle one pack's visibility for the current user only. */
export async function setPlayerSourceVisibility(packId, visible) {
  const current = { ...getPlayerSourceFilter() };
  if (visible) delete current[packId];
  else current[packId] = false;
  await game.settings.set(MODULE_ID, "playerSourceFilter", current);
}

/**
 * Every Item pack the GM has actually enabled, with the current player's own visibility
 * preference - the option list for the in-wizard "Sources" filter panel. A pack the GM
 * disabled entirely never appears here, so a player can only narrow, never expand,
 * what's actually available.
 */
export function listPlayerVisiblePacks() {
  const config = getPackConfig();
  return game.packs
    .filter((pack) => pack.documentName === "Item" && isPackEnabled(pack, config))
    .map((pack) => ({
      id: pack.collection,
      label: pack.title,
      source: pack.metadata.packageName ?? pack.metadata.packageType ?? "",
      visible: isPackVisibleToPlayer(pack)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Resolve which ruleset an indexed item belongs to.
 * Prefers the item's own `system.source.rules` field (set by the dnd5e system itself,
 * when present). Falls back to the GM's per-compendium ruleset tag. Returns null when
 * neither source says anything, meaning the item is treated as ruleset-agnostic.
 * @param {object} indexEntry
 * @param {string} packRulesetTag - "auto" | "2014" | "2024" | "both"
 * @returns {"2014"|"2024"|null}
 */
function resolveItemRuleset(indexEntry, packRulesetTag) {
  const systemRules = indexEntry.system?.source?.rules;
  if (systemRules === "2014" || systemRules === "2024") return systemRules;

  if (packRulesetTag === "2014" || packRulesetTag === "2024") return packRulesetTag;

  return null;
}

function matchesRuleset(itemRuleset, rulesetVersions) {
  if (!itemRuleset) return true;
  return rulesetVersions.includes(itemRuleset);
}

/**
 * Collect indexed items for a wizard step from every GM-enabled compendium, filtered by
 * dnd5e item type and by the wizard's selected ruleset version(s).
 * @param {keyof STEP_ITEM_TYPES} stepType
 * @param {("2014"|"2024")[]} rulesetVersions
 * @returns {Promise<object[]>}
 */
export async function getStepItems(stepType, rulesetVersions) {
  const itemTypes = STEP_ITEM_TYPES[stepType];
  if (!itemTypes) throw new Error(`${MODULE_ID} | Unknown step type "${stepType}"`);

  const config = getPackConfig();
  const results = [];

  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    if (!isPackEnabled(pack, config)) continue;
    if (!isPackVisibleToPlayer(pack)) continue;

    const packRulesetTag = config[pack.collection]?.ruleset ?? "auto";
    // A handful of extra fields, cheap to request via the index (no full-document fetch
    // needed) - getIndex() populates these without loading the whole item, unlike a
    // class/species's own `system.description` (which is either an @Embed reference to
    // a Journal page or dense rules-table HTML, not usable as a plain flavor sentence,
    // so deliberately not fetched here). Harmless for types that don't have a given
    // field - it's just absent from that entry.
    const index = await pack.getIndex({
      fields: ["system.source", "system.type", "system.hd.denomination", "system.primaryAbility.value", "system.movement.walk"]
    });

    for (const entry of index) {
      if (!itemTypes.includes(entry.type)) continue;

      const itemRuleset = resolveItemRuleset(entry, packRulesetTag);
      if (!matchesRuleset(itemRuleset, rulesetVersions)) continue;

      // The human-readable source book label ("SRD 5.1", "PHB 2024", ...) is a derived
      // getter (system.source.label) that only exists on a fully-prepared Item document -
      // getIndex's raw system.source only ever has the literal stored book/rules/revision
      // fields, and the "book" field itself is often blank on stock SRD items (the label
      // is computed from rules+revision instead). Worth the extra fetch here: this only
      // runs for the small already-filtered survivor set (a step's real class/species/
      // background/feat list, a few dozen at most), and pack.getDocument caches after
      // the first load, so repeat renders don't refetch.
      const doc = await pack.getDocument(entry._id);
      const bookLabel = doc?.system?.source?.label ?? null;

      results.push({
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        type: entry.type,
        subtype: entry.system?.type?.subtype ?? null,
        ruleset: itemRuleset,
        book: bookLabel,
        pack: pack.collection,
        hitDie: entry.system?.hd?.denomination ?? null,
        primaryAbilities: entry.system?.primaryAbility?.value?.length ? entry.system.primaryAbility.value : null,
        speed: entry.system?.movement?.walk ?? null
      });
    }
  }

  // Player/GM-authored homebrew placeholders (see "Add Custom" in the Class/Species/
  // Background steps) are plain world Items, not compendium entries - included here so
  // they show up in the same card grid using the exact same list/select/advancement
  // machinery as real compendium content, no separate bookkeeping needed. Untagged
  // ruleset (null) so a 2014/2024 filter never hides homebrew. Gated on the module's own
  // `homebrewStub` flag (set only by the "Add Custom" form) rather than sweeping every
  // world Item of a matching type - the world Items directory can hold anything (a GM's
  // in-progress draft, an unrelated import tool's leftover copy), and none of that should
  // silently become a pickable option for every player just by existing there.
  for (const item of game.items) {
    if (!itemTypes.includes(item.type)) continue;
    if (!item.getFlag(MODULE_ID, "homebrewStub")) continue;
    results.push({
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      type: item.type,
      subtype: item.system?.type?.subtype ?? null,
      ruleset: null,
      book: null,
      pack: "world",
      hitDie: item.system?.hd?.denomination ?? null,
      primaryAbilities: item.system?.primaryAbility?.value?.length ? item.system.primaryAbility.value : null,
      speed: item.system?.movement?.walk ?? null,
      custom: true
    });
  }

  return deduplicateByNameAndRuleset(results);
}

/**
 * Collapse duplicate entries (same name, same resolved ruleset) that come from two
 * different enabled packs - a real scenario the moment a GM enables a named content
 * module (Player's Handbook, etc.) alongside dnd5e's own bundled SRD packs, since both
 * typically define the same core classes/species/backgrounds under the same name (e.g.
 * "Fighter" from both `dnd5e.classes24` and a Player's Handbook module's own pack).
 *
 * When a name collides, prefers whichever entry did NOT come from a bundled `dnd5e.*`
 * pack - a GM who installed and enabled a named module almost certainly wants that
 * module's own (often fuller/official) version shown instead of the redundant SRD one
 * bundled with the system itself, not an arbitrary pick between the two.
 * @param {object[]} items
 * @returns {object[]}
 */
function deduplicateByNameAndRuleset(items) {
  const bestByKey = new Map();
  for (const item of items) {
    const key = `${item.name}::${item.ruleset ?? "any"}`;
    const existing = bestByKey.get(key);
    if (!existing || (existing.pack.startsWith("dnd5e.") && !item.pack.startsWith("dnd5e."))) {
      bestByKey.set(key, item);
    }
  }
  return Array.from(bestByKey.values());
}

export const PACK_CATEGORIES = ["core", "expanded", "homebrew", "legacy"];

/**
 * Which of the 4 GM-facing groups a pack belongs to, purely from Foundry's own package
 * metadata plus the one already-documented dnd5e naming convention (see "Compendium
 * structure" in CLAUDE.md): 2024 system packs are suffixed "24" (`classes24`,
 * `origins24`, ...), 2014 ones aren't. No new guessing involved - `packageType` already
 * tells world/module apart natively, and the "24" suffix is a stable convention this
 * codebase already relies on elsewhere (getStepItems' ruleset resolution).
 * @param {CompendiumCollection} pack
 * @returns {"core"|"expanded"|"homebrew"|"legacy"}
 */
function categorizePack(pack) {
  const type = pack.metadata.packageType;
  if (type === "world") return "homebrew";
  if (type !== "system") return "expanded";
  return pack.collection.endsWith("24") ? "core" : "legacy";
}

/**
 * List every Item compendium pack with its current enabled/ruleset config, for the
 * GM-facing settings screen. Includes `category` (see categorizePack) so the screen can
 * group Core Rules / Expanded Rules / Homebrew / Legacy instead of one flat list.
 * @returns {{ id: string, label: string, source: string, enabled: boolean, ruleset: string, category: string }[]}
 */
export function listConfigurablePacks() {
  const config = getPackConfig();

  return game.packs
    .filter((pack) => pack.documentName === "Item")
    .map((pack) => {
      const entry = config[pack.collection] ?? {};
      return {
        id: pack.collection,
        label: pack.title,
        source: pack.metadata.packageName ?? pack.metadata.packageType ?? "",
        enabled: entry.enabled ?? true,
        ruleset: entry.ruleset ?? "auto",
        category: categorizePack(pack)
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
