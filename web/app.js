// SPDX-License-Identifier: AGPL-3.0-or-later
// All user-visible strings go through __() / N_() from i18n.js (English source strings).
"use strict";
const $ = (s) => document.querySelector(s);
const state = { me: null, data: null, dashboard: null, general: null, about: null, customizing: false, dashDraft: null, dashSel: null, txnType: "expense", editingTxn: null, filter: { q: "", account: "", type: "", tag: "" }, period: null, dayOpen: {}, dismissed: [], notifOpen: false };
// Money is stored in minor units at each currency's ISO 4217 precision (JPY 0, USD 2, KWD 3…).
const EXP = {};
const expOf = (c) => {
  if (!(c in EXP)) {
    try { EXP[c] = new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits; } catch (e) { EXP[c] = 2; }
  }
  return EXP[c];
};
// Currencies whose minor unit exists only on paper: shown without decimals unless an amount has a fraction.
const WHOLE_UNITS = { TWD: true, HUF: true };
// digits to show for an amount: whole-unit currencies drop ".00", but never hide a real fraction;
// calculated figures (per day, averages, forecasts) always show the full precision.
function shownDigits(minor, c, calc) {
  const e = expOf(c);
  if (calc || !WHOLE_UNITS[c]) return e;
  return Math.round(minor || 0) % Math.pow(10, e) === 0 ? 0 : e;
}
const defCur = () => (state.general && state.general.defaultCurrency) || "TWD";
const OPEN_DAY_CHOICES = [1, 3, 7, 14, 30];
const openDays = () => (state.general && state.general.openDays) || 7;
const WIDTH_L = { default: N_("Default"), wide: N_("Wide"), full: N_("Full width") };
const pageWidth = () => (state.general && WIDTH_L[state.general.pageWidth] ? state.general.pageWidth : "default");
const applyPageWidth = () => { document.documentElement.dataset.width = pageWidth(); };
// The default currency is always in the frequently used list, first.
const favCurs = () => { const d = defCur(), l = (state.general && state.general.currencies) || []; return [d, ...l.filter((c) => c !== d)]; };
const ALL_CURRENCIES = (() => { try { return Intl.supportedValuesOf("currency"); } catch (e) { return []; } })();
const curNames = {};
const curName = (c) => {
  try { curNames[LANG] = curNames[LANG] || new Intl.DisplayNames([LANG], { type: "currency" }); return curNames[LANG].of(c); } catch (e) { return c; }
};
const curOption = (c, sel) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(c)} — ${esc(curName(c))}</option>`;
// Top group: the frequently used list (Settings), then currencies your accounts and tags already
// use, then the current value; below it every other ISO 4217 code under "All currencies".
function currencyOptions(selected) {
  const sel = selected || defCur(), d = state.data;
  const inUse = d ? [...d.accounts.map((a) => a.currency), ...d.tags.map((t) => t.currency)] : [];
  const top = [...new Set([...favCurs(), ...inUse, sel].filter(Boolean))];
  const rest = ALL_CURRENCIES.filter((c) => !top.includes(c));
  return `<optgroup label="${esc(__("Frequently used"))}">${top.map((c) => curOption(c, sel)).join("")}</optgroup>`
    + (rest.length ? `<optgroup label="${esc(__("All currencies"))}">${rest.map((c) => curOption(c, sel)).join("")}</optgroup>` : "");
}
const toMinor = (a, c) => Math.round(parseFloat(a || 0) * Math.pow(10, expOf(c)));
// How amounts are written (Settings → Number format): grouped by thousands "1,074,958",
// by ten-thousands as East Asian numbers are read "107,4958", or plain "1074958".
const NUMFMT_L = { grouped: N_("Groups of three (1,074,958)"), four: N_("Groups of four (107,4958)"), plain: N_("Plain (1074958)") };
const numberFormat = () => (state.general && state.general.numberFormat) || "grouped";
function writeInt(n) {
  switch (numberFormat()) {
    case "plain": return String(n);
    case "four": return String(n).replace(/\B(?=(\d{4})+(?!\d))/g, ",");
    default: return n.toLocaleString(LANG);
  }
}
// fmt(minor, currency, calc): "TWD 1,580" / "USD 12.50"; calc = a calculated figure, shown at full precision.
// Built from integer minor units, so no floating point touches the digits.
function fmt(minor, currency, calc = false) {
  const c = currency || defCur(), e = expOf(c), d = shownDigits(minor, c, calc);
  const m = Math.round(minor || 0), abs = Math.abs(m), unit = Math.pow(10, e);
  return (currency || "") + " " + (m < 0 ? "-" : "") + writeInt(Math.floor(abs / unit)) + (d ? "." + String(abs % unit).padStart(e, "0") : "");
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// msg shows a short toast at the bottom of the page; errors stay longer and can be clicked away.
let toastTimer = 0;
function msg(t, kind) {
  const el = $("#toast");
  clearTimeout(toastTimer);
  if (!t) { el.classList.remove("show"); return; }
  el.textContent = t;
  el.className = "toast" + (kind === "error" ? " error" : "");
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  void el.offsetWidth; // restart the entrance transition when one toast replaces another
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), kind === "error" ? 7000 : 3000);
}
const errMsg = (e) => msg(__("Error: {message}", { message: e.message }), "error");
$("#toast").addEventListener("click", () => msg(""));
// "/api/x" → "api/x": relative to the page, so the app also works under a
// path prefix such as https://example.org/kisiauthong/ (KISIAUTHONG_BASE_PATH)
const rel = (path) => (path.startsWith("/") ? path.slice(1) : path);
async function api(path, opts) {
  const r = await fetch(rel(path), opts);
  const d = await r.json().catch(() => ({}));
  // the session ended (signed out elsewhere, expired): back to the sign-in screen
  if (r.status === 401 && !path.startsWith("/api/auth/")) { showAuth("login"); throw new Error(__("Please sign in again.")); }
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const put = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
// an amount for a form field: "1500" for TWD 1,500, "12.50" for USD
const decimal = (minor, currency) => { const c = currency || defCur(); return ((minor || 0) / Math.pow(10, expOf(c))).toFixed(shownDigits(minor, c, false)); };
// state.data.accounts holds the user's own accounts; externals (kind "external") are kept apart.
const EXT_ID = "acc-external"; // the anonymous external account (ADR 0002)
const accById = (id) => (state.data.allAccounts || state.data.accounts).find((a) => a.id === id);
const accName = (id) => { const a = accById(id); if (!a) return "—"; return a.id === EXT_ID && a.name === "External" ? __("External") : a.name; };
const accCur = (id) => (accById(id) || {}).currency || defCur();
const isExt = (id) => { const a = accById(id); return !!a && a.kind === "external"; };
// flow: what a record means to the user. Only transfer and allocate are stored;
// a transfer to an external account is spending, one from an external account is income.
function flow(t) {
  if (t.type !== "transfer") return t.type;
  const f = isExt(t.fromAccountId), to = isExt(t.toAccountId);
  return to && !f ? "expense" : f && !to ? "income" : "transfer";
}
const ownAcc = (t) => { const k = flow(t); return k === "expense" ? t.fromAccountId : k === "income" ? t.toAccountId : t.accountId; };
const extAcc = (t) => { const k = flow(t); return k === "expense" ? t.toAccountId : k === "income" ? t.fromAccountId : ""; };
const namedExt = (t) => { const e = extAcc(t); return e && e !== EXT_ID ? e : ""; };
const tagName = (id) => (state.data.tags.find((t) => t.id === id) || {}).name || "—";
const signed = (t) => { const k = flow(t); return k === "income" ? "+" : k === "expense" ? "−" : ""; };
const barCls = (p) => p >= 100 ? "over" : p >= 80 ? "warn" : "";
function table(headers, rows) {
  return `<div style="overflow-x:auto"><table><thead><tr>${headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(__(h.t))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function row(cells) {
  return "<tr>" + cells.map((c) => `<td data-label="${esc(__(c.l))}" class="${c.num ? "num" : ""}">${c.v}</td>`).join("") + "</tr>";
}

/* ---------- display labels for stored enum values ---------- */
const TYPE_L = { expense: N_("Expense"), income: N_("Income"), transfer: N_("Transfer"), allocate: N_("Allocate") };
const TAGKIND_L = { category: N_("Category"), goal: N_("Money box") };
// Budget periods (ADR 0004): unit × every N, anchored on cycleStart; "range" is one fixed period.
const CYCLE_EVERY_L = { daily: N_("Every {n} days"), weekly: N_("Every {n} weeks"), monthly: N_("Every {n} months"), yearly: N_("Every {n} years") };
const CYCLE_UNIT_L = { daily: N_("days"), weekly: N_("weeks"), monthly: N_("months"), yearly: N_("years") };
const BUDGET_PRESETS = [["daily", 1], ["weekly", 1], ["weekly", 2], ["weekly", 3], ["monthly", 1], ["monthly", 2], ["monthly", 3], ["monthly", 6], ["yearly", 1]];
function cycleName(cycle, every) {
  if (cycle === "range") return __("Date range");
  return every > 1 ? __(CYCLE_EVERY_L[cycle], { n: every }) : lbl(FREQ_L, cycle || "monthly");
}
// "Monthly · Nov 1 – 30, 2026": how a budget repeats and the period it is in now
const budgetPeriodText = (t) => (t.cycle === "range" ? "" : cycleName(t.cycle, t.cycleEvery) + " · ") + periodLabel({ start: t.periodStart, end: t.periodEnd });
const FREQ_L = { never: N_("Never"), daily: N_("Daily"), weekly: N_("Weekly"), monthly: N_("Monthly"), quarterly: N_("Quarterly"), yearly: N_("Yearly") };
const lbl = (map, x) => __(map[x] || x);
const enumOptions = (map, keys, sel) => keys.map((k) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(lbl(map, k))}</option>`).join("");
const txnTitle = (t) => t.note || lbl(TYPE_L, flow(t));
// transferAcct: the accounts involved, naming an external side only when it is not the anonymous one
const transferAcct = (t) => {
  const k = flow(t), n = namedExt(t);
  if (k === "expense") return accName(t.fromAccountId) + (n ? " → " + accName(n) : "");
  if (k === "income") return (n ? accName(n) + " → " : "") + accName(t.toAccountId);
  if (k === "transfer") return accName(t.fromAccountId) + " → " + accName(t.toAccountId);
  return accName(t.accountId);
};

/* ---------- screens ---------- */
const DASH_WIDGETS = [
  { id: "balances", label: N_("Balances by currency"), pick: "currencies" },
  { id: "budgets", label: N_("Budgets"), pick: "budgets" },
  { id: "spending", label: N_("Spending this month"), rows: 8 },
  { id: "moneyboxes", label: N_("Money boxes"), pick: "goals" },
  { id: "accounts", label: N_("Accounts"), pick: "accounts" },
  { id: "recent", label: N_("Recent transactions"), rows: 6 },
];
// The dashboard is a list of widgets, top to bottom. A widget type can be used any number of
// times, each copy with its own options: { id, type, size?, title?, rows?, include? }.
const DASH_DEFAULT = { items: DASH_WIDGETS.map((w) => ({ id: w.id, type: w.id })) };
const widgetDef = (type) => DASH_WIDGETS.find((w) => w.id === type);
const widgetLabel = (type) => __(widgetDef(type).label);
const widgetName = (w) => w.title || widgetLabel(w.type);
function dashLayout() {
  const s = state.dashboard || DASH_DEFAULT;
  return { items: (s.items || []).filter((w) => widgetDef(w.type)).map((w) => JSON.parse(JSON.stringify(w))) };
}
// Items a widget can be narrowed to ("Show" checkboxes in Customize).
function pickItems(kind) {
  const d = state.data;
  if (kind === "currencies") return [...new Set(d.accounts.map((a) => a.currency))].map((c) => ({ id: c, label: c }));
  if (kind === "budgets") return d.tags.filter((t) => t.limitMinor !== undefined).map((t) => ({ id: t.id, label: t.name }));
  if (kind === "goals") return d.tags.filter((t) => t.targetMinor !== undefined).map((t) => ({ id: t.id, label: t.name }));
  if (kind === "accounts") return d.accounts.map((a) => ({ id: a.id, label: a.name }));
  return [];
}
const ofAmount = (a, b, cur) => esc(__("{spent} of {limit}", { spent: fmt(a, cur), limit: fmt(b, cur) }));
const pctFmt = (p) => new Intl.NumberFormat(LANG, { style: "percent", maximumFractionDigits: 0 }).format(p / 100);
const bar = (p, cls = "") => `<div class="bar"><i class="${cls}" style="width:${Math.min(100, Math.max(0, p))}%"></i></div>`;
// Columns of the table widgets. `on` marks the default set; a widget's `columns` lists the
// shown keys in order. Keep the keys in step with widgetColumns in server/settings.go.
const WIDGET_COLS = {
  budgets: [
    { key: "name", label: N_("Budget"), on: 1, v: (t) => `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` },
    { key: "spent", label: N_("Spent"), on: 1, v: (t) => ofAmount(t.spentMinor, t.limitMinor, t.currency) },
    { key: "progress", label: N_("Progress"), on: 1, v: (t) => bar(t.pct, barCls(t.pct)) },
    { key: "used", label: N_("Used"), num: 1, v: (t) => pctFmt(t.pct) },
    { key: "limit", label: N_("Limit"), num: 1, v: (t) => fmt(t.limitMinor, t.currency) },
    { key: "remaining", label: N_("Remaining"), on: 1, num: 1, v: (t) => fmt(t.remainingMinor, t.currency) },
    { key: "period", label: N_("Period"), v: (t) => esc(budgetPeriodText(t)) },
  ],
  spending: [
    { key: "name", label: N_("Category"), on: 1, v: (x) => x.tagId ? `<button class="titlelink" data-detail-tag="${esc(x.tagId)}">${esc(tagName(x.tagId))}</button>` : `<span class="muted">${esc(__("Uncategorised"))}</span>` },
    { key: "share", label: N_("Share"), on: 1, v: (x) => bar(x.share) },
    { key: "pct", label: N_("% of spending"), num: 1, v: (x) => pctFmt(x.pct) },
    { key: "spent", label: N_("Spent"), on: 1, num: 1, v: (x) => fmt(x.amountMinor, x.currency) },
  ],
  accounts: [
    { key: "name", label: N_("Account"), on: 1, v: (a) => `<button class="titlelink" data-detail-account="${esc(a.id)}">${esc(a.name)}</button>` },
    { key: "currency", label: N_("Currency"), v: (a) => esc(a.currency) },
    { key: "balance", label: N_("Balance"), on: 1, num: 1, v: (a) => fmt(a.balanceMinor, a.currency) },
    { key: "earmarked", label: N_("Earmarked"), on: 1, num: 1, v: (a) => fmt(a.allocatedMinor, a.currency) },
    { key: "free", label: N_("Free"), on: 1, num: 1, v: (a) => fmt(a.unallocatedMinor, a.currency) },
    { key: "limit", label: N_("Limit"), num: 1, v: (a) => (a.limitMinor ? fmt(a.limitMinor, a.currency) : "—") },
    { key: "owed", label: N_("Owed"), num: 1, v: (a) => (a.limitMinor ? fmt(a.owedMinor, a.currency) : "—") },
  ],
};
const defaultCols = (type) => WIDGET_COLS[type].filter((c) => c.on).map((c) => c.key);
// the shown columns of a widget, in order
function widgetCols(type, o) {
  const all = WIDGET_COLS[type], keys = o.columns && o.columns.length ? o.columns : defaultCols(type);
  return keys.map((k) => all.find((c) => c.key === k)).filter(Boolean);
}
const colTable = (cols, xs) => table(cols.map((c) => ({ t: c.label, num: c.num })), xs.map((x) => row(cols.map((c) => ({ l: c.label, v: c.v(x), num: c.num })))).join(""));
function widgetBody(type, o) {
  const d = state.data, def = widgetDef(type), rows = o.rows || def.rows;
  const inc = (x) => !(o.include && o.include.length) || o.include.includes(x);
  switch (type) {
    case "balances": {
      const perCur = {};
      d.accounts.forEach((a) => { if (inc(a.currency)) perCur[a.currency] = (perCur[a.currency] || 0) + a.balanceMinor; });
      return `<div class="cards">${Object.entries(perCur).map(([c, val]) => `<div class="card"><span class="lab">${esc(__("Balance"))}</span><b>${fmt(val, c)}</b><span class="muted">${esc(__("{n} account(s)", { n: d.accounts.filter((a) => a.currency === c).length }))}</span></div>`).join("")}</div>`;
    }
    case "budgets": {
      const list = d.tags.filter((t) => t.limitMinor !== undefined && inc(t.id)).map((t) => ({ ...t, pct: t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0 }));
      return list.length ? colTable(widgetCols(type, o), list) : `<p class="muted">${esc(__("No budgets yet."))}</p>`;
    }
    case "spending": {
      // server returns rows grouped by currency, largest first; bars compare within one currency only
      const byCur = {};
      (d.spendingThisMonth || []).forEach((x) => { (byCur[x.currency] = byCur[x.currency] || []).push(x); });
      const list = Object.values(byCur).flatMap((xs) => {
        const total = xs.reduce((n, x) => n + x.amountMinor, 0);
        // share: against the largest category; pct: of all spending, both within one currency
        return xs.slice(0, rows).map((x) => ({ ...x, share: xs[0].amountMinor ? x.amountMinor / xs[0].amountMinor * 100 : 0, pct: total ? x.amountMinor / total * 100 : 0 }));
      });
      return list.length ? colTable(widgetCols(type, o), list) : `<p class="muted">${esc(__("No posted expenses this month."))}</p>`;
    }
    case "moneyboxes": {
      const goals = d.tags.filter((t) => t.targetMinor !== undefined && inc(t.id));
      return goals.length ? goals.map(goalCard).join("") : `<p class="muted">${esc(__("No money boxes yet."))}</p>`;
    }
    case "accounts": {
      return colTable(widgetCols(type, o), d.accounts.filter((a) => inc(a.id)));
    }
    case "recent": {
      const list = d.transactions.filter((t) => t.state === "posted").sort(byNewest).slice(0, rows);
      return list.length ? feedHTML(list) : `<p class="muted">${esc(__("No transactions yet."))}</p>`;
    }
  }
  return "";
}
function dashGrid(layout) {
  if (!layout.items.length) return `<div class="empty">${esc(__("No widgets yet. Customize the dashboard to add some."))}</div>`;
  return `<div class="dashgrid">${layout.items.map((w) => {
    const size = w.size === "half" ? " half" : "";
    // balances are bare cards: a heading only when the user gave it a title
    if (w.type === "balances") return `<section class="dw bare${size}">${w.title ? `<h3>${esc(w.title)}</h3>` : ""}${widgetBody(w.type, w)}</section>`;
    return `<section class="panel dw${size}"><h3>${esc(widgetName(w))}</h3>${widgetBody(w.type, w)}</section>`;
  }).join("")}</div>`;
}
const draftItem = (id) => state.dashDraft.items.find((w) => w.id === id);
function setWidgetOpt(id, key, val) {
  const w = draftItem(id);
  if (val === undefined || val === "" || (Array.isArray(val) && !val.length)) delete w[key]; else w[key] = val;
}
// Dashboard editor: the dashboard itself is the editing surface (left); the pane on the right
// lists every widget type to add (as often as wanted), or the settings of the selected widget.
const GEAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const ARROW = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const UP = ARROW("M12 19V5M6 11l6-6 6 6"), DOWN = ARROW("M12 5v14M6 13l6 6 6-6");
function dashTile(w, i, draft) {
  const id = w.id, name = widgetName(w), last = draft.items.length - 1;
  return `<section class="panel dw edit${w.size === "half" ? " half" : ""}${state.dashSel === id ? " sel" : ""}" data-tile="${esc(id)}">
    <div class="tilebar"><span class="grip" aria-hidden="true">⠿</span><button type="button" class="tname" data-tile-edit="${esc(id)}">${esc(name)}</button>
      <button type="button" class="iconbtn" data-tile-move="-1" aria-label="${esc(__("Move {widget} earlier", { widget: name }))}" ${i === 0 ? "disabled" : ""}>${UP}</button>
      <button type="button" class="iconbtn" data-tile-move="1" aria-label="${esc(__("Move {widget} later", { widget: name }))}" ${i === last ? "disabled" : ""}>${DOWN}</button>
      <button type="button" class="iconbtn" data-tile-edit="${esc(id)}" aria-label="${esc(__("Settings for {widget}", { widget: name }))}" title="${esc(__("Settings"))}">${GEAR}</button>
      <button type="button" class="iconbtn" data-tile-remove aria-label="${esc(__("Remove {widget}", { widget: name }))}" title="${esc(__("Remove"))}">✕</button></div>
    <div class="tilebody" inert>${widgetBody(w.type, w)}</div></section>`;
}
// Columns editor: shown columns first in their order, then the hidden ones; tick to show, arrows to reorder.
function colPicker(o) {
  const all = WIDGET_COLS[o.type], shown = widgetCols(o.type, o).map((c) => c.key);
  const list = [...shown, ...all.map((c) => c.key).filter((k) => !shown.includes(k))];
  return `<fieldset><legend>${esc(__("Columns"))}</legend><ul class="colpick">${list.map((k, i) => {
    const c = all.find((x) => x.key === k), name = __(c.label);
    return `<li data-col="${esc(k)}"><label><input type="checkbox" data-col-on ${shown.includes(k) ? "checked" : ""}> ${esc(name)}</label>
      <button type="button" class="iconbtn" data-col-move="-1" aria-label="${esc(__("Move {column} left", { column: name }))}" ${i === 0 ? "disabled" : ""}>${UP}</button>
      <button type="button" class="iconbtn" data-col-move="1" aria-label="${esc(__("Move {column} right", { column: name }))}" ${i === list.length - 1 ? "disabled" : ""}>${DOWN}</button></li>`;
  }).join("")}</ul></fieldset>`;
}
function dashPaneHTML(draft) {
  const o = state.dashSel && draft.items.find((w) => w.id === state.dashSel);
  if (!o) {
    return `<h3>${esc(__("Widgets"))}</h3>
      <ul class="palette">${DASH_WIDGETS.map((d) => `<li data-pal="${esc(d.id)}"><span class="grip" aria-hidden="true">⠿</span><span class="grow">${esc(__(d.label))}</span><button type="button" class="smallbtn" data-pal-add="${esc(d.id)}">${esc(__("Add"))}</button></li>`).join("")}</ul>
      <div class="droptrash">${esc(__("Drop here to remove"))}</div>`;
  }
  const w = widgetDef(o.type), label = widgetLabel(o.type);
  const items = w.pick ? pickItems(w.pick) : [];
  const shown = (x) => !(o.include && o.include.length) || o.include.includes(x);
  return `<button type="button" class="linkbtn" data-pane-back>${esc(__("‹ All widgets"))}</button>
    <h3>${esc(label)}</h3>
    <div class="paneform">
      <label>${esc(__("Title"))} <input type="text" data-dash-title value="${esc(o.title || "")}" placeholder="${esc(label)}" maxlength="60"></label>
      <label>${esc(__("Width"))} <select data-dash-size><option value="full">${esc(__("Full width"))}</option><option value="half" ${o.size === "half" ? "selected" : ""}>${esc(__("Half width"))}</option></select></label>
      ${w.rows ? `<label>${esc(__("Rows"))} <input type="number" data-dash-rows min="1" max="50" value="${o.rows || w.rows}"></label>` : ""}
      ${WIDGET_COLS[o.type] ? colPicker(o) : ""}
      ${items.length ? `<fieldset><legend>${esc(__("Show"))}</legend>${items.map((it) => `<label><input type="checkbox" data-dash-inc value="${esc(it.id)}" ${shown(it.id) ? "checked" : ""}> ${esc(it.label)}</label>`).join("")}</fieldset>` : ""}
    </div>
    <div class="setrow"><button type="button" class="smallbtn" data-pane-dup>${esc(__("Duplicate"))}</button><button type="button" class="smallbtn danger" data-pane-remove>${esc(__("Remove from dashboard"))}</button></div>`;
}
function screenDashboardEditor(v) {
  const draft = state.dashDraft;
  v.innerHTML = `<div class="dashbar"><h3>${esc(__("Customize dashboard"))}</h3><span><button class="smallbtn" id="dashReset">${esc(__("Reset to default"))}</button> <button class="smallbtn" id="dashCancel">${esc(__("Cancel"))}</button> <button class="primarybtn" id="dashSave">${esc(__("Save"))}</button></span></div>
    <div class="dasheditor"><div class="dashgrid dashcanvas" id="dashCanvas"></div><aside class="panel dashpane" id="dashPane" aria-label="${esc(__("Widgets"))}"></aside></div>`;
  const canvas = $("#dashCanvas"), pane = $("#dashPane");
  const remove = (id) => { draft.items = draft.items.filter((w) => w.id !== id); if (state.dashSel === id) state.dashSel = null; draw(); };
  // a new widget of a type (optionally copying another's options), not yet placed
  const create = (type, from) => {
    let id;
    do id = "w-" + Math.random().toString(36).slice(2, 10); while (draftItem(id));
    const w = from ? { ...JSON.parse(JSON.stringify(from)), id } : { id, type };
    return w;
  };
  // put a widget before/after another one, or at the end
  const place = (w, targetId, after) => {
    const items = draft.items.filter((x) => x.id !== w.id);
    const j = targetId ? items.findIndex((x) => x.id === targetId) + (after ? 1 : 0) : items.length;
    items.splice(j, 0, w);
    draft.items = items;
  };
  const flash = (id) => {
    const t = canvas.querySelector(`[data-tile="${CSS.escape(id)}"]`);
    if (!t) return;
    t.scrollIntoView({ behavior: "smooth", block: "nearest" });
    t.classList.add("flash");
    setTimeout(() => t.classList.remove("flash"), 1200);
  };
  const drawCanvas = () => {
    canvas.innerHTML = draft.items.map((w, i) => dashTile(w, i, draft)).join("") || `<div class="empty dropend">${esc(__("Drag widgets here, or use Add."))}</div>`;
    canvas.querySelectorAll("[data-tile]").forEach((tile) => {
      const id = tile.dataset.tile;
      tile.addEventListener("click", (e) => {
        if (e.target.closest("[data-tile-move],[data-tile-remove]")) return;
        state.dashSel = id; draw();
        // on narrow screens the pane sits above the dashboard: bring the settings into view
        if (pane.getBoundingClientRect().top < 0) pane.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tile.querySelector("[data-tile-remove]").addEventListener("click", () => remove(id));
      tile.querySelectorAll("[data-tile-move]").forEach((b) => b.addEventListener("click", () => {
        const i = draft.items.findIndex((w) => w.id === id), j = i + parseInt(b.dataset.tileMove, 10);
        if (j < 0 || j >= draft.items.length) return;
        place(draft.items[i], draft.items[j].id, j > i);
        draw();
        const again = canvas.querySelector(`[data-tile="${CSS.escape(id)}"] [data-tile-move="${b.dataset.tileMove}"]`);
        if (again && !again.disabled) again.focus();
      }));
    });
  };
  const drawPane = () => {
    pane.innerHTML = dashPaneHTML(draft);
    const id = state.dashSel;
    const on = (sel, ev, fn) => pane.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
    on("[data-pane-back]", "click", () => { state.dashSel = null; draw(); });
    on("[data-pane-remove]", "click", () => remove(id));
    on("[data-pal-add]", "click", (b) => { const w = create(b.dataset.palAdd); place(w, null); draw(); flash(w.id); });
    on("[data-pane-dup]", "click", () => { const w = create(null, draftItem(id)); place(w, id, true); state.dashSel = w.id; draw(); flash(w.id); });
    // option changes redraw only the dashboard, so the field being edited keeps focus
    on("[data-dash-title]", "input", (t) => { setWidgetOpt(id, "title", t.value.trim()); drawCanvas(); });
    on("[data-dash-size]", "change", (s) => { setWidgetOpt(id, "size", s.value === "half" ? "half" : undefined); drawCanvas(); });
    on("[data-dash-rows]", "change", (r) => {
      const def = widgetDef(draftItem(id).type), n = Math.min(50, Math.max(1, parseInt(r.value, 10) || def.rows));
      r.value = n;
      setWidgetOpt(id, "rows", n === def.rows ? undefined : n);
      drawCanvas();
    });
    // columns: the ticked ones, in list order; the default set is stored as "no override"
    const saveCols = (keys) => {
      const type = draftItem(id).type;
      setWidgetOpt(id, "columns", keys.join(",") === defaultCols(type).join(",") ? undefined : keys);
    };
    const colKeys = (onlyOn) => [...pane.querySelectorAll(".colpick li")].filter((li) => !onlyOn || li.querySelector("[data-col-on]").checked).map((li) => li.dataset.col);
    on("[data-col-on]", "change", (c) => {
      const keys = colKeys(true);
      if (!keys.length) { c.checked = true; msg(__("Keep at least one column.")); return; }
      saveCols(keys);
      drawCanvas();
    });
    on("[data-col-move]", "click", (b) => {
      const li = b.closest("li"), dir = parseInt(b.dataset.colMove, 10), sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (!sib) return;
      // a hidden column moved above a shown one is placed among them, so keep the full list order
      if (dir < 0) sib.before(li); else sib.after(li);
      const shown = colKeys(true);
      saveCols(shown);
      const scroll = pane.scrollTop;
      drawCanvas(); drawPane();
      pane.scrollTop = scroll;
      const again = pane.querySelector(`.colpick li[data-col="${CSS.escape(li.dataset.col)}"] [data-col-move="${dir}"]`);
      if (again && !again.disabled) again.focus();
    });
    on("[data-dash-inc]", "change", (c) => {
      const boxes = [...pane.querySelectorAll("[data-dash-inc]")], picked = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!picked.length) { c.checked = true; msg(__("Keep at least one item, or remove the widget.")); return; }
      setWidgetOpt(id, "include", picked.length === boxes.length ? undefined : picked);
      drawCanvas();
    });
  };
  const draw = () => { drawCanvas(); drawPane(); };
  // Drag with pointer events so mouse, touch and pen all work (HTML5 drag and drop does not on phones).
  // A mouse drags a widget from anywhere on it; a finger drags from the ⠿ handle, so the page still scrolls.
  // Tiles reorder, widgets from the pane are added where dropped, and a tile dropped on the pane is removed.
  const editor = v.querySelector(".dasheditor");
  let pd = null;
  const clearDrop = () => editor.querySelectorAll(".dropbefore,.dropafter,.droptarget").forEach((x) => x.classList.remove("dropbefore", "dropafter", "droptarget"));
  const spotAt = (p, x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return {};
    if (p.from === "canvas" && el.closest("#dashPane")) return { trash: true };
    if (!el.closest("#dashCanvas")) return {};
    const tile = el.closest("[data-tile]");
    if (!tile) return { end: true };
    if (p.from === "canvas" && tile.dataset.tile === p.id) return {};
    const r = tile.getBoundingClientRect();
    return { tile, after: tile.classList.contains("half") ? x > r.left + r.width / 2 : y > r.top + r.height / 2 };
  };
  const mark = (sp) => {
    clearDrop();
    if (sp.trash) pane.classList.add("droptarget");
    else if (sp.tile) sp.tile.classList.add(sp.after ? "dropafter" : "dropbefore");
    else if (sp.end) canvas.classList.add("droptarget");
  };
  const tick = () => {
    if (!pd) return;
    // scroll while holding a widget near the top (below the sticky header) or the bottom edge
    const top = $(".topbar").getBoundingClientRect().bottom;
    if (pd.y < top + 48) scrollBy(0, -14); else if (pd.y > innerHeight - 56) scrollBy(0, 14);
    mark(spotAt(pd, pd.x, pd.y));
    pd.raf = requestAnimationFrame(tick);
  };
  const startDrag = () => {
    pd.started = true;
    pd.src.classList.add("dragging");
    if (pd.from === "canvas") editor.classList.add("dragging-tile");
    pd.ghost = document.createElement("div");
    pd.ghost.className = "dragghost";
    pd.ghost.textContent = pd.name;
    document.body.appendChild(pd.ghost);
    document.body.classList.add("dashdragging");
    pd.raf = requestAnimationFrame(tick);
  };
  const onMove = (e) => {
    if (!pd || e.pointerId !== pd.pid) return;
    pd.x = e.clientX; pd.y = e.clientY;
    if (!pd.started && Math.hypot(pd.x - pd.x0, pd.y - pd.y0) > 6) startDrag();
    if (pd.started) { e.preventDefault(); pd.ghost.style.transform = `translate(${pd.x + 14}px,${pd.y + 14}px)`; }
  };
  const endDrag = (drop) => {
    const p = pd;
    pd = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", onKey);
    if (!p || !p.started) return;
    cancelAnimationFrame(p.raf);
    p.ghost.remove();
    p.src.classList.remove("dragging");
    editor.classList.remove("dragging-tile");
    document.body.classList.remove("dashdragging");
    // the click a mouse sends after the drag must not also select the widget
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    const sp = drop ? spotAt(p, p.x, p.y) : {};
    clearDrop();
    if (sp.trash) remove(p.id);
    else if (sp.tile || sp.end) {
      const w = p.from === "palette" ? create(p.id) : draftItem(p.id);
      place(w, sp.tile ? sp.tile.dataset.tile : null, sp.after);
      draw();
      if (p.from === "palette") flash(w.id);
    }
  };
  const onUp = (e) => { if (pd && e.pointerId === pd.pid) endDrag(e.type === "pointerup"); };
  const onKey = (e) => { if (e.key === "Escape") endDrag(false); };
  editor.addEventListener("pointerdown", (e) => {
    if (pd || e.button !== 0) return;
    const src = e.target.closest("[data-tile],[data-pal]");
    if (!src || e.target.closest("input,select,textarea,[data-tile-move],[data-tile-remove],.iconbtn[data-tile-edit],[data-pal-add]")) return;
    const handle = e.target.closest(".grip");
    if (e.pointerType !== "mouse" && !handle) return;
    if (handle) e.preventDefault(); // no text selection or long-press menu from the handle
    pd = { id: src.dataset.tile || src.dataset.pal, from: src.dataset.tile ? "canvas" : "palette", src, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, name: src.dataset.pal ? widgetLabel(src.dataset.pal) : src.querySelector(".tname").textContent };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
  });
  $("#dashCancel").addEventListener("click", () => { state.customizing = false; render(); });
  $("#dashReset").addEventListener("click", () => { state.dashDraft = JSON.parse(JSON.stringify(DASH_DEFAULT)); state.dashSel = null; render(); });
  $("#dashSave").addEventListener("click", async () => {
    try {
      const saved = await put("/api/settings", { dashboard: draft });
      state.dashboard = saved.dashboard;
      state.customizing = false;
      msg(__("Dashboard saved."));
      render();
    } catch (e) { errMsg(e); }
  });
  draw();
}
function screenDashboard(v) {
  if (state.customizing) { screenDashboardEditor(v); return; }
  v.innerHTML = `<div class="dashhead"><button class="smallbtn" id="dashCustomize">${esc(__("Customize dashboard"))}</button></div>` + dashGrid(dashLayout());
  $("#dashCustomize").addEventListener("click", () => {
    state.dashDraft = dashLayout();
    state.dashSel = null;
    state.customizing = true;
    render();
  });
  bindActions(v);
}
// what each account holds for a money box; an allocation in another currency is only a label on it (ADR 0011)
function goalAllocations(tagId) {
  const byAcc = {}, box = state.data.tags.find((x) => x.id === tagId), cur = box && box.currency;
  state.data.transactions.forEach((t) => {
    if (t.tagId !== tagId || t.state !== "posted" || (cur && t.currency !== cur)) return;
    if (t.type === "allocate") byAcc[t.accountId] = (byAcc[t.accountId] || 0) + t.amountMinor; // signed
  });
  return Object.entries(byAcc).filter(([, v]) => v > 0);
}
function goalCard(t) {
  const p = t.targetMinor > 0 ? t.savedMinor / t.targetMinor * 100 : 0;
  const allocs = goalAllocations(t.id);
  // the bar is the target: each account's share is filled, the rest stays empty
  const scale = Math.max(t.targetMinor, t.savedMinor) || 1;
  const stack = allocs.map(([, val], i) => `<i style="width:${val / scale * 100}%;background:${BOX_COLORS[i % BOX_COLORS.length]}"></i>`).join("");
  const where = allocs.map(([id, val]) => `${esc(accName(id))} ${fmt(val, t.currency)}`).join(" · ");
  const head = __("{saved} of {target} · {pct}%", { saved: fmt(t.savedMinor, t.currency), target: fmt(t.targetMinor, t.currency), pct: p.toFixed(0) }) + (t.targetDate ? " · " + __("by {date}", { date: t.targetDate }) : "");
  return `<div style="margin-bottom:18px"><div class="panelhead"><button class="titlelink" data-detail-goal="${esc(t.id)}">${esc(t.name)}</button><span>${esc(head)}</span></div>
    <div class="stack" style="margin:8px 0">${stack}</div><span class="muted">${where || esc(__("No allocations yet"))}</span></div>`;
}
function bindActions(root) {
  root.querySelectorAll("[data-edit-txn]").forEach((b) => b.addEventListener("click", () => openEditTxn(b.dataset.editTxn)));
  root.querySelectorAll("[data-alloc]").forEach((b) => b.addEventListener("click", () => openDrawer("allocate", b.dataset.alloc)));
  root.querySelectorAll("[data-history]").forEach((b) => b.addEventListener("click", () => showHistory(b.dataset.history)));
  bindDetails(root);
}
function bindDetails(root) {
  // a title opens its edit form straight away; there is no read-only pane in between
  root.querySelectorAll("[data-detail-txn]").forEach((b) => b.addEventListener("click", () => openEditTxn(b.dataset.detailTxn)));
  root.querySelectorAll("[data-detail-account]").forEach((b) => b.addEventListener("click", () => openAccountDialog(b.dataset.detailAccount)));
  root.querySelectorAll("[data-detail-tag],[data-detail-goal]").forEach((b) => b.addEventListener("click", () => openTagDialog(null, b.dataset.detailTag || b.dataset.detailGoal)));
  root.querySelectorAll("[data-detail-template]").forEach((b) => b.addEventListener("click", () => openTemplateDialog(b.dataset.detailTemplate)));
}
// pairs: [English label, HTML value]
function detailTable(pairs) {
  return `<table class="detail"><tbody>${pairs.map(([k, v]) => `<tr><td data-label="">${esc(__(k))}</td><td data-label="">${v}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- transaction feed ---------- */
const whenKey = (t) => { const w = txnWhen(t); return w.date + " " + w.time + " " + t.id; };
const byNewest = (a, b) => whenKey(b).localeCompare(whenKey(a));
// stroke icons (24px grid): money out, money in, between accounts, into / out of a money box
const ICON_PATH = { expense: "M7 17 17 7M9 7h8v8", income: "M17 7 7 17M15 17H7V9", transfer: "M4 8h15l-3-3M20 16H5l3 3", allocate: "M4 13v6h16v-6M12 4v10M8 10l4 4 4-4", release: "M4 13v6h16v-6M12 14V4M8 8l4-4 4 4" };
const typeIcon = (type) => `<svg viewBox="0 0 24 24" width="18" height="18"><path d="${ICON_PATH[type] || "M12 12h.01"}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// a transfer's categories (ADR 0010); an allocation's money box is tagId
const txnCats = (t) => t.tagIds || [];
const txnTagNames = (t) => txnCats(t).map(tagName);
// What a row says under its title: where the money went, in words a person uses.
function txnSubtitle(t) {
  const k = flow(t);
  if (k === "transfer") return accName(t.fromAccountId) + " → " + accName(t.toAccountId);
  if (k === "allocate") return t.amountMinor < 0 ? tagName(t.tagId) + " → " + accName(t.accountId) : accName(t.accountId) + " → " + tagName(t.tagId);
  return [txnTagNames(t).join(", "), transferAcct(t)].filter(Boolean).join(" · ");
}
// allocations are signed (ADR 0003): + into the money box, − back out
const amountText = (t) => t.type === "allocate" ? (t.amountMinor < 0 ? "−" : "+") + fmt(Math.abs(t.amountMinor), t.currency) : signed(t) + fmt(t.amountMinor, t.currency);
const iconKind = (t) => (t.type === "allocate" && t.amountMinor < 0 ? "release" : flow(t));
const amountCls = (t) => { const k = flow(t); return k === "income" ? "in" : k === "expense" ? "out" : "move"; };
// Time zones (ADR 0006). A timed transaction has an instant (t.at, UTC); it is shown and grouped in the
// display zone: the one chosen in Settings, or this device's when set to Auto (follows you when travelling).
// Date-only transactions stay on their date in every zone.
const deviceTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } };
const displayTZ = () => (state.general && state.general.timeZone) || deviceTZ();
const zoneFmts = {};
// zoneParts(date, tz) -> { date: "YYYY-MM-DD", time: "HH:MM" } as a clock in tz shows it
function zoneParts(when, tz) {
  const f = zoneFmts[tz] || (zoneFmts[tz] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  const p = Object.fromEntries(f.formatToParts(when).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const txnWhen = (t) => (t.at ? zoneParts(new Date(t.at), displayTZ()) : { date: t.date, time: "" });
const txnDay = (t) => txnWhen(t).date;
// "14:05" in the viewer's locale and display zone; the tooltip gives the local time where it happened
function txnClock(t) {
  if (!t.at) return "";
  const at = new Date(t.at), dz = displayTZ();
  const shown = new Intl.DateTimeFormat(LANG, { hour: "numeric", minute: "2-digit", timeZone: dz }).format(at);
  const there = t.tz && t.tz !== dz ? __("{time} in {zone}", { time: new Intl.DateTimeFormat(LANG, { hour: "numeric", minute: "2-digit", timeZone: t.tz }).format(at), zone: zoneCity(t.tz) }) : "";
  return `<span class="ftime"${there ? ` title="${esc(there)}"` : ""}>${esc(shown)}${there ? "*" : ""}</span>`;
}
const zoneCity = (tz) => tz.split("/").pop().replace(/_/g, " ");
let zoneOptionsCache = null;
// every IANA zone as "Asia/Taipei (GMT+8)", built once
function zoneOptions(sel) {
  if (!zoneOptionsCache) {
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = [deviceTZ()]; }
    if (!zones.includes(deviceTZ())) zones.unshift(deviceTZ());
    const now = new Date();
    zoneOptionsCache = zones.map((z) => {
      let off = "";
      try { off = new Intl.DateTimeFormat("en", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(now).find((x) => x.type === "timeZoneName").value; } catch (e) { /* offset is a nicety */ }
      return [z, off ? `${z.replace(/_/g, " ")} (${off})` : z.replace(/_/g, " ")];
    });
  }
  return zoneOptionsCache.map(([z, label]) => `<option value="${esc(z)}" ${z === sel ? "selected" : ""}>${esc(label)}</option>`).join("");
}
const isoDay = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
function dayLabel(iso) {
  if (iso === state.data.today) return __("Today");
  const [y, m, d] = iso.split("-").map(Number), day = new Date(y, m - 1, d); // local calendar date, never shifted through UTC
  if (isoDay(new Date(y, m - 1, d + 1)) === state.data.today) return __("Yesterday");
  try { return new Intl.DateTimeFormat(LANG, { weekday: "short", year: "numeric", month: "short", day: "numeric" }).format(day); } catch (e) { return iso; }
}
// dayNet: income minus spending per currency for one day (transfers and money-box decisions net to zero)
function dayNet(list) {
  const net = {};
  list.forEach((t) => { const k = flow(t); if (k === "income") net[t.currency] = (net[t.currency] || 0) + t.amountMinor; if (k === "expense") net[t.currency] = (net[t.currency] || 0) - t.amountMinor; });
  return Object.entries(net).filter(([, v]) => v).map(([c, v]) => (v > 0 ? "+" : "−") + fmt(Math.abs(v), c)).join(" · ");
}
function feedRow(t, opts = {}) {
  const sub = txnSubtitle(t) + (opts.withDate ? " · " + dayLabel(txnDay(t)) : "");
  return `<li><button type="button" class="feedrow" ${opts.edit ? "data-edit-txn" : "data-detail-txn"}="${esc(t.id)}">
      <span class="ficon t-${esc(flow(t))}" aria-hidden="true">${typeIcon(iconKind(t))}</span>
      <span class="fmain"><span class="ftitle">${esc(t.note || txnTagNames(t)[0] || lbl(TYPE_L, flow(t)))}${t.memo ? `<span class="fmemo" title="${esc(__("Has a note"))}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr">${esc(__("Has a note"))}</span></span>` : ""}</span><span class="fsub">${txnClock(t)}<span class="sr">${esc(lbl(TYPE_L, flow(t)))} · </span>${esc(sub)}</span></span>
      <span class="famt ${amountCls(t)}">${esc(amountText(t))}</span></button></li>`;
}
/* ---------- transaction periods (the list pages by calendar period, not by entry count) ---------- */
const MAX_RANGE_DAYS = 180;
const PERIOD_L = { week: N_("Week"), month: N_("Month"), custom: N_("Custom") };
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d); };
const spanDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000) + 1; // inclusive; rounding absorbs DST hours
// periodFor returns the week (Monday-Sunday) or month containing the anchor date.
function periodFor(mode, anchor) {
  const d = parseDay(anchor);
  if (mode === "week") { const start = addDays(anchor, -((d.getDay() + 6) % 7)); return { mode, start, end: addDays(start, 6) }; }
  return { mode: "month", start: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), end: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}
function shiftPeriod(p, dir) {
  if (p.mode === "month") { const s = parseDay(p.start); return periodFor("month", isoDay(new Date(s.getFullYear(), s.getMonth() + dir, 1))); }
  if (p.mode === "week") return periodFor("week", addDays(p.start, 7 * dir));
  const len = spanDays(p.start, p.end);
  return { mode: "custom", start: addDays(p.start, len * dir), end: addDays(p.end, len * dir) };
}
// clampRange keeps a custom range ordered and at most MAX_RANGE_DAYS long (moving the end).
function clampRange(start, end) {
  if (end < start) [start, end] = [end, start];
  const tooLong = spanDays(start, end) > MAX_RANGE_DAYS;
  return { mode: "custom", start, end: tooLong ? addDays(start, MAX_RANGE_DAYS - 1) : end, clamped: tooLong };
}
function periodLabel(p) {
  try {
    if (p.mode === "month") return new Intl.DateTimeFormat(LANG, { year: "numeric", month: "long" }).format(parseDay(p.start));
    const a = parseDay(p.start), b = parseDay(p.end);
    if (LANG === "zh-TW") { // ICU's zh-TW range pattern is numeric ("2026/11/9至2026/11/15"); spell it out instead
      const withYear = new Intl.DateTimeFormat(LANG, { year: "numeric", month: "long", day: "numeric" });
      return withYear.format(a) + " – " + (a.getFullYear() === b.getFullYear() ? new Intl.DateTimeFormat(LANG, { month: "long", day: "numeric" }) : withYear).format(b);
    }
    return new Intl.DateTimeFormat(LANG, { year: "numeric", month: "short", day: "numeric" }).formatRange(a, b);
  } catch (e) { return p.start + " – " + p.end; }
}
const PERIOD_KEY = "kisiauthong.txnPeriod";
function currentPeriod() {
  if (!state.period) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PERIOD_KEY) || "null"); } catch (e) { /* storage unavailable: use defaults */ }
    const today = state.data.today;
    state.period = saved && saved.mode === "custom" && saved.start && saved.end ? clampRange(saved.start, saved.end)
      : periodFor(saved && saved.mode === "week" ? "week" : "month", today);
  }
  return state.period;
}
function setPeriod(p) {
  state.period = { mode: p.mode, start: p.start, end: p.end };
  try { localStorage.setItem(PERIOD_KEY, JSON.stringify(state.period)); } catch (e) { /* per-browser convenience only */ }
}

