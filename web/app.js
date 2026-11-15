// SPDX-License-Identifier: AGPL-3.0-or-later
// All user-visible strings go through __() / N_() from i18n.js (English source strings).
"use strict";
const $ = (s) => document.querySelector(s);
const state = { data: null, dashboard: null, general: null, about: null, customizing: false, dashDraft: null, dashSel: null, txnType: "expense", editingTxn: null, filter: { q: "", account: "", type: "" }, period: null, dayOpen: {}, dismissed: [], notifOpen: false };
const EXP = { JPY: 0, KRW: 0 };
const expOf = (c) => (c in EXP ? EXP[c] : 2);
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
async function api(path, opts) {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const put = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const decimal = (minor, currency) => ((minor || 0) / Math.pow(10, expOf(currency || defCur()))).toFixed(expOf(currency || defCur()));
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
const KIND_L = { bank: N_("Bank"), savings: N_("Savings"), cash: N_("Cash"), credit_card: N_("Credit card"), ewallet: N_("E-wallet"), investment: N_("Investment"), loan: N_("Loan"), external: N_("External") };
const OWN_KINDS = ["bank", "savings", "cash", "credit_card", "ewallet", "investment", "loan"];
const TAGKIND_L = { category: N_("Category"), goal: N_("Goal"), label: N_("Label"), payee: N_("Payee") };
const FREQ_L = { daily: N_("Daily"), weekly: N_("Weekly"), monthly: N_("Monthly"), quarterly: N_("Quarterly"), yearly: N_("Yearly") };
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
  { id: "budgets", label: N_("Budgets this month"), pick: "budgets" },
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
  switch (id) {
    case "balances": {
      const perCur = {};
      d.accounts.forEach((a) => { if (inc(a.currency)) perCur[a.currency] = (perCur[a.currency] || 0) + a.balanceMinor; });
      return `<div class="cards">${Object.entries(perCur).map(([c, val]) => `<div class="card"><span class="lab">${esc(__("Balance · {currency}", { currency: c }))}</span><b>${fmt(val, c)}</b><span class="muted">${esc(__("{n} account(s)", { n: d.accounts.filter((a) => a.currency === c).length }))}</span></div>`).join("")}</div>`;
    }
    case "budgets": {
      const list = d.tags.filter((t) => t.limitMinor !== undefined && inc(t.id)).map((t) => {
        const p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
        return row([{ l: "Budget", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Spent", v: ofAmount(t.spentMinor, t.limitMinor, t.currency) }, { l: "Progress", v: `<div class="bar"><i class="${barCls(p)}" style="width:${Math.min(100, p)}%"></i></div>` }, { l: "Remaining", v: fmt(t.remainingMinor, t.currency), num: 1 }]);
      }).join("");
      return list ? table([{ t: N_("Budget") }, { t: N_("Spent") }, { t: N_("Progress") }, { t: N_("Remaining"), num: 1 }], list) : `<p class="muted">${esc(__("No budgets yet."))}</p>`;
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
// Dashboard editor: the dashboard itself is the editing surface (left); the pane on the right
// lists widgets that are not on it, or the settings of the selected one.
const GEAR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const ARROW = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const UP = ARROW("M12 19V5M6 11l6-6 6 6"), DOWN = ARROW("M12 5v14M6 13l6 6 6-6");
const visibleIds = (draft) => draft.order.filter((id) => !draft.hidden.includes(id));
function dashTile(id, draft) {
  const o = draft.widgets[id] || {}, name = o.title || widgetLabel(id), vis = visibleIds(draft), i = vis.indexOf(id);
  return `<section class="panel dw edit${o.size === "half" ? " half" : ""}${state.dashSel === id ? " sel" : ""}" data-tile="${esc(id)}">
    <div class="tilebar"><span class="grip" aria-hidden="true">⠿</span><button type="button" class="tname" data-tile-edit="${esc(id)}">${esc(name)}</button>
      <button type="button" class="iconbtn" data-tile-move="-1" aria-label="${esc(__("Move {widget} earlier", { widget: name }))}" ${i === 0 ? "disabled" : ""}>${UP}</button>
      <button type="button" class="iconbtn" data-tile-move="1" aria-label="${esc(__("Move {widget} later", { widget: name }))}" ${i === vis.length - 1 ? "disabled" : ""}>${DOWN}</button>
      <button type="button" class="iconbtn" data-tile-edit="${esc(id)}" aria-label="${esc(__("Settings for {widget}", { widget: name }))}" title="${esc(__("Settings"))}">${GEAR}</button>
      <button type="button" class="iconbtn" data-tile-remove aria-label="${esc(__("Remove {widget}", { widget: name }))}" title="${esc(__("Remove"))}">✕</button></div>
    <div class="tilebody" inert>${widgetBody(id, o)}</div></section>`;
}
function dashPaneHTML(draft) {
  const id = state.dashSel;
  if (!id) {
    const avail = draft.order.filter((x) => draft.hidden.includes(x));
    return `<h3>${esc(__("Widgets"))}</h3>
      ${avail.length ? `<ul class="palette">${avail.map((x) => `<li data-pal="${esc(x)}"><span class="grip" aria-hidden="true">⠿</span><span class="grow">${esc((draft.widgets[x] || {}).title || widgetLabel(x))}</span><button type="button" class="smallbtn" data-pal-add="${esc(x)}">${esc(__("Add"))}</button></li>`).join("")}</ul>`
        : `<p class="muted">${esc(__("All widgets are on the dashboard."))}</p>`}
      <div class="droptrash">${esc(__("Drop here to remove"))}</div>`;
  }
  const w = widgetDef(id), o = draft.widgets[id] || {}, label = widgetLabel(id);
  const items = w.pick ? pickItems(w.pick) : [];
  const shown = (x) => !(o.include && o.include.length) || o.include.includes(x);
  return `<button type="button" class="linkbtn" data-pane-back>${esc(__("‹ All widgets"))}</button>
    <h3>${esc(label)}</h3>
    <div class="paneform">
      <label>${esc(__("Title"))} <input type="text" data-dash-title value="${esc(o.title || "")}" placeholder="${esc(label)}" maxlength="60"></label>
      <label>${esc(__("Width"))} <select data-dash-size><option value="full">${esc(__("Full width"))}</option><option value="half" ${o.size === "half" ? "selected" : ""}>${esc(__("Half width"))}</option></select></label>
      ${w.rows ? `<label>${esc(__("Rows"))} <input type="number" data-dash-rows min="1" max="50" value="${o.rows || w.rows}"></label>` : ""}
      ${items.length ? `<fieldset><legend>${esc(__("Show"))}</legend>${items.map((it) => `<label><input type="checkbox" data-dash-inc value="${esc(it.id)}" ${shown(it.id) ? "checked" : ""}> ${esc(it.label)}</label>`).join("")}</fieldset>` : ""}
    </div>
    <button type="button" class="smallbtn danger" data-pane-remove>${esc(__("Remove from dashboard"))}</button>`;
}
function screenDashboardEditor(v) {
  const draft = state.dashDraft;
  v.innerHTML = `<div class="dashbar"><h3>${esc(__("Customize dashboard"))}</h3><span><button class="smallbtn" id="dashReset">${esc(__("Reset to default"))}</button> <button class="smallbtn" id="dashCancel">${esc(__("Cancel"))}</button> <button class="primarybtn" id="dashSave">${esc(__("Save"))}</button></span></div>
    <div class="dasheditor"><div class="dashgrid dashcanvas" id="dashCanvas"></div><aside class="panel dashpane" id="dashPane" aria-label="${esc(__("Widgets"))}"></aside></div>`;
  const canvas = $("#dashCanvas"), pane = $("#dashPane");
  const show = (id) => { draft.hidden = draft.hidden.filter((x) => x !== id); };
  const remove = (id) => { if (!draft.hidden.includes(id)) draft.hidden.push(id); if (state.dashSel === id) state.dashSel = null; draw(); };
  // place id before/after another widget (or at the end of the visible ones) in the full order
  const place = (id, target, after) => {
    const o = draft.order.filter((x) => x !== id), vis = o.filter((x) => !draft.hidden.includes(x) || x === target);
    let j = target ? o.indexOf(target) + (after ? 1 : 0) : (vis.length ? o.indexOf(vis[vis.length - 1]) + 1 : 0);
    o.splice(j, 0, id);
    draft.order = o;
  };
  const drawCanvas = () => {
    const vis = visibleIds(draft);
    canvas.innerHTML = vis.map((id) => dashTile(id, draft)).join("") || `<div class="empty dropend">${esc(__("Drag widgets here, or use Add."))}</div>`;
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
        const vis2 = visibleIds(draft), j = vis2.indexOf(id) + parseInt(b.dataset.tileMove, 10);
        if (j < 0 || j >= vis2.length) return;
        place(id, vis2[j], j > vis2.indexOf(id));
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
    on("[data-pal-add]", "click", (b) => { show(b.dataset.palAdd); place(b.dataset.palAdd, null); draw(); });
    // option changes redraw only the dashboard, so the field being edited keeps focus
    on("[data-dash-title]", "input", (t) => { setWidgetOpt(id, "title", t.value.trim()); drawCanvas(); });
    on("[data-dash-size]", "change", (s) => { setWidgetOpt(id, "size", s.value === "half" ? "half" : undefined); drawCanvas(); });
    on("[data-dash-rows]", "change", (r) => {
      const n = Math.min(50, Math.max(1, parseInt(r.value, 10) || widgetDef(id).rows));
      r.value = n;
      setWidgetOpt(id, "rows", n === widgetDef(id).rows ? undefined : n);
      drawCanvas();
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
    if (tile.dataset.tile === p.id) return {};
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
    else if (sp.tile || sp.end) { show(p.id); place(p.id, sp.tile ? sp.tile.dataset.tile : null, sp.after); draw(); }
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
    pd = { id: src.dataset.tile || src.dataset.pal, from: src.dataset.tile ? "canvas" : "palette", src, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, name: src.querySelector(".tname,.grow").textContent };
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
function goalAllocations(tagId) {
  const byAcc = {};
  state.data.transactions.forEach((t) => {
    if (t.tagId !== tagId || t.state !== "posted") return;
    if (t.type === "allocate") byAcc[t.accountId] = (byAcc[t.accountId] || 0) + t.amountMinor; // signed
  });
  return Object.entries(byAcc).filter(([, v]) => v > 0);
}
function goalCard(t) {
  const p = t.targetMinor > 0 ? t.savedMinor / t.targetMinor * 100 : 0;
  const allocs = goalAllocations(t.id);
  const total = allocs.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ["#5b2a86", "#8a5cb8", "#b79ad6", "#c9a86a", "#7d6f99"]; // money-box split per account, theme purples
  const stack = allocs.map(([, val], i) => `<i style="width:${val / total * 100}%;background:${colors[i % colors.length]}"></i>`).join("");
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
  const k = flow(t);
  if (k === "transfer") return accName(t.fromAccountId) + " → " + accName(t.toAccountId);
  if (k === "allocate") return t.amountMinor < 0 ? tagName(t.tagId) + " → " + accName(t.accountId) : accName(t.accountId) + " → " + tagName(t.tagId);
  return [txnTagNames(t).join(", "), transferAcct(t)].filter(Boolean).join(" · ");
}
// allocations are signed (ADR 0003): + into the money box, − back out
const amountText = (t) => t.type === "allocate" ? (t.amountMinor < 0 ? "−" : "+") + fmt(Math.abs(t.amountMinor), t.currency) : signed(t) + fmt(t.amountMinor, t.currency);
const iconKind = (t) => (t.type === "allocate" && t.amountMinor < 0 ? "release" : flow(t));
const amountCls = (t) => { const k = flow(t); return k === "income" ? "in" : k === "expense" ? "out" : "move"; };
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
  const sub = txnSubtitle(t) + (opts.withDate ? " · " + dayLabel(t.date) : "");
  return `<li><button type="button" class="feedrow" ${opts.edit ? "data-edit-txn" : "data-detail-txn"}="${esc(t.id)}">
      <span class="ficon t-${esc(flow(t))}" aria-hidden="true">${typeIcon(iconKind(t))}</span>
      <span class="fmain"><span class="ftitle">${esc(t.note || txnTagNames(t)[0] || lbl(TYPE_L, flow(t)))}${t.memo ? `<span class="fmemo" title="${esc(__("Has a note"))}"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr">${esc(__("Has a note"))}</span></span>` : ""}</span><span class="fsub"><span class="sr">${esc(lbl(TYPE_L, flow(t)))} · </span>${esc(sub)}</span></span>
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
  if (q) list = list.filter((t) => [t.note, t.memo, lbl(TYPE_L, flow(t)), txnSubtitle(t), fmt(t.amountMinor, t.currency)].join(" ").toLowerCase().includes(q));
  if (f.account) list = list.filter((t) => t.accountId === f.account || t.fromAccountId === f.account || t.toAccountId === f.account);
  if (f.type) list = list.filter((t) => flow(t) === f.type);
  return list;
}
function screenTransactions(v) {
  const f = state.filter;
  const accOpt = (a) => `<option value="${esc(a.id)}" ${f.account === a.id ? "selected" : ""}>${esc(accName(a.id))}</option>`;
  const accOpts = `<option value="">${esc(__("All accounts"))}</option>` + state.data.accounts.map(accOpt).join("")
    + (state.data.externals.length ? `<optgroup label="${esc(__("External accounts"))}">${state.data.externals.map(accOpt).join("")}</optgroup>` : "");
  v.innerHTML = `<div class="filters">
      <input id="fq" type="search" placeholder="${esc(__("Search note, tag, account…"))}" value="${esc(f.q)}">
      <select id="faccount">${accOpts}</select>
      <select id="ftype"><option value="">${esc(__("All types"))}</option>${enumOptions(TYPE_L, Object.keys(TYPE_L), f.type)}</select>
      <button class="smallbtn" id="clearF">${esc(__("Clear"))}</button></div>
    <div id="txnResults"></div>`;
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
    const list = all.filter((t) => t.state !== "planned" && t.date >= p.start && t.date <= p.end);
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
  const upd = () => { state.filter = { q: $("#fq").value, account: $("#faccount").value, type: $("#ftype").value }; drawResults(); };
  ["faccount", "ftype"].forEach((id) => $("#" + id).addEventListener("change", upd));
  $("#fq").addEventListener("input", upd);
  $("#clearF").addEventListener("click", () => { state.filter = { q: "", account: "", type: "" }; render(); });
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
    <p class="muted">${esc(__("Click an account name for its pane, where Edit lives. Balance is derived from posted transactions. Earmarked is money claimed by money boxes; Free is what is left. A credit card is an account that may go negative — owed is the negative balance, paying it is a transfer back."))}</p>
    <section class="panel"><div class="panelhead"><h3>${esc(__("External accounts"))}</h3><button class="smallbtn" id="newExternal">${esc(__("+ New external account"))}</button></div>
      <div class="extlist">${state.data.externals.map((a) => `<button class="chip extchip" data-detail-account="${esc(a.id)}">${esc(accName(a.id))}</button>`).join("")}</div>
      <p class="muted">${esc(__("Places outside your books, such as an employer or a shop. They have no balance: money moved to one is spending, money from one is income. Expenses and income use “External” unless you pick another."))}</p></section>`;
  $("#newAccount").addEventListener("click", () => openAccountDialog());
  $("#newExternal").addEventListener("click", () => openAccountDialog(null, "external"));
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
    <p class="muted">${esc(__("Allocating records a decision and never moves cash: the account balance stays the same and its free amount drops. A negative allocation takes money back out. Every allocation is listed in History."))}</p>`;
  $("#newBox").addEventListener("click", () => openTagDialog("goal"));
  bindActions(v);
}

const scheduleText = (s) => lbl(FREQ_L, s.frequency) + (s.dayOfMonth ? " · " + __("day {n}", { n: s.dayOfMonth }) : "");
function screenTemplates(v) {
  const rows = state.data.transactionTemplates.map((t) => row([
    { l: N_("Template"), v: `<button class="titlelink" data-detail-template="${esc(t.id)}">${esc(t.name)}</button>${t.template.expectedRangeMinor ? `<br><span class="chip due">${esc(__("variable {min}–{max}", { min: fmt(t.template.expectedRangeMinor.min, t.template.currency), max: fmt(t.template.expectedRangeMinor.max, t.template.currency) }))}</span>` : ""}` },
    { l: N_("Generates"), v: `${esc(lbl(TYPE_L, flow(t.template)))} ${fmt(t.template.amountMinor, t.template.currency)}<br><span class="muted">${esc(transferAcct(t.template))}${t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : ""}</span>` },
    { l: N_("Schedule"), v: `${esc(scheduleText(t.schedule))}<br><span class="muted">${esc(__("from {date}", { date: t.schedule.startDate }))}</span>` },
    { l: N_("Next due"), v: esc(t.nextDue || "—") },
    { l: N_("Status"), v: esc(t.enabled ? __("Enabled") : __("Paused")) },
  ])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>${esc(__("Transaction templates"))}</h3><span><button class="smallbtn" id="genBtn">${esc(__("Generate due"))}</button> <button class="smallbtn" id="newTpl">${esc(__("+ New template"))}</button></span></div>
    ${rows ? table([{ t: "Template" }, { t: "Generates" }, { t: "Schedule" }, { t: "Next due" }, { t: "Status" }], rows) : `<div class="empty">${esc(__("No templates yet."))}</div>`}
    <p class="muted">${esc(__("Click a template name for its pane (Edit, Pause, Generate). On its date a template generates one unconfirmed transaction — never twice. Open it and save (adjusting the amount for variable bills) to confirm it."))}</p></section>`;
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
        <label>${esc(__("Days open by default"))} <select id="setOpenDays">${[...new Set([...OPEN_DAY_CHOICES, openDays()])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === openDays() ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
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
  $("#setAddCur").addEventListener("change", (e) => { const c = e.target.value; if (c) saveGeneral({ currencies: [...favCurs(), c] }, () => __("{currency} added.", { currency: c })); });
  v.querySelectorAll("[data-cur-del]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.curDel;
    saveGeneral({ currencies: favCurs().filter((x) => x !== c) }, () => __("{currency} removed.", { currency: c }));
  }));
  $("#setCustomize").addEventListener("click", () => {
    state.dashDraft = dashLayout();
    state.dashSel = null;
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
const isDecision = (type) => type === "allocate";
// tagOptions lists the tags pick() accepts; money boxes (goal tags) are only for allocations.
function tagOptions(sel, pick, allowNone = true) {
  const tags = state.data.tags.filter(pick || (() => true));
  const opts = tags.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}${pick ? "" : ` (${esc(lbl(TAGKIND_L, t.kind))})`}</option>`).join("");
  if (allowNone) return `<option value="">${esc(__("— none —"))}</option>` + opts;
  return opts || `<option value="">${esc(__("No money boxes yet."))}</option>`;
}
const accOption = (a, sel) => `<option value="${esc(a.id)}" ${a.id === sel ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`;
function fillSelects() {
  $("#fAccount").innerHTML = state.data.accounts.map((a) => accOption(a)).join("");
  // the anonymous external account first, then named ones
  const ext = [...state.data.externals].sort((a, b) => (a.id === EXT_ID ? -1 : b.id === EXT_ID ? 1 : a.name.localeCompare(b.name)));
  $("#fExt").innerHTML = ext.map((a) => `<option value="${esc(a.id)}">${esc(accName(a.id))}</option>`).join("");
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
  // expense/income are transfers to/from an external account; only ask which one when there is a choice
  const flowMode = type === "expense" || type === "income";
  $("#fExtWrap").hidden = !flowMode || state.data.externals.length < 2;
  $("#fExtLab").textContent = type === "income" ? __("Received from") : __("Paid to");
  $("#fTagWrap").hidden = transfer;
  $("#fTagLab").textContent = decision ? __("Money box") : __("Tag");
  const keep = tagId !== undefined ? tagId : $("#fTag").value;
  $("#fTag").innerHTML = decision ? tagOptions(keep, isGoal, false) : tagOptions(keep, (t) => !isGoal(t));
  $("#fTag").required = decision;
  const amount = $("#txnForm").elements.amount;
  if (decision) amount.removeAttribute("min"); else amount.min = "0.01";
  $("#fAmtNote").hidden = !decision;
  refreshToAccounts($("#fToAccount").value);
}
function openDrawer(type, tagId) {
  state.editingTxn = null;
  fillSelects();
  $("#txnForm").reset();
  $("#txnForm").elements.date.value = new Date().toISOString().slice(0, 10);
  setTxnType(type || "expense", tagId);
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
  const linkedTag = t.tagId || (state.data.transactionTags.find((x) => x.transactionId === t.id) || {}).tagId || "";
  setTxnType(mode, linkedTag);
  if (mode === "transfer") refreshToAccounts(t.toAccountId);
  if (mode === "expense" || mode === "income") $("#fExt").value = extAcc(t);
  form.elements.amount.value = decimal(t.amountMinor, t.currency);
  form.elements.date.value = t.date;
  form.elements.note.value = t.note || "";
  form.elements.memo.value = t.memo || "";
  // an expected transaction is confirmed by saving it here
  const tpl = t.state === "planned" && state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  const range = tpl && tpl.template.expectedRangeMinor;
  $("#fPlannedNote").hidden = t.state !== "planned";
  $("#fPlannedNote").textContent = t.state !== "planned" ? "" : __("Expected on {date}, not confirmed yet. Check the amount and save to confirm it.", { date: dayLabel(t.date) })
    + (range ? " " + __("Expected range {min} – {max}.", { min: fmt(range.min, t.currency), max: fmt(range.max, t.currency) }) : "");
  $("#drawerTitle").textContent = t.state === "planned" ? __("Confirm expected transaction") : __("Edit transaction");
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
  if (type === "transfer" && !f.toAccountId) { msg($("#fToNone").textContent || __("Choose an account to transfer to."), "error"); return; }
  if (toMinor(f.amount, cur) === 0) { msg(__("Enter an amount other than zero."), "error"); return; }
  if (type === "allocate" && toMinor(f.amount, cur) < 0) { // the server refuses this too; say it with the amount first
    const held = state.data.transactions.filter((t) => t.id !== state.editingTxn && t.type === "allocate" && t.state === "posted" && t.accountId === f.accountId && t.tagId === f.tagId).reduce((n, t) => n + t.amountMinor, 0);
    if (held + toMinor(f.amount, cur) < 0) { msg(__("{box} holds {amount} in {account}; you can take out at most that.", { box: tagName(f.tagId), amount: fmt(Math.max(0, held), cur), account: accName(f.accountId) }), "error"); return; }
  }
  const body = { type, accountId: f.accountId, amountMinor: toMinor(f.amount, cur), currency: cur, date: f.date, note: f.note || "", memo: f.memo || "", state: "posted" }; // saving confirms an expected transaction
  if (type === "expense" || type === "income") { // stored as a transfer with an external side
    const ext = f.extAccountId || EXT_ID;
    Object.assign(body, { type: "transfer", accountId: "", fromAccountId: type === "expense" ? f.accountId : ext, toAccountId: type === "expense" ? ext : f.accountId });
    if (f.tagId) body.tagId = f.tagId;
  } else if (type === "transfer") { body.fromAccountId = f.accountId; body.toAccountId = f.toAccountId; body.accountId = ""; }
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
function openAccountDialog(editId, presetKind) {
  const a = editId ? accById(editId) : null, kind = a ? a.kind : presetKind || "bank";
  const ext = kind === "external";
  openDialog(a ? __("Edit account") : ext ? __("New external account") : __("New account"), dialogForm(
    field(N_("Name"), `<input name="name" required placeholder="${esc(ext ? __("Employer") : __("Savings A"))}" value="${a ? esc(accName(a.id)) : ""}">`) +
    // an account cannot switch between own and external once it has history; the anonymous external account never can
    field("Kind", `<select name="kind" ${a && (a.id === EXT_ID || state.data.transactions.some((t) => [t.accountId, t.fromAccountId, t.toAccountId].includes(a.id))) && ext ? "disabled" : ""}>${enumOptions(KIND_L, ext ? ["external"] : OWN_KINDS.concat(a ? [] : ["external"]), kind)}</select>`) +
    field("Currency", `<select name="currency" required>${currencyOptions(a && a.currency)}</select>`, "f-own") +
    field(N_("Opening balance"), `<input name="opening" type="number" step="0.01" value="${a && !ext ? decimal(a.openingBalanceMinor, a.currency) : "0"}">`, "f-own") +
    field(N_("Credit limit (cards only)"), `<input name="creditLimit" type="number" step="0.01" value="${a && a.creditLimitMinor ? decimal(a.creditLimitMinor, a.currency) : ""}">`, "f-own"),
    a ? __("Save changes") : __("Add account")));
  const form = $("#dialogForm");
  const sync = () => {
    const isExternal = form.elements.kind.value === "external";
    form.querySelectorAll(".f-own").forEach((el) => { el.hidden = isExternal; });
    form.elements.currency.required = !isExternal;
  };
  form.elements.kind.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = (f.currency || "").toUpperCase();
    f.kind = f.kind || kind; // a disabled select is not submitted
    const body = f.kind === "external" ? { name: f.name, kind: "external" }
      : { name: f.name, kind: f.kind, currency: cur, openingBalanceMinor: toMinor(f.opening, cur), allowNegative: f.kind === "credit_card" };
    if (a && f.kind !== "external") { body.statementCloseDay = a.statementCloseDay; body.paymentDueDay = a.paymentDueDay; }
    if (f.kind !== "external" && f.creditLimit) body.creditLimitMinor = toMinor(f.creditLimit, cur);
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
  const mode = tp ? flow(tp.template) : "expense", own = tp ? ownAcc(tp.template) : "";
  const acc = state.data.accounts.map((a) => accOption(a, own)).join("");
  const rng = tp && tp.template.expectedRangeMinor ? tp.template.expectedRangeMinor : null;
  openDialog(tp ? __("Edit transaction template") : __("New transaction template"), dialogForm(
    field("Name", `<input name="name" required placeholder="${esc(__("Streaming"))}" value="${tp ? esc(tp.name) : ""}">`) +
    field("Generates", `<select name="type">${enumOptions(TYPE_L, ["expense", "income", "allocate"], mode)}</select>`) +
    field("Account", `<select name="accountId">${acc}</select>`) +
    field("Money box", `<select name="tagId">${tagOptions(tp && tp.template.tagId, isGoal, false)}</select>`, "f-goal") +
    field("Amount", `<input name="amount" type="number" step="0.01" min="0.01" required value="${tp ? decimal(tp.template.amountMinor, tp.template.currency) : ""}">`) +
    field(N_("Frequency"), `<select name="frequency">${enumOptions(FREQ_L, ["monthly", "quarterly", "yearly", "weekly", "daily"], tp ? tp.schedule.frequency : "monthly")}</select>`) +
    field(N_("Expected min (variable bill, optional)"), `<input name="rangeMin" type="number" step="0.01" value="${rng ? decimal(rng.min, tp.template.currency) : ""}">`, "f-range") +
    field(N_("Expected max (variable bill, optional)"), `<input name="rangeMax" type="number" step="0.01" value="${rng ? decimal(rng.max, tp.template.currency) : ""}">`, "f-range") +
    field(N_("Day of month"), `<input name="dayOfMonth" type="number" min="1" max="31" value="${tp ? tp.schedule.dayOfMonth || 1 : 1}">`, "f-dom") +
    field(N_("Start date"), `<input name="startDate" type="date" required value="${tp ? esc(tp.schedule.startDate) : ""}">`) +
    field("Title", `<input name="note" maxlength="200" value="${tp ? esc(tp.template.note || "") : ""}">`, "wide"),
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
    if (f.type !== "allocate") { // generates a transfer with an external side; keep a named one when editing
      const ext = (tp && flow(tp.template) === f.type && namedExt(tp.template)) || EXT_ID;
      Object.assign(tpl, { type: "transfer", accountId: "", fromAccountId: f.type === "expense" ? f.accountId : ext, toAccountId: f.type === "expense" ? ext : f.accountId });
      if (tp && tp.template.tagId && flow(tp.template) !== "allocate") tpl.tagId = tp.template.tagId;
    }
    if (f.type !== "allocate" && f.rangeMin && f.rangeMax) tpl.expectedRangeMinor = { min: toMinor(f.rangeMin, cur), max: toMinor(f.rangeMax, cur) };
    const body = { name: f.name, enabled: tp ? tp.enabled : true, template: tpl, schedule: { frequency: f.frequency, interval: tp ? tp.schedule.interval || 1 : 1, dayOfMonth: parseInt(f.dayOfMonth, 10) || 1, startDate: f.startDate, endDate: tp ? tp.schedule.endDate || "" : "" } };
    try {
      if (tp) { await put("/api/templates/" + tp.id, body); msg(__("Template updated.")); } else { await post("/api/templates", body); msg(__("Template added.")); }
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
const fullDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); try { return new Intl.DateTimeFormat(LANG, { dateStyle: "full" }).format(new Date(y, m - 1, d)); } catch (e) { return iso; } };
// flowEnds: where the money came from and went to, as cards { name, role, open: [kind, id] }.
function flowEnds(t) {
  const acc = (id) => { const a = accById(id); return { name: accName(id), role: a ? lbl(KIND_L, a.kind) : "", open: ["account", id] }; };
  const box = (id) => ({ name: tagName(id), role: __("Money box"), open: ["tag", id] });
  const cats = state.data.tags.filter((x) => isCategoryOf(t, x));
  const catEnd = cats.length ? { name: cats.map((x) => x.name).join(", "), role: __("Category"), open: cats.length === 1 ? ["tag", cats[0].id] : null } : null;
  const named = namedExt(t);
  switch (flow(t)) {
    case "expense": return [acc(t.fromAccountId), named ? acc(named) : catEnd || { name: __("Uncategorised"), role: __("Spending") }];
    case "income": return [named ? acc(named) : catEnd || { name: __("Income"), role: __("From outside") }, acc(t.toAccountId)];
    case "transfer": return [acc(t.fromAccountId), acc(t.toAccountId)];
    case "allocate": return t.amountMinor < 0 ? [box(t.tagId), acc(t.accountId)] : [acc(t.accountId), box(t.tagId)];
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
  const inFlow = (x) => x.kind === "goal" || ((flow(t) === "expense" || flow(t) === "income") && !namedExt(t) && x.kind === "category");
  const extraTags = linkedTags(t).filter((x) => !inFlow(x));
  const facts = [
    ...(extraTags.length ? [[__("Tags"), extraTags.map((x) => `<button type="button" class="chip tagchip" data-open-tag="${esc(x.id)}">${esc(x.name)}</button>`).join(" ")]] : []),
    ...(t.transactionTemplateId ? [[__("Generated by"), tpl ? `<button type="button" class="titlelink" data-open-template="${esc(tpl.id)}">${esc(tpl.name)}</button>` : esc(t.transactionTemplateId)]] : []),
  ];
  openDialog(txnTitle(t), `
    ${t.state === "planned" ? `<div class="txbanner"><span>${esc(__("Expected, not confirmed yet. Edit and save it once the real charge or income arrives."))}</span></div>` : ""}
    <div class="txhero">
      <div class="sub"><span class="ficon t-${esc(flow(t))}" aria-hidden="true">${typeIcon(iconKind(t))}</span><span>${esc(lbl(TYPE_L, flow(t)))} · ${esc(fullDate(t.date))}</span></div>
      <div class="big ${amountCls(t)}">${esc(amountText(t))}</div>
    </div>
    <div class="flow">${node(from)}<span class="arrow" aria-label="${esc(__("to"))}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${node(to)}</div>
    ${t.memo ? `<div class="txmemo"><span>${esc(__("Note"))}</span><p>${esc(t.memo)}</p></div>` : ""}
    ${facts.length ? `<dl class="txfacts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
    <div class="txactions"><button type="button" class="smallbtn danger" id="paneDelete">${esc(__("Delete"))}</button><button type="button" class="smallbtn" id="paneEdit">${esc(__("Edit"))}</button></div>`);
  const body = $("#dialogBody");
  const go = (fn) => (b) => b.addEventListener("click", () => { $("#dialog").close(); fn(); });
  body.querySelectorAll("[data-open-account]").forEach((b) => go(() => openAccountDetail(b.dataset.openAccount))(b));
  body.querySelectorAll("[data-open-tag]").forEach((b) => go(() => openTagDetail(b.dataset.openTag))(b));
  body.querySelectorAll("[data-open-template]").forEach((b) => go(() => openTemplateDetail(b.dataset.openTemplate))(b));
  go(() => openEditTxn(id))($("#paneEdit"));
  $("#paneDelete").addEventListener("click", async () => { if (await deleteTxn(id)) $("#dialog").close(); });
}
function openAccountDetail(id) {
  const a = accById(id);
  if (!a) return;
  if (a.kind === "external") {
    const n = state.data.transactions.filter((t) => t.fromAccountId === id || t.toAccountId === id).length;
    openDialog(accName(id), detailTable([["Kind", esc(lbl(KIND_L, a.kind))], [N_("Transactions"), esc(__("{n} transaction(s)", { n }))]])
      + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">${esc(__("Edit account"))}</button></div>`);
    $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openAccountDialog(id); });
    return;
  }
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
  openDialog(t.name, detailTable(pairs) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">${esc(__("Edit tag"))}</button>${t.targetMinor !== undefined ? `<button class="smallbtn" id="paneAlloc">${esc(__("Allocate"))}</button><button class="smallbtn" id="paneHistory">${esc(__("History"))}</button>` : ""}</div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openTagDialog(null, id); });
  const alloc = $("#paneAlloc"), hist = $("#paneHistory");
  if (alloc) alloc.addEventListener("click", () => { $("#dialog").close(); openDrawer("allocate", id); });
  if (hist) hist.addEventListener("click", () => { $("#dialog").close(); showHistory(id); });
}
function openTemplateDetail(id) {
  const t = state.data.transactionTemplates.find((x) => x.id === id);
  if (!t) return;
  openDialog(t.name, detailTable([
    ["Status", esc(t.enabled ? __("Enabled") : __("Paused"))],
    ["Generates", esc(__("{type} {amount} on {account}", { type: lbl(TYPE_L, flow(t.template)), amount: fmt(t.template.amountMinor, t.template.currency), account: transferAcct(t.template) })) + (t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : "")],
    ...(t.template.expectedRangeMinor ? [[N_("Expected range (variable)"), fmt(t.template.expectedRangeMinor.min, t.template.currency) + " – " + fmt(t.template.expectedRangeMinor.max, t.template.currency)]] : []),
    ["Schedule", esc(scheduleText(t.schedule) + " · " + __("from {date}", { date: t.schedule.startDate }))],
    ["Next due", esc(t.nextDue || "—")], ["Title", esc(t.template.note || "—")],
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
    const pct = Math.round(t.spentMinor / t.limitMinor * 100), body = __("{spent} of {limit} spent this month", { spent: fmt(t.spentMinor, t.currency), limit: fmt(t.limitMinor, t.currency) });
    if (pct >= 100) out.push({ key: `budget-over:${t.id}:${month}`, rank: 1, level: "over", icon: noteIcon("warn"), title: __("{name} is over budget", { name: t.name }), body, open: () => openTagDetail(t.id) });
    else if (pct >= 80) out.push({ key: `budget-near:${t.id}:${month}`, rank: 3, level: "warn", icon: noteIcon("warn"), title: __("{name} has used {pct}% of its budget", { name: t.name, pct }), body, open: () => openTagDetail(t.id) });
  });
  d.accounts.filter((a) => a.creditLimitMinor && (a.utilisation || 0) >= 0.8).forEach((a) => out.push({
    key: `credit:${a.id}:${month}`, rank: 2, level: a.utilisation >= 1 ? "over" : "warn", icon: noteIcon("card"),
    title: __("{name} is at {pct}% of its credit limit", { name: a.name, pct: Math.round(a.utilisation * 100) }), body: owedText(a), open: () => openAccountDetail(a.id),
  }));
  d.tags.filter((t) => t.targetMinor > 0).forEach((t) => {
    const amounts = { saved: fmt(t.savedMinor, t.currency), target: fmt(t.targetMinor, t.currency) };
    if (t.savedMinor >= t.targetMinor) out.push({ key: `goal-reached:${t.id}:${t.targetMinor}`, rank: 5, level: "good", icon: noteIcon("check"), title: __("{name} reached its target", { name: t.name }), body: __("{saved} of {target} saved", amounts), open: () => openTagDetail(t.id) });
    else if (t.targetDate && t.targetDate < d.today) out.push({ key: `goal-late:${t.id}:${t.targetDate}`, rank: 4, level: "warn", icon: noteIcon("clock"), title: __("{name} passed its target date", { name: t.name }), body: __("{saved} of {target} saved; target date was {date}", { ...amounts, date: t.targetDate }), open: () => openTagDetail(t.id) });
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

/* ---------- routing ---------- */
const SCREENS = { dashboard: [N_("Dashboard"), screenDashboard], transactions: [N_("Transactions"), screenTransactions], accounts: ["Accounts", screenAccounts], budgets: [N_("Budgets"), screenBudgets], moneyboxes: ["Money boxes", screenMoneyboxes], templates: [N_("Templates"), screenTemplates], tags: [N_("Tags"), screenTags], settings: [N_("Settings"), screenSettings] };
function currentScreen() { const h = location.hash.replace("#", ""); return SCREENS[h] ? h : "dashboard"; }
function render() {
  const key = currentScreen();
  $("#pageTitle").textContent = __(SCREENS[key][0]);
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.screen === key));
  renderBell();
  $("#addBtn").hidden = key === "dashboard" && state.customizing; // it would cover widgets being edited
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
  render();
}
setLang(pickLang(""));
load().catch((e) => { msg(__("Failed to load: {message}", { message: e.message }), "error"); });
