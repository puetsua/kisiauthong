// SPDX-License-Identifier: AGPL-3.0-or-later
"use strict";
const $ = (s) => document.querySelector(s);
const state = { data: null, dashboard: null, customizing: false, dashDraft: null, txnType: "expense", editingTxn: null, filter: { q: "", account: "", type: "", state: "" } };
const EXP = { JPY: 0, KRW: 0 };
const expOf = (c) => (c in EXP ? EXP[c] : 2);
const toMinor = (a, c) => Math.round(parseFloat(a || 0) * Math.pow(10, expOf(c)));
function fmt(minor, currency) {
  const e = expOf(currency || "TWD"), v = (minor || 0) / Math.pow(10, e);
  return (currency || "") + " " + v.toLocaleString("en-US", { minimumFractionDigits: e, maximumFractionDigits: e });
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const msg = (t) => { $("#msg").textContent = t || ""; };
async function api(path, opts) {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const put = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const decimal = (minor, currency) => ((minor || 0) / Math.pow(10, expOf(currency || "TWD"))).toFixed(expOf(currency || "TWD"));
const accName = (id) => (state.data.accounts.find((a) => a.id === id) || {}).name || "—";
const accCur = (id) => (state.data.accounts.find((a) => a.id === id) || {}).currency || "TWD";
const tagName = (id) => (state.data.tags.find((t) => t.id === id) || {}).name || "—";
const signed = (t) => t.type === "income" ? "+" : (t.type === "expense" ? "−" : "");
const barCls = (p) => p >= 100 ? "over" : p >= 80 ? "warn" : "";
function table(headers, rows) {
  return `<div style="overflow-x:auto"><table><thead><tr>${headers.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function row(cells) {
  return "<tr>" + cells.map((c) => `<td data-label="${esc(c.l)}" class="${c.num ? "num" : ""}">${c.v}</td>`).join("") + "</tr>";
}

/* ---------- screens ---------- */
const DASH_WIDGETS = [
  { id: "balances", label: "Balances by currency" },
  { id: "budgets", label: "Budgets this month" },
  { id: "expected", label: "Expected to confirm" },
  { id: "moneyboxes", label: "Money boxes" },
  { id: "accounts", label: "Accounts" },
  { id: "recent", label: "Recent transactions" },
];
const DASH_DEFAULT = { order: DASH_WIDGETS.map((w) => w.id), hidden: [] };
function dashLayout() {
  const s = state.dashboard || DASH_DEFAULT;
  const order = (s.order || []).filter((id) => DASH_WIDGETS.some((w) => w.id === id));
  DASH_WIDGETS.forEach((w) => { if (!order.includes(w.id)) order.push(w.id); });
  return { order, hidden: (s.hidden || []).filter((id) => DASH_WIDGETS.some((w) => w.id === id)) };
}
function screenDashboard(v) {
  const d = state.data;
  const perCur = {};
  d.accounts.forEach((a) => { perCur[a.currency] = (perCur[a.currency] || 0) + a.balanceMinor; });
  const planned = d.transactions.filter((t) => t.state === "planned");
  const budgets = d.tags.filter((t) => t.limitMinor !== undefined).map((t) => {
    const p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
    return row([{ l: "Budget", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Spent", v: `${fmt(t.spentMinor, t.currency)} of ${fmt(t.limitMinor, t.currency)}` }, { l: "Progress", v: `<div class="bar"><i class="${barCls(p)}" style="width:${Math.min(100, p)}%"></i></div>` }, { l: "Remaining", v: fmt(t.remainingMinor, t.currency), num: 1 }]);
  }).join("");
  const goals = d.tags.filter((t) => t.targetMinor !== undefined);
  const upcoming = planned.slice(0, 6).map((t) => row([{ l: "Date", v: esc(t.date) }, { l: "Expected", v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(t.note || t.type)}</button> <span class="chip due">UNCONFIRMED</span>` }, { l: "Account", v: esc(accName(t.accountId)) }, { l: "Amount", v: fmt(t.amountMinor, t.currency), num: 1 }])).join("");
  const recent = [...d.transactions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 6).map((t) =>
    row([{ l: "Date", v: esc(t.date) }, { l: "Transaction", v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(t.note || t.type)}</button>` }, { l: "Account", v: esc(t.type === "transfer" ? accName(t.fromAccountId) + " → " + accName(t.toAccountId) : accName(t.accountId)) }, { l: "State", v: t.state === "planned" ? '<span class="chip due">UNCONFIRMED</span>' : "posted" }, { l: "Amount", v: signed(t) + fmt(t.amountMinor, t.currency), num: 1 }])).join("");
  const accRows = d.accounts.map((a) => row([{ l: "Account", v: `<button class="titlelink" data-detail-account="${esc(a.id)}">${esc(a.name)}</button> <span class="chip">${esc(a.kind.replace("_", " "))}</span>` }, { l: "Balance", v: fmt(a.balanceMinor, a.currency), num: 1 }, { l: "Earmarked", v: fmt(a.allocatedMinor, a.currency), num: 1 }, { l: "Free", v: fmt(a.unallocatedMinor, a.currency), num: 1 }])).join("");
  const widgets = {
    balances: `<div class="cards">${Object.entries(perCur).map(([c, val]) => `<div class="card"><span class="lab">Balance · ${esc(c)}</span><b>${fmt(val, c)}</b><span class="muted">${d.accounts.filter((a) => a.currency === c).length} account(s) · never mixed with other currencies</span></div>`).join("")}<div class="card"><span class="lab">Expected to confirm</span><b>${planned.length}</b><span class="muted">Generated by templates, not yet posted</span></div></div>`,
    budgets: `<section class="panel"><h3>Budgets this month</h3>${budgets ? table([{ t: "Budget" }, { t: "Spent" }, { t: "Progress" }, { t: "Remaining", num: 1 }], budgets) : '<p class="muted">No budgets yet.</p>'}</section>`,
    expected: `<section class="panel"><h3>Expected to confirm</h3>${upcoming ? table([{ t: "Date" }, { t: "Expected" }, { t: "Account" }, { t: "Amount", num: 1 }], upcoming) : '<p class="muted">Nothing waiting. Templates generate here when due.</p>'}</section>`,
    moneyboxes: goals.length ? `<section class="panel"><h3>Money boxes</h3>${goals.map(goalCard).join("")}</section>` : "",
    accounts: `<section class="panel"><h3>Accounts</h3>${table([{ t: "Account" }, { t: "Balance", num: 1 }, { t: "Earmarked", num: 1 }, { t: "Free", num: 1 }], accRows)}</section>`,
    recent: `<section class="panel"><h3>Recent transactions</h3>${table([{ t: "Date" }, { t: "Transaction" }, { t: "Account" }, { t: "State" }, { t: "Amount", num: 1 }], recent)}</section>`,
  };
  if (state.customizing) {
    const draft = state.dashDraft;
    v.innerHTML = `<section class="panel"><div class="panelhead"><h3>Customize dashboard</h3><span><button class="smallbtn" id="dashReset">Reset to default</button> <button class="smallbtn" id="dashCancel">Cancel</button> <button class="smallbtn" id="dashSave">Save</button></span></div>
      <p class="muted">Tick to show a widget, use ↑ ↓ to reorder. Saved on the server, so it follows you across browsers.</p>
      ${draft.order.map((id, i) => {
        const w = DASH_WIDGETS.find((x) => x.id === id);
        return `<div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)"><label style="flex:1"><input type="checkbox" data-dash-vis="${esc(id)}" ${draft.hidden.includes(id) ? "" : "checked"}> ${esc(w.label)}</label><button class="smallbtn" data-dash-up="${esc(id)}" ${i === 0 ? "disabled" : ""}>↑</button><button class="smallbtn" data-dash-down="${esc(id)}" ${i === draft.order.length - 1 ? "disabled" : ""}>↓</button></div>`;
      }).join("")}</section>`;
    v.querySelectorAll("[data-dash-vis]").forEach((c) => c.addEventListener("change", () => {
      const id = c.dataset.dashVis;
      state.dashDraft.hidden = c.checked ? state.dashDraft.hidden.filter((x) => x !== id) : [...state.dashDraft.hidden, id];
    }));
    const move = (id, dir) => {
      const o = state.dashDraft.order, i = o.indexOf(id), j = i + dir;
      if (j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]];
      render();
    };
    v.querySelectorAll("[data-dash-up]").forEach((b) => b.addEventListener("click", () => move(b.dataset.dashUp, -1)));
    v.querySelectorAll("[data-dash-down]").forEach((b) => b.addEventListener("click", () => move(b.dataset.dashDown, 1)));
    $("#dashCancel").addEventListener("click", () => { state.customizing = false; render(); });
    $("#dashReset").addEventListener("click", () => { state.dashDraft = JSON.parse(JSON.stringify(DASH_DEFAULT)); render(); });
    $("#dashSave").addEventListener("click", async () => {
      try {
        const saved = await put("/api/settings", { dashboard: state.dashDraft });
        state.dashboard = saved.dashboard;
        state.customizing = false;
        msg("Dashboard saved.");
        render();
      } catch (e) { msg("Error: " + e.message); }
    });
    return;
  }
  const layout = dashLayout();
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  v.innerHTML = `<div class="panelhead" style="margin-bottom:14px"><span class="muted">Your dashboard, your order.</span><button class="smallbtn" id="dashCustomize">Customize dashboard</button></div>`
    + (visible.length ? visible.map((id) => widgets[id] || "").join("") : '<div class="empty">All widgets are hidden. Customize the dashboard to bring some back.</div>');
  $("#dashCustomize").addEventListener("click", () => {
    state.dashDraft = JSON.parse(JSON.stringify(dashLayout()));
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
  return `<div style="margin-bottom:18px"><div class="panelhead"><button class="titlelink" data-detail-goal="${esc(t.id)}">${esc(t.name)}</button><span>${fmt(t.savedMinor, t.currency)} of ${fmt(t.targetMinor, t.currency)} · ${p.toFixed(0)}%${t.targetDate ? " · by " + esc(t.targetDate) : ""}</span></div>
    <div class="stack" style="margin:8px 0">${stack}</div><span class="muted">${where || "No allocations yet"}</span></div>`;
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
function detailTable(pairs) {
  return `<table><tbody>${pairs.map(([k, v]) => `<tr><td data-label="">${esc(k)}</td><td data-label="">${v}</td></tr>`).join("")}</tbody></table>`;
}

function txnRows(list) {
  const tagOf = {};
  state.data.transactionTags.forEach((tt) => { (tagOf[tt.transactionId] = tagOf[tt.transactionId] || []).push(tagName(tt.tagId)); });
  return list.map((t) => {
    const tags = [...new Set([t.tagId ? tagName(t.tagId) : "", ...(tagOf[t.id] || [])].filter(Boolean))].join(", ");
    const acct = t.type === "transfer" ? accName(t.fromAccountId) + " → " + accName(t.toAccountId) : accName(t.accountId);
    return `<tr class="${t.state === "planned" ? "planned unconfirmed" : ""}">` + [
      { l: "Date", v: esc(t.date) }, { l: "Transaction", v: `<button class="titlelink" data-detail-txn="${esc(t.id)}">${esc(t.note || t.type)}</button><br><span class="muted">${esc(t.type)}${tags ? " · " + esc(tags) : ""}</span>` },
      { l: "Account", v: esc(acct) }, { l: "State", v: t.state === "planned" ? '<span class="chip due">UNCONFIRMED</span>' : "posted" },
      { l: "Amount", v: signed(t) + fmt(t.amountMinor, t.currency), num: 1 },
    ].map((c) => `<td data-label="${esc(c.l)}" class="${c.num ? "num" : ""}">${c.v}</td>`).join("") + "</tr>";
  }).join("");
}
function bindTxnActions(root) {
  bindConfirm(root);
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditTxn(b.dataset.edit)));
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    try { await api("/api/transactions/" + b.dataset.del, { method: "DELETE" }); msg("Deleted."); await load(); }
    catch (e) { msg("Error: " + e.message); }
  }));
}
function filteredTxns() {
  const f = state.filter;
  let list = [...state.data.transactions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (f.q) list = list.filter((t) => (t.note + t.type + accName(t.accountId)).toLowerCase().includes(f.q.toLowerCase()));
  if (f.account) list = list.filter((t) => t.accountId === f.account || t.fromAccountId === f.account || t.toAccountId === f.account);
  if (f.type) list = list.filter((t) => t.type === f.type);
  if (f.state) list = list.filter((t) => t.state === f.state);
  return list;
}
function screenTransactions(v) {
  const f = state.filter;
  const accOpts = `<option value="">All accounts</option>` + state.data.accounts.map((a) => `<option value="${esc(a.id)}" ${f.account === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  v.innerHTML = `<div class="filters">
      <input id="fq" type="search" placeholder="Search note, type, account…" value="${esc(f.q)}">
      <select id="faccount">${accOpts}</select>
      <select id="ftype"><option value="">All types</option>${["expense", "income", "transfer", "allocate", "release"].map((t) => `<option ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select id="fstate"><option value="">Posted + expected</option><option value="posted" ${f.state === "posted" ? "selected" : ""}>Posted only</option><option value="planned" ${f.state === "planned" ? "selected" : ""}>Expected only</option></select>
      <button class="smallbtn" id="clearF">Clear</button></div>
    <div id="txnResults"></div>`;
  const drawResults = () => {
    const list = filteredTxns();
    $("#txnResults").innerHTML = list.length ? table([{ t: "Date" }, { t: "Transaction" }, { t: "Account" }, { t: "State" }, { t: "Amount", num: 1 }], txnRows(list.slice(0, 120))) : '<div class="empty">No transactions match. Add your first with “+ Add transaction”.</div>';
    bindTxnActions($("#txnResults"));
  };
  const upd = () => { state.filter = { q: $("#fq").value, account: $("#faccount").value, type: $("#ftype").value, state: $("#fstate").value }; drawResults(); };
  ["faccount", "ftype", "fstate"].forEach((id) => $("#" + id).addEventListener("change", upd));
  $("#fq").addEventListener("input", upd);
  $("#clearF").addEventListener("click", () => { state.filter = { q: "", account: "", type: "", state: "" }; render(); });
  drawResults();
}

function screenAccounts(v) {
  const rows = state.data.accounts.map((a) => {
    const card = a.creditLimitMinor ? `${fmt(a.owedMinor, a.currency)} owed of ${fmt(a.creditLimitMinor, a.currency)} (${Math.round((a.utilisation || 0) * 100)}%)<div class="bar"><i class="${barCls((a.utilisation || 0) * 100)}" style="width:${Math.min(100, (a.utilisation || 0) * 100)}%"></i></div>` : "—";
    return row([{ l: "Account", v: `<button class="titlelink" data-detail-account="${esc(a.id)}">${esc(a.name)}</button>` }, { l: "Kind", v: esc(a.kind.replace("_", " ")) }, { l: "Currency", v: esc(a.currency) }, { l: "Balance", v: fmt(a.balanceMinor, a.currency), num: 1 }, { l: "Earmarked", v: fmt(a.allocatedMinor, a.currency), num: 1 }, { l: "Free", v: fmt(a.unallocatedMinor, a.currency), num: 1 }, { l: "Credit card", v: card }]);
  }).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>All accounts</h3><button class="smallbtn" id="newAccount">+ New account</button></div>
    ${table([{ t: "Account" }, { t: "Kind" }, { t: "Currency" }, { t: "Balance", num: 1 }, { t: "Earmarked", num: 1 }, { t: "Free", num: 1 }, { t: "Credit card" }], rows)}</section>
    <p class="muted">Click an account name for its pane, where Edit lives. Balance is derived from posted transactions. Earmarked is money claimed by money boxes; Free is what is left. A credit card is an account that may go negative — owed is the negative balance, paying it is a transfer back.</p>`;
  $("#newAccount").addEventListener("click", () => openAccountDialog());
  bindDetails(v);
}

function screenBudgets(v) {
  const cats = state.data.tags.filter((t) => t.limitMinor !== undefined);
  const rows = cats.map((t) => {
    const p = t.limitMinor > 0 ? t.spentMinor / t.limitMinor * 100 : 0;
    const daysLeft = 30 - new Date().getDate() + 1;
    return row([{ l: "Budget", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Spent", v: `${fmt(t.spentMinor, t.currency)} of ${fmt(t.limitMinor, t.currency)}` }, { l: "Progress", v: `<div class="bar"><i class="${barCls(p)}" style="width:${Math.min(100, p)}%"></i></div>${p.toFixed(0)}%` }, { l: "Remaining", v: fmt(t.remainingMinor, t.currency), num: 1 }, { l: "Per day left", v: fmt(Math.max(0, Math.floor(t.remainingMinor / daysLeft)), t.currency), num: 1 }]);
  }).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>Monthly budgets (this month)</h3><button class="smallbtn" id="newBudget">+ New budget tag</button></div>
    ${cats.length ? table([{ t: "Budget" }, { t: "Spent" }, { t: "Progress" }, { t: "Remaining", num: 1 }, { t: "Per day left", num: 1 }], rows) : '<div class="empty">No budgets yet. A budget is a category tag with a monthly limit.</div>'}</section>`;
  $("#newBudget").addEventListener("click", () => openTagDialog("category"));
  bindDetails(v);
}

function screenMoneyboxes(v) {
  const goals = state.data.tags.filter((t) => t.targetMinor !== undefined);
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>Money boxes</h3><button class="smallbtn" id="newBox">+ New money box</button></div>
    ${goals.length ? goals.map(goalCard).join("") : '<div class="empty">No money boxes yet. Create a goal tag, then allocate money to it from any account.</div>'}</section>
    <p class="muted">Allocating records a decision and never moves cash; the account balance stays the same and its free amount drops. Release does the opposite. Both are listed in History.</p>`;
  $("#newBox").addEventListener("click", () => openTagDialog("goal"));
  bindConfirm(v);
}

function screenTemplates(v) {
  const rows = state.data.transactionTemplates.map((t) => row([
    { l: "Template", v: `<button class="titlelink" data-detail-template="${esc(t.id)}">${esc(t.name)}</button>${t.template.expectedRangeMinor ? `<br><span class="chip due">variable ${fmt(t.template.expectedRangeMinor.min, t.template.currency)}–${fmt(t.template.expectedRangeMinor.max, t.template.currency)}</span>` : ""}` },
    { l: "Generates", v: `${esc(t.template.type)} ${fmt(t.template.amountMinor, t.template.currency)}<br><span class="muted">${esc(accName(t.template.accountId))}${t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : ""}</span>` },
    { l: "Schedule", v: `${esc(t.schedule.frequency)}${t.schedule.dayOfMonth ? " on day " + t.schedule.dayOfMonth : ""}<br><span class="muted">from ${esc(t.schedule.startDate)}</span>` },
    { l: "Next due", v: esc(t.nextDue || "—") },
    { l: "Status", v: t.enabled ? "enabled" : "paused" },
  ])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>Transaction templates</h3><span><button class="smallbtn" id="genBtn">Generate due</button> <button class="smallbtn" id="newTpl">+ New template</button></span></div>
    ${rows ? table([{ t: "Template" }, { t: "Generates" }, { t: "Schedule" }, { t: "Next due" }, { t: "Status" }], rows) : '<div class="empty">No templates yet.</div>'}
    <p class="muted">Click a template name for its pane (Edit, Pause, Generate). On its date a template generates one unconfirmed transaction — never twice. Confirm it (editing the amount for variable bills) to post it.</p></section>`;
  $("#newTpl").addEventListener("click", () => openTemplateDialog());
  $("#genBtn").addEventListener("click", generateDue);
  bindDetails(v);
}

function screenTags(v) {
  const rows = state.data.tags.map((t) => row([
    { l: "Tag", v: `<button class="titlelink" data-detail-tag="${esc(t.id)}">${esc(t.name)}</button>` }, { l: "Kind", v: esc(t.kind) },
    { l: "Budget / target", v: t.limitMinor !== undefined ? fmt(t.limitMinor, t.currency) + " / month" : t.targetMinor !== undefined ? fmt(t.targetMinor, t.currency) + (t.targetDate ? " by " + esc(t.targetDate) : "") : "—" },
    { l: "Currency", v: esc(t.currency || "—") },
  ])).join("");
  v.innerHTML = `<section class="panel"><div class="panelhead"><h3>All tags</h3><button class="smallbtn" id="newTag">+ New tag</button></div>
    ${table([{ t: "Tag" }, { t: "Kind" }, { t: "Budget / target" }, { t: "Currency" }], rows)}
    <p class="muted">Click a tag name for its pane, where Edit lives. Categories, budgets and money boxes are all tags: a category tag with a limit is a budget, a goal tag is a money box.</p></section>`;
  $("#newTag").addEventListener("click", () => openTagDialog("label"));
  bindDetails(v);
}

/* ---------- drawer, dialogs, actions ---------- */
function fillSelects() {
  const acc = state.data.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.currency)})</option>`).join("");
  $("#fAccount").innerHTML = acc; $("#fToAccount").innerHTML = acc;
  $("#fTag").innerHTML = `<option value="">— none —</option>` + state.data.tags.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.kind)})</option>`).join("");
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
  $("#drawerTitle").textContent = (type === "allocate" || type === "release") ? (type === "allocate" ? "Allocate to money box" : "Release from money box") : "Add transaction";
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
  $("#drawerTitle").textContent = "Edit transaction";
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
    if (state.editingTxn) { await put("/api/transactions/" + state.editingTxn, body); msg("Transaction updated."); }
    else { await post("/api/transactions", body); msg("Saved."); }
    state.editingTxn = null; closeDrawer(); await load();
  } catch (err) { msg("Error: " + err.message); }
});

function openDialog(title, html) {
  $("#dialogTitle").textContent = title;
  $("#dialogBody").innerHTML = html;
  $("#dialog").showModal();
}
function dialogForm(fields, submitLabel) {
  return `<form id="dialogForm">${fields}<button class="primarybtn big" type="submit">${submitLabel}</button></form>`;
}
function openAccountDialog(editId) {
  const a = editId ? state.data.accounts.find((x) => x.id === editId) : null;
  openDialog(a ? "Edit account" : "New account", dialogForm(`
    <label>Name <input name="name" required placeholder="Savings A" value="${a ? esc(a.name) : ""}"></label>
    <label>Kind <select name="kind">${["bank", "savings", "cash", "credit_card", "ewallet", "investment", "loan"].map((k) => `<option ${a && a.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    <label>Currency <input name="currency" value="${a ? esc(a.currency) : "TWD"}" maxlength="3" required></label>
    <label>Opening balance <input name="opening" type="number" step="0.01" value="${a ? decimal(a.openingBalanceMinor, a.currency) : "0"}"></label>
    <label>Credit limit (cards only) <input name="creditLimit" type="number" step="0.01" value="${a && a.creditLimitMinor ? decimal(a.creditLimitMinor, a.currency) : ""}"></label>`, a ? "Save changes" : "Add account"));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = f.currency.toUpperCase();
    const body = { name: f.name, kind: f.kind, currency: cur, openingBalanceMinor: toMinor(f.opening, cur), allowNegative: f.kind === "credit_card" };
    if (a) { body.statementCloseDay = a.statementCloseDay; body.paymentDueDay = a.paymentDueDay; }
    if (f.creditLimit) body.creditLimitMinor = toMinor(f.creditLimit, cur);
    try {
      if (a) { await put("/api/accounts/" + a.id, body); msg("Account updated."); } else { await post("/api/accounts", body); msg("Account added."); }
      $("#dialog").close(); await load();
    } catch (err) { msg("Error: " + err.message); }
  });
}
function openTagDialog(kind, editId) {
  const t = editId ? state.data.tags.find((x) => x.id === editId) : null;
  const k = t ? t.kind : kind;
  openDialog(t ? "Edit tag" : k === "goal" ? "New money box (goal tag)" : k === "category" ? "New budget (category tag)" : "New tag", dialogForm(`
    <label>Name <input name="name" required placeholder="${k === "goal" ? "House fund" : "Food"}" value="${t ? esc(t.name) : ""}"></label>
    <label>Kind <select name="kind">${["category", "goal", "label", "payee"].map((x) => `<option ${k === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label>Monthly limit (category, optional) <input name="limit" type="number" step="0.01" value="${t && t.limitMinor !== undefined ? decimal(t.limitMinor, t.currency || "TWD") : ""}"></label>
    <label>Target (goal, optional) <input name="target" type="number" step="0.01" value="${t && t.targetMinor !== undefined ? decimal(t.targetMinor, t.currency || "TWD") : ""}"></label>
    <label>Target date (goal) <input name="targetDate" type="date" value="${t ? esc(t.targetDate || "") : ""}"></label>
    <label>Currency <input name="currency" value="${t ? esc(t.currency || "TWD") : "TWD"}" maxlength="3"></label>`, t ? "Save changes" : "Add tag"));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = (f.currency || "TWD").toUpperCase();
    const body = { name: f.name, kind: f.kind, currency: cur };
    if (f.limit) { body.limitMinor = toMinor(f.limit, cur); body.cycle = "monthly"; }
    if (f.target) body.targetMinor = toMinor(f.target, cur);
    if (f.targetDate) body.targetDate = f.targetDate;
    try {
      if (t) { await put("/api/tags/" + t.id, body); msg("Tag updated."); } else { await post("/api/tags", body); msg("Tag added."); }
      $("#dialog").close(); await load();
    } catch (err) { msg("Error: " + err.message); }
  });
}
function openTemplateDialog(editId) {
  const tp = editId ? state.data.transactionTemplates.find((x) => x.id === editId) : null;
  const acc = state.data.accounts.map((a) => `<option value="${esc(a.id)}" ${tp && tp.template.accountId === a.id ? "selected" : ""}>${esc(a.name)} (${esc(a.currency)})</option>`).join("");
  const tags = `<option value="">— none —</option>` + state.data.tags.map((t) => `<option value="${esc(t.id)}" ${tp && tp.template.tagId === t.id ? "selected" : ""}>${esc(t.name)} (${esc(t.kind)})</option>`).join("");
  const rng = tp && tp.template.expectedRangeMinor ? tp.template.expectedRangeMinor : null;
  openDialog(tp ? "Edit transaction template" : "New transaction template", dialogForm(`
    <label>Name <input name="name" required placeholder="Streaming" value="${tp ? esc(tp.name) : ""}"></label>
    <label>Generates <select name="type">${["expense", "income", "allocate"].map((x) => `<option ${tp && tp.template.type === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label>Account <select name="accountId">${acc}</select></label>
    <label>Goal tag (allocate only) <select name="tagId">${tags}</select></label>
    <label>Amount <input name="amount" type="number" step="0.01" min="0.01" required value="${tp ? decimal(tp.template.amountMinor, tp.template.currency) : ""}"></label>
    <label>Expected min (variable bill, optional) <input name="rangeMin" type="number" step="0.01" value="${rng ? decimal(rng.min, tp.template.currency) : ""}"></label>
    <label>Expected max (variable bill, optional) <input name="rangeMax" type="number" step="0.01" value="${rng ? decimal(rng.max, tp.template.currency) : ""}"></label>
    <label>Frequency <select name="frequency">${["monthly", "quarterly", "yearly", "weekly", "daily"].map((x) => `<option ${tp && tp.schedule.frequency === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    <label>Day of month <input name="dayOfMonth" type="number" min="1" max="31" value="${tp ? tp.schedule.dayOfMonth || 1 : 1}"></label>
    <label>Start date <input name="startDate" type="date" required value="${tp ? esc(tp.schedule.startDate) : ""}"></label>
    <label>Note <input name="note" value="${tp ? esc(tp.template.note || "") : ""}"></label>`, tp ? "Save changes" : "Add template"));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries()), cur = accCur(f.accountId);
    const tpl = { accountId: f.accountId, type: f.type, amountMinor: toMinor(f.amount, cur), currency: cur, note: f.note || "" };
    if (f.tagId) tpl.tagId = f.tagId;
    if (f.rangeMin && f.rangeMax) tpl.expectedRangeMinor = { min: toMinor(f.rangeMin, cur), max: toMinor(f.rangeMax, cur) };
    const body = { name: f.name, enabled: tp ? tp.enabled : true, template: tpl, schedule: { frequency: f.frequency, interval: tp ? tp.schedule.interval || 1 : 1, dayOfMonth: parseInt(f.dayOfMonth, 10) || 1, startDate: f.startDate, endDate: tp ? tp.schedule.endDate || "" : "" } };
    try {
      if (tp) { await put("/api/templates/" + tp.id, body); msg("Template updated."); } else { await post("/api/templates", body); msg("Template added."); }
      $("#dialog").close(); await load();
    } catch (err) { msg("Error: " + err.message); }
  });
}
function openConfirm(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const tpl = state.data.transactionTemplates.find((x) => x.id === t.transactionTemplateId);
  const range = tpl && tpl.template.expectedRangeMinor ? `<p class="muted">Expected range ${fmt(tpl.template.expectedRangeMinor.min, t.currency)} – ${fmt(tpl.template.expectedRangeMinor.max, t.currency)}. Edit the amount to the actual charge if it differs.</p>` : "";
  openDialog("Confirm expected transaction", `${range}<p><strong>${esc(t.note || t.type)}</strong> · ${esc(accName(t.accountId))} · ${esc(t.date)}</p>` + dialogForm(`
    <label>Actual amount <input name="amount" type="number" step="0.01" min="0.01" required value="${(t.amountMinor / Math.pow(10, expOf(t.currency))).toFixed(expOf(t.currency))}"></label>`, "Confirm and post"));
  $("#dialogForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try { await post("/api/transactions/" + id + "/post", { amountMinor: toMinor(f.amount, t.currency) }); $("#dialog").close(); msg("Posted."); await load(); }
    catch (err) { msg("Error: " + err.message); }
  });
}
function showHistory(tagId) {
  const list = state.data.transactions.filter((t) => t.tagId === tagId && (t.type === "allocate" || t.type === "release"))
    .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id));
  openDialog("History — " + tagName(tagId), list.length
    ? table([{ t: "Date" }, { t: "Decision" }, { t: "Account" }, { t: "Amount", num: 1 }], list.map((t) => row([{ l: "Date", v: esc(t.date) }, { l: "Decision", v: `${esc(t.type)} — ${esc(t.note)}` }, { l: "Account", v: esc(accName(t.accountId)) }, { l: "Amount", v: fmt(t.amountMinor, t.currency), num: 1 }])).join(""))
    : '<p class="muted">No allocate or release decisions yet.</p>');
}
function openTxnDetail(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return;
  const tagOf = state.data.transactionTags.filter((x) => x.transactionId === id).map((x) => tagName(x.tagId));
  const tags = [...new Set([t.tagId ? tagName(t.tagId) : "", ...tagOf].filter(Boolean))].join(", ") || "—";
  const acct = t.type === "transfer" ? accName(t.fromAccountId) + " → " + accName(t.toAccountId) : accName(t.accountId);
  openDialog(t.note || t.type, detailTable([
    ["Status", t.state === "planned" ? '<span class="chip due">UNCONFIRMED — expected</span>' : "Confirmed (posted)"],
    ["Type", esc(t.type)], ["Date", esc(t.date)], ["Account", esc(acct)], ["Tag", esc(tags)],
    ["Amount", fmt(t.amountMinor, t.currency)],
    ...(t.transactionTemplateId ? [["Generated by", esc(tagName(t.transactionTemplateId) ? "" : "") + esc(t.transactionTemplateId)]] : []),
  ]) + `<div class="pane-actions">${t.state === "planned" ? `<button class="smallbtn" id="paneConfirm">Confirm…</button>` : ""}<button class="smallbtn" id="paneEdit">Edit</button><button class="smallbtn danger" id="paneDelete">Delete</button></div>`);
  const confirmBtn = $("#paneConfirm");
  if (confirmBtn) confirmBtn.addEventListener("click", () => { $("#dialog").close(); openConfirm(id); });
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openEditTxn(id); });
  $("#paneDelete").addEventListener("click", async () => {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    try { await api("/api/transactions/" + id, { method: "DELETE" }); $("#dialog").close(); msg("Deleted."); await load(); }
    catch (e) { msg("Error: " + e.message); }
  });
}
function openAccountDetail(id) {
  const a = state.data.accounts.find((x) => x.id === id);
  if (!a) return;
  openDialog(a.name, detailTable([
    ["Kind", esc(a.kind.replace("_", " "))], ["Currency", esc(a.currency)],
    ["Balance", fmt(a.balanceMinor, a.currency)], ["Earmarked in money boxes", fmt(a.allocatedMinor, a.currency)], ["Free", fmt(a.unallocatedMinor, a.currency)],
    ...(a.creditLimitMinor ? [["Credit card owed", fmt(a.owedMinor, a.currency) + " of " + fmt(a.creditLimitMinor, a.currency) + " (" + Math.round((a.utilisation || 0) * 100) + "%)"]] : []),
  ]) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">Edit account</button></div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openAccountDialog(id); });
}
function openTagDetail(id) {
  const t = state.data.tags.find((x) => x.id === id);
  if (!t) return;
  const pairs = [["Kind", esc(t.kind)], ["Currency", esc(t.currency || "—")]];
  if (t.limitMinor !== undefined) pairs.push(["Monthly budget", fmt(t.limitMinor, t.currency)], ["Spent this month", fmt(t.spentMinor, t.currency)], ["Remaining", fmt(t.remainingMinor, t.currency)]);
  if (t.targetMinor !== undefined) pairs.push(["Money-box target", fmt(t.targetMinor, t.currency)], ["Saved", fmt(t.savedMinor, t.currency)], ["Target date", esc(t.targetDate || "—")]);
  openDialog(t.name, detailTable(pairs) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">Edit tag</button>${t.targetMinor !== undefined ? `<button class="smallbtn" id="paneAlloc">Allocate</button><button class="smallbtn" id="paneRelease">Release</button><button class="smallbtn" id="paneHistory">History</button>` : ""}</div>`);
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
    ["Status", t.enabled ? "Enabled" : "Paused"],
    ["Generates", `${esc(t.template.type)} ${fmt(t.template.amountMinor, t.template.currency)} on ${esc(accName(t.template.accountId))}${t.template.tagId ? " → " + esc(tagName(t.template.tagId)) : ""}`],
    ...(t.template.expectedRangeMinor ? [["Expected range (variable)", fmt(t.template.expectedRangeMinor.min, t.template.currency) + " – " + fmt(t.template.expectedRangeMinor.max, t.template.currency)]] : []),
    ["Schedule", `${esc(t.schedule.frequency)}${t.schedule.dayOfMonth ? " on day " + t.schedule.dayOfMonth : ""}, from ${esc(t.schedule.startDate)}`],
    ["Next due", esc(t.nextDue || "—")], ["Note", esc(t.template.note || "—")],
  ]) + `<div class="pane-actions"><button class="smallbtn" id="paneEdit">Edit template</button><button class="smallbtn" id="paneToggle">${t.enabled ? "Pause" : "Resume"}</button><button class="smallbtn" id="paneGenerate">Generate due</button></div>`);
  $("#paneEdit").addEventListener("click", () => { $("#dialog").close(); openTemplateDialog(id); });
  $("#paneToggle").addEventListener("click", async () => {
    try { await post("/api/templates/" + id + "/toggle"); $("#dialog").close(); msg("Template updated."); await load(); } catch (e) { msg("Error: " + e.message); }
  });
  $("#paneGenerate").addEventListener("click", async () => { $("#dialog").close(); await generateDue(); });
}
function openMoneyboxDetail(id) {
  openTagDetail(id);
}
async function generateDue() {
  try { const r = await post("/api/generate", {}); msg("Generated " + r.created + " due transaction(s)."); await load(); }
  catch (e) { msg("Error: " + e.message); }
}
$("#dueBtn").addEventListener("click", () => { location.hash = "#transactions"; state.filter.state = "planned"; render(); });

/* ---------- routing ---------- */
const SCREENS = { dashboard: ["Dashboard", screenDashboard], transactions: ["Transactions", screenTransactions], accounts: ["Accounts", screenAccounts], budgets: ["Budgets", screenBudgets], moneyboxes: ["Money boxes", screenMoneyboxes], templates: ["Templates", screenTemplates], tags: ["Tags", screenTags] };
function currentScreen() { const h = location.hash.replace("#", ""); return SCREENS[h] ? h : "dashboard"; }
function render() {
  const key = currentScreen();
  $("#pageTitle").textContent = SCREENS[key][0];
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.screen === key));
  const planned = state.data ? state.data.transactions.filter((t) => t.state === "planned").length : 0;
  $("#dueBtn").hidden = planned === 0;
  $("#dueBtn").textContent = "Expected to confirm: " + planned;
  SCREENS[key][1]($("#view"));
}
window.addEventListener("hashchange", render);
async function load() {
  state.data = await api("/api/state");
  try {
    const s = await api("/api/settings");
    state.dashboard = s.dashboard;
  } catch (e) { /* default layout */ }
  render();
}
load().catch((e) => { msg("Failed to load: " + e.message); });


