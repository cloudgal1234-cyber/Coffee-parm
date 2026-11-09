import { api } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `₪${Number(n).toLocaleString('he-IL')}`;
const timeOf = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

const LATE_MIN = 10; // highlight orders waiting longer than this
const NEXT = {
  new: { to: 'preparing', label: 'התחל הכנה ☕' },
  preparing: { to: 'ready', label: 'מוכן 🔔' },
  ready: { to: 'done', label: 'נאסף ✓' },
};
const PREV = { preparing: 'new', ready: 'preparing', done: 'ready', cancelled: 'new' };
const STATUS_HE = { done: 'נאסף', cancelled: 'בוטל' };

let client;
let orders = new Map();
let freshIds = new Set();
let soundOn = localStorage.getItem('crb.sound') !== 'off';
let unseen = 0;

/* ---------------- sound ---------------- */
let audioCtx;
function beep() {
  if (!soundOn) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1175, 1568];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
  } catch { /* audio blocked until first user interaction */ }
}
function renderSoundBtn() {
  $('#soundBtn').textContent = soundOn ? '🔔' : '🔕';
}

/* ---------------- rendering ---------------- */
function ticketHtml(o) {
  const ageMin = Math.floor((Date.now() - new Date(o.createdAt)) / 60000);
  const late = ageMin >= LATE_MIN && o.status !== 'ready';
  const next = NEXT[o.status];
  return `<article class="ticket s-${o.status} ${freshIds.has(o.id) ? 'fresh' : ''} ${late ? 'late' : ''}" data-id="${o.id}">
    <div class="t-top">
      <div class="t-no">#${o.number}</div>
      <div class="t-name">${esc(o.customer.name)}</div>
    </div>
    <div class="t-meta">
      <span>🕒 ${timeOf(o.createdAt)}</span>
      <span class="t-age">${ageMin < 1 ? 'עכשיו' : `לפני ${ageMin} ד׳`}</span>
      <a href="tel:${esc(o.customer.phone)}">📞 ${esc(o.customer.phone)}</a>
      ${o.pickup && o.pickup !== 'asap' ? `<span class="t-pickup">איסוף ב-${esc(o.pickup)}</span>` : ''}
    </div>
    <ul class="t-lines">
      ${o.lines
        .map((l) => {
          const opts = [l.sizeLabel, ...(l.optionLabels || [])].filter(Boolean).join(' · ');
          return `<li><span class="t-q">${l.qty}</span><span class="t-item">${esc(l.name)}</span>
            ${opts ? `<div class="t-opts">${esc(opts)}</div>` : ''}
            ${l.note ? `<div class="t-note">✎ ${esc(l.note)}</div>` : ''}</li>`;
        })
        .join('')}
    </ul>
    ${o.orderNote ? `<div class="t-onote">📝 ${esc(o.orderNote)}</div>` : ''}
    <div class="t-foot">
      <div class="t-total">${money(o.total)}<span class="t-paid">✓ שולם${o.payment?.provider === 'mock' ? ' (הדגמה)' : ''}</span></div>
      ${PREV[o.status] && o.status !== 'new' ? `<button class="t-back" data-act="${PREV[o.status]}">חזרה</button>` : ''}
      ${o.status === 'new' ? `<button class="t-x" data-act="cancelled">ביטול</button>` : ''}
      ${next ? `<button class="t-act go-${next.to}" data-act="${next.to}">${next.label}</button>` : ''}
    </div>
  </article>`;
}

function render() {
  const list = [...orders.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const by = { new: [], preparing: [], ready: [] };
  const finished = [];
  for (const o of list) (by[o.status] || finished).push(o);

  for (const [status, arr] of Object.entries(by)) {
    $(`.col[data-col="${status}"] .col-body`).innerHTML = arr.length
      ? arr.map(ticketHtml).join('')
      : `<div class="col-empty">${status === 'new' ? 'אין הזמנות חדשות ☕' : '—'}</div>`;
    document.querySelectorAll(`[data-count="${status}"]`).forEach((el) => (el.textContent = arr.length));
  }

  finished.reverse();
  $('#histCount').textContent = finished.length;
  $('#histBody').innerHTML = finished
    .map(
      (o) => `<tr data-id="${o.id}"><td>${o.number}</td><td>${timeOf(o.createdAt)}</td><td>${esc(o.customer.name)}</td>
        <td>${o.lines.map((l) => `${l.qty}×${esc(l.name)}`).join(', ')}</td><td>${money(o.total)}</td>
        <td class="st-${o.status}">${STATUS_HE[o.status]}</td>
        <td><button class="t-back" data-act="${PREV[o.status]}">החזרה</button></td></tr>`
    )
    .join('');

  const paid = list.filter((o) => o.status !== 'cancelled');
  $('#sOpen').textContent = by.new.length + by.preparing.length + by.ready.length;
  $('#sCount').textContent = paid.length;
  $('#sRevenue').textContent = money(paid.reduce((s, o) => s + o.total, 0));
  document.title = (unseen ? `(${unseen}) ` : '') + 'ניהול הזמנות · קפה רחל';
}

/* ---------------- actions ---------------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const to = btn.dataset.act;
  if (to === 'cancelled' && !confirm('לבטל את ההזמנה? (החזר כספי יש לבצע ידנית מול ספק הסליקה)')) return;
  btn.disabled = true;
  try {
    const { order } = await client.setStatus(id, to);
    freshIds.delete(id);
    orders.set(order.id, order);
    render();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.col').forEach((c) => c.classList.toggle('active', c.dataset.col === t.dataset.tab));
});

$('#soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('crb.sound', soundOn ? 'on' : 'off');
  renderSoundBtn();
  if (soundOn) beep();
});
$('#fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
window.addEventListener('focus', () => { unseen = 0; render(); });

/* ---------------- live connection ---------------- */
function setLive(state) {
  const el = $('#live');
  el.className = 'live ' + state;
  el.lastElementChild.textContent = state === 'on' ? 'מחובר בזמן אמת' : 'מתחבר מחדש…';
}

async function reload() {
  const { orders: list } = await client.list();
  orders = new Map(list.map((o) => [o.id, o]));
  render();
}

function connect() {
  const es = client.stream();
  es.onopen = () => { setLive('on'); reload().catch(() => {}); }; // resync after reconnect
  es.onerror = () => setLive('off');
  es.addEventListener('order:new', (e) => {
    const o = JSON.parse(e.data);
    orders.set(o.id, o);
    freshIds.add(o.id);
    setTimeout(() => freshIds.delete(o.id), 4000);
    if (!document.hasFocus()) unseen++;
    beep();
    render();
  });
  es.addEventListener('order:update', (e) => {
    const o = JSON.parse(e.data);
    orders.set(o.id, o);
    render();
  });
}

function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

async function start(pin) {
  client = api.admin(pin);
  await client.check();
  $('#pinGate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderSoundBtn();
  tick();
  setInterval(() => { tick(); render(); }, 30_000); // refresh "waiting X min"
  await reload();
  connect();
}

/* ---------------- boot (with optional PIN) ---------------- */
(async () => {
  const savedPin = sessionStorage.getItem('crb.pin') || '';
  try {
    await start(savedPin);
  } catch (err) {
    if (err.status !== 401) { alert(err.message); return; }
    $('#pinGate').classList.remove('hidden');
    $('#pinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = e.target.pin.value.trim();
      try {
        await start(pin);
        sessionStorage.setItem('crb.pin', pin);
      } catch (er) {
        $('#pinErr').textContent = er.status === 401 ? 'קוד שגוי' : er.message;
      }
    });
  }
})();