// feedHTML groups a newest-first list by day; the first `open` days start expanded,
// and a day the user opened or closed keeps that choice (state.dayOpen) across re-renders.
function feedHTML(list, open = Infinity) {
  const days = [];
  list.forEach((t) => { const day = txnDay(t), last = days[days.length - 1]; if (last && last.date === day) last.items.push(t); else days.push({ date: day, items: [t] }); });
  return days.map((d, i) => {
    const byDefault = i < open, isOpen = d.date in state.dayOpen ? state.dayOpen[d.date] : byDefault;
    return `<details class="fday" data-day="${esc(d.date)}" data-default="${byDefault ? 1 : 0}" ${isOpen ? "open" : ""}><summary><span class="fdate">${esc(dayLabel(d.date))}</span><span class="fcount">${esc(__("{n} transaction(s)", { n: d.items.length }))}</span><span class="fnet">${d.items.length > 1 ? esc(dayNet(d.items)) : ""}</span></summary><ul class="feed">${d.items.map((t) => feedRow(t)).join("")}</ul></details>`;
  }).join("");
}
function bindDays(root) {
  root.querySelectorAll("details.fday").forEach((dt) => dt.addEventListener("toggle", () => {
    // toggle also fires for sections rendered open; only remember real changes
    if (dt.open === (dt.dataset.default === "1")) delete state.dayOpen[dt.dataset.day]; else state.dayOpen[dt.dataset.day] = dt.open;
  }));
}
async function deleteTxn(id) {
  if (!confirm(__("Delete this transaction? This cannot be undone."))) return false;
  try { await api("/api/transactions/" + id, { method: "DELETE" }); msg(__("Deleted.")); await load(); return true; }
  catch (e) { errMsg(e); return false; }
}
function filteredTxns() {
  const f = state.filter, q = f.q.trim().toLowerCase();
  let list = [...state.data.transactions].sort(byNewest);
  if (q) list = list.filter((t) => [t.note, t.memo, lbl(TYPE_L, flow(t)), txnSubtitle(t), fmt(t.amountMinor, t.currency)].join(" ").toLowerCase().includes(q));
  if (f.account) list = list.filter((t) => t.accountId === f.account || t.fromAccountId === f.account || t.toAccountId === f.account);
  if (f.type) list = list.filter((t) => flow(t) === f.type);
  // "none": spending and income without a category (transfers and allocations never take one)
  if (f.tag === "none") list = list.filter((t) => !txnCats(t).length && (flow(t) === "expense" || flow(t) === "income"));
  else if (f.tag) list = list.filter((t) => t.tagId === f.tag || txnCats(t).includes(f.tag));
  return list;
}
function screenTransactions(v) {
  const f = state.filter;
  const accOpt = (a) => `<option value="${esc(a.id)}" ${f.account === a.id ? "selected" : ""}>${esc(accName(a.id))}</option>`;
  const accOpts = `<option value="">${esc(__("All accounts"))}</option>` + state.data.accounts.map(accOpt).join("")
    + (state.data.externals.length ? `<optgroup label="${esc(__("External accounts"))}">${state.data.externals.map(accOpt).join("")}</optgroup>` : "");
  const tagOpt = (t) => `<option value="${esc(t.id)}" ${f.tag === t.id ? "selected" : ""}>${esc(t.name)}</option>`;
  const tagGroup = (label, tags) => (tags.length ? `<optgroup label="${esc(label)}">${tags.map(tagOpt).join("")}</optgroup>` : "");
  const tagOpts = `<option value="">${esc(__("All categories"))}</option><option value="none" ${f.tag === "none" ? "selected" : ""}>${esc(__("Uncategorised"))}</option>`
    + tagGroup(__("Categories"), state.data.tags.filter((t) => !isGoal(t))) + tagGroup(__("Money boxes"), state.data.tags.filter(isGoal));
  // on phones the dropdowns fold away behind a Filters button that counts the ones in use
  v.innerHTML = `<div class="filters${state.filtersOpen ? " open" : ""}">
      <input id="fq" type="search" placeholder="${esc(__("Search note, tag, account…"))}" value="${esc(f.q)}">
      <button type="button" class="smallbtn ftoggle" id="fToggle" aria-expanded="${!!state.filtersOpen}" aria-controls="fMore"></button>
      <div class="fmore" id="fMore">
      <select id="faccount" aria-label="${esc(__("Account"))}">${accOpts}</select>
      <select id="ftype" aria-label="${esc(__("Type"))}"><option value="">${esc(__("All types"))}</option>${enumOptions(TYPE_L, Object.keys(TYPE_L), f.type)}</select>
      <select id="ftag" aria-label="${esc(__("Tags"))}">${tagOpts}</select>
      <button class="smallbtn" id="clearF">${esc(__("Clear"))}</button></div></div>
    <div id="txnResults"></div>`;
  const countF = () => {
    const n = ["account", "type", "tag"].filter((k) => state.filter[k]).length;
    $("#fToggle").textContent = n ? __("Filters · {n}", { n }) : __("Filters");
    $("#fToggle").classList.toggle("on", n > 0);
  };
  $("#fToggle").addEventListener("click", () => {
    state.filtersOpen = !state.filtersOpen;
    $(".filters").classList.toggle("open", state.filtersOpen);
    $("#fToggle").setAttribute("aria-expanded", state.filtersOpen);
  });
  const today = state.data.today;
  const nav = (p) => {
    const atLatest = p.end >= today;
    return `<nav class="periodnav" aria-label="${esc(__("Period"))}">
        <button class="smallbtn" data-shift="-1">${esc(__("‹ Previous"))}</button>
        <span class="plabel">${esc(periodLabel(p))}</span>
        <button class="smallbtn" data-shift="1" ${atLatest ? "disabled" : ""}>${esc(__("Next ›"))}</button>
        ${!(today >= p.start && today <= p.end) ? `<button class="smallbtn" data-today>${esc(__("Back to today"))}</button>` : ""}</nav>`;
  };
  const drawResults = () => {
    const p = currentPeriod(), all = filteredTxns();
    // unconfirmed items wait in their own section (oldest first, any date) instead of carrying a state on every row
    const expected = all.filter((t) => t.state === "planned").reverse();
    const list = all.filter((t) => { const d = txnDay(t); return t.state !== "planned" && d >= p.start && d <= p.end; });
    const modes = Object.keys(PERIOD_L).map((m) => `<button type="button" data-mode="${m}" class="${m === p.mode ? "on" : ""}" aria-pressed="${m === p.mode}">${esc(__(PERIOD_L[m]))}</button>`).join("");
    const custom = p.mode === "custom" ? `<span class="prange"><input type="date" id="pStart" value="${esc(p.start)}" aria-label="${esc(__("Start date"))}"> – <input type="date" id="pEnd" value="${esc(p.end)}" aria-label="${esc(__("End date"))}"></span>` : "";
    const head = `<div class="periodbar"><div class="seg pmodes" role="group" aria-label="${esc(__("Period"))}">${modes}</div>${custom}${nav(p)}</div>`;
    const expectedHTML = expected.length ? `<section class="panel feedpanel expected" id="expectedSec"><h3>${esc(__("Expected to confirm"))}</h3><ul class="feed">${expected.map((t) => feedRow(t, { withDate: true, edit: true })).join("")}</ul></section>` : "";
    const postedHTML = list.length ? `<section class="panel feedpanel">${feedHTML(list, openDays())}</section>`
      : `<div class="empty">${esc(__("No transactions in this period."))}</div>`;
    $("#txnResults").innerHTML = expectedHTML + head + postedHTML;
    const box = $("#txnResults");
    box.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.mode;
      if (m === p.mode) return;
      // custom starts from the period on screen; week/month jump to the one holding its last day (capped at today)
      setPeriod(m === "custom" ? clampRange(p.start, p.end) : periodFor(m, p.end < today ? p.end : today));
      drawResults();
    }));
    box.querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () => {
      setPeriod(shiftPeriod(p, parseInt(b.dataset.shift, 10)));
      drawResults();
    }));
    const todayBtn = box.querySelector("[data-today]");
    if (todayBtn) todayBtn.addEventListener("click", () => {
      const len = spanDays(p.start, p.end);
      setPeriod(p.mode === "custom" ? { mode: "custom", start: addDays(today, 1 - len), end: today } : periodFor(p.mode, today));
      drawResults();
    });
    const onRange = () => {
      const s = $("#pStart").value, e = $("#pEnd").value;
      if (!s || !e) return;
      const r = clampRange(s, e);
      if (r.clamped) msg(__("A range can be at most {n} days.", { n: MAX_RANGE_DAYS }));
      setPeriod(r);
      drawResults();
    };
    if ($("#pStart")) { $("#pStart").addEventListener("change", onRange); $("#pEnd").addEventListener("change", onRange); }
    bindActions(box);
    bindDays(box);
  };
  const upd = () => { state.filter = { q: $("#fq").value, account: $("#faccount").value, type: $("#ftype").value, tag: $("#ftag").value }; countF(); drawResults(); };
  ["faccount", "ftype", "ftag"].forEach((id) => $("#" + id).addEventListener("change", upd));
  $("#fq").addEventListener("input", upd);
  $("#clearF").addEventListener("click", () => { state.filter = { q: "", account: "", type: "", tag: "" }; render(); });
  countF();
  drawResults();
  if (state.scrollToExpected && $("#expectedSec")) $("#expectedSec").scrollIntoView({ block: "start" });
  state.scrollToExpected = false;
}

