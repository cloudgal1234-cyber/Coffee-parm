import { api } from './api.js';
import { createCart } from './cart.js';

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `₪${Number(n).toLocaleString('he-IL')}`;

function toast(msg, ms = 1800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

const NOTE_HINTS = {
  coffee: 'למשל: רותח, קצף בצד, כוס גדולה…',
  'frozen-drinks': 'למשל: בלי קצפת, מתוק פחות…',
  'cold-drinks': 'למשל: עם קרח, בלי קש…',
  default: 'למשל: בלי בצל, לחתוך לחצי…',
};

let menu;
let cart;
let currentModal = null; // { close }

/* ---------------- modal infrastructure ---------------- */
function openModal(html, { onMount, onClose } = {}) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay" role="dialog" aria-modal="true">${html}</div>`;
  const overlay = root.firstElementChild;
  const close = () => {
    root.innerHTML = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    currentModal = null;
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  currentModal = { close, el: overlay };
  onMount?.(overlay, close);
  overlay.querySelector('[autofocus]')?.focus();
  return currentModal;
}
function closeModal() {
  currentModal?.close();
}

/* ---------------- menu rendering ---------------- */
function itemPriceLabel(item) {
  if (item.sizes) return item.sizes.map((s) => s.price).join(' / ') + ' ₪';
  return item.price + ' ₪';
}

function renderMenu() {
  $('#catNav').innerHTML = menu.categories
    .map((c) => `<button class="cat-chip" data-cat="${c.id}">${c.icon} ${esc(c.title)}</button>`)
    .join('');

  $('#menu').innerHTML = menu.categories
    .map(
      (c) => `
    <section class="panel" id="cat-${c.id}" data-cat="${c.id}">
      <div class="panel-head">
        <div class="panel-icon" aria-hidden="true">${c.icon}</div>
        <h2 class="panel-title">${esc(c.title)}</h2>
        <div class="divider"><span>♥</span></div>
      </div>
      ${c.items
        .map(
          (i) => `
        <button class="item" data-item="${i.id}">
          <span class="item-main">
            <span class="item-name">${esc(i.name)}${i.popular ? '<span class="badge-pop">אהוב</span>' : ''}<span class="qty-slot" data-qty="${i.id}"></span></span>
            ${i.sizes ? `<span class="item-meta d-block">${i.sizes.map((s) => esc(s.label)).join(' / ')}</span>` : ''}
          </span>
          <span class="item-price">${itemPriceLabel(i)}</span>
          <span class="item-add" aria-hidden="true">+</span>
        </button>`
        )
        .join('')}
    </section>`
    )
    .join('');

  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (b) openItem(b.dataset.item);
  });
  $('#catNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) $(`#cat-${b.dataset.cat}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // highlight the category in view
  const chips = [...document.querySelectorAll('.cat-chip')];
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        chips.forEach((ch) => ch.classList.toggle('active', ch.dataset.cat === en.target.dataset.cat));
        chips.find((ch) => ch.dataset.cat === en.target.dataset.cat)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      });
    },
    { rootMargin: '-80px 0px -60% 0px' }
  );
  document.querySelectorAll('.panel').forEach((p) => io.observe(p));
}

function refreshCartUi() {
  const t = cart.totals();
  const bar = $('#cartBar');
  bar.classList.toggle('empty', t.count === 0);
  $('#cartCount').textContent = t.count;
  $('#cartTotal').textContent = money(t.total);
  document.querySelectorAll('[data-qty]').forEach((el) => {
    const n = cart.countOf(el.dataset.qty);
    el.innerHTML = n ? `<span class="qty-dot">${n}</span>` : '';
  });
}

