/*
 * Nika & Nastya — Shared Expenses
 * Static PWA, local-first with optional Firebase Authentication + Firestore sync.
 */

const FIREBASE_CONFIG = {
  apiKey: "PASTE_FIREBASE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  appId: "PASTE_FIREBASE_APP_ID"
};

const FIREBASE_VERSION = "10.13.1";
const STORAGE_KEY = "nika_nastya_expenses_v1";
const THEME_KEY = "nika_nastya_theme_v1";
const DESIGN_KEY = "nika_nastya_design_v1";
const GROUP_ID = "shared";

const CATEGORIES = {
  food: { label: "Еда", emoji: "🍽️" },
  shopping: { label: "Покупки", emoji: "🛍️" },
  cafe: { label: "Кафе", emoji: "☕" },
  transport: { label: "Транспорт", emoji: "🚕" },
  home: { label: "Дом", emoji: "⌂" },
  pharmacy: { label: "Аптека", emoji: "＋" },
  fun: { label: "Досуг", emoji: "♡" },
  other: { label: "Другое", emoji: "···" }
};

const state = {
  expenses: [],
  settlements: [],
  settledAt: 0,
  theme: localStorage.getItem(THEME_KEY) || "light",
  design: localStorage.getItem(DESIGN_KEY) || "default",
  payer: "nika",
  category: "food",
  user: null,
  firebaseReady: false,
  firebaseError: "",
  unsubscribers: [],
  editingExpenseId: null
};