const owedText = (a) => __("{owed} owed of {limit} ({pct}%)", { owed: fmt(a.owedMinor, a.currency), limit: fmt(a.limitMinor, a.currency), pct: Math.round((a.utilisation || 0) * 100) });
// Account icons (ADR 0005): accounts have no type, the user picks an icon. 24px stroke paths.
const ACCOUNT_ICONS = {
  bank: [N_("Bank"), "M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"],
  savings: [N_("Savings"), "M3 4h18v4H3zM5 8v12h14V8M10 12h4"],
  cash: [N_("Cash"), "M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01"],
  card: [N_("Card"), "M3 6h18v12H3zM3 10h18M7 15h4"],
  wallet: [N_("Wallet"), "M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 14h.01"],
  phone: [N_("Phone"), "M7 2h10v20H7zM11 18h2"],
  coins: [N_("Coins"), "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"],
  investment: [N_("Investment"), "M3 20h18M6 16l4-5 3 3 6-7M15 7h4v4"],
  loan: [N_("Loan"), "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6"],
  home: [N_("Home"), "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"],
  car: [N_("Car"), "M3 13l2-6h14l2 6v5H3zM3 13h18M7 18v2M17 18v2M7 15.5h.01M17 15.5h.01"],
  travel: [N_("Travel"), "M22 2 11 13M22 2l-7 20-4-9-9-4z"],
  gift: [N_("Gift"), "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8c-1-3-4-4.5-5-3s1 3 5 3zM12 8c1-3 4-4.5 5-3s-1 3-5 3z"],
  work: [N_("Work"), "M3 7h18v13H3zM8 7V4h8v3M3 12h18"],
  shop: [N_("Shop"), "M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6"],
  globe: [N_("Globe"), "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"],
};
const iconName = (a) => (a && ACCOUNT_ICONS[a.icon] ? a.icon : a && a.kind === "external" ? "globe" : "bank");
const iconSvg = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${ACCOUNT_ICONS[name][1]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const accIcon = (a) => `<span class="aicon${a.kind === "external" ? " ext" : ""}" aria-hidden="true">${iconSvg(iconName(a))}</span>`;
// the newest transaction touching an account, and how many there are
function accountActivity(id) {
  const list = state.data.transactions.filter((t) => t.accountId === id || t.fromAccountId === id || t.toAccountId === id);
  const last = list.filter((t) => t.state === "posted").reduce((m, t) => (t.date > m ? t.date : m), "");
  return { n: list.length, last };
}
function accountCard(a) {
  const act = accountActivity(a.id), neg = a.balanceMinor < 0;
  let detail = "";
  if (a.limitMinor) {
    const u = (a.utilisation || 0) * 100;
    detail = `<span class="bar"><i class="${barCls(u)}" style="width:${Math.min(100, u)}%"></i></span><span class="tfoot"><small>${esc(owedText(a))}</small></span>`;
  } else if (a.allocatedMinor > 0) {
    const e = a.balanceMinor > 0 ? Math.min(100, a.allocatedMinor / a.balanceMinor * 100) : 100;
    detail = `<span class="splitbar"><i class="earmarked" style="width:${e}%"></i></span>
      <span class="tfoot"><small><b class="dot free"></b>${esc(__("Free {amount}", { amount: fmt(a.unallocatedMinor, a.currency) }))}</small><small><b class="dot earmarked"></b>${esc(__("Earmarked {amount}", { amount: fmt(a.allocatedMinor, a.currency) }))}</small></span>`;
  }
  return `<button type="button" class="tcard acard" data-detail-account="${esc(a.id)}">
    <span class="thead">${accIcon(a)}<span class="aname"><b>${esc(a.name)}</b></span></span>
    <span class="bamount${neg ? " neg" : ""}"><b>${fmt(a.balanceMinor, a.currency)}</b></span>
    ${detail}
    <small class="last">${esc(act.last ? __("Last activity {date}", { date: dayLabel(act.last) }) : __("No transactions yet"))}</small></button>`;
}
// the "add" tile that ends a card grid
const addTile = (id, label, cls = "") => `<button type="button" class="addtile ${cls}" id="${id}"><span aria-hidden="true">+</span>${esc(label)}</button>`;
function screenAccounts(v) {
  const accs = state.data.accounts;
  // totals per currency: what you have, and how much of it money boxes claim
  const curs = [...new Set(accs.map((a) => a.currency))];
  const totals = curs.map((c) => {
    const xs = accs.filter((a) => a.currency === c), sum = (k) => xs.reduce((n, a) => n + (a[k] || 0), 0);
    return `<div class="totcard"><span class="lab">${esc(__("Total"))}</span><b>${fmt(sum("balanceMinor"), c)}</b>
      <small>${esc(__("{n} account(s)", { n: xs.length }))}${sum("allocatedMinor") ? " · " + esc(__("Earmarked {amount}", { amount: fmt(sum("allocatedMinor"), c) })) : ""}</small></div>`;
  }).join("");
  const ordered = accs; // by name, as the server lists them
  const exts = state.data.externals.map((a) => {
    const act = accountActivity(a.id);
    return `<button type="button" class="xcard" data-detail-account="${esc(a.id)}">${accIcon(a)}<span><b>${esc(accName(a.id))}</b><small>${esc(__("{n} transaction(s)", { n: act.n }))}</small></span></button>`;
  }).join("");
  v.innerHTML = `<div class="totals">${totals}</div>
    <section class="tsection"><div class="tgrid">${ordered.map(accountCard).join("")}${addTile("newAccount", __("New account"), "")}</div></section>
    <section class="tsection"><div class="tsechead"><h3>${esc(__("External accounts"))}</h3></div>
      <div class="xgrid">${exts}${addTile("newExternal", __("New external account"), "small")}</div></section>`;
  $("#newAccount").addEventListener("click", () => openAccountDialog());
  $("#newExternal").addEventListener("click", () => openAccountDialog(null, "external"));
  bindDetails(v);
}

const scheduleText = (s) => lbl(FREQ_L, s.frequency) + (s.dayOfMonth ? " · " + __("day {n}", { n: s.dayOfMonth }) : "");
const isShortcut = (tp) => tp.schedule.frequency === "never";
function screenTemplates(v) {
  const name = (t) => ({ l: N_("Template"), v: `<button class="titlelink" data-detail-template="${esc(t.id)}">${esc(t.name)}</button>${t.template.expectedRangeMinor ? `<br><span class="chip due">${esc(__("variable {min}–{max}", { min: fmt(t.template.expectedRangeMinor.min, t.template.currency), max: fmt(t.template.expectedRangeMinor.max, t.template.currency) }))}</span>` : ""}` });
  const what = (t, l) => ({ l, v: `${esc(lbl(TYPE_L, flow(t.template)))} ${fmt(t.template.amountMinor, t.template.currency)}<br><span class="muted">${esc(transferAcct(t.template))}${[t.template.tagId, ...(t.template.tagIds || [])].filter(Boolean).map((id) => " → " + esc(tagName(id))).join("")}</span>` });
  const status = (t) => ({ l: N_("Status"), v: esc(t.enabled ? __("Enabled") : __("Paused")) });
  const all = state.data.transactionTemplates;
  const rows = all.filter((t) => !isShortcut(t)).map((t) => row([name(t), what(t, N_("Generates")),
    { l: N_("Schedule"), v: `${esc(scheduleText(t.schedule))}<br><span class="muted">${esc(__("from {date}", { date: t.schedule.startDate }))}</span>` },
    { l: N_("Next due"), v: esc(t.nextDue || "—") }, status(t)])).join("");
  const cuts = all.filter(isShortcut).map((t) => row([name(t), what(t, N_("Fills in")), status(t)])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Transaction templates"))}</h3><span><button class="smallbtn" id="genBtn">${esc(__("Generate due"))}</button> <button class="smallbtn" id="newTpl">${esc(__("+ New template"))}</button></span></div>
    ${rows ? table([{ t: "Template" }, { t: "Generates" }, { t: "Schedule" }, { t: "Next due" }, { t: "Status" }], rows) : `<div class="empty">${esc(__("No templates yet."))}</div>`}</section>
    <section class="panel"><div class="panelhead"><h3>${esc(__("Shortcuts"))}</h3><button class="smallbtn" id="newCut">${esc(__("+ New shortcut"))}</button></div>
    ${cuts ? table([{ t: "Template" }, { t: N_("Fills in") }, { t: "Status" }], cuts) : `<div class="empty">${esc(__("No shortcuts yet. In the add form, choose ⋯ and Save as template."))}</div>`}</section>`;
  $("#newTpl").addEventListener("click", () => openTemplateDialog());
  $("#newCut").addEventListener("click", () => openTemplateDialog(null, { name: "", template: null, schedule: { frequency: "never" } }));
  $("#genBtn").addEventListener("click", generateDue);
  bindDetails(v);
}

// One budget: how much of the limit is spent and what is left per day. While the period runs, the fill turns
// amber when spending is ahead of an even pace (a larger share spent than of the period gone), red when over.
function budgetCard(t) {
  const today = state.data.today, p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
  const total = spanDays(t.periodStart, t.periodEnd);
  const started = today >= t.periodStart, ended = today > t.periodEnd;
  const elapsed = !started ? 0 : ended ? 100 : spanDays(t.periodStart, today) / total * 100;
  const daysLeft = started && !ended ? spanDays(today, t.periodEnd) : 0;
  const running = started && !ended, ahead = running && p < 100 && p > elapsed;
  const cls = running ? (p >= 100 ? "over" : ahead ? "warn" : "") : barCls(p);
  const left = t.remainingMinor >= 0 ? __("{amount} left", { amount: fmt(t.remainingMinor, t.currency) }) : __("{amount} over", { amount: fmt(-t.remainingMinor, t.currency) });
  const pace = !started ? __("Starts {date}", { date: dayLabel(t.periodStart) }) : ended ? __("Ended {date}", { date: dayLabel(t.periodEnd) })
    : t.remainingMinor > 0 ? __("{amount} a day for {n} day(s)", { amount: fmt(Math.floor(t.remainingMinor / daysLeft), t.currency, true), n: daysLeft }) : __("{n} day(s) left", { n: daysLeft });
  return `<button type="button" class="tcard bcard ${cls}" data-detail-tag="${esc(t.id)}">
    <span class="thead"><b>${esc(t.name)}</b><small>${esc(budgetPeriodText(t))}</small></span>
    <span class="bamount"><b>${fmt(t.spentMinor, t.currency)}</b> <small>${esc(__("of {limit}", { limit: fmt(t.limitMinor, t.currency) }))}</small></span>
    <span class="bar"${ahead ? ` title="${esc(__("Spending faster than the period"))}"` : ""}><i class="${cls}" style="width:${Math.min(100, p)}%"></i></span>
    <span class="tfoot"><span class="${t.remainingMinor < 0 ? "neg" : ""}">${esc(left)}</span><small>${esc(pace)}</small></span></button>`;
}
// spending this month per currency for one category, from the server's monthly summary
const monthSpend = (id) => (state.data.spendingThisMonth || []).filter((x) => x.tagId === id).map((x) => fmt(x.amountMinor, x.currency)).join(" · ");
const tagUses = (id) => state.data.transactions.filter((t) => t.tagId === id || txnCats(t).includes(id)).length;
function categoryCard(t) {
  const spent = monthSpend(t.id), n = tagUses(t.id);
  return `<button type="button" class="tcard ccard" data-detail-tag="${esc(t.id)}">
    <span class="thead"><b>${esc(t.name)}</b><small>${esc(__("{n} transaction(s)", { n }))}</small></span>
    <span class="tfoot"><span>${spent ? esc(__("{amount} this month", { amount: spent })) : `<small>${esc(__("Nothing spent this month"))}</small>`}</span></span></button>`;
}
// One money box: saved of target, with the bar split by the accounts holding the money.
const BOX_COLORS = ["#5b2a86", "#8a5cb8", "#b79ad6", "#c9a86a", "#7d6f99"];
function boxCard(t) {
  const allocs = goalAllocations(t.id), scale = Math.max(t.targetMinor, t.savedMinor) || 1;
  const segs = allocs.map(([, val], i) => `<i style="width:${val / scale * 100}%;background:${BOX_COLORS[i % BOX_COLORS.length]}"></i>`).join("");
  const legend = allocs.map(([id, val], i) => `<small><b class="dot" style="background:${BOX_COLORS[i % BOX_COLORS.length]}"></b>${esc(accName(id))} ${fmt(val, t.currency)}</small>`).join("");
  return `<button type="button" class="tcard gcard" data-detail-goal="${esc(t.id)}">
    <span class="thead"><b>${esc(t.name)}</b><small>${esc(t.targetDate ? __("by {date}", { date: dayLabel(t.targetDate) }) : "")}</small></span>
    <span class="bamount"><b>${fmt(t.savedMinor, t.currency)}</b> <small>${esc(__("of {limit}", { limit: fmt(t.targetMinor, t.currency) }))}</small></span>
    <span class="stack">${segs}</span>
    <span class="boxlegend">${legend || `<small>${esc(__("No allocations yet"))}</small>`}</span></button>`;
}
function screenTags(v) {
  const tags = state.data.tags;
  const budgets = tags.filter((t) => t.kind === "category" && t.limitMinor !== undefined);
  const cats = tags.filter((t) => t.kind === "category" && t.limitMinor === undefined);
  const boxes = tags.filter((t) => t.kind === "goal");
  // each grid ends with its "add" tile; budgets come from categories, so they have none
  const section = (title, list, card, tail) => `<section class="tsection"><div class="tsechead"><h3>${esc(title)}</h3></div>
    ${list.length || tail ? `<div class="tgrid">${list.map(card).join("")}${tail}</div>` : `<div class="empty">${esc(__("No budgets yet. Give a category a limit to track it here."))}</div>`}</section>`;
  v.innerHTML = section(__("Budgets"), budgets, budgetCard, "")
    + section(__("Categories"), cats, categoryCard, addTile("newCategory", __("New category")))
    + section(__("Money boxes"), boxes, boxCard, addTile("newBox", __("New money box")));
  $("#newCategory").addEventListener("click", () => openTagDialog("category"));
  $("#newBox").addEventListener("click", () => openTagDialog("goal"));
  bindDetails(v);
}

// Settings: sections of label | control rows; on wide screens a sticky list of the sections.
const SET_ICON = {
  region: ACCOUNT_ICONS.globe[1],
  money: ACCOUNT_ICONS.coins[1],
  display: "M3 4h18v16H3zM3 9h18M9 9v11",
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  data: "M12 3v12M7 10l5 5 5-5M4 19h16",
  about: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7h.01",
};
const setIcon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${SET_ICON[k]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function screenSettings(v) {
  const src = state.about && state.about.sourceUrl;
  const pref = (state.general && state.general.language) || "";
  const langOpts = [["", __("Browser default")], ...Object.entries(LANGS)].map(([k, name]) => `<option value="${esc(k)}" ${k === pref ? "selected" : ""} ${k ? `lang="${esc(k)}"` : ""}>${esc(name)}</option>`).join("");
  const row = (label, control, forId) => `<div class="srow"><${forId ? `label for="${forId}"` : "span"} class="sl">${esc(label)}</${forId ? "label" : "span"}><div class="sc">${control}</div></div>`;
  const select = (id, opts) => `<select id="${id}">${opts}</select>`;
  const SECTIONS = [
    ["region", __("Language & region"), [
      row(__("Language"), select("setLang", langOpts), "setLang"),
      row(__("Time zone"), select("setTz", `<option value="">${esc(__("Auto (this device · {zone})", { zone: deviceTZ().replace(/_/g, " ") }))}</option>${zoneOptions(state.general && state.general.timeZone)}`), "setTz"),
      row(__("Number format"), select("setNumFmt", enumOptions(NUMFMT_L, Object.keys(NUMFMT_L), numberFormat())), "setNumFmt"),
    ]],
    ["money", __("Money"), [
      row(__("Default currency"), select("setDefCur", favCurs().map((c) => curOption(c, defCur())).join("")), "setDefCur"),
      row(__("Frequently used currencies"), `<div class="curchips">${favCurs().map((c) => `<span class="chip cur${c === defCur() ? " def" : ""}" title="${esc(curName(c))}">${esc(c)}<button type="button" data-cur-del="${esc(c)}" aria-label="${esc(__("Remove {currency}", { currency: c }))}" ${c === defCur() ? "disabled" : ""}>×</button></span>`).join("")}
        <select id="setAddCur" class="addchip" aria-label="${esc(__("Add currency"))}"><option value="">${esc(__("+ Add currency…"))}</option>${ALL_CURRENCIES.filter((c) => !favCurs().includes(c)).map((c) => curOption(c, "")).join("")}</select></div>`),
    ]],
    ["display", __("Display"), [
      row(__("Page width"), select("setWidth", enumOptions(WIDTH_L, Object.keys(WIDTH_L), pageWidth())), "setWidth"),
      row(__("Days open by default"), select("setOpenDays", [...new Set([...OPEN_DAY_CHOICES, openDays()])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === openDays() ? "selected" : ""}>${n}</option>`).join("")), "setOpenDays"),
    ]],
    ["data", __("Data"), [
      row(__("Export all data"), `<div class="sbtns"><a class="smallbtn" href="api/export" download>${esc(__("Export JSON"))}</a></div>`),
    ]],
    ["about", __("About"), [
      `<div class="sabout"><span class="slogo" lang="nan-Hant-TW">記數通</span><span><b>KiSiauThong</b></span></div>`,
      row(__("License"), '<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0-or-later</a>'),
      row(__("Source"), src ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(src)}</a>` : `<span class="muted">${esc(__("Set KISIAUTHONG_SOURCE_URL"))}</span>`),
    ]],
  ];
  v.innerHTML = `<div class="settings">
    <nav class="snav" aria-label="${esc(__("Settings"))}">${SECTIONS.map(([k, title]) => `<button type="button" data-goto="${k}">${setIcon(k)}${esc(title)}</button>`).join("")}</nav>
    <div class="sbody">${SECTIONS.map(([k, title, rows]) => `<section class="ssec" id="set-${k}"><h3>${esc(title)}</h3><div class="scard">${rows.join("")}</div></section>`).join("")}</div></div>`;
  // the router owns location.hash, so section links scroll instead of navigating
  v.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => $("#set-" + b.dataset.goto).scrollIntoView({ behavior: "smooth", block: "start" })));
  const saveGeneral = async (patch, done) => {
    try {
      const s = await put("/api/settings", { general: patch });
      state.general = s.general;
      setLang(pickLang(state.general.language));
      applyPageWidth();
      msg(done());
    } catch (err) { errMsg(err); }
    render();
  };
  $("#setLang").addEventListener("change", (e) => saveGeneral({ language: e.target.value }, () => __("Language saved.")));
  $("#setDefCur").addEventListener("change", (e) => saveGeneral({ defaultCurrency: e.target.value }, () => __("Default currency saved.")));
  $("#setNumFmt").addEventListener("change", (e) => saveGeneral({ numberFormat: e.target.value }, () => __("Number format saved.")));
  $("#setWidth").addEventListener("change", (e) => saveGeneral({ pageWidth: e.target.value }, () => __("Page width saved.")));
  $("#setTz").addEventListener("change", (e) => saveGeneral({ timeZone: e.target.value }, () => __("Time zone saved.")));
  $("#setOpenDays").addEventListener("change", (e) => { state.dayOpen = {}; saveGeneral({ openDays: parseInt(e.target.value, 10) }, () => __("Days open by default saved.")); });
  $("#setAddCur").addEventListener("change", (e) => { const c = e.target.value; if (c) saveGeneral({ currencies: [...favCurs(), c] }, () => __("{currency} added.", { currency: c })); });
  v.querySelectorAll("[data-cur-del]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.curDel;
    saveGeneral({ currencies: favCurs().filter((x) => x !== c) }, () => __("{currency} removed.", { currency: c }));
  }));
}

/* ---------- drawer, dialogs, actions ---------- */
const isGoal = (t) => t.kind === "goal";
const isDecision = (type) => type === "allocate";
// tagOptions lists the tags pick() accepts; money boxes (goal tags) are only for allocations.
function tagOptions(sel, pick, allowNone = true) {
  const tags = state.data.tags.filter(pick || (() => true));
  const opts = tags.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}${pick ? "" : ` (${esc(lbl(TAGKIND_L, t.kind))})`}</option>`).join("");
  if (allowNone) return `<option value="">${esc(__("— none —"))}</option>` + opts;
  return opts || `<option value="">${esc(__("No money boxes yet."))}</option>`;
}
// own accounts, the most used in the last 90 days first; ties keep your order
function accountsByUse() {
  const since = addDays(state.data.today, -90), n = {};
  state.data.transactions.forEach((t) => { if (t.date >= since) [t.accountId, t.fromAccountId, t.toAccountId].forEach((id) => { if (id) n[id] = (n[id] || 0) + 1; }); });
  return state.data.accounts.map((a, i) => ({ a, n: n[a.id] || 0, i })).sort((x, y) => y.n - x.n || x.i - y.i).map((x) => x.a);
}
const accOption = (a, sel) => `<option value="${esc(a.id)}" ${a.id === sel ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`;
function fillSelects() {
  $("#fAccount").innerHTML = accountsByUse().map((a) => accOption(a)).join("");
  // the anonymous external account first, then named ones
  const ext = [...state.data.externals].sort((a, b) => (a.id === EXT_ID ? -1 : b.id === EXT_ID ? 1 : a.name.localeCompare(b.name)));
  $("#fExt").innerHTML = ext.map((a) => `<option value="${esc(a.id)}">${esc(accName(a.id))}</option>`).join("");
}
// A transfer stays in one currency: the target list holds the other accounts in the source's currency.
function refreshToAccounts(sel) {
  const from = state.data.accounts.find((a) => a.id === $("#fAccount").value);
  const list = from ? accountsByUse().filter((a) => a.id !== from.id && a.currency === from.currency) : [];
  $("#fToAccount").innerHTML = list.map((a) => accOption(a, sel)).join("");
  $("#fToAccount").disabled = !list.length;
  const none = state.txnType === "transfer" && from && !list.length;
  $("#fToNone").hidden = !none;
  $("#fToNone").textContent = none ? __("No other {currency} account. To move money into another currency, record spending in one account and income in the other.", { currency: from.currency }) : "";
}
// Categories are toggles: a transaction can have several (ADR 0010).
function drawCats(sel, box = $("#fCats")) {
  const cats = state.data.tags.filter((t) => !isGoal(t));
  box.innerHTML = cats.length ? cats.map((t) => `<button type="button" data-cat="${esc(t.id)}" aria-pressed="${sel.includes(t.id)}">${esc(t.name)}</button>`).join("")
    : `<small class="muted">${esc(__("No categories yet."))}</small>`;
  box.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true")));
}
const pickedCats = (box = $("#fCats")) => [...box.querySelectorAll("[data-cat][aria-pressed=true]")].map((b) => b.dataset.cat);
// One-tap fills for the add form: shortcuts (templates that never repeat, ADR 0012), the most used first,
// then what you entered at least twice in the last 60 days that no shortcut covers.
function quickPicks() {
  const today = state.data.today, key = (t, title) => [flow(t), ownAcc(t), title].join("|");
  const recent = state.data.transactions.filter((t) => t.state === "posted" && t.note && t.date >= addDays(today, -90) && t.date <= today);
  const uses = {};
  recent.forEach((t) => { const k = key(t, t.note); uses[k] = (uses[k] || 0) + 1; });
  const picks = state.data.transactionTemplates.filter((tp) => tp.enabled && isShortcut(tp)).map((tp) => {
    const title = tp.template.note || tp.name;
    return { label: tp.name, title, t: tp.template, n: uses[key(tp.template, title)] || 0 };
  }).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const covered = new Set(picks.map((p) => key(p.t, p.title))), groups = {};
  recent.filter((t) => t.date >= addDays(today, -60) && (flow(t) === "expense" || flow(t) === "income")).forEach((t) => {
    const k = key(t, t.note), g = groups[k] || (groups[k] = { n: 0, t });
    g.n++;
    if (t.date + (t.time || "") > g.t.date + (g.t.time || "")) g.t = t; // the latest one gives amount, payee and tags
  });
  const often = Object.entries(groups).filter(([k, g]) => g.n >= 2 && !covered.has(k)).map(([, g]) => g)
    .sort((a, b) => b.n - a.n || b.t.date.localeCompare(a.t.date)).slice(0, 6);
  return [...picks, ...often.map((g) => ({ label: g.t.note, title: g.t.note, t: g.t }))];
}
function drawQuick(picks) {
  state.quick = picks;
  const box = $("#fQuick"), acc = (t) => (flow(t) === "transfer" ? t.fromAccountId : ownAcc(t));
  box.hidden = !picks.length;
  box.innerHTML = picks.map((p, i) => `<button type="button" class="qpick" data-pick="${i}" aria-pressed="false"><b>${esc(p.label)}</b><small>${esc(fmt(Math.abs(p.t.amountMinor), p.t.currency))} · ${esc(accName(acc(p.t)))}</small></button>`).join("");
  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => applyPick(state.quick[+b.dataset.pick], b)));
}
const setSel = (sel, v) => { if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; };
// fill the form from a pick; the date and time stay now, and the amount is ready to change
function applyPick(p, btn) {
  const t = p.t, mode = flow(t), el = $("#txnForm").elements;
  setSel(el.accountId, mode === "transfer" ? t.fromAccountId : ownAcc(t));
  setTxnType(mode, mode === "allocate" ? t.tagId : txnCats(t));
  if (mode === "transfer") refreshToAccounts(t.toAccountId);
  if (mode === "expense" || mode === "income") setSel($("#fExt"), extAcc(t) || EXT_ID);
  el.amount.value = decimal(t.amountMinor, t.currency);
  el.note.value = p.title;
  $("#fQuick").querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
  el.amount.focus();
  el.amount.select();
}
// setTxnType shows only the fields the type uses. tags: the money box id, or the category ids; kept when left out
function setTxnType(type, tags) {
  state.txnType = type;
  const decision = isDecision(type), transfer = type === "transfer";
  document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
  $("#fAccountLab").textContent = transfer ? __("From account") : __("Account");
  $("#fToWrap").hidden = !transfer;
  // expense/income are transfers to/from an external account; only ask which one when there is a choice
  const flowMode = type === "expense" || type === "income";
  $("#fExtWrap").hidden = !flowMode || state.data.externals.length < 2;
  $("#fExtLab").textContent = type === "income" ? __("Received from") : __("Paid to");
  $("#fTagWrap").hidden = !decision;
  $("#fCatsWrap").hidden = !flowMode;
  if (decision) $("#fTag").innerHTML = tagOptions(tags !== undefined ? tags : $("#fTag").value, isGoal, false);
  else if (tags !== undefined || !$("#fCats").childElementCount) drawCats(tags || []);
  $("#fTag").required = decision;
  const amount = $("#txnForm").elements.amount;
  if (decision) amount.removeAttribute("min"); else amount.min = "0.01";
  $("#fAmtNote").hidden = !decision;
  refreshToAccounts($("#fToAccount").value);
  syncActions();
}
// ⋯ beside Save: actions on the form (a transfer cannot become a template)
function syncActions() {
  $("#fSaveTpl").hidden = state.txnType === "transfer";
  $("#fMoreBtn").hidden = $("#fSaveTpl").hidden && $("#fDelete").hidden;
  showActions(false);
}
function showActions(open) {
  $("#fMoreMenu").hidden = !open;
  $("#fMoreBtn").setAttribute("aria-expanded", open);
  if (open) { const first = $("#fMoreMenu").querySelector("button:not([hidden])"); if (first) first.focus(); }
}
$("#fMoreBtn").addEventListener("click", () => showActions($("#fMoreMenu").hidden));
document.addEventListener("click", (e) => { if (!$("#fMoreMenu").hidden && !e.target.closest("#fMoreMenu, #fMoreBtn")) showActions(false); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("#fMoreMenu").hidden) return;
  e.stopImmediatePropagation();
  showActions(false);
  $("#fMoreBtn").focus();
}, true);
$("#fSaveTpl").addEventListener("click", () => {
  showActions(false);
  const { body } = formBody();
  openTemplateDialog(null, { name: body.note, template: body, schedule: { frequency: "never" } });
});
function openDrawer(type, tag) {
  state.editingTxn = null;
  $("#fDelete").hidden = true;
  fillSelects();
  $("#txnForm").reset();
  $("#fCats").innerHTML = "";
  // now, as this device's clock shows it (not UTC: before 08:00 in Taipei that was still yesterday)
  const now = zoneParts(new Date(), deviceTZ()), el = $("#txnForm").elements;
  el.date.value = now.date; el.time.value = now.time; $("#fTz").innerHTML = zoneOptions(deviceTZ());
  syncTz();
  setTxnType(type || "expense", type === "allocate" ? tag : tag ? [tag] : []);
  drawQuick(tag ? [] : quickPicks());
  $("#fPlannedNote").hidden = true;
  $("#drawerTitle").textContent = type === "allocate" ? __("Allocate to money box") : __("Add transaction");
  $("#drawer").hidden = false; $("#drawerBackdrop").hidden = false;
}
function openEditTxn(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  state.editingTxn = id;
  fillSelects();
  const form = $("#txnForm");
  form.reset();
  const mode = flow(t);
  form.elements.accountId.value = mode === "transfer" ? t.fromAccountId : ownAcc(t);
  setTxnType(mode, mode === "allocate" ? t.tagId : txnCats(t));
  if (mode === "transfer") refreshToAccounts(t.toAccountId);
  if (mode === "expense" || mode === "income") $("#fExt").value = extAcc(t);
  form.elements.amount.value = decimal(t.amountMinor, t.currency);
  form.elements.date.value = t.date;
  form.elements.time.value = t.time || "";
  $("#fTz").innerHTML = zoneOptions(t.tz || deviceTZ());
  syncTz();
  form.elements.note.value = t.note || "";
  form.elements.memo.value = t.memo || "";
  // an expected transaction is confirmed by saving it here
  const tpl = t.state === "planned" && state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  const range = tpl && tpl.template.expectedRangeMinor;
  $("#fPlannedNote").hidden = t.state !== "planned";
  $("#fPlannedNote").textContent = t.state !== "planned" ? "" : __("Expected on {date}, not confirmed yet. Check the amount and save to confirm it.", { date: dayLabel(t.date) })
    + (range ? " " + __("Expected range {min} – {max}.", { min: fmt(range.min, t.currency), max: fmt(range.max, t.currency) }) : "");
  $("#drawerTitle").textContent = t.state === "planned" ? __("Confirm expected transaction") : __("Edit transaction");
  $("#fDelete").hidden = false;
  drawQuick([]);
  syncActions();
  $("#drawer").hidden = false; $("#drawerBackdrop").hidden = false;
}
function closeDrawer() { $("#drawer").hidden = true; $("#drawerBackdrop").hidden = true; }
$("#drawerClose").addEventListener("click", closeDrawer);
// the zone only matters with a time, so it is shown only while a time is entered
function syncTz() { const el = $("#txnForm").elements; $("#fTzWrap").hidden = !el.time.value; }
$("#txnForm").elements.time.addEventListener("input", syncTz);
$("#fDelete").addEventListener("click", async () => { showActions(false); if (state.editingTxn && await deleteTxn(state.editingTxn)) { state.editingTxn = null; closeDrawer(); } });
$("#drawerBackdrop").addEventListener("click", closeDrawer);
document.querySelectorAll("#typeSeg button").forEach((b) => b.addEventListener("click", () => setTxnType(b.dataset.type)));
$("#fAccount").addEventListener("change", () => refreshToAccounts($("#fToAccount").value));
$("#addBtn").addEventListener("click", () => openDrawer("expense"));
$("#tabAdd").addEventListener("click", () => openDrawer("expense"));
// More (phones): a sheet with the pages the tab bar has no room for
function showMore(open) {
  $("#moreSheet").hidden = $("#moreBack").hidden = !open;
  $("#tabMore").setAttribute("aria-expanded", open);
  if (open) $("#moreSheet a").focus();
}
$("#tabMore").addEventListener("click", () => showMore($("#moreSheet").hidden));
$("#moreBack").addEventListener("click", () => showMore(false));
$("#moreSheet").addEventListener("click", (e) => { if (e.target.closest("a")) showMore(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#moreSheet").hidden) { showMore(false); $("#tabMore").focus(); } });

// the transaction the form describes, in the API's shape; f: the raw fields
function formBody() {
  const f = Object.fromEntries(new FormData($("#txnForm")).entries());
  const cur = accCur(f.accountId), type = state.txnType;
  const body = { type, accountId: f.accountId, amountMinor: toMinor(f.amount, cur), currency: cur, date: f.date, note: f.note || "", memo: f.memo || "", time: f.time || "", tz: f.time ? f.tz : "", state: "posted" }; // saving confirms an expected transaction
  if (type === "expense" || type === "income") { // stored as a transfer with an external side
    const ext = f.extAccountId || EXT_ID;
    Object.assign(body, { type: "transfer", accountId: "", fromAccountId: type === "expense" ? f.accountId : ext, toAccountId: type === "expense" ? ext : f.accountId });
    body.tagIds = pickedCats();
  } else if (type === "transfer") { body.fromAccountId = f.accountId; body.toAccountId = f.toAccountId; body.accountId = ""; }
  else if (f.tagId) body.tagId = f.tagId;
  return { f, cur, type, body };
}
$("#txnForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { f, cur, type, body } = formBody();
  if (type === "transfer" && !f.toAccountId) { msg($("#fToNone").textContent || __("Choose an account to transfer to."), "error"); return; }
  if (toMinor(f.amount, cur) === 0) { msg(__("Enter an amount other than zero."), "error"); return; }
  if (type === "allocate" && toMinor(f.amount, cur) < 0) { // the server refuses this too; say it with the amount first
    const held = state.data.transactions.filter((t) => t.id !== state.editingTxn && t.type === "allocate" && t.state === "posted" && t.accountId === f.accountId && t.tagId === f.tagId).reduce((n, t) => n + t.amountMinor, 0);
    if (held + toMinor(f.amount, cur) < 0) { msg(__("{box} holds {amount} in {account}; you can take out at most that.", { box: tagName(f.tagId), amount: fmt(Math.max(0, held), cur), account: accName(f.accountId) }), "error"); return; }
  }
  try {
    if (state.editingTxn) { await put("/api/transactions/" + state.editingTxn, body); msg(__("Transaction updated.")); }
    else { await post("/api/transactions", body); msg(__("Saved.")); }
    state.editingTxn = null; closeDrawer(); await load();
  } catch (err) { errMsg(err); }
});

function openDialog(title, html) {
  $("#dialogTitle").textContent = title;
  $("#dialogBody").innerHTML = html;
  $("#dialog").showModal();
}
// field(label, control): one labelled form control; label is an English source string
const field = (label, control, cls) => `<label${cls ? ` class="${cls}"` : ""}><span>${esc(__(label))}</span>${control}</label>`;
// extra: secondary buttons (type="button") shown above the submit button
function dialogForm(fields, submitLabel, extra = "") {
  return `<form id="dialogForm">${fields}${extra ? `<div class="formactions">${extra}</div>` : ""}<button class="primarybtn big" type="submit">${esc(submitLabel)}</button></form>`;
}
const onDlg = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener("click", () => { $("#dialog").close(); fn(); }); };
const iconPicker = (sel) => `<fieldset class="iconpick"><legend>${esc(__("Icon"))}</legend>${Object.entries(ACCOUNT_ICONS).map(([k, [label]]) =>
  `<label title="${esc(__(label))}"><input type="radio" name="icon" value="${k}" ${k === sel ? "checked" : ""} aria-label="${esc(__(label))}"><span class="aicon">${iconSvg(k, 20)}</span></label>`).join("")}</fieldset>`;
function openAccountDialog(editId, presetKind) {
  const a = editId ? accById(editId) : null, ext = a ? a.kind === "external" : presetKind === "external";
  openDialog(a ? __("Edit account") : ext ? __("New external account") : __("New account"), dialogForm(
    field(N_("Name"), `<input name="name" required maxlength="100" placeholder="${esc(ext ? __("Employer") : __("Savings A"))}" value="${a ? esc(accName(a.id)) : ""}">`, ext ? "wide" : "") +
    (ext ? "" : field("Currency", `<select name="currency" required>${currencyOptions(a && a.currency)}</select>`) +
      field(N_("Opening balance"), `<input name="opening" type="number" step="any" value="${a ? decimal(a.openingBalanceMinor, a.currency) : "0"}">`) +
      // a card or a loan is an account that runs negative; its limit tracks how much is owed
      field(N_("Limit"), `<input name="limit" type="number" step="any" min="0.01" placeholder="${esc(__("Optional"))}" value="${a && a.limitMinor ? decimal(a.limitMinor, a.currency) : ""}">`)) +
    iconPicker(iconName(a || { kind: ext ? "external" : "own" })),
    a ? __("Save changes") : __("Add account")));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = (f.currency || "").toUpperCase();
    const body = ext ? { name: f.name, kind: "external", icon: f.icon }
      : { name: f.name, kind: "own", icon: f.icon, currency: cur, openingBalanceMinor: toMinor(f.opening, cur) };
    if (!ext && a) { body.statementCloseDay = a.statementCloseDay; body.paymentDueDay = a.paymentDueDay; }
    if (!ext && f.limit) body.limitMinor = toMinor(f.limit, cur);
    try {
      if (a) { await put("/api/accounts/" + a.id, body); msg(__("Account updated.")); } else { await post("/api/accounts", body); msg(__("Account added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
// first day of the calendar period holding `iso`, for anchoring "every N" budgets started today
function calendarStart(cycle, iso) {
  const d = parseDay(iso);
  if (cycle === "weekly") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (cycle === "monthly") d.setDate(1);
  if (cycle === "yearly") { d.setMonth(0); d.setDate(1); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const moneyField = (label, name, minor, cur, cls) => field(label, `<span class="moneyrow"><select name="${name}Cur" aria-label="${esc(__("Currency"))}">${currencyOptions(cur)}</select><input name="${name}" type="number" step="any" min="0.01" value="${minor != null ? decimal(minor, cur) : ""}"></span>`, cls);
function openTagDialog(kind, editId) {
  const t = editId ? state.data.tags.find((x) => x.id === editId) : null;
  const k = t ? t.kind : kind || "category", cur = (t && t.currency) || defCur();
  const hasBudget = !!(t && t.limitMinor !== undefined);
  const cyc = (t && t.cycle) || "monthly", every = (t && t.cycleEvery) || 1;
  const preset = !hasBudget ? "monthly:1" : cyc === "range" ? "range" : BUDGET_PRESETS.some(([c, n]) => c === cyc && n === every) ? `${cyc}:${every}` : "custom";
  const presetOpts = BUDGET_PRESETS.map(([c, n]) => `<option value="${c}:${n}" ${preset === `${c}:${n}` ? "selected" : ""}>${esc(cycleName(c, n))}</option>`).join("")
    + `<option value="custom" ${preset === "custom" ? "selected" : ""}>${esc(__("Custom…"))}</option><option value="range" ${preset === "range" ? "selected" : ""}>${esc(__("Date range"))}</option>`;
  openDialog(t ? (k === "goal" ? __("Edit money box") : __("Edit category")) : k === "goal" ? __("New money box") : __("New category"), dialogForm(
    field("Name", `<input name="name" required maxlength="100" placeholder="${esc(k === "goal" ? __("House fund") : __("Food"))}" value="${t ? esc(t.name) : ""}">`) +
    (t ? field("Kind", `<select name="kind">${enumOptions(TAGKIND_L, ["category", "goal"], k)}</select>`) : `<input type="hidden" name="kind" value="${esc(k)}">`) +
    `<label class="checkline f-category"><input type="checkbox" name="hasBudget" ${hasBudget ? "checked" : ""}> ${esc(__("Set a budget"))}</label>` +
    moneyField(N_("Limit"), "limit", t && t.limitMinor, cur, "f-budget") +
    field(N_("Period"), `<select name="preset">${presetOpts}</select>`, "f-budget") +
    field(N_("Every"), `<span class="moneyrow"><input name="every" type="number" min="1" max="99" value="${every}"><select name="unit">${enumOptions(CYCLE_UNIT_L, Object.keys(CYCLE_UNIT_L), cyc === "range" ? "monthly" : cyc)}</select></span>`, "f-budget f-custom") +
    field(N_("First period starts"), `<input name="anchor" type="date" value="${t && cyc !== "range" ? esc(t.cycleStart || "") : ""}">`, "f-budget f-anchor") +
    field(N_("From"), `<input name="rangeStart" type="date" value="${t && cyc === "range" ? esc(t.cycleStart || "") : ""}">`, "f-budget f-range") +
    field(N_("To"), `<input name="rangeEnd" type="date" value="${t && cyc === "range" ? esc(t.cycleEnd || "") : ""}">`, "f-budget f-range") +
    moneyField(N_("Target amount"), "target", t && t.targetMinor, cur, "f-goal") +
    field("Target date", `<input name="targetDate" type="date" value="${t ? esc(t.targetDate || "") : ""}">`, "f-goal"),
    t ? __("Save changes") : k === "goal" ? __("Add money box") : __("Add category"),
    t && t.kind === "goal" ? `<button type="button" class="smallbtn" id="dlgAlloc">${esc(__("Allocate"))}</button><button type="button" class="smallbtn" id="dlgHistory">${esc(__("History"))}</button>` : ""));
  onDlg("dlgAlloc", () => openDrawer("allocate", t.id));
  onDlg("dlgHistory", () => showHistory(t.id));
  const form = $("#dialogForm"), el = form.elements;
  const sync = () => {
    const goal = el.kind.value === "goal", budget = !goal && el.hasBudget.checked, pre = el.preset.value;
    // hidden fields are disabled too, so they are neither validated nor submitted
    const show = (cls, on) => form.querySelectorAll(cls).forEach((x) => { x.hidden = !on; x.querySelectorAll("input,select").forEach((c) => { c.disabled = !on; }); });
    show(".f-category", !goal);
    show(".f-budget", budget);
    show(".f-custom", budget && pre === "custom");
    show(".f-anchor", budget && pre !== "range");
    show(".f-range", budget && pre === "range");
    show(".f-goal", goal);
    el.limit.required = budget; el.rangeStart.required = el.rangeEnd.required = budget && pre === "range"; el.target.required = goal;
  };
  ["kind", "hasBudget", "preset"].forEach((n) => el[n] && el[n].addEventListener("change", sync));
  sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const body = { name: f.name.trim(), kind: f.kind };
    if (f.kind === "goal") {
      body.currency = f.targetCur; body.targetMinor = toMinor(f.target, f.targetCur);
      if (f.targetDate) body.targetDate = f.targetDate;
    } else if (f.hasBudget) {
      body.currency = f.limitCur; body.limitMinor = toMinor(f.limit, f.limitCur);
      if (f.preset === "range") Object.assign(body, { cycle: "range", cycleStart: f.rangeStart, cycleEnd: f.rangeEnd });
      else {
        const [cycle, n] = f.preset === "custom" ? [f.unit, parseInt(f.every, 10) || 1] : [f.preset.split(":")[0], parseInt(f.preset.split(":")[1], 10)];
        // an "every N" budget without a chosen start begins with the calendar period holding today
        Object.assign(body, { cycle, cycleEvery: n, cycleStart: f.anchor || (n > 1 ? calendarStart(cycle, state.data.today) : "") });
      }
    }
    try {
      if (t) { await put("/api/tags/" + t.id, body); msg(__("Tag updated.")); } else { await post("/api/tags", body); msg(f.kind === "goal" ? __("Money box added.") : __("Category added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
// editId: the template to edit; draft: the values of a new one (Save as template in the add form).
// A template that never repeats is a shortcut: it only fills in the add form (ADR 0012).
function openTemplateDialog(editId, draft) {
  const tp = editId ? state.data.transactionTemplates.find((x) => x.id === editId) : null;
  const src = tp || draft || null, body = src && src.template;
  const freq = src ? src.schedule.frequency || "monthly" : "monthly";
  const mode = body ? flow(body) : "expense", own = body ? ownAcc(body) : "";
  const acc = accountsByUse().map((a) => accOption(a, own)).join("");
  const rng = body && body.expectedRangeMinor ? body.expectedRangeMinor : null;
  const amt = body && body.amountMinor > 0 ? decimal(body.amountMinor, body.currency) : "";
  openDialog(tp ? __("Edit transaction template") : __("New transaction template"), dialogForm(
    field("Name", `<input name="name" required placeholder="${esc(__("Streaming"))}" value="${src ? esc(src.name || "") : ""}">`) +
    field("Generates", `<select name="type">${enumOptions(TYPE_L, ["expense", "income", "allocate"], mode)}</select>`) +
    field("Account", `<select name="accountId">${acc}</select>`) +
    field("Money box", `<select name="tagId">${tagOptions(body && body.tagId, isGoal, false)}</select>`, "f-goal") +
    field("Amount", `<input name="amount" type="number" step="any" min="0.01" required value="${amt}">`) +
    field(N_("Frequency"), `<select name="frequency">${enumOptions(FREQ_L, ["never", "monthly", "quarterly", "yearly", "weekly", "daily"], freq)}</select>`) +
    field(N_("Expected min (variable bill, optional)"), `<input name="rangeMin" type="number" step="any" value="${rng ? decimal(rng.min, body.currency) : ""}">`, "f-range") +
    field(N_("Expected max (variable bill, optional)"), `<input name="rangeMax" type="number" step="any" value="${rng ? decimal(rng.max, body.currency) : ""}">`, "f-range") +
    field(N_("Day of month"), `<input name="dayOfMonth" type="number" min="1" max="31" value="${src && src.schedule.dayOfMonth || 1}">`, "f-dom") +
    field(N_("Start date"), `<input name="startDate" type="date" value="${src ? esc(src.schedule.startDate || "") : ""}">`, "f-sched") +
    `<div class="drawerfield f-cats wide" role="group" aria-labelledby="tplCatsLab"><span id="tplCatsLab">${esc(__("Tags"))}</span><div class="tagpick" id="tplCats"></div></div>` +
    field("Title", `<input name="note" maxlength="200" value="${body ? esc(body.note || "") : ""}">`, "wide"),
    tp ? __("Save changes") : __("Add template"),
    tp ? `<button type="button" class="smallbtn" id="dlgToggle">${esc(tp.enabled ? __("Pause") : __("Resume"))}</button>${freq !== "never" ? `<button type="button" class="smallbtn" id="dlgGenerate">${esc(__("Generate due"))}</button>` : ""}` : ""));
  onDlg("dlgToggle", async () => {
    try { await post("/api/templates/" + tp.id + "/toggle"); msg(__("Template updated.")); await load(); } catch (e) { errMsg(e); }
  });
  onDlg("dlgGenerate", generateDue);
  const form = $("#dialogForm");
  drawCats(body && flow(body) !== "allocate" ? txnCats(body) : [], $("#tplCats"));
  const sync = () => {
    const alloc = form.elements.type.value === "allocate", never = form.elements.frequency.value === "never";
    const show = (sel, on) => form.querySelectorAll(sel).forEach((el) => { el.hidden = !on; });
    show(".f-goal", alloc);
    show(".f-cats", !alloc);
    show(".f-range", !alloc && !never);
    show(".f-sched", !never);
    show(".f-dom", ["monthly", "quarterly", "yearly"].includes(form.elements.frequency.value));
    form.elements.tagId.required = alloc;
    form.elements.startDate.required = !never;
  };
  form.elements.type.addEventListener("change", sync);
  form.elements.frequency.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = accCur(f.accountId);
    const tpl = { accountId: f.accountId, type: f.type, amountMinor: toMinor(f.amount, cur), currency: cur, note: f.note || "" };
    if (f.type === "allocate" && f.tagId) tpl.tagId = f.tagId;
    if (f.type !== "allocate") { // generates a transfer with an external side; keep a named one
      const ext = (body && flow(body) === f.type && namedExt(body)) || EXT_ID;
      Object.assign(tpl, { type: "transfer", accountId: "", fromAccountId: f.type === "expense" ? f.accountId : ext, toAccountId: f.type === "expense" ? ext : f.accountId });
      tpl.tagIds = pickedCats($("#tplCats"));
    }
    if (f.type !== "allocate" && f.frequency !== "never" && f.rangeMin && f.rangeMax) tpl.expectedRangeMinor = { min: toMinor(f.rangeMin, cur), max: toMinor(f.rangeMax, cur) };
    const schedule = f.frequency === "never" ? { frequency: "never" }
      : { frequency: f.frequency, interval: tp ? tp.schedule.interval || 1 : 1, dayOfMonth: parseInt(f.dayOfMonth, 10) || 1, startDate: f.startDate, endDate: tp ? tp.schedule.endDate || "" : "" };
    const out = { name: f.name, enabled: tp ? tp.enabled : true, template: tpl, schedule };
    try {
      if (tp) { await put("/api/templates/" + tp.id, out); msg(__("Template updated.")); } else { await post("/api/templates", out); msg(__("Template added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
function showHistory(tagId) {
  const list = state.data.transactions.filter((t) => t.tagId === tagId && t.type === "allocate")
    .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  openDialog(__("History — {name}", { name: tagName(tagId) }), list.length
    ? table([{ t: "Date" }, { t: N_("Decision") }, { t: "Account" }, { t: "Amount", num: 1 }], list.map((t) => row([{ l: "Date", v: esc(t.date) }, { l: "Decision", v: `${esc(lbl(TYPE_L, t.type))}${t.note ? " — " + esc(t.note) : ""}` }, { l: "Account", v: esc(accName(t.accountId)) }, { l: "Amount", v: esc(amountText(t)), num: 1 }])).join(""))
    : `<p class="muted">${esc(__("No allocations yet"))}</p>`);
}
async function generateDue() {
  try { const r = await post("/api/generate", {}); msg(__("Generated {n} due transaction(s).", { n: r.created })); await load(); }
  catch (e) { errMsg(e); }
}
/* ---------- notifications (derived from the data; only dismissals are stored) ---------- */
const NOTE_ICON = { warn: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", card: "M3 6h18v12H3zM3 10h18M7 15h4", check: "M5 13l4 4L19 7", clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" };
const noteIcon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${NOTE_ICON[k]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// notifications: what needs attention now. key identifies a notification for dismissal;
// month-scoped keys make budget and credit alerts come back next month.
function allNotifications() {
  const d = state.data;
  if (!d) return [];
  const month = d.today.slice(0, 7), out = [];
  d.transactions.filter((t) => t.state === "planned").sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id)).forEach((t) => out.push({
    key: "expected:" + t.id, rank: 0, level: "due", fixed: true, icon: typeIcon(t.type), title: txnTitle(t),
    body: __("Waiting for confirmation · {date} · {amount}", { date: dayLabel(t.date), amount: amountText(t) }),
    open: () => openEditTxn(t.id),
  }));
  d.tags.filter((t) => t.limitMinor > 0).forEach((t) => {
    const pct = Math.round(t.spentMinor / t.limitMinor * 100), body = __("{spent} of {limit} spent · {period}", { spent: fmt(t.spentMinor, t.currency), limit: fmt(t.limitMinor, t.currency), period: periodLabel({ start: t.periodStart, end: t.periodEnd }) });
    // keyed by period, so a dismissed alert comes back when the next period runs over
    if (pct >= 100) out.push({ key: `budget-over:${t.id}:${t.periodStart}`, rank: 1, level: "over", icon: noteIcon("warn"), title: __("{name} is over budget", { name: t.name }), body, open: () => openTagDialog(null, t.id) });
    else if (pct >= 80) out.push({ key: `budget-near:${t.id}:${t.periodStart}`, rank: 3, level: "warn", icon: noteIcon("warn"), title: __("{name} has used {pct}% of its budget", { name: t.name, pct }), body, open: () => openTagDialog(null, t.id) });
  });
  d.accounts.filter((a) => a.limitMinor && (a.utilisation || 0) >= 0.8).forEach((a) => out.push({
    key: `credit:${a.id}:${month}`, rank: 2, level: a.utilisation >= 1 ? "over" : "warn", icon: noteIcon("card"),
    title: __("{name} is at {pct}% of its limit", { name: a.name, pct: Math.round(a.utilisation * 100) }), body: owedText(a), open: () => openAccountDialog(a.id),
  }));
  d.tags.filter((t) => t.targetMinor > 0).forEach((t) => {
    const amounts = { saved: fmt(t.savedMinor, t.currency), target: fmt(t.targetMinor, t.currency) };
    if (t.savedMinor >= t.targetMinor) out.push({ key: `goal-reached:${t.id}:${t.targetMinor}`, rank: 5, level: "good", icon: noteIcon("check"), title: __("{name} reached its target", { name: t.name }), body: __("{saved} of {target} saved", amounts), open: () => openTagDialog(null, t.id) });
    else if (t.targetDate && t.targetDate < d.today) out.push({ key: `goal-late:${t.id}:${t.targetDate}`, rank: 4, level: "warn", icon: noteIcon("clock"), title: __("{name} passed its target date", { name: t.name }), body: __("{saved} of {target} saved; target date was {date}", { ...amounts, date: t.targetDate }), open: () => openTagDialog(null, t.id) });
  });
  return out.sort((a, b) => a.rank - b.rank);
}
const notifications = () => { const dismissed = new Set(state.dismissed); return allNotifications().filter((n) => n.fixed || !dismissed.has(n.key)); };
// saveDismissed keeps only keys that still match a live notification, so the list stays short.
async function saveDismissed(add) {
  const live = new Set(allNotifications().map((n) => n.key)); // all, including already-dismissed ones
  state.dismissed = [...new Set([...state.dismissed.filter((k) => live.has(k)), ...add])];
  renderBell();
  try { const s = await put("/api/settings", { notifications: { dismissed: state.dismissed } }); state.dismissed = s.notifications.dismissed; }
  catch (e) { errMsg(e); }
}
function renderBell() {
  const list = notifications(), n = list.length, badge = $("#bellBtn .badge");
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? "9+" : String(n);
  $("#bellBtn").setAttribute("aria-label", n ? __("Notifications ({n})", { n }) : __("Notifications"));
  $("#bellBtn").setAttribute("aria-expanded", String(state.notifOpen));
  $("#bellBtn").classList.toggle("has", n > 0);
  const panel = $("#notifPanel");
  panel.hidden = !state.notifOpen;
  if (!state.notifOpen) return;
  const rb = $("#bellBtn").getBoundingClientRect();
  panel.style.top = Math.round(rb.bottom + 8) + "px";
  panel.style.right = Math.max(12, Math.round(window.innerWidth - rb.right)) + "px";
  const canDismiss = list.some((x) => !x.fixed), hasExpected = list.some((x) => x.fixed);
  panel.innerHTML = `<div class="nphead"><h2>${esc(__("Notifications"))}</h2>${canDismiss ? `<button type="button" class="linkbtn" id="nDismissAll">${esc(__("Dismiss all"))}</button>` : ""}</div>
    ${n ? `<ul class="nlist">${list.map((x, i) => `<li class="nitem lvl-${x.level}">
        <button type="button" class="nmain" data-n="${i}"><span class="nicon">${x.icon}</span><span class="ntext"><b>${esc(x.title)}</b><small>${esc(x.body)}</small></span></button>
        ${x.action ? `<button type="button" class="smallbtn" data-na="${i}">${esc(x.action[0])}</button>` : ""}
        ${x.fixed ? "" : `<button type="button" class="iconbtn ndis" data-nd="${i}" aria-label="${esc(__("Dismiss"))}" title="${esc(__("Dismiss"))}">✕</button>`}</li>`).join("")}</ul>`
      : `<p class="nempty">${esc(__("You're all caught up."))}</p>`}
    ${hasExpected ? `<div class="npfoot"><button type="button" class="linkbtn" id="nToTxns">${esc(__("Open in Transactions"))}</button></div>` : ""}`;
  const close = () => { state.notifOpen = false; renderBell(); };
  panel.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => { close(); list[+b.dataset.n].open(); }));
  panel.querySelectorAll("[data-na]").forEach((b) => b.addEventListener("click", () => { close(); list[+b.dataset.na].action[1](); }));
  panel.querySelectorAll("[data-nd]").forEach((b) => b.addEventListener("click", () => saveDismissed([list[+b.dataset.nd].key])));
  const all = $("#nDismissAll");
  if (all) all.addEventListener("click", () => saveDismissed(list.filter((x) => !x.fixed).map((x) => x.key)));
  const toTxns = $("#nToTxns");
  if (toTxns) toTxns.addEventListener("click", () => { close(); state.scrollToExpected = true; if (location.hash === "#transactions") render(); else location.hash = "#transactions"; });
}
$("#bellBtn").addEventListener("click", (e) => { e.stopPropagation(); state.notifOpen = !state.notifOpen; renderBell(); });
// composedPath, not contains(): a click inside the panel may re-render it and detach e.target
document.addEventListener("click", (e) => { if (state.notifOpen && !e.composedPath().includes($("#notifPanel"))) { state.notifOpen = false; renderBell(); } });
window.addEventListener("resize", () => { if (state.notifOpen) renderBell(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.notifOpen) { state.notifOpen = false; renderBell(); $("#bellBtn").focus(); } });

/* ---------- users: sign-in, the user menu, My account (ADR 0007) ---------- */
const AVATAR_COLORS = ["#5b2a86", "#8a3b7a", "#2f6f73", "#3d5a99", "#9a5b13", "#7a4a2a", "#2f7a46", "#6b6578"];
const initials = (u) => { const n = (u.displayName || u.username || "?").trim(); const parts = n.split(/\s+/); return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : [...n].slice(0, 2).join("")).toUpperCase(); };
const avatarColor = (u) => u.avatarColor || AVATAR_COLORS[[...(u.username || "")].reduce((n, c) => n + c.codePointAt(0), 0) % AVATAR_COLORS.length];
function avatarHTML(u, size = 32) {
  const inner = u.hasAvatar ? `<img src="api/users/${esc(u.id)}/avatar?v=${esc(u.avatarVersion || "")}" alt="">` : esc(initials(u));
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${u.hasAvatar ? "transparent" : esc(avatarColor(u))}" aria-hidden="true">${inner}</span>`;
}
async function boot() {
  try {
    const st = await api("/api/auth/status");
    if (!st.user) { showAuth(st.needsSetup ? "setup" : "login"); return; }
    state.me = st.user;
    $("#authScreen").hidden = true; $(".shell").hidden = false;
    renderUserBtn();
    await load();
  } catch (e) { msg(__("Failed to load: {message}", { message: e.message }), "error"); }
}
// the sign-in screen replaces the app until someone is signed in
function showAuth(mode) {
  state.me = null; state.data = null;
  msg("");
  $(".shell").hidden = true; $("#addBtn").hidden = true; showMore(false); $("#notifPanel").hidden = true; $("#userMenu").hidden = true;
  const box = $("#authScreen");
  box.hidden = false;
  const setup = mode === "setup";
  box.innerHTML = `<form class="authcard" id="authForm">
      <div class="authbrand"><span lang="nan-Hant-TW">記數通</span><small>KiSiauThong</small></div>
      <h1>${esc(setup ? __("Create your account") : __("Sign in"))}</h1>
      ${setup ? `<p class="muted">${esc(__("You are the first user and will manage this server."))}</p>` : ""}
      <label><span>${esc(__("Username"))}</span><input name="username" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>
      ${setup ? `<label><span>${esc(__("Display name"))}</span><input name="displayName" autocomplete="name" placeholder="${esc(__("Optional"))}"></label>` : ""}
      <label><span>${esc(__("Password"))}</span><input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="${setup ? 8 : 1}"></label>
      <p class="autherr" id="authErr" role="alert" hidden></p>
      <button class="primarybtn big" type="submit">${esc(setup ? __("Create account") : __("Sign in"))}</button>
      ${setup || !window.PublicKeyCredential ? "" : `<div class="author"><span>${esc(__("or"))}</span></div><button class="smallbtn big passkeybtn" type="button" id="passkeySignIn">${KEY_ICON}${esc(__("Sign in with a passkey"))}</button>`}
    </form>`;
  const form = $("#authForm");
  form.elements.username.focus();
  const pk = $("#passkeySignIn");
  if (pk) pk.addEventListener("click", async () => {
    const err = $("#authErr");
    err.hidden = true;
    try { await passkeySignIn(); await boot(); }
    catch (x) { if (x.name !== "NotAllowedError" && x.name !== "AbortError") { err.textContent = x.message; err.hidden = false; } }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries()), err = $("#authErr");
    err.hidden = true;
    try {
      const res = await post(setup ? "/api/auth/setup" : "/api/auth/login", f);
      if (res.totpRequired) { showCodeStep(res.ticket); return; }
      await boot();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
}
// second sign-in step: a code from the authenticator app, or a recovery code
function showCodeStep(ticket) {
  const box = $("#authScreen");
  box.innerHTML = `<form class="authcard" id="authForm">
      <div class="authbrand"><span lang="nan-Hant-TW">記數通</span><small>KiSiauThong</small></div>
      <h1>${esc(__("Two-step verification"))}</h1>
      <label><span>${esc(__("Code from your authenticator app"))}</span><input name="code" autocomplete="one-time-code" inputmode="numeric" required autocapitalize="none" spellcheck="false" maxlength="12"></label>
      <p class="muted small">${esc(__("Lost your phone? Enter one of your recovery codes instead."))}</p>
      <p class="autherr" id="authErr" role="alert" hidden></p>
      <button class="primarybtn big" type="submit">${esc(__("Verify"))}</button>
      <button class="linkbtn authback" type="button" id="authBack">${esc(__("‹ Back"))}</button>
    </form>`;
  const form = $("#authForm");
  form.elements.code.focus();
  $("#authBack").addEventListener("click", () => showAuth("login"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#authErr");
    err.hidden = true;
    try { await post("/api/auth/totp", { ticket, code: form.elements.code.value }); await boot(); }
    catch (x) { err.textContent = x.message; err.hidden = false; form.elements.code.select(); }
  });
}
function renderUserBtn() {
  const u = state.me;
  if (!u) return;
  $("#userBtn").innerHTML = avatarHTML(u, 32);
  $("#userBtn").setAttribute("aria-label", __("{name}: account menu", { name: u.displayName || u.username }));
  drawSideAdmin();
}
function toggleUserMenu(open) {
  const menu = $("#userMenu"), u = state.me;
  const show = open ?? menu.hidden;
  $("#userBtn").setAttribute("aria-expanded", String(show));
  if (!show || !u) { menu.hidden = true; return; }
  const rb = $("#userBtn").getBoundingClientRect();
  menu.style.top = Math.round(rb.bottom + 8) + "px";
  menu.style.right = Math.max(12, Math.round(window.innerWidth - rb.right)) + "px";
  menu.innerHTML = `<div class="umhead">${avatarHTML(u, 40)}<span><b>${esc(u.displayName || u.username)}</b><small>@${esc(u.username)}</small></span></div>
    <button type="button" role="menuitem" data-um="account">${esc(__("My account"))}</button>
    <button type="button" role="menuitem" data-um="signout">${esc(__("Sign out"))}</button>`;
  menu.hidden = false;
  menu.querySelector("[data-um=account]").addEventListener("click", () => { toggleUserMenu(false); location.hash = "#account"; });
  menu.querySelector("[data-um=signout]").addEventListener("click", signOut);
}
async function signOut() {
  toggleUserMenu(false);
  try { await post("/api/auth/logout"); } catch (e) { /* signed out either way */ }
  showAuth("login");
}
$("#userBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleUserMenu(); });
document.addEventListener("click", (e) => { if (!$("#userMenu").hidden && !e.composedPath().includes($("#userMenu"))) toggleUserMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#userMenu").hidden) { toggleUserMenu(false); $("#userBtn").focus(); } });

// My account: profile, sign-in methods and API keys
function screenAccount(v) {
  const u = state.me;
  const row = (label, control) => `<div class="srow"><span class="sl">${esc(label)}</span><div class="sc">${control}</div></div>`;
  v.innerHTML = `<div class="settings narrow"><div class="sbody">
    <section class="ssec"><h3>${esc(__("Profile"))}</h3><div class="scard">
      <div class="sabout">${avatarHTML(u, 56)}<span><b>${esc(u.displayName || u.username)}</b><small class="muted">@${esc(u.username)}${u.isAdmin ? " · " + esc(__("Administrator")) : ""}</small></span></div>
      <form id="profileForm">${row(__("Display name"), `<div class="inline"><input name="displayName" maxlength="60" value="${esc(u.displayName || "")}"><button class="smallbtn" type="submit">${esc(__("Save"))}</button></div>`)}</form>
      ${row(__("Photo"), `<div class="sbtns"><label class="smallbtn filebtn">${esc(u.hasAvatar ? __("Change photo") : __("Upload photo"))}<input type="file" id="avatarFile" accept="image/*" hidden></label>${u.hasAvatar ? `<button class="smallbtn danger" type="button" id="avatarRemove">${esc(__("Remove photo"))}</button>` : ""}</div>`)}
      ${u.hasAvatar ? "" : row(__("Colour"), `<div class="swatches">${AVATAR_COLORS.map((c) => `<button type="button" class="swatch${avatarColor(u) === c ? " on" : ""}" style="background:${c}" data-color="${c}" aria-label="${esc(c)}" aria-pressed="${avatarColor(u) === c}"></button>`).join("")}</div>`)}
    </div></section>
    <section class="ssec"><h3>${esc(__("Passkeys"))}</h3><div class="scard" id="passkeyCard"></div></section>
    <section class="ssec"><h3>${esc(__("Two-step verification"))}</h3><div class="scard" id="totpCard"></div></section>
    <section class="ssec"><h3>${esc(__("Password"))}</h3><div class="scard">
      <form id="pwForm">
        ${row(__("Current password"), `<input name="current" type="password" autocomplete="current-password" required>`)}
        ${row(__("New password"), `<input name="new" type="password" autocomplete="new-password" minlength="8" required>`)}
        ${row(__("Confirm new password"), `<input name="confirm" type="password" autocomplete="new-password" minlength="8" required>`)}
        ${row("", `<button class="smallbtn" type="submit">${esc(__("Change password"))}</button>`)}
      </form>
    </div></section>
    <section class="ssec"><h3>${esc(__("API keys"))}</h3><div class="scard" id="keysCard"></div></section>
  </div></div>`;
  drawTotp();
  drawPasskeys();
  drawKeys();
  $("#avatarFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // choosing the same file again opens the cropper again
    if (!file) return;
    try {
      const image = await cropPhoto(file);
      if (!image) return;
      state.me = await put("/api/me/avatar", { image }); renderUserBtn(); msg(__("Photo saved.")); render();
    } catch (err) { errMsg(err); }
  });
  const rm = $("#avatarRemove");
  if (rm) rm.addEventListener("click", async () => { try { state.me = await api("/api/me/avatar", { method: "DELETE" }); renderUserBtn(); render(); } catch (err) { errMsg(err); } });
  v.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", async () => {
    try { state.me = await put("/api/me/avatar", { color: b.dataset.color }); renderUserBtn(); render(); } catch (err) { errMsg(err); }
  }));
  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { state.me = await put("/api/me", { displayName: e.target.elements.displayName.value }); renderUserBtn(); msg(__("Profile saved.")); render(); }
    catch (err) { errMsg(err); }
  });
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (f.new !== f.confirm) { msg(__("The new passwords do not match."), "error"); return; }
    try { await post("/api/me/password", { current: f.current, new: f.new }); e.target.reset(); msg(__("Password changed. Other devices were signed out.")); }
    catch (err) { errMsg(err); }
  });
}

// Two-step verification card: off -> scan + verify -> recovery codes -> on
async function refreshMe() { state.me = await api("/api/me"); renderUserBtn(); }
function drawTotp(stage, data) {
  const card = $("#totpCard"), u = state.me;
  const row = (label, control) => `<div class="srow"><span class="sl">${esc(label)}</span><div class="sc">${control}</div></div>`;
  if (stage === "setup") {
    card.innerHTML = `<div class="totpsetup">
        <img class="qr" src="${esc(data.qr)}" alt="${esc(__("QR code for your authenticator app"))}" width="180" height="180">
        <div><ol class="steps"><li>${esc(__("Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy…)."))}</li>
          <li>${esc(__("Or enter this key by hand:"))} <code class="secret">${esc(data.secret.replace(/(.{4})/g, "$1 ").trim())}</code></li>
          <li>${esc(__("Enter the 6-digit code it shows:"))}</li></ol>
        <form id="totpEnable" class="inline"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="123456"><button class="primarybtn" type="submit">${esc(__("Verify"))}</button><button class="smallbtn" type="button" id="totpCancel">${esc(__("Cancel"))}</button></form></div></div>`;
    card.querySelector("[name=code]").focus();
    $("#totpCancel").addEventListener("click", () => drawTotp());
    $("#totpEnable").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const res = await post("/api/me/totp/enable", { code: e.target.elements.code.value }); await refreshMe(); drawTotp("codes", res.recoveryCodes); }
      catch (err) { errMsg(err); }
    });
    return;
  }
  if (stage === "codes") {
    const text = data.join("\n");
    card.innerHTML = `<div class="recovery"><p><b>${esc(__("Two-step verification is on."))}</b> ${esc(__("Save these recovery codes somewhere safe. Each works once if you lose your phone; they will not be shown again."))}</p>
        <ul class="codes">${data.map((c) => `<li><code>${esc(c)}</code></li>`).join("")}</ul>
        <div class="sbtns"><button class="smallbtn" type="button" id="rcCopy">${esc(__("Copy"))}</button><a class="smallbtn" download="kisiauthong-recovery-codes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(text + "\n")}">${esc(__("Download"))}</a><button class="primarybtn" type="button" id="rcDone">${esc(__("Done"))}</button></div></div>`;
    $("#rcCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); msg(__("Copied.")); } catch (e) { msg(__("Copy failed; select the codes instead."), "error"); } });
    $("#rcDone").addEventListener("click", () => drawTotp());
    return;
  }
  if (!u.totpEnabled) {
    card.innerHTML = row(__("Authenticator app"), `<div class="sbtns"><span class="pill off">${esc(__("Off"))}</span><button class="smallbtn" type="button" id="totpOn">${esc(__("Turn on"))}</button></div>`);
    $("#totpOn").addEventListener("click", async () => { try { drawTotp("setup", await post("/api/me/totp/setup")); } catch (e) { errMsg(e); } });
    return;
  }
  card.innerHTML = row(__("Authenticator app"), `<div class="sbtns"><span class="pill on">${esc(__("On"))}</span><small class="muted">${esc(__("{n} recovery code(s) left", { n: u.recoveryCodesLeft || 0 }))}</small></div>`)
    + `<form id="totpOff">${row(__("Turn off"), `<div class="inline"><input name="code" autocomplete="one-time-code" maxlength="12" required placeholder="${esc(__("Current code"))}"><button class="smallbtn danger" type="submit">${esc(__("Turn off"))}</button></div>`)}</form>`;
  $("#totpOff").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await post("/api/me/totp/disable", { code: e.target.elements.code.value }); await refreshMe(); msg(__("Two-step verification is off.")); drawTotp(); }
    catch (err) { errMsg(err); }
  });
}

/* passkeys (WebAuthn): the server sends options with base64url fields; the browser API wants ArrayBuffers */
const KEY_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 10a4 4 0 1 0-3.5 3.97L9 15.5V18h2.5v2H14v-3.2l.5-.5A4 4 0 0 0 14 10zM14.5 8.5h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const fromB64u = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; };
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function creationOptions(o) {
  const pk = { ...o.publicKey, challenge: fromB64u(o.publicKey.challenge), user: { ...o.publicKey.user, id: fromB64u(o.publicKey.user.id) } };
  pk.excludeCredentials = (pk.excludeCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) }));
  return { publicKey: pk };
}
function requestOptions(o) {
  const pk = { ...o.publicKey, challenge: fromB64u(o.publicKey.challenge) };
  pk.allowCredentials = (pk.allowCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) }));
  return { publicKey: pk };
}
async function postRaw(path, body) {
  const r = await fetch(rel(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
async function passkeySignIn() {
  const begin = await postRaw("/api/auth/passkey", {});
  const cred = await navigator.credentials.get(requestOptions(begin.options));
  const res = cred.response;
  await postRaw("/api/auth/passkey?token=" + encodeURIComponent(begin.token), {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: { authenticatorData: toB64u(res.authenticatorData), clientDataJSON: toB64u(res.clientDataJSON), signature: toB64u(res.signature), userHandle: res.userHandle ? toB64u(res.userHandle) : "" },
  });
}
async function addPasskey(name) {
  const begin = await post("/api/me/passkeys");
  const cred = await navigator.credentials.create(creationOptions(begin.options));
  const res = cred.response;
  await post(`/api/me/passkeys/finish?token=${encodeURIComponent(begin.token)}&name=${encodeURIComponent(name)}`, {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: { attestationObject: toB64u(res.attestationObject), clientDataJSON: toB64u(res.clientDataJSON), transports: res.getTransports ? res.getTransports() : [] },
  });
}
// a default name for a new passkey: the kind of device it is being added on
function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? __("Passkey on {device}", { device: os }) : __("Passkey");
}
async function drawPasskeys() {
  const card = $("#passkeyCard");
  if (!card) return;
  let list = [];
  try { list = await api("/api/me/passkeys"); } catch (e) { errMsg(e); }
  const when = (iso) => (iso ? dayLabel(zoneParts(new Date(iso), displayTZ()).date) : "");
  card.innerHTML = (list.length ? `<ul class="pklist">${list.map((p) => `<li>${KEY_ICON}<span><b>${esc(p.name)}</b><small class="muted">${esc(__("Added {date}", { date: when(p.createdAt) }))}${p.lastUsedAt ? " · " + esc(__("Last used {date}", { date: when(p.lastUsedAt) })) : ""}</small></span><button class="smallbtn danger" type="button" data-pk-del="${esc(p.id)}">${esc(__("Remove"))}</button></li>`).join("")}</ul>` : "")
    + `<form id="pkAdd" class="srow"><span class="sl">${esc(__("Add a passkey"))}</span><div class="sc"><div class="inline"><input name="name" maxlength="60" value="${esc(deviceName())}" aria-label="${esc(__("Passkey name"))}"><button class="smallbtn" type="submit">${esc(__("Add"))}</button></div></div></form>`
    + (window.PublicKeyCredential ? "" : `<p class="formnote" style="padding:0 20px 14px">${esc(__("This browser does not support passkeys."))}</p>`);
  card.querySelectorAll("[data-pk-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(__("Remove this passkey? You will no longer be able to sign in with it."))) return;
    try { await api("/api/me/passkeys/" + encodeURIComponent(b.dataset.pkDel), { method: "DELETE" }); msg(__("Passkey removed.")); drawPasskeys(); } catch (e) { errMsg(e); }
  }));
  $("#pkAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await addPasskey(e.target.elements.name.value.trim()); msg(__("Passkey added.")); drawPasskeys(); }
    catch (x) { if (x.name !== "NotAllowedError" && x.name !== "AbortError") errMsg(x); }
  });
}

