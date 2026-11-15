// SPDX-License-Identifier: AGPL-3.0-or-later
// All user-visible strings go through __() / N_() from i18n.js (English source strings).
"use strict";
const $ = (s) => document.querySelector(s);
const state = { data: null, dashboard: null, general: null, about: null, customizing: false, dashDraft: null, dashOpen: [], dragId: null, txnType: "expense", editingTxn: null, filter: { q: "", account: "", type: "" }, page: 0, dayOpen: {} };
const EXP = { JPY: 0, KRW: 0 };
const expOf = (c) => (c in EXP ? EXP[c] : 2);
const defCur = () => (state.general && state.general.defaultCurrency) || "TWD";
const PER_PAGE_CHOICES = [20, 50, 100, 200];
const perPage = () => (state.general && state.general.transactionsPerPage) || 50;
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
// Frequently used currencies first, then every ISO 4217 code under "All currencies".
function currencyOptions(selected) {
  const sel = selected || defCur(), fav = favCurs().includes(sel) ? favCurs() : [...favCurs(), sel];
  const rest = ALL_CURRENCIES.filter((c) => !fav.includes(c));
  return fav.map((c) => curOption(c, sel)).join("") + (rest.length ? `<optgroup label="${esc(__("All currencies"))}">${rest.map((c) => curOption(c, sel)).join("")}</optgroup>` : "");
}
const toMinor = (a, c) => Math.round(parseFloat(a || 0) * Math.pow(10, expOf(c)));
function fmt(minor, currency) {
  const e = expOf(currency || defCur()), v = (minor || 0) / Math.pow(10, e);
  return (currency || "") + " " + v.toLocaleString(LANG, { minimumFractionDigits: e, maximumFractionDigits: e });
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const msg = (t) => { $("#msg").textContent = t || ""; };
const errMsg = (e) => msg(__("Error: {message}", { message: e.message }));
async function api(path, opts) {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const put = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const decimal = (minor, currency) => ((minor || 0) / Math.pow(10, expOf(currency || defCur()))).toFixed(expOf(currency || defCur()));
const accName = (id) => (state.data.accounts.find((a) => a.id === id) || {}).name || "—";
const accCur = (id) => (state.data.accounts.find((a) => a.id === id) || {}).currency || defCur();
const tagName = (id) => (state.data.tags.find((t) => t.id === id) || {}).name || "—";
const signed = (t) => t.type === "income" ? "+" : (t.type === "expense" ? "−" : "");
const barCls = (p) => p >= 100 ? "over" : p >= 80 ? "warn" : "";
function table(headers, rows) {
  return `<div style="overflow-x:auto"><table><thead><tr>${headers.map((h) => `<th class="${h.num ? "num" : ""}">${esc(__(h.t))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function row(cells) {
  return "<tr>" + cells.map((c) => `<td data-label="${esc(__(c.l))}" class="${c.num ? "num" : ""}">${c.v}</td>`).join("") + "</tr>";
}

/* ---------- display labels for stored enum values ---------- */
const TYPE_L = { expense: N_("Expense"), income: N_("Income"), transfer: N_("Transfer"), allocate: N_("Allocate"), release: N_("Release") };
const KIND_L = { bank: N_("Bank"), savings: N_("Savings"), cash: N_("Cash"), credit_card: N_("Credit card"), ewallet: N_("E-wallet"), investment: N_("Investment"), loan: N_("Loan") };
const TAGKIND_L = { category: N_("Category"), goal: N_("Goal"), label: N_("Label"), payee: N_("Payee") };
const FREQ_L = { daily: N_("Daily"), weekly: N_("Weekly"), monthly: N_("Monthly"), quarterly: N_("Quarterly"), yearly: N_("Yearly") };
const lbl = (map, x) => __(map[x] || x);
const enumOptions = (map, keys, sel) => keys.map((k) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(lbl(map, k))}</option>`).join("");
const txnTitle = (t) => t.note || lbl(TYPE_L, t.type);
const unconfirmed = () => `<span class="chip due">${esc(__("UNCONFIRMED"))}</span>`;
const transferAcct = (t) => t.type === "transfer" ? accName(t.fromAccountId) + " → " + accName(t.toAccountId) : accName(t.accountId);

/* ---------- screens ---------- */
const DASH_WIDGETS = [
  { id: "balances", label: N_("Balances by currency"), pick: "currencies" },
  { id: "budgets", label: N_("Budgets this month"), pick: "budgets" },
  { id: "expected", label: N_("Expected to confirm"), rows: 6 },
  { id: "spending", label: N_("Spending this month"), rows: 8 },
  { id: "moneyboxes", label: N_("Money boxes"), pick: "goals" },
  { id: "accounts", label: N_("Accounts"), pick: "accounts" },
  { id: "recent", label: N_("Recent transactions"), rows: 6 },
];
const DASH_DEFAULT = { order: DASH_WIDGETS.map((w) => w.id), hidden: [], widgets: {} };
const widgetDef = (id) => DASH_WIDGETS.find((w) => w.id === id);
const widgetLabel = (id) => __(widgetDef(id).label);
function dashLayout() {
  const s = state.dashboard || DASH_DEFAULT;
  const order = (s.order || []).filter(widgetDef);
  DASH_WIDGETS.forEach((w) => { if (!order.includes(w.id)) order.push(w.id); });
  const widgets = {};
  Object.entries(s.widgets || {}).forEach(([id, o]) => { if (widgetDef(id)) widgets[id] = JSON.parse(JSON.stringify(o)); });
  return { order, hidden: (s.hidden || []).filter(widgetDef), widgets };
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
function widgetBody(id, o) {
  const d = state.data, def = widgetDef(id), rows = o.rows || def.rows;
  const inc = (x) => !(o.include && o.include.length) || o.include.includes(x);
  const planned = d.transactions.filter((t) => t.state === "planned");
  switch (id) {
    case "balances": {
      const perCur = {};
      d.accounts.forEach((a) => { if (inc(a.currency)) perCur[a.currency] = (perCur[a.currency] || 0) + a.balanceMinor; });
      return `<div class="cards">${Object.entries(perCur).map(([c, val]) => `<div class="card"><span class="lab">${esc(__("Balance · {currency}", { currency: c }))}</span><b>${fmt(val, c)}</b><span class="muted">${esc(__("{n} account(s)", { n: d.accounts.filter((a) => a.currency === c).length }))}</span></div>`).join("")}<div class="card"><span class="lab">${esc(__("Expected to confirm"))}</span><b>${planned.length}</b><span class="muted">${esc(__("Not yet posted"))}</span></div></div>`;
    }
    case "budgets": {
      const list = d.tags.filter((t) => t.limitMinor !== undefined && inc(t.id)).map((t) => {
        const p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
        return row([{ l: "Budget", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Spent", v: ofAmount(t.spentMinor, t.limitMinor, t.currency) }, { l: "Progress", v: `<div class="bar"><i class="${barCls(p)}" style="width:${Math.min(100, p)}%"></i></div>` }, { l: "Remaining", v: fmt(t.remainingMinor, t.currency), num: 1 }]);
      }).join("");
      return list ? table([{ t: N_("Budget") }, { t: N_("Spent") }, { t: N_("Progress") }, { t: N_("Remaining"), num: 1 }], list) : `<p class="muted">${esc(__("No budgets yet."))}</p>`;
    }
    case "expected": {
      const list = planned.slice(0, rows).map((t) => row([{ l: N_("Date"), v: esc(t.date) }, { l: N_("Expected"), v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(txnTitle(t))}</button> ${unconfirmed()}` }, { l: N_("Account"), v: esc(accName(t.accountId)) }, { l: N_("Amount"), v: fmt(t.amountMinor, t.currency), num: 1 }])).join("");
      return list ? table([{ t: "Date" }, { t: "Expected" }, { t: "Account" }, { t: "Amount", num: 1 }], list) : `<p class="muted">${esc(__("Nothing waiting. Templates generate here when due."))}</p>`;
    }
    case "spending": {
      // server returns rows grouped by currency, largest first; bars compare within one currency only
      const byCur = {};
      (d.spendingThisMonth || []).forEach((x) => { (byCur[x.currency] = byCur[x.currency] || []).push(x); });
      const list = Object.entries(byCur).map(([c, xs]) => xs.slice(0, rows).map((x) => row([
        { l: N_("Category"), v: x.tagId ? `<button class="titlelink" data-detail-tag="${esc(x.tagId)}">${esc(tagName(x.tagId))}</button>` : `<span class="muted">${esc(__("Uncategorised"))}</span>` },
        { l: N_("Share"), v: `<div class="bar"><i style="width:${xs[0].amountMinor ? x.amountMinor / xs[0].amountMinor * 100 : 0}%"></i></div>` },
        { l: "Spent", v: fmt(x.amountMinor, c), num: 1 }])).join("")).join("");
      return list ? table([{ t: "Category" }, { t: "Share" }, { t: "Spent", num: 1 }], list) : `<p class="muted">${esc(__("No posted expenses this month."))}</p>`;
    }
    case "moneyboxes": {
      const goals = d.tags.filter((t) => t.targetMinor !== undefined && inc(t.id));
      return goals.length ? goals.map(goalCard).join("") : `<p class="muted">${esc(__("No money boxes yet."))}</p>`;
    }
    case "accounts": {
      const list = d.accounts.filter((a) => inc(a.id)).map((a) => row([{ l: "Account", v: `<button class="titlelink" data-detail-account="${esc(a.id)}">${esc(a.name)}</button> <span class="chip">${esc(lbl(KIND_L, a.kind))}</span>` }, { l: N_("Balance"), v: fmt(a.balanceMinor, a.currency), num: 1 }, { l: N_("Earmarked"), v: fmt(a.allocatedMinor, a.currency), num: 1 }, { l: N_("Free"), v: fmt(a.unallocatedMinor, a.currency), num: 1 }])).join("");
      return table([{ t: "Account" }, { t: "Balance", num: 1 }, { t: "Earmarked", num: 1 }, { t: "Free", num: 1 }], list);
    }
    case "recent": {
      const list = d.transactions.filter((t) => t.state === "posted").sort(byNewest).slice(0, rows);
      return list.length ? feedHTML(list) : `<p class="muted">${esc(__("No transactions yet."))}</p>`;
    }
  }
  return "";
}
function dashGrid(layout) {
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  if (!visible.length) return `<div class="empty">${esc(__("All widgets are hidden. Customize the dashboard to bring some back."))}</div>`;
  return `<div class="dashgrid">${visible.map((id) => {
    const o = layout.widgets[id] || {}, size = o.size === "half" ? " half" : "";
    // balances are bare cards: a heading only when the user gave it a title
    if (id === "balances") return `<section class="dw bare${size}">${o.title ? `<h3>${esc(o.title)}</h3>` : ""}${widgetBody(id, o)}</section>`;
    return `<section class="panel dw${size}"><h3>${esc(o.title || widgetLabel(id))}</h3>${widgetBody(id, o)}</section>`;
  }).join("")}</div>`;
}
function setWidgetOpt(id, key, val) {
  const ws = state.dashDraft.widgets, o = ws[id] || {};
  if (val === undefined || val === "" || (Array.isArray(val) && !val.length)) delete o[key]; else o[key] = val;
  if (Object.keys(o).length) ws[id] = o; else delete ws[id];
}
function dashEditorRow(id, i, draft) {
  const w = widgetDef(id), o = draft.widgets[id] || {}, n = draft.order.length, label = widgetLabel(id);
  const items = w.pick ? pickItems(w.pick) : [];
  const shown = (x) => !(o.include && o.include.length) || o.include.includes(x);
  const opts = [`<label>${esc(__("Title"))} <input type="text" data-dash-title="${esc(id)}" value="${esc(o.title || "")}" placeholder="${esc(label)}" maxlength="60"></label>`];
  if (w.rows) opts.push(`<label>${esc(__("Rows"))} <input type="number" data-dash-rows="${esc(id)}" min="1" max="50" value="${o.rows || w.rows}"></label>`);
  if (items.length) opts.push(`<fieldset><legend>${esc(__("Show"))}</legend>${items.map((it) => `<label><input type="checkbox" data-dash-inc="${esc(id)}" value="${esc(it.id)}" ${shown(it.id) ? "checked" : ""}> ${esc(it.label)}</label>`).join("")}</fieldset>`);
  return `<li draggable="true" data-dash-item="${esc(id)}">
    <div class="dashrow"><span class="grip" aria-hidden="true">⠿</span>
      <label class="grow"><input type="checkbox" data-dash-vis="${esc(id)}" ${draft.hidden.includes(id) ? "" : "checked"}> <span class="wname">${esc(o.title || label)}</span></label>
      <select data-dash-size="${esc(id)}" aria-label="${esc(__("Width of {widget}", { widget: label }))}"><option value="full">${esc(__("Full width"))}</option><option value="half" ${o.size === "half" ? "selected" : ""}>${esc(__("Half width"))}</option></select>
      <button class="smallbtn" data-dash-up="${esc(id)}" aria-label="${esc(__("Move up"))}" ${i === 0 ? "disabled" : ""}>↑</button><button class="smallbtn" data-dash-down="${esc(id)}" aria-label="${esc(__("Move down"))}" ${i === n - 1 ? "disabled" : ""}>↓</button></div>
    <details data-dash-open="${esc(id)}" ${state.dashOpen.includes(id) ? "open" : ""}><summary>${esc(__("Options"))}</summary><div class="dashopts">${opts.join("")}</div></details></li>`;
}
function screenDashboardEditor(v) {
  const draft = state.dashDraft;
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Customize dashboard"))}</h3><span><button class="smallbtn" id="dashReset">${esc(__("Reset to default"))}</button> <button class="smallbtn" id="dashCancel">${esc(__("Cancel"))}</button> <button class="smallbtn" id="dashSave">${esc(__("Save"))}</button></span></div>
      <ol class="dashedit">${draft.order.map((id, i) => dashEditorRow(id, i, draft)).join("")}</ol></section>
    <h3 class="previewhead">${esc(__("Preview"))}</h3><div id="dashPreview"></div>`;
  const preview = () => { $("#dashPreview").innerHTML = dashGrid(draft); bindConfirm($("#dashPreview")); };
  const each = (sel, ev, fn) => v.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));
  each("[data-dash-vis]", "change", (c) => {
    const id = c.dataset.dashVis;
    draft.hidden = c.checked ? draft.hidden.filter((x) => x !== id) : [...draft.hidden, id];
    preview();
  });
  each("[data-dash-size]", "change", (s) => { setWidgetOpt(s.dataset.dashSize, "size", s.value === "half" ? "half" : undefined); preview(); });
  each("[data-dash-title]", "input", (t) => {
    const id = t.dataset.dashTitle;
    setWidgetOpt(id, "title", t.value.trim());
    t.closest("li").querySelector(".wname").textContent = t.value.trim() || widgetLabel(id);
    preview();
  });
  each("[data-dash-rows]", "change", (r) => {
    const id = r.dataset.dashRows, n = Math.min(50, Math.max(1, parseInt(r.value, 10) || widgetDef(id).rows));
    r.value = n;
    setWidgetOpt(id, "rows", n === widgetDef(id).rows ? undefined : n);
    preview();
  });
  each("[data-dash-inc]", "change", (c) => {
    const id = c.dataset.dashInc, boxes = [...v.querySelectorAll(`[data-dash-inc="${CSS.escape(id)}"]`)];
    const on = boxes.filter((b) => b.checked).map((b) => b.value);
    if (!on.length) { c.checked = true; msg(__("Keep at least one item, or untick the widget to hide it.")); return; }
    setWidgetOpt(id, "include", on.length === boxes.length ? undefined : on);
    preview();
  });
  each("[data-dash-open]", "toggle", (dt) => {
    const id = dt.dataset.dashOpen;
    state.dashOpen = dt.open ? [...new Set([...state.dashOpen, id])] : state.dashOpen.filter((x) => x !== id);
  });
  const moveTo = (id, j) => {
    const o = draft.order, i = o.indexOf(id);
    if (i < 0 || j < 0 || j >= o.length || i === j) return;
    o.splice(i, 1); o.splice(j, 0, id);
    render();
  };
  each("[data-dash-up]", "click", (b) => moveTo(b.dataset.dashUp, draft.order.indexOf(b.dataset.dashUp) - 1));
  each("[data-dash-down]", "click", (b) => moveTo(b.dataset.dashDown, draft.order.indexOf(b.dataset.dashDown) + 1));
  // drag and drop with a pointer; ↑ ↓ stay for keyboard and touch
  const clearDrop = () => v.querySelectorAll(".dropbefore,.dropafter").forEach((x) => x.classList.remove("dropbefore", "dropafter"));
  const after = (li, e) => { const r = li.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  v.querySelectorAll("[data-dash-item]").forEach((li) => {
    li.addEventListener("dragstart", (e) => {
      if (e.target !== li) return;
      state.dragId = li.dataset.dashItem; li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", state.dragId);
    });
    li.addEventListener("dragend", () => { li.classList.remove("dragging"); clearDrop(); state.dragId = null; });
    li.addEventListener("dragover", (e) => {
      if (!state.dragId) return;
      e.preventDefault(); clearDrop();
      li.classList.add(after(li, e) ? "dropafter" : "dropbefore");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = state.dragId, target = li.dataset.dashItem;
      clearDrop();
      if (!from || from === target) return;
      const rest = draft.order.filter((x) => x !== from);
      moveTo(from, rest.indexOf(target) + (after(li, e) ? 1 : 0));
    });
  });
  // selecting text in an input must not start dragging its row
  each(".dashopts input, .dashrow select", "mousedown", (el) => { el.closest("li").draggable = false; });
  each(".dashopts input, .dashrow select", "mouseup", (el) => { el.closest("li").draggable = true; });
  $("#dashCancel").addEventListener("click", () => { state.customizing = false; render(); });
  $("#dashReset").addEventListener("click", () => { state.dashDraft = JSON.parse(JSON.stringify(DASH_DEFAULT)); render(); });
  $("#dashSave").addEventListener("click", async () => {
    try {
      const saved = await put("/api/settings", { dashboard: draft });
      state.dashboard = saved.dashboard;
      state.customizing = false;
      msg(__("Dashboard saved."));
      render();
    } catch (e) { errMsg(e); }
  });
  preview();
}
function screenDashboard(v) {
  if (state.customizing) { screenDashboardEditor(v); return; }
  v.innerHTML = `<div class="dashhead"><button class="smallbtn" id="dashCustomize">${esc(__("Customize dashboard"))}</button></div>` + dashGrid(dashLayout());
  $("#dashCustomize").addEventListener("click", () => {
    state.dashDraft = dashLayout();
    state.dashOpen = [];
    state.customizing = true;
    render();
  });
  bindConfirm(v);
}
function goalAllocations(tagId) {
  const byAcc = {};
  state.data.transactions.forEach((t) => {
    if (t.tagId !== tagId || t.state !== "posted") return;
    if (t.type === "allocate") byAcc[t.accountId] = (byAcc[t.accountId] || 0) + t.amountMinor;
    if (t.type === "release") byAcc[t.accountId] = (byAcc[t.accountId] || 0) - t.amountMinor;
  });
  return Object.entries(byAcc).filter(([, v]) => v > 0);
}
function goalCard(t) {
  const p = t.targetMinor > 0 ? t.savedMinor / t.targetMinor * 100 : 0;
  const allocs = goalAllocations(t.id);
  const total = allocs.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ["#14532d", "#4c8a5f", "#9dbfa6", "#c9a86a", "#7a9e8a"];
  const stack = allocs.map(([, val], i) => `<i style="width:${val / total * 100}%;background:${colors[i % colors.length]}"></i>`).join("");
  const where = allocs.map(([id, val]) => `${esc(accName(id))} ${fmt(val, t.currency)}`).join(" · ");
  const head = __("{saved} of {target} · {pct}%", { saved: fmt(t.savedMinor, t.currency), target: fmt(t.targetMinor, t.currency), pct: p.toFixed(0) }) + (t.targetDate ? " · " + __("by {date}", { date: t.targetDate }) : "");
  return `<div style="margin-bottom:18px"><div class="panelhead"><button class="titlelink" data-detail-goal="${esc(t.id)}">${esc(t.name)}</button><span>${esc(head)}</span></div>
    <div class="stack" style="margin:8px 0">${stack}</div><span class="muted">${where || esc(__("No allocations yet"))}</span></div>`;
}
function bindConfirm(root) {
  root.querySelectorAll("[data-confirm]").forEach((b) => b.addEventListener("click", () => openConfirm(b.dataset.confirm)));
  root.querySelectorAll("[data-alloc]").forEach((b) => b.addEventListener("click", () => openDrawer("allocate", b.dataset.alloc)));
  root.querySelectorAll("[data-release]").forEach((b) => b.addEventListener("click", () => openDrawer("release", b.dataset.release)));
  root.querySelectorAll("[data-history]").forEach((b) => b.addEventListener("click", () => showHistory(b.dataset.history)));
  bindDetails(root);
}
function bindDetails(root) {
  root.querySelectorAll("[data-detail-txn]").forEach((b) => b.addEventListener("click", () => openTxnDetail(b.dataset.detailTxn)));
  root.querySelectorAll("[data-detail-account]").forEach((b) => b.addEventListener("click", () => openAccountDetail(b.dataset.detailAccount)));
  root.querySelectorAll("[data-detail-tag]").forEach((b) => b.addEventListener("click", () => openTagDetail(b.dataset.detailTag)));
  root.querySelectorAll("[data-detail-template]").forEach((b) => b.addEventListener("click", () => openTemplateDetail(b.dataset.detailTemplate)));
  root.querySelectorAll("[data-detail-goal]").forEach((b) => b.addEventListener("click", () => openMoneyboxDetail(b.dataset.detailGoal)));
}
// pairs: [English label, HTML value]
function detailTable(pairs) {
  return `<table class="detail"><tbody>${pairs.map(([k, v]) => `<tr><td data-label="">${esc(__(k))}</td><td data-label="">${v}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- transaction feed ---------- */
const byNewest = (a, b) => (b.date + b.id).localeCompare(a.date + a.id);
// stroke icons (24px grid): money out, money in, between accounts, into / out of a money box
const ICON_PATH = { expense: "M7 17 17 7M9 7h8v8", income: "M17 7 7 17M15 17H7V9", transfer: "M4 8h15l-3-3M20 16H5l3 3", allocate: "M4 13v6h16v-6M12 4v10M8 10l4 4 4-4", release: "M4 13v6h16v-6M12 14V4M8 8l4-4 4 4" };
const typeIcon = (type) => `<svg viewBox="0 0 24 24" width="18" height="18"><path d="${ICON_PATH[type] || "M12 12h.01"}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function txnTagNames(t) {
  const ids = new Set([t.tagId, ...state.data.transactionTags.filter((x) => x.transactionId === t.id).map((x) => x.tagId)].filter(Boolean));
  return [...ids].map(tagName);
}
// What a row says under its title: where the money went, in words a person uses.
function txnSubtitle(t) {
  if (t.type === "transfer") return accName(t.fromAccountId) + " → " + accName(t.toAccountId);
  if (t.type === "allocate") return accName(t.accountId) + " → " + tagName(t.tagId);
  if (t.type === "release") return tagName(t.tagId) + " → " + accName(t.accountId);
  return [txnTagNames(t).join(", "), accName(t.accountId)].filter(Boolean).join(" · ");
}
const amountText = (t) => signed(t) + fmt(t.amountMinor, t.currency);
const amountCls = (t) => t.type === "income" ? "in" : t.type === "expense" ? "out" : "move";
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
  list.forEach((t) => { if (t.type === "income") net[t.currency] = (net[t.currency] || 0) + t.amountMinor; if (t.type === "expense") net[t.currency] = (net[t.currency] || 0) - t.amountMinor; });
  return Object.entries(net).filter(([, v]) => v).map(([c, v]) => (v > 0 ? "+" : "−") + fmt(Math.abs(v), c)).join(" · ");
}
function feedRow(t, opts = {}) {
  const sub = txnSubtitle(t) + (opts.withDate ? " · " + dayLabel(t.date) : "");
  return `<li><button type="button" class="feedrow" data-detail-txn="${esc(t.id)}">
      <span class="ficon t-${esc(t.type)}" aria-hidden="true">${typeIcon(t.type)}</span>
      <span class="fmain"><span class="ftitle">${esc(t.note || txnTagNames(t)[0] || lbl(TYPE_L, t.type))}</span><span class="fsub"><span class="sr">${esc(lbl(TYPE_L, t.type))} · </span>${esc(sub)}</span></span>
      <span class="famt ${amountCls(t)}">${esc(amountText(t))}</span></button>${opts.confirm ? `<button type="button" class="smallbtn" data-confirm="${esc(t.id)}">${esc(__("Confirm…"))}</button>` : ""}</li>`;
}
// feedHTML groups a newest-first list by day; the first `open` days start expanded,
// and a day the user opened or closed keeps that choice (state.dayOpen) across re-renders.
function feedHTML(list, open = Infinity) {
  const days = [];
  list.forEach((t) => { const last = days[days.length - 1]; if (last && last.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] }); });
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
  if (q) list = list.filter((t) => [t.note, lbl(TYPE_L, t.type), txnSubtitle(t), fmt(t.amountMinor, t.currency)].join(" ").toLowerCase().includes(q));
  if (f.account) list = list.filter((t) => t.accountId === f.account || t.fromAccountId === f.account || t.toAccountId === f.account);
  if (f.type) list = list.filter((t) => t.type === f.type);
  return list;
}
function screenTransactions(v) {
  const f = state.filter;
  const accOpts = `<option value="">${esc(__("All accounts"))}</option>` + state.data.accounts.map((a) => `<option value="${esc(a.id)}" ${f.account === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  v.innerHTML = `<div class="filters">
      <input id="fq" type="search" placeholder="${esc(__("Search note, tag, account…"))}" value="${esc(f.q)}">
      <select id="faccount">${accOpts}</select>
      <select id="ftype"><option value="">${esc(__("All types"))}</option>${enumOptions(TYPE_L, Object.keys(TYPE_L), f.type)}</select>
      <button class="smallbtn" id="clearF">${esc(__("Clear"))}</button></div>
    <div id="txnResults"></div>`;
  const drawResults = () => {
    const all = filteredTxns();
    // unconfirmed items wait in their own section (oldest first) instead of carrying a state on every row
    const expected = all.filter((t) => t.state === "planned").reverse(), list = all.filter((t) => t.state !== "planned");
    const size = perPage(), pages = Math.max(1, Math.ceil(list.length / size));
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const from = state.page * size, shown = list.slice(from, from + size);
    // always shown, even for one page, so paging is discoverable
    const pager = `<nav class="pager" aria-label="${esc(__("Pages"))}">
        <button class="smallbtn" data-page="${state.page - 1}" ${state.page === 0 ? "disabled" : ""}>${esc(__("‹ Previous"))}</button>
        <span>${esc(__("{from}–{to} of {total}", { from: from + 1, to: from + shown.length, total: list.length }))}</span>
        <button class="smallbtn" data-page="${state.page + 1}" ${state.page >= pages - 1 ? "disabled" : ""}>${esc(__("Next ›"))}</button></nav>`;
    const expectedHTML = expected.length ? `<section class="panel feedpanel expected" id="expectedSec"><h3>${esc(__("Expected to confirm"))}</h3><ul class="feed">${expected.map((t) => feedRow(t, { withDate: true, confirm: true })).join("")}</ul></section>` : "";
    const postedHTML = list.length ? `<section class="panel feedpanel">${feedHTML(shown, openDays())}</section>` + pager : "";
    $("#txnResults").innerHTML = expectedHTML + postedHTML || `<div class="empty">${esc(__("No transactions match. Add your first with the + button."))}</div>`;
    $("#txnResults").querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => { state.page = parseInt(b.dataset.page, 10); drawResults(); $("#view").scrollIntoView({ block: "start" }); }));
    bindConfirm($("#txnResults"));
    bindDays($("#txnResults"));
  };
  const upd = () => { state.filter = { q: $("#fq").value, account: $("#faccount").value, type: $("#ftype").value }; state.page = 0; drawResults(); };
  ["faccount", "ftype"].forEach((id) => $("#" + id).addEventListener("change", upd));
  $("#fq").addEventListener("input", upd);
  $("#clearF").addEventListener("click", () => { state.filter = { q: "", account: "", type: "" }; state.page = 0; render(); });
  drawResults();
  if (state.scrollToExpected && $("#expectedSec")) $("#expectedSec").scrollIntoView({ block: "start" });
  state.scrollToExpected = false;
}

const owedText = (a) => __("{owed} owed of {limit} ({pct}%)", { owed: fmt(a.owedMinor, a.currency), limit: fmt(a.creditLimitMinor, a.currency), pct: Math.round((a.utilisation || 0) * 100) });
function screenAccounts(v) {
  const rows = state.data.accounts.map((a) => {
    const card = a.creditLimitMinor ? `${esc(owedText(a))}<div class="bar"><i class="${barCls((a.utilisation || 0) * 100)}" style="width:${Math.min(100, (a.utilisation || 0) * 100)}%"></i></div>` : "—";
    return row([{ l: "Account", v: `<button class="titlelink" data-detail-account="${esc(a.id)}">${esc(a.name)}</button>` }, { l: N_("Kind"), v: esc(lbl(KIND_L, a.kind)) }, { l: N_("Currency"), v: esc(a.currency) }, { l: "Balance", v: fmt(a.balanceMinor, a.currency), num: 1 }, { l: "Earmarked", v: fmt(a.allocatedMinor, a.currency), num: 1 }, { l: "Free", v: fmt(a.unallocatedMinor, a.currency), num: 1 }, { l: "Credit card", v: card }]);
  }).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("All accounts"))}</h3><button class="smallbtn" id="newAccount">${esc(__("+ New account"))}</button></div>
    ${table([{ t: "Account" }, { t: "Kind" }, { t: "Currency" }, { t: "Balance", num: 1 }, { t: "Earmarked", num: 1 }, { t: "Free", num: 1 }, { t: "Credit card" }], rows)}</section>
    <p class="muted">${esc(__("Click an account name for its pane, where Edit lives. Balance is derived from posted transactions. Earmarked is money claimed by money boxes; Free is what is left. A credit card is an account that may go negative — owed is the negative balance, paying it is a transfer back."))}</p>`;
  $("#newAccount").addEventListener("click", () => openAccountDialog());
  bindDetails(v);
}

function screenBudgets(v) {
  const cats = state.data.tags.filter((t) => t.limitMinor !== undefined);
  const rows = cats.map((t) => {
    const p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
    const daysLeft = 30 - new Date().getDate() + 1;
    return row([{ l: "Budget", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Spent", v: ofAmount(t.spentMinor, t.limitMinor, t.currency) }, { l: "Progress", v: `<div class="bar"><i class="${barCls(p)}" style="width:${Math.min(100, p)}%"></i></div>${p.toFixed(0)}%` }, { l: "Remaining", v: fmt(t.remainingMinor, t.currency), num: 1 }, { l: N_("Per day left"), v: fmt(Math.max(0, Math.floor(t.remainingMinor / daysLeft)), t.currency), num: 1 }]);
  }).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Monthly budgets (this month)"))}</h3><button class="smallbtn" id="newBudget">${esc(__("+ New budget tag"))}</button></div>
    ${cats.length ? table([{ t: "Budget" }, { t: "Spent" }, { t: "Progress" }, { t: "Remaining", num: 1 }, { t: "Per day left", num: 1 }], rows) : `<div class="empty">${esc(__("No budgets yet. A budget is a category tag with a monthly limit."))}</div>`}</section>`;
  $("#newBudget").addEventListener("click", () => openTagDialog("category"));
  bindDetails(v);
}

function screenMoneyboxes(v) {
  const goals = state.data.tags.filter((t) => t.targetMinor !== undefined);
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Money boxes"))}</h3><button class="smallbtn" id="newBox">${esc(__("+ New money box"))}</button></div>
    ${goals.length ? goals.map(goalCard).join("") : `<div class="empty">${esc(__("No money boxes yet. Create a goal tag, then allocate money to it from any account."))}</div>`}</section>
    <p class="muted">${esc(__("Allocating records a decision and never moves cash; the account balance stays the same and its free amount drops. Release does the opposite. Both are listed in History."))}</p>`;
  $("#newBox").addEventListener("click", () => openTagDialog("goal"));
  bindConfirm(v);
}

const scheduleText = (s) => lbl(FREQ_L, s.frequency) + (s.dayOfMonth ? " · " + __("day {n}", { n: s.dayOfMonth }) : "");
function screenTemplates(v) {
  const rows = state.data.transactionTemplates.map((t) => row([
    { l: N_("Template"), v: `<button class="titlelink" data-detail-template="${esc(t.id)}">${esc(t.name)}</button>${t.template.expectedRangeMinor ? `<br><span class="chip due">${esc(__("variable {min}–{max}", { min: fmt(t.template.expectedRangeMinor.min, t.template.currency), max: fmt(t.template.expectedRangeMinor.max, t.template.currency) }))}</span>` : ""}` },
    { l: N_("Generates"), v: `${esc(lbl(TYPE_L, t.template.type))} ${fmt(t.template.amountMinor, t.template.currency)}<br><span class="muted">${esc(accName(t.template.accountId))}${t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : ""}</span>` },
    { l: N_("Schedule"), v: `${esc(scheduleText(t.schedule))}<br><span class="muted">${esc(__("from {date}", { date: t.schedule.startDate }))}</span>` },
    { l: N_("Next due"), v: esc(t.nextDue || "—") },
    { l: N_("Status"), v: esc(t.enabled ? __("Enabled") : __("Paused")) },
  ])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Transaction templates"))}</h3><span><button class="smallbtn" id="genBtn">${esc(__("Generate due"))}</button> <button class="smallbtn" id="newTpl">${esc(__("+ New template"))}</button></span></div>
    ${rows ? table([{ t: "Template" }, { t: "Generates" }, { t: "Schedule" }, { t: "Next due" }, { t: "Status" }], rows) : `<div class="empty">${esc(__("No templates yet."))}</div>`}
    <p class="muted">${esc(__("Click a template name for its pane (Edit, Pause, Generate). On its date a template generates one unconfirmed transaction — never twice. Confirm it (editing the amount for variable bills) to post it."))}</p></section>`;
  $("#newTpl").addEventListener("click", () => openTemplateDialog());
  $("#genBtn").addEventListener("click", generateDue);
  bindDetails(v);
}

function screenTags(v) {
  const rows = state.data.tags.map((t) => row([
    { l: N_("Tag"), v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Kind", v: esc(lbl(TAGKIND_L, t.kind)) },
    { l: N_("Budget / target"), v: esc(t.limitMinor !== undefined ? __("{amount} / month", { amount: fmt(t.limitMinor, t.currency) }) : t.targetMinor !== undefined ? fmt(t.targetMinor, t.currency) + (t.targetDate ? " · " + __("by {date}", { date: t.targetDate }) : "") : "—") },
    { l: "Currency", v: esc(t.currency || "—") },
  ])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("All tags"))}</h3><button class="smallbtn" id="newTag">${esc(__("+ New tag"))}</button></div>
    ${table([{ t: "Tag" }, { t: "Kind" }, { t: "Budget / target" }, { t: "Currency" }], rows)}
    <p class="muted">${esc(__("Click a tag name for its pane, where Edit lives. Categories, budgets and money boxes are all tags: a category tag with a limit is a budget, a goal tag is a money box."))}</p></section>`;
  $("#newTag").addEventListener("click", () => openTagDialog("label"));
  bindDetails(v);
}

function screenSettings(v) {
  const src = state.about && state.about.sourceUrl;
  const pref = (state.general && state.general.language) || "";
  const langOpts = [["", __("Browser default")], ...Object.entries(LANGS)].map(([k, name]) => `<option value="${esc(k)}" ${k === pref ? "selected" : ""} ${k ? `lang="${esc(k)}"` : ""}>${esc(name)}</option>`).join("");
  v.innerHTML = `<section class="panel"><h3>${esc(__("General"))}</h3>
      <div class="setrow"><label>${esc(__("Language"))} <select id="setLang">${langOpts}</select></label>
        <label>${esc(__("Default currency"))} <select id="setDefCur">${favCurs().map((c) => curOption(c, defCur())).join("")}</select></label>
        <label>${esc(__("Page width"))} <select id="setWidth">${enumOptions(WIDTH_L, Object.keys(WIDTH_L), pageWidth())}</select></label>
        <label>${esc(__("Days open by default"))} <select id="setOpenDays">${[...new Set([...OPEN_DAY_CHOICES, openDays()])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === openDays() ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>${esc(__("Transactions per page"))} <select id="setPerPage">${[...new Set([...PER_PAGE_CHOICES, perPage()])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === perPage() ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <div class="setlabel">${esc(__("Frequently used currencies"))}</div>
      <div class="curchips">${favCurs().map((c) => `<span class="chip cur${c === defCur() ? " def" : ""}" title="${esc(curName(c))}">${esc(c)}<button type="button" data-cur-del="${esc(c)}" aria-label="${esc(__("Remove {currency}", { currency: c }))}" ${c === defCur() ? "disabled" : ""}>×</button></span>`).join("")}</div>
      <div class="setrow"><select id="setAddCur" aria-label="${esc(__("Add currency"))}"><option value="">${esc(__("+ Add currency…"))}</option>${ALL_CURRENCIES.filter((c) => !favCurs().includes(c)).map((c) => curOption(c, "")).join("")}</select></div></section>
    <section class="panel"><h3>${esc(__("Dashboard"))}</h3>
      <div class="setrow"><button class="smallbtn" id="setCustomize">${esc(__("Customize dashboard"))}</button><button class="smallbtn" id="setDashReset">${esc(__("Reset to default"))}</button></div></section>
    <section class="panel"><h3>${esc(__("Data"))}</h3>
      <div class="setrow"><a class="smallbtn" href="/api/export" download>${esc(__("Export JSON"))}</a></div></section>
    <section class="panel"><h3>${esc(__("About"))}</h3>
      <p class="about-name"><span lang="nan-Hant-TW">記數通</span> KiSiauThong</p>
      ${detailTable([
        [N_("License"), '<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">AGPL-3.0-or-later</a>'],
        [N_("Source"), src ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(src)}</a>` : `<span class="muted">${esc(__("Set KISIAUTHONG_SOURCE_URL"))}</span>`],
      ])}</section>`;
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
  $("#setWidth").addEventListener("change", (e) => saveGeneral({ pageWidth: e.target.value }, () => __("Page width saved.")));
  $("#setOpenDays").addEventListener("change", (e) => { state.dayOpen = {}; saveGeneral({ openDays: parseInt(e.target.value, 10) }, () => __("Days open by default saved.")); });
  $("#setPerPage").addEventListener("change", (e) => { state.page = 0; saveGeneral({ transactionsPerPage: parseInt(e.target.value, 10) }, () => __("Transactions per page saved.")); });
  $("#setAddCur").addEventListener("change", (e) => { const c = e.target.value; if (c) saveGeneral({ currencies: [...favCurs(), c] }, () => __("{currency} added.", { currency: c })); });
  v.querySelectorAll("[data-cur-del]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.curDel;
    saveGeneral({ currencies: favCurs().filter((x) => x !== c) }, () => __("{currency} removed.", { currency: c }));
  }));
  $("#setCustomize").addEventListener("click", () => {
    state.dashDraft = dashLayout();
    state.dashOpen = [];
    state.customizing = true;
    location.hash = "#dashboard";
  });
  $("#setDashReset").addEventListener("click", async () => {
    if (!confirm(__("Reset the dashboard to its default layout?"))) return;
    try {
      const s = await put("/api/settings", { dashboard: DASH_DEFAULT });
      state.dashboard = s.dashboard;
      msg(__("Dashboard reset."));
    } catch (err) { errMsg(err); }
  });
}

/* ---------- drawer, dialogs, actions ---------- */
const isGoal = (t) => t.kind === "goal";
const isDecision = (type) => type === "allocate" || type === "release";
// tagOptions lists the tags pick() accepts; money boxes (goal tags) are only for allocate/release.
function tagOptions(sel, pick, allowNone = true) {
  const tags = state.data.tags.filter(pick || (() => true));
  const opts = tags.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}${pick ? "" : ` (${esc(lbl(TAGKIND_L, t.kind))})`}</option>`).join("");
  if (allowNone) return `<option value="">${esc(__("— none —"))}</option>` + opts;
  return opts || `<option value="">${esc(__("No money boxes yet."))}</option>`;
}
const accOption = (a, sel) => `<option value="${esc(a.id)}" ${a.id === sel ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`;
function fillSelects() {
  $("#fAccount").innerHTML = state.data.accounts.map((a) => accOption(a)).join("");
}
// A transfer stays in one currency: the target list holds the other accounts in the source's currency.
function refreshToAccounts(sel) {
  const from = state.data.accounts.find((a) => a.id === $("#fAccount").value);
  const list = from ? state.data.accounts.filter((a) => a.id !== from.id && a.currency === from.currency) : [];
  $("#fToAccount").innerHTML = list.map((a) => accOption(a, sel)).join("");
  $("#fToAccount").disabled = !list.length;
  const none = state.txnType === "transfer" && from && !list.length;
  $("#fToNone").hidden = !none;
  $("#fToNone").textContent = none ? __("No other {currency} account. To move money into another currency, record spending in one account and income in the other.", { currency: from.currency }) : "";
}
// setTxnType shows only the fields the type uses.
function setTxnType(type, tagId) {
  state.txnType = type;
  const decision = isDecision(type), transfer = type === "transfer";
  document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
  $("#fAccountLab").textContent = transfer ? __("From account") : __("Account");
  $("#fToWrap").hidden = !transfer;
  $("#fTagWrap").hidden = transfer;
  $("#fTagLab").textContent = decision ? __("Money box") : __("Tag");
  const keep = tagId !== undefined ? tagId : $("#fTag").value;
  $("#fTag").innerHTML = decision ? tagOptions(keep, isGoal, false) : tagOptions(keep, (t) => !isGoal(t));
  $("#fTag").required = decision;
  $("#fStateWrap").hidden = decision;
  refreshToAccounts($("#fToAccount").value);
}
function openDrawer(type, tagId) {
  state.editingTxn = null;
  fillSelects();
  $("#txnForm").reset();
  $("#txnForm").elements.date.value = new Date().toISOString().slice(0, 10);
  setTxnType(type || "expense", tagId);
  $("#drawerTitle").textContent = type === "allocate" ? __("Allocate to money box") : type === "release" ? __("Release from money box") : __("Add transaction");
  $("#drawer").hidden = false; $("#drawerBackdrop").hidden = false;
}
function openEditTxn(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  state.editingTxn = id;
  fillSelects();
  const form = $("#txnForm");
  form.reset();
  form.elements.accountId.value = t.type === "transfer" ? t.fromAccountId : t.accountId;
  const linkedTag = t.tagId || (state.data.transactionTags.find((x) => x.transactionId === t.id) || {}).tagId || "";
  setTxnType(t.type, linkedTag);
  if (t.type === "transfer") refreshToAccounts(t.toAccountId);
  form.elements.amount.value = decimal(t.amountMinor, t.currency);
  form.elements.date.value = t.date;
  form.elements.note.value = t.note || "";
  form.elements.state.value = t.state;
  $("#drawerTitle").textContent = __("Edit transaction");
  $("#drawer").hidden = false; $("#drawerBackdrop").hidden = false;
}
function closeDrawer() { $("#drawer").hidden = true; $("#drawerBackdrop").hidden = true; }
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
document.querySelectorAll("#typeSeg button").forEach((b) => b.addEventListener("click", () => setTxnType(b.dataset.type)));
$("#fAccount").addEventListener("change", () => refreshToAccounts($("#fToAccount").value));
$("#addBtn").addEventListener("click", () => openDrawer("expense"));