let firebaseAuth = null;
let firestore = null;
let firebaseFns = null;
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith("PASTE_") &&
    FIREBASE_CONFIG.projectId && !FIREBASE_CONFIG.projectId.startsWith("PASTE_") &&
    FIREBASE_CONFIG.appId && !FIREBASE_CONFIG.appId.startsWith("PASTE_")
  );
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value) || 0) + " ₽";
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function localISODate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function dateLabel(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T12:00:00`);
  const today = localISODate();
  const yesterday = localISODate(new Date(Date.now() - 86400000));
  if (isoDate === today) return "Сегодня";
  if (isoDate === yesterday) return "Вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function shortDate(isoDate) {
  if (!isoDate) return "";
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function readLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
    state.settlements = Array.isArray(parsed.settlements) ? parsed.settlements : [];
    state.settledAt = Number(parsed.settledAt) || 0;
  } catch (error) {
    console.warn("Не удалось прочитать локальные данные:", error);
    state.expenses = [];
    state.settlements = [];
    state.settledAt = 0;
  }
}

function writeLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      expenses: state.expenses,
      settlements: state.settlements,
      settledAt: state.settledAt
    }));
  } catch (error) {
    console.warn("Не удалось сохранить данные локально:", error);
    showToast("Не удалось сохранить данные на устройстве");
  }
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.style.colorScheme = state.theme;
  document.body?.setAttribute("data-theme", state.theme);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = state.theme === "dark" ? "#101014" : "#f5f4fa";

  const toggle = $("#theme-toggle");
  if (toggle) {
    const dark = state.theme === "dark";
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", dark ? "Включить светлую тему" : "Включить тёмную тему");
    toggle.title = dark ? "Включить светлую тему" : "Включить тёмную тему";
    toggle.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg>';
  }

  $$('[data-theme-choice]').forEach(button => {
    const selected = button.dataset.themeChoice === state.theme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  updateDesignTexts();

  try { localStorage.setItem(THEME_KEY, state.theme); }
  catch (error) { console.warn("Не удалось сохранить тему:", error); }
}

function setDesign(design) {
  state.design = ["default", "cats", "zolo"].includes(design) ? design : "default";
  document.documentElement.dataset.design = state.design;
  document.body?.setAttribute("data-design", state.design);

  $$('[data-design-choice]').forEach(button => {
    const selected = button.dataset.designChoice === state.design;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  updateDesignTexts();

  try { localStorage.setItem(DESIGN_KEY, state.design); }
  catch (error) { console.warn("Не удалось сохранить дизайн:", error); }
}

function updateDesignTexts() {
  const brandMark = $("#brand-mark");
  const brandSub = $("#brand-sub");
  const cardBrand = $("#credit-card-brand");
  const designHint = $("#design-hint");

  if (state.design === "cats") {
    const catEmoji = state.theme === "dark" ? "🐱" : "🐈‍⬛";
    if (brandMark) brandMark.textContent = catEmoji;
    if (brandSub) brandSub.textContent = state.theme === "dark" ? "белые котики в ночи" : "чёрные котики на страже";
    if (cardBrand) cardBrand.textContent = "CATS · PURR BANK";
    if (designHint) designHint.textContent = state.theme === "dark"
      ? "Сейчас включены белые котики для тёмной темы."
      : "Сейчас включены чёрные котики для светлой темы.";
  } else if (state.design === "zolo") {
    if (brandMark) brandMark.textContent = "👑";
    if (brandSub) brandSub.textContent = "официальный бюджет 2004 🎧";
    if (cardBrand) cardBrand.textContent = "IVAN ZOLO 2004 · БАОБАБ БАНК";
    if (designHint) designHint.textContent = "Стиль Ивана Золо 2004: короны, наушники и VIP-карта Баобаб.";
  } else {
    if (brandMark) brandMark.textContent = "Н·Н";
    if (brandSub) brandSub.textContent = "наш общий журнал";
    if (cardBrand) cardBrand.textContent = "N&N · SHARED CARD";
    if (designHint) designHint.textContent = "Классический чистый интерфейс без паттернов.";
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function setSyncStatus(mode, label) {
  const pill = $("#sync-pill");
  pill.classList.remove("online", "busy");
  if (mode === "online") pill.classList.add("online");
  if (mode === "busy") pill.classList.add("busy");
  $("#sync-label").textContent = label;
}

function getExpensePayments(expense) {
  if (Array.isArray(expense.payments)) {
    return expense.payments
      .map(payment => ({
        id: payment.id || `payment_${payment.createdAt || 0}`,
        amount: roundMoney(Number(payment.amount) || 0),
        payer: payment.payer === "nastya" ? "nastya" : "nika",
        date: payment.date || expense.date || "",
        createdAt: Number(payment.createdAt || expense.createdAt) || 0
      }))
      .filter(payment => payment.amount > 0);
  }
  const legacyAmount = roundMoney(Number(expense.amount) || 0);
  if (legacyAmount <= 0) return [];
  return [{
    id: `legacy_${expense.id}`,
    amount: legacyAmount,
    payer: expense.payer === "nastya" ? "nastya" : "nika",
    date: expense.date || "",
    createdAt: Number(expense.createdAt) || 0
  }];
}

function getExpensePaid(expense) {
  return roundMoney(getExpensePayments(expense).reduce((sum, payment) => sum + payment.amount, 0));
}

function getExpenseRemaining(expense) {
  return roundMoney(Math.max(0, Number(expense.amount || 0) - getExpensePaid(expense)));
}

function getActivePayments() {
  return state.expenses.flatMap(expense => getExpensePayments(expense))
    .filter(payment => Number(payment.createdAt) > state.settledAt);
}

function getActiveSettlements() {
  return state.settlements
    .filter(item => Number(item.createdAt) > state.settledAt && Number(item.amount) > 0)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

function normalizePerson(value) {
  const str = String(value || "").toLowerCase();
  if (str === "nastya" || str === "настя") return "nastya";
  return "nika";
}

function calculateBalance() {
  const payments = getActivePayments();
  const settlements = getActiveSettlements();

  const nika = roundMoney(payments.filter(p => p.payer === "nika").reduce((sum, p) => sum + p.amount, 0));
  const nastya = roundMoney(payments.filter(p => p.payer === "nastya").reduce((sum, p) => sum + p.amount, 0));
  const total = roundMoney(nika + nastya);
  const share = roundMoney(total / 2);

  // Положительный rawNet означает: Настя должна Нике
  const rawNet = roundMoney((nika - nastya) / 2);

  // Учитываем уже сделанные частичные или полные переводы между девочками
  const nastyaPaidNika = roundMoney(
    settlements.filter(s => normalizePerson(s.from) === "nastya").reduce((sum, s) => sum + Number(s.amount || 0), 0)
  );
  const nikaPaidNastya = roundMoney(
    settlements.filter(s => normalizePerson(s.from) === "nika").reduce((sum, s) => sum + Number(s.amount || 0), 0)
  );
  const transfersTotal = roundMoney(nastyaPaidNika + nikaPaidNastya);

  // Итоговый остаток долга с учётом переводов
  const net = roundMoney(rawNet - nastyaPaidNika + nikaPaidNastya);

  return { payments, settlements, nika, nastya, total, share, rawNet, net, transfersTotal };
}

function renderExpenses() {
  const list = $("#expense-list");
  const sorted = [...state.expenses].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    return dateCompare || Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  const monthPrefix = localISODate().slice(0, 7);
  const monthTotal = roundMoney(state.expenses.filter(item => String(item.date || "").startsWith(monthPrefix)).reduce((sum, item) => sum + Number(item.amount || 0), 0));
  $("#month-total").textContent = `${money(monthTotal)} за месяц`;
  $("#current-month").textContent = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).toUpperCase();

  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-symbol">＋</div><div class="empty-title">Пока нет расходов</div><div class="empty-text">Добавьте первую покупку — здесь появится ваша общая история.</div></div>`;
    return;
  }

  let lastDate = "";
  const html = [];
  for (const item of sorted) {
    const date = item.date || "";
    if (date !== lastDate) {
      html.push(`<div class="day-label">${escapeHTML(dateLabel(date))}</div>`);
      lastDate = date;
    }
    const cat = CATEGORIES[item.category] || CATEGORIES.other;
    const payments = getExpensePayments(item);
    const person = item.payer === "nastya" ? "Настя" : "Ника";
    const initial = item.payer === "nastya" ? "А" : "Н";
    const paid = getExpensePaid(item);
    const remaining = getExpenseRemaining(item);
    const paymentStatus = remaining > 0.009
      ? `<span class="expense-payment-status">Оплачено ${money(paid)} · осталось ${money(remaining)}</span>`
      : `<span class="expense-payment-status complete">Оплачено полностью</span>`;
    const payers = [...new Set(payments.map(payment => payment.payer))];
    const payerLabel = payers.length > 1 ? "Ника и Настя" : person;
    html.push(`
      <button class="expense-row" type="button" data-expense-id="${escapeHTML(item.id)}" aria-label="Открыть покупку ${escapeHTML(item.description || cat.label)}">
        <span class="avatar ${item.payer === "nastya" ? "nastya" : "nika"}">${initial}</span>
        <span class="category-icon">${cat.emoji}</span>
        <span class="expense-copy"><span class="expense-person">${payerLabel}</span><span class="expense-description">${escapeHTML(item.description || cat.label)}</span>${paymentStatus}</span>
        <span class="expense-right"><span class="expense-amount">${money(item.amount)}</span><span class="expense-date">${escapeHTML(shortDate(date))}</span></span>
      </button>`);
  }
  list.innerHTML = html.join("");
}

