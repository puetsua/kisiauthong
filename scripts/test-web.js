// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Smoke tests for web UI rendering that needs no browser: loads web/i18n.js
// and web/app.js into a sandbox with a stub DOM and checks the HTML a few
// screens produce. Usage: node scripts/test-web.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "web");
const read = (f) => fs.readFileSync(path.join(web, f), "utf8");

// a stand-in for any DOM object: every property is another stub, calling one returns a stub
function stub() {
  const fn = function () {};
  return new Proxy(fn, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : stub()),
    set: () => true,
    apply: () => stub(),
    construct: () => stub(),
  });
}
const listStub = () => Object.assign([], { forEach: () => {} });
// document.querySelector("#id") returns one element per selector that keeps what is assigned to it
// (innerHTML, hidden …) and answers anything else with a stub
const elements = new Map();
function element() {
  const own = { querySelectorAll: listStub, querySelector: () => null };
  return new Proxy(own, { get: (o, k) => (k in o ? o[k] : stub()), set: (o, k, v) => { o[k] = v; return true; } });
}
const $el = (sel) => { if (!elements.has(sel)) elements.set(sel, element()); return elements.get(sel); };
// docProps: what a test sets on document (activeElement); anything else is a stub
const docProps = {};
const document = new Proxy({}, { get: (t, k) => (k in docProps ? docProps[k] : k === "querySelectorAll" ? listStub : k === "querySelector" ? $el : stub()) });
const location = { hash: "", search: "", pathname: "/", href: "http://localhost/" };
const sandbox = {
  document, location, console, URL, URLSearchParams, Intl, Date, Math, JSON, Promise, setTimeout, clearTimeout,
  navigator: { languages: ["en"] }, history: { replaceState: (st, title, url) => { location.hash = url; } }, localStorage: { getItem: () => null, setItem: () => {} },
  fetch: () => new Promise(() => {}), MutationObserver: function () { return { observe: () => {} }; }, WeakMap, Map, Set,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }), addEventListener: () => {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("i18n.js"), sandbox, { filename: "i18n.js" });
vm.runInContext(read("theme.js"), sandbox, { filename: "theme.js" });
vm.runInContext(read("app.js") + "\nthis.__t = { state, accountCard, feedRow, screenAcct, screenTransactions, bindDetails, currentScreen, render, setLang, verHTML, verAboutRows, screenTags, screenSettings, appServerRows, askConfirm, drawAppServers, showAuth, showCodeStep, dashTile, dashPaneHTML, tileMeta, screenDashboardEditor, DASH_DEFAULT, screenTag, openAccountDialog, openTagDialog, categoryCard, budgetCard, periodFor, notePanel, live, liveStart, liveStop, liveOnChange, liveRefresh, liveWake, liveBehind, liveBusy, tagNet, netHTML, budgetEnded, widgetBody, screenTags, moneyBlock, moneyTile, curOrder, curSort, pickItems, currencyOptions, fmtNum, fmt, dayNet, dayNetHTML, amountStyle, applyAmountStyle, drawAppearance, pickTheme, openSyncHelp, liveStateHTML, loadedHTML, drawLiveState, SYNC_HELP, themeSyncPlan, themeSyncPrefs, screenThemeEditor, syncThemes, deleteCustomTheme, draftDirty, duplicateTheme };", sandbox, { filename: "app.js" });
const t = sandbox.__t;

// made-up data: today is 2026-11-18; one own account with a reserve, two scheduled rows out and one in
const acc = { id: "a1", kind: "own", name: "Pay", currency: "TWD", balanceMinor: 10000000, reservedMinor: 2000000, heldMinor: 2300000, incomingMinor: 5200000, freeMinor: 5700000, nextHeldDate: "2026-11-20", nextIncomingDate: "2026-12-05" };
const other = { id: "a2", kind: "own", name: "Daily", currency: "TWD", balanceMinor: 100000, reservedMinor: 0, heldMinor: 0, incomingMinor: 500000, freeMinor: 100000, nextIncomingDate: "2026-11-20" };
const ext = { id: "acc-external", kind: "external", name: "External" };
const tx = (id, from, to, amount, date, state, note) => ({ id, fromAccountId: from, toAccountId: to, type: "transfer", amountMinor: amount, currency: "TWD", date, state, note, tagIds: [] });
const txns = [
  tx("t1", "a1", "a2", 500000, "2026-11-20", "scheduled", "Move to Daily"),
  tx("t2", "a1", "acc-external", 1800000, "2026-11-25", "scheduled", "Rent"),
  tx("t3", "acc-external", "a1", 5200000, "2026-12-05", "scheduled", "Salary"),
  tx("t4", "acc-external", "a1", 5200000, "2026-11-05", "posted", "November salary"),
];
t.state.data = { today: "2026-11-18", serverToday: "2026-11-18", accounts: [acc, other], externals: [ext], allAccounts: [acc, other, ext], transactions: txns, tags: [], reserves: [], allocations: [], transactionTemplates: [] };
t.setLang("en");

const strip = (html) => html.replace(/[]/g, "");
let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok", name); };

test("account card: one scheduled amount, no dates, no incoming line", () => {
  const html = strip(t.accountCard(acc));
  assert.match(html, /<button type="button" class="tcard acard" data-detail-account="a1">/);
  assert.match(html, /class="sched"/, "keeps the blue segment");
  assert.strictEqual((html.match(/dot sched/g) || []).length, 1, "exactly one scheduled legend line");
  assert.match(html, /Scheduled TWD 23,000</);
  assert.doesNotMatch(html, /11\/20|12\/5|first|posts|Scheduled in|dot incoming/i);
});

test("account card: an account with only incoming items shows nothing scheduled", () => {
  const html = strip(t.accountCard(other));
  assert.doesNotMatch(html, /sched|incoming|tfoot/);
});

test("account card: mapped over a list it stays a button (index is not an option)", () => {
  assert.ok([acc, other].map((a) => t.accountCard(a)).every((h) => h.startsWith("<button")));
  assert.match(t.accountCard(acc, { page: true }), /^<div class="tcard acard static">/);
});

