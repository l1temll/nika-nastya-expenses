/*
 * Nika & Nastya — Shared Expenses
 * Static PWA, local-first with direct Firestore sync + FPI Bank Card & Marker Cats UI.
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD_Ymf72f92rerLVIZd7uGaGmn4wVNK2Lk",
  authDomain: "nika-nastya-expenses.firebaseapp.com",
  projectId: "nika-nastya-expenses",
  storageBucket: "nika-nastya-expenses.firebasestorage.app",
  messagingSenderId: "636574347794",
  appId: "1:636574347794:web:5de409c3dc2a49da0adecb",
  measurementId: "G-LQMJ31R0JR"
};

const FIREBASE_VERSION = "10.13.1";
const STORAGE_KEY = "nika_nastya_expenses_v1";
const THEME_KEY = "nika_nastya_theme_v1";
const DESIGN_KEY = "nika_nastya_design_v1";
const PATTERN_KEY = "nika_nastya_pattern_v1";
const USER_KEY = "nika_nastya_user_v1";
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
  theme: localStorage.getItem(THEME_KEY) || "dark",
  design: localStorage.getItem(DESIGN_KEY) || "cats",
  pattern: localStorage.getItem(PATTERN_KEY) || "bold",
  myUser: localStorage.getItem(USER_KEY) || "nika",
  payer: localStorage.getItem(USER_KEY) || "nika",
  category: "food",
  firebaseReady: false,
  unsubscribers: [],
  editingExpenseId: null
};

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
  } catch (_) {
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
    console.warn("Ошибка сохранения:", error);
  }
}

function isDarkLikeTheme(theme) {
  return theme === "dark" || theme === "wb";
}

function setTheme(theme) {
  const valid = ["light", "dark", "bw", "wb"];
  state.theme = valid.includes(theme) ? theme : "dark";
  const darkLike = isDarkLikeTheme(state.theme);

  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.style.colorScheme = darkLike ? "dark" : "light";
  document.body?.setAttribute("data-theme", state.theme);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = state.theme === "wb" ? "#000000" : state.theme === "bw" ? "#ffffff" : darkLike ? "#0f0f13" : "#f5f4f9";
  }

  const toggle = $("#theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(darkLike));
    toggle.innerHTML = darkLike
      ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg>';
  }

  $$('[data-theme-choice]').forEach(button => {
    button.classList.toggle("selected", button.dataset.themeChoice === state.theme);
  });

  updateDesignTexts();
  try { localStorage.setItem(THEME_KEY, state.theme); } catch (_) {}
}

function cycleThemeQuick() {
  if (state.theme === "bw") return setTheme("wb");
  if (state.theme === "wb") return setTheme("bw");
  setTheme(state.theme === "light" ? "dark" : "light");
}

function setDesign(design) {
  state.design = ["default", "cats", "zolo"].includes(design) ? design : "cats";
  document.documentElement.dataset.design = state.design;
  document.body?.setAttribute("data-design", state.design);

  $$('[data-design-choice]').forEach(button => {
    button.classList.toggle("selected", button.dataset.designChoice === state.design);
  });

  updateDesignTexts();
  try { localStorage.setItem(DESIGN_KEY, state.design); } catch (_) {}
}

function setPatternDensity(mode) {
  state.pattern = mode === "soft" ? "soft" : "bold";
  document.documentElement.dataset.pattern = state.pattern;
  $$('[data-pattern-choice]').forEach(button => {
    button.classList.toggle("selected", button.dataset.patternChoice === state.pattern);
  });
  try { localStorage.setItem(PATTERN_KEY, state.pattern); } catch (_) {}
}

function setMyUser(user) {
  state.myUser = user === "nastya" ? "nastya" : "nika";
  state.payer = state.myUser;
  $$('[data-my-user]').forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.myUser === state.myUser);
  });
  setPayer(state.payer);
  try { localStorage.setItem(USER_KEY, state.myUser); } catch (_) {}
}

function updateDesignTexts() {
  const brandMark = $("#brand-mark");
  const brandSub = $("#brand-sub");
  const cardBrand = $("#credit-card-brand");
  const designHint = $("#design-hint");
  const darkLike = isDarkLikeTheme(state.theme);

  if (state.design === "cats") {
    if (brandMark) brandMark.textContent = darkLike ? "🐱" : "🐈‍⬛";
    if (brandSub) brandSub.textContent = darkLike ? "белые маркерные котики" : "чёрные маркерные котики";
    if (cardBrand) cardBrand.textContent = "ФПИ БАНК · CATS EDITION";
    if (designHint) designHint.textContent = darkLike
      ? "Белые маркерные котики на тёмном/БЧ фоне."
      : "Чёрные маркерные котики на светлом/ЧБ фоне.";
  } else if (state.design === "zolo") {
    if (brandMark) brandMark.textContent = "👑";
    if (brandSub) brandSub.textContent = "официальный бюджет 2004 🎧";
    if (cardBrand) cardBrand.textContent = "ФПИ БАНК · ZOLO 2004";
    if (designHint) designHint.textContent = "Стиль Ивана Золо 2004 + карта ФПИ Банка.";
  } else {
    if (brandMark) brandMark.textContent = "Н·Н";
    if (brandSub) brandSub.textContent = "наш общий журнал";
    if (cardBrand) cardBrand.textContent = "ФПИ БАНК · SHARED CARD";
    if (designHint) designHint.textContent = "Чистый фон без узоров.";
  }
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function setSyncStatus(mode, label) {
  const pill = $("#sync-pill");
  const lbl = $("#sync-label");
  if (pill) {
    pill.classList.remove("online", "busy");
    if (mode === "online") pill.classList.add("online");
    if (mode === "busy") pill.classList.add("busy");
  }
  if (lbl) lbl.textContent = label;
}

function getExpensePayments(expense) {
  if (Array.isArray(expense.payments)) {
    return expense.payments
      .map(p => ({
        id: p.id || `payment_${p.createdAt || 0}`,
        amount: roundMoney(Number(p.amount) || 0),
        payer: p.payer === "nastya" ? "nastya" : "nika",
        date: p.date || expense.date || "",
        createdAt: Number(p.createdAt || expense.createdAt) || 0
      }))
      .filter(p => p.amount > 0);
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
  return roundMoney(getExpensePayments(expense).reduce((sum, p) => sum + p.amount, 0));
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
  return (str === "nastya" || str === "настя") ? "nastya" : "nika";
}

function calculateBalance() {
  const payments = getActivePayments();
  const settlements = getActiveSettlements();

  const nika = roundMoney(payments.filter(p => p.payer === "nika").reduce((sum, p) => sum + p.amount, 0));
  const nastya = roundMoney(payments.filter(p => p.payer === "nastya").reduce((sum, p) => sum + p.amount, 0));
  const total = roundMoney(nika + nastya);
  const share = roundMoney(total / 2);
  const rawNet = roundMoney((nika - nastya) / 2);

  const nastyaPaidNika = roundMoney(
    settlements.filter(s => normalizePerson(s.from) === "nastya").reduce((sum, s) => sum + Number(s.amount || 0), 0)
  );
  const nikaPaidNastya = roundMoney(
    settlements.filter(s => normalizePerson(s.from) === "nika").reduce((sum, s) => sum + Number(s.amount || 0), 0)
  );
  const transfersTotal = roundMoney(nastyaPaidNika + nikaPaidNastya);
  const net = roundMoney(rawNet - nastyaPaidNika + nikaPaidNastya);

  return { payments, settlements, nika, nastya, total, share, net, transfersTotal };
}

function renderExpenses() {
  const list = $("#expense-list");
  if (!list) return;

  const sorted = [...state.expenses].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    return dateCompare || Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  const monthPrefix = localISODate().slice(0, 7);
  const monthTotal = roundMoney(state.expenses.filter(item => String(item.date || "").startsWith(monthPrefix)).reduce((sum, item) => sum + Number(item.amount || 0), 0));

  const monthTotalEl = $("#month-total");
  const currentMonthEl = $("#current-month");
  if (monthTotalEl) monthTotalEl.textContent = `${money(monthTotal)} за месяц`;
  if (currentMonthEl) currentMonthEl.textContent = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).toUpperCase();

  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-symbol">＋</div><div class="empty-title">Пока нет расходов</div><div class="empty-text">Добавьте первую покупку — здесь появится ваша общая история.</div></div>`;
    return;
  }

  let lastDate = "";
  const html = [];
  let idx = 0;
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
    const payers = [...new Set(payments.map(p => p.payer))];
    const payerLabel = payers.length > 1 ? "Ника и Настя" : person;
    const delayIdx = Math.min(idx++, 12);
    html.push(`
      <button class="expense-row" style="--i:${delayIdx}" type="button" data-expense-id="${escapeHTML(item.id)}" aria-label="Открыть покупку">
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
  if (!btn) return;
  if (debt < 0.01) {
    btn.textContent = "✓ Рассчитались";
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const inputEl = $("#settle-amount-input");
  const inputVal = inputEl ? roundMoney(Number(inputEl.value) || 0) : 0;
  if (inputVal <= 0 || Math.abs(inputVal - debt) < 0.01) {
    btn.textContent = `✓ Погасить весь долг (${money(debt)})`;
  } else if (inputVal < debt) {
    btn.textContent = `✓ Внести ${money(inputVal)} (останется ${money(debt - inputVal)})`;
  } else {
    btn.textContent = `✓ Перевести ${money(inputVal)} (с запасом)`;
  }
}

function renderBalance() {
  const calc = calculateBalance();
  const nikaEl = $("#nika-total");
  const nastyaEl = $("#nastya-total");
  const totalEl = $("#total-spent");
  const shareEl = $("#each-share");
  const transfersEl = $("#transfers-total");

  if (nikaEl) nikaEl.textContent = money(calc.nika);
  if (nastyaEl) nastyaEl.textContent = money(calc.nastya);
  if (totalEl) totalEl.textContent = money(calc.total);
  if (shareEl) shareEl.textContent = money(calc.share);
  if (transfersEl) transfersEl.textContent = money(calc.transfersTotal);

  const amount = Math.abs(calc.net);
  const hasDebt = amount >= 0.01;
  const customBox = $("#settle-custom-box");
  const settleInput = $("#settle-amount-input");
  const captionEl = $("#balance-caption");
  const amountEl = $("#balance-amount");
  const noteEl = $("#balance-note");
  const settleBtn = $("#settle-button");

  if (!hasDebt) {
    if (captionEl) captionEl.textContent = calc.total || calc.transfersTotal ? "Вы уже в балансе" : "Пока нет общих расходов";
    if (amountEl) amountEl.textContent = calc.total || calc.transfersTotal ? "0 ₽" : "—";
    if (noteEl) noteEl.textContent = calc.total ? "Все текущие расчёты по карте ФПИ Банка сведены поровну." : "Добавьте расходы, чтобы увидеть баланс.";
    if (customBox) customBox.classList.add("hidden");
    if (settleBtn) {
      settleBtn.disabled = true;
      settleBtn.textContent = "✓ Рассчитались";
    }
  } else {
    const debtor = calc.net > 0 ? "Настя" : "Ника";
    const creditor = calc.net > 0 ? "Нике" : "Насте";
    if (captionEl) captionEl.textContent = `${debtor} должна ${creditor}`;
    if (amountEl) amountEl.textContent = money(amount);
    const hintEl = $("#settle-payer-hint");
    if (hintEl) hintEl.textContent = `${debtor} переводит ${creditor} (можно любую сумму):`;
    if (customBox) customBox.classList.remove("hidden");

    if (settleInput && document.activeElement !== settleInput) {
      settleInput.value = String(amount);
    }
    if (noteEl) noteEl.textContent = "Можно вписать любую сумму: долг уменьшится на размер перевода.";
    updateSettleButtonLabel();
  }

  const formulaEl = $("#calc-formula");
  if (formulaEl) {
    formulaEl.textContent = calc.total
      ? `${money(calc.total)} фактически оплачено ÷ 2 = ${money(calc.share)} на каждую.${calc.transfersTotal ? ` Учтено переводов между вами на сумму ${money(calc.transfersTotal)}.` : ""}`
      : "В баланс попадают только фактически внесённые платежи и переводы между вами.";
  }

  const historyCard = $("#settlements-history-card");
  const historyList = $("#settlement-list");
  if (historyCard && historyList) {
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
          </div>`;
      }).join("");
    } else {
      historyCard.classList.add("hidden");
      historyList.innerHTML = "";
    }
  }
}

function renderAll() {
  renderExpenses();
  renderBalance();
}

function switchTab(tab) {
  const isBalance = tab === "balance";
  $("#screen-expenses")?.classList.toggle("active", !isBalance);
  $("#screen-balance")?.classList.toggle("active", isBalance);
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
  const form = $("#expense-form");
  if (form) form.reset();
  const idEl = $("#expense-id");
  const dateEl = $("#expense-date");
  const paidNowEl = $("#expense-paid-now");
  if (idEl) idEl.value = "";
  if (dateEl) dateEl.value = localISODate();
  if (paidNowEl) {
    paidNowEl.value = "0";
    paidNowEl.disabled = false;
    paidNowEl.dataset.manual = "false";
  }
  const titleEl = $("#expense-dialog-title");
  const saveEl = $("#expense-save");
  const delEl = $("#expense-delete");
  const histEl = $("#payment-history");
  const errEl = $("#expense-error");

  if (titleEl) titleEl.textContent = "Новый расход";
  if (saveEl) saveEl.textContent = "Добавить расход";
  if (delEl) delEl.classList.add("hidden");
  if (histEl) {
    histEl.classList.add("hidden");
    histEl.innerHTML = "";
  }
  if (errEl) errEl.textContent = "";

  setPayer(state.myUser);
  setCategory("food");
  updatePaymentPreview();
}

function updatePaymentPreview() {
  const amountEl = $("#expense-amount");
  const paidInput = $("#expense-paid-now");
  const total = Math.max(0, Number(amountEl?.value) || 0);
  const paidNow = Math.max(0, Number(paidInput?.value) || 0);
  const existing = state.editingExpenseId ? state.expenses.find(item => item.id === state.editingExpenseId) : null;
  const alreadyPaid = existing ? getExpensePaid(existing) : 0;
  const paid = Math.min(total, alreadyPaid + paidNow);
  const remaining = Math.max(0, total - paid);
  const progress = total > 0 ? Math.max(0, Math.min(100, paid / total * 100)) : 0;

  const cardTotal = $("#card-total-preview");
  const cardPaid = $("#card-paid-preview");
  const cardRemaining = $("#card-remaining-preview");
  const cardProgress = $("#card-progress-fill");

  if (cardTotal) cardTotal.textContent = money(total);
  if (cardPaid) cardPaid.textContent = money(paid);
  if (cardRemaining) cardRemaining.textContent = money(remaining);
  if (cardProgress) cardProgress.style.width = `${progress}%`;

  if (paidInput) {
    paidInput.max = String(Math.max(0, total - alreadyPaid));
    paidInput.disabled = Boolean(existing && remaining <= 0.009);
  }
}

function renderPaymentHistory(expense) {
  const wrap = $("#payment-history");
  if (!wrap) return;
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
    button.classList.toggle("selected", button.dataset.payer === payer);
  });
}

function setCategory(category) {
  state.category = category;
  $$("[data-category]").forEach(button => button.classList.toggle("selected", button.dataset.category === category));
}

function openNewExpense() {
  resetExpenseForm();
  $("#expense-dialog")?.showModal();
  setTimeout(() => $("#expense-amount")?.focus(), 80);
}

function openEditExpense(id) {
  const item = state.expenses.find(expense => expense.id === id);
  if (!item) return;
  resetExpenseForm();
  state.editingExpenseId = item.id;
  $("#expense-dialog-title").textContent = "Покупка и оплата";
  $("#expense-save").textContent = "Сохранить";
  $("#expense-delete")?.classList.remove("hidden");
  $("#expense-id").value = item.id;
  $("#expense-amount").value = item.amount;
  $("#expense-paid-now").value = "0";
  $("#expense-description").value = item.description || "";
  $("#expense-date").value = item.date || localISODate();
  const firstPayer = getExpensePayments(item)[0]?.payer || item.payer || "nika";
  setPayer(firstPayer);
  setCategory(CATEGORIES[item.category] ? item.category : "other");
  renderPaymentHistory(item);
  updatePaymentPreview();
  $("#expense-dialog")?.showModal();
}

async function saveExpense(event) {
  event.preventDefault();
  const amount = roundMoney(Number($("#expense-amount")?.value));
  const paidNow = roundMoney(Number($("#expense-paid-now")?.value || 0));
  const date = $("#expense-date")?.value;
  const errEl = $("#expense-error");

  if (!Number.isFinite(amount) || amount <= 0) {
    if (errEl) errEl.textContent = "Введите полную стоимость покупки больше нуля.";
    return;
  }
  if (!date) {
    if (errEl) errEl.textContent = "Выберите дату покупки.";
    return;
  }
  const id = $("#expense-id")?.value || (crypto.randomUUID ? crypto.randomUUID() : `exp_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const existing = state.expenses.find(item => item.id === id);
  const payments = existing ? getExpensePayments(existing).map(p => ({ ...p })) : [];
  const alreadyPaid = roundMoney(payments.reduce((sum, p) => sum + p.amount, 0));

  if (amount + 0.001 < alreadyPaid) {
    if (errEl) errEl.textContent = `Стоимость не может быть меньше уже оплаченных ${money(alreadyPaid)}.`;
    return;
  }
  const remaining = roundMoney(amount - alreadyPaid);
  if (paidNow > remaining + 0.001) {
    if (errEl) errEl.textContent = `Нельзя внести больше остатка ${money(remaining)}.`;
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
    description: ($("#expense-description")?.value || "").trim(),
    payments,
    createdAt: existing ? Number(existing.createdAt) : timestamp,
    updatedAt: timestamp
  };

  try {
    if (firestore && firebaseFns) {
      setSyncStatus("busy", "Сохраняю…");
      await firebaseFns.setDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "expenses", id), item);
    } else {
      if (existing) state.expenses = state.expenses.map(row => row.id === id ? item : row);
      else state.expenses.push(item);
      writeLocal();
      renderAll();
    }
    $("#expense-dialog")?.close();
    showToast(existing ? (paidNow > 0 ? `Платёж ${money(paidNow)} добавлен` : "Изменения сохранены") : "Расход добавлен");
    setSyncStatus("online", "Синхронизировано");
  } catch (error) {
    console.error(error);
    if (errEl) errEl.textContent = "Не удалось сохранить. Проверьте права Firestore.";
  }
}

async function deleteCurrentExpense() {
  const id = $("#expense-id")?.value;
  if (!id) return;
  if (!confirm("Удалить этот расход?")) return;
  try {
    if (firestore && firebaseFns) {
      setSyncStatus("busy", "Удаляю…");
      await firebaseFns.deleteDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "expenses", id));
    } else {
      state.expenses = state.expenses.filter(item => item.id !== id);
      writeLocal();
      renderAll();
    }
    $("#expense-dialog")?.close();
    showToast("Расход удалён");
    setSyncStatus("online", "Синхронизировано");
  } catch (_) {
    showToast("Не удалось удалить расход");
  }
}

async function settleUp() {
  const calc = calculateBalance();
  const fullDebt = Math.abs(calc.net);
  if (fullDebt < 0.01) return;

  const customAmount = roundMoney(Number($("#settle-amount-input")?.value));
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
    if (firestore && firebaseFns) {
      setSyncStatus("busy", "Сохраняю перевод…");
      await firebaseFns.setDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "settlements", settlement.id), settlement);
    } else {
      state.settlements.push(settlement);
      writeLocal();
      renderAll();
    }
    showToast(isFull ? "Весь долг погашен!" : `Перевод ${money(payAmount)} учтён в балансе`);
    setSyncStatus("online", "Синхронизировано");
  } catch (_) {
    showToast("Не удалось сохранить перевод");
  }
}

async function deleteSettlement(id) {
  if (!id) return;
  if (!confirm("Отменить и удалить этот перевод?")) return;
  try {
    if (firestore && firebaseFns) {
      setSyncStatus("busy", "Удаляю перевод…");
      await firebaseFns.deleteDoc(firebaseFns.doc(firestore, "groups", GROUP_ID, "settlements", id));
    } else {
      state.settlements = state.settlements.filter(s => s.id !== id);
      writeLocal();
      renderAll();
    }
    showToast("Перевод удалён");
    setSyncStatus("online", "Синхронизировано");
  } catch (_) {
    showToast("Не удалось удалить перевод");
  }
}

async function initFirebase() {
  const helpEl = $("#firebase-help");
  if (!isFirebaseConfigured()) {
    setSyncStatus("", "На этом устройстве");
    if (helpEl) helpEl.innerHTML = "<strong>Локальный режим:</strong> проверьте FIREBASE_CONFIG в app.js.";
    return;
  }
  try {
    const [appModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(FIREBASE_CONFIG);
    firestore = firestoreModule.getFirestore(app);
    firebaseFns = {
      collection: firestoreModule.collection,
      doc: firestoreModule.doc,
      onSnapshot: firestoreModule.onSnapshot,
      setDoc: firestoreModule.setDoc,
      deleteDoc: firestoreModule.deleteDoc
    };
    state.firebaseReady = true;
    attachCloudListeners();
    setSyncStatus("online", "Синхронизировано");
    if (helpEl) helpEl.innerHTML = "<strong>ФПИ Банк Облако подключено:</strong> все расходы и переводы мгновенно синхронизируются между Никой и Настей.";
  } catch (error) {
    console.error("Firebase init error:", error);
    setSyncStatus("", "Ошибка связи");
    if (helpEl) helpEl.innerHTML = "<strong>Ошибка:</strong> проверьте подключение к интернету и Rules в Firestore.";
  }
}

function attachCloudListeners() {
  if (!firestore || !firebaseFns) return;
  const expensesRef = firebaseFns.collection(firestore, "groups", GROUP_ID, "expenses");
  const settlementsRef = firebaseFns.collection(firestore, "groups", GROUP_ID, "settlements");

  state.unsubscribers.push(firebaseFns.onSnapshot(expensesRef, snapshot => {
    state.expenses = snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
    writeLocal();
    renderAll();
    setSyncStatus("online", "Синхронизировано");
  }, () => setSyncStatus("", "Проверьте Rules")));

  state.unsubscribers.push(firebaseFns.onSnapshot(settlementsRef, snapshot => {
    state.settlements = snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id }));
    writeLocal();
    renderAll();
    setSyncStatus("online", "Синхронизировано");
  }, () => setSyncStatus("", "Проверьте Rules")));
}

function bindEvents() {
  $$("[data-tab]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("#add-open")?.addEventListener("click", openNewExpense);
  $("#theme-toggle")?.addEventListener("click", cycleThemeQuick);
  $("#settings-open")?.addEventListener("click", () => $("#settings-dialog")?.showModal());
  $$('[data-theme-choice]').forEach(button => button.addEventListener("click", () => setTheme(button.dataset.themeChoice)));
  $$('[data-design-choice]').forEach(button => button.addEventListener("click", () => setDesign(button.dataset.designChoice)));
  $$('[data-pattern-choice]').forEach(button => button.addEventListener("click", () => setPatternDensity(button.dataset.patternChoice)));
  $$('[data-my-user]').forEach(button => button.addEventListener("click", () => setMyUser(button.dataset.myUser)));

  $("#settle-amount-input")?.addEventListener("input", updateSettleButtonLabel);
  $$("[data-settle-part]").forEach(chip => {
    chip.addEventListener("click", () => {
      const calc = calculateBalance();
      const debt = Math.abs(calc.net);
      const ratio = Number(chip.dataset.settlePart) || 1;
      const inp = $("#settle-amount-input");
      if (inp) {
        inp.value = String(roundMoney(debt * ratio));
        updateSettleButtonLabel();
      }
    });
  });

  $("#settlement-list")?.addEventListener("click", event => {
    const delBtn = event.target.closest("[data-delete-settlement]");
    if (delBtn) deleteSettlement(delBtn.dataset.deleteSettlement);
  });

  $("#expense-amount")?.addEventListener("input", () => {
    const paidInput = $("#expense-paid-now");
    if (!state.editingExpenseId && paidInput && paidInput.dataset.manual !== "true") {
      paidInput.value = $("#expense-amount")?.value || "";
    }
    updatePaymentPreview();
  });
  $("#expense-paid-now")?.addEventListener("input", () => {
    const p = $("#expense-paid-now");
    if (p) p.dataset.manual = "true";
    updatePaymentPreview();
  });
  $("#expense-form")?.addEventListener("submit", saveExpense);
  $("#expense-delete")?.addEventListener("click", deleteCurrentExpense);
  $("#settle-button")?.addEventListener("click", settleUp);
  $$('[data-close]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.close}`)?.close()));
  $$("[data-payer]").forEach(button => button.addEventListener("click", () => setPayer(button.dataset.payer)));
  $$("[data-category]").forEach(button => button.addEventListener("click", () => setCategory(button.dataset.category)));
  $("#expense-list")?.addEventListener("click", event => {
    const row = event.target.closest("[data-expense-id]");
    if (row) openEditExpense(row.dataset.expenseId);
  });
  [$("#expense-dialog"), $("#settings-dialog")].forEach(dialog => {
    dialog?.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function bootstrap() {
  readLocal();
  setTheme(state.theme);
  setDesign(state.design);
  setPatternDensity(state.pattern);
  setMyUser(state.myUser);
  renderAll();
  bindEvents();
  initFirebase();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
    }, { once: true });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
else bootstrap();