function updateSettleButtonLabel() {
  const calc = calculateBalance();
  const debt = Math.abs(calc.net);
  const btn = $("#settle-button");
  if (debt < 0.01) {
    btn.textContent = "✓ Рассчитались";
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const inputVal = roundMoney(Number($("#settle-amount-input").value) || 0);
  if (inputVal <= 0 || Math.abs(inputVal - debt) < 0.01) {
    btn.textContent = `✓ Погасить весь долг (${money(debt)})`;
  } else if (inputVal < debt) {
    const left = roundMoney(debt - inputVal);
    btn.textContent = `✓ Внести ${money(inputVal)} (останется ${money(left)})`;
  } else {
    btn.textContent = `✓ Перевести ${money(inputVal)} (с запасом)`;
  }
}

function renderBalance() {
  const calc = calculateBalance();
  $("#nika-total").textContent = money(calc.nika);
  $("#nastya-total").textContent = money(calc.nastya);
  $("#total-spent").textContent = money(calc.total);
  $("#each-share").textContent = money(calc.share);
  $("#transfers-total").textContent = money(calc.transfersTotal);

  const amount = Math.abs(calc.net);
  const hasDebt = amount >= 0.01;
  const customBox = $("#settle-custom-box");
  const settleInput = $("#settle-amount-input");

  if (!hasDebt) {
    $("#balance-caption").textContent = calc.total || calc.transfersTotal ? "Вы уже в балансе" : "Пока нет общих расходов";
    $("#balance-amount").textContent = calc.total || calc.transfersTotal ? "0 ₽" : "—";
    $("#balance-note").textContent = calc.total ? "Все текущие расчёты сведены поровну." : "Добавьте расходы, чтобы увидеть баланс.";
    customBox.classList.add("hidden");
    $("#settle-button").disabled = true;
    $("#settle-button").textContent = "✓ Рассчитались";
  } else {
    const debtor = calc.net > 0 ? "Настя" : "Ника";
    const creditor = calc.net > 0 ? "Нике" : "Насте";
    $("#balance-caption").textContent = `${debtor} должна ${creditor}`;
    $("#balance-amount").textContent = money(amount);
    $("#settle-payer-hint").textContent = `${debtor} переводит ${creditor} (можно любую сумму):`;
    customBox.classList.remove("hidden");

    if (document.activeElement !== settleInput) {
      settleInput.value = String(amount);
    }
    $("#balance-note").textContent = "Можно вписать любую сумму: долг уменьшится на размер перевода.";
    updateSettleButtonLabel();
  }

  $("#calc-formula").textContent = calc.total
    ? `${money(calc.total)} фактически оплачено ÷ 2 = ${money(calc.share)} на каждую.${calc.transfersTotal ? ` Учтено переводов между вами на сумму ${money(calc.transfersTotal)}.` : ""}`
    : "В баланс попадают только фактически внесённые платежи и переводы между вами.";

  // Рендерим историю переводов в текущем периоде
  const historyCard = $("#settlements-history-card");
  const historyList = $("#settlement-list");
  if (calc.settlements.length > 0) {
    historyCard.classList.remove("hidden");
    historyList.innerHTML = calc.settlements.map(item => {
      const fromName = normalizePerson(item.from) === "nastya" ? "Настя" : "Ника";
      const toName = normalizePerson(item.from) === "nastya" ? "Нике" : "Насте";
      const dateStr = item.createdAt
        ? new Date(Number(item.createdAt)).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";
      return `
        <div class="settlement-item">
          <div class="settlement-item-info">
            <div class="settlement-item-title">${fromName} → ${toName}</div>
            <div class="settlement-item-sub">${escapeHTML(dateStr)}</div>
          </div>
          <div class="settlement-item-right">
            <strong>${money(item.amount)}</strong>
            <button class="settlement-delete" type="button" data-delete-settlement="${escapeHTML(item.id)}" title="Удалить перевод" aria-label="Удалить перевод">✕</button>
          </div>
        </div>
      `;
    }).join("");
  } else {
    historyCard.classList.add("hidden");
    historyList.innerHTML = "";
  }
}

function renderAll() {
  renderExpenses();
  renderBalance();
  updateSettingsPanel();
}

function switchTab(tab) {
  const isBalance = tab === "balance";
  $("#screen-expenses").classList.toggle("active", !isBalance);
  $("#screen-balance").classList.toggle("active", isBalance);
  $$(".nav-item").forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  $("#expense-form").reset();
  $("#expense-id").value = "";
  $("#expense-date").value = localISODate();
  $("#expense-paid-now").value = "0";
  $("#expense-paid-now").disabled = false;
  $("#expense-paid-now").dataset.manual = "false";
  $("#paid-now-label").textContent = "Оплатить сейчас";
  $("#payment-explainer").textContent = "Можно внести всю сумму или только часть. Остаток останется в карточке покупки — его можно будет доплатить позже.";
  $("#expense-dialog-title").textContent = "Новый расход";
  $("#expense-save").textContent = "Добавить расход";
  $("#expense-delete").classList.add("hidden");
  $("#payment-history").classList.add("hidden");
  $("#payment-history").innerHTML = "";
  $("#expense-error").textContent = "";
  setPayer("nika");
  setCategory("food");
  updatePaymentPreview();
}

function updatePaymentPreview() {
  const total = Math.max(0, Number($("#expense-amount").value) || 0);
  const paidInput = Math.max(0, Number($("#expense-paid-now").value) || 0);
  const existing = state.editingExpenseId ? state.expenses.find(item => item.id === state.editingExpenseId) : null;
  const alreadyPaid = existing ? getExpensePaid(existing) : 0;
  const paid = Math.min(total, alreadyPaid + paidInput);
  const remaining = Math.max(0, total - paid);
  const progress = total > 0 ? Math.max(0, Math.min(100, paid / total * 100)) : 0;
  $("#card-total-preview").textContent = money(total);
  $("#card-paid-preview").textContent = money(paid);
  $("#card-remaining-preview").textContent = money(remaining);
  $("#card-progress-fill").style.width = `${progress}%`;
  const input = $("#expense-paid-now");
  input.max = String(Math.max(0, total - alreadyPaid));
  input.disabled = Boolean(existing && remaining <= 0.009);
  if (existing) {
    $("#paid-now-label").textContent = "Внести ещё один платёж";
    $("#payment-explainer").textContent = remaining > 0.009
      ? `Уже оплачено ${money(alreadyPaid)}. Можно внести ещё часть или закрыть остаток целиком.`
      : "Покупка уже оплачена полностью. Можно изменить описание или категорию.";
  } else {
    $("#paid-now-label").textContent = "Оплатить сейчас";
  }
}

function renderPaymentHistory(expense) {
  const wrap = $("#payment-history");
  const payments = getExpensePayments(expense).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  if (!payments.length) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<div class="payment-history-title">История платежей</div>${payments.map(payment => {
    const name = payment.payer === "nastya" ? "Настя" : "Ника";
    const date = payment.date ? shortDate(payment.date) : "";
    return `<div class="payment-history-row"><span>${name}${date ? ` · ${escapeHTML(date)}` : ""}</span><strong>${money(payment.amount)}</strong></div>`;
  }).join("")}`;
}

function setPayer(payer) {
  state.payer = payer;
  $$('[data-payer]').forEach(button => {
    const selected = button.dataset.payer === payer;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setCategory(category) {
  state.category = category;
  $$("[data-category]").forEach(button => button.classList.toggle("selected", button.dataset.category === category));
}

function openNewExpense() {
  resetExpenseForm();
  $("#expense-dialog").showModal();
  setTimeout(() => $("#expense-amount").focus(), 80);
}

function openEditExpense(id) {
  const item = state.expenses.find(expense => expense.id === id);
  if (!item) return;
  resetExpenseForm();
  state.editingExpenseId = item.id;
  $("#expense-dialog-title").textContent = "Покупка и оплата";
  $("#expense-save").textContent = "Сохранить";
  $("#expense-delete").classList.remove("hidden");
  $("#expense-id").value = item.id;
  $("#expense-amount").value = item.amount;
  $("#expense-paid-now").value = "0";
  $("#expense-paid-now").dataset.manual = "true";
  $("#expense-description").value = item.description || "";
  $("#expense-date").value = item.date || localISODate();
  const firstPayer = getExpensePayments(item)[0]?.payer || item.payer || "nika";
  setPayer(firstPayer);
  setCategory(CATEGORIES[item.category] ? item.category : "other");
  renderPaymentHistory(item);
  updatePaymentPreview();
  $("#expense-dialog").showModal();
}

async function saveExpense(event) {
  event.preventDefault();
  const amount = roundMoney(Number($("#expense-amount").value));
  const paidNow = roundMoney(Number($("#expense-paid-now").value || 0));
  const date = $("#expense-date").value;
  if (!Number.isFinite(amount) || amount <= 0) {
    $("#expense-error").textContent = "Введите полную стоимость покупки больше нуля.";
    return;
  }
  if (!Number.isFinite(paidNow) || paidNow < 0) {
    $("#expense-error").textContent = "Сумма платежа не может быть отрицательной.";
    return;
  }
  if (!date) {
    $("#expense-error").textContent = "Выберите дату покупки.";
    return;
  }
  const id = $("#expense-id").value || (crypto.randomUUID ? crypto.randomUUID() : `exp_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const existing = state.expenses.find(item => item.id === id);
  const payments = existing ? getExpensePayments(existing).map(payment => ({ ...payment })) : [];
  const alreadyPaid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  if (amount + 0.001 < alreadyPaid) {
    $("#expense-error").textContent = `Стоимость не может быть меньше уже оплаченных ${money(alreadyPaid)}.`;
    return;
  }
  const remaining = roundMoney(amount - alreadyPaid);
  if (paidNow > remaining + 0.001) {
    $("#expense-error").textContent = `Нельзя внести больше остатка ${money(remaining)}.`;
    return;
  }

  const timestamp = Date.now();
  if (paidNow > 0) {
    payments.push({
      id: `payment_${timestamp}_${Math.random().toString(16).slice(2, 7)}`,
      amount: paidNow,
      payer: state.payer,
      date: existing ? localISODate() : date,
      createdAt: timestamp
    });
  }
  const item = {
    id,
    amount,
    date,
    payer: existing?.payer || state.payer,
    category: state.category,
    description: $("#expense-description").value.trim(),
    payments,
    createdAt: existing ? Number(existing.createdAt) : timestamp,
    updatedAt: timestamp
  };

  try {
    if (state.user && firestore && firebaseFns) {
      setSyncStatus("busy", "Сохраняю…");
      await firebaseFns.setDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "expenses", id), item);
    } else {
      if (existing) state.expenses = state.expenses.map(row => row.id === id ? item : row);
      else state.expenses.push(item);
      writeLocal();
      renderAll();
    }
    $("#expense-dialog").close();
    showToast(existing ? (paidNow > 0 ? `Платёж ${money(paidNow)} добавлен` : "Изменения сохранены") : (paidNow < amount ? "Покупка добавлена с остатком к оплате" : "Расход добавлен"));
    if (state.user) setSyncStatus("online", "Синхронизировано");
  } catch (error) {
    console.error(error);
    $("#expense-error").textContent = "Не удалось сохранить. Проверьте подключение и права Firebase.";
    setSyncStatus("", "Ошибка синхронизации");
  }
}