test("feed row signed from one account: − leaving, + arriving", () => {
  assert.match(strip(t.feedRow(txns[0], { sched: true, acct: "a1" })), /famt out">−TWD 5,000</);
  assert.match(strip(t.feedRow(txns[0], { sched: true, acct: "a2" })), /famt in">\+TWD 5,000</);
  assert.match(strip(t.feedRow(txns[2], { sched: true, acct: "a1" })), /famt in">\+TWD 52,000</);
  assert.match(strip(t.feedRow(txns[0], { sched: true, acct: "a1" })), /Posts 11\/20/);
});

const view = () => ({ innerHTML: "", querySelectorAll: listStub, querySelector: () => null });

test("account page: same card, then scheduled rows soonest first, then posted", () => {
  location.hash = "#acct?id=a1&range=month";
  const v = view();
  t.screenAcct(v);
  const html = strip(v.innerHTML);
  assert.match(html, /href="#accounts"/);
  assert.match(html, /id="acctEdit"/);
  assert.ok(html.includes(strip(t.accountCard(acc, { page: true }))), "the card is the list's card");
  assert.match(html, /acctpage withsched/);
  const order = ["Move to Daily", "Rent", "Salary"].map((s) => html.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "soonest first");
  assert.ok(html.indexOf("November salary") > order[2], "posted after the scheduled list");
  assert.match(html, /−TWD 18,000/); assert.match(html, /\+TWD 52,000/);
  // posted rows are signed from the account's side as well
  assert.match(html.slice(html.indexOf("November salary")), /class="famt in">\+TWD 52,000/);
});

test("scheduled row: the post-date chip has its own line, outside the ellipsized subtitle", () => {
  const html = strip(t.feedRow(txns[1], { sched: true, acct: "a1" }));
  assert.match(html, /class="feedrow withpost"/);
  assert.match(html, /<span class="famt out">−TWD 18,000<\/span><span class="fpost"><span class="chip sched">Posts 11\/25<\/span><\/span><\/button>/);
  assert.doesNotMatch(html.slice(html.indexOf('class="fsub"'), html.indexOf('class="famt')), /chip/);
  assert.doesNotMatch(strip(t.feedRow(txns[3])), /withpost|fpost/);
});

test("account page: unknown or external id goes back to Accounts", () => {
  for (const id of ["nope", "acc-external"]) {
    location.hash = "#acct?id=" + id;
    t.screenAcct(view());
    assert.strictEqual(location.hash, "#accounts"); // replaced in history, not pushed
  }
});

test("notes (#42): a read-only panel on the account and tag pages, only when there is a note; lists unchanged", () => {
  // the panel: escaped, line breaks kept by the CSS, nothing for an empty note
  assert.strictEqual(t.notePanel(""), "");
  assert.strictEqual(t.notePanel(undefined), "");
  assert.strictEqual(t.notePanel("Ends in 0000 <fake>\nPayday 5th"),
    '<section class="panel notepanel" aria-labelledby="noteH"><h3 id="noteH">Note</h3><p class="notetext">Ends in 0000 &lt;fake&gt;\nPayday 5th</p></section>');
  // the account page: under the card, before the period's transactions
  location.hash = "#acct?id=a1&range=month";
  let v = view();
  t.screenAcct(v);
  assert.doesNotMatch(v.innerHTML, /notepanel/, "no note, no panel");
  acc.memo = "Ends in 0000 (fake)\nPayday 5th";
  v = view();
  t.screenAcct(v);
  const html = v.innerHTML;
  assert.match(html, /<h3 id="noteH">Note<\/h3><p class="notetext">Ends in 0000 \(fake\)\nPayday 5th<\/p>/);
  assert.ok(html.indexOf("acctpage") < html.indexOf("notepanel") && html.indexOf("notepanel") < html.indexOf("periodbar"), "under the card, above the transactions");
  // the account list stays as it was
  assert.doesNotMatch(t.accountCard(acc), /notepanel|Ends in|Payday/);
  // the tag page: under the totals; the category card in the list shows nothing of it
  const tag = { id: "g1", name: "Food", currency: "", memo: "Includes delivery apps" };
  t.state.data.tags = [tag];
  location.hash = "#tag?id=g1&range=month";
  v = view();
  t.screenTag(v);
  assert.match(v.innerHTML, /<div class="totals">.*<\/div>\s*<section class="panel notepanel" aria-labelledby="noteH"><h3 id="noteH">Note<\/h3><p class="notetext">Includes delivery apps<\/p><\/section>/s);
  assert.doesNotMatch(t.categoryCard(tag, t.periodFor("month", "2026-11-18")), /delivery|notepanel/);
  tag.memo = "";
  v = view();
  t.screenTag(v);
  assert.doesNotMatch(v.innerHTML, /notepanel/);
  t.setLang("zh-TW");
  assert.match(t.notePanel("x"), /<h3 id="noteH">備註<\/h3>/);
  t.setLang("en");
  t.state.data.tags = [];
  delete acc.memo;
});

// 交通's net: the default currency (TWD) is the large primary amount, JPY smaller below it (#62)
const NET_TRANSIT = '<span class="mamt"><span class="mprim"><span class="ccode">TWD</span><span class="amt out">−14,850</span></span><span class="msec"><span class="ccode">JPY</span><span class="amt out">−21,730</span></span></span>';
test("category totals (#57): one net amount per currency, signed and colored, on the card, the page and nowhere split", () => {
  const T = "g-transit", day = "2026-11-10";
  const mk = (id, from, to, amount, currency, tagIds = [T]) => ({ id, fromAccountId: from, toAccountId: to, type: "transfer", amountMinor: amount, currency, date: day, state: "posted", note: id, tagIds });
  const list = [
    mk("jr", "a1", "acc-external", 15000, "JPY"), mk("suica", "a1", "acc-external", 6730, "JPY"),
    mk("flight", "a1", "acc-external", 1890000, "TWD"), mk("hsr", "a1", "acc-external", 729000, "TWD"),
    mk("refund", "acc-external", "a1", 1134000, "TWD"), // a reimbursement: money in, same currency
    mk("move", "a1", "a2", 500000, "TWD"), // between own accounts: neither in nor out
  ];
  assert.deepStrictEqual({ ...t.tagNet(list) }, { JPY: -21730, TWD: -1485000 });
  assert.strictEqual(strip(t.netHTML(t.tagNet(list))), NET_TRANSIT);
  // more in than out reads +, and an exact refund reads 0, muted
  assert.strictEqual(strip(t.netHTML({ TWD: 50000 })), '<span class="mamt"><span class="mprim"><span class="ccode">TWD</span><span class="amt in">+500</span></span></span>');
  assert.strictEqual(strip(t.netHTML({ TWD: 0 })), '<span class="mamt"><span class="mprim"><span class="ccode">TWD</span><span class="amt zero">0</span></span></span>');
  // the card and the category page show the net, one figure per currency
  const data = t.state.data, saved = { tags: data.tags, transactions: data.transactions };
  data.tags = [{ id: T, name: "Transit", currency: "" }];
  data.transactions = [...saved.transactions, ...list];
  try {
    const card = strip(t.categoryCard(data.tags[0], t.periodFor("year", day)));
    assert.ok(card.includes(`<span class="tfoot">${NET_TRANSIT}</span>`), card);
    assert.doesNotMatch(card, /\+TWD|26,190|11,340/, "no separate in and out for one currency");
    location.hash = "#tag?id=" + T + "&range=year&at=" + day;
    const v = view();
    t.screenTag(v);
    const html = strip(v.innerHTML);
    assert.ok(html.includes(`</span>${NET_TRANSIT}</div>`), "the period line ends in the net amounts");
    // the all-time Spent and Received tiles are labelled, so they keep both sides
    assert.ok(html.includes('<span class="lab">Spent</span><span class="mamt"><span class="mprim"><span class="ccode">TWD</span><span class="amt tot">26,190</span></span><span class="msec"><span class="ccode">JPY</span><span class="amt tot">21,730</span></span></span>'), html);
    assert.ok(html.includes('<span class="lab">Received</span><span class="mamt"><span class="mprim"><span class="ccode">TWD</span><span class="amt tot">11,340</span></span></span>'), html);
  } finally {
    data.tags = saved.tags; data.transactions = saved.transactions;
  }
});

test("amounts in several currencies (#62): default currency first and large, the others by code below it", () => {
  const block = (m, o) => strip(t.moneyBlock(m, o));
  const codes = (html) => [...html.matchAll(/<span class="ccode">(\w+)<\/span>/g)].map((x) => x[1]).join(",");
  // one fixed order whatever order the amounts came in: the default currency, then by code
  assert.strictEqual(t.curOrder({ USD: 1, JPY: 2, TWD: 3, EUR: 4 }).map(([c]) => c).join(), "TWD,EUR,JPY,USD");
  const trip = block({ USD: -4250, JPY: -286400, TWD: -12845000 });
  assert.strictEqual(codes(trip), "TWD,JPY,USD");
  assert.match(trip, /^<span class="mamt"><span class="mprim"><span class="ccode">TWD<\/span><span class="amt out">−128,450<\/span><\/span><span class="msec">/);
  // no default currency: the first by code is the primary
  assert.match(block({ USD: -2397, JPY: -100 }), /^<span class="mamt"><span class="mprim"><span class="ccode">JPY<\/span><span class="amt out">−100<\/span><\/span><span class="msec"><span class="ccode">USD<\/span><span class="amt out">−23.97<\/span><\/span><\/span>$/);
  // one currency: no secondary lines; none: nothing at all
  assert.doesNotMatch(block({ USD: -2397 }), /msec/);
  assert.strictEqual(t.moneyBlock({}), "");
  assert.strictEqual(t.moneyTile("Spent", {}), "");
  // mixed signs keep their own sign and color; a fixed sign and class for reserve moves and tiles
  assert.strictEqual(codes(block({ JPY: -8500, USD: 0, TWD: 1200000 })), "TWD,JPY,USD");
  assert.match(block({ JPY: -8500, USD: 0, TWD: 1200000 }), /class="amt in">\+12,000<.*class="amt out">−8,500<.*class="amt zero">0.00</);
  assert.match(block({ TWD: 50000 }, { sign: "+", cls: "move" }), /<span class="amt move">\+500<\/span>/);
  // the code sits apart from the digits; fmt() still writes the code in front, as before
  assert.strictEqual(t.fmt(-1485000, "TWD"), "TWD " + t.fmtNum(-1485000, "TWD"));
  const saved = t.state.general;
  try {
    // the default currency comes from Settings, and the number format applies (groups of four)
    t.state.general = { defaultCurrency: "JPY", numberFormat: "four" };
    const jp = block({ TWD: -1485000, JPY: -21730 });
    assert.strictEqual(codes(jp), "JPY,TWD");
    assert.ok(jp.includes('<span class="amt out">−2\u00A01730</span>') && jp.includes('<span class="amt out">−1\u00A04850</span>'), jp);
    // the day header's one-line net uses the same order
    const mk = (id, cur, amount) => ({ id, fromAccountId: "a1", toAccountId: "acc-external", type: "transfer", amountMinor: amount, currency: cur, date: "2026-11-10", state: "posted", tagIds: [] });
    assert.match(strip(t.dayNet([mk("x", "USD", 100), mk("y", "TWD", 5000), mk("z", "JPY", 300)])), /^−JPY 300 · −TWD 50 · −USD 1.00$/);
  } finally { t.state.general = saved; }
  // the tiles' labels are translated, the amounts are not
  t.setLang("zh-TW");
  try { assert.match(strip(t.moneyTile(vm.runInContext('__("Spent")', sandbox), { TWD: 100 })), /<span class="lab">已花費<\/span><span class="mamt">/); } finally { t.setLang("en"); }
});

test("one currency order everywhere (#71): the frequently used list in its Settings order, default first, then by code", () => {
  const d = t.state.data, saved = { general: t.state.general, accounts: d.accounts, tags: d.tags, spending: d.spendingThisMonth };
  const codes = (html, re) => [...strip(html).matchAll(re)].map((x) => x[1]).join(",");
  try {
    t.state.general = { defaultCurrency: "TWD", currencies: ["TWD", "USD", "JPY"] };
    assert.strictEqual(t.curSort(["EUR", "JPY", "CHF", "TWD", "USD"]).join(), "TWD,USD,JPY,CHF,EUR");
    assert.strictEqual(t.curOrder({ JPY: 1, EUR: 2, USD: 3, TWD: 4 }).map(([c]) => c).join(), "TWD,USD,JPY,EUR");
    // the list's own order, not by code: USD before JPY; a new default moves to the front
    t.state.general = { defaultCurrency: "JPY", currencies: ["TWD", "USD", "JPY"] };
    assert.strictEqual(t.curSort(["USD", "TWD", "JPY", "AUD"]).join(), "JPY,TWD,USD,AUD");
    t.state.general = { defaultCurrency: "TWD", currencies: ["TWD", "USD", "JPY"] };
    // category cards, tag and reserve pages and day headers (moneyBlock, dayNet)
    assert.strictEqual(codes(t.moneyBlock({ JPY: -300, EUR: -5, TWD: -100, USD: -20 }), /<span class="ccode">(\w+)<\/span>/g), "TWD,USD,JPY,EUR");
    const mk = (id, cur, amount) => ({ id, fromAccountId: "a1", toAccountId: "acc-external", type: "transfer", amountMinor: amount, currency: cur, date: "2026-11-10", state: "posted", tagIds: [] });
    assert.match(strip(t.dayNet([mk("x", "JPY", 300), mk("y", "TWD", 5000), mk("z", "USD", 100)])), /^−TWD 50 · −USD 1.00 · −JPY 300$/);
    // Spending this month: the server's rows by code; the tabs in currency order, the default's tab shown
    d.spendingThisMonth = ["EUR", "JPY", "TWD", "USD"].map((c, i) => ({ tagId: "", currency: c, amountMinor: 1000 + i }));
    const spending = t.widgetBody("spending", { id: "sp71" });
    assert.strictEqual(codes(spending, /data-spend-cur="(\w+)"/g), "TWD,USD,JPY,EUR");
    assert.match(spending, /data-spend-cur="TWD" data-widget="sp71" class="on"/);
    // no spending in the default currency: the first tab in that order (USD, not JPY by code)
    d.spendingThisMonth = d.spendingThisMonth.filter((x) => x.currency !== "TWD");
    assert.match(t.widgetBody("spending", { id: "sp71" }), /^<div class="seg curtabs"[^>]*><button type="button" data-spend-cur="USD" data-widget="sp71" class="on"/);
    // Balances by currency cards and the Customize "Show" checkboxes, whatever the accounts' name order
    const own = (id, name, currency) => ({ id, kind: "own", name, currency, balanceMinor: 100000, reservedMinor: 0, heldMinor: 0, freeMinor: 100000 });
    d.accounts = [own("x1", "Alpha", "JPY"), own("x2", "Beta", "EUR"), own("x3", "Gamma", "USD"), own("x4", "Delta", "TWD"), own("x5", "Eta", "JPY")];
    assert.strictEqual(codes(t.widgetBody("balances", {}), /<b>(\w{3}) /g), "TWD,USD,JPY,EUR");
    assert.strictEqual(t.pickItems("currencies").map((x) => x.id).join(), "TWD,USD,JPY,EUR");
    // currency pickers: the frequently used list, then the others in use and the current value by code
    d.tags = [{ id: "g1", name: "Trip", currency: "GBP" }];
    const top = (html) => codes(html.match(/<optgroup label="Frequently used">(.*?)<\/optgroup>/)[1], /<option value="(\w+)"/g);
    assert.strictEqual(top(t.currencyOptions("CHF")), "TWD,USD,JPY,CHF,EUR,GBP");
    assert.strictEqual(top(t.currencyOptions("USD")), "TWD,USD,JPY,EUR,GBP");
  } finally {
    t.state.general = saved.general; d.accounts = saved.accounts; d.tags = saved.tags; d.spendingThisMonth = saved.spending;
  }
});

test("ended budgets (#59): below the running ones, in a closed Ended (n) section, on the Tags page and in the widget", () => {
  const budget = (id, name, start, end, extra = {}) => ({ id, name, currency: "TWD", limitMinor: 800000, cycle: "range", cycleStart: start, cycleEnd: end,
    periodStart: start, periodEnd: end, spentMinor: 100000, remainingMinor: 700000, ...extra });
  const tags = [
    budget("b-food", "Food", "2026-11-01", "2026-11-30", { cycle: "monthly", cycleStart: "", cycleEnd: "" }),
    budget("b-trip", "Trip", "2026-04-01", "2026-04-20"),
    budget("b-move", "Move", "2025-08-01", "2025-09-30"),
    budget("b-last", "Last day", "2026-11-01", "2026-11-18"), // ends today: still running
    { id: "c-misc", name: "Misc", currency: "" },
  ];
  const data = t.state.data, saved = data.tags, store = {};
  const ls = sandbox.localStorage;
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  data.tags = tags;
  try {
    assert.deepStrictEqual(tags.map(t.budgetEnded), [false, true, true, false, false], "ended: the day after the last one; a category never");
    const tagsPage = () => { const v = view(); v.insertAdjacentHTML = (where, h) => { v.innerHTML = h + v.innerHTML; }; t.screenTags(v); return v.innerHTML; };
    let html = tagsPage();
    const grid = html.slice(html.indexOf('<div class="tgrid">'), html.indexOf("</div><details"));
    assert.match(grid, /Food[\s\S]*Last day/, "running budgets in the grid");
    assert.doesNotMatch(grid, /Trip|Move/, "ended ones are not in the grid");
    assert.match(html, /<details class="endedsec"><summary>Ended \(2\)<\/summary><div class="tgrid">[\s\S]*Trip[\s\S]*<\/div><\/details><\/section>/, "closed by default, below the grid, with the count");
    assert.match(html.slice(html.indexOf("endedsec")), /Move/);
    assert.ok(html.indexOf("endedsec") < html.indexOf("Categories"), "inside the Budgets section, above Categories");
    store["kisiauthong.endedBudgetsOpen"] = "1";
    assert.match(tagsPage(), /<details class="endedsec" open><summary>Ended \(2\)/, "open when this browser left it open");
    // the dashboard widget: the same section after the running ones, for the table and for the cards
    const widget = t.widgetBody("budgets", {});
    const [desk, phone] = [widget.slice(0, widget.indexOf('<div class="wphone">')), widget.slice(widget.indexOf('<div class="wphone">'))];
    for (const [where, part] of [["table", desk], ["cards", phone]]) {
      const i = part.indexOf("<details");
      assert.ok(i > 0, where + ": a section");
      assert.doesNotMatch(part.slice(0, i), /Trip|Move/, where + ": ended ones not among the running");
      assert.match(part.slice(i), /^<details class="endedsec" open><summary>Ended \(2\)<\/summary>[\s\S]*Trip[\s\S]*Move|^<details class="endedsec" open><summary>Ended \(2\)<\/summary>[\s\S]*Move[\s\S]*Trip/, where + ": both ended ones inside");
    }
    t.setLang("zh-TW");
    assert.match(tagsPage(), /<summary>已結束 \(2\)<\/summary>/);
    t.setLang("en");
    // no ended budgets: no section anywhere
    data.tags = tags.filter((x) => !t.budgetEnded(x));
    assert.doesNotMatch(tagsPage() + t.widgetBody("budgets", {}), /endedsec/);
    // only ended ones: the widget shows just the section
    data.tags = tags.filter(t.budgetEnded);
    assert.match(t.widgetBody("budgets", {}), /^<div class="wdesk"><details class="endedsec"/);
  } finally {
    data.tags = saved;
    sandbox.localStorage = ls;
  }
});

test("budget card (#97): days left beside what is left, no per-day amount; start and end dates for the other states", () => {
  const card = (start, end, remaining) => strip(t.budgetCard({ id: "b1", name: "Living", currency: "TWD", limitMinor: 610000, cycle: "monthly",
    periodStart: start, periodEnd: end, spentMinor: 610000 - remaining, remainingMinor: remaining }));
  const foot = (html) => html.slice(html.indexOf('class="tfoot"'));
  try {
    // today is 2026-11-18: a running month with 13 days to go, one line on the left
    let html = foot(card("2026-11-01", "2026-11-30", 63100));
    assert.match(html, /<span class="">TWD 631 left<\/span> <small class="bwhen">· 13 day\(s\) left<\/small>/);
    assert.doesNotMatch(html, /a day|per day/i, "no per-day average");
    assert.match(foot(card("2026-11-01", "2026-11-30", -22000)), /<span class="neg">TWD 220 over<\/span> <small class="bwhen">· 13 day\(s\) left</, "over: days still shown");
    assert.match(foot(card("2026-11-01", "2026-11-18", 1000)), /· 1 day\(s\) left</, "the last day counts");
    // not started / ended: the date, never a day count
    html = foot(card("2026-12-10", "2027-01-05", 610000));
    assert.match(html, /· Starts Thu, Dec 10, 2026</);
    assert.doesNotMatch(html, /day\(s\) left/);
    html = foot(card("2026-10-01", "2026-10-31", 5000));
    assert.match(html, /· Ended Sat, Oct 31, 2026</);
    assert.doesNotMatch(html, /day\(s\) left/);
    t.setLang("zh-TW");
    html = foot(card("2026-11-01", "2026-11-30", 63100));
    assert.match(html, /剩 TWD 631<\/span> <small class="bwhen">· 還有 13 天<\/small>/);
    assert.doesNotMatch(html, /每天/);
    assert.doesNotMatch(foot(card("2026-12-10", "2027-01-05", 610000)), /還有/, "not started: no days left");
    assert.match(foot(card("2026-10-01", "2026-10-31", 5000)), /· 2026年10月31日週六 已結束</);
  } finally {
    t.setLang("en");
  }
});

test("notes (#42): the account and tag forms have a Note field, 4000 characters at most", () => {
  const body = () => $el("#dialogBody").innerHTML;
  acc.memo = "Ends in 0000 & \"fake\"";
  t.openAccountDialog("a1");
  assert.match(body(), /<label class="wide"><span>Note<\/span><textarea name="memo" rows="3" maxlength="4000" placeholder="Account digits, what it is for, reminders…">Ends in 0000 &amp; &quot;fake&quot;<\/textarea><\/label><button class="primarybtn big" type="submit">/);
  assert.ok(body().indexOf('class="iconpick"') < body().indexOf('name="memo"'), "after the icons");
  delete acc.memo;
  t.openAccountDialog(null, "external");
  assert.match(body(), /placeholder="What it is, account details, reminders…"><\/textarea>/, "external accounts too, empty for a new one");
  t.state.data.tags = [{ id: "g1", name: "Food", currency: "", memo: "Includes delivery apps" }];
  t.openTagDialog(null, "g1");
  assert.match(body(), /<label class="wide f-note"><span>Note<\/span><textarea name="memo" rows="3" maxlength="4000" placeholder="What this category includes or leaves out…">Includes delivery apps<\/textarea><\/label>/);
  t.openTagDialog("budget");
  assert.match(body(), /class="wide f-note"/, "a new budget can have a note; hidden when it goes on an existing category");
  t.setLang("zh-TW");
  t.openTagDialog("category");
  assert.match(body(), /<span>備註<\/span><textarea name="memo" rows="3" maxlength="4000" placeholder="這個分類包含什麼、不包含什麼…">/);
  t.setLang("en");
  t.state.data.tags = [];
});

test("acct is a screen of its own", () => {
  location.hash = "#acct?id=a1";
  assert.strictEqual(t.currentScreen(), "acct");
});

test("transactions: scheduled rows fold into one collapsed line", () => {
  location.hash = "#transactions";
  t.screenTransactions(view());
  const html = strip($el("#txnResults").innerHTML);
  assert.match(html, /<button type="button" class="schedtoggle" id="schedToggle" aria-expanded="false" aria-controls="schedList">/);
  assert.match(html, /3 scheduled</);
  assert.match(html, /Open an account for details/);
  assert.match(html, /<ul class="feed" id="schedList" hidden>/);
  assert.doesNotMatch(html, /feedpanel sched/, "no big scheduled panel");
});

test("transactions: open, the rows show in place, soonest first", () => {
  t.state.schedOpen = true;
  t.screenTransactions(view());
  const html = strip($el("#txnResults").innerHTML);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<ul class="feed" id="schedList">/);
  assert.ok(html.indexOf("Move to Daily") < html.indexOf("Rent") && html.indexOf("Rent") < html.indexOf(">Salary<"));
  t.state.schedOpen = false;
});

test("transactions: no scheduled rows, no line", () => {
  const keep = t.state.data.transactions;
  t.state.data.transactions = keep.filter((x) => x.state !== "scheduled");
  t.screenTransactions(view());
  assert.doesNotMatch($el("#txnResults").innerHTML, /schedSec/);
  t.state.data.transactions = keep;
});

test("spending and income display (#66): the list's signs sit in their own span, the account page keeps its own", () => {
  const keep = t.state.data.transactions;
  t.state.data.transactions = [...keep,
    tx("d1", "a1", "acc-external", 12000, "2026-11-17", "posted", "Lunch"),
    tx("d2", "acc-external", "a1", 129000, "2026-11-17", "posted", "Refund"),
    tx("d3", "a1", "a2", 300000, "2026-11-17", "posted", "To Daily"),
    tx("d4", "a1", "acc-external", 50000, "2026-11-16", "posted", "Card"),
    tx("d5", "a2", "acc-external", 6500, "2026-11-16", "posted", "Coffee")];
  const rows = {};
  for (const style of ["both", "sign", "color"]) {
    t.state.general = { ...(t.state.general || {}), amountStyle: style };
    assert.strictEqual(t.amountStyle(), style);
    t.screenTransactions(view());
    rows[style] = strip($el("#txnResults").innerHTML);
  }
  t.state.general = { ...t.state.general, amountStyle: "both" };
  const html = rows.both;
  // the markup is the same in every mode: CSS on html[data-amounts] decides what shows,
  // so copied text and screen readers always get the + / −
  assert.strictEqual(rows.sign, html);
  assert.strictEqual(rows.color, html);
  assert.match(html, /<span class="famt out"><span class="asign">−<\/span>TWD 120<\/span>/, "spending");
  assert.match(html, /<span class="famt in"><span class="asign">\+<\/span>TWD 1,290<\/span>/, "income");
  assert.match(html, /<span class="famt move">TWD 3,000<\/span>/, "a transfer between own accounts: no sign");
  // day nets: one .in / .out span per currency, the sign in its own span too
  assert.match(html, /<span class="fnet"><span class="in"><span class="asign">\+<\/span>TWD 1,170<\/span><\/span>/);
  assert.match(html, /<span class="fnet"><span class="out"><span class="asign">−<\/span>TWD 565<\/span><\/span>/);
  assert.strictEqual(strip(t.dayNet(t.state.data.transactions.filter((x) => x.date === "2026-11-16"))), "−TWD 565", "the text form keeps its sign");
  // only the Transactions list takes the style; the account page keeps its signs and colors
  const v = view();
  t.screenTransactions(v);
  assert.match(v.innerHTML, /<div id="txnResults" class="amtstyle"><\/div>/);
  location.hash = "#acct?id=a1";
  const av = view();
  t.screenAcct(av);
  assert.doesNotMatch(av.innerHTML, /amtstyle|famt[^"]*"><span class="asign"/, "no styled container, rows signed as the account sees them");
  assert.match(strip(av.innerHTML), /famt out">−TWD 120</);
  location.hash = "#transactions";
  t.state.data.transactions = keep;
});

test("spending and income display (#66): unknown or missing setting reads as both, and it lands on <html>", () => {
  t.state.general = { ...t.state.general, amountStyle: undefined };
  assert.strictEqual(t.amountStyle(), "both");
  t.state.general = { ...t.state.general, amountStyle: "rainbow" };
  assert.strictEqual(t.amountStyle(), "both");
  docProps.documentElement = { dataset: {} };
  t.state.general = { ...t.state.general, amountStyle: "color" };
  t.applyAmountStyle();
  assert.strictEqual(docProps.documentElement.dataset.amounts, "color");
  delete docProps.documentElement;
  t.state.general = { ...t.state.general, amountStyle: "both" };
});

test("spending and income display (#66): Settings → Appearance has the select, en and zh-TW", () => {
  const v = view();
  t.state.general = { ...t.state.general, amountStyle: "sign" };
  t.screenSettings(v);
  // moved from Display to Appearance (issue #85)
  assert.doesNotMatch(v.innerHTML.slice(v.innerHTML.indexOf('id="set-display"'), v.innerHTML.indexOf('id="set-appearance"')), /setAmtStyle/);
  const display = v.innerHTML.slice(v.innerHTML.indexOf('id="set-appearance"'), v.innerHTML.indexOf('id="set-data"'));
  assert.match(display, /<label for="setAmtStyle" class="sl">Spending and income<\/label>/);
  assert.match(display, /<option value="both" >Signs and color<\/option><option value="sign" selected>Signs only \(\+ \/ −\)<\/option><option value="color" >Color only<\/option>/);
  assert.match(display, /<select id="setAmtStyle" aria-describedby="setAmtHint">/);
  assert.match(display, /<p class="shint" id="setAmtHint">With Color only/);
  t.setLang("zh-TW");
  t.screenSettings(v);
  assert.match(v.innerHTML, />收支顯示<\/label>.*>符號和顏色<.*>只用 \+ \/ − 符號<.*>只用顏色</s);
  t.setLang("en");
  t.state.general = { ...t.state.general, amountStyle: "both" };
});

test("spending and income display (#66): the stylesheet colors only the list, and spending has its own red", () => {
  const css = read("style.css");
  // each theme's spending colour is its own token (--amt-out), never the over-budget --red (scripts/test-themes.js checks every theme)
  const tok = (k) => (css.match(new RegExp("--" + k + ":(#[0-9a-f]{3,6})")) || [])[1];
  assert.ok(tok("amt-out") && tok("red") && tok("amt-out") !== tok("red"), "--amt-out is not the over-budget --red");
  assert.match(css, /\.amtstyle \.famt\.out,\.amtstyle \.fnet \.out\{color:var\(--amt-out\)\}/);
  assert.match(css, /\.amtstyle \.fnet \.in\{color:var\(--amt-in\)\}/);
  assert.match(css, /\[data-amounts=sign\] \.amtstyle \.famt\.in,\[data-amounts=sign\] \.amtstyle \.famt\.out\{color:var\(--ink\)\}/);
  // hidden from sight but still inline text (not display:none or out of flow), so a copied row keeps "−TWD 120" on one line
  assert.match(css, /\[data-amounts=color\] \.amtstyle \.asign\{font-size:0\}/);
  assert.doesNotMatch(css, /asign\{[^}]*display:none/);
  assert.doesNotMatch(css, /^\.famt\.out\{/m, "outside the list spending stays ink");
});

test("Settings → Appearance (#85): after Display, theme cards each drawn in their theme, the mode, kept on the device", () => {
  const v = view();
  t.screenSettings(v);
  const html = v.innerHTML;
  assert.ok(html.indexOf('id="set-display"') < html.indexOf('id="set-appearance"') && html.indexOf('id="set-appearance"') < html.indexOf('id="set-data"'), "after Display");
  assert.match(html, /data-goto="display">.*Display<\/button><button type="button" data-goto="appearance">.*Appearance<\/button>/s);
  const store = {};
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); } };
  store["kisiauthong.theme"] = JSON.stringify({ theme: "warm", mode: "dark" });
  t.drawAppearance();
  const cards = $el("#themePick").innerHTML, modes = $el("#modePick").innerHTML;
  for (const [k, name] of [["default", "Default"], ["contrast", "High contrast"], ["warm", "Warm"], ["cool", "Cool"]]) {
    assert.match(cards, new RegExp(`<button type="button" class="themecard" data-theme-pick="${k}" aria-pressed="${k === "warm"}"><span class="themeprev" data-theme="${k}" data-mode="dark" aria-hidden="true">.*?<b>${name}</b></button>`));
  }
  assert.match(cards, /id="themeDup">Duplicate as a custom theme</);
  assert.doesNotMatch(cards, /My themes|themeEdit/, "no custom themes yet");
  // sync is off until asked for, and says where the themes are; it is drawn in Settings → Sync (#104)
  assert.doesNotMatch(html.slice(html.indexOf('id="set-appearance"'), html.indexOf('id="set-sync"')), /themeSync/, "not under Appearance");
  const sync = $el("#themeSync").innerHTML;
  assert.match(sync, /<div class="checkline"><label class="checkrow"><input type="checkbox" id="syncCustom" > Sync themes across devices<\/label><button type="button" class="infobtn" id="syncCustomHelp" aria-haspopup="dialog" aria-label="About “Sync themes across devices”"/);
  assert.match(sync, /<div class="checkline"><label class="checkrow"><input type="checkbox" id="syncSelected" > Sync theme selection<\/label><button type="button" class="infobtn" id="syncSelectedHelp" aria-haspopup="dialog" aria-label="About “Sync theme selection”"/);
  assert.match(sync, /Themes are kept on this device only\./);
  assert.doesNotMatch(cards, /more contrast/, "no note while the system asks for nothing");
  assert.match(modes, /<button type="button" data-mode-pick="system" class="" aria-pressed="false">Follow system<\/button><button type="button" data-mode-pick="light" class="" aria-pressed="false">Light<\/button><button type="button" data-mode-pick="dark" class="on" aria-pressed="true">Dark<\/button>/);
  // a system asking for more contrast gets High contrast; the chosen card stays chosen and a note says why
  sandbox.matchMedia = (q) => ({ matches: q === "(prefers-contrast: more)", addEventListener: () => {} });
  t.drawAppearance();
  assert.match($el("#themePick").innerHTML, /data-theme-pick="warm" aria-pressed="true">.*Your system asks for more contrast, so High contrast is in use\./s);
  t.setLang("zh-TW");
  t.drawAppearance();
  assert.match($el("#themePick").innerHTML, />預設<.*>高對比<.*>暖色系<.*>冷色系<.*系統要求較高的對比/s);
  assert.match($el("#modePick").innerHTML, />跟隨系統<.*>淺色<.*>深色</s);
  t.setLang("en");
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
});

test("Settings → Appearance (#85): a card or mode button keeps the choice and applies it; storage that refuses still applies it", () => {
  const store = {};
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); } };
  docProps.documentElement = { dataset: {} };
  t.pickTheme({ theme: "cool" });
  assert.deepStrictEqual(JSON.parse(store["kisiauthong.theme"]), { theme: "cool", mode: "system" });
  assert.strictEqual(docProps.documentElement.dataset.theme, "cool");
  assert.strictEqual($el("#toast").textContent, "Theme saved.");
  assert.match($el("#themePick").innerHTML, /data-theme-pick="cool" aria-pressed="true"/, "the cards are redrawn");
  t.pickTheme({ mode: "dark" });
  assert.deepStrictEqual(JSON.parse(store["kisiauthong.theme"]), { theme: "cool", mode: "dark" }, "a mode keeps the theme");
  assert.strictEqual(docProps.documentElement.dataset.mode, "dark");
  assert.strictEqual($el("#toast").textContent, "Mode saved.");
  // readable but not writable (full or blocked): the pick still shows, and the toast says it will not last
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: () => { throw new Error("full"); } };
  t.pickTheme({ theme: "warm" });
  assert.strictEqual(docProps.documentElement.dataset.theme, "warm", "the refused choice wins over the stored one");
  assert.match($el("#toast").textContent, /keeps no settings/);
  assert.match($el("#toast").className, /error/);
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  sandbox.writeThemePrefs({ theme: "default", mode: "system" });
  delete docProps.documentElement;
});

