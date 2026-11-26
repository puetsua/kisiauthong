// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Checks for the Tauri apps' bundled server screen (apps/tauri/src, ADR 0019)
// that need no GUI and no network: address normalisation, the http:// rule,
// reading the server's answer, both languages, that the screen's colours
// still match web/style.css, and the Android launcher icon's layers.
// Usage: node scripts/test-app.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = path.join(root, "apps", "tauri", "src");
const C = require(path.join(app, "connect.js"));
const STRINGS = require(path.join(app, "strings.js"));

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
  for (const f of ["first-run.js", "update.js", "frame.js"]) {
    const js = fs.readFileSync(path.join(app, f), "utf8");
    for (const m of js.matchAll(/\bS\.([a-zA-Z]+)/g)) assert.ok(m[1] in en, `${f} uses S.${m[1]}`);
  }
  for (const k of Object.keys(en)) {
    const ph = (t) => (t.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.strictEqual(ph(zh[k]), ph(en[k]), `placeholders of ${k}`);
  }
});

test("serverToOpen: the server in use, else the last used, and none only when nothing is saved (issue #126)", () => {
  const home = { id: "a", url: base, lastUsed: "2026-11-20T08:00:00Z" };
  const nas = { id: "b", url: "http://192.168.1.20:8080/", lastUsed: "2026-11-21T08:00:00Z" };
  const fresh = { id: "c", url: "https://other.example.org/" };
  assert.strictEqual(C.serverToOpen({ active: "a", servers: [home, nas] }), home);
  assert.strictEqual(C.serverToOpen({ active: null, servers: [home, nas, fresh] }), nas);
  assert.strictEqual(C.serverToOpen({ active: "gone", servers: [fresh, home] }), home);
  assert.strictEqual(C.serverToOpen({ active: null, servers: [fresh] }), fresh);
  assert.strictEqual(C.serverToOpen({ active: null, servers: [] }), null);
  assert.strictEqual(C.serverToOpen({}), null);
});

// The bundled server screen (index.html + first-run.js) in a stand-in DOM: the
// elements and their `hidden` as index.html starts them, and the shell's
// commands answered by `answer(cmd, args)`. Returns what a test looks at.
function openScreen(search, answer) {
  const html = fs.readFileSync(path.join(app, "index.html"), "utf8");
  const els = {};
  const element = (id) => {
    const e = {
      id, hidden: false, disabled: false, readOnly: false, value: "", className: "", attrs: {}, on: {}, focused: false,
      _text: "",
      get textContent() { return this._text; },
      set textContent(t) { this._text = String(t); },
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      append(...xs) { for (const x of xs) this._text += typeof x === "string" ? x : x.textContent; },
      addEventListener(type, fn) { this.on[type] = fn; },
      focus() { for (const o of Object.values(els)) o.focused = false; this.focused = true; },
    };
    return e;
  };
  for (const m of html.matchAll(/<\w+\b([^>]*)>/g)) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
    if (!id) continue;
    els[id] = element(id);
    els[id].hidden = /\shidden(?=[\s>]|$)/.test(m[1]);
  }
  const calls = [];
  const win = {
    KstConnect: C,
    KstStrings: STRINGS,
    __TAURI_INTERNALS__: { invoke: (cmd, args) => { calls.push([cmd, args]); return answer(cmd, args); } },
  };
  const doc = {
    getElementById: (id) => { assert.ok(els[id], `index.html has #${id}`); return els[id]; },
    createElement: () => element(""),
    documentElement: {},
  };
  const src = fs.readFileSync(path.join(app, "first-run.js"), "utf8");
  new Function("window", "document", "location", "navigator", "URL", "URLSearchParams", src)(
    win, doc, { search: search }, { languages: ["en-US"] }, URL, URLSearchParams);
  const visible = (id) => !!els[id] && !els[id].hidden;
  const view = () => ["form", "open", "upd"].filter(visible);
  return { els, calls, view, visible, cmds: () => calls.map((c) => c[0]) };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const saved = { locale: "en-US", active: "a", servers: [{ id: "a", name: "Home", url: base, lastUsed: "2026-11-20T08:00:00Z" }] };
// a KiSiauThong server's answer to the probe of `url`
const reachable = (url) => ({ status: 200, finalUrl: url, contentType: "application/json", body: '{"needsSetup":false,"user":null}' });