async function deleteCurrentExpense() {
  const id = $("#expense-id").value;
  if (!id) return;
  if (!confirm("Удалить этот расход?")) return;
  try {
    if (state.user && firestore && firebaseFns) {
      setSyncStatus("busy", "Удаляю…");
      await firebaseFns.deleteDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "expenses", id));
    } else {
      state.expenses = state.expenses.filter(item => item.id !== id);
      writeLocal();
      renderAll();
    }
    $("#expense-dialog").close();
    showToast("Расход удалён");
    if (state.user) setSyncStatus("online", "Синхронизировано");
  } catch (error) {
    console.error(error);
    showToast("Не удалось удалить расход");
  }
}

async function settleUp() {
  const calc = calculateBalance();
  const fullDebt = Math.abs(calc.net);
  if (fullDebt < 0.01) return;

  const customAmount = roundMoney(Number($("#settle-amount-input").value));
  const payAmount = Number.isFinite(customAmount) && customAmount > 0 ? customAmount : fullDebt;

  const fromCode = calc.net > 0 ? "nastya" : "nika";
  const toCode = calc.net > 0 ? "nika" : "nastya";
  const payerName = fromCode === "nastya" ? "Настя" : "Ника";
  const receiverName = toCode === "nastya" ? "Насте" : "Нике";

  const isFull = Math.abs(payAmount - fullDebt) < 0.01;
  const confirmMsg = isFull
    ? `${payerName} переводит ${receiverName} весь долг (${money(payAmount)}). Записать перевод?`
    : `${payerName} переводит ${receiverName} ${money(payAmount)} (из ${money(fullDebt)}). Записать перевод?`;

  if (!confirm(confirmMsg)) return;

  const timestamp = Date.now();
  const settlement = {
    id: `settle_${timestamp}`,
    amount: payAmount,
    from: fromCode,
    to: toCode,
    createdAt: timestamp
  };

  try {
    if (state.user && firestore && firebaseFns) {
      setSyncStatus("busy", "Сохраняю перевод…");
      await firebaseFns.setDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "settlements", settlement.id), settlement);
    } else {
      state.settlements.push(settlement);
      writeLocal();
      renderAll();
    }
    showToast(isFull ? "Весь долг погашен!" : `Перевод ${money(payAmount)} учтён в балансе`);
    if (state.user) setSyncStatus("online", "Синхронизировано");
  } catch (error) {
    console.error(error);
    showToast("Не удалось сохранить перевод");
  }
}

