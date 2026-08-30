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
 * Every Item pack the GM has actually enabled, with the current user's own visibility
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

// A step's real item list only changes when the GM edits Compendium Sources (enabling/
// disabling a pack or retagging its ruleset) or a homebrew stub is added/removed -
// nothing about navigating the wizard itself changes what a fresh sweep would find. But
// _prepareFeatsContext (and _prepareItemListContext for Class/Species/Background) call
// getStepItems fresh on every single render while that step is showing, so without a
// cache the same full compendium sweep reruns on every re-render, not just the first
// visit - the more content a table has installed, the more this compounds. Cached by
// the exact (stepType, rulesetVersions) pair for the rest of the client session;
// clearStepItemsCache() is called wherever something that could change the result
// actually happens (Compendium Sources save, a homebrew stub's own creation/removal).
// Caches the in-flight promise itself, not just the resolved value, so two renders
// racing the same lookup share one sweep instead of each starting their own.
const stepItemsCache = new Map();

export function clearStepItemsCache() {
  stepItemsCache.clear();
}

/**
 * Collect indexed items for a wizard step from every GM-enabled compendium, filtered by
 * dnd5e item type and by the wizard's selected ruleset version(s).
 * @param {keyof STEP_ITEM_TYPES} stepType
 * @param {("2014"|"2024")[]} rulesetVersions
 * @returns {Promise<object[]>}
 */
export async function getStepItems(stepType, rulesetVersions) {
  const cacheKey = `${stepType}:${Array.from(rulesetVersions).sort().join(",")}`;
  if (stepItemsCache.has(cacheKey)) {
    // A fresh copy every time - callers freely .sort()/mutate the array they get back
    // (see _prepareItemListContext), which must never touch the shared cached one.
    return [...(await stepItemsCache.get(cacheKey))];
  }

  const promise = _collectStepItems(stepType, rulesetVersions);
  stepItemsCache.set(cacheKey, promise);
  try {
    return [...(await promise)];
  } catch (err) {
    stepItemsCache.delete(cacheKey);
    throw err;
  }
}

