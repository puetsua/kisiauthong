// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Themes (issue #85, ADR 0027): every colour in the web UI is a theme token,
// every built-in theme sets every token in light and dark, text pairs meet
// WCAG AA, and web/theme.js picks, keeps and applies the theme.
// Usage: node scripts/test-themes.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const css = read("web/style.css");
const THEMES = ["default", "contrast", "warm", "cool"];

// the token blocks: [data-theme=X] (light) and [data-theme=X][data-mode=dark]
function blocks() {
  const out = {};
  for (const m of css.matchAll(/^\[data-theme=([a-z]+)\](\[data-mode=dark\])?(?:,:root)?\{([^}]*)\}$/gm)) {
    const decl = {};
    for (const d of m[3].split(";")) { const i = d.indexOf(":"); decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    (out[m[1]] = out[m[1]] || {})[m[2] ? "dark" : "light"] = decl;
  }
  return out;
}
const B = blocks();

// WCAG 2 relative luminance and contrast ratio, hex colours only
const lum = (hex) => {
  let h = hex.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("four themes, each light and dark, Default also the :root fallback", () => {
  assert.deepStrictEqual(Object.keys(B).sort(), [...THEMES].sort());
  for (const t of THEMES) for (const m of ["light", "dark"]) {
    assert.ok(B[t][m], `${t} ${m}`);
    assert.strictEqual(B[t][m]["color-scheme"], m, `${t} ${m}: color-scheme, so native controls and scrollbars match`);
  }
  assert.match(css, /^\[data-theme=default\],:root\{color-scheme:light;/m);
});

test("every theme sets the same tokens, all of them used, none missing", () => {
  const names = Object.keys(B.default.light).filter((k) => k.startsWith("--"));
  for (const t of THEMES) for (const m of ["light", "dark"]) assert.deepStrictEqual(Object.keys(B[t][m]).filter((k) => k.startsWith("--")), names, `${t} ${m}: same tokens in the same order`);
  const app = read("web/app.js");
  const used = new Set([...(css + app).matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => "--" + m[1]));
  for (const k of names) assert.ok(used.has(k) || (k.startsWith("--series-") && app.includes("var(--series-${n})")), `${k} is used`);
  for (const k of used) assert.ok(names.includes(k) || k === "--page-max" || k === "--series-", `${k} is a token`);
});

test("no colour outside the theme blocks, apart from the listed fixed ones", () => {
  // fixed on purpose: avatar initials sit on the avatar's own (user-chosen, unthemed) colour; a QR code
  // needs a white quiet zone to scan; a mask gradient's colour is only its alpha
  const fixed = [/^\.avatar\{.*color:#fff/, /^\.totpsetup \.qr\{.*background:#fff/, /^\.tilebody\{.*mask-image:linear-gradient\(#000/];
  const lines = css.split("\n").filter((l) => !/^\[data-theme=/.test(l));
  for (const l of lines) {
    const bare = l.replace(/^\s+/, "");
    if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(\d|(?<![\w-])(white|black)(?![\w-])/.test(bare.replace(/\/\*.*?\*\//g, ""))) continue;
    assert.ok(fixed.some((re) => re.test(bare)), `a colour outside the tokens: ${bare.slice(0, 120)}`);
  }
  // app.js: only the avatar palette (fixed, ADR 0027) and the photo cropper's canvas, which draws over the photo
  const app = read("web/app.js").split("\n");
  for (const l of app) {
    if (!/["'`]#[0-9a-fA-F]{3,8}\b|rgba?\(\d/.test(l)) continue;
    assert.ok(/^const AVATAR_COLORS =|fillStyle|strokeStyle/.test(l.trim()), `a colour in app.js: ${l.trim().slice(0, 120)}`);
  }
});

test("text and controls meet WCAG AA in every theme, light and dark", () => {
  const text = [["ink", "bg"], ["ink", "panel"], ["ink", "surface"], ["ink", "field"], ["ink", "hover2"], ["ink", "plannedbg"], ["ink", "peekbg"],
    ["muted", "bg"], ["muted", "panel"], ["muted", "field"], ["muted", "soft"], ["muted", "plannedbg"],
    ["accent", "panel"], ["accent", "bg"], ["accent", "surface"], ["accent", "accentsoft"], ["on-accent", "accent"], ["on-accent", "accent2"],
    ["sidetext", "side"], ["sidemuted", "side"], ["sidestrong", "side"], ["sidestrong", "side2"], ["sidetext", "sidehover"],
    ["amt-in", "panel"], ["amt-out", "panel"], ["amt-in", "bg"], ["amt-out", "bg"], ["pos", "panel"], ["pos", "posbg"], ["red", "panel"], ["red", "redbg"],
    ["amber", "panel"], ["amberink", "amberbg"], ["amberink", "plannedbg"], ["sched", "panel"], ["schedink", "schedbg"],
    ["nightlyink", "nightlybg"], ["nightlysideink", "nightlyline"], ["on-status", "amber"], ["on-status", "red"], ["toast-ink", "toast-bg"]];
  // WCAG 1.4.11: icons on their tile, bar fills on the track, input borders, focus rings
  const ui = [["ico-out", "ico-out-bg"], ["ico-move", "ico-move-bg"], ["ico-rsv", "ico-rsv-bg"], ["amber", "amberbg"], ["accent", "track"],
    ["fieldline", "field"], ["fieldline", "panel"], ["fieldline", "surface"], ["focus", "panel"], ["accent", "panel"]];
  const fails = [];
  for (const t of THEMES) for (const m of ["light", "dark"]) {
    const p = B[t][m];
    for (const [pairs, min] of [[text, 4.5], [ui, 3]]) for (const [f, b] of pairs) {
      const r = ratio(p["--" + f], p["--" + b]);
      if (r < min) fails.push(`${t} ${m}: --${f} on --${b} ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  assert.deepStrictEqual(fails, []);
});

test("spending and income have their own colours, never the status ones (issue #66)", () => {
  for (const t of THEMES) for (const m of ["light", "dark"]) {
    const p = B[t][m];
    assert.notStrictEqual(p["--amt-out"], p["--red"], `${t} ${m}: spending is not over-budget red`);
    assert.notStrictEqual(p["--amt-in"], p["--amt-out"], `${t} ${m}`);
  }
});

test("approved accents: Default purple, High contrast navy / yellow, Warm terracotta, Cool teal", () => {
  assert.strictEqual(B.default.light["--accent"], "#5b2a86", "Default light is the original look");
  assert.strictEqual(B.contrast.light["--accent"], "#0b3d91");
  assert.strictEqual(B.contrast.dark["--accent"], "#ffe14d");
  assert.strictEqual(B.contrast.dark["--bg"], "#000");
  assert.strictEqual(B.warm.light["--accent"], "#a8481a");
  assert.strictEqual(B.cool.light["--accent"], "#0b6a80");
});

test("the browser's bar colour starts as Default's sidebar; the manifest matches", () => {
  const side = B.default.light["--side"];
  assert.match(read("web/index.html"), new RegExp(`<meta name="theme-color" content="${side}">`));
  const man = JSON.parse(read("web/manifest.json"));
  assert.strictEqual(man.theme_color, side);
  assert.strictEqual(man.background_color, B.default.light["--bg"]);
  // theme.js runs in <head> after the stylesheet, so the first frame is already in the theme
  const html = read("web/index.html");
  assert.ok(html.indexOf('href="style.css') < html.indexOf('src="theme.js') && html.indexOf('src="theme.js') < html.indexOf("</head>"));
});

// web/theme.js in a sandbox with a fake localStorage, matchMedia and <html>
function loadTheme({ store = {}, media = {}, throws = false } = {}) {
  const html = { dataset: {} };
  const meta = { content: "#2a1740", setAttribute(k, v) { this[k] = v; } };
  const listeners = {};
  const sandbox = {
    JSON, String, Object,
    localStorage: {
      getItem: (k) => { if (throws) throw new Error("blocked"); return k in store ? store[k] : null; },
      setItem: (k, v) => { if (throws) throw new Error("blocked"); store[k] = String(v); },
    },
    matchMedia: (q) => ({ get matches() { return !!media[q]; }, addEventListener: (ev, fn) => { (listeners[q] = listeners[q] || []).push(fn); } }),
    document: { documentElement: html, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) },
    getComputedStyle: (el) => ({ getPropertyValue: (k) => (k === "--side" ? (B[el.dataset.theme] || {})[el.dataset.mode]["--side"] : "") }),
    addEventListener: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read("web/theme.js") + "\nthis.__t = { readThemePrefs, writeThemePrefs, resolveTheme, applyTheme, setThemeSignedOut };", sandbox);
  // results come back as plain objects of this realm, so deepStrictEqual compares values only
  const plain = (f) => (...a) => { const r = f(...a); return r && typeof r === "object" ? JSON.parse(JSON.stringify(r)) : r; };
  const t = Object.fromEntries(Object.entries(sandbox.__t).map(([k, f]) => [k, plain(f)]));
  return { t, html, meta, store, media, fire: (q) => (listeners[q] || []).forEach((fn) => fn()) };
}

test("theme.js: nothing saved is Default following the system; a saved choice is applied before the page draws", () => {
  let s = loadTheme();
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "default", mode: "light" });
  s = loadTheme({ media: { "(prefers-color-scheme: dark)": true } });
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "default", mode: "dark" });
  assert.strictEqual(s.meta.content, B.default.dark["--side"], "the browser bar takes the sidebar colour");
  s = loadTheme({ store: { "kisiauthong.theme": JSON.stringify({ theme: "warm", mode: "light" }) }, media: { "(prefers-color-scheme: dark)": true } });
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "warm", mode: "light" }, "a forced mode wins over the system");
  assert.strictEqual(s.meta.content, B.warm.light["--side"]);
});

test("theme.js: bad or unknown saved values fall back to the defaults", () => {
  for (const v of ["{", "null", "[]", JSON.stringify({ theme: "neon", mode: "sepia" }), JSON.stringify("cool")]) {
    const s = loadTheme({ store: { "kisiauthong.theme": v } });
    assert.deepStrictEqual(s.t.readThemePrefs(), { theme: "default", mode: "system" }, v);
  }
  const s = loadTheme({ store: { "kisiauthong.theme": JSON.stringify({ theme: "cool", mode: "neon" }) } });
  assert.deepStrictEqual(s.t.readThemePrefs(), { theme: "cool", mode: "system" }, "each field on its own");
});

test("theme.js: a choice is written, read back and applied; blocked storage keeps it for the page", () => {
  let s = loadTheme();
  assert.strictEqual(s.t.writeThemePrefs({ theme: "cool", mode: "dark", extra: 1 }), true);
  assert.deepStrictEqual(JSON.parse(s.store["kisiauthong.theme"]), { theme: "cool", mode: "dark" });
  s.t.applyTheme();
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "cool", mode: "dark" });
  s = loadTheme({ throws: true });
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "default", mode: "light" });
  assert.strictEqual(s.t.writeThemePrefs({ theme: "warm", mode: "dark" }), false, "says it was not kept");
  assert.deepStrictEqual(s.t.applyTheme(), { theme: "warm", mode: "dark" }, "but the page still shows it");
});

test("theme.js: the system asking for more contrast (or forcing colours) gives High contrast, in the chosen mode", () => {
  const r = (prefs, sys) => loadTheme().t.resolveTheme(prefs, sys);
  assert.deepStrictEqual(r({ theme: "warm", mode: "system" }, { dark: true, moreContrast: true }), { theme: "contrast", mode: "dark" });
  assert.deepStrictEqual(r({ theme: "warm", mode: "light" }, { dark: true, moreContrast: true }), { theme: "contrast", mode: "light" });
  assert.deepStrictEqual(r({ theme: "warm", mode: "system" }, { dark: false, moreContrast: false }), { theme: "warm", mode: "light" });
  const s = loadTheme({ store: { "kisiauthong.theme": JSON.stringify({ theme: "cool", mode: "system" }) } });
  s.media["(forced-colors: active)"] = true;
  s.fire("(forced-colors: active)");
  assert.strictEqual(s.html.dataset.theme, "contrast", "follows a change while the page is open");
  s.media["(forced-colors: active)"] = false; s.media["(prefers-color-scheme: dark)"] = true;
  s.fire("(prefers-color-scheme: dark)");
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "cool", mode: "dark" });
});

test("theme.js: signed out is Default in the system's light or dark, whatever this device chose", () => {
  const s = loadTheme({ store: { "kisiauthong.theme": JSON.stringify({ theme: "warm", mode: "light" }) }, media: { "(prefers-color-scheme: dark)": true } });
  assert.deepStrictEqual(s.t.setThemeSignedOut(true), { theme: "default", mode: "dark" });
  assert.deepStrictEqual(s.t.setThemeSignedOut(false), { theme: "warm", mode: "light" });
});

require("./run-tests.js")(tests);