async function deleteSettlement(id) {
  if (!id) return;
  if (!confirm("Отменить и удалить этот перевод?")) return;
  try {
    if (state.user && firestore && firebaseFns) {
      setSyncStatus("busy", "Удаляю перевод…");
      await firebaseFns.deleteDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "settlements", id));
    } else {
      state.settlements = state.settlements.filter(s => s.id !== id);
      writeLocal();
      renderAll();
    }
    showToast("Перевод удалён");
    if (state.user) setSyncStatus("online", "Синхронизировано");
  } catch (error) {
    console.error(error);
    showToast("Не удалось удалить перевод");
  }
}

function updateSettingsPanel() {
  const help = $("#firebase-help");
  const logout = $("#logout-button");
  const login = $("#login-button");
  if (!isFirebaseConfigured()) {
    help.innerHTML = "<strong>Локальный режим.</strong> Данные сейчас сохраняются только в этом браузере. Чтобы включить общую базу, заполните FIREBASE_CONFIG в app.js и выполните шаги из README.";
    login.disabled = true;
    logout.disabled = true;
    $("#login-email").disabled = true;
    $("#login-password").disabled = true;
    return;
  }
  $("#login-email").disabled = false;
  $("#login-password").disabled = false;
  login.disabled = Boolean(state.user);
  logout.disabled = !state.user;
  if (state.user) {
    help.innerHTML = `<strong>Подключено:</strong> ${escapeHTML(state.user.email || "аккаунт Firebase")}<br>Общие расходы синхронизируются между разрешёнными аккаунтами.`;
    login.textContent = "Подключено";
  } else {
    help.innerHTML = state.firebaseError
      ? `<strong>Firebase:</strong> ${escapeHTML(state.firebaseError)}`
      : "<strong>Firebase настроен.</strong> Войдите под одним из двух разрешённых аккаунтов.";
    login.textContent = "Подключиться";
  }
}

