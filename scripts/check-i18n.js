// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Checks that every English source string used by the web UI has a
// translation in each shipped language, and lists unused translations.
// Usage: node scripts/check-i18n.js [--list]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "web");
const read = (f) => fs.readFileSync(path.join(web, f), "utf8");
const str = String.raw`"((?:[^"\\]|\\.)*)"`;

function sourceStrings() {
  const js = read("app.js"), html = read("index.html");
  const keys = new Set();
  const add = (re, text) => { for (const m of text.matchAll(re)) keys.add(JSON.parse(`"${m[1]}"`)); };
  add(new RegExp(String.raw`\b(?:__|N_)\(\s*` + str, "g"), js);          // __("…"), N_("…")
  add(new RegExp(String.raw`\b[tl]:\s*` + str, "g"), js);                // table header / cell labels
  add(new RegExp(String.raw`\bfield\(\s*` + str, "g"), js);              // field("Label", …)
  add(new RegExp(String.raw`\[\s*"([A-Z][^"]*)",\s*(?!")`, "g"), js);    // detailTable pairs ["Label", value]
  add(/data-i18n(?:-aria|-title|-placeholder)?="([^"]*)"/g, html);
  return keys;
}

function dictionaries() {
  const sandbox = { navigator: { languages: ["en"] }, document: { documentElement: {}, querySelectorAll: () => [] } };
  vm.createContext(sandbox);
  vm.runInContext(read("i18n.js") + "\nthis.__out = { I18N, LANGS };", sandbox);
  return sandbox.__out;
}

const keys = sourceStrings();
const { I18N, LANGS } = dictionaries();
if (process.argv.includes("--list")) { console.log([...keys].sort().join("\n")); process.exit(0); }
let bad = 0;
for (const lang of Object.keys(LANGS).filter((l) => l !== "en")) {
  const dict = I18N[lang] || {};
  const missing = [...keys].filter((k) => !(k in dict));
  const unused = Object.keys(dict).filter((k) => !keys.has(k));
  for (const k of missing) console.log(`${lang}: missing translation: ${JSON.stringify(k)}`);
  for (const k of unused) console.log(`${lang}: unused translation: ${JSON.stringify(k)}`);
  bad += missing.length + unused.length;
  console.log(`${lang}: ${keys.size - missing.length}/${keys.size} strings translated`);
}
process.exit(bad ? 1 : 0);
