/*
 * Shared pricing logic — used by BOTH the browser (cart totals) and the server
 * (authoritative recalculation before payment). Never trust prices from the client.
 *
 * A cart line looks like:
 *   { itemId, sizeId?, options?: { [groupId]: choiceId | choiceId[] }, note?, qty }
 */
(function (root) {
  function findItem(menu, itemId) {
    for (const cat of menu.categories) {
      const item = cat.items.find((i) => i.id === itemId);
      if (item) return { item, category: cat };
    }
    return null;
  }

  function priceLine(menu, line) {
    const found = findItem(menu, line.itemId);
    if (!found) throw new Error('פריט לא קיים: ' + line.itemId);
    const { item, category } = found;

    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new Error('כמות לא תקינה');

    let base;
    let sizeLabel = null;
    if (item.sizes) {
      const size = item.sizes.find((s) => s.id === line.sizeId) || item.sizes[0];
      base = size.price;
      sizeLabel = size.label;
    } else {
      base = item.price;
    }

    let extras = 0;
    const optionLabels = [];
    const chosen = line.options || {};
    for (const groupId of item.options || []) {
      const group = menu.optionGroups[groupId];
      if (!group) continue;
      const raw = chosen[groupId];
      if (raw == null) continue;
      const ids = Array.isArray(raw) ? raw : [raw];
      if (group.type === 'single' && ids.length > 1) throw new Error('בחירה לא תקינה');
      for (const id of ids) {
        const choice = group.choices.find((c) => c.id === id);
        if (!choice) throw new Error('אפשרות לא קיימת: ' + id);
        extras += choice.price;
        // Skip "default" choices (first single choice) to keep the ticket readable
        if (group.type === 'multi' || group.alwaysShow || group.choices[0].id !== id) {
          optionLabels.push(choice.price ? `${choice.label} (+${choice.price})` : choice.label);
        }
      }
    }

    const note = String(line.note || '').trim().slice(0, 200);
    const unitPrice = base + extras;
    return {
      itemId: item.id,
      name: item.name,
      category: category.title,
      sizeId: line.sizeId || null,
      sizeLabel,
      options: chosen,
      optionLabels,
      note,
      qty,
      unitPrice,
      total: unitPrice * qty,
    };
  }

  function priceCart(menu, lines) {
    if (!Array.isArray(lines) || lines.length === 0) throw new Error('העגלה ריקה');
    if (lines.length > 60) throw new Error('יותר מדי פריטים');
    const priced = lines.map((l) => priceLine(menu, l));
    const subtotal = priced.reduce((s, l) => s + l.total, 0);
    return { lines: priced, subtotal, total: subtotal };
  }

  const api = { findItem, priceLine, priceCart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof self !== 'undefined' ? self : this);