async function initFirebase() {
  if (!isFirebaseConfigured()) {
    setSyncStatus("", "На этом устройстве");
    return;
  }
  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = authModule.getAuth(app);
    firestore = firestoreModule.getFirestore(app);
    firebaseFns = {
      onAuthStateChanged: authModule.onAuthStateChanged,
      signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
      signOut: authModule.signOut,
      collection: firestoreModule.collection,
      doc: firestoreModule.doc,
      onSnapshot: firestoreModule.onSnapshot,
      setDoc: firestoreModule.setDoc,
      deleteDoc: firestoreModule.deleteDoc,
      writeBatch: firestoreModule.writeBatch
    };
    state.firebaseReady = true;
    firebaseFns.onAuthStateChanged(firebaseAuth, user => {
      stopCloudListeners();
      state.user = user;
      if (user) {
        attachCloudListeners();
        setSyncStatus("busy", "Подключаю…");
      } else {
        readLocal();
        renderAll();
        setSyncStatus("", "На этом устройстве");
      }
      updateSettingsPanel();
    });
  } catch (error) {
    console.error("Firebase init error:", error);
    state.firebaseError = "Не удалось подключить Firebase. Проверьте конфигурацию и доступ к сети.";
    updateSettingsPanel();
    setSyncStatus("", "Локальный режим");
  }
}

