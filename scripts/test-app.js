// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Checks for the Tauri apps' bundled server screen (apps/tauri/src, ADR 0019)
// that need no GUI and no network: address normalisation, the http:// rule,
// reading the server's answer, both languages, and that the screen's colours
// still match web/style.css. Usage: node scripts/test-app.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = path.join(root, "apps", "tauri", "src");
const C = require(path.join(app, "connect.js"));
const STRINGS = require(path.join(app, "strings.js"));

let n = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("normalizeServerUrl: trims, adds https://, keeps the base path, ends with a slash", () => {
  const ok = (input, url) => assert.deepStrictEqual(C.normalizeServerUrl(input), { ok: true, url }, input);
  ok("  books.example.org  ", "https://books.example.org/");
  ok("books.example.org/kisiauthong", "https://books.example.org/kisiauthong/");
  ok("https://books.example.org/kisiauthong/", "https://books.example.org/kisiauthong/");
  ok("HTTPS://Books.Example.ORG/KiSiauThong", "https://books.example.org/KiSiauThong/");
  ok("http://192.168.1.20:8080", "http://192.168.1.20:8080/");
  ok("localhost:8080", "https://localhost:8080/");
  ok("100.64.0.12:9700/kst", "https://100.64.0.12:9700/kst/");
  ok("https://books.example.org/kisiauthong/#settings", "https://books.example.org/kisiauthong/");
  ok("https://books.example.org/kisiauthong/?x=1", "https://books.example.org/kisiauthong/");
  ok("https://books.example.org/kisiauthong/index.html", "https://books.example.org/kisiauthong/");
  ok("https://[fd7a:115c:a1e0::1]:8080", "https://[fd7a:115c:a1e0::1]:8080/");
  const bad = (input, error) => assert.deepStrictEqual(C.normalizeServerUrl(input), { ok: false, error }, input);
  bad("", "empty");
  bad("   ", "empty");
  bad(null, "empty");
  bad("ftp://books.example.org/", "scheme");
  bad("mailto:me@example.org", "scheme");
  bad("javascript:alert(1)", "scheme");
  bad("https://me:secret@books.example.org/", "credentials");
  bad("https://", "invalid");
  bad("http://exa mple.org/", "invalid");
});

test("statusUrl is relative to the base path", () => {
  assert.strictEqual(C.statusUrl("https://books.example.org/kisiauthong/"), "https://books.example.org/kisiauthong/api/auth/status");
});

test("cleartextAllowed: https always; http only on the own network (cases shared with the Rust shell)", () => {
  const cases = JSON.parse(fs.readFileSync(path.join(root, "apps", "tauri", "test", "cleartext-cases.json"), "utf8"));
  assert.ok(cases.allowed.length > 10 && cases.blocked.length > 5);
  for (const u of cases.allowed) assert.strictEqual(C.cleartextAllowed(u), true, u);
  for (const u of cases.blocked) assert.strictEqual(C.cleartextAllowed(u), false, u);
});

const base = "https://books.example.org/kisiauthong/";
const answer = (o) => Object.assign({ status: 200, finalUrl: base + "api/auth/status", contentType: "application/json", body: '{"needsSetup":false,"user":null}' }, o);

test("classifyProbe: a KiSiauThong server answers 200 JSON with a boolean needsSetup", () => {
  assert.deepStrictEqual(C.classifyProbe(base, answer()), { ok: true, url: base });
  assert.deepStrictEqual(C.classifyProbe(base, answer({ body: '{"needsSetup":true}' })), { ok: true, url: base });
});

test("classifyProbe: four distinct failures, each with the address tried", () => {
  const kind = (p) => C.classifyProbe(base, p);
  assert.deepStrictEqual(kind({ error: "connect", detail: "Connection refused" }), { ok: false, kind: "unreachable", url: base });
  assert.deepStrictEqual(kind({ error: "timeout" }), { ok: false, kind: "unreachable", url: base });
  assert.deepStrictEqual(kind({ error: "other" }), { ok: false, kind: "unreachable", url: base });
  assert.deepStrictEqual(kind(null), { ok: false, kind: "unreachable", url: base });
  assert.deepStrictEqual(kind({ error: "tls", detail: "The certificate was not trusted." }), { ok: false, kind: "certificate", url: base });
  for (const p of [answer({ status: 404, body: "404 page not found" }), answer({ body: "<!doctype html><title>Router</title>" }),
    answer({ body: '{"status":"ok"}' }), answer({ body: '{"needsSetup":"yes"}' }), answer({ body: "null" }), answer({ status: 302, body: "" }),
    answer({ status: 500, body: '{"needsSetup":false}' })])
    assert.deepStrictEqual(kind(p), { ok: false, kind: "notServer", url: base }, JSON.stringify(p));
});

