// Telegram-магазин: каталог, кошик, замовлення.
// Без збірки й залежностей: звичайний JavaScript.

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const state = {
  categories: [],
  products: [],
  activeCat: null,        // id активної категорії
  cart: {},               // { productId: кількість }
  view: "catalog",        // "catalog" | "cart" | "done"
  comment: "",
  sending: false,
  lastOrderId: null,
};

const $ = (sel) => document.querySelector(sel);

// ---------- Допоміжні функції ----------

// Захист від HTML-вставок у текстах з бази
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function money(n) {
  const v = Number(n);
  const txt = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${txt} ${CONFIG.CURRENCY}`;
}

function productById(id) {
  return state.products.find((p) => p.id === id);
}

function cartCount() {
  return Object.values(state.cart).reduce((a, b) => a + b, 0);
}

function cartTotal() {
  return Object.entries(state.cart).reduce((sum, [id, q]) => {
    const p = productById(Number(id));
    return sum + (p ? Number(p.price) * q : 0);
  }, 0);
}

function haptic(kind = "light") {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind); } catch (e) {}
}

function thumb(p, cls = "") {
  return p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`
    : esc(p.emoji || "🛍️");
}

// ---------- Дані з Supabase ----------

// Заголовки доступу до Supabase. Новий ключ (sb_publishable_…) передається
// лише в apikey, старий JWT-ключ (eyJ…) ще й в Authorization.
function supaHeaders() {
  const h = { apikey: CONFIG.SUPABASE_ANON_KEY };
  if (CONFIG.SUPABASE_ANON_KEY.startsWith("eyJ")) {
    h.Authorization = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
  }
  return h;
}

async function api(path) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, {
    headers: supaHeaders(),
  });
  if (!res.ok) throw new Error(`Помилка завантаження (${res.status})`);
  return res.json();
}

async function loadData() {
  const [cats, prods] = await Promise.all([
    api("categories?select=*&order=sort.asc,id.asc"),
    api("products?select=*&in_stock=eq.true&order=sort.asc,id.asc"),
  ]);
  state.categories = cats;
  state.products = prods;
  state.activeCat = cats.length ? cats[0].id : null;
}

// ---------- Малювання ----------

function render() {
  $("#shop-name").textContent = CONFIG.SHOP_NAME;
  $("#header").hidden = state.view !== "catalog";
  if (state.view === "catalog") renderCatalog();
  else if (state.view === "cart") renderCart();
  else renderDone();
  renderBar();
  renderBackButton();
}

function renderTabs() {
  $("#tabs").innerHTML = state.categories.map((c) => `
    <button class="tab ${c.id === state.activeCat ? "active" : ""}" data-cat="${c.id}">
      ${esc(c.emoji || "")} ${esc(c.name)}
    </button>`).join("");
}

function renderCatalog() {
  renderTabs();
  const list = state.products.filter((p) => p.category_id === state.activeCat);
  if (!list.length) {
    $("#view").innerHTML = `<div class="empty">У цій категорії поки немає товарів</div>`;
    return;
  }
  $("#view").innerHTML = `<div class="grid">${list.map((p) => `
    <article class="card">
      <div class="thumb" data-open="${p.id}">${thumb(p)}</div>
      <div class="card-body">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-short">${esc(p.short_description)}</div>
        <button class="more" data-open="${p.id}">Детальніше ›</button>
        <div class="card-foot">
          <span class="price">${money(p.price)}</span>
          <button class="add" data-add="${p.id}" aria-label="Додати в кошик">
            ${state.cart[p.id] ? "✓ " + state.cart[p.id] : "+"}
          </button>
        </div>
      </div>
    </article>`).join("")}</div>`;
}