// a complete custom theme as the device and the server keep it (made-up colours)
const THEME_TOKENS = JSON.parse(vm.runInContext("JSON.stringify(THEME_TOKENS)", sandbox)), THEME_MAIN = JSON.parse(vm.runInContext("JSON.stringify(THEME_MAIN)", sandbox));
const fakeTheme = (id, name, updatedAt) => {
  const colours = {};
  for (const k of THEME_TOKENS) colours[k] = "#334455";
  return { id, name, basedOn: "cool", split: false, light: colours, dark: null, updatedAt };
};
test("theme sync (#85): what a sync does, per ADR 0027", () => {
  const A1 = fakeTheme("thm-aaaaaa", "Teal", "2026-11-24T01:00:00.000Z"), A2 = fakeTheme("thm-aaaaaa", "Teal 2", "2026-11-24T02:00:00.000Z");
  const B = fakeTheme("thm-bbbbbb", "Dusk", "2026-11-24T01:00:00.000Z"), C = fakeTheme("thm-cccccc", "Sand", "2026-11-24T01:00:00.000Z");
  const sp = (o) => Object.assign({ custom: false, selected: false, pending: "", deleted: [], known: [], at: "" }, o);
  const plan = (server, o, local, prefs) => JSON.parse(JSON.stringify(t.themeSyncPlan(server, sp(o), local, prefs || { theme: "default", mode: "system" })));
  const ids = (l) => l.map((x) => x.id + "@" + x.name);
  // custom themes on, first time: both sides merged by id, the newer copy wins, and the result goes up
  let p = plan({ themes: [A1, B], general: {} }, { custom: true }, [A2, C]);
  assert.deepStrictEqual(ids(p.local), ["thm-aaaaaa@Teal 2", "thm-cccccc@Sand", "thm-bbbbbb@Dusk"]);
  assert.deepStrictEqual(ids(p.upload.themes), ids(p.local));
  assert.ok(!p.upload.general, "the selected theme is not touched");
  // already the same on both sides: nothing to send
  assert.strictEqual(plan({ themes: [A2, B], general: {} }, { custom: true }, [A2, B]).upload, null);
  // deleted here: it leaves the server
  p = plan({ themes: [A2, B], general: {} }, { custom: true, deleted: ["thm-bbbbbb"] }, [A2]);
  assert.deepStrictEqual(ids(p.upload.themes), ["thm-aaaaaa@Teal 2"]);
  assert.deepStrictEqual(p.known, ["thm-aaaaaa"], "what the server has after this sync");
  // deleted on another device: the server had B at the last sync and no longer has it, so it goes here too
  // instead of coming back; C, new here, still goes up
  p = plan({ themes: [A2], general: {} }, { custom: true, known: ["thm-aaaaaa", "thm-bbbbbb"] }, [A2, B, C]);
  assert.deepStrictEqual(ids(p.local), ["thm-aaaaaa@Teal 2", "thm-cccccc@Sand"]);
  assert.deepStrictEqual(ids(p.upload.themes), ["thm-aaaaaa@Teal 2", "thm-cccccc@Sand"]);
  assert.strictEqual(plan({ themes: [A2], general: {} }, { custom: true, known: ["thm-aaaaaa", "thm-bbbbbb"] }, [A2, B]).upload, null, "nothing to send back");
  // selected theme on, custom off: a custom choice made here goes up with its theme, and the notice names it
  p = plan({ themes: [B], general: {} }, { selected: true, pending: "1" }, [C], { theme: "thm-cccccc", mode: "dark" });
  assert.deepStrictEqual(ids(p.upload.themes), ["thm-bbbbbb@Dusk", "thm-cccccc@Sand"], "the server's others stay");
  assert.deepStrictEqual(p.upload.general, { theme: { selected: "thm-cccccc" } });
  assert.strictEqual(p.notice, "Sand");
  // a built-in choice made here: only the choice goes up
  p = plan({ themes: [B], general: { theme: { selected: "warm" } } }, { selected: true, pending: "1" }, [], { theme: "cool", mode: "light" });
  assert.deepStrictEqual(p.upload, { themes: JSON.parse(JSON.stringify([B])), general: { theme: { selected: "cool" } } });
  assert.strictEqual(p.notice, "");
  // nothing chosen here since: another device's choice is taken, with its theme even when custom themes are not synced
  p = plan({ themes: [B], general: { theme: { selected: "thm-bbbbbb" } } }, { selected: true }, [], { theme: "default", mode: "dark" });
  assert.deepStrictEqual(p.prefs, { theme: "thm-bbbbbb", mode: "dark" }, "the mode stays this device's");
  assert.deepStrictEqual(ids(p.local), ["thm-bbbbbb@Dusk"]);
  assert.strictEqual(p.upload, null);
  p = plan({ themes: [], general: { theme: { selected: "warm" } } }, { selected: true }, [], { theme: "default", mode: "system" });
  assert.deepStrictEqual(p.prefs, { theme: "warm", mode: "system" });
  // the server names a theme it does not have: this device's choice goes up instead
  p = plan({ themes: [], general: { theme: { selected: "thm-zzzzzz" } } }, { selected: true }, [], { theme: "cool", mode: "system" });
  assert.strictEqual(p.prefs, null);
  assert.deepStrictEqual(p.upload.general, { theme: { selected: "cool" } });
  // both off: the server is not asked for anything (the caller does not sync), and a plan sends nothing
  assert.strictEqual(plan({ themes: [B], general: { theme: { selected: "warm" } } }, {}, [C]).upload, null);
});