$("#txnForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target).entries());
  const cur = accCur(f.accountId), type = state.txnType;
  if (type === "transfer" && !f.toAccountId) { msg($("#fToNone").textContent || __("Choose an account to transfer to.")); return; }
  const body = { type, accountId: f.accountId, amountMinor: toMinor(f.amount, cur), currency: cur, date: f.date, note: f.note || "", state: isDecision(type) ? "posted" : f.state };
  if (type === "transfer") { body.fromAccountId = f.accountId; body.toAccountId = f.toAccountId; body.accountId = ""; }
  else if (f.tagId) body.tagId = f.tagId;
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
function dialogForm(fields, submitLabel) {
  return `<form id="dialogForm">${fields}<button class="primarybtn big" type="submit">${esc(submitLabel)}</button></form>`;
}
function openAccountDialog(editId) {
  const a = editId ? state.data.accounts.find((x) => x.id === editId) : null;
  openDialog(a ? __("Edit account") : __("New account"), dialogForm(
    field(N_("Name"), `<input name="name" required placeholder="${esc(__("Savings A"))}" value="${a ? esc(a.name) : ""}">`) +
    field("Kind", `<select name="kind">${enumOptions(KIND_L, ["bank", "savings", "cash", "credit_card", "ewallet", "investment", "loan"], a && a.kind)}</select>`) +
    field("Currency", `<select name="currency" required>${currencyOptions(a && a.currency)}</select>`) +
    field(N_("Opening balance"), `<input name="opening" type="number" step="0.01" value="${a ? decimal(a.openingBalanceMinor, a.currency) : "0"}">`) +
    field(N_("Credit limit (cards only)"), `<input name="creditLimit" type="number" step="0.01" value="${a && a.creditLimitMinor ? decimal(a.creditLimitMinor, a.currency) : ""}">`),
    a ? __("Save changes") : __("Add account")));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = f.currency.toUpperCase();
    const body = { name: f.name, kind: f.kind, currency: cur, openingBalanceMinor: toMinor(f.opening, cur), allowNegative: f.kind === "credit_card" };
    if (a) { body.statementCloseDay = a.statementCloseDay; body.paymentDueDay = a.paymentDueDay; }
    if (f.creditLimit) body.creditLimitMinor = toMinor(f.creditLimit, cur);
    try {
      if (a) { await put("/api/accounts/" + a.id, body); msg(__("Account updated.")); } else { await post("/api/accounts", body); msg(__("Account added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
function openTagDialog(kind, editId) {
  const t = editId ? state.data.tags.find((x) => x.id === editId) : null;
  const k = t ? t.kind : kind;
  openDialog(t ? __("Edit tag") : k === "goal" ? __("New money box (goal tag)") : k === "category" ? __("New budget (category tag)") : __("New tag"), dialogForm(
    field("Name", `<input name="name" required placeholder="${esc(k === "goal" ? __("House fund") : __("Food"))}" value="${t ? esc(t.name) : ""}">`) +
    field("Kind", `<select name="kind">${enumOptions(TAGKIND_L, ["category", "goal", "label", "payee"], k)}</select>`) +
    field(N_("Monthly limit (optional)"), `<input name="limit" type="number" step="0.01" value="${t && t.limitMinor !== undefined ? decimal(t.limitMinor, t.currency || defCur()) : ""}">`, "f-category") +
    field(N_("Target amount"), `<input name="target" type="number" step="0.01" value="${t && t.targetMinor !== undefined ? decimal(t.targetMinor, t.currency || defCur()) : ""}">`, "f-goal") +
    field("Target date", `<input name="targetDate" type="date" value="${t ? esc(t.targetDate || "") : ""}">`, "f-goal") +
    field("Currency", `<select name="currency">${currencyOptions(t && t.currency)}</select>`, "f-category f-goal"),
    t ? __("Save changes") : __("Add tag")));
  const form = $("#dialogForm");
  const sync = () => {
    const kind = form.elements.kind.value;
    form.querySelectorAll(".f-category, .f-goal").forEach((el) => { el.hidden = !el.classList.contains("f-" + kind); });
    form.elements.target.required = kind === "goal";
  };
  form.elements.kind.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = (f.currency || defCur()).toUpperCase();
    const body = { name: f.name, kind: f.kind };
    if (f.kind === "category" || f.kind === "goal") body.currency = cur;
    if (f.kind === "category" && f.limit) { body.limitMinor = toMinor(f.limit, cur); body.cycle = "monthly"; }
    if (f.kind === "goal") { body.targetMinor = toMinor(f.target, cur); if (f.targetDate) body.targetDate = f.targetDate; }
    try {
      if (t) { await put("/api/tags/" + t.id, body); msg(__("Tag updated.")); } else { await post("/api/tags", body); msg(__("Tag added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
function openTemplateDialog(editId) {
  const tp = editId ? state.data.transactionTemplates.find((x) => x.id === editId) : null;
  const acc = state.data.accounts.map((a) => `<option value="${esc(a.id)}" ${tp && tp.template.accountId === a.id ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`).join("");
  const rng = tp && tp.template.expectedRangeMinor ? tp.template.expectedRangeMinor : null;
  openDialog(tp ? __("Edit transaction template") : __("New transaction template"), dialogForm(
    field("Name", `<input name="name" required placeholder="${esc(__("Streaming"))}" value="${tp ? esc(tp.name) : ""}">`) +
    field("Generates", `<select name="type">${enumOptions(TYPE_L, ["expense", "income", "allocate"], tp && tp.template.type)}</select>`) +
    field("Account", `<select name="accountId">${acc}</select>`) +
    field("Money box", `<select name="tagId">${tagOptions(tp && tp.template.tagId, isGoal, false)}</select>`, "f-goal") +
    field("Amount", `<input name="amount" type="number" step="0.01" min="0.01" required value="${tp ? decimal(tp.template.amountMinor, tp.template.currency) : ""}">`) +
    field(N_("Frequency"), `<select name="frequency">${enumOptions(FREQ_L, ["monthly", "quarterly", "yearly", "weekly", "daily"], tp ? tp.schedule.frequency : "monthly")}</select>`) +
    field(N_("Expected min (variable bill, optional)"), `<input name="rangeMin" type="number" step="0.01" value="${rng ? decimal(rng.min, tp.template.currency) : ""}">`, "f-range") +
    field(N_("Expected max (variable bill, optional)"), `<input name="rangeMax" type="number" step="0.01" value="${rng ? decimal(rng.max, tp.template.currency) : ""}">`, "f-range") +
    field(N_("Day of month"), `<input name="dayOfMonth" type="number" min="1" max="31" value="${tp ? tp.schedule.dayOfMonth || 1 : 1}">`, "f-dom") +
    field(N_("Start date"), `<input name="startDate" type="date" required value="${tp ? esc(tp.schedule.startDate) : ""}">`) +
    field(N_("Note"), `<input name="note" value="${tp ? esc(tp.template.note || "") : ""}">`, "wide"),
    tp ? __("Save changes") : __("Add template")));
  const form = $("#dialogForm");
  const sync = () => {
    const alloc = form.elements.type.value === "allocate";
    form.querySelectorAll(".f-goal").forEach((el) => { el.hidden = !alloc; });
    form.querySelectorAll(".f-range").forEach((el) => { el.hidden = alloc; });
    form.querySelectorAll(".f-dom").forEach((el) => { el.hidden = !["monthly", "quarterly", "yearly"].includes(form.elements.frequency.value); });
    form.elements.tagId.required = alloc;
  };
  form.elements.type.addEventListener("change", sync);
  form.elements.frequency.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = accCur(f.accountId);
    const tpl = { accountId: f.accountId, type: f.type, amountMinor: toMinor(f.amount, cur), currency: cur, note: f.note || "" };
    if (f.type === "allocate" && f.tagId) tpl.tagId = f.tagId;
    if (f.type !== "allocate" && f.rangeMin && f.rangeMax) tpl.expectedRangeMinor = { min: toMinor(f.rangeMin, cur), max: toMinor(f.rangeMax, cur) };
    const body = { name: f.name, enabled: tp ? tp.enabled : true, template: tpl, schedule: { frequency: f.frequency, interval: tp ? tp.schedule.interval || 1 : 1, dayOfMonth: parseInt(f.dayOfMonth, 10) || 1, startDate: f.startDate, endDate: tp ? tp.schedule.endDate || "" : "" } };
    try {
      if (tp) { await put("/api/templates/" + tp.id, body); msg(__("Template updated.")); } else { await post("/api/templates", body); msg(__("Template added.")); }
      $("#dialog").close(); await load();
    } catch (err) { errMsg(err); }
  });
}
function openConfirm(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const tpl = state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  const range = tpl && tpl.template.expectedRangeMinor ? `<p class="muted">${esc(__("Expected range {min} – {max}. Edit the amount to the actual charge if it differs.", { min: fmt(tpl.template.expectedRangeMinor.min, t.currency), max: fmt(tpl.template.expectedRangeMinor.max, t.currency) }))}</p>` : "";
  openDialog(__("Confirm expected transaction"), `${range}<p><strong>${esc(txnTitle(t))}</strong> · ${esc(accName(t.accountId))} · ${esc(t.date)}</p>` + dialogForm(
    field(N_("Actual amount"), `<input name="amount" type="number" step="0.01" min="0.01" required value="${decimal(t.amountMinor, t.currency)}">`, "wide"),
    __("Confirm and post")));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try { await post("/api/transactions/" + id + "/post", { amountMinor: toMinor(f.amount, t.currency) }); $("#dialog").close(); msg(__("Posted.")); await load(); }
    catch (err) { errMsg(err); }
  });
}
function showHistory(tagId) {
  const list = state.data.transactions.filter((t) => t.tagId === tagId && (t.type === "allocate" || t.type === "release"))
    .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  openDialog(__("History — {name}", { name: tagName(tagId) }), list.length
    ? table([{ t: "Date" }, { t: N_("Decision") }, { t: "Account" }, { t: "Amount", num: 1 }], list.map((t) => row([{ l: "Date", v: esc(t.date) }, { l: "Decision", v: `${esc(lbl(TYPE_L, t.type))}${t.note ? " — " + esc(t.note) : ""}` }, { l: "Account", v: esc(accName(t.accountId)) }, { l: "Amount", v: fmt(t.amountMinor, t.currency), num: 1 }])).join(""))
    : `<p class="muted">${esc(__("No allocate or release decisions yet."))}</p>`);
}
const fullDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); try { return new Intl.DateTimeFormat(LANG, { dateStyle: "full" }).format(new Date(y, m - 1, d)); } catch (e) { return iso; } };
// flowEnds: where the money came from and went to, as cards { name, role, open: [kind, id] }.
function flowEnds(t) {
  const acc = (id) => { const a = state.data.accounts.find((x) => x.id === id); return { name: accName(id), role: a ? lbl(KIND_L, a.kind) : "", open: ["account", id] }; };
  const box = (id) => ({ name: tagName(id), role: __("Money box"), open: ["tag", id] });
  const cats = state.data.tags.filter((x) => isCategoryOf(t, x));
  const catEnd = cats.length ? { name: cats.map((x) => x.name).join(", "), role: __("Category"), open: cats.length === 1 ? ["tag", cats[0].id] : null } : null;
  switch (t.type) {
    case "expense": return [acc(t.accountId), catEnd || { name: __("Uncategorised"), role: __("Spending") }];
    case "income": return [catEnd || { name: __("Income"), role: __("From outside") }, acc(t.accountId)];
    case "transfer": return [acc(t.fromAccountId), acc(t.toAccountId)];
    case "allocate": return [acc(t.accountId), box(t.tagId)];
    case "release": return [box(t.tagId), acc(t.accountId)];
  }
  return [acc(t.accountId), { name: "—", role: "" }];
}
const linkedTags = (t) => state.data.tags.filter((x) => x.id === t.tagId || state.data.transactionTags.some((l) => l.transactionId === t.id && l.tagId === x.id));
const isCategoryOf = (t, tag) => tag.kind === "category" && linkedTags(t).some((x) => x.id === tag.id);
function openTxnDetail(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const tpl = t.transactionTemplateId && state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  const [from, to] = flowEnds(t);
  const node = (e) => e.open
    ? `<button type="button" class="node" data-open-${e.open[0]}="${esc(e.open[1])}"><b>${esc(e.name)}</b><small>${esc(e.role)}</small></button>`
    : `<div class="node"><b>${esc(e.name)}</b><small>${esc(e.role)}</small></div>`;
  // tags the flow cards do not already show (labels, payees)
  const inFlow = (x) => x.kind === "goal" || ((t.type === "expense" || t.type === "income") && x.kind === "category");
  const extraTags = linkedTags(t).filter((x) => !inFlow(x));
  const facts = [
    ...(extraTags.length ? [[__("Tags"), extraTags.map((x) => `<button type="button" class="chip tagchip" data-open-tag="${esc(x.id)}">${esc(x.name)}</button>`).join(" ")]] : []),
    ...(t.transactionTemplateId ? [[__("Generated by"), tpl ? `<button type="button" class="titlelink" data-open-template="${esc(tpl.id)}">${esc(tpl.name)}</button>` : esc(t.transactionTemplateId)]] : []),
  ];
  openDialog(txnTitle(t), `
    ${t.state === "planned" ? `<div class="txbanner"><span>${esc(__("Expected, not confirmed yet. Confirm it when the real charge or income arrives."))}</span><button type="button" class="primarybtn" id="paneConfirm">${esc(__("Confirm…"))}</button></div>` : ""}
    <div class="txhero">
      <div class="sub"><span class="ficon t-${esc(t.type)}" aria-hidden="true">${typeIcon(t.type)}</span><span>${esc(lbl(TYPE_L, t.type))} · ${esc(fullDate(t.date))}</span></div>
      <div class="big ${amountCls(t)}">${esc(amountText(t))}</div>
    </div>
    <div class="flow">${node(from)}<span class="arrow" aria-label="${esc(__("to"))}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${node(to)}</div>
    ${facts.length ? `<dl class="txfacts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
    <div class="txactions"><button type="button" class="smallbtn danger" id="paneDelete">${esc(__("Delete"))}</button><button type="button" class="smallbtn" id="paneEdit">${esc(__("Edit"))}</button></div>`);
  const body = $("#dialogBody");
  const go = (fn) => (b) => b.addEventListener("click", () => { $("#dialog").close(); fn(); });
  body.querySelectorAll("[data-open-account]").forEach((b) => go(() => openAccountDetail(b.dataset.openAccount))(b));
  body.querySelectorAll("[data-open-tag]").forEach((b) => go(() => openTagDetail(b.dataset.openTag))(b));
  body.querySelectorAll("[data-open-template]").forEach((b) => go(() => openTemplateDetail(b.dataset.openTemplate))(b));
  const confirmBtn = $("#paneConfirm");
  if (confirmBtn) go(() => openConfirm(id))(confirmBtn);
  go(() => openEditTxn(id))($("#paneEdit"));
  $("#paneDelete").addEventListener("click", async () => { if (await deleteTxn(id)) $("#dialog").close(); });
}
function openAccountDetail(id) {
  const a = state.data.accounts.find((x) => x.id === id);
  if (!a) return;
  openDialog(a.name, detailTable([
    ["Kind", esc(lbl(KIND_L, a.kind))], ["Currency", esc(a.currency)],
    ["Balance", fmt(a.balanceMinor, a.currency)], [N_("Earmarked in money boxes"), fmt(a.allocatedMinor, a.currency)], ["Free", fmt(a.unallocatedMinor, a.currency)],
    ...(a.creditLimitMinor ? [[N_("Credit card owed"), esc(owedText(a))]] : []),
  ]) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">${esc(__("Edit account"))}</button></div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openAccountDialog(id); });
}
function openTagDetail(id) {
  const t = state.data.tags.find((x) => x.id === id);
  if (!t) return;
  const pairs = [["Kind", esc(lbl(TAGKIND_L, t.kind))], ["Currency", esc(t.currency || "—")]];
  if (t.limitMinor !== undefined) pairs.push([N_("Monthly budget"), fmt(t.limitMinor, t.currency)], [N_("Spent this month"), fmt(t.spentMinor, t.currency)], ["Remaining", fmt(t.remainingMinor, t.currency)]);
  if (t.targetMinor !== undefined) pairs.push([N_("Money-box target"), fmt(t.targetMinor, t.currency)], [N_("Saved"), fmt(t.savedMinor, t.currency)], [N_("Target date"), esc(t.targetDate || "—")]);
  openDialog(t.name, detailTable(pairs) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">${esc(__("Edit tag"))}</button>${t.targetMinor !== undefined ? `<button class="smallbtn" id="paneAlloc">${esc(__("Allocate"))}</button><button class="smallbtn" id="paneRelease">${esc(__("Release"))}</button><button class="smallbtn" id="paneHistory">${esc(__("History"))}</button>` : ""}</div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openTagDialog(null, id); });
  const alloc = $("#paneAlloc"), rel = $("#paneRelease"), hist = $("#paneHistory");
  if (alloc) alloc.addEventListener("click", () => { $("#dialog").close(); openDrawer("allocate", id); });
  if (rel) rel.addEventListener("click", () => { $("#dialog").close(); openDrawer("release", id); });
  if (hist) hist.addEventListener("click", () => { $("#dialog").close(); showHistory(id); });
}
function openTemplateDetail(id) {
  const t = state.data.transactionTemplates.find((x) => x.id === id);
  if (!t) return;
  openDialog(t.name, detailTable([
    ["Status", esc(t.enabled ? __("Enabled") : __("Paused"))],
    ["Generates", esc(__("{type} {amount} on {account}", { type: lbl(TYPE_L, t.template.type), amount: fmt(t.template.amountMinor, t.template.currency), account: accName(t.template.accountId) })) + (t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : "")],
    ...(t.template.expectedRangeMinor ? [[N_("Expected range (variable)"), fmt(t.template.expectedRangeMinor.min, t.template.currency) + " – " + fmt(t.template.expectedRangeMinor.max, t.template.currency)]] : []),
    ["Schedule", esc(scheduleText(t.schedule) + " · " + __("from {date}", { date: t.schedule.startDate }))],
    ["Next due", esc(t.nextDue || "—")], ["Note", esc(t.template.note || "—")],
  ]) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">${esc(__("Edit template"))}</button><button class="smallbtn" id="paneToggle">${esc(t.enabled ? __("Pause") : __("Resume"))}</button><button class="smallbtn" id="paneGenerate">${esc(__("Generate due"))}</button></div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openTemplateDialog(id); });
  $("#paneToggle").addEventListener("click", async () => {
    try { await post("/api/templates/" + id + "/toggle"); $("#dialog").close(); msg(__("Template updated.")); await load(); } catch (e) { errMsg(e); }
  });
  $("#paneGenerate").addEventListener("click", async () => { $("#dialog").close(); await generateDue(); });
}
function openMoneyboxDetail(id) {
  openTagDetail(id);
}
async function generateDue() {
  try { const r = await post("/api/generate", {}); msg(__("Generated {n} due transaction(s).", { n: r.created })); await load(); }
  catch (e) { errMsg(e); }
}
$("#dueBtn").addEventListener("click", () => { state.scrollToExpected = true; if (location.hash === "#transactions") render(); else location.hash = "#transactions"; });

/* ---------- routing ---------- */
const SCREENS = { dashboard: [N_("Dashboard"), screenDashboard], transactions: [N_("Transactions"), screenTransactions], accounts: ["Accounts", screenAccounts], budgets: [N_("Budgets"), screenBudgets], moneyboxes: ["Money boxes", screenMoneyboxes], templates: [N_("Templates"), screenTemplates], tags: [N_("Tags"), screenTags], settings: [N_("Settings"), screenSettings] };
function currentScreen() { const h = location.hash.replace("#", ""); return SCREENS[h] ? h : "dashboard"; }
function render() {
  const key = currentScreen();
  $("#pageTitle").textContent = __(SCREENS[key][0]);
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.screen === key));
  const planned = state.data ? state.data.transactions.filter((t) => t.state === "planned").length : 0;
  $("#dueBtn").hidden = planned === 0;
  $("#dueBtn").textContent = __("Expected to confirm: {n}", { n: planned });
  SCREENS[key][1]($("#view"));
}
window.addEventListener("hashchange", render);
async function load() {
  state.data = await api("/api/state");
  try {
    const s = await api("/api/settings");
    state.dashboard = s.dashboard;
    state.general = s.general;
    state.about = s.about;
  } catch (e) { msg(__("Settings unavailable, using defaults: {message}", { message: e.message })); }
  setLang(pickLang(state.general && state.general.language));
  applyPageWidth();
  render();
}
setLang(pickLang(""));
load().catch((e) => { msg(__("Failed to load: {message}", { message: e.message })); });