function renderBar() {
  const bar = $("#bar");
  const btn = $("#bar-btn");
  btn.disabled = false;
  if (state.view === "catalog") {
    if (cartCount() === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    btn.textContent = `Кошик · ${cartCount()} · ${money(cartTotal())}`;
  } else if (state.view === "cart") {
    if (cartCount() === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    btn.textContent = state.sending ? "Надсилаю…" : `Замовити · ${money(cartTotal())}`;
    btn.disabled = state.sending;
  } else {
    bar.hidden = true;
  }
}

function renderCart() {
  const ids = Object.keys(state.cart).map(Number);
  if (!ids.length) {
    $("#view").innerHTML = `
      <div class="empty">Кошик порожній</div>
      <button class="ghost" data-act="back">Повернутись до каталогу</button>`;
    return;
  }
  const rows = ids.map((id) => {
    const p = productById(id);
    if (!p) return "";
    const q = state.cart[id];
    return `
      <div class="cart-row">
        <div class="cart-ico">${thumb(p)}</div>
        <div class="info">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">${money(p.price)} × ${q} = ${money(p.price * q)}</div>
        </div>
        <div class="qty">
          <button data-dec="${id}" aria-label="Менше">−</button>
          <span>${q}</span>
          <button data-inc="${id}" aria-label="Більше">+</button>
        </div>
      </div>`;
  }).join("");

  $("#view").innerHTML = `
    <h2 style="margin:12px 0 0">Ваше замовлення</h2>
    ${rows}
    <div class="total"><span>Разом</span><span>${money(cartTotal())}</span></div>
    <textarea id="comment" placeholder="Коментар до замовлення (необов'язково)">${esc(state.comment)}</textarea>
    <p class="note">Оплата не тут: після замовлення ми напишемо вам у чат,
    домовимось про оплату та доставку.</p>`;
  $("#comment").addEventListener("input", (e) => { state.comment = e.target.value; });
}

function renderDone() {
  $("#view").innerHTML = `
    <div class="center">
      <div class="big">🎉</div>
      <h2>Дякуємо за замовлення${state.lastOrderId ? " №" + state.lastOrderId : ""}!</h2>
      <p>Ми вже отримали його і скоро напишемо вам у Телеграмі, щоб узгодити оплату та доставку.</p>
      <button class="primary" style="width:100%;padding:14px" data-act="chat">💬 Написати менеджеру</button>
      <div style="height:10px"></div>
      <button class="ghost" data-act="back">Повернутись до каталогу</button>
    </div>`;
}

// ---------- Картка товару ----------

function openSheet(id) {
  const p = productById(id);
  if (!p) return;
  const q = state.cart[id] || 0;
  $("#sheet-body").innerHTML = `
    <div class="sheet-img">${thumb(p)}</div>
    <div class="sheet-content">
      <h2>${esc(p.name)}</h2>
      <div class="price" style="font-size:18px">${money(p.price)}</div>
      <div class="sheet-desc">${esc(p.description || p.short_description)}</div>
      <div class="sheet-actions">
        ${q ? `<div class="qty">
                 <button data-sdec="${id}">−</button><span>${q}</span><button data-sinc="${id}">+</button>
               </div>`
            : ""}
        <button class="primary" style="flex:1;padding:14px" data-sadd="${id}">
          ${q ? "Додано ✓ Ще одну" : "Додати в кошик"}
        </button>
      </div>
      <button class="ghost" data-act="close-sheet">Закрити</button>
    </div>`;
  $("#sheet").hidden = false;
  state.sheetId = id;
}

function closeSheet() {
  $("#sheet").hidden = true;
  state.sheetId = null;
}

// ---------- Дії з кошиком ----------

function changeQty(id, delta) {
  const next = (state.cart[id] || 0) + delta;
  if (next <= 0) delete state.cart[id];
  else state.cart[id] = Math.min(next, 20);
  haptic();
}

// ---------- Кнопка «Назад» Телеграму ----------

function renderBackButton() {
  if (!tg || !tg.BackButton) return;
  if (state.view === "cart") tg.BackButton.show();
  else tg.BackButton.hide();
}

if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    if (!$("#sheet").hidden) closeSheet();
    else { state.view = "catalog"; render(); }
  });
}

// ---------- Надсилання замовлення ----------

async function submitOrder() {
  if (state.sending || cartCount() === 0) return;

  if (!tg || !tg.initData) {
    alert("Замовлення працює лише всередині Телеграму. Відкрийте магазин через бота.");
    return;
  }

  state.sending = true;
  renderBar();
  try {
    const items = Object.entries(state.cart).map(([id, qty]) => ({ id: Number(id), qty }));
    const res = await fetch(CONFIG.ORDER_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...supaHeaders() },
      body: JSON.stringify({ initData: tg.initData, items, comment: state.comment.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Помилка ${res.status}`);

    state.lastOrderId = data.order_id;
    state.cart = {};
    state.comment = "";
    state.view = "done";
    try { tg.HapticFeedback && tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
  } catch (err) {
    const msg = "Не вдалося надіслати замовлення: " + err.message;
    if (tg && tg.showAlert) tg.showAlert(msg); else alert(msg);
  } finally {
    state.sending = false;
    render();
  }
}

// ---------- Обробка кліків (одне місце для всього) ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-open]");
  if (!t) {
    if (e.target.id === "sheet-backdrop") closeSheet();
    return;
  }
  const d = t.dataset;

  if (d.cat) { state.activeCat = Number(d.cat); render(); window.scrollTo({ top: 0 }); return; }
  if (d.open) { openSheet(Number(d.open)); return; }
  if (d.add) { changeQty(Number(d.add), +1); render(); return; }

  if (d.inc) { changeQty(Number(d.inc), +1); render(); return; }
  if (d.dec) { changeQty(Number(d.dec), -1); render(); return; }

  if (d.sadd) { changeQty(Number(d.sadd), +1); render(); openSheet(Number(d.sadd)); return; }
  if (d.sinc) { changeQty(Number(d.sinc), +1); render(); openSheet(Number(d.sinc)); return; }
  if (d.sdec) {
    changeQty(Number(d.sdec), -1); render();
    if (state.cart[Number(d.sdec)]) openSheet(Number(d.sdec)); else closeSheet();
    return;
  }

  if (d.act === "close-sheet") { closeSheet(); return; }
  if (d.act === "back") { state.view = "catalog"; render(); return; }
  if (d.act === "chat") {
    const url = `https://t.me/${CONFIG.OWNER_USERNAME}`;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank");
    return;
  }

  if (t.id === "bar-btn") {
    if (state.view === "catalog") { closeSheet(); state.view = "cart"; render(); window.scrollTo({ top: 0 }); }
    else if (state.view === "cart") submitOrder();
  }
});

// ---------- Старт ----------

(async function init() {
  $("#view").innerHTML = `<div class="empty">Завантажую каталог…</div>`;
  try {
    await loadData();
    render();
  } catch (err) {
    $("#view").innerHTML = `<div class="error">Не вдалося завантажити каталог.<br>${esc(err.message)}</div>`;
  }
})();
