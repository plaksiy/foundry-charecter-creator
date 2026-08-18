/**
 * Small currency-math helpers for the Equipment step's "buy your own item" balancing
 * model. Reuses dnd5e's own `CONFIG.DND5E.currencies[key].conversion` rates (units of
 * that denomination per 1 GP) instead of a hardcoded duplicate table.
 */

/** @returns {number} the actor's total currency, expressed as a single GP-equivalent number. */
export function totalGpEquivalent(currency) {
  return Object.entries(currency ?? {}).reduce((sum, [key, count]) => {
    const conversion = CONFIG.DND5E.currencies[key]?.conversion ?? 1;
    return sum + (count ?? 0) / conversion;
  }, 0);
}

/** @returns {number} an item's real price, expressed as a single GP-equivalent number (0 if unpriced). */
export function itemPriceInGp(item) {
  const price = item.system?.price;
  if (!price?.value) return 0;
  const conversion = CONFIG.DND5E.currencies[price.denomination ?? "gp"]?.conversion ?? 1;
  return price.value / conversion;
}

/**
 * Re-split a GP-equivalent total back into whole-unit denominations, largest first
 * (pp -> gp -> ep -> sp -> cp), with copper absorbing any leftover fractional remainder
 * so the total value is preserved exactly. This is a full re-denomination, not a
 * minimal-change calculation - simplest correct approach for a small pricing model, at
 * the cost of not preserving which specific coins a player already had (acceptable
 * here: only manual equipment purchases/refunds trigger this, not general play).
 * @param {number} totalGp
 * @returns {{pp: number, gp: number, ep: number, sp: number, cp: number}}
 */
export function redenominateGp(totalGp) {
  const order = ["pp", "gp", "ep", "sp", "cp"];
  let remaining = Math.max(0, totalGp);
  const result = {};

  order.forEach((key, index) => {
    const conversion = CONFIG.DND5E.currencies[key]?.conversion ?? 1;
    const isLast = index === order.length - 1;
    const count = isLast ? Math.round(remaining * conversion) : Math.floor(remaining * conversion);
    result[key] = count;
    remaining -= count / conversion;
  });

  return result;
}

/** @returns {string} a short display string, e.g. "12.5 GP". */
export function formatGp(gp) {
  return `${Math.round(gp * 100) / 100} GP`;
}