function stopCloudListeners() {
  state.unsubscribers.forEach(unsubscribe => {
    try { unsubscribe(); } catch (_) {}
  });
  state.unsubscribers = [];
}

function attachCloudListeners() {
  if (!firestore || !firebaseFns || !state.user) return;
  const expensesRef = firebaseFns.collection(firestore, "groups", GROUP_ID, "expenses");
  const settlementsRef = firebaseFns.collection(firestore, "groups", GROUP_ID, "settlements");
  const metaRef = firebaseFns.doc(firestore, "groups", GROUP_ID, "meta", "state");

  state.unsubscribers.push(firebaseFns.onSnapshot(expensesRef, snapshot => {
    state.expenses = snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
    writeLocal();
    renderAll();
    setSyncStatus("online", "Синхронизировано");
  }, error => handleCloudError(error)));

  state.unsubscribers.push(firebaseFns.onSnapshot(settlementsRef, snapshot => {
    state.settlements = snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
    writeLocal();
    renderAll();
    setSyncStatus("online", "Синхронизировано");
  }, error => handleCloudError(error)));

  state.unsubscribers.push(firebaseFns.onSnapshot(metaRef, snapshot => {
    state.settledAt = snapshot.exists() ? Number(snapshot.data().settledAt) || 0 : 0;
    writeLocal();
    renderBalance();
    setSyncStatus("online", "Синхронизировано");
  }, error => handleCloudError(error)));
}