// Photo cropper: drag to move, zoom with the slider, wheel, pinch or +/-; arrow keys move.
// Resolves to a square JPEG of at most AVATAR_MAX px (the server takes no more), or null if cancelled.
const AVATAR_MAX = 512, AVATAR_BYTES = 500 * 1024, ZOOM_MAX = 5;
async function cropPhoto(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error(__("That file is not an image this browser can read.")); });
  if (bmp.width < 16 || bmp.height < 16) throw new Error(__("That photo is too small."));
  openDialog(__("Crop photo"), `<div class="cropper">
      <canvas id="cropCanvas" tabindex="0" aria-label="${esc(__("Drag to move the photo; use the arrow keys to move and + or - to zoom"))}"></canvas>
      <div class="cropzoom"><span aria-hidden="true">−</span><input type="range" id="cropZoom" min="1" max="${ZOOM_MAX}" step="0.01" value="1" aria-label="${esc(__("Zoom"))}"><span aria-hidden="true">+</span></div>
      <button class="primarybtn big" type="button" id="cropSave">${esc(__("Save photo"))}</button>
    </div>`);
  const dlg = $("#dialog"), cv = $("#cropCanvas"), zoomEl = $("#cropZoom"), g = cv.getContext("2d");
  const V = cv.getBoundingClientRect().width || 300, dpr = window.devicePixelRatio || 1;
  cv.width = cv.height = Math.round(V * dpr);
  const base = V / Math.min(bmp.width, bmp.height); // the short side fills the frame at zoom 1
  let z = 1, scale = base, ox = (V - bmp.width * base) / 2, oy = (V - bmp.height * base) / 2, queued = false;
  const clamp = () => { // the photo always covers the whole frame
    ox = Math.min(0, Math.max(V - bmp.width * scale, ox));
    oy = Math.min(0, Math.max(V - bmp.height * scale, oy));
  };
  const draw = () => {
    queued = false;
    if (!bmp.width) return; // closed: the dialog is gone
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, V, V);
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, ox, oy, bmp.width * scale, bmp.height * scale);
    g.beginPath(); g.rect(0, 0, V, V); g.arc(V / 2, V / 2, V / 2 - 1, 0, Math.PI * 2);
    g.fillStyle = "rgba(20,12,28,.5)"; g.fill("evenodd"); // the corners the round avatar hides
    g.beginPath(); g.arc(V / 2, V / 2, V / 2 - 1, 0, Math.PI * 2); g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 1.5; g.stroke();
  };
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  // zoom to nz keeping the photo point under (cx, cy) in place
  const zoomTo = (nz, cx = V / 2, cy = V / 2) => {
    nz = Math.min(ZOOM_MAX, Math.max(1, nz));
    const ix = (cx - ox) / scale, iy = (cy - oy) / scale;
    z = nz; scale = base * z; ox = cx - ix * scale; oy = cy - iy * scale;
    clamp(); zoomEl.value = String(z); redraw();
  };
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * V / r.width, (e.clientY - r.top) * V / r.height]; };
  const pts = new Map();
  let pinch = null;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, at(e)); pinch = null; });
  cv.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = at(e), prev = pts.get(e.pointerId);
    pts.set(e.pointerId, p);
    if (pts.size === 1) { ox += p[0] - prev[0]; oy += p[1] - prev[1]; clamp(); redraw(); return; }
    const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoomTo(pinch.z * d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    else pinch = { d, z };
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = null; };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = at(e); zoomTo(z * Math.exp(-e.deltaY * 0.0015), x, y); }, { passive: false });
  cv.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 40 : 10, moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { ox += moves[e.key][0]; oy += moves[e.key][1]; clamp(); redraw(); }
    else if (e.key === "+" || e.key === "=") zoomTo(z * 1.1);
    else if (e.key === "-") zoomTo(z / 1.1);
    else return;
    e.preventDefault();
  });
  zoomEl.addEventListener("input", () => zoomTo(parseFloat(zoomEl.value)));
  draw();
  cv.focus();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; bmp.close(); resolve(v); } };
    dlg.addEventListener("close", () => finish(null), { once: true });
    $("#cropSave").addEventListener("click", () => {
      // the framed square of the photo, scaled down to at most AVATAR_MAX (never up)
      const side = V / scale, out = Math.max(16, Math.min(AVATAR_MAX, Math.round(side))), c = document.createElement("canvas");
      c.width = c.height = out;
      const cg = c.getContext("2d");
      cg.fillStyle = "#fff"; cg.fillRect(0, 0, out, out); // transparent PNGs get a white background in JPEG
      cg.imageSmoothingQuality = "high";
      cg.drawImage(bmp, -ox / scale, -oy / scale, side, side, 0, 0, out, out);
      let q = 0.88, url = c.toDataURL("image/jpeg", q);
      while (url.length * 0.75 > AVATAR_BYTES && q > 0.4) url = c.toDataURL("image/jpeg", (q -= 0.12));
      finish(url);
      dlg.close();
    });
  });
}

