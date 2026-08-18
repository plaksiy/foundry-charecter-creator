/**
 * Pure parsing helpers over a class/background item's `system.startingEquipment` tree.
 *
 * dnd5e models this as a flat array of `EquipmentEntryData` records linked by a
 * `group` field pointing at a parent entry's `_id` (an `AND`/`OR` grouping node's
 * `.children` getter re-derives the tree from that flat array). There is no built-in
 * "grant this to an actor" API - `StartingEquipmentConfig` is a GM-facing editor for
 * authoring the tree, not a player-facing picker - so the wizard walks the tree itself
 * and creates the actual items/currency, reusing dnd5e's own `generateLabel()` for
 * display text so bundle descriptions match what the item sheet itself shows.
 *
 * The top level is either a single `OR` node (a real A/B/C kit choice - its
 * `.children` are the actual `AND`-type "branches") or a single fixed `AND` node with
 * no real choice. Both are normalized to a `branches` array by `getEquipmentBranches`
 * so the rest of the code doesn't need to special-case either.
 */

const CATEGORY_TYPES = ["weapon", "armor", "tool", "focus"];

/**
 * @param {Item} sourceItem - a class or background item
 * @returns {object[]} the "branches" the player can pick between (each is an
 *   AND-type node, or the item's one fixed bundle when there is no real OR choice) -
 *   plus a synthetic "take the gold instead" branch when the item has a flat
 *   `system.wealth` value, since that option lives in a separate field entirely, not
 *   in the `startingEquipment` tree, and is completely independent of any real A/B
 *   kit branches the item also has.
 */
export function getEquipmentBranches(sourceItem) {
  const all = sourceItem.system.startingEquipment;
  const topLevel = all?.filter((entry) => !entry.group) ?? [];

  const branches = topLevel.length === 1 && topLevel[0].type === "OR" ? [...topLevel[0].children] : [...topLevel];

  const wealth = Number(sourceItem.system.wealth);
  if (wealth > 0) {
    branches.push({
      _id: "wealth",
      type: "AND",
      isWealth: true,
      wealthAmount: wealth,
      children: [{ _id: "wealth-currency", type: "currency", key: CONFIG.DND5E.defaultCurrency ?? "gp", count: wealth }]
    });
  }

  return branches;
}

/**
 * Flatten one branch into ready-to-grant entries (linked items, currency) and entries
 * still needing a player pick (weapon/armor/tool/focus category choices, or a nested
 * OR sub-choice - not seen in any sampled content but handled defensively).
 * @param {object} branch
 * @returns {{ grants: object[], choices: object[] }}
 */
export function resolveBranch(branch) {
  const grants = [];
  const choices = [];

  const visit = (node) => {
    if (node.type === "AND") node.children.forEach(visit);
    else if (node.type === "OR") choices.push(node);
    else if (CATEGORY_TYPES.includes(node.type)) choices.push(node);
    else grants.push(node);
  };

  visit(branch);
  return { grants, choices };
}

/** Rich-HTML summary of a branch's contents, e.g. "Chain Mail, Greatsword, ... and 4 GP". */
export async function branchLabel(branch) {
  return branch.generateLabel({ modernStyle: true, depth: 2 });
}