test("launch with a saved server: no server form; the server is checked and opened (issue #126)", async () => {
  const s = openScreen("", (cmd, args) => cmd === "app_state" ? Promise.resolve(saved) : cmd === "probe" ? Promise.resolve(reachable(args.url)) : Promise.resolve(null));
  assert.deepStrictEqual(s.view(), [], "nothing before the screen knows whether a server is saved");
  await settle();
  assert.deepStrictEqual(s.cmds(), ["app_state", "probe", "save_server"]);
  assert.deepStrictEqual(s.calls[1][1], { url: base + "api/auth/status" });
  assert.deepStrictEqual(s.calls[2][1], { id: "a", name: null, url: base, connect: true }, "its own entry, opened in the screen's place");
  assert.deepStrictEqual(s.view(), ["open"], "the form never shows");
  assert.strictEqual(s.els.openTitle.textContent, "Home");
  assert.strictEqual(s.els.openUrl.textContent, base);
  assert.strictEqual(s.els.openStatus.textContent, STRINGS.en.connecting);
  assert.ok(s.els.openRetry.hidden && s.els.openErr.hidden);
});

test("launch with an unreachable saved server: the reason, Retry and Change server, never the empty form (issue #126)", async () => {
  let up = false, pending = null;
  const s = openScreen("", (cmd, args) => {
    if (cmd === "app_state") return Promise.resolve(saved);
    if (cmd === "probe") return pending ? pending.promise : Promise.resolve(up ? reachable(args.url) : { error: "connect", detail: "refused" });
    return Promise.resolve(null);
  });
  await settle();
  assert.deepStrictEqual(s.cmds(), ["app_state", "probe"], "nothing saved or opened");
  assert.deepStrictEqual(s.view(), ["open"]);
  assert.strictEqual(s.els.openErrTitle.textContent, STRINGS.en.unreachableTitle);
  // the whole message, with the address tried in place of {url}
  assert.strictEqual(s.els.openErrText.textContent, STRINGS.en.unreachableText.split("{url}").join(base));
  assert.strictEqual(s.els.openStatus.textContent, "");
  assert.ok(s.visible("openRetry") && s.visible("openChange"));
  assert.strictEqual(s.els.openRetry.textContent, STRINGS.en.retry);
  // Retry: checked again, opened once it answers
  up = true;
  s.els.openRetry.on.click();
  await settle();
  assert.deepStrictEqual(s.cmds().slice(2), ["probe", "save_server"]);
  assert.ok(s.els.openErr.hidden);
  // Change server: the form, filled with the saved address; Cancel goes back to opening it
  s.els.openChange.on.click();
  assert.deepStrictEqual(s.view(), ["form"]);
  assert.strictEqual(s.els.title.textContent, STRINGS.en.changeServer);
  assert.strictEqual(s.els.url.value, base);
  assert.ok(s.visible("cancel") && s.els.nameRow.hidden && s.els.err.hidden);
  assert.strictEqual(s.els.go.textContent, STRINGS.en.connect);
  const before = s.calls.length;
  s.els.cancel.on.click();
  await settle();
  assert.deepStrictEqual(s.view(), ["open"]);
  assert.deepStrictEqual(s.cmds().slice(before), ["probe", "save_server"], "Cancel: back to opening the saved server, not cancel_form");
  // a check still running when the user picks Change server never opens the old server
  let release;
  pending = { promise: new Promise((r) => { release = r; }) };
  s.els.openRetry.on.click();
  await settle();
  s.els.openChange.on.click();
  const mark = s.calls.length;
  release(reachable(base + "api/auth/status"));
  pending = null;
  await settle();
  assert.deepStrictEqual(s.cmds().slice(mark), [], "the late answer is dropped");
  assert.deepStrictEqual(s.view(), ["form"]);
  // Connect on the form adds (or reuses) the address typed and opens it
  s.els.url.value = "https://other.example.org/";
  s.els.form.on.submit({ preventDefault() {} });
  await settle();
  assert.deepStrictEqual(s.calls.slice(-1)[0], ["save_server", { id: null, name: null, url: "https://other.example.org/", connect: true }]);
});

