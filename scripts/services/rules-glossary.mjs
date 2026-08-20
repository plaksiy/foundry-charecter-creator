/**
 * Resolves short "learn more" links into dnd5e's own bundled rules-glossary compendiums,
 * rather than reproducing any rules text ourselves. `dnd5e.rules` holds the 2014 SRD
 * chapters (most single-concept terms live in "Appendix E: Rules"), `dnd5e.content24`
 * holds the 2024 free-rules content (most single-concept terms live in a proper
 * "Rules Glossary" entry). A plain `<a class="content-link" data-uuid="...">` pointing
 * at a JournalEntryPage is enough for dnd5e's own tooltip manager to render its real
 * "rule-tooltip" hover preview - no custom tooltip UI needed on our side at all.
 */

const GLOSSARY_PACKS = {
  2014: "dnd5e.rules",
  2024: "dnd5e.content24"
};

/**
 * key -> { "2014": {entry, page} | null, "2024": {entry, page} | null }.
 * `entry` is the JournalEntry name, `page` the JournalEntryPage name inside it, matched
 * against the compendium content bundled with dnd5e 5.3.3. A null side means the term
 * has no dedicated glossary page under that ruleset (e.g. 2024-only mechanics) - callers
 * get a plain, unlinked label back for that side instead of a broken link.
 */
const TERMS = {
  advantage: {
    2014: { entry: "Chapter 7: Using Ability Scores", page: "Advantage and Disadvantage" },
    2024: { entry: "Rules Glossary", page: "Advantage" }
  },
  proficiencyBonus: {
    2014: { entry: "Chapter 7: Using Ability Scores", page: "Proficiency Bonus" },
    2024: { entry: "Rules Glossary", page: "Proficiency" }
  },
  expertise: {
    2014: null,
    2024: { entry: "Rules Glossary", page: "Expertise" }
  },
  concentration: {
    2014: { entry: "Appendix E: Rules", page: "Concentration" },
    2024: { entry: "Rules Glossary", page: "Concentration" }
  },
  ritual: {
    2014: { entry: "Appendix E: Rules", page: "Rituals" },
    2024: { entry: "Rules Glossary", page: "Ritual" }
  },
  cantrip: {
    2014: { entry: "Appendix E: Rules", page: "Cantrips" },
    2024: { entry: "Rules Glossary", page: "Cantrip" }
  },
  originFeat: {
    2014: null,
    2024: { entry: "Feats", page: "Origin Feats" }
  },
  weaponMastery: {
    2014: null,
    2024: { entry: "Equipment", page: "Mastery Properties" }
  },
  multiclassing: {
    2014: { entry: "Chapter 6: Customization Options", page: "Multiclassing" },
    2024: { entry: "Character Creation", page: "Multiclassing" }
  }
};

// entryId cache, keyed "pack|entryName" -> JournalEntry (avoids re-fetching the same
// journal for every term that happens to live inside it).
const entryCache = new Map();
// Final resolved-link cache, keyed "key|ruleset" -> {uuid, name} | null.
const linkCache = new Map();

async function resolveEntry(pack, entryName) {
  const cacheKey = `${pack.collection}|${entryName}`;
  if (entryCache.has(cacheKey)) return entryCache.get(cacheKey);
  const index = await pack.getIndex();
  const indexEntry = index.contents.find((e) => e.name === entryName);
  const doc = indexEntry ? await pack.getDocument(indexEntry._id) : null;
  entryCache.set(cacheKey, doc);
  return doc;
}

/**
 * Resolves a glossary term for a given ruleset ("2014"/"2024") to its real compendium
 * UUID. Returns null if the term has no dedicated page under that ruleset, the term key
 * is unknown, or the pack/page isn't found (e.g. a GM disabled/uninstalled the pack).
 */
export async function resolveRuleTerm(key, rulesetVersion) {
  const ruleset = rulesetVersion === "2014" ? 2014 : 2024;
  const cacheKey = `${key}|${ruleset}`;
  if (linkCache.has(cacheKey)) return linkCache.get(cacheKey);

  const term = TERMS[key]?.[ruleset];
  let result = null;
  if (term) {
    const pack = game.packs.get(GLOSSARY_PACKS[ruleset]);
    const entry = pack ? await resolveEntry(pack, term.entry) : null;
    const page = entry?.pages.find((p) => p.name === term.page);
    if (page) result = { uuid: page.uuid, name: page.name };
  }
  linkCache.set(cacheKey, result);
  return result;
}

/**
 * Renders a term as dnd5e's own native content-link markup (real hover tooltip, no
 * custom UI) when a glossary page is found, or as a plain `<strong>` label otherwise -
 * callers can safely drop the result straight into a triple-stash Handlebars binding.
 */
export async function ruleLinkHtml(key, rulesetVersion, label) {
  const term = await resolveRuleTerm(key, rulesetVersion);
  if (!term) return `<strong>${label}</strong>`;
  return `<a class="content-link" data-link data-uuid="${term.uuid}" data-type="JournalEntryPage"><i class="fa-solid fa-book-open"></i>${label}</a>`;
}
