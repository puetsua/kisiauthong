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
const document = new Proxy({}, { get: (t, k) => (k === "querySelectorAll" ? listStub : k === "querySelector" ? $el : stub()) });
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
vm.runInContext(read("app.js") + "\nthis.__t = { state, accountCard, feedRow, screenAcct, screenTransactions, bindDetails, currentScreen, render, setLang, verHTML, verAboutRows, screenTags, screenSettings, appServerRows };", sandbox, { filename: "app.js" });
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
  assert.match(rows, /data-srv-use="b">Switch<.*data-srv-edit="b">Edit<.*data-srv-del="b">Remove</s);
  assert.match(rows, /<span class="sl">100.64.0.12:9700<\/span>/, "no name: the host");
  assert.match(rows, /&lt;b&gt;NAS&lt;\/b&gt;/, "names are escaped");
  assert.match(rows, /<button type="button" class="ghostbtn" data-srv-add>Add server<\/button><\/div><\/div>$/);
  t.setLang("zh-TW");
  assert.match(t.appServerRows({ active: "a", servers: [{ id: "a", name: "家裡", url: "https://x.example/" }, { id: "b", url: "https://y.example/" }] }), /使用中.*切換.*編輯.*移除.*新增伺服器/s);
  t.setLang("en");
  t.state.general = null;
});
console.log(`${n} tests passed`);
