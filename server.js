/*
 * Cafe Rachel Betzahala — ordering server (zero dependencies, Node 18+)
 *
 *   /            customer ordering site
 *   /main        staff dashboard (kitchen view)
 *   /api/...     JSON API + Server-Sent Events for real-time updates
 *
 * Run:  node server.js        (PORT, ADMIN_PIN, PAYMENT_PROVIDER env vars are optional)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./server/store');
const payments = require('./server/payments');
const Pricing = require('./public/js/pricing');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || ''; // empty = dashboard open (fine for local use)
const PUBLIC_DIR = path.join(__dirname, 'public');
const MENU_FILE = path.join(PUBLIC_DIR, 'data', 'menu.json');

const STATUSES = ['new', 'preparing', 'ready', 'done', 'cancelled'];

store.load();

function loadMenu() {
  return JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); // re-read so menu edits apply without restart
}

/* ---------------- helpers ---------------- */

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
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

function isAdmin(req, url) {
  if (!ADMIN_PIN) return true;
  const given = req.headers['x-admin-pin'] || url.searchParams.get('pin') || '';
  const a = Buffer.from(String(given));
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

/* ---------------- real-time (SSE) ---------------- */

const adminClients = new Set();
const orderClients = new Map(); // orderId -> Set<res>

function sseOpen(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => clearInterval(ping));
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, order) {
  for (const res of adminClients) sseSend(res, event, order);
  const subs = orderClients.get(order.id);
  if (subs) for (const res of subs) sseSend(res, 'status', publicView(order));
}

/* ---------------- API ---------------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // POST /api/orders — place an order (price is recalculated here, then payment is taken)
  if (req.method === 'POST' && url.pathname === '/api/orders') {
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
      priced = Pricing.priceCart(loadMenu(), body.lines);
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
    const order = store.create({
      id,
      number: store.nextOrderNumber(),
      businessDate: store.today(),
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

    if (order.status === 'new') broadcast('order:new', order);
    return send(res, 201, { order: publicView(order), redirectUrl: result.url || null });
  }

  // GET /api/orders/:id — customer tracking
  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'orders') {
    const o = store.get(parts[2]);
    return o ? send(res, 200, { order: publicView(o) }) : send(res, 404, { error: 'not found' });
  }

  // GET /api/stream?order=<id> — customer live status
  if (req.method === 'GET' && url.pathname === '/api/stream' && url.searchParams.get('order')) {
    const o = store.get(url.searchParams.get('order'));
    if (!o) return send(res, 404, { error: 'not found' });
    sseOpen(req, res);
    sseSend(res, 'status', publicView(o));
    if (!orderClients.has(o.id)) orderClients.set(o.id, new Set());
    orderClients.get(o.id).add(res);
    req.on('close', () => orderClients.get(o.id)?.delete(res));
    return;
  }

  /* ---- staff-only below ---- */
  if (!isAdmin(req, url)) return send(res, 401, { error: 'קוד גישה שגוי' });

  // GET /api/admin/check — validate PIN
  if (req.method === 'GET' && url.pathname === '/api/admin/check') return send(res, 200, { ok: true });

  // GET /api/admin/orders — today's orders
  if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
    return send(res, 200, { orders: store.listToday().filter((o) => o.status !== 'pending_payment') });
  }

  // GET /api/admin/stream — live feed for the dashboard
  if (req.method === 'GET' && url.pathname === '/api/admin/stream') {
    sseOpen(req, res);
    adminClients.add(res);
    req.on('close', () => adminClients.delete(res));
    return;
  }

  // PATCH /api/admin/orders/:id  { status }
  if (req.method === 'PATCH' && parts.length === 4 && parts[1] === 'admin' && parts[2] === 'orders') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    if (!STATUSES.includes(body.status)) return send(res, 400, { error: 'סטטוס לא תקין' });
    const o = store.update(parts[3], { status: body.status });
    if (!o) return send(res, 404, { error: 'not found' });
    broadcast('order:update', o);
    return send(res, 200, { order: o });
  }

  send(res, 404, { error: 'not found' });
}

/* ---------------- static files ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/main') p = '/main/index.html'; // staff dashboard
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('לא נמצא');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': /\.(jpg|png)$/.test(file) ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
}

/* ---------------- server ---------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'שגיאת שרת' });
    });
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
  } else {
    res.writeHead(405);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`☕  Ordering site:   http://localhost:${PORT}/`);
  console.log(`📋  Staff dashboard: http://localhost:${PORT}/main`);
  console.log(`💳  Payment provider: ${payments.name}${ADMIN_PIN ? '  |  🔒 dashboard PIN enabled' : ''}`);
});