test("classifyProbe: a redirect moves the saved address, and the http:// rule applies to it", () => {
  const httpBase = "http://192.168.1.20/kisiauthong/";
  assert.deepStrictEqual(C.classifyProbe(httpBase, answer({ finalUrl: "https://books.example.org/kisiauthong/api/auth/status" })), { ok: true, url: base });
  assert.deepStrictEqual(C.classifyProbe(base, answer({ finalUrl: "http://books.example.org/kisiauthong/api/auth/status" })),
    { ok: false, kind: "cleartext", url: "http://books.example.org/kisiauthong/" });
  assert.deepStrictEqual(C.classifyProbe(base, answer({ finalUrl: "https://books.example.org/login?next=x" })), { ok: true, url: base }, "an unrelated final address keeps the typed one");
});

test("checkServer: the whole flow with a stand-in probe", async () => {
  const asked = [];
  const probe = (r) => (u) => { asked.push(u); return Promise.resolve(r); };
  assert.deepStrictEqual(await C.checkServer("books.example.org/kisiauthong", probe(answer())), { ok: true, url: base });
  assert.strictEqual(asked.pop(), base + "api/auth/status");
  assert.deepStrictEqual(await C.checkServer("", probe(answer())), { ok: false, kind: "invalid", error: "empty", url: "" });
  assert.deepStrictEqual(await C.checkServer("http://books.example.org/", probe(answer())), { ok: false, kind: "cleartext", url: "http://books.example.org/" });
  assert.strictEqual(asked.length, 0, "no request for a blocked or invalid address");
  assert.deepStrictEqual(await C.checkServer("https://books.example.org/", () => Promise.reject(new Error("ipc failed"))),
    { ok: false, kind: "unreachable", url: "https://books.example.org/" });
});

test("pickLang matches the web UI's choice", () => {
  assert.strictEqual(C.pickLang(["zh-Hant-TW"]), "zh-TW");
  assert.strictEqual(C.pickLang(["zh_TW"]), "zh-TW");
  assert.strictEqual(C.pickLang(["zh-TW", "en"]), "zh-TW");
  assert.strictEqual(C.pickLang(["en-GB"]), "en");
  assert.strictEqual(C.pickLang(["fr-FR", "zh-Hant"]), "zh-TW");
  assert.strictEqual(C.pickLang(["ja-JP"]), "en");
  assert.strictEqual(C.pickLang([]), "en");
});

test("strings: both languages have the same keys and {url} placeholders, and every error kind has text", () => {
  const en = STRINGS.en, zh = STRINGS["zh-TW"];
  assert.deepStrictEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    assert.ok(en[k] && zh[k], k);
    assert.strictEqual((zh[k].match(/\{url\}/g) || []).length, (en[k].match(/\{url\}/g) || []).length, k);
  }
  for (const kind of ["invalid", "unreachable", "notServer", "cleartext", "certificate", "save"])
    assert.ok(en[kind + "Title"] && en[kind + "Text"], kind);
  const js = fs.readFileSync(path.join(app, "first-run.js"), "utf8");
  for (const m of js.matchAll(/\bS\.([a-zA-Z]+)/g)) assert.ok(m[1] in en, `first-run.js uses S.${m[1]}`);
});

test("the screen's colour tokens match web/style.css", () => {
  const rootLine = (f) => fs.readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(":root{--page-max"));
  assert.strictEqual(rootLine(path.join(app, "style.css")), rootLine(path.join(root, "web", "style.css")));
  assert.ok(fs.readFileSync(path.join(app, "icon-512.png")).equals(fs.readFileSync(path.join(root, "web", "icon-512.png"))), "icon-512.png is web/icon-512.png");
});

test("the bridge script is plain, valid JavaScript", () => {
  const src = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "src", "bridge.js"), "utf8");
  new Function(src); // throws on a syntax error
  for (const cmd of ["servers", "use_server", "remove_server", "open_server_form", "open_external", "confirm"]) {
    assert.ok(src.includes(`"${cmd}"`), cmd);
    assert.ok(fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "permissions", "app.toml"), "utf8").includes(`allow-${cmd.replace(/_/g, "-")}`), `bridge permission for ${cmd}`);
  }
});

test("the bridge passes confirm() to the shell's native dialog", async () => {
  const src = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "src", "bridge.js"), "utf8");
  const calls = [];
  const win = { __TAURI_INTERNALS__: { invoke: (cmd, args) => { calls.push([cmd, args]); return Promise.resolve(true); } } };
  win.top = win;
  const doc = { addEventListener: () => {} };
  new Function("window", "document", "location", src)(win, doc, { href: "https://books.example.org/" });
  assert.strictEqual(await win.kisiauthongApp.confirm("Delete this transaction?", "Delete", "Cancel"), true);
  assert.deepStrictEqual(calls.pop(), ["confirm", { message: "Delete this transaction?", ok: "Delete", cancel: "Cancel" }]);
  await win.kisiauthongApp.confirm("Sure?");
  assert.deepStrictEqual(calls.pop(), ["confirm", { message: "Sure?", ok: null, cancel: null }], "no labels: the system's OK and Cancel");
  const frame = { top: {}, __TAURI_INTERNALS__: win.__TAURI_INTERNALS__ };
  new Function("window", "document", "location", src)(frame, doc, {});
  assert.strictEqual(frame.kisiauthongApp, undefined, "not in frames");
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log("ok", name); }
  console.log(`${n} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