// Users (administrators): everyone who can sign in here, with an add form at the end
async function drawUsers() {
  const card = $("#usersCard");
  if (!card) return;
  drawServer();
  let list = [];
  try { list = await api("/api/users"); } catch (e) { errMsg(e); return; }
  const me = state.me;
  card.innerHTML = `<ul class="userlist">${list.map((u) => `<li data-user="${esc(u.id)}">${avatarHTML({ ...u, avatarVersion: u.avatarVersion }, 36)}
      <span class="uname"><b>${esc(u.displayName || u.username)}</b><small class="muted">@${esc(u.username)}</small></span>
      <span class="badges">${u.isAdmin ? `<span class="pill on">${esc(__("Administrator"))}</span>` : ""}${u.totpEnabled ? `<span class="pill">${esc(__("Two-step"))}</span>` : ""}${u.id === me.id ? `<span class="pill off">${esc(__("You"))}</span>` : ""}</span>
      <span class="uactions"><button class="smallbtn" type="button" data-u-admin="${u.isAdmin ? 0 : 1}">${esc(u.isAdmin ? __("Remove admin") : __("Make admin"))}</button>
        <button class="smallbtn" type="button" data-u-reset>${esc(__("Reset password"))}</button>
        ${u.id === me.id ? "" : `<button class="smallbtn danger" type="button" data-u-del>${esc(__("Delete"))}</button>`}</span>
      <form class="ureset" hidden><input type="password" name="password" minlength="8" required autocomplete="new-password" placeholder="${esc(__("New password"))}"><button class="smallbtn" type="submit">${esc(__("Set password"))}</button></form></li>`).join("")}</ul>
    <form id="userAdd" class="useradd"><b>${esc(__("Add a user"))}</b>
      <input name="username" required autocapitalize="none" spellcheck="false" placeholder="${esc(__("Username"))}" aria-label="${esc(__("Username"))}">
      <input name="displayName" placeholder="${esc(__("Display name"))}" aria-label="${esc(__("Display name"))}">
      <input name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="${esc(__("Password"))}" aria-label="${esc(__("Password"))}">
      <label class="checkline"><input type="checkbox" name="isAdmin"> ${esc(__("Administrator"))}</label>
      <button class="primarybtn" type="submit">${esc(__("Add user"))}</button></form>`;
  const idOf = (el) => el.closest("[data-user]").dataset.user;
  const nameOf = (id) => { const u = list.find((x) => x.id === id); return u.displayName || u.username; };
  card.querySelectorAll("[data-u-admin]").forEach((b) => b.addEventListener("click", async () => {
    try { await put("/api/users/" + idOf(b), { isAdmin: b.dataset.uAdmin === "1" }); drawUsers(); if (idOf(b) === me.id) { await refreshMe(); render(); } } catch (e) { errMsg(e); }
  }));
  card.querySelectorAll("[data-u-reset]").forEach((b) => b.addEventListener("click", () => { const f = b.closest("li").querySelector(".ureset"); f.hidden = !f.hidden; if (!f.hidden) f.elements.password.focus(); }));
  card.querySelectorAll(".ureset").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await put("/api/users/" + idOf(f), { password: f.elements.password.value }); msg(__("Password set. {name} was signed out everywhere.", { name: nameOf(idOf(f)) })); drawUsers(); } catch (err) { errMsg(err); }
  }));
  card.querySelectorAll("[data-u-del]").forEach((b) => b.addEventListener("click", async () => {
    const id = idOf(b);
    if (!confirm(__("Delete {name} and all of their books? This cannot be undone.", { name: nameOf(id) }))) return;
    try { await api("/api/users/" + encodeURIComponent(id), { method: "DELETE" }); msg(__("User deleted.")); drawUsers(); } catch (e) { errMsg(e); }
  }));
  $("#userAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try { await post("/api/users", { username: f.username.trim(), displayName: f.displayName, password: f.password, isAdmin: !!f.isAdmin }); msg(__("User added.")); drawUsers(); } catch (err) { errMsg(err); }
  });
}