test("launch: a redirect to another saved address uses that entry; a failed save shows why (issue #126)", async () => {
  const other = { id: "b", url: "https://books.example.net/kisiauthong/" };
  const two = { locale: "en", active: "a", servers: [saved.servers[0], other] };
  let fail = false;
  const s = openScreen("", (cmd, args) => {
    if (cmd === "app_state") return Promise.resolve(two);
    if (cmd === "probe") return Promise.resolve(reachable(other.url + "api/auth/status"));
    return fail ? Promise.reject(new Error("disk full")) : Promise.resolve(null);
  });
  await settle();
  assert.deepStrictEqual(s.calls.slice(-1)[0], ["save_server", { id: "b", name: null, url: other.url, connect: true }], "no second entry with one address");
  assert.ok(s.els.openChange.disabled, "the server is being opened");
  fail = true;
  s.els.openRetry.on.click();
  await settle();
  assert.deepStrictEqual(s.view(), ["open"]);
  assert.strictEqual(s.els.openErrTitle.textContent, STRINGS.en.saveTitle);
  assert.ok(s.els.openErrText.textContent.includes("disk full"));
  assert.ok(s.visible("openRetry") && !s.els.openChange.disabled);
  // Change server → Connect while it checks: Cancel waits
  let release;
  const s2 = openScreen("", (cmd) => cmd === "app_state" ? Promise.resolve(saved)
    : cmd === "probe" ? new Promise((r) => { release = r; }) : Promise.resolve(null));
  await settle();
  release({ error: "timeout" });
  await settle();
  s2.els.openChange.on.click();
  s2.els.form.on.submit({ preventDefault() {} });
  assert.ok(s2.els.cancel.disabled, "Cancel is off while the address is checked");
  const n = s2.calls.length;
  s2.els.cancel.on.click();
  release({ error: "timeout" });
  await settle();
  assert.deepStrictEqual(s2.view(), ["form"]);
  assert.ok(!s2.els.cancel.disabled && s2.visible("err"));
  assert.deepStrictEqual(s2.cmds().slice(n), [], "nothing more asked");
});

test("first run and Settings → Servers still show the server form (issue #126)", async () => {
  // no saved server: the first-run form, nothing checked
  let s = openScreen("", (cmd) => Promise.resolve(cmd === "app_state" ? { locale: "en", active: null, servers: [] } : null));
  await settle();
  assert.deepStrictEqual(s.view(), ["form"]);
  assert.strictEqual(s.els.title.textContent, STRINGS.en.firstTitle);
  assert.ok(s.els.cancel.hidden);
  assert.deepStrictEqual(s.cmds(), ["app_state"]);
  // Add server, with a server saved and in use: the form, Cancel back to Settings
  s = openScreen("?mode=add&lang=zh-TW", (cmd) => Promise.resolve(cmd === "app_state" ? saved : null));
  await settle();
  assert.deepStrictEqual(s.view(), ["form"]);
  assert.strictEqual(s.els.title.textContent, STRINGS["zh-TW"].addTitle);
  assert.ok(s.visible("cancel") && s.visible("nameRow"));
  assert.deepStrictEqual(s.cmds(), ["app_state"], "the saved server is not opened");
  s.els.cancel.on.click();
  assert.deepStrictEqual(s.cmds(), ["app_state", "cancel_form"]);
  // Edit server: the form, filled in
  s = openScreen("?mode=edit&id=a", (cmd) => Promise.resolve(cmd === "app_state" ? saved : null));
  await settle();
  assert.deepStrictEqual(s.view(), ["form"]);
  assert.strictEqual(s.els.title.textContent, STRINGS.en.editTitle);
  assert.strictEqual(s.els.url.value, base);
  assert.strictEqual(s.els.name.value, "Home");
  // a plain browser (no app): the empty form
  s = openScreen("", () => Promise.reject(new Error("no app")));
  await settle();
  assert.deepStrictEqual(s.view(), ["form"]);
});

