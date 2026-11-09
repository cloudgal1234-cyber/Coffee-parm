/*
 * Minimal persistent order store (JSON file). Swap for a real DB later
 * (SQLite / Postgres / Firebase) by keeping the same exported functions.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'orders.json');

let state = { orders: [], counter: { date: '', next: 101 } };

function load() {
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    persist();
  }
}

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  }, 50);
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
}

/** Order numbers restart from 101 every day — easy to call out at the cart. */
function nextOrderNumber() {
  const d = today();
  if (state.counter.date !== d) state.counter = { date: d, next: 101 };
  return state.counter.next++;
}

function create(order) {
  state.orders.push(order);
  // keep the file small: drop orders older than 7 days
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  state.orders = state.orders.filter((o) => new Date(o.createdAt).getTime() > cutoff);
  persist();
  return order;
}

function update(id, patch) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return null;
  Object.assign(o, patch, { updatedAt: new Date().toISOString() });
  persist();
  return o;
}

function get(id) {
  return state.orders.find((x) => x.id === id) || null;
}

function listToday() {
  const d = today();
  return state.orders.filter((o) => o.businessDate === d);
}

module.exports = { load, create, update, get, listToday, nextOrderNumber, today };
