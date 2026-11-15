// SPDX-License-Identifier: AGPL-3.0-or-later
// All user-visible strings go through __() / N_() from i18n.js (English source strings).
"use strict";
const $ = (s) => document.querySelector(s);
const state = { data: null, dashboard: null, general: null, about: null, customizing: false, dashDraft: null, dashOpen: [], dragId: null, txnType: "expense", editingTxn: null, filter: { q: "", account: "", type: "", state: "" }, page: 0 };
const EXP = { JPY: 0, KRW: 0 };
const expOf = (c) => (c in EXP ? EXP[c] : 2);
const defCur = () => (state.general && state.general.defaultCurrency) || "TWD";
const PER_PAGE_CHOICES = [20, 50, 100, 200];
const perPage = () => (state.general && state.general.transactionsPerPage) || 50;
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
const stateCell = (t) => t.state === "planned" ? unconfirmed() : esc(__("posted"));
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
      const list = [...d.transactions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, rows).map((t) =>
        row([{ l: "Date", v: esc(t.date) }, { l: N_("Transaction"), v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(txnTitle(t))}</button>` }, { l: "Account", v: esc(transferAcct(t)) }, { l: N_("State"), v: stateCell(t) }, { l: "Amount", v: signed(t) + fmt(t.amountMinor, t.currency), num: 1 }])).join("");
      return table([{ t: "Date" }, { t: "Transaction" }, { t: "Account" }, { t: "State" }, { t: "Amount", num: 1 }], list);
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

function txnRows(list) {
  const tagOf = {};
  state.data.transactionTags.forEach((tt) => { (tagOf[tt.transactionId] = tagOf[tt.transactionId] || []).push(tagName(tt.tagId)); });
  return list.map((t) => {
    const tags = [...new Set([t.tagId ? tagName(t.tagId) : "", ...(tagOf[t.id] || [])].filter(Boolean))].join(", ");
    return `<tr class="${t.state === "planned" ? "planned unconfirmed" : ""}">` + [
      { l: "Date", v: esc(t.date) }, { l: "Transaction", v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(txnTitle(t))}</button><br><span class="muted">${esc(lbl(TYPE_L, t.type))}${tags ? " · " + esc(tags) : ""}</span>` },
      { l: "Account", v: esc(transferAcct(t)) }, { l: "State", v: stateCell(t) },
      { l: "Amount", v: signed(t) + fmt(t.amountMinor, t.currency), num: 1 },
    ].map((c) => `<td data-label="${esc(__(c.l))}" class="${c.num ? "num" : ""}">${c.v}</td>`).join("") + "</tr>";
  }).join("");
}
async function deleteTxn(id) {
  if (!confirm(__("Delete this transaction? This cannot be undone."))) return false;
  try { await api("/api/transactions/" + id, { method: "DELETE" }); msg(__("Deleted.")); await load(); return true; }
  catch (e) { errMsg(e); return false; }
}
function bindTxnActions(root) {
  bindConfirm(root);
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditTxn(b.dataset.edit)));
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteTxn(b.dataset.del)));
}
function filteredTxns() {
  const f = state.filter;
  let list = [...state.data.transactions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (f.q) list = list.filter((t) => (t.note + t.type + lbl(TYPE_L, t.type) + accName(t.accountId)).toLowerCase().includes(f.q.toLowerCase()));
  if (f.account) list = list.filter((t) => t.accountId === f.account || t.fromAccountId === f.account || t.toAccountId === f.account);
  if (f.type) list = list.filter((t) => t.type === f.type);
  if (f.state) list = list.filter((t) => t.state === f.state);
  return list;
}
function screenTransactions(v) {
  const f = state.filter;
  const accOpts = `<option value="">${esc(__("All accounts"))}</option>` + state.data.accounts.map((a) => `<option value="${esc(a.id)}" ${f.account === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  v.innerHTML = `<div class="filters">
      <input id="fq" type="search" placeholder="${esc(__("Search note, type, account…"))}" value="${esc(f.q)}">
      <select id="faccount">${accOpts}</select>
      <select id="ftype"><option value="">${esc(__("All types"))}</option>${enumOptions(TYPE_L, Object.keys(TYPE_L), f.type)}</select>
      <select id="fstate"><option value="">${esc(__("Posted + expected"))}</option><option value="posted" ${f.state === "posted" ? "selected" : ""}>${esc(__("Posted only"))}</option><option value="planned" ${f.state === "planned" ? "selected" : ""}>${esc(__("Expected only"))}</option></select>
      <button class="smallbtn" id="clearF">${esc(__("Clear"))}</button></div>
    <div id="txnResults"></div>`;
  const drawResults = () => {
    const list = filteredTxns(), size = perPage(), pages = Math.max(1, Math.ceil(list.length / size));
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const from = state.page * size, shown = list.slice(from, from + size);
    const pager = list.length > size ? `<nav class="pager" aria-label="${esc(__("Pages"))}">
        <button class="smallbtn" data-page="${state.page - 1}" ${state.page === 0 ? "disabled" : ""}>${esc(__("‹ Previous"))}</button>
        <span>${esc(__("{from}–{to} of {total}", { from: from + 1, to: from + shown.length, total: list.length }))}</span>
        <button class="smallbtn" data-page="${state.page + 1}" ${state.page >= pages - 1 ? "disabled" : ""}>${esc(__("Next ›"))}</button></nav>` : "";
    $("#txnResults").innerHTML = list.length ? table([{ t: "Date" }, { t: "Transaction" }, { t: "Account" }, { t: "State" }, { t: "Amount", num: 1 }], txnRows(shown)) + pager : `<div class="empty">${esc(__("No transactions match. Add your first with the + button."))}</div>`;
    $("#txnResults").querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => { state.page = parseInt(b.dataset.page, 10); drawResults(); $("#view").scrollIntoView({ block: "start" }); }));
    bindTxnActions($("#txnResults"));
  };
  const upd = () => { state.filter = { q: $("#fq").value, account: $("#faccount").value, type: $("#ftype").value, state: $("#fstate").value }; state.page = 0; drawResults(); };
  ["faccount", "ftype", "fstate"].forEach((id) => $("#" + id).addEventListener("change", upd));
  $("#fq").addEventListener("input", upd);
  $("#clearF").addEventListener("click", () => { state.filter = { q: "", account: "", type: "", state: "" }; state.page = 0; render(); });
  drawResults();
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
      msg(done());
    } catch (err) { errMsg(err); }
    render();
  };
  $("#setLang").addEventListener("change", (e) => saveGeneral({ language: e.target.value }, () => __("Language saved.")));
  $("#setDefCur").addEventListener("change", (e) => saveGeneral({ defaultCurrency: e.target.value }, () => __("Default currency saved.")));
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
const tagOptions = (sel) => `<option value="">${esc(__("— none —"))}</option>` + state.data.tags.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)} (${esc(lbl(TAGKIND_L, t.kind))})</option>`).join("");
function fillSelects() {
  const acc = state.data.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.currency)})</option>`).join("");
  $("#fAccount").innerHTML = acc; $("#fToAccount").innerHTML = acc;
  $("#fTag").innerHTML = tagOptions("");
}
function setTxnType(type, tagId) {
  state.txnType = type;
  document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
  $("#fToWrap").hidden = type !== "transfer";
  $("#fStateWrap").hidden = type === "allocate" || type === "release";
  if (tagId) $("#fTag").value = tagId;
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
  setTxnType(t.type, t.tagId);
  form.elements.accountId.value = t.type === "transfer" ? t.fromAccountId : t.accountId;
  if (t.type === "transfer") form.elements.toAccountId.value = t.toAccountId;
  form.elements.amount.value = decimal(t.amountMinor, t.currency);
  form.elements.date.value = t.date;
  const linkedTag = t.tagId || (state.data.transactionTags.find((x) => x.transactionId === t.id) || {}).tagId || "";
  if (linkedTag) form.elements.tagId.value = linkedTag;
  form.elements.note.value = t.note || "";
  form.elements.state.value = t.state;
  $("#drawerTitle").textContent = __("Edit transaction");
  $("#drawer").hidden = false; $("#drawerBackdrop").hidden = false;
}
function closeDrawer() { $("#drawer").hidden = true; $("#drawerBackdrop").hidden = true; }
$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);
document.querySelectorAll("#typeSeg button").forEach((b) => b.addEventListener("click", () => setTxnType(b.dataset.type)));
$("#addBtn").addEventListener("click", () => openDrawer("expense"));

$("#txnForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target).entries());
  const cur = accCur(f.accountId), type = state.txnType;
  const body = { type, accountId: f.accountId, amountMinor: toMinor(f.amount, cur), currency: cur, date: f.date, note: f.note || "", state: type === "allocate" || type === "release" ? "posted" : f.state };
  if (type === "transfer") { body.fromAccountId = f.accountId; body.toAccountId = f.toAccountId; body.accountId = ""; }
  if (f.tagId) body.tagId = f.tagId;
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
    field(N_("Monthly limit (category, optional)"), `<input name="limit" type="number" step="0.01" value="${t && t.limitMinor !== undefined ? decimal(t.limitMinor, t.currency || defCur()) : ""}">`) +
    field(N_("Target (goal, optional)"), `<input name="target" type="number" step="0.01" value="${t && t.targetMinor !== undefined ? decimal(t.targetMinor, t.currency || defCur()) : ""}">`) +
    field(N_("Target date (goal)"), `<input name="targetDate" type="date" value="${t ? esc(t.targetDate || "") : ""}">`) +
    field("Currency", `<select name="currency">${currencyOptions(t && t.currency)}</select>`),
    t ? __("Save changes") : __("Add tag")));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = (f.currency || defCur()).toUpperCase();
    const body = { name: f.name, kind: f.kind, currency: cur };
    if (f.limit) { body.limitMinor = toMinor(f.limit, cur); body.cycle = "monthly"; }
    if (f.target) body.targetMinor = toMinor(f.target, cur);
    if (f.targetDate) body.targetDate = f.targetDate;
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
    field(N_("Goal tag (allocate only)"), `<select name="tagId">${tagOptions(tp && tp.template.tagId)}</select>`) +
    field("Amount", `<input name="amount" type="number" step="0.01" min="0.01" required value="${tp ? decimal(tp.template.amountMinor, tp.template.currency) : ""}">`) +
    field(N_("Frequency"), `<select name="frequency">${enumOptions(FREQ_L, ["monthly", "quarterly", "yearly", "weekly", "daily"], tp ? tp.schedule.frequency : "monthly")}</select>`) +
    field(N_("Expected min (variable bill, optional)"), `<input name="rangeMin" type="number" step="0.01" value="${rng ? decimal(rng.min, tp.template.currency) : ""}">`) +
    field(N_("Expected max (variable bill, optional)"), `<input name="rangeMax" type="number" step="0.01" value="${rng ? decimal(rng.max, tp.template.currency) : ""}">`) +
    field(N_("Day of month"), `<input name="dayOfMonth" type="number" min="1" max="31" value="${tp ? tp.schedule.dayOfMonth || 1 : 1}">`) +
    field(N_("Start date"), `<input name="startDate" type="date" required value="${tp ? esc(tp.schedule.startDate) : ""}">`) +
    field(N_("Note"), `<input name="note" value="${tp ? esc(tp.template.note || "") : ""}">`, "wide"),
    tp ? __("Save changes") : __("Add template")));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = accCur(f.accountId);
    const tpl = { accountId: f.accountId, type: f.type, amountMinor: toMinor(f.amount, cur), currency: cur, note: f.note || "" };
    if (f.tagId) tpl.tagId = f.tagId;
    if (f.rangeMin && f.rangeMax) tpl.expectedRangeMinor = { min: toMinor(f.rangeMin, cur), max: toMinor(f.rangeMax, cur) };
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
function openTxnDetail(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const tagOf = state.data.transactionTags.filter((x) => x.transactionId === id).map((x) => tagName(x.tagId));
  const tags = [...new Set([t.tagId ? tagName(t.tagId) : "", ...tagOf].filter(Boolean))].join(", ") || "—";
  const tpl = t.transactionTemplateId && state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  openDialog(txnTitle(t), detailTable([
    ["Status", t.state === "planned" ? `<span class="chip due">${esc(__("UNCONFIRMED — expected"))}</span>` : esc(__("Confirmed (posted)"))],
    [N_("Type"), esc(lbl(TYPE_L, t.type))], ["Date", esc(t.date)], ["Account", esc(transferAcct(t))], ["Tag", esc(tags)],
    ["Amount", fmt(t.amountMinor, t.currency)],
    ...(t.transactionTemplateId ? [[N_("Generated by"), esc(tpl ? tpl.name : t.transactionTemplateId)]] : []),
  ]) + `<div class="pane-actions">${t.state === "planned" ? `<button class="smallbtn" id="paneConfirm">${esc(__("Confirm…"))}</button>` : ""}<button class="smallbtn" id="paneEdit">${esc(__("Edit"))}</button><button class="smallbtn danger" id="paneDelete">${esc(__("Delete"))}</button></div>`);
  const confirmBtn = $("#paneConfirm");
  if (confirmBtn) confirmBtn.addEventListener("click", () => { $("#dialog").close(); openConfirm(id); });
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openEditTxn(id); });
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
$("#dueBtn").addEventListener("click", () => { location.hash = "#transactions"; state.filter.state = "planned"; state.page = 0; render(); });

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
  render();
}
setLang(pickLang(""));
load().catch((e) => { msg(__("Failed to load: {message}", { message: e.message })); });