test("the screen's colour tokens are web/style.css's Default theme, light and dark", () => {
  // the server screen belongs to no account: Default, in the system's light or dark (issue #85)
  const css = (f) => fs.readFileSync(f, "utf8");
  const web = css(path.join(root, "web", "style.css")), scr = css(path.join(app, "style.css"));
  const block = (src, re) => { const m = src.match(re); assert.ok(m, String(re)); return m[1]; };
  assert.strictEqual(block(scr, /^:root\{(color-scheme:light;[^}]*)\}$/m), block(web, /^\[data-theme=default\],:root\{([^}]*)\}$/m), "light");
  assert.strictEqual(block(scr, /^@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}$/m), block(web, /^\[data-theme=default\]\[data-mode=dark\]\{([^}]*)\}$/m), "dark");
  for (const m of scr.replace(/^(:root|@media)[^\n]*$/gm, "").matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\d/g)) assert.fail(`a colour outside the tokens: ${m[0]}`);
  assert.ok(css(path.join(app, "index.html")).includes('<meta name="color-scheme" content="light dark">'), "the screen follows the system's light or dark");
  assert.ok(fs.readFileSync(path.join(app, "icon-512.png")).equals(fs.readFileSync(path.join(root, "web", "icon-512.png"))), "icon-512.png is web/icon-512.png");
});

test("the bridge script is plain, valid JavaScript", () => {
  const src = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "src", "bridge.js"), "utf8");
  new Function(src); // throws on a syntax error
  for (const cmd of ["returned", "servers", "use_server", "remove_server", "open_server_form", "open_external", "confirm", "app_info", "open_updates"]) {
    assert.ok(src.includes(`"${cmd}"`), cmd);
    assert.ok(fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "permissions", "app.toml"), "utf8").includes(`allow-${cmd.replace(/_/g, "-")}`), `bridge permission for ${cmd}`);
  }
});

test("the bridge passes confirm() to the shell's native dialog", async () => {
  const src = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "src", "bridge.js"), "utf8");
  const calls = [];
  const win = { __TAURI_INTERNALS__: { invoke: (cmd, args) => { calls.push([cmd, args]); return Promise.resolve(true); } }, addEventListener: () => {} };
  win.top = win;
  const doc = { addEventListener: () => {} };
  new Function("window", "document", "location", src)(win, doc, { href: "https://books.example.org/" });
  assert.strictEqual(await win.kisiauthongApp.confirm("Delete this transaction?", "Delete", "Cancel"), true);
  assert.deepStrictEqual(calls.pop(), ["confirm", { message: "Delete this transaction?", ok: "Delete", cancel: "Cancel" }]);
  await win.kisiauthongApp.confirm("Sure?");
  assert.deepStrictEqual(calls.pop(), ["confirm", { message: "Sure?", ok: null, cancel: null }], "no labels: the system's OK and Cancel");
  await win.kisiauthongApp.add("zh-TW");
  assert.deepStrictEqual(calls.pop(), ["open_server_form", { mode: "add", id: null, lang: "zh-TW" }], "Change server on the sign-in card and Add server open the server screen");
  const frame = { top: {}, __TAURI_INTERNALS__: win.__TAURI_INTERNALS__ };
  new Function("window", "document", "location", src)(frame, doc, {});
  assert.strictEqual(frame.kisiauthongApp, undefined, "not in frames");
});

test("the bridge shows the page the app names after going back from the server screen (issue #83)", async () => {
  const src = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "src", "bridge.js"), "utf8");
  // one page: shown (fresh or from the back-forward cache) while the app answers `returned` with `to`
  const show = async (href, persisted, to) => {
    const done = [];
    const on = {};
    const win = { addEventListener: (type, fn) => { on[type] = fn; }, __TAURI_INTERNALS__: { invoke: (cmd) => {
      done.push(cmd);
      return cmd === "returned" ? Promise.resolve(to) : Promise.resolve(null);
    } } };
    win.top = win;
    const loc = { href, replace: (u) => done.push("replace " + u), reload: () => done.push("reload") };
    new Function("window", "document", "location", src)(win, { addEventListener: () => {} }, loc);
    on.pageshow({ persisted });
    await new Promise((r) => setTimeout(r, 0));
    return done;
  };
  const settings = "https://books.example.org/kisiauthong/#settings";
  const about = settings + "?about";
  assert.deepStrictEqual(await show(settings, false, null), ["returned"], "every other page: nothing happens");
  assert.deepStrictEqual(await show(settings, true, null), ["returned"], "Back as usual keeps the cached page");
  assert.deepStrictEqual(await show(settings, false, settings), ["returned"], "Edit server → Save, page loaded anew: as it is");
  assert.deepStrictEqual(await show(settings, true, settings), ["returned", "reload"], "Edit server → Save, cached page: loaded anew");
  for (const persisted of [false, true]) {
    assert.deepStrictEqual(await show(settings, persisted, about), ["returned", "replace " + about], "App updates → Back: About, in the same entry");
  }
});

