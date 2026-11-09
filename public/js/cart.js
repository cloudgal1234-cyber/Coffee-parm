/*
 * Cart state — persisted to localStorage, priced with the shared Pricing module.
 */
const KEY = 'crb.cart.v1';

export function createCart(menu) {
  let lines = [];
  const listeners = new Set();

  try {
    lines = JSON.parse(localStorage.getItem(KEY)) || [];
    // drop lines whose item no longer exists in the menu
    lines = lines.filter((l) => {
      try { Pricing.priceLine(menu, l); return true; } catch { return false; }
    });
  } catch {
    lines = [];
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode */ }
    listeners.forEach((fn) => fn());
  }

  const sameConfig = (a, b) =>
    a.itemId === b.itemId &&
    (a.sizeId || null) === (b.sizeId || null) &&
    (a.note || '') === (b.note || '') &&
    JSON.stringify(a.options || {}) === JSON.stringify(b.options || {});

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** raw lines, for sending to the server */
    raw: () => lines.map(({ key, ...l }) => l),

    /** priced lines with their keys, for rendering */
    priced() {
      return lines.map((l) => ({ key: l.key, ...Pricing.priceLine(menu, l) }));
    },

    totals() {
      if (!lines.length) return { subtotal: 0, total: 0, count: 0 };
      const t = Pricing.priceCart(menu, lines);
      return { subtotal: t.subtotal, total: t.total, count: lines.reduce((s, l) => s + l.qty, 0) };
    },

    countOf: (itemId) => lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0),

    get: (key) => lines.find((l) => l.key === key),

    add(line) {
      const existing = lines.find((l) => sameConfig(l, line));
      if (existing) existing.qty = Math.min(50, existing.qty + line.qty);
      else lines.push({ ...line, key: Math.random().toString(36).slice(2, 10) });
      save();
    },

    replace(key, line) {
      const i = lines.findIndex((l) => l.key === key);
      if (i >= 0) lines[i] = { ...line, key };
      save();
    },

    setQty(key, qty) {
      const l = lines.find((x) => x.key === key);
      if (!l) return;
      if (qty <= 0) lines = lines.filter((x) => x.key !== key);
      else l.qty = Math.min(50, qty);
      save();
    },

    remove(key) { lines = lines.filter((l) => l.key !== key); save(); },

    clear() { lines = []; save(); },
  };
}