test("theme sync (#85): Settings shows the custom themes, the sync choices and each sync state", () => {
  const store = { "kisiauthong.themes": JSON.stringify([fakeTheme("thm-cccccc", "Sand", "2026-11-24T01:00:00.000Z")]), "kisiauthong.theme": JSON.stringify({ theme: "thm-cccccc", mode: "system" }),
    "kisiauthong.themeSync": JSON.stringify({ custom: true, selected: false, at: "2026-11-24T03:42:00.000Z" }) };
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); }, removeItem: (k) => { delete store[k]; } };
  t.state.themeSync = {};
  t.drawAppearance();
  const cards = $el("#themePick").innerHTML, sync = $el("#themeSync").innerHTML;
  assert.match(cards, /<p class="setlabel">My themes<\/p><div class="themecards"><button type="button" class="themecard" data-theme-pick="thm-cccccc" aria-pressed="true"><span class="themeprev" data-theme="cool" data-mode="light" style="--bg:#334455;/);
  assert.match(cards, /id="themeEdit">Edit Sand</);
  assert.match(sync, /id="syncCustom" checked>.*id="syncSelected" >/s);
  assert.match(sync, /class="syncstate ok" role="status"><span class="dot"><\/span><span>Synced at /);
  assert.doesNotMatch(sync, /mode is not synced/, "the (i) help says it, not a line under the boxes");
  t.state.themeSync = { status: "syncing" };
  t.drawAppearance();
  assert.match($el("#themeSync").innerHTML, /class="syncstate busy" role="status"><span class="dot"><\/span><span>Syncing…/);
  t.state.themeSync = { status: "error", at: "2026-11-24T03:40:00.000Z", error: "Failed to fetch" };
  t.drawAppearance();
  assert.match($el("#themeSync").innerHTML, /class="syncstate err" role="alert">.*Sync failed at .*: Failed to fetch\. The themes are still on this device\.<\/span> <button type="button" class="smallbtn" id="syncRetry">Retry<\/button>/s);
  t.state.themeSync = { status: "ok", notice: "Sand" };
  t.drawAppearance();
  assert.match($el("#themeSync").innerHTML, /“Sand” was not on the server yet, so it was uploaded for your other devices\./);
  t.setLang("zh-TW");
  t.drawAppearance();
  assert.match($el("#themeSync").innerHTML, /> 跨裝置主題同步<\/label><button [^>]*aria-label="關於「跨裝置主題同步」".*> 主題選擇同步<\/label><button [^>]*aria-label="關於「主題選擇同步」".*伺服器上還沒有「Sand」/s);
  t.setLang("en");
  t.state.themeSync = {};
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
});

test("Settings → Sync (#104): its own section after Appearance, with live updates, the last fetch and the theme sync choices", () => {
  const v = view();
  t.screenSettings(v);
  const html = v.innerHTML;
  assert.ok(html.indexOf('id="set-appearance"') < html.indexOf('id="set-sync"') && html.indexOf('id="set-sync"') < html.indexOf('id="set-data"'), "after Appearance, before Data");
  assert.match(html, /data-goto="appearance">.*Appearance<\/button><button type="button" data-goto="sync"><svg[^>]*>.*<\/svg>Sync<\/button>/s);
  const sec = html.slice(html.indexOf('id="set-sync"'), html.indexOf('id="set-data"'));
  assert.match(sec, /<h3>Sync<\/h3>/);
  assert.match(sec, /<span class="sl">Live updates<\/span><div class="sc"><div id="syncLive" role="status"><p class="syncstate/);
  assert.match(sec, /<span class="sl">Last updated<\/span><div class="sc"><div id="syncLoaded">/);
  assert.match(sec, /<span class="sl">Themes<\/span><div class="sc"><div id="themeSync"><\/div>/);
  t.setLang("zh-TW");
  t.screenSettings(v);
  assert.match(v.innerHTML, /data-goto="sync">.*同步<\/button>.*>即時更新<.*>最後更新<.*>主題</s);
  t.setLang("en");
});

test("Settings → Sync (#104): the live update line says what the page already knows of the stream", () => {
  const saved = { nav: sandbox.navigator, es: sandbox.EventSource, liveEs: t.live.es };
  try {
    sandbox.navigator = { languages: ["en"], onLine: false };
    assert.match(t.liveStateHTML(), /<p class="syncstate off"><span class="dot"><\/span><span>Offline: this device has no network\. Changes show here when it is back online\.<\/span><\/p>/);
    sandbox.navigator = { languages: ["en"], onLine: true };
    delete sandbox.EventSource;
    assert.match(t.liveStateHTML(), /<p class="syncstate"><span class="dot"><\/span><span>Not available in this browser\. The page catches up when you come back to it\./);
    sandbox.EventSource = function () {};
    t.live.es = null;
    assert.match(t.liveStateHTML(), /<p class="syncstate busy">.*Connecting to the server…/, "not open yet, or waiting to try again");
    t.live.es = { readyState: 0 };
    assert.match(t.liveStateHTML(), /syncstate busy/);
    t.live.es = { readyState: 1 };
    assert.match(t.liveStateHTML(), /<p class="syncstate ok">.*On: changes made on your other devices show here as they happen\./);
    // drawn again only when it changed, so a screen reader hears each change once
    let cur = "";
    const writes = [];
    elements.set("#syncLive", { get innerHTML() { return cur; }, set innerHTML(v) { cur = v; writes.push(v); } });
    t.drawLiveState();
    t.drawLiveState();
    assert.strictEqual(writes.length, 1, "the same state again is not written");
    assert.match(cur, /syncstate ok/);
    t.live.es = { readyState: 0 };
    t.drawLiveState();
    assert.strictEqual(writes.length, 2, "a new state is");
    assert.match(cur, /syncstate busy/);
    elements.delete("#syncLive");
    t.live.es = { readyState: 1 };
    t.setLang("zh-TW");
    assert.match(t.liveStateHTML(), /已開啟：你在其他裝置上的變更會立即顯示在這裡。/);
    t.live.es = { readyState: 0 };
    assert.match(t.liveStateHTML(), /正在連線到伺服器…/);
    t.setLang("en");
  } finally {
    sandbox.navigator = saved.nav;
    if (saved.es === undefined) delete sandbox.EventSource; else sandbox.EventSource = saved.es;
    t.live.es = saved.liveEs;
  }
});

test("Settings → Sync (#104): the last fetch of the books, a clock time today and with its date before", () => {
  const saved = t.state.loadedAt;
  t.state.loadedAt = null;
  assert.match(t.loadedHTML(), /<span>—<\/span>/, "nothing fetched yet");
  const now = new Date();
  t.state.loadedAt = now.toISOString();
  const clock = now.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  assert.strictEqual(t.loadedHTML(), `<p class="syncstate"><span>${clock}</span></p>`);
  const before = new Date(now.getTime() - 3 * 86400000);
  t.state.loadedAt = before.toISOString();
  assert.strictEqual(t.loadedHTML(), `<p class="syncstate"><span>${before.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></p>`);
  t.state.loadedAt = saved;
});

test("Settings → Sync (#104): each (i) opens what its choice does, per ADR 0027, in a dialog with a Close button", () => {
  t.openSyncHelp("custom");
  assert.strictEqual($el("#dialogTitle").textContent, "Sync themes across devices");
  let body = $el("#dialogBody").innerHTML;
  assert.match(body, /^<ul class="helplist"><li>Themes are kept on this device unless you turn on sync\./, "local by default");
  assert.match(body, /custom themes on this device are uploaded to your account on the server/, "what it uploads");
  assert.match(body, /The first time it is turned on, the themes here and on the server are merged: a theme on both sides is the same theme, and the copy changed last is kept\./, "first merge by id, newer wins");
  assert.match(body, /Light or dark mode is not synced: each device keeps its own\./);
  assert.match(body, /Turning it off stops syncing\. The copies already on the server stay there\./);
  assert.match(body, /<button type="button" class="primarybtn" id="syncHelpOk">Close<\/button>/);
  t.openSyncHelp("selected");
  assert.strictEqual($el("#dialogTitle").textContent, "Sync theme selection");
  body = $el("#dialogBody").innerHTML;
  assert.match(body, /the theme you pick here is uploaded/, "what it uploads");
  assert.match(body, /that theme itself is uploaded too, even when Sync themes across devices is off/);
  assert.match(body, /If the server did not have that theme yet, a notice says it was uploaded\./);
  assert.match(body, /Light or dark mode is not synced/);
  assert.match(body, /Turning it off stops syncing\. What is already on the server stays there\./);
  t.setLang("zh-TW");
  t.openSyncHelp("selected");
  assert.strictEqual($el("#dialogTitle").textContent, "主題選擇同步");
  assert.match($el("#dialogBody").innerHTML, /即使「跨裝置主題同步」是關閉的，這個主題本身也會一起上傳.*>關閉<\/button>/s);
  t.setLang("en");
  // every line of the help is translated (scripts/check-i18n.js checks the strings themselves)
  t.setLang("zh-TW");
  for (const k of Object.keys(t.SYNC_HELP)) { t.openSyncHelp(k); assert.doesNotMatch($el("#dialogBody").innerHTML, /<li>[A-Z]/, k); }
  t.setLang("en");
});

test("theme editor (#85): a Settings sub-page with the name, the split, grouped main colours, a picker, the JSON and a preview", () => {
  const store = { "kisiauthong.themes": JSON.stringify([fakeTheme("thm-cccccc", "Sand", "2026-11-24T01:00:00.000Z")]) };
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); }, removeItem: (k) => { delete store[k]; } };
  location.hash = "#theme?id=thm-cccccc";
  assert.strictEqual(t.currentScreen(), "theme");
  t.state.themeDraft = null;
  const v = view();
  t.screenThemeEditor(v);
  const html = v.innerHTML;
  assert.match(html, /<a class="smallbtn" href="#settings" id="themeBack">‹ Settings<\/a>/);
  assert.match(html, /<input id="themeName" maxlength="60" value="Sand">/);
  assert.match(html, /<p class="shint">Based on Cool<\/p>/);
  assert.match(html, /<input type="checkbox" id="themeSplit" > Separate colours for light and dark/, "light only by default");
  assert.doesNotMatch(html, /data-editing=/, "no light/dark tabs while the split is off");
  assert.match(html, /<textarea id="themeJSON"/);
  assert.match(html, /id="themeCopy">Copy JSON<.*id="themePaste">Apply pasted JSON</s);
  assert.match(html, /id="themeDel">Delete theme<.*id="themeCancel">Cancel<.*id="themeSave">Save theme</s);
  const colours = $el("#themeColours").innerHTML;
  assert.deepStrictEqual([...colours.matchAll(/data-swatch="([a-z0-9-]+)"/g)].map((m) => m[1]), THEME_MAIN, "only the main colours, in groups");
  assert.match(colours, /<h3>Amounts<\/h3><div class="tswatches"><button type="button" class="tswatch" data-swatch="amt-in" aria-pressed="false">.*data-swatch="amt-out" aria-pressed="true">/s);
  assert.match(colours, /<div id="themePicker"><\/div><\/div><div class="tgroup"><h3>Page/, "the picker opens under the chosen colour's group");
  assert.match($el("#themePicker").innerHTML, /role="slider" tabindex="0" aria-label="Saturation and brightness".*id="tpHue".*id="tpHex" value="#334455"/s);
  assert.match($el("#tpRatio").textContent, /^Contrast with cards: 1\.0:1$/, "a plain figure, no verdict");
  assert.match($el("#themePreview").innerHTML, /<div class="themepv" data-theme="cool" data-mode="light" style="--bg:#334455;/);
  // with the split on there are tabs for the two modes
  t.state.themeDraft.split = true; t.state.themeDraft.dark = Object.assign({}, t.state.themeDraft.light); t.state.themeDraft.editing = "dark";
  t.screenThemeEditor(v);
  assert.match(v.innerHTML, /id="themeSplit" checked>.*data-editing="light" class="" aria-pressed="false">Edit light<.*data-editing="dark" class="on" aria-pressed="true">Edit dark</s);
  // a theme that is gone sends the editor back to Settings
  location.hash = "#theme?id=thm-gone00";
  t.state.themeDraft = null;
  t.screenThemeEditor(view());
  assert.strictEqual(location.hash, "#settings");
  t.state.themeDraft = null;
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
});