function handleCloudError(error) {
  console.error("Firestore listener error:", error);
  state.firebaseError = error.code === "permission-denied"
    ? "Нет доступа. Проверьте адрес аккаунта в firestore.rules."
    : "Нет связи с общей базой. Проверьте интернет и настройки Firebase.";
  setSyncStatus("", "Нет синхронизации");
  updateSettingsPanel();
}

async function login(event) {
  event.preventDefault();
  if (!firebaseAuth || !firebaseFns) {
    $("#login-error").textContent = "Firebase ещё не настроен. Смотрите README.";
    return;
  }
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  $("#login-error").textContent = "";
  $("#login-button").disabled = true;
  try {
    await firebaseFns.signInWithEmailAndPassword(firebaseAuth, email, password);
    $("#login-password").value = "";
    $("#settings-dialog").close();
    showToast("Аккаунт подключён");
  } catch (error) {
    console.error(error);
    const messages = {
      "auth/invalid-credential": "Неверная почта или пароль.",
      "auth/invalid-email": "Проверьте адрес электронной почты.",
      "auth/too-many-requests": "Слишком много попыток. Попробуйте позже.",
      "auth/network-request-failed": "Нет подключения к интернету."
    };
    $("#login-error").textContent = messages[error.code] || "Не удалось войти. Проверьте аккаунт Firebase.";
  } finally {
    updateSettingsPanel();
  }
}

async function logout() {
  if (!firebaseAuth || !firebaseFns) return;
  try {
    await firebaseFns.signOut(firebaseAuth);
    $("#settings-dialog").close();
    showToast("Вы вышли из общей базы");
  } catch (error) {
    console.error(error);
    showToast("Не удалось выйти из аккаунта");
  }
}

function bindEvents() {
  $$("[data-tab]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("#add-open").addEventListener("click", openNewExpense);
  $("#theme-toggle").addEventListener("click", () => setTheme(state.theme === "light" ? "dark" : "light"));
  $("#settings-open").addEventListener("click", () => $("#settings-dialog").showModal());
  $$('[data-theme-choice]').forEach(button => button.addEventListener("click", () => setTheme(button.dataset.themeChoice)));
  $$('[data-design-choice]').forEach(button => button.addEventListener("click", () => setDesign(button.dataset.designChoice)));

  $("#settle-amount-input").addEventListener("input", updateSettleButtonLabel);
  $$("[data-settle-part]").forEach(chip => {
    chip.addEventListener("click", () => {
      const calc = calculateBalance();
      const debt = Math.abs(calc.net);
      const ratio = Number(chip.dataset.settlePart) || 1;
      $("#settle-amount-input").value = String(roundMoney(debt * ratio));
      updateSettleButtonLabel();
    });
  });

  $("#settlement-list").addEventListener("click", event => {
    const delBtn = event.target.closest("[data-delete-settlement]");
    if (delBtn) deleteSettlement(delBtn.dataset.deleteSettlement);
  });

  $("#expense-amount").addEventListener("input", () => {
    const paidInput = $("#expense-paid-now");
    if (!state.editingExpenseId && paidInput.dataset.manual !== "true") paidInput.value = $("#expense-amount").value;
    updatePaymentPreview();
  });
  $("#expense-paid-now").addEventListener("input", () => {
    $("#expense-paid-now").dataset.manual = "true";
    updatePaymentPreview();
  });
  $("#expense-form").addEventListener("submit", saveExpense);
  $("#expense-delete").addEventListener("click", deleteCurrentExpense);
  $("#settle-button").addEventListener("click", settleUp);
  $("#login-form").addEventListener("submit", login);
  $("#logout-button").addEventListener("click", logout);
  $$('[data-close]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
  $$("[data-payer]").forEach(button => button.addEventListener("click", () => setPayer(button.dataset.payer)));
  $$("[data-category]").forEach(button => button.addEventListener("click", () => setCategory(button.dataset.category)));
  $("#expense-list").addEventListener("click", event => {
    const row = event.target.closest("[data-expense-id]");
    if (row) openEditExpense(row.dataset.expenseId);
  });
  [$("#expense-dialog"), $("#settings-dialog")].forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
  } catch (error) {
    console.warn("Service Worker registration failed:", error);
  }
}

function bootstrap() {
  readLocal();
  setTheme(state.theme);
  setDesign(state.design);
  renderAll();
  bindEvents();
  initFirebase();
  window.addEventListener("load", registerServiceWorker, { once: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
else bootstrap();