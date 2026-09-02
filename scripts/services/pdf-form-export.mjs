import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";

/**
 * Fills a real, official-style fillable D&D character sheet PDF that the GM supplies
 * themselves (never bundled with this module - the sheet's own layout/artwork is
 * WotC's copyrighted work, same reason no book text is ever copied into this module's
 * own compendiums). The field-name map below was built by inspecting a real fillable
 * 2024 sheet PDF directly (its AcroForm field names and widget positions), not guessed
 * at - every name here is a real field on that document. Different fillable PDFs
 * circulating in the wild name their fields differently (confirmed directly: a second
 * copy of the same visual sheet used generic "Text1"/"Text6"/... names instead), so
 * every field write below is wrapped in a try/catch that silently skips a missing field
 * rather than failing the whole export - a GM's own PDF might only match some of these
 * names, and a partial fill is far more useful than none at all.
 */

const SAVE_FIELDS = {
  str: { text: "STR SAVE", check: "Check Box18" },
  dex: { text: "DEX SAVE", check: "Check Box11" },
  con: { text: "CON SAVE", check: "Check Box7" },
  int: { text: "INT SAVE", check: "Check Box25" },
  // This particular sheet's own WIS SAVE text field is mislabeled "Text Field71" in the
  // underlying PDF (confirmed directly against the real widget layout - every other
  // save/skill field on the sheet has a descriptive name, this one alone doesn't).
  wis: { text: "Text Field71", check: "Check Box17" },
  cha: { text: "CHA SAVE", check: "Check Box6" }
};

const SKILL_FIELDS = {
  acr: { text: "ACROBATICS", check: "Check Box8" },
  ani: { text: "ANIMAL HANDLING", check: "Check Box15" },
  arc: { text: "ARCANA", check: "Check Box24" },
  ath: { text: "ATHLETICS", check: "Check Box19" },
  dec: { text: "DECEPTION", check: "Check Box5" },
  his: { text: "HISTORY", check: "Check Box20" },
  ins: { text: "INSIGHT", check: "Check Box13" },
  itm: { text: "INTIMIDATE", check: "Check Box4" },
  inv: { text: "INVESTIGATION", check: "Check Box21" },
  med: { text: "MEDICINE", check: "Check Box12" },
  nat: { text: "NATURE", check: "Check Box22" },
  prc: { text: "PERCEPTION", check: "Check Box14" },
  prf: { text: "PERFORMANCE", check: "Check Box3" },
  per: { text: "PERSUASION", check: "Check Box2" },
  rel: { text: "RELIGION", check: "Check Box23" },
  slt: { text: "SLEIGHT OF HAND", check: "Check Box9" },
  ste: { text: "STEALTH", check: "Check Box10" },
  sur: { text: "SURVIVAL", check: "Check Box16" }
};

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function setText(form, name, value) {
  if (value === null || value === undefined || value === "") return;
  try {
    form.getTextField(name).setText(String(value));
  } catch {
    // Field doesn't exist under this name on the GM's own PDF - skip it.
  }
}

function setCheck(form, name, checked) {
  if (!checked) return;
  try {
    form.getCheckBox(name).check();
  } catch {
    // Same as setText - a missing field on this particular PDF is not fatal.
  }
}

/**
 * @param {Uint8Array|ArrayBuffer} templateBytes - the GM's own fillable PDF, as loaded
 *   from wherever it's stored (Foundry Data, or a URL to it).
 * @param {object} data - the flat, PDF-shaped export data built by
 *   character-creator-app.mjs's _prepareOfficialPdfContext.
 * @returns {Promise<Uint8Array>} the filled PDF's bytes.
 */