// API keys: for scripts and AI agents, each with only the permissions it needs (ADR 0008)
const SCOPE_L = { read: N_("Read your books"), "transactions:write": N_("Add and edit transactions"), "accounts:write": N_("Add and edit accounts"),
  "tags:write": N_("Add and edit categories and money boxes"), "templates:write": N_("Add and edit templates, generate due ones"), "settings:write": N_("Change settings") };
const SCOPE_SHORT = { read: N_("Read"), "transactions:write": N_("Transactions"), "accounts:write": N_("Accounts"), "tags:write": N_("Tags"), "templates:write": N_("Templates"), "settings:write": N_("Settings") };
const EXPIRY_L = { 0: N_("Never"), 30: N_("30 days"), 90: N_("90 days"), 365: N_("1 year") };
async function drawKeys(created) {
  const card = $("#keysCard");
  if (!card) return;
  let list = [];
  try { list = await api("/api/me/keys"); } catch (e) { errMsg(e); return; }
  const when = (iso) => (iso ? dayLabel(zoneParts(new Date(iso), displayTZ()).date) : "");
  const fresh = created ? `<div class="newkey" role="status"><b>${esc(__("Copy this key now. It will not be shown again."))}</b>
      <div class="keyrow"><code id="newKeyText">${esc(created.key)}</code><button class="smallbtn" type="button" id="newKeyCopy">${esc(__("Copy"))}</button></div></div>` : "";
  card.innerHTML = fresh + (list.length ? `<ul class="keylist">${list.map((k) => {
      const expired = k.expiresAt && k.expiresAt < new Date().toISOString();
      return `<li><span class="kmain"><b>${esc(k.name)}</b><code>${esc(k.hint)}</code>
        <span class="kscopes">${k.scopes.map((sc) => `<span class="pill">${esc(lbl(SCOPE_SHORT, sc))}</span>`).join("")}</span>
        <small class="muted">${esc(__("Created {date}", { date: when(k.createdAt) }))}${k.lastUsedAt ? " · " + esc(__("Last used {date}", { date: when(k.lastUsedAt) })) : " · " + esc(__("Never used"))}${k.expiresAt ? " · " + esc(expired ? __("Expired {date}", { date: when(k.expiresAt) }) : __("Expires {date}", { date: when(k.expiresAt) })) : ""}</small></span>
        <button class="smallbtn danger" type="button" data-key-del="${esc(k.id)}">${esc(__("Revoke"))}</button></li>`;
    }).join("")}</ul>` : "")
    + `<form id="keyAdd" class="keyadd"><b>${esc(__("Create a key"))}</b>
      <input name="name" required maxlength="60" placeholder="${esc(__("Name, e.g. Budget agent"))}" aria-label="${esc(__("Key name"))}">
      <fieldset><legend>${esc(__("Permissions"))}</legend>${Object.keys(SCOPE_L).map((sc) => `<label class="checkline"><input type="checkbox" name="scope" value="${esc(sc)}" ${sc === "read" ? "checked" : ""}> ${esc(__(SCOPE_L[sc]))}</label>`).join("")}</fieldset>
      <label class="kexp">${esc(__("Expires"))} <select name="expires">${Object.entries(EXPIRY_L).map(([d, l]) => `<option value="${d}" ${d === "90" ? "selected" : ""}>${esc(__(l))}</option>`).join("")}</select></label>
      <button class="primarybtn" type="submit">${esc(__("Create key"))}</button></form>`;
  const copy = $("#newKeyCopy");
  if (copy) copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(created.key); msg(__("Copied.")); } catch (e) { getSelection().selectAllChildren($("#newKeyText")); } });
  card.querySelectorAll("[data-key-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(__("Revoke this key? Anything using it stops working at once."))) return;
    try { await api("/api/me/keys/" + encodeURIComponent(b.dataset.keyDel), { method: "DELETE" }); msg(__("Key revoked.")); drawKeys(); } catch (e) { errMsg(e); }
  }));
  $("#keyAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, scopes = [...f.querySelectorAll("[name=scope]:checked")].map((x) => x.value);
    if (!scopes.length) { msg(__("Choose at least one permission."), "error"); return; }
    try { drawKeys(await post("/api/me/keys", { name: f.elements.name.value.trim(), scopes, expiresInDays: parseInt(f.elements.expires.value, 10) })); }
    catch (err) { errMsg(err); }
  });
}
// Administration (administrators only): its own pages, with the sidebar switched to them
const isAdminScreen = (key) => key === "admin" || key.startsWith("admin/");
function screenAdmin(v) {
  v.innerHTML = `<div class="settings narrow"><div class="sbody"><div class="scard" id="serverCard"></div></div></div>`;
  drawServer();
}
function screenAdminUsers(v) {
  v.innerHTML = `<div class="settings narrow"><div class="sbody"><div class="scard" id="usersCard"></div></div></div>`;
  drawUsers();
}
const ADMIN_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// the link at the foot of the sidebar: into Administration, or back to the page you came from
function drawSideAdmin() {
  const a = $("#sideAdmin");
  if (!a) return;
  a.hidden = !(state.me && state.me.isAdmin);
  const inAdmin = isAdminScreen(currentScreen());
  a.href = inAdmin ? "#" + (state.lastBookScreen || "dashboard") : "#admin";
  a.innerHTML = inAdmin ? `${BACK_ICON}<span>${esc(__("Back to my books"))}</span>` : `${ADMIN_ICON}<span>${esc(__("Administration"))}</span>`;
}
const fmtBytes = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
async function drawServer() {
  const card = $("#serverCard");
  if (!card) return;
  let s;
  try { s = await api("/api/admin/server"); } catch (e) { errMsg(e); return; }
  const row = (label, value) => `<div class="srow"><span class="sl">${esc(label)}</span><div class="sc">${value}</div></div>`;
  const started = zoneParts(new Date(s.startedAt), displayTZ());
  const stat = (n, label) => `<div><b>${esc(String(n))}</b><span>${esc(label)}</span></div>`;
  card.innerHTML = `<div class="admstats">${stat(s.users, __("Users"))}${stat(s.admins, __("Administrators"))}${stat(s.twoStepUsers, __("Two-step verification"))}${stat(s.passkeys, __("Passkeys"))}${stat(s.activeSessions, __("Sessions"))}${stat(s.apiKeys, __("API keys"))}</div>
    ${row(__("Version"), esc(s.version))}
    ${row(__("Running since"), esc(dayLabel(started.date) + " " + started.time))}
    ${row(__("Runtime"), esc(s.runtime))}
    ${row(__("Database"), `<code class="path">${esc(s.database.path)}</code>`)}
    ${row(__("Database size"), esc(fmtBytes(s.database.sizeBytes)))}
    ${row(__("Schema version"), esc(String(s.database.schemaVersion)))}`;
}

