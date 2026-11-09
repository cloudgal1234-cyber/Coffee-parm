/*
 * JSON API — shared by the local server (server/local.js) and the
 * Vercel serverless function (api/index.js).
 *
 *   POST  /api/orders                 place an order (price recalculated + payment)
 *   GET   /api/orders/:id             customer order status
 *   GET   /api/admin/check            validate staff PIN
 *   GET   /api/admin/orders           today's orders (staff)
 *   PATCH /api/admin/orders/:id       change status (staff)
 *
 * Clients poll for updates every few seconds, which works on serverless hosts.
 */
const crypto = require('crypto');

const { backend: store, today } = require('./store');
const payments = require('./payments');
const Pricing = require('../public/js/pricing');
const menu = require('../public/data/menu.json');

const ADMIN_PIN = process.env.ADMIN_PIN || ''; // empty = dashboard open
const STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled'];

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  // Vercel pre-parses the body; a plain Node server gives us a stream.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body || {};
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new Error('payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  if (!ADMIN_PIN) return true;
  const a = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** What a customer may see about their own order */
function publicView(o) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    lines: o.lines,
    total: o.total,
    customerName: o.customer.name,
    createdAt: o.createdAt,
    payment: { provider: o.payment.provider, transactionId: o.payment.transactionId, cardLast4: o.payment.cardLast4 },
  };
}

async function placeOrder(req, res, url) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }

  const name = String(body.customer?.name || '').trim().slice(0, 60);
  const phone = String(body.customer?.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  if (!name) return send(res, 400, { error: 'נא למלא שם' });
  if (phone.replace(/\D/g, '').length < 9) return send(res, 400, { error: 'מספר טלפון לא תקין' });

  let priced;
  try {
    priced = Pricing.priceCart(menu, body.lines);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }

  const cardLast4 = String(body.payment?.cardLast4 || '').replace(/\D/g, '').slice(-4) || null;
  const id = crypto.randomUUID();

  let result;
  try {
    result = await payments.createPayment({
      orderId: id,
      amount: priced.total,
      currency: 'ILS',
      description: 'הזמנה - קפה רחל בצהלה',
      customer: { name, phone, cardLast4 },
      returnUrl: `${url.origin}/?order=${id}`,
    });
  } catch (e) {
    console.error('payment error', e);
    return send(res, 502, { error: 'שגיאה בחיבור לספק התשלום' });
  }
  if (result.status === 'failed') return send(res, 402, { error: result.error || 'התשלום נכשל' });

  const now = new Date().toISOString();
  const order = await store.create({
    id,
    number: await store.nextOrderNumber(),
    businessDate: today(),
    status: result.status === 'paid' ? 'new' : 'pending_payment',
    customer: { name, phone },
    orderNote: String(body.orderNote || '').trim().slice(0, 300),
    pickup: body.pickup === 'later' ? String(body.pickupTime || '').slice(0, 5) : 'asap',
    lines: priced.lines,
    subtotal: priced.subtotal,
    total: priced.total,
    payment: {
      provider: payments.name,
      status: result.status,
      transactionId: result.transactionId || null,
      cardLast4,
    },
    createdAt: now,
    updatedAt: now,
  });

  return send(res, 201, { order: publicView(order), redirectUrl: result.url || null });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  try {
    if (!store) {
      return send(res, 503, {
        error: 'מסד הנתונים לא מחובר. ב-Vercel: Storage → Upstash Redis → Connect, ואז Redeploy.',
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/orders') return await placeOrder(req, res, url);

    if (req.method === 'GET' && parts.length === 3 && parts[1] === 'orders') {
      const o = await store.get(parts[2]);
      return o ? send(res, 200, { order: publicView(o) }) : send(res, 404, { error: 'not found' });
    }

    /* ---- staff only ---- */
    if (parts[1] === 'admin') {
      if (!isAdmin(req)) return send(res, 401, { error: 'קוד גישה שגוי' });

      if (req.method === 'GET' && url.pathname === '/api/admin/check') return send(res, 200, { ok: true });

      if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
        const orders = (await store.listToday()).filter((o) => o.status !== 'pending_payment');
        return send(res, 200, { orders, serverTime: new Date().toISOString() });
      }

      if (req.method === 'PATCH' && parts.length === 4 && parts[2] === 'orders') {
        let body;
        try {
          body = await readBody(req);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        if (!STATUSES.includes(body.status)) return send(res, 400, { error: 'סטטוס לא תקין' });
        const o = await store.update(parts[3], { status: body.status });
        return o ? send(res, 200, { order: o }) : send(res, 404, { error: 'not found' });
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'שגיאת שרת' });
  }
}

module.exports = { handleApi, storeKind: store ? store.kind : 'none', paymentProvider: payments.name };