/* ---------------- item dialog ---------------- */
function openItem(itemId, editKey = null) {
  const { item, category } = Pricing.findItem(menu, itemId);
  const existing = editKey ? cart.get(editKey) : null;
  let qty = existing?.qty || 1;

  const sizeHtml = item.sizes
    ? `<div class="opt-group"><div class="opt-title">גודל</div><div class="opt-list">
        ${item.sizes
          .map(
            (s, idx) => `<label class="opt"><input type="radio" name="size" value="${s.id}" ${
              (existing ? existing.sizeId === s.id : idx === 0) ? 'checked' : ''
            }/>${esc(s.label)} · ${s.price} ₪</label>`
          )
          .join('')}
      </div></div>`
    : '';

  const groupsHtml = (item.options || [])
    .map((gid) => {
      const g = menu.optionGroups[gid];
      const chosen = existing?.options?.[gid];
      const isChecked = (cid, idx) =>
        g.type === 'multi' ? (chosen || []).includes(cid) : chosen ? chosen === cid : idx === 0;
      return `<div class="opt-group"><div class="opt-title">${esc(g.title)}${
        g.type === 'multi' ? '<small>אפשר לבחור כמה</small>' : ''
      }</div><div class="opt-list">
        ${g.choices
          .map(
            (c, idx) => `<label class="opt"><input type="${g.type === 'multi' ? 'checkbox' : 'radio'}" name="opt-${gid}" value="${c.id}" ${
              isChecked(c.id, idx) ? 'checked' : ''
            }/>${esc(c.label)}${c.price && g.type !== 'multi' ? ` +${c.price}` : ''}</label>`
          )
          .join('')}
      </div></div>`;
    })
    .join('');

  openModal(
    `<form class="sheet" id="itemForm">
      <div class="sheet-head">
        <div><h2 class="sheet-title">${esc(item.name)}</h2><div class="item-meta">${esc(category.title)}</div></div>
        <button type="button" class="icon-btn" data-close aria-label="סגירה">×</button>
      </div>
      <div class="sheet-body">
        ${sizeHtml}${groupsHtml}
        <label class="field"><span>הערות לפריט</span>
          <textarea class="input" name="note" maxlength="200" placeholder="${esc(NOTE_HINTS[category.id] || NOTE_HINTS.default)}">${esc(existing?.note || '')}</textarea>
        </label>
      </div>
      <div class="sheet-foot add-row">
        <div class="stepper"><button type="button" data-q="1" aria-label="הוספה">+</button><span id="q">${qty}</span><button type="button" data-q="-1" aria-label="הפחתה">−</button></div>
        <button class="btn btn-primary" type="submit" id="addBtn"></button>
      </div>
    </form>`,
    {
      onMount(el, close) {
        const form = $('#itemForm', el);
        const read = () => {
          const fd = new FormData(form);
          const options = {};
          for (const gid of item.options || []) {
            const g = menu.optionGroups[gid];
            const vals = fd.getAll(`opt-${gid}`);
            if (g.type === 'multi') { if (vals.length) options[gid] = vals; }
            else if (vals[0]) options[gid] = vals[0];
          }
          return { itemId: item.id, sizeId: fd.get('size') || null, options, note: String(fd.get('note') || '').trim(), qty };
        };
        const update = () => {
          const p = Pricing.priceLine(menu, read());
          $('#q', el).textContent = qty;
          $('#addBtn', el).textContent = `${existing ? 'עדכון' : 'הוספה לעגלה'} · ${money(p.total)}`;
        };
        form.addEventListener('change', update);
        form.addEventListener('click', (e) => {
          const b = e.target.closest('[data-q]');
          if (!b) return;
          qty = Math.max(1, Math.min(50, qty + Number(b.dataset.q)));
          update();
        });
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const line = read();
          if (existing) cart.replace(editKey, line);
          else cart.add(line);
          close();
          if (existing) openCart();
          else {
            toast(`${item.name} נוסף לעגלה ✓`);
            $('#cartBar').classList.remove('bump');
            void $('#cartBar').offsetWidth;
            $('#cartBar').classList.add('bump');
          }
        });
        update();
      },
    }
  );
}

/* ---------------- cart ---------------- */
function lineHtml(l, editable = true) {
  const opts = [l.sizeLabel, ...l.optionLabels].filter(Boolean).join(' · ');
  return `<div class="line">
    <div class="line-main">
      <div class="line-name">${editable ? '' : `${l.qty} × `}${esc(l.name)}</div>
      ${opts ? `<div class="line-opts">${esc(opts)}</div>` : ''}
      ${l.note ? `<div class="line-note">✎ ${esc(l.note)}</div>` : ''}
      ${editable ? `<button class="link-btn" data-edit="${l.key}">עריכה</button>` : ''}
    </div>
    <div class="line-side">
      <div class="line-price">${money(l.total)}</div>
      ${
        editable
          ? `<div class="stepper"><button data-inc="${l.key}" aria-label="הוספה">+</button><span>${l.qty}</span><button data-dec="${l.key}" aria-label="הפחתה">${l.qty === 1 ? '🗑' : '−'}</button></div>`
          : ''
      }
    </div>
  </div>`;
}

