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
  for (const f of ["first-run.js", "update.js", "frame.js"]) {
    const js = fs.readFileSync(path.join(app, f), "utf8");
    for (const m of js.matchAll(/\bS\.([a-zA-Z]+)/g)) assert.ok(m[1] in en, `${f} uses S.${m[1]}`);
  }
  for (const k of Object.keys(en)) {
    const ph = (t) => (t.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.strictEqual(ph(zh[k]), ph(en[k]), `placeholders of ${k}`);
  }
});

test("the screen's colour tokens match web/style.css", () => {
  const rootLine = (f) => fs.readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(":root{--page-max"));
  assert.strictEqual(rootLine(path.join(app, "style.css")), rootLine(path.join(root, "web", "style.css")));
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

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log("ok", name); }
  console.log(`${n} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