/* ---------- routing ---------- */
const SCREENS = { dashboard: [N_("Dashboard"), screenDashboard], transactions: [N_("Transactions"), screenTransactions], accounts: ["Accounts", screenAccounts], templates: [N_("Templates"), screenTemplates], tags: [N_("Tags"), screenTags], settings: [N_("Settings"), screenSettings], account: [N_("My account"), screenAccount], admin: [N_("Server"), screenAdmin], "admin/users": [N_("Users"), screenAdminUsers] };
function currentScreen() {
  const h = location.hash.replace("#", "");
  if (h === "budgets" || h === "moneyboxes") return "tags"; // budgets and money boxes live on the Tags page now
  if (isAdminScreen(h) && !(state.me && state.me.isAdmin)) return "dashboard";
  return SCREENS[h] ? h : "dashboard";
}
function render() {
  const key = currentScreen();
  $("#pageTitle").textContent = __(SCREENS[key][0]);
  const admin = isAdminScreen(key);
  if (!admin) state.lastBookScreen = key;
  $("#nav").hidden = admin; $("#adminNav").hidden = !admin;
  document.querySelectorAll("#nav a, #adminNav a").forEach((a) => a.classList.toggle("on", a.dataset.screen === key));
  document.querySelectorAll("#tabbar a, #moreSheet a").forEach((a) => a.classList.toggle("on", a.dataset.tab === key));
  $("#tabMore").classList.toggle("on", !["dashboard", "transactions", "accounts"].includes(key));
  $("#moreAdmin").hidden = !(state.me && state.me.isAdmin);
  drawSideAdmin();
  renderBell();
  $("#addBtn").hidden = admin || (key === "dashboard" && state.customizing); // nothing to add there; it would cover widgets being edited
  $("#tabAdd").disabled = admin;
  SCREENS[key][1]($("#view"));
}
window.addEventListener("hashchange", render);
async function load() {
  state.data = await api("/api/state");
  state.data.allAccounts = state.data.accounts;
  state.data.externals = state.data.accounts.filter((a) => a.kind === "external");
  state.data.accounts = state.data.accounts.filter((a) => a.kind !== "external");
  try {
    const s = await api("/api/settings");
    state.dashboard = s.dashboard;
    state.general = s.general;
    state.about = s.about;
    state.dismissed = (s.notifications && s.notifications.dismissed) || [];
  } catch (e) { msg(__("Settings unavailable, using defaults: {message}", { message: e.message }), "error"); }
  setLang(pickLang(state.general && state.general.language));
  applyPageWidth();
  state.data.today = zoneParts(new Date(), displayTZ()).date; // "today" where the user is looking from
  render();
}
setLang(pickLang(""));
boot();
