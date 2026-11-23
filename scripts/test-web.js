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
vm.runInContext(read("app.js") + "\nthis.__t = { state, accountCard, feedRow, screenAcct, screenTransactions, bindDetails, currentScreen, render, setLang, verHTML, verAboutRows, screenTags, screenSettings, appServerRows, askConfirm, drawAppServers, showAuth, showCodeStep, dashTile, dashPaneHTML, tileMeta, screenDashboardEditor, DASH_DEFAULT, screenTag, openAccountDialog, openTagDialog, categoryCard, periodFor, notePanel, live, liveStart, liveStop, liveOnChange, liveRefresh, liveWake, liveBehind, liveBusy, tagNet, netHTML, budgetEnded, widgetBody, screenTags, moneyBlock, moneyTile, curOrder, fmtNum, fmt, dayNet };", sandbox, { filename: "app.js" });
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
  sandbox.api = (url) => (url === "/api/state" ? new Promise((ok, fail) => { held.push(ok); failing.push(fail); }) : Promise.resolve({ general: {}, about: {}, notifications: {} }));
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
    assert.match($el("#view").innerHTML, /<option value="g8" selected>Checking…<\/option>/, "meanwhile the dropdown says so, and keeps it");
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
    t.liveWake(false);
    assert.deepStrictEqual(timers.map((x) => x.ms), [400], "coming back to the page tries again");
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
    // a type that does not exist: no fetch can change the types, so it goes at once
    open("#transactions?type=toString");
    assert.strictEqual(timers.length, 0);
    assert.strictEqual(location.hash, "#transactions");
    // an old or shared link with an unknown account, or a merged-away category: dropped by the refresh
    timers.length = 0;
    open("#transactions?account=acc-elsewhere&type=toString&tag=g-gone");
    assert.match($el("#view").innerHTML, /<option value="acc-elsewhere" selected>Checking…<\/option>/);
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
(async () => {
  for (const [name, fn] of later) { await fn(); n++; console.log("ok", name); }
  console.log(`${n} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