function openCart() {
  const render = (el) => {
    const lines = cart.priced();
    const t = cart.totals();
    $('.sheet-body', el).innerHTML = lines.length
      ? lines.map((l) => lineHtml(l)).join('') +
        `<div class="totals"><div><span>סכום ביניים</span><span>${money(t.subtotal)}</span></div>
         <div class="grand"><span>סה״כ לתשלום</span><span>${money(t.total)}</span></div></div>`
      : `<div class="empty-state"><div class="big">☕</div>העגלה ריקה — בואו נמלא אותה</div>`;
    $('#toCheckout', el).disabled = !lines.length;
  };

  openModal(
    `<div class="sheet">
      <div class="sheet-head"><h2 class="sheet-title">העגלה שלי</h2><button class="icon-btn" data-close aria-label="סגירה">×</button></div>
      <div class="sheet-body"></div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block" id="toCheckout">להמשך לתשלום</button></div>
    </div>`,
    {
      onMount(el) {
        render(el);
        const unsub = cart.subscribe(() => render(el));
        const origClose = currentModal.close;
        currentModal.close = () => { unsub(); origClose(); };
        el.addEventListener('click', (e) => {
          const t = e.target.closest('button');
          if (!t) return;
          if (t.dataset.inc) cart.setQty(t.dataset.inc, cart.get(t.dataset.inc).qty + 1);
          if (t.dataset.dec) cart.setQty(t.dataset.dec, cart.get(t.dataset.dec).qty - 1);
          if (t.dataset.edit) openItem(cart.get(t.dataset.edit).itemId, t.dataset.edit);
          if (t.id === 'toCheckout') openCheckout();
        });
      },
    }
  );
}

/* ---------------- checkout (mock payment) ---------------- */
const digits = (s) => String(s).replace(/\D/g, '');

function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = +num[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return num.length >= 13 && sum % 10 === 0;
}

function validIsraeliId(id) {
  id = digits(id);
  if (id.length < 5 || id.length > 9) return false;
  id = id.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = +id[i] * ((i % 2) + 1);
    sum += n > 9 ? n - 9 : n;
  }
  return sum % 10 === 0;
}

