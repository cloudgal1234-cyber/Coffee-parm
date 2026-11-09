/*
 * Order store with two interchangeable backends:
 *
 *   • Redis (Upstash REST)  — used automatically when its env vars exist.
 *     Required on Vercel / any serverless host (no shared disk or memory there).
 *     Env: KV_REST_API_URL + KV_REST_API_TOKEN   (set by Vercel's Upstash integration)
 *       or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 *   • JSON file             — local development / a regular always-on server.
 *
 * All functions are async and have the same signature in both backends.
 */
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 7;

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
}

/* ------------------------------------------------------------------ Redis */
function redisBackend(url, token) {
  async function cmd(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error('Redis: ' + (data.error || res.status));
    return data.result;
  }
  const TTL = String(KEEP_DAYS * 86400);
  const kOrder = (id) => `crb:order:${id}`;
  const kDay = (d) => `crb:day:${d}`;
  const kCounter = (d) => `crb:counter:${d}`;

  return {
    kind: 'redis',
    async nextOrderNumber() {
      const d = today();
      const n = await cmd('INCR', kCounter(d));
      if (n === 1) await cmd('EXPIRE', kCounter(d), TTL);
      return 100 + n; // 101, 102, ...
    },
    async create(order) {
      await cmd('SET', kOrder(order.id), JSON.stringify(order), 'EX', TTL);
      await cmd('RPUSH', kDay(order.businessDate), order.id);
      await cmd('EXPIRE', kDay(order.businessDate), TTL);
      return order;
    },
    async get(id) {
      const raw = await cmd('GET', kOrder(id));
      return raw ? JSON.parse(raw) : null;
    },
    async update(id, patch) {
      const o = await this.get(id);
      if (!o) return null;
      Object.assign(o, patch, { updatedAt: new Date().toISOString() });
      await cmd('SET', kOrder(id), JSON.stringify(o), 'KEEPTTL');
      return o;
    },
    async listToday() {
      const ids = await cmd('LRANGE', kDay(today()), '0', '-1');
      if (!ids || !ids.length) return [];
      const raws = await cmd('MGET', ...ids.map(kOrder));
      return raws.filter(Boolean).map((r) => JSON.parse(r));
    },
  };
}

/* ------------------------------------------------------------------- File */
function fileBackend() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const FILE = path.join(DATA_DIR, 'orders.json');
  let state = null;

  function load() {
    if (state) return state;
    try {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
      state = { orders: [], counter: { date: '', next: 101 } };
    }
    return state;
  }
  function persist() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  }

  return {
    kind: 'file',
    async nextOrderNumber() {
      const s = load();
      const d = today();
      if (s.counter.date !== d) s.counter = { date: d, next: 101 };
      const n = s.counter.next++;
      persist();
      return n;
    },
    async create(order) {
      const s = load();
      s.orders.push(order);
      const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
      s.orders = s.orders.filter((o) => new Date(o.createdAt).getTime() > cutoff);
      persist();
      return order;
    },
    async get(id) {
      return load().orders.find((o) => o.id === id) || null;
    },
    async update(id, patch) {
      const o = load().orders.find((x) => x.id === id);
      if (!o) return null;
      Object.assign(o, patch, { updatedAt: new Date().toISOString() });
      persist();
      return o;
    },
    async listToday() {
      const d = today();
      return load().orders.filter((o) => o.businessDate === d);
    },
  };
}

/* ---------------------------------------------------------------- choose */
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let backend;
if (redisUrl && redisToken) backend = redisBackend(redisUrl, redisToken);
else if (process.env.VERCEL) backend = null; // serverless without a DB → explicit error, never silent data loss
else backend = fileBackend();

module.exports = { backend, today };