export async function buildFilledPdfBytes(templateBytes, data) {
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  setText(form, "Name", data.name);
  setText(form, "Class", data.classText);
  setText(form, "Subclass", data.subclass);
  setText(form, "Species", data.species);
  setText(form, "Background", data.background);
  setText(form, "Level", data.level);
  setText(form, "XP Points", data.xp);
  setText(form, "Alignment", data.alignment);
  setText(form, "Armor Class", data.ac);
  setText(form, "init", data.initiative);
  setText(form, "SPEED", data.speed);
  setText(form, "SIZE", data.size);
  setText(form, "PASSIVE PERCEPTION", data.passivePerception);
  setText(form, "PROF BONUS", data.profBonus);
  setText(form, "Current HP", data.hpCurrent);
  setText(form, "Max HP", data.hpMax);
  setText(form, "Temp HP", data.hpTemp);
  setText(form, "Max HD", data.hdMax);

  for (const key of ABILITY_KEYS) {
    const ability = data.abilities?.[key];
    if (ability) {
      setText(form, `${key.toUpperCase()} SCORE`, ability.score);
      setText(form, `${key.toUpperCase()} MOD`, ability.modText);
    }
    const save = data.saves?.[key];
    if (save) {
      setText(form, SAVE_FIELDS[key].text, save.modText);
      setCheck(form, SAVE_FIELDS[key].check, save.proficient);
    }
  }

  for (const [key, fields] of Object.entries(SKILL_FIELDS)) {
    const skill = data.skills?.[key];
    if (!skill) continue;
    setText(form, fields.text, skill.modText);
    setCheck(form, fields.check, skill.proficient);
  }

  setText(form, "CP", data.currency?.cp);
  setText(form, "SP", data.currency?.sp);
  setText(form, "EP", data.currency?.ep);
  setText(form, "GP", data.currency?.gp);
  setText(form, "PP", data.currency?.pp);

  setText(form, "LANGUAGES", data.languages);
  setText(form, "WEAPON PROF", data.weaponProf);
  setText(form, "TOOL PROF", data.toolProf);
  setText(form, "CLASS FEATURES 1", data.classFeaturesCol1);
  setText(form, "CLASS FEATURES 2", data.classFeaturesCol2);
  setText(form, "SPECIES TRAITS", data.speciesTraits);
  setText(form, "FEATS", data.feats);
  setText(form, "EQUIPMENT", data.equipment);
  setText(form, "BACKSTORY / PERSONALITY", data.backstoryPersonality);
  setText(form, "APPEARANCE", data.appearance);

  if (data.spellcasting) {
    setText(form, "SPELLCASTING ABILITY", data.spellcasting.ability);
    setText(form, "SPELLCASTING MOD", data.spellcasting.mod);
    setText(form, "SPELL SAVE DC", data.spellcasting.saveDc);
    setText(form, "SPELL ATTACK BONUS", data.spellcasting.attackBonus);
    for (const [level, total] of Object.entries(data.spellcasting.slots ?? {})) {
      setText(form, `LVL${level} TOTAL`, total);
    }
  }

  // This sheet's spell list is one continuous run of 30 generic rows (an unsuffixed
  // first row, then "0" through "28"), each with its own free-text level field rather
  // than being pre-split into cantrip/1st/2nd/... sections - so every known spell
  // (cantrips first, since that's how the wizard's own data already orders them) is
  // just written into the next row in order, writing its own level number in too.
  (data.spells ?? []).slice(0, 30).forEach((spell, index) => {
    const suffix = index === 0 ? "" : String(index - 1);
    setText(form, `SPELL LEVEL${suffix}`, spell.level);
    setText(form, `SPELL NAME${suffix}`, spell.name);
  });

  (data.weapons ?? []).slice(0, 6).forEach((weapon, index) => {
    const n = index + 1;
    setText(form, `NAME - WEAPON ${n}`, weapon.name);
    setText(form, `BONUS/DC - WEAPON ${n}`, weapon.bonus);
    setText(form, `DAMAGE/TYPE - WEAPON ${n}`, weapon.damage);
  });

  return pdfDoc.save();
}