function cardBrand(num) {
  if (/^4/.test(num)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
  if (/^3[47]/.test(num)) return 'AMEX';
  if (/^(36|38|30)/.test(num)) return 'Diners';
  return '';
}

function openCheckout() {
  const t = cart.totals();
  const lines = cart.priced();
  const saved = (() => { try { return JSON.parse(localStorage.getItem('crb.customer')) || {}; } catch { return {}; } })();

  openModal(
    `<form class="sheet" id="payForm" novalidate>
      <div class="sheet-head">
        <button type="button" class="icon-btn" id="backToCart" aria-label="חזרה לעגלה">→</button>
        <h2 class="sheet-title">תשלום</h2>
        <button type="button" class="icon-btn" data-close aria-label="סגירה">×</button>
      </div>
      <div class="sheet-body">
        <div class="mock-banner">🧪 מצב הדגמה — לא יבוצע חיוב אמיתי. אפשר להשתמש בכרטיס 4242 4242 4242 4242.</div>
        <div id="formError"></div>

        <h3 class="section-title">פרטי המזמין</h3>
        <label class="field"><span>שם</span><input class="input" name="name" autocomplete="name" required value="${esc(saved.name || '')}" placeholder="השם שנקרא כשההזמנה מוכנה" /><div class="field-error"></div></label>
        <label class="field"><span>טלפון</span><input class="input ltr" name="phone" type="tel" inputmode="tel" autocomplete="tel" required value="${esc(saved.phone || '')}" placeholder="050-0000000" /><div class="field-error"></div></label>

        <h3 class="section-title">מתי לאסוף?</h3>
        <div class="opt-list" style="margin-bottom:10px">
          <label class="opt"><input type="radio" name="pickup" value="asap" checked />בהקדם</label>
          <label class="opt"><input type="radio" name="pickup" value="later" />בשעה מסוימת</label>
        </div>
        <label class="field hidden" id="pickupTimeField"><span>שעת איסוף</span><input class="input ltr" type="time" name="pickupTime" /><div class="field-error"></div></label>
        <label class="field"><span>הערה כללית להזמנה <small style="font-weight:400">(לא חובה)</small></span><textarea class="input" name="orderNote" maxlength="300" placeholder="למשל: אגיע עם הסוס 🐴"></textarea></label>

        <h3 class="section-title">כרטיס אשראי</h3>
        <div class="cc" aria-hidden="true">
          <div class="cc-brand" id="ccBrand"></div>
          <div class="cc-chip"></div>
          <div class="cc-num" id="ccNum">•••• •••• •••• ••••</div>
          <div class="cc-row"><span id="ccName">CARD HOLDER</span><span id="ccExp">MM/YY</span></div>
        </div>
        <label class="field"><span>מספר כרטיס</span><input class="input ltr" name="card" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="0000 0000 0000 0000" required /><div class="field-error"></div></label>
        <div class="row">
          <label class="field"><span>תוקף</span><input class="input ltr" name="exp" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="MM/YY" required /><div class="field-error"></div></label>
          <label class="field"><span>CVV</span><input class="input ltr" name="cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123" required /><div class="field-error"></div></label>
        </div>
        <label class="field"><span>ת.ז. בעל הכרטיס</span><input class="input ltr" name="idnum" inputmode="numeric" maxlength="9" placeholder="000000000" required /><div class="field-error"></div></label>

        <h3 class="section-title">סיכום הזמנה</h3>
        <div class="box">
          ${lines.map((l) => lineHtml(l, false)).join('')}
          <div class="totals"><div><span>סכום ביניים</span><span>${money(t.subtotal)}</span></div>
          <div class="grand"><span>סה״כ לתשלום</span><span>${money(t.total)}</span></div></div>
        </div>
      </div>
      <div class="sheet-foot">
        <button class="btn btn-primary btn-block" type="submit" id="payBtn">🔒 תשלום ${money(t.total)}</button>
        <div class="secure-note">🔐 תשלום מאובטח · פרטי הכרטיס לא נשמרים</div>
      </div>
    </form>`,
    {
      onMount(el) {
        const form = $('#payForm', el);
        const f = (n) => form.elements[n];
        $('#backToCart', el).onclick = openCart;

        form.addEventListener('change', (e) => {
          if (e.target.name === 'pickup') $('#pickupTimeField', el).classList.toggle('hidden', e.target.value !== 'later');
        });

        // live formatting + card preview
        f('card').addEventListener('input', (e) => {
          const d = digits(e.target.value).slice(0, 19);
          e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
          $('#ccNum', el).textContent = (d + '•'.repeat(Math.max(0, 16 - d.length))).replace(/(.{4})/g, '$1 ').trim();
          $('#ccBrand', el).textContent = cardBrand(d);
        });
        f('exp').addEventListener('input', (e) => {
          let d = digits(e.target.value).slice(0, 4);
          if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2);
          e.target.value = d;
          $('#ccExp', el).textContent = d || 'MM/YY';
        });
        f('cvv').addEventListener('input', (e) => (e.target.value = digits(e.target.value).slice(0, 4)));
        f('idnum').addEventListener('input', (e) => (e.target.value = digits(e.target.value).slice(0, 9)));
        f('name').addEventListener('input', (e) => ($('#ccName', el).textContent = e.target.value || 'CARD HOLDER'));
        $('#ccName', el).textContent = f('name').value || 'CARD HOLDER';

        const setErr = (name, msg) => {
          const input = f(name);
          input.classList.toggle('invalid', !!msg);
          input.closest('.field').querySelector('.field-error').textContent = msg || '';
          return !msg;
        };

        function validate() {
          const v = Object.fromEntries(new FormData(form));
          const now = new Date();
          const [mm, yy] = (v.exp || '').split('/').map(Number);
          const expOk = mm >= 1 && mm <= 12 && yy >= 0 && new Date(2000 + yy, mm, 0, 23, 59) >= now;
          const checks = [
            setErr('name', v.name.trim().length >= 2 ? '' : 'נא למלא שם'),
            setErr('phone', /^0\d{8,9}$/.test(digits(v.phone)) ? '' : 'מספר טלפון לא תקין'),
            setErr('card', luhn(digits(v.card)) ? '' : 'מספר כרטיס לא תקין'),
            setErr('exp', expOk ? '' : 'תוקף לא תקין'),
            setErr('cvv', /^\d{3,4}$/.test(v.cvv) ? '' : 'CVV לא תקין'),
            setErr('idnum', validIsraeliId(v.idnum) ? '' : 'ת.ז. לא תקינה'),
            v.pickup === 'later' ? setErr('pickupTime', v.pickupTime ? '' : 'נא לבחור שעה') : true,
          ];
          return checks.every(Boolean) ? v : null;
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          $('#formError', el).innerHTML = '';
          const v = validate();
          if (!v) {
            form.querySelector('.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
          const btn = $('#payBtn', el);
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> מעבד תשלום…';

          try { localStorage.setItem('crb.customer', JSON.stringify({ name: v.name.trim(), phone: v.phone })); } catch {}

          try {
            // Only the last 4 digits leave the browser. A real provider collects the
            // card itself (hosted page / hosted fields) — see README.
            const { order, redirectUrl } = await api.placeOrder({
              lines: cart.raw(),
              customer: { name: v.name.trim(), phone: v.phone },
              orderNote: v.orderNote,
              pickup: v.pickup,
              pickupTime: v.pickupTime,
              payment: { cardLast4: digits(v.card).slice(-4) },
            });
            if (redirectUrl) { location.href = redirectUrl; return; }
            cart.clear();
            openSuccess(order);
          } catch (err) {
            $('#formError', el).innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
            $('.sheet-body', el).scrollTop = 0;
            btn.disabled = false;
            btn.innerHTML = `🔒 תשלום ${money(t.total)}`;
          }
        });
      },
    }
  );
}

/* ---------------- success + live tracking ---------------- */
const STEPS = [
  { id: 'new', label: 'התקבלה', icon: '✓' },
  { id: 'preparing', label: 'בהכנה', icon: '☕' },
  { id: 'ready', label: 'מוכנה!', icon: '🔔' },
];

function trackHtml(status) {
  const idx = status === 'done' ? 3 : STEPS.findIndex((s) => s.id === status);
  return STEPS.map(
    (s, i) => `<div class="track-step ${i <= idx ? 'on' : ''} ${i === idx ? 'current' : ''}"><div class="dot">${s.icon}</div>${s.label}</div>`
  ).join('');
}

function openSuccess(order) {
  const url = new URL(location.href);
  url.searchParams.set('order', order.id);
  history.replaceState(null, '', url);

  let unwatch = () => {};
  openModal(
    `<div class="sheet">
      <div class="sheet-head"><h2 class="sheet-title">ההזמנה התקבלה</h2><button class="icon-btn" data-close aria-label="סגירה">×</button></div>
      <div class="sheet-body success">
        <div class="check">✓</div>
        <div class="order-no-label">מספר הזמנה</div>
        <div class="order-no">#${order.number}</div>
        <div>תודה ${esc(order.customerName)}! נקרא בשמך כשההזמנה מוכנה.</div>
        <div class="track" id="track">${trackHtml(order.status)}</div>
        <div id="statusBanner"></div>
        <div class="box" style="text-align:right">
          ${order.lines.map((l) => lineHtml(l, false)).join('')}
          <div class="totals"><div class="grand"><span>שולם</span><span>${money(order.total)}</span></div></div>
          <div class="item-meta" style="margin-top:8px">אסמכתא: ${esc(order.payment.transactionId || '—')}${order.payment.cardLast4 ? ` · כרטיס ••${esc(order.payment.cardLast4)}` : ''}</div>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block" data-close>להזמנה חדשה</button></div>
    </div>`,
    {
      onMount(el) {
        unwatch = api.watchOrder(order.id, (o) => {
          $('#track', el).innerHTML = trackHtml(o.status);
          $('#statusBanner', el).innerHTML =
            o.status === 'ready'
              ? '<div class="ready-banner">🔔 ההזמנה מוכנה! אפשר לגשת לעגלה</div>'
              : o.status === 'cancelled'
              ? '<div class="cancel-banner">ההזמנה בוטלה — נא לפנות לצוות</div>'
              : o.status === 'done'
              ? '<div class="ready-banner">בתיאבון! ☕</div>'
              : '';
          if (o.status === 'ready' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
        });
      },
      onClose() {
        unwatch();
        const u = new URL(location.href);
        u.searchParams.delete('order');
        history.replaceState(null, '', u);
      },
    }
  );
}

/* ---------------- boot ---------------- */
(async function init() {
  try {
    menu = await api.getMenu();
  } catch {
    $('#menu').innerHTML = '<p class="empty-state">לא הצלחנו לטעון את התפריט. נסו לרענן.</p>';
    return;
  }
  cart = createCart(menu);
  renderMenu();
  refreshCartUi();
  cart.subscribe(refreshCartUi);
  $('#cartBar').addEventListener('click', openCart);

  const orderId = new URLSearchParams(location.search).get('order');
  if (orderId) {
    try {
      const { order } = await api.getOrder(orderId);
      openSuccess(order);
    } catch { /* unknown order — ignore */ }
  }
})();
