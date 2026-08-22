import { MODULE_ID } from "../constants.mjs";

/**
 * Resolves the GM's configured step order (a plain array of step ids, saved by
 * step-order-config.mjs) against a definitive step-definition list, rather than
 * trusting the saved order blindly - a saved order from before a new step existed
 * (or a corrupted/hand-edited setting) shouldn't silently drop that step from the
 * wizard. Unknown ids in the saved order are dropped, and any real step id missing
 * from it is appended at the end in its original definition order.
 */
export function getOrderedStepIds(definitions) {
  const saved = game.settings.get(MODULE_ID, "stepOrder");
  const defaultOrder = definitions.map((step) => step.id);
  if (!Array.isArray(saved) || !saved.length) return defaultOrder;

  const validIds = new Set(defaultOrder);
  const kept = saved.filter((id) => validIds.has(id));
  const missing = defaultOrder.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

/** Same as getOrderedStepIds, but returns the full step-definition objects in order. */
export function getOrderedStepDefinitions(definitions) {
  const byId = new Map(definitions.map((step) => [step.id, step]));
  return getOrderedStepIds(definitions).map((id) => byId.get(id));
}