test("theme (#85): the sign-in screen is Default whatever this device chose; signing in brings the choice back", () => {
  const store = { "kisiauthong.theme": JSON.stringify({ theme: "warm", mode: "light" }) };
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); } };
  docProps.documentElement = { dataset: {} };
  const keep = { data: t.state.data, me: t.state.me }; // showAuth signs out: put the made-up books back afterwards
  t.showAuth("login");
  assert.deepStrictEqual({ ...docProps.documentElement.dataset }, { theme: "default", mode: "light" });
  // boot() clears the override once a user is signed in, before anything of theirs is drawn
  const boot = read("app.js").match(/async function boot\(\) \{[\s\S]*?\n\}/)[0];
  assert.ok(boot.indexOf("setThemeSignedOut(false)") > boot.indexOf("state.me = st.user") && boot.indexOf("setThemeSignedOut(false)") < boot.indexOf("await load()"));
  sandbox.setThemeSignedOut(false);
  assert.deepStrictEqual({ ...docProps.documentElement.dataset }, { theme: "warm", mode: "light" });
  Object.assign(t.state, keep);
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  delete docProps.documentElement;
});

test("zh-TW: the summary line and the card read as designed", () => {
  t.setLang("zh-TW");
  t.screenTransactions(view());
  assert.match(strip($el("#txnResults").innerHTML), /3 筆已排程<\/span><span class="schedhint">點帳戶看明細/);
  assert.match(strip(t.accountCard(acc)), /已排程 TWD 23,000</);
  t.setLang("en");
});

// the tag merge flow's labels (#26): the entry manages tags, the bar's button opens the options dialog
test("tags: \"Manage tags\" entry and the \"Merge options\" button, en and zh-TW", () => {
  const tagView = () => Object.assign(view(), { insertAdjacentHTML(pos, html) { this.innerHTML = html + this.innerHTML; } });
  t.state.data.tags = [{ id: "g1", name: "Food" }, { id: "g2", name: "Snacks" }, { id: "g3", name: "Rent" }];
  for (const [lang, entry, pick, go] of [["en", "Manage tags", "Pick 2 or more", "Merge options"], ["zh-TW", "管理標籤", "至少選 2 個", "合併選項"]]) {
    t.setLang(lang);
    t.state.tagPick = null;
    const v = tagView();
    t.screenTags(v);
    assert.ok(v.innerHTML.includes(`id="tagMerge">${entry}</button>`), lang + " entry");
    t.state.tagPick = new Set(["g1"]);
    t.screenTags(tagView());
    assert.strictEqual($el("#pickGo").textContent, pick);
    t.state.tagPick = new Set(["g1", "g2"]);
    t.screenTags(tagView());
    assert.strictEqual($el("#pickGo").textContent, go, lang + " selection button");
  }
  t.setLang("en");
  t.state.tagPick = null;
  t.state.data.tags = [];
});

// the version (#14): shown as the build stamped it, never with a "v" prefix; a chip only for nightly
const sha = "c22ff51a3e9d07b41f6c2580e9a7d13b64f0c8e2"; // made up
const builds = {
  release: { version: "0.2.0", commit: sha, buildTime: "2026-11-12T08:30:05Z", nightly: false },
  nightly: { version: "0.2.0-1118-c22ff51", commit: sha, buildTime: "2026-11-17T19:00:12Z", nightly: true },
  dev: { version: "dev", commit: "", buildTime: "", nightly: false },
};
const aboutRows = (a) => t.verAboutRows(a, (label, control) => `<row>${label}|${control}</row>`, "https://example.invalid/src/").join("");
test("version text: chip only for nightly, no v prefix", () => {
  assert.strictEqual(t.verHTML(builds.release), '<span class="vertext">0.2.0</span>');
  assert.strictEqual(t.verHTML(builds.nightly), '<span class="vertext">0.2.0-1118-c22ff51</span><span class="verchip">nightly</span>');
  assert.strictEqual(t.verHTML(builds.dev), '<span class="vertext">dev</span>');
  for (const a of Object.values(builds)) assert.doesNotMatch(t.verHTML(a) + aboutRows(a), />v\d|"v\d/);
});
test("Settings → About rows per build", () => {
  t.state.general = { timeZone: "Asia/Taipei" };
  const rel = aboutRows(builds.release), night = aboutRows(builds.nightly), dev = aboutRows(builds.dev);
  assert.match(rel, /<row>Build time\|2026-11-12 16:30 \(Asia\/Taipei, UTC\+8\)<\/row>/);
  assert.match(rel, new RegExp(`<a href="https://example.invalid/src/commit/${sha}" target="_blank" rel="noopener"><code class="hash">c22ff51</code></a><button type="button" class="smallbtn" id="copyCommit">Copy</button>`));
  assert.doesNotMatch(rel, /verchip|vernote/);
  assert.match(night, /<span class="verchip">nightly<\/span><\/div><div class="muted vernote">Nightly test build, built automatically every day<\/div>/);
  assert.match(night, /2026-11-18 03:00 \(Asia\/Taipei, UTC\+8\)/, "the build time in the display zone");
  t.state.general = { timeZone: "America/Los_Angeles" };
  assert.match(aboutRows(builds.nightly), /2026-11-17 11:00 \(America\/Los Angeles, UTC-8\)/, "may fall on another day than the 1118 in the version");
  assert.strictEqual(dev, '<row>Version|<div class="verline"><span class="vertext">dev</span></div></row>', "a dev build has no build time or commit");
  assert.strictEqual(t.verAboutRows(null, () => "x", "").length, 0, "no rows without version info");
  t.setLang("zh-TW");
  assert.match(aboutRows(builds.nightly), /<row>版本\|.*每日自動建置的測試版（nightly）.*<row>建置時間\|.*<row>提交\|.*>複製</);
  t.setLang("en");
  t.state.general = null;
});
test("Settings → Servers: only inside the app, above About", () => {
  const settings = () => { const v = { innerHTML: "", querySelectorAll: listStub }; t.screenSettings(v); return v.innerHTML; };
  t.state.general = { timeZone: "Asia/Taipei" };
  assert.doesNotMatch(settings(), /set-servers|Servers/, "a browser has no Servers section");
  sandbox.kisiauthongApp = { servers: () => new Promise(() => {}) };
  const html = settings();
  assert.match(html, /data-goto="servers">.*Servers<\/button><button type="button" data-goto="about">/s, "listed just before About");
  assert.ok(html.indexOf('id="set-data"') < html.indexOf('id="set-servers"') && html.indexOf('id="set-servers"') < html.indexOf('id="set-about"'));
  delete sandbox.kisiauthongApp;
  const rows = t.appServerRows({ active: "a", servers: [
    { id: "a", name: "Home", url: "https://books.example.org/kisiauthong/" },
    { id: "b", url: "http://100.64.0.12:9700/" },
    { id: "c", name: "<b>NAS</b>", url: "https://nas.example.org/" },
  ] });
  assert.strictEqual((rows.match(/class="pill on">In use</g) || []).length, 1, "one In use marker");
  assert.match(rows, /<span class="sl">Home<\/span> <span class="pill on">In use<\/span><div class="srvurl">https:\/\/books.example.org\/kisiauthong\/<\/div>/);
  assert.doesNotMatch(rows, /data-srv-use="a"/, "no Switch on the server in use");
  assert.match(rows, /data-srv-use="b" aria-label="Switch to 100.64.0.12:9700">Switch<.*data-srv-edit="b" aria-label="Edit 100.64.0.12:9700">Edit<.*data-srv-del="b" aria-label="Remove 100.64.0.12:9700">Remove</s, "each button names its server");
  assert.match(rows, /data-srv-del="a" aria-label="Remove Home">/);
  assert.match(rows, /aria-label="Edit &lt;b&gt;NAS&lt;\/b&gt;"/, "the name is escaped in the label too");
  assert.match(rows, /<span class="sl">100.64.0.12:9700<\/span>/, "no name: the host");
  assert.match(rows, /&lt;b&gt;NAS&lt;\/b&gt;/, "names are escaped");
  assert.match(rows, /<button type="button" class="ghostbtn" data-srv-add>Add server<\/button><\/div><\/div>$/);
  t.setLang("zh-TW");
  const zh = t.appServerRows({ active: "a", servers: [{ id: "a", name: "家裡", url: "https://x.example/" }, { id: "b", url: "https://y.example/" }] });
  assert.match(zh, /使用中.*切換.*編輯.*移除.*新增伺服器/s);
  assert.match(zh, /aria-label="移除「家裡」"/);
  assert.match(zh, /aria-label="切換到「y.example」"/);
  t.setLang("en");
  t.state.general = null;
});
test("sign-in card: the server row and Change server only inside the app, on every signed-out step", () => {
  const card = () => $el("#authScreen").innerHTML;
  const steps = () => { t.showAuth("login"); const login = card(); t.showAuth("setup"); const setup = card(); t.showCodeStep("ticket"); return { login, setup, code: card() }; };
  location.host = "100.100.106.127:9728";
  for (const [step, html] of Object.entries(steps())) assert.doesNotMatch(html, /srvfoot|authServer|Change server/, `a browser: nothing new on ${step}`);
  const opened = [];
  sandbox.kisiauthongApp = { add: (lang) => { opened.push(lang); return Promise.resolve(); } };
  let onClick = null;
  $el("#authServer").addEventListener = (type, fn) => { if (type === "click") onClick = fn; };
  t.showAuth("login");
  onClick();
  assert.deepStrictEqual(opened, ["en"], "Change server opens the app's server screen in the web UI's language");
  for (const [step, html] of Object.entries(steps())) {
    assert.match(html, /<div class="srvfoot"><span>Server <span class="host">100\.100\.106\.127:9728<\/span><\/span><button class="linkbtn" type="button" id="authServer" aria-label="Change server \(now 100\.100\.106\.127:9728\)">Change server<\/button><\/div>\s*<\/form>$/, `the row closes the card on ${step}`);
  }
  location.host = 'evil"<b>.example';
  assert.match(steps().login, /<span class="host">evil&quot;&lt;b&gt;\.example<\/span>.*aria-label="Change server \(now evil&quot;&lt;b&gt;\.example\)"/s, "the host is escaped in text and label");
  t.setLang("zh-TW");
  location.host = "books.example.org";
  assert.match(steps().code, /<span>伺服器 <span class="host">books\.example\.org<\/span><\/span>.*aria-label="更換伺服器（目前：books\.example\.org）">更換伺服器</s);
  t.setLang("en");
  delete sandbox.kisiauthongApp;
  delete location.host;
});

test("Customize dashboard on phones: tiles are bars, settings open under the bar, the add grid has no grips (#40)", () => {
  // the sign-in tests leave no data (showAuth clears it); the desktop preview needs some
  t.state.data = t.state.data || { today: "2026-11-18", serverToday: "2026-11-18", accounts: [], externals: [], allAccounts: [], transactions: [], tags: [], reserves: [], allocations: [], transactionTemplates: [] };
  const items = [{ id: "a", type: "balances" }, { id: "b", type: "spending", size: "half", rows: 5 }, { id: "c", type: "recent" }];
  const draft = { items };
  t.state.dashSel = null;
  const bar = t.dashTile(items[1], 1, draft, true);
  assert.doesNotMatch(bar, /tilebody|tileset/, "a collapsed tile is only its bar");
  assert.match(bar, /<span class="tnm">Spending this month<\/span><small class="tmeta">Half width · Rows: 5<\/small>/);
  assert.match(bar, /data-tile-move="-1" aria-label="Move Spending this month earlier" >.*data-tile-move="1" aria-label="Move Spending this month later" >/s);
  assert.match(bar, /data-tile-edit="b" aria-label="Settings for Spending this month" title="Settings" aria-expanded="false">/);
  assert.match(bar, /data-tile-remove aria-label="Remove Spending this month"/);
  assert.strictEqual(t.tileMeta(items[0]), "Full width", "no rows line for a widget without rows");
  assert.strictEqual(t.tileMeta({ id: "x", type: "recent" }), "Full width · Rows: 6", "the default rows");
  t.state.dashSel = "b";
  const open = t.dashTile(items[1], 1, draft, true);
  assert.match(open, /class="panel dw edit half sel"/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<div class="tileset"><div class="paneform">.*data-dash-title value="".*data-dash-size.*<option value="half" selected>.*data-dash-rows min="1" max="50" value="5".*<div class="setrow tileacts"><button type="button" class="smallbtn" data-pane-dup>Duplicate<\/button><button type="button" class="smallbtn danger" data-pane-remove>Remove from dashboard<\/button><\/div><\/div><\/section>$/s);
  assert.doesNotMatch(open, /data-pane-back|tilebody/, "no back link inline, no preview");
  // the pane on phones only adds: every type, again and again (copies are allowed), as "+ type" buttons
  const pane = t.dashPaneHTML(draft, true);
  assert.strictEqual((pane.match(/class="paladd" data-pal-add=/g) || []).length, 6);
  assert.match(pane, /^<h3>Add widget<\/h3>\s*<div class="palgrid"><button type="button" class="paladd" data-pal-add="balances" aria-label="Add Balances by currency"><span aria-hidden="true">\+<\/span>Balances by currency<\/button>/);
  assert.doesNotMatch(pane, /grip|droptrash|data-pal="|data-pane-back|paneform/, "no drag handles, no drop zone, no settings in the pane");
  // desktop stays as it was: previews, settings in the pane, the palette with grips
  const desk = t.dashTile(items[2], 2, draft, false);
  assert.match(desk, /<div class="tilebody" inert>/);
  assert.doesNotMatch(desk, /tileset|aria-expanded/);
  assert.match(t.dashPaneHTML(draft, false), /data-pane-back.*<h3>Spending this month<\/h3><div class="paneform">/s);
  t.state.dashSel = null;
  assert.match(t.dashPaneHTML(draft, false), /<ul class="palette"><li data-pal="balances"><span class="grip" aria-hidden="true">⠿<\/span>.*<div class="droptrash">/s);
  t.setLang("zh-TW");
  t.state.dashSel = "b";
  assert.match(t.dashTile(items[1], 1, draft, true), /<small class="tmeta">半寬 · 5 列<\/small>.*複製.*從總覽移除/s);
  assert.match(t.dashPaneHTML(draft, true), /<h3>加入小工具<\/h3>.*aria-label="加入「預算」"><span aria-hidden="true">\+<\/span>預算</s);
  t.setLang("en");
  t.state.dashSel = null;
  // the phone CSS hides the grips and the drop zone, and keeps 40px touch targets
  const css = fs.readFileSync(path.join(web, "style.css"), "utf8");
  const phoneCss = css.slice(css.indexOf("customizing on phones (issue #40)") - 200, css.indexOf("customizing on phones (issue #40)") + 1400);
  assert.match(phoneCss, /\.dasheditor \.grip,\.dasheditor \.droptrash\{display:none\}/);
  assert.match(phoneCss, /\.tilebar \.iconbtn,\.colpick \.iconbtn\{min-width:40px;min-height:40px\}/);
  assert.match(css, /\.paladd\{[^}]*min-height:48px/);
});

test("Customize dashboard on phones, the whole editor: bars only, then the add grid", () => {
  const mq = sandbox.matchMedia;
  sandbox.matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} });
  t.state.dashDraft = JSON.parse(JSON.stringify(t.DASH_DEFAULT));
  t.state.dashSel = null;
  const v = { innerHTML: "", querySelector: () => element(), querySelectorAll: listStub };
  t.screenDashboardEditor(v);
  const canvas = $el("#dashCanvas").innerHTML, pane = $el("#dashPane").innerHTML;
  assert.strictEqual((canvas.match(/data-tile="/g) || []).length, 6);
  assert.doesNotMatch(canvas, /tilebody|tileset/);
  assert.match(pane, /class="palgrid"/);
  t.state.dashSel = "budgets";
  t.screenDashboardEditor(v);
  assert.strictEqual(($el("#dashCanvas").innerHTML.match(/class="tileset"/g) || []).length, 1, "one widget's settings, under its bar");
  assert.match($el("#dashPane").innerHTML, /class="palgrid"/, "the pane keeps adding while a widget is open");
  sandbox.matchMedia = mq;
  t.state.dashSel = null; t.state.dashDraft = null;
});

test("live updates (#55): one stream after sign-in, a refresh for a new revision, retries, closed on sign-out", () => {
  const streams = [];
  sandbox.EventSource = class {
    constructor(url) { this.url = url; this.on = {}; this.readyState = 0; streams.push(this); }
    addEventListener(name, fn) { this.on[name] = fn; }
    close() { this.closed = true; this.readyState = 2; }
  };
  const timers = [];
  const realSet = sandbox.setTimeout, realClear = sandbox.clearTimeout;
  sandbox.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  sandbox.clearTimeout = () => {};
  const me = t.state.me, data = t.state.data;
  try {
    t.state.me = null;
    t.liveStart();
    assert.strictEqual(streams.length, 0, "signed out: no stream");
    t.state.me = { id: "usr-x" };
    t.state.data = { rev: "r-5" };
    t.liveStart();
    t.liveStart();
    assert.strictEqual(streams.length, 1, "one stream per page");
    const es = streams[0];
    assert.strictEqual(es.url, "api/events", "relative, so it works under a base path");
    // its own write, or a reconnect with nothing new: nothing to fetch
    assert.strictEqual(t.liveOnChange('{"rev":"r-5"}'), false);
    es.on.ready({ data: '{"rev":"r-5"}' });
    assert.strictEqual(timers.length, 0);
    // a change from elsewhere: one fetch, a moment later
    es.on.change({ data: '{"rev":"r-6"}' });
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].ms, 400);
    assert.strictEqual(t.liveOnChange("not json"), true, "no readable revision: fetch to be safe");
    // the browser retries a dropped stream itself; one it gives up on is retried here, waiting longer each time
    es.readyState = 0;
    es.on.error();
    assert.strictEqual(t.live.es, es, "still the same stream while the browser reconnects");
    es.readyState = 2;
    es.on.error();
    assert.strictEqual(t.live.es, null);
    const retry = timers[timers.length - 1];
    assert.strictEqual(retry.ms, 2000);
    retry.fn();
    assert.strictEqual(streams.length, 2, "reconnected");
    streams[1].readyState = 2;
    streams[1].on.error();
    assert.strictEqual(timers[timers.length - 1].ms, 4000, "the next wait is longer");
    timers[timers.length - 1].fn(); // the second retry
    assert.strictEqual(streams.length, 3);
    streams[2].on.ready({ data: '{"rev":"r-9"}' });
    assert.strictEqual(t.live.wait, 2000, "a working stream resets the wait");
    // the writing page hears of its own write before its own fetch is back (the server announces before
    // it answers): when the timer fires, that fetch has brought the revision in, and nothing is fetched again
    const loads = [];
    const realLoad = sandbox.load;
    sandbox.load = () => { loads.push(1); return Promise.resolve(); };
    try {
      t.state.data = { rev: "r-9" };
      timers.length = 0;
      assert.strictEqual(t.liveOnChange('{"rev":"r-10"}'), true, "behind when the event arrives");
      t.state.data = { rev: "r-10" }; // the page's own load() finished
      assert.strictEqual(t.liveBehind(), false);
      timers[0].fn();
      assert.strictEqual(loads.length, 0, "its own write is not fetched twice");
      // a change from elsewhere: the page is still behind when the timer fires, so it fetches
      // (or waits while a form is open; the test DOM looks busy, so it waits and tries again)
      timers.length = 0;
      t.liveOnChange('{"rev":"r-11"}');
      assert.strictEqual(t.liveBehind(), true);
      timers[0].fn();
      assert.ok(loads.length === 1 || timers.some((x) => x.ms === 1500), "fetches, or waits for the form");
    } finally { sandbox.load = realLoad; }
    // back after a long pause in the background: the stream is opened anew (it may look open but be dead)
    const before = streams.length, old = t.live.es;
    t.liveWake(false);
    assert.strictEqual(streams.length, before, "a short wake keeps a working stream");
    t.liveWake(true);
    assert.strictEqual(streams.length, before + 1, "a stale wake reconnects");
    assert.ok(old.closed, "the old stream is closed");
    // signing out closes the stream
    const last = t.live.es;
    t.liveStop();
    assert.ok(last.closed);
    assert.strictEqual(t.live.es, null);
  } finally {
    t.liveStop();
    sandbox.setTimeout = realSet; sandbox.clearTimeout = realClear;
    delete sandbox.EventSource;
    t.state.me = me; t.state.data = data;
  }
});

