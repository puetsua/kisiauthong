// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Checks the number formats of Settings → Number format against the real
// writeInt() / fmt() / plainAmounts() and the transaction search in
// web/app.js, run in a sandbox with a stubbed DOM.
// Usage: node scripts/check-numfmt.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "web");
const read = (f) => fs.readFileSync(path.join(web, f), "utf8");

// just enough of a browser for the top of app.js (the formatter and the hide-amounts setup)
const el = () => ({ addEventListener() {}, setAttribute() {}, removeAttribute() {}, classList: { toggle() {}, add() {}, remove() {} } });
const sandbox = {
  navigator: { languages: ["en"] },
  document: { documentElement: { classList: { toggle() {} }, dataset: {} }, body: {}, querySelector: el, querySelectorAll: () => [] },
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  MutationObserver: class { observe() {} },
  Intl, console,
};
vm.createContext(sandbox);
vm.runInContext(read("i18n.js"), sandbox);
const app = read("app.js");
const cut = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`app.js changed: cannot find ${JSON.stringify(a < 0 ? from : to)}`);
  return app.slice(a, b);
};
vm.runInContext(cut('"use strict";', "// msg shows a short toast"), sandbox);
// the search, with the transaction helpers it calls stubbed to empty labels
vm.runInContext(`const TYPE_L = {}, byNewest = () => 0, lbl = () => "", flow = () => "expense", txnSubtitle = () => "", txnCats = () => [];\n`
  + cut("function filteredTxns()", "// The search and filters live in the address"), sandbox);
const run = (code) => vm.runInContext(code, sandbox);

let bad = 0;
const eq = (what, got, want) => {
  if (got !== want) { bad++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const NBSP = " ";
const setFormat = (f) => run(`state.general = { numberFormat: ${JSON.stringify(f)}, defaultCurrency: "TWD" }`);
const show = (minor, cur) => run(`plainAmounts(fmt(${minor}, ${JSON.stringify(cur)}))`);

eq("FOUR_SEP", run("FOUR_SEP"), NBSP);
const cases = {
  //          writeInt(n)
  four: [[0, "0"], [9999, "9999"], [10000, `1${NBSP}0000`], [35000, `3${NBSP}5000`], [99999, `9${NBSP}9999`],
    [1234567, `123${NBSP}4567`], [1074958, `107${NBSP}4958`], [12345678, `1234${NBSP}5678`], [123456789, `1${NBSP}2345${NBSP}6789`]],
  grouped: [[9999, "9,999"], [35000, "35,000"], [1234567, "1,234,567"], [12345678, "12,345,678"]],
  plain: [[9999, "9999"], [35000, "35000"], [1234567, "1234567"], [12345678, "12345678"]],
};
for (const [f, list] of Object.entries(cases)) {
  setFormat(f);
  for (const [n, want] of list) eq(`${f} writeInt(${n})`, run(`writeInt(${n})`), want);
}

setFormat("four");
eq("four TWD 35,000", show(3500000, "TWD"), `TWD 3${NBSP}5000`);
eq("four USD 12,345.50", show(1234550, "USD"), `USD 1${NBSP}2345.50`);
eq("four USD 12.50", show(1250, "USD"), "USD 12.50");
eq("four negative", show(-3500000, "TWD"), `TWD -3${NBSP}5000`);
eq("four JPY", show(12345678, "JPY"), `JPY 1234${NBSP}5678`);
// hide amounts: the sign stays outside and the whole grouped number is one marked run (one .amtmask span)
eq("four marked run", run(`[...fmt(-3500000, "TWD").matchAll(AMT_RE)].map((m) => m[1]).join("|")`), `3${NBSP}5000`);
eq("four marked prefix", run(`fmt(-3500000, "TWD").split(AMT_OPEN)[0]`), "TWD -");
setFormat("grouped");
eq("grouped USD 12,345.50", show(1234550, "USD"), "USD 12,345.50");
eq("grouped negative", show(-3500000, "TWD"), "TWD -35,000");
setFormat("plain");
eq("plain USD 12,345.50", show(1234550, "USD"), "USD 12345.50");

// labels show the separator the formatter writes, in English and Traditional Chinese
eq("label en", run("NUMFMT_L.four"), `Groups of four (107${NBSP}4958)`);
eq("label zh-TW", run(`I18N["zh-TW"][NUMFMT_L.four]`), `四位一組（107${NBSP}4958）`);

// search: a typed regular space (or the no-break one) finds the amount; behaviour of the other formats is unchanged
run(`state.data = { transactions: [{ id: "a", note: "Rent", memo: "", amountMinor: 3500000, currency: "TWD" }, { id: "b", note: "Tea", memo: "", amountMinor: 12000, currency: "TWD" }] }`);
const search = (f, q, hidden = false) => {
  setFormat(f);
  return run(`amountsHidden = ${hidden}; state.filter = { q: ${JSON.stringify(q)}, account: "", type: "", tag: "" }; filteredTxns().map((t) => t.id).join(",")`);
};
eq("search four space", search("four", "3 5000"), "a");
eq("search four nbsp", search("four", `3${NBSP}5000`), "a");
eq("search four narrow nbsp", search("four", "3 5000"), "a");
eq("search four with currency", search("four", "twd 3 5000"), "a");
eq("search four hidden", search("four", "3 5000", true), "");
eq("search four note", search("four", "rent"), "a");
eq("search grouped", search("grouped", "35,000"), "a");
eq("search plain", search("plain", "35000"), "a");

if (bad) { console.log(`${bad} number format check(s) failed`); process.exit(1); }
console.log("number formats: all checks passed");