test("app updates: only the bundled screen may check and install (ADR 0020)", () => {
  const toml = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "permissions", "app.toml"), "utf8");
  const set = (id) => {
    const m = toml.match(new RegExp(`identifier = "${id}"[\\s\\S]*?permissions = \\[([^\\]]*)\\]`));
    assert.ok(m, id);
    return m[1];
  };
  for (const p of ["allow-update-check", "allow-update-install", "allow-update-settings"]) {
    assert.ok(set("server-screen").includes(p), `server-screen has ${p}`);
    assert.ok(!set("bridge").includes(p), `bridge (saved servers' pages) must not have ${p}`);
  }
});

test("desktop updates: latest.json lists each signed build (ADR 0024)", () => {
  const { manifest } = require(path.join(root, "scripts", "updater-manifest.js"));
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kst-manifest-"));
  try {
    const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
    const when = new Date("2026-11-22T10:00:00.123Z");
    assert.strictEqual(manifest("0.6.0", dir, "o/r", when), null, "nothing signed: no manifest");
    put("kisiauthong-app-0.6.0-windows-x64-setup.exe", "exe");
    assert.strictEqual(manifest("0.6.0", dir, "o/r", when), null, "an unsigned build is left out");
    put("kisiauthong-app-0.6.0-windows-x64-setup.exe.sig", "U0lHLVdJTg==\n");
    put("kisiauthong-app-0.6.0-macos.app.tar.gz", "tgz");
    put("kisiauthong-app-0.6.0-macos.app.tar.gz.sig", "U0lHLU1BQw==");
    const m = manifest("0.6.0", dir, "o/r", when);
    assert.strictEqual(m.version, "0.6.0");
    assert.strictEqual(m.pub_date, "2026-11-22T10:00:00Z");
    assert.deepStrictEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
    assert.deepStrictEqual(m.platforms["windows-x86_64"], { signature: "U0lHLVdJTg==", url: "https://github.com/o/r/releases/download/0.6.0/kisiauthong-app-0.6.0-windows-x64-setup.exe" });
    assert.strictEqual(m.platforms["darwin-x86_64"].url, m.platforms["darwin-aarch64"].url, "one universal macOS app");
    assert.throws(() => manifest("v0.6.0", dir, "o/r"), /not a release tag/, "tags have no v");
    put("kisiauthong-app-0.6.0-macos.app.tar.gz.sig", "");
    assert.throws(() => manifest("0.6.0", dir, "o/r"), /empty/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop updates: the updater runs only in Rust, never from a page (ADR 0024)", () => {
  const caps = path.join(root, "apps", "tauri", "src-tauri", "capabilities");
  for (const f of fs.readdirSync(caps)) assert.ok(!/updater:/.test(fs.readFileSync(path.join(caps, f), "utf8")), `${f} grants no updater permission`);
  const toml = fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "permissions", "app.toml"), "utf8");
  assert.ok(!/updater:/.test(toml), "no permission set includes the updater plugin");
  const conf = JSON.parse(fs.readFileSync(path.join(root, "apps", "tauri", "src-tauri", "tauri.conf.json"), "utf8"));
  const u = conf.plugins.updater;
  assert.ok(u.requireSignedVersion, "the signature must name the version it was signed for");
  assert.ok(!u.dangerousInsecureTransportProtocol && !u.allowDowngrades, "https only, no downgrades");
  assert.ok(!(conf.bundle && conf.bundle.createUpdaterArtifacts), "signed builds only in release.yml, so local builds need no key");
});