async function _collectStepItems(stepType, rulesetVersions) {
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

    const candidates = [];
    for (const entry of index) {
      if (!itemTypes.includes(entry.type)) continue;

      const itemRuleset = resolveItemRuleset(entry, packRulesetTag);
      if (!matchesRuleset(itemRuleset, rulesetVersions)) continue;

      // dnd5e stores class features (Rage, Metamagic options, every subclass feature,
      // ...) as the same Item type "feat" as a real Feat, distinguished only by
      // system.type.value - and class features vastly outnumber real feats (in one real
      // install, 1847 "feat"-typed entries across enabled packs, only 120 of them an
      // actual Feat). system.type.value is already free on the index (requested via
      // "system.type" above), so a feat-step lookup can skip the expensive
      // per-entry document fetch below for anything that isn't a real Feat, instead of
      // fetching every class feature just to immediately discard it.
      if (stepType === "feat" && entry.system?.type?.value !== "feat") continue;

      candidates.push({ entry, itemRuleset });
    }

    // The human-readable source book label ("SRD 5.1", "PHB 2024", ...) is a derived
    // getter (system.source.label) that only exists on a fully-prepared Item document -
    // getIndex's raw system.source only ever has the literal stored book/rules/revision
    // fields, and the "book" field itself is often blank on stock SRD items (the label
    // is computed from rules+revision instead). Fetched in parallel rather than one
    // document at a time - each pack.getDocument() call for an entry that isn't already
    // cached is a real round trip, and awaiting them sequentially in a loop serializes
    // every one of those round trips end to end instead of overlapping them.
    const docs = await Promise.all(candidates.map(({ entry }) => pack.getDocument(entry._id)));

    candidates.forEach(({ entry, itemRuleset }, i) => {
      const doc = docs[i];
      const bookLabel = doc?.system?.source?.label ?? null;

      results.push({
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        type: entry.type,
        subtype: entry.system?.type?.subtype ?? null,
        // Distinguishes a real Feat from a class feature - both are stored as the same
        // Item type "feat", only system.type.value tells them apart. Only meaningful for
        // feat-type items; harmless undefined for every other type this function returns.
        typeValue: doc?.system?.type?.value ?? null,
        prerequisites: doc?.system?.prerequisites ?? null,
        ruleset: itemRuleset,
        book: bookLabel,
        pack: pack.collection,
        hitDie: entry.system?.hd?.denomination ?? null,
        primaryAbilities: entry.system?.primaryAbility?.value?.length ? entry.system.primaryAbility.value : null,
        speed: entry.system?.movement?.walk ?? null
      });
    });
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
      typeValue: item.system?.type?.value ?? null,
      prerequisites: item.system?.prerequisites ?? null,
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

/**
 * Source-book slugs (dnd5e's own `system.source.slug`, e.g. "phb-2024", "srd-51") worth
 * excluding by default from the embedded CompendiumBrowser's own Source filter (see
 * runCompendiumBrowser in choice-queue.mjs). Two independent reasons a slug ends up
 * here, both reusing the exact same per-item ruleset resolution getStepItems already
 * applies (system.source.rules first, falling back to the GM's per-pack ruleset tag):
 *
 * 1. Ruleset mismatch - the slug never matches the wizard's currently selected
 *    ruleset(s) from any GM-enabled, player-visible pack. "Both" rulesets selected
 *    naturally excludes nothing here, since every real ruleset-tagged slug matches one
 *    side or the other. A slug provided by two packs, one matching and one not (e.g. a
 *    2014-tagged homebrew pack re-using a slug a real 2024 pack also uses), stays
 *    visible - matching still beats non-matching rather than being averaged away.
 *
 * 2. Redundant generic content - a system-bundled book (SRD 5.1, SRD 5.2, ...) whose
 *    ruleset a *real, named* module (Player's Handbook, Forge of the Artificer, ...)
 *    also covers - exactly what a GM who owns the real book wants:
 *    hide the generic duplicate, not just narrow it by ruleset. Deliberately keyed off
 *    the package type (`system` vs anything else - matches the same signal
 *    `categorizePack` already uses to sort the Compendium Sources screen), not a
 *    hardcoded slug list - a GM with *only* the bundled SRD content for a given ruleset
 *    (no real book installed) still sees it normally, since nothing else covers that
 *    ruleset to make it redundant.
 *
 * Does NOT attempt to also exclude a GM-disabled pack's own slugs from the browser's
 * results entirely - the embedded CompendiumBrowser reads dnd5e's own separate native
 * pack toggle (`packSourceConfiguration`, its own "Configure Sources" cog), not this
 * module's Compendium Sources setting, and there's no way to make it search a narrower
 * pack universe per-embedding from in here. A real, disclosed limitation, not something
 * this function silently pretends to solve.
 * @param {("2014"|"2024")[]} rulesetVersions
 * @returns {Promise<string[]>}
 */
export async function getRulesetMismatchedSourceSlugs(rulesetVersions) {
  const config = getPackConfig();
  const allowed = new Set();
  const seen = new Set();
  // Per-ruleset slug sets, split by whether the *providing pack* is a system-bundled
  // one (dnd5e's own generic SRD content) or a real named module - independent of
  // rulesetVersions, since "is this ruleset redundantly covered" is a fact about the
  // GM's install, not about what the current wizard happens to have selected.
  const systemSlugsByRuleset = new Map();
  const namedSlugsByRuleset = new Map();

  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    if (!isPackEnabled(pack, config) || !isPackVisibleToPlayer(pack)) continue;

    const packRulesetTag = config[pack.collection]?.ruleset ?? "auto";
    const isSystemPack = pack.metadata.packageType === "system";
    const index = await pack.getIndex({ fields: ["system.source"] });
    for (const entry of index) {
      const slug = entry.system?.source?.slug;
      if (!slug) continue;
      seen.add(slug);

      const itemRuleset = resolveItemRuleset(entry, packRulesetTag);
      if (matchesRuleset(itemRuleset, rulesetVersions)) allowed.add(slug);

      if (itemRuleset) {
        const bucket = isSystemPack ? systemSlugsByRuleset : namedSlugsByRuleset;
        if (!bucket.has(itemRuleset)) bucket.set(itemRuleset, new Set());
        bucket.get(itemRuleset).add(slug);
      }
    }
  }

  const excluded = new Set(Array.from(seen).filter((slug) => !allowed.has(slug)));

  for (const ruleset of rulesetVersions) {
    if (!namedSlugsByRuleset.get(ruleset)?.size) continue;
    for (const slug of systemSlugsByRuleset.get(ruleset) ?? []) excluded.add(slug);
  }

  return Array.from(excluded);
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
