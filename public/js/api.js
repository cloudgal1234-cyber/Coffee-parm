/*
 * Thin client for the ordering API. All network calls live here, so the UI
 * never needs to know whether the backend is this Node server or something else.
 */
async function request(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `שגיאה (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getMenu: () => request('GET', '/data/menu.json'),

  /**
   * Place an order. The server recalculates prices and runs the configured
   * payment provider. Returns { order, redirectUrl }.
   * If redirectUrl is set (real hosted-payment provider), send the customer there.
   */
  placeOrder: (payload) => request('POST', '/api/orders', payload),

  getOrder: (id) => request('GET', `/api/orders/${encodeURIComponent(id)}`),

  /**
   * Live status for one order (polling — works on serverless hosts like Vercel).
   * Returns an unsubscribe function.
   */
  watchOrder(id, onStatus, everyMs = 4000) {
    let stopped = false;
    let last = null;
    async function tick() {
      if (stopped) return;
      try {
        const { order } = await api.getOrder(id);
        if (order.status !== last) {
          last = order.status;
          onStatus(order);
        }
      } catch { /* network hiccup — try again next tick */ }
      if (!stopped && !['done', 'cancelled'].includes(last)) setTimeout(tick, document.hidden ? everyMs * 3 : everyMs);
    }
    tick();
    return () => { stopped = true; };
  },

  /* ---- staff ---- */
  admin(pin) {
    const h = pin ? { 'X-Admin-Pin': pin } : {};
    return {
      check: () => request('GET', '/api/admin/check', null, h),
      list: () => request('GET', '/api/admin/orders', null, h),
      setStatus: (id, status) => request('PATCH', `/api/admin/orders/${encodeURIComponent(id)}`, { status }, h),
    };
  },
};