test("window frame: only the bundled frame webview may move, resize or close the window (ADR 0026)", () => {
  const tauri = path.join(root, "apps", "tauri", "src-tauri");
  const caps = path.join(tauri, "capabilities");
  const cap = (f) => JSON.parse(fs.readFileSync(path.join(caps, f), "utf8"));
  const frame = cap("frame.json");
  assert.ok(frame.local && !frame.remote, "the frame capability is for the bundled frame page only");
  assert.deepStrictEqual(frame.webviews, ["frame"], "and only for the frame webview, not the whole window");
  assert.ok(!frame.windows, "a window-wide grant would reach the server's page too");
  assert.deepStrictEqual(frame.platforms.sort(), ["linux", "macOS", "windows"], "desktop only");
  for (const p of frame.permissions)
    assert.ok(/^core:window:allow-/.test(p) || p === "core:webview:allow-set-webview-focus", `frame has only window permissions, and may give the page the keyboard: ${p}`);
  for (const f of fs.readdirSync(caps).filter((f) => f !== "frame.json")) {
    const c = cap(f);
    assert.ok(!(c.webviews || []).includes("frame"), `${f} grants nothing to the frame`);
    assert.ok(!/core:(window|webview)/.test(JSON.stringify(c.permissions)), `${f} grants no window or webview permission`);
  }
  assert.ok(!fs.readFileSync(path.join(tauri, "permissions", "app.toml"), "utf8").includes("core:window"), "no permission set has window permissions");
  const lib = fs.readFileSync(path.join(tauri, "src", "lib.rs"), "utf8");
  const grant = lib.slice(lib.indexOf("fn grant("), lib.indexOf("fn require_local("));
  assert.ok(/\.webview\(CONTENT\)/.test(grant) && !/\.window\(/.test(grant), "saved servers' pages get the bridge in the content webview only");
  const html = fs.readFileSync(path.join(app, "frame.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!/^[a-z]+:/i.test(m[1]), `frame.html loads only bundled files: ${m[1]}`);
  assert.ok(/<header[^>]*data-tauri-drag-region="deep"/.test(html), "the whole bar drags, text and icon included");
});

// The RGBA pixels of an 8-bit, non-interlaced RGBA PNG (what scripts/android-icons.py writes).
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.deepStrictEqual([data[8], data[9], data[12]], [8, 6, 0], `${file}: 8-bit RGBA, not interlaced`);
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  assert.ok(width > 0 && height > 0, `${file}: has an IHDR chunk`);
  const raw = require("zlib").inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, `${file}: PNG filter type ${filter}`);
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (v + pred) & 255;
    }
  }
  return { width, height, alpha: (x, y) => px[(y * width + x) * 4 + 3] };
}

test("Android launcher icon: adaptive layers, artwork inside the 66dp safe zone (issue #54)", () => {
  const icons = path.join(root, "apps", "tauri", "src-tauri", "icons", "android");
  const res = path.join(root, "apps", "tauri", "src-tauri", "gen", "android", "app", "src", "main", "res");
  const xml = fs.readFileSync(path.join(icons, "mipmap-anydpi-v26", "ic_launcher.xml"), "utf8");
  for (const layer of ["background", "foreground", "monochrome"]) {
    assert.ok(xml.includes(`<${layer} android:drawable="@mipmap/ic_launcher_${layer}"/>`), `ic_launcher.xml has the ${layer} layer`);
  }
  const files = ["mipmap-anydpi-v26/ic_launcher.xml"];
  for (const [dpi, d] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const layer = Math.round(108 * d);
    for (const name of ["background", "foreground", "monochrome"]) {
      const file = `mipmap-${dpi}/ic_launcher_${name}.png`;
      files.push(file);
      const png = readPng(path.join(icons, file));
      assert.deepStrictEqual([png.width, png.height], [layer, layer], `${file} is 108dp`);
      // the background is full bleed; the other layers leave everything beyond 33dp from the centre transparent
      const safe = 33 * d, mid = layer / 2;
      let opaque = 0;
      for (let y = 0; y < layer; y++) {
        for (let x = 0; x < layer; x++) {
          const out = Math.hypot(x + 0.5 - mid, y + 0.5 - mid) > safe;
          if (name === "background") assert.strictEqual(png.alpha(x, y), 255, `${file} is opaque at ${x},${y}`);
          else if (out) assert.strictEqual(png.alpha(x, y), 0, `${file} is transparent outside the safe zone at ${x},${y}`);
          else if (png.alpha(x, y) === 255) opaque++;
        }
      }
      if (name !== "background") assert.ok(opaque > (layer * layer) / 40, `${file} has the artwork inside the safe zone`);
    }
    for (const name of ["ic_launcher", "ic_launcher_round"]) files.push(`mipmap-${dpi}/${name}.png`);
  }
  for (const file of files) {
    assert.ok(fs.readFileSync(path.join(icons, file)).equals(fs.readFileSync(path.join(res, file))), `gen/android has the same ${file}`);
  }
  assert.ok(!fs.existsSync(path.join(res, "values", "ic_launcher_background.xml")), "no plain colour background layer");
});

require("./run-tests.js")(tests);