test("live updates (#77): the cursor in the search box or a filter does not hold changes back", () => {
  // a focused field in the page; kept: marked data-live-keep (the search box, the filter dropdowns)
  const field = (id, kept) => ({
    id,
    closest: (sel) => (sel === "#view" ? {} : null),
    matches: (sel) => sel === "input,textarea,select,[contenteditable=true]" || (sel === "[data-live-keep]" && kept),
  });
  const dialog = $el("#dialog"), drawer = $el("#drawer");
  const was = { open: dialog.open, hidden: drawer.hidden, data: t.state.data, me: t.state.me, txns: t.state.data.transactions, tags: t.state.data.tags, filter: t.state.filter };
  const timers = [], loads = [];
  const realSet = sandbox.setTimeout, realClear = sandbox.clearTimeout, realLoad = sandbox.load;
  sandbox.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  sandbox.clearTimeout = () => {};
  sandbox.load = () => { loads.push(1); return Promise.resolve(); };
  try {
    dialog.open = false; drawer.hidden = true; // no dialog, no transaction panel
    location.hash = "#transactions";
    docProps.activeElement = null;
    t.render();
    assert.match($el("#view").innerHTML, /<input id="fq" type="search" data-live-keep /);
    assert.match($el("#view").innerHTML, /<select id="faccount" data-live-keep /);
    assert.strictEqual(t.liveBusy(), false, "nothing open, nothing focused");
    docProps.activeElement = field("fq", true);
    assert.strictEqual(t.liveBusy(), false, "the cursor in the search box does not hold a refresh back");
    docProps.activeElement = field("ftag", true);
    assert.strictEqual(t.liveBusy(), false, "nor does a filter dropdown that keeps focus after a choice");
    docProps.activeElement = field("pStart", false);
    assert.strictEqual(t.liveBusy(), true, "any other focused field in the page still waits");
    docProps.activeElement = field("fq", true);
    drawer.hidden = false;
    assert.strictEqual(t.liveBusy(), true, "an open transaction panel still waits");
    drawer.hidden = true;
    // the issue: another page saves a transaction while this one has the cursor in the search box
    t.state.me = { id: "usr-x" };
    t.state.data.rev = "r-1";
    assert.strictEqual(t.liveOnChange('{"rev":"r-2"}'), true);
    timers[timers.length - 1].fn();
    assert.strictEqual(loads.length, 1, "fetched at once, not postponed every 1.5 s");
    assert.ok(!timers.some((x) => x.ms === 1500), "no waiting");
    // load() then renders (render(true)): the results under the search box are redrawn, the search box itself is not
    t.state.data.transactions = [...was.txns, { id: "t9", fromAccountId: "a1", toAccountId: "acc-external", type: "transfer", amountMinor: 8900, currency: "TWD", date: "2026-11-18", state: "posted", note: "Saved elsewhere", tagIds: [] }];
    t.state.data.tags = [{ id: "g7", name: "Pets" }]; // a category added elsewhere
    t.state.filter.tag = ""; // load() cleared a filter on a category removed elsewhere
    $el("#ftag").value = "g-gone";
    $el("#view").innerHTML = "the filter bar on screen";
    t.render(true);
    assert.strictEqual($el("#view").innerHTML, "the filter bar on screen", "the focused field is left alone");
    assert.match($el("#txnResults").innerHTML, /Saved elsewhere/, "the new transaction is listed");
    assert.match($el("#ftag").innerHTML, /<option value="g7" >Pets<\/option>/, "the dropdowns list what was added elsewhere");
    assert.strictEqual($el("#ftag").value, "", "and show the filters in state");
    // any other render (a hash change, Clear) draws the whole screen, also with the search box focused
    t.render({ type: "hashchange" });
    assert.match($el("#view").innerHTML, /id="fq"/);
    // focus elsewhere: a refresh draws the whole screen as before
    $el("#view").innerHTML = "";
    docProps.activeElement = null;
    t.render(true);
    assert.match($el("#view").innerHTML, /id="fq"/);
    // another screen has no such fields: a focused field there waits as before
    location.hash = "#dashboard";
    docProps.activeElement = field("fq", true);
    assert.strictEqual(t.liveBusy(), true);
  } finally {
    t.liveStop();
    sandbox.setTimeout = realSet; sandbox.clearTimeout = realClear; sandbox.load = realLoad;
    delete docProps.activeElement;
    dialog.open = was.open; drawer.hidden = was.hidden;
    was.data.transactions = was.txns; was.data.tags = was.tags; delete was.data.rev;
    t.state.filter = was.filter;
    t.state.data = was.data; t.state.me = was.me; t.state.viewRedraw = null;
    location.hash = "";
  }
});

test("the test runner (#91): a test that never settles fails the run and is named", () => {
  const { spawnSync } = require("child_process");
  const run = (tests) => spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "run-tests.js"))})([${tests}])`], { encoding: "utf8" });
  let r = run(`["first", async () => {}], ["stuck", () => new Promise(() => {})], ["third", async () => {}]`);
  assert.strictEqual(r.status, 1, "a pending test is a failure, not exit code 0");
  assert.match(r.stdout, /ok first/);
  assert.doesNotMatch(r.stdout, /ok third|tests passed/);
  assert.match(r.stderr, /"stuck" never settled, 1 test\(s\) after it did not run/);
  r = run(`["fails", async () => { throw new Error("boom"); }]`);
  assert.strictEqual(r.status, 1, "a rejected test still fails the run");
  assert.match(r.stderr, /boom/);
  assert.doesNotMatch(r.stderr, /never settled/, "a failure is not also reported as stuck");
  r = run(`["one", async () => {}], ["two", () => new Promise((ok) => setTimeout(ok, 5))]`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 tests passed/);
});

// askConfirm is async; these run after the synchronous tests
const later = [];
later.push(["askConfirm: window.confirm() in a browser, the app's native dialog inside the app", async () => {
  const asked = [];
  sandbox.confirm = (text) => { asked.push(text); return asked.length === 1; };
  assert.strictEqual(await t.askConfirm("Delete this?", "Delete"), true, "no bridge: window.confirm says yes");
  assert.strictEqual(await t.askConfirm("Delete this?", "Delete"), false, "no bridge: window.confirm says no");
  assert.deepStrictEqual(asked, ["Delete this?", "Delete this?"]);
  const native = [];
  sandbox.kisiauthongApp = { confirm: (text, ok, cancel) => { native.push([text, ok, cancel]); return Promise.resolve(native.length === 1); } };
  asked.length = 0;
  assert.strictEqual(await t.askConfirm("Revoke this key?", "Revoke"), true);
  assert.strictEqual(await t.askConfirm("Revoke this key?", "Revoke"), false, "Cancel in the native dialog stops the action");
  assert.deepStrictEqual(native[0], ["Revoke this key?", "Revoke", "Cancel"]);
  assert.strictEqual(asked.length, 0, "inside the app window.confirm is not used");
  t.setLang("zh-TW");
  await t.askConfirm("x", "刪除");
  assert.deepStrictEqual(native[2], ["x", "刪除", "取消"], "the buttons in the web UI's language");
  t.setLang("en");
  sandbox.kisiauthongApp = { confirm: () => Promise.reject(new Error("No native dialog on this platform yet.")) };
  sandbox.confirm = (text) => { asked.push(text); return true; };
  assert.strictEqual(await t.askConfirm("Delete?", "Delete"), true, "no native dialog (iOS, Android): falls back to window.confirm");
  assert.deepStrictEqual(asked, ["Delete?"]);
  sandbox.kisiauthongApp = { confirm: () => Promise.resolve("yes") };
  assert.strictEqual(await t.askConfirm("Delete?", "Delete"), false, "only a real true confirms");
  sandbox.kisiauthongApp = { servers: () => Promise.resolve({ active: null, servers: [] }) };
  assert.strictEqual(await t.askConfirm("Delete?", "Delete"), true, "an older bridge without confirm: window.confirm");
  delete sandbox.kisiauthongApp;
  delete sandbox.confirm;
  const bare = read("app.js").match(/(?<![\w.])confirm\(/g) || [];
  assert.strictEqual(bare.length, 1, "every question goes through askConfirm; window.confirm is called only inside it");
}]);
later.push(["Settings → Servers: when the list cannot load, the section and its link are hidden", async () => {
  sandbox.kisiauthongApp = { servers: () => Promise.reject(new Error("Not allowed from this page.")) };
  await t.drawAppServers();
  assert.strictEqual($el("#set-servers").hidden, true);
  assert.strictEqual($el('.snav [data-goto="servers"]').hidden, true);
  delete sandbox.kisiauthongApp;
}]);
later.push(["transactions (#79): a filter the dropdowns cannot show is dropped by a fresh fetch, also from the address", async () => {
  const dialog = $el("#dialog"), drawer = $el("#drawer");
  const was = { data: t.state.data, filter: t.state.filter, period: t.state.period, me: t.state.me, general: t.state.general, dashboard: t.state.dashboard, about: t.state.about, dismissed: t.state.dismissed, open: dialog.open, hidden: drawer.hidden };
  const realApi = sandbox.api, realRender = sandbox.render, realSet = sandbox.setTimeout, realClear = sandbox.clearTimeout;
  const spend = (id, note, date, tagIds) => ({ ...tx(id, "a1", "acc-external", 12000, date, "posted", note), tagIds });
  // the server's books: "g-gone" was merged into g7 elsewhere, g8 was made elsewhere
  const tags = [{ id: "g7", name: "Pets" }, { id: "g8", name: "Garden" }];
  const transactions = [spend("t7", "Bus fare", "2026-11-11", []), spend("t8", "Cat food", "2026-11-10", ["g7"]), spend("t9", "Seeds", "2026-11-09", ["g8"])];
  const books = (tg) => ({ ...was.data, accounts: [acc, other, ext], tags: tg, transactions, rev: "r-9" });
  const held = [], failing = []; // each /api/state answer waits in held until the test gives it
  let settings = { general: {}, about: {}, notifications: {} };
  sandbox.api = (url) => (url === "/api/state" ? new Promise((ok, fail) => { held.push(ok); failing.push(fail); }) : Promise.resolve(settings));
  const timers = []; // timers still set (the live refresh's), fired by the test
  let ids = 0;
  sandbox.setTimeout = (fn, ms) => { timers.push({ fn, ms, id: ++ids }); return ids; };
  sandbox.clearTimeout = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  const tick = () => new Promise((r) => realSet(r, 0));
  sandbox.scrollY = 0; sandbox.scrollTo = () => {}; // liveRefresh keeps the scroll position
  const answer = async (i, tg) => { held[i](books(tg)); await tick(); };
  const shown = () => $el("#txnResults").innerHTML;
  const open = (hash) => { location.hash = hash; t.render({ type: "hashchange" }); };
  // the live refresh the link asked for: fire its timer, answer its fetch
  const refresh = async (tg) => { const n = held.length; const done = timers.pop().fn(); await tick(); held[n](books(tg)); await done; };
  try {
    docProps.activeElement = null; dialog.open = false; drawer.hidden = true; // no form open: a refresh may run
    t.state.me = { id: "usr-x" };
    t.state.period = { mode: "month", start: "2026-11-01", end: "2026-11-30" };
    // a live refresh after the merge, or a reload: the address still has the old id
    location.hash = "#transactions?tag=g-gone&type=expense";
    t.state.filter = { q: "", account: "", type: "", tag: "g-gone" };
    let done = sandbox.load();
    await answer(0, tags); await done;
    assert.strictEqual(t.state.filter.tag, "", "the address does not bring the removed category back");
    assert.strictEqual(t.state.filter.type, "expense", "the other filters stay");
    assert.strictEqual(location.hash, "#transactions?type=expense", "the address drops it too");
    assert.match(shown(), /Bus fare/, "the period's transactions are listed, not an empty filter");
    assert.match(shown(), /Seeds/);
    // a link to a category made elsewhere, opened while this page is behind: kept, and shown after a refresh
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions?tag=g8");
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "an unknown value asks for a refresh");
    assert.match($el("#view").innerHTML, /<option value="g8" selected disabled>Checking…<\/option>/, "meanwhile the dropdown says so, and keeps it");
    await refresh(tags);
    assert.strictEqual(t.state.filter.tag, "g8", "which knows the category");
    assert.strictEqual(location.hash, "#transactions?tag=g8");
    assert.match(shown(), /Seeds/);
    assert.doesNotMatch(shown(), /Bus fare/);
    // a fetch begun before the link was opened (a write, a live refresh) that answers without g8 does not drop it
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions");
    const n = held.length;
    done = sandbox.load(); // under way
    open("#transactions?tag=g8");
    await answer(n, [{ id: "g7", name: "Pets" }]); await done;
    assert.strictEqual(t.state.filter.tag, "g8", "the older answer does not drop what the link names");
    assert.strictEqual(location.hash, "#transactions?tag=g8");
    await refresh(tags);
    assert.match(shown(), /Seeds/);
    // the same with the category dropdown focused: the redraw reads no address, the next refresh decides
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions");
    done = sandbox.load();
    open("#transactions?tag=g8");
    docProps.activeElement = { closest: (sel) => (sel === "#view" ? {} : null), matches: (sel) => sel === "[data-live-keep]" || sel === "input,textarea,select,[contenteditable=true]" };
    await answer(held.length - 1, [{ id: "g7", name: "Pets" }]); await done;
    assert.strictEqual(t.state.filter.tag, "g8");
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "the older answer asks for the next refresh");
    await refresh(tags);
    assert.match(shown(), /Seeds/);
    docProps.activeElement = null;
    // a redraw while the refresh is under way (same address) does not make that refresh too old to decide
    open("#transactions?tag=g-zap");
    const before = held.length;
    done = timers.pop().fn(); await tick();
    t.render({ type: "hashchange" });
    assert.strictEqual(timers.length, 0, "the redraw asks for no other refresh");
    held[before](books(tags)); await done;
    assert.strictEqual(location.hash, "#transactions", "decided by that one fetch");
    assert.strictEqual(timers.length, 0, "with no other");
    assert.strictEqual(held.length, before + 1);
    // a live event announcing the revision already on screen does not cancel the refresh the link asked for
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions?tag=g8");
    assert.strictEqual(t.liveOnChange('{"rev":"' + t.state.data.rev + '"}'), true);
    await refresh(tags);
    assert.match(shown(), /Seeds/);
    // that refresh fails (offline): the next event tries again
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions?tag=g8");
    let n2 = held.length;
    done = timers.pop().fn(); await tick();
    failing[n2](new Error("Failed to fetch")); await done;
    assert.strictEqual(t.live.force, true, "still to do");
    open("#transactions?tag=g8"); // the same link again, or any redraw: asks again
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "opening the link again tries again");
    timers.length = 0;
    sandbox.EventSource = function () { return { addEventListener: () => {}, close: () => {} }; }; // a stream is open
    t.liveWake(false);
    assert.deepStrictEqual(timers, [], "a mere focus does not fetch again");
    t.liveWake(true);
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "coming back to the page after a while tries again");
    delete sandbox.EventSource;
    await refresh(tags);
    assert.match(shown(), /Seeds/);
    assert.strictEqual(t.live.force, false, "done");
    // signed out while it ran (the session ended: 401): nothing is carried over to the next sign-in
    open("#transactions?tag=g-q");
    n2 = held.length;
    done = timers.pop().fn(); await tick();
    t.state.me = null;
    failing[n2](new Error("Unauthorized")); await done;
    assert.strictEqual(t.live.force, false, "signed out");
    t.state.me = { id: "usr-x" };
    // an older answer arriving last is dropped whole: it neither replaces newer books nor drops a known filter
    const nA = held.length;
    const fetchA = sandbox.load(), fetchB = sandbox.load();
    await answer(nA + 1, tags); await fetchB;
    open("#transactions?tag=g8");
    assert.strictEqual(timers.length, 0, "known: nothing to ask");
    await answer(nA, [{ id: "g7", name: "Pets" }]); await fetchA;
    assert.strictEqual(t.state.data.tags.length, 2, "the newer books stay");
    assert.strictEqual(t.state.filter.tag, "g8");
    assert.strictEqual(location.hash, "#transactions?tag=g8");
    // a fetch begun for another reason (a saved form) that settles the value ends the asked-for refresh too
    open("#transactions?tag=g-x");
    assert.strictEqual(t.live.force, true);
    done = sandbox.load(); await answer(held.length - 1, tags); await done;
    assert.strictEqual(t.live.force, false, "nothing left to fetch");
    assert.strictEqual(location.hash, "#transactions");
    const fetches = held.length;
    await timers.pop().fn();
    assert.strictEqual(held.length, fetches, "the refresh's timer then fetches nothing");
    // a link opened while a fetch begun earlier ran: that fetch does not decide, the next one does
    t.state.data.tags = [{ id: "g7", name: "Pets" }];
    open("#transactions");
    done = sandbox.load();
    location.hash = "#transactions?tag=g8"; // the address changes first, its hashchange comes later
    await answer(held.length - 1, [{ id: "g7", name: "Pets" }]); await done;
    assert.strictEqual(location.hash, "#transactions?tag=g8", "not dropped by a fetch older than the link");
    await refresh(tags);
    assert.strictEqual(t.state.filter.tag, "g8");
    assert.match(shown(), /Seeds/);
    // Clear before the refresh answers, then the same link again: it asks again (not "Checking…" for good)
    open("#transactions?tag=g-q2");
    done = timers.pop().fn(); await tick();
    location.hash = "#transactions"; t.state.filter = { q: "", account: "", type: "", tag: "" }; t.render(); // Clear
    await answer(held.length - 1, tags); await done;
    open("#transactions?tag=g-q2");
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "the same link asks again");
    await refresh(tags);
    assert.strictEqual(location.hash, "#transactions");
    // typing a search while the refresh runs changes the address, not its filters: the refresh still decides
    open("#transactions?tag=g-q3");
    done = timers.pop().fn(); await tick();
    location.hash = "#transactions?q=bus&tag=g-q3"; // what writeTxnURL writes after a keystroke
    await answer(held.length - 1, tags); await done;
    assert.strictEqual(location.hash, "#transactions?q=bus", "decided");
    assert.deepStrictEqual(timers, []);
    open("#transactions");
    t.state.filter = { q: "", account: "", type: "", tag: "" };
    // a type that does not exist: no fetch can change the types, so it goes at once
    open("#transactions?type=toString");
    assert.strictEqual(timers.length, 0);
    assert.strictEqual(location.hash, "#transactions");
    // an old or shared link with an unknown account, or a merged-away category: dropped by the refresh
    timers.length = 0;
    open("#transactions?account=acc-elsewhere&type=toString&tag=g-gone");
    assert.match($el("#view").innerHTML, /<option value="acc-elsewhere" selected disabled>Checking…<\/option>/);
    await refresh(tags);
    assert.deepStrictEqual([t.state.filter.account, t.state.filter.type, t.state.filter.tag], ["", "", ""]);
    assert.strictEqual(location.hash, "#transactions");
    assert.match(shown(), /Bus fare/);
    assert.strictEqual(timers.length, 0, "and asks for nothing more");
    // known values, an external account and Uncategorised ask for no refresh
    open("#transactions?account=acc-external&type=expense&tag=g7");
    open("#transactions?tag=none");
    assert.strictEqual(timers.length, 0);
    assert.strictEqual(t.state.filter.tag, "none");
    assert.match(shown(), /Bus fare/, "Uncategorised lists the spending without a category");
    assert.doesNotMatch(shown(), /Cat food/);
    // a refresh with the dropdown focused reads no address: load() alone decides, and it keeps Uncategorised
    sandbox.render = () => {};
    t.state.filter = { q: "", account: "", type: "", tag: "none" };
    done = sandbox.load(); await answer(held.length - 1, tags); await done;
    assert.strictEqual(t.state.filter.tag, "none", "Uncategorised is not a category id, and it stays");
    t.state.filter = { q: "", account: "", type: "", tag: "g-gone" };
    done = sandbox.load(); await answer(held.length - 1, tags); await done;
    assert.strictEqual(t.state.filter.tag, "");
    // settings that answer with nothing: defaults, as before
    settings = null;
    done = sandbox.load(); await answer(held.length - 1, tags); await done;
    assert.match(String($el("#toast").textContent), /Settings unavailable/);
    settings = { general: {}, about: {}, notifications: {} };
    // signed out while a fetch was under way: its answer is not drawn over the sign-in screen
    sandbox.render = realRender;
    done = sandbox.load();
    t.showAuth("login");
    await answer(held.length - 1, tags); await done;
    assert.strictEqual(t.state.data, null);
  } finally {
    t.liveStop();
    sandbox.api = realApi; sandbox.render = realRender; sandbox.setTimeout = realSet; sandbox.clearTimeout = realClear;
    delete sandbox.scrollY; delete sandbox.scrollTo;
    // load() also replaced the settings: put them back for the tests after this one
    Object.assign(t.state, { data: was.data, filter: was.filter, period: was.period, me: was.me, general: was.general, dashboard: was.dashboard, about: was.about, dismissed: was.dismissed });
    dialog.open = was.open; drawer.hidden = was.hidden;
    t.live.rev = "";
    location.hash = "";
    delete docProps.activeElement;
    t.setLang("en");
  }
}]);
later.push(["theme sync (#85): a theme picked while a sync is under way is the one that goes up, not the server's older one", async () => {
  const realApi = sandbox.api, realSet = sandbox.setTimeout, realMsg = sandbox.msg;
  const tick = () => new Promise((r) => realSet(r, 0));
  const store = { "kisiauthong.theme": JSON.stringify({ theme: "default", mode: "system" }), "kisiauthong.themeSync": JSON.stringify({ selected: true, at: "2026-11-24T03:00:00.000Z" }) };
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); }, removeItem: (k) => { delete store[k]; } };
  const server = { themes: [], general: { theme: { selected: "warm" } }, about: {} }, puts = [];
  let release; const gate = new Promise((r) => { release = r; });
  sandbox.api = async (url, opts) => {
    if (opts && opts.method === "PUT") { const b = JSON.parse(opts.body); puts.push(b); if (b.themes) server.themes = b.themes; if (b.general) Object.assign(server.general, b.general); return JSON.parse(JSON.stringify(server)); }
    if (url === "/api/settings") { await gate; return JSON.parse(JSON.stringify(server)); }
    return new Promise(() => {});
  };
  sandbox.msg = () => {};
  try {
    const run = t.syncThemes(); // nothing pending: on its own it would take the server's Warm
    await tick();
    t.pickTheme({ theme: "cool" }); // while the GET is out
    release();
    await run;
    for (let i = 0; i < 10; i++) await tick(); // the second sync the pick asked for
    assert.deepStrictEqual(JSON.parse(store["kisiauthong.theme"]), { theme: "cool", mode: "system" }, "the pick stays");
    assert.deepStrictEqual(server.general.theme, { selected: "cool" }, "and is what the server keeps");
    assert.strictEqual(JSON.parse(store["kisiauthong.themeSync"]).pending, "", "nothing left to send");
  } finally {
    sandbox.api = realApi; sandbox.msg = realMsg;
    sandbox.localStorage = { getItem: () => null, setItem: () => {} };
    t.state.themeSync = {};
  }
}]);
later.push(["theme editor (#85): deleting a theme that is not the selected one keeps the choice; renaming a new copy counts as a change", async () => {
  const realAsk = sandbox.askConfirm, realMsg = sandbox.msg;
  const store = { "kisiauthong.themes": JSON.stringify([fakeTheme("thm-cccccc", "Sand", "2026-11-24T01:00:00.000Z")]), "kisiauthong.theme": JSON.stringify({ theme: "warm", mode: "dark" }) };
  sandbox.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val); }, removeItem: (k) => { delete store[k]; } };
  sandbox.askConfirm = async () => true; sandbox.msg = () => {};
  try {
    await t.deleteCustomTheme({ id: "thm-cccccc", name: "Sand", basedOn: "cool" });
    assert.deepStrictEqual(JSON.parse(store["kisiauthong.themes"]), []);
    assert.deepStrictEqual(JSON.parse(store["kisiauthong.theme"]), { theme: "warm", mode: "dark" }, "Warm stays chosen");
    // a new copy (duplicated from a custom theme, so no stylesheet is read here)
    store["kisiauthong.themes"] = JSON.stringify([fakeTheme("thm-cccccc", "Sand", "2026-11-24T01:00:00.000Z")]);
    store["kisiauthong.theme"] = JSON.stringify({ theme: "thm-cccccc", mode: "dark" });
    t.duplicateTheme();
    const d = t.state.themeDraft;
    assert.strictEqual(d.name, "Sand (copy)");
    assert.strictEqual(t.draftDirty(d), false, "an untouched copy can be left without asking");
    d.name = "Mine";
    assert.strictEqual(t.draftDirty(d), true, "a renamed one asks first");
    d.name = "Sand (copy)"; d.split = true; d.dark = Object.assign({}, d.light);
    assert.strictEqual(t.draftDirty(d), true, "so does turning the split on");
  } finally {
    sandbox.askConfirm = realAsk; sandbox.msg = realMsg;
    sandbox.localStorage = { getItem: () => null, setItem: () => {} };
    t.state.themeDraft = null; location.hash = "";
  }
}]);
later.push(["settings (#87): a setting saved while a fetch runs is not put back by that fetch's answer", async () => {
  const was = { data: t.state.data, me: t.state.me, general: t.state.general, dashboard: t.state.dashboard, about: t.state.about, dismissed: t.state.dismissed, customizing: t.state.customizing };
  const realApi = sandbox.api, realSet = sandbox.setTimeout, realClear = sandbox.clearTimeout;
  const tick = () => new Promise((r) => realSet(r, 0));
  const timers = []; // the live refresh's timers, kept here, not fired
  sandbox.setTimeout = (fn, ms) => timers.push({ fn, ms });
  sandbox.clearTimeout = () => {};
  // the server: a fetch's settings are the ones saved when the server reads them, and its answer waits in
  // held until the test gives it
  const copy = (o) => JSON.parse(JSON.stringify(o));
  let saved = { dashboard: null, general: { language: "en" }, about: {}, notifications: { dismissed: [] } };
  const held = [];
  const books = () => ({ ...was.data, accounts: [acc, other, ext], rev: "r-87" });
  sandbox.api = (url, opts) => {
    if (url === "/api/state") return Promise.resolve(books());
    if (opts && opts.method === "PUT") {
      const b = JSON.parse(opts.body);
      saved = { ...saved, ...b, general: { ...saved.general, ...(b.general || {}) } };
      return Promise.resolve(copy(saved));
    }
    const read = copy(saved);
    return new Promise((ok) => held.push(() => ok(read)));
  };
  // a fetch begins (a write, a live refresh) and the server reads the settings, which have not been saved yet
  const begin = async () => { const done = sandbox.load(); await tick(); return { done }; };
  const on = {}; // the listeners the screens add, by element
  ["#setLang", "#dashSave"].forEach((sel) => { $el(sel).addEventListener = (ev, fn) => { on[sel] = fn; }; });
  try {
    t.state.me = { id: "usr-x" };
    location.hash = "#settings";
    t.render();
    let { done } = await begin();
    await on["#setLang"]({ target: { value: "zh-TW" } });
    assert.strictEqual(t.state.general.language, "zh-TW");
    held.pop()(); await done;
    assert.strictEqual(t.state.general.language, "zh-TW", "the language saved stays");
    assert.strictEqual(vm.runInContext("LANG", sandbox), "zh-TW", "and so does the UI language");
    assert.deepStrictEqual(t.state.data.rev, "r-87", "the fetch's books are drawn");
    assert.ok(timers.some((x) => x.ms === 400) && t.live.force, "and a fresh fetch follows, for settings changed elsewhere");
    timers.length = 0; t.live.force = false;
    // a fetch begun after the save brings the saved settings, and later changes from elsewhere
    saved.general = { ...saved.general, numberFormat: "space" };
    ({ done } = await begin()); held.pop()(); await done;
    assert.strictEqual(t.state.general.numberFormat, "space", "a later fetch applies its settings");
    // Customize dashboard: saved while a fetch runs
    const layout = JSON.parse(JSON.stringify(t.DASH_DEFAULT));
    const DASH0 = { items: [] };
    ({ done } = await begin());
    t.state.customizing = true; t.state.dashDraft = JSON.parse(JSON.stringify(layout)); t.state.dashSel = null;
    location.hash = "#dashboard";
    t.screenDashboardEditor({ innerHTML: "", querySelector: () => element(), querySelectorAll: listStub });
    t.state.dashDraft.items.splice(0, 1); // a widget removed in the editor
    await on["#dashSave"]();
    assert.strictEqual(t.state.customizing, false);
    held.pop()(); await done;
    assert.strictEqual((t.state.dashboard || DASH0).items.length, layout.items.length - 1, "the saved dashboard stays");
    // a notification dismissed while a fetch runs (the list is shown at once, before the save answers)
    ({ done } = await begin());
    await sandbox.saveDismissed(["note-87"]);
    held.pop()(); await done;
    assert.ok(t.state.dismissed.includes("note-87"), "the dismissed notification stays dismissed");
    // and one answering between the dismissal and its save's answer
    let release;
    const realPut = sandbox.api;
    sandbox.api = (url, opts) => (opts && opts.method === "PUT" ? new Promise((ok) => { release = () => ok(realPut(url, opts)); }) : realPut(url, opts));
    ({ done } = await begin());
    const saving = sandbox.saveDismissed(["note-88"]);
    held.pop()(); await done;
    assert.ok(t.state.dismissed.includes("note-88"), "shown dismissed while it saves");
    release(); await saving;
    assert.ok(t.state.dismissed.includes("note-88"));
    // a fetch begun after the dismissal, read by the server before the save, answering after the save
    const saving2 = sandbox.saveDismissed(["note-89"]);
    ({ done } = await begin());
    release(); await saving2;
    held.pop()(); await done;
    assert.ok(t.state.dismissed.includes("note-89"), "still dismissed after the older answer");
  } finally {
    t.liveStop();
    sandbox.api = realApi; sandbox.setTimeout = realSet; sandbox.clearTimeout = realClear;
    ["#setLang", "#dashSave"].forEach((sel) => { delete $el(sel).addEventListener; });
    Object.assign(t.state, was, { dashDraft: null, dashSel: null });
    location.hash = "";
    t.setLang("en");
  }
}]);
later.push(["live refresh (#88): the scroll position is put back only on the screen it was taken on, by its own answer", async () => {
  const was = { data: t.state.data, me: t.state.me, general: t.state.general, dashboard: t.state.dashboard, about: t.state.about, dismissed: t.state.dismissed };
  const dialog = $el("#dialog"), drawer = $el("#drawer"), wasUI = { open: dialog.open, hidden: drawer.hidden };
  const realApi = sandbox.api, realSet = sandbox.setTimeout;
  const tick = () => new Promise((r) => realSet(r, 0));
  const held = [];
  const settings = { dashboard: was.dashboard, general: was.general || {}, about: was.about || {}, notifications: { dismissed: [] } };
  sandbox.api = (url) => (url === "/api/state" ? new Promise((ok) => held.push(ok)) : Promise.resolve(settings));
  const books = (rev) => ({ ...was.data, accounts: [acc, other, ext], rev });
  const scrolls = [];
  sandbox.scrollY = 640; sandbox.scrollTo = (x, y) => { scrolls.push(y); };
  const open = (hash) => { location.hash = hash; t.render({ type: "hashchange" }); };
  // a live event announced a newer revision: the refresh begins on the screen on view
  const begin = (rev) => { t.state.data.rev = "r-old"; t.live.rev = rev; return t.liveRefresh(); };
  try {
    docProps.activeElement = null; dialog.open = false; drawer.hidden = true;
    t.state.me = { id: "usr-x" };
    t.state.data = { ...books("r-old") };
    // on the same screen: the position is kept
    open("#accounts");
    let done = begin("r-1"); await tick();
    held.pop()(books("r-1")); await done;
    assert.deepStrictEqual(scrolls, [640], "same screen: scrolled back");
    // another screen opened while the refresh ran (deleting a reserve opens Reserves): not scrolled
    scrolls.length = 0;
    open("#accounts");
    done = begin("r-2"); await tick();
    open("#reserves");
    held.pop()(books("r-2")); await done;
    assert.deepStrictEqual(scrolls, [], "the new screen keeps its own position");
    // one account's page to another's: another screen too
    open(`#acct?id=a1&range=month`);
    done = begin("r-3"); await tick();
    open(`#acct?id=a2&range=month`);
    held.pop()(books("r-3")); await done;
    assert.deepStrictEqual(scrolls, []);
    // the same page with another period: the same screen
    open(`#acct?id=a1&range=month`);
    done = begin("r-4"); await tick();
    open(`#acct?id=a1&range=year`);
    held.pop()(books("r-4")); await done;
    assert.deepStrictEqual(scrolls, [640]);
    // the refresh's answer is older than one drawn meanwhile (a write's own fetch): nothing of it is drawn,
    // so the position is not put back either
    scrolls.length = 0;
    open("#accounts");
    done = begin("r-5"); await tick();
    const n = held.length, write = sandbox.load();
    held[n](books("r-6")); await write;
    held[n - 1](books("r-5")); await done;
    assert.strictEqual(t.state.data.rev, "r-6", "the newer books stay");
    assert.deepStrictEqual(scrolls, [], "not scrolled by an answer that was dropped");
  } finally {
    t.liveStop();
    sandbox.api = realApi;
    delete sandbox.scrollY; delete sandbox.scrollTo;
    Object.assign(t.state, was);
    dialog.open = wasUI.open; drawer.hidden = wasUI.hidden;
    location.hash = "";
    delete docProps.activeElement;
    t.setLang("en");
  }
}]);
require("./run-tests.js")(later, n);
