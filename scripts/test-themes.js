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
  // not colours: the page width, the series template in app.js, the colour picker's hue
  for (const k of used) assert.ok(names.includes(k) || ["--page-max", "--series-", "--hue"].includes(k), `${k} is a token`);
});

test("no colour outside the theme blocks, apart from the listed fixed ones", () => {
  // fixed on purpose: avatar initials sit on the avatar's own (user-chosen, unthemed) colour; a QR code
  // needs a white quiet zone to scan; a mask gradient's colour is only its alpha; the theme editor's
  // colour picker shows the colour space itself (black, white, the hues) whatever the theme
  const fixed = [/^\.avatar\{.*color:#fff/, /^\.totpsetup \.qr\{.*background:#fff/, /^\.tilebody\{.*mask-image:linear-gradient\(#000/, /^\.tp(sv|hue)[\s{:,]/];
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
  const props = {};
  const html = { dataset: {}, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } } };
  const meta = { content: "#2a1740", setAttribute(k, v) { this[k] = v; } };
  const listeners = {};
  const sandbox = {
    JSON, String, Object,
    localStorage: {
      getItem: (k) => { if (throws) throw new Error("blocked"); return k in store ? store[k] : null; },
      setItem: (k, v) => { if (throws) throw new Error("blocked"); store[k] = String(v); },
      removeItem: (k) => { if (throws) throw new Error("blocked"); delete store[k]; },
    },
    matchMedia: (q) => ({ get matches() { return !!media[q]; }, addEventListener: (ev, fn) => { (listeners[q] = listeners[q] || []).push(fn); } }),
    document: {
      documentElement: html, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null),
      createElement: () => ({ dataset: {}, remove() {} }), body: { appendChild() {} },
    },
    // the page's inline tokens (a custom theme) over its [data-theme] block, as in a browser
    getComputedStyle: (el) => ({ getPropertyValue: (k) => (el === html && k in props ? props[k] : (B[el.dataset.theme] || {})[el.dataset.mode][k] || "") }),
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } },
    addEventListener: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read("web/theme.js") + "\nthis.__t = { readThemePrefs, writeThemePrefs, resolveTheme, applyTheme, setThemeSignedOut, THEME_TOKENS, THEME_MAIN, normHex, hexToHsv, hsvToHex, contrastRatio, deriveTheme, normTheme, readCustomThemes, writeCustomThemes, mergeThemes, sameThemes, themeToJSON, themeFromJSON, builtinTokens, newThemeId };", sandbox);
  // results come back as plain objects of this realm, so deepStrictEqual compares values only
  const plain = (f) => (...a) => { const r = f(...a); return r && typeof r === "object" ? JSON.parse(JSON.stringify(r)) : r; };
  const t = Object.fromEntries(Object.entries(sandbox.__t).map(([k, f]) => [k, typeof f === "function" ? plain(f) : JSON.parse(JSON.stringify(f))]));
  return { t, html, props, meta, store, media, fire: (q) => (listeners[q] || []).forEach((fn) => fn()) };
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

// a complete custom theme: Cool's colours with its own spending colour
// the plain colours, as Default light has them (High contrast dark writes --toast-line as a hex colour too)
const COLOURS = Object.keys(B.default.light).filter((k) => k.startsWith("--") && B.default.light[k].startsWith("#"));
const builtin = (th, m) => Object.fromEntries(Object.entries(B[th][m]).filter(([k]) => COLOURS.includes(k)).map(([k, v]) => [k.slice(2), v.length === 4 ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v]));
const mine = (over = {}) => Object.assign({ id: "thm-abc123", name: "Teal night", basedOn: "cool", split: false, light: Object.assign(builtin("cool", "light"), { "amt-out": "#b42350" }), dark: null, updatedAt: "2026-11-24T03:00:00.000Z" }, over);

test("theme.js: THEME_TOKENS is every plain colour of style.css's blocks, in order; the editor's main colours are among them", () => {
  const { t } = loadTheme();
  assert.deepStrictEqual(t.THEME_TOKENS, Object.keys(builtin("default", "light")));
  for (const k of t.THEME_MAIN) assert.ok(t.THEME_TOKENS.includes(k), k);
  assert.deepStrictEqual(t.builtinTokens("warm", "dark"), builtin("warm", "dark"), "read from the stylesheet, #rgb written out");
});

test("theme.js: colour helpers — hex only, HSV both ways", () => {
  const { t } = loadTheme();
  assert.strictEqual(t.normHex("#ABC"), "#aabbcc");
  assert.strictEqual(t.normHex(" #1A2b3C "), "#1a2b3c");
  for (const bad of ["white", "rgb(0,0,0)", "#12345", "#1234567", "123456", "", null]) assert.strictEqual(t.normHex(bad), null, String(bad));
  for (const h of ["#5b2a86", "#000000", "#ffffff", "#0b6a80", "#ffe14d"]) assert.strictEqual(t.hsvToHex(...t.hexToHsv(h)), h);
  assert.strictEqual(Math.round(t.contrastRatio("#000000", "#ffffff")), 21);
});

test("theme.js: derived colours follow the main ones and keep inputs and text on accents readable", () => {
  const { t } = loadTheme();
  for (const th of ["default", "contrast", "warm", "cool"]) for (const m of ["light", "dark"]) {
    const base = builtin(th, m), main = Object.fromEntries(t.THEME_MAIN.map((k) => [k, base[k]]));
    const d = t.deriveTheme(main, base);
    assert.deepStrictEqual(Object.keys(d).sort(), [...t.THEME_TOKENS].sort());
    for (const v of Object.values(d)) assert.ok(t.normHex(v) === v, v);
    for (const k of t.THEME_MAIN) assert.strictEqual(d[k], base[k], `${th} ${m} ${k} kept`);
    assert.ok(t.contrastRatio(d.fieldline, d.panel) >= 3 && t.contrastRatio(d.fieldline, d.bg) >= 3, `${th} ${m}: input borders 3:1`);
    assert.ok(t.contrastRatio(d["on-accent"], d.accent) >= 4.5, `${th} ${m}: text on the accent`);
    assert.ok(t.contrastRatio(d.sidestrong, d.side) >= 4.5, `${th} ${m}: the sidebar's strong text`);
    assert.strictEqual(d.nightlybg, base.nightlybg, "colours with no rule stay as they were");
    for (const k of ["out", "move", "rsv"]) assert.ok(t.contrastRatio(d["ico-" + k], d["ico-" + k + "-bg"]) >= 3, `${th} ${m}: row icon ${k} 3:1`);
  }
  const base = builtin("default", "light");
  const d = t.deriveTheme(Object.assign({}, base, { panel: "#fff8e1", accent: "#006d5b" }), base);
  assert.strictEqual(d.surface, "#fff8e1"); assert.strictEqual(d.field, "#fff8e1");
  assert.strictEqual(d["series-1"], "#006d5b"); assert.notStrictEqual(d.accentsoft, base.accentsoft);
});

test("theme.js: theme JSON — the full set out, missing colours filled from basedOn, unknown keys listed, hex only", () => {
  const { t } = loadTheme();
  const fill = (th, m) => builtin(th, m);
  const out = JSON.parse(t.themeToJSON(mine()));
  assert.deepStrictEqual(Object.keys(out), ["format", "version", "name", "basedOn", "split", "light", "dark"]);
  assert.strictEqual(out.format, "kisiauthong-theme"); assert.strictEqual(out.version, 1); assert.strictEqual(out.dark, null);
  assert.deepStrictEqual(Object.keys(out.light), t.THEME_TOKENS);
  // round trip
  assert.deepStrictEqual(t.themeFromJSON(t.themeToJSON(mine()), fill), { theme: { name: "Teal night", basedOn: "cool", split: false, light: mine().light, dark: null }, ignored: [] });
  // a short paste: the rest from Warm, its unknown keys named, #RGB accepted
  const r = t.themeFromJSON(JSON.stringify({ format: "kisiauthong-theme", version: 1, name: " Sunset ", basedOn: "warm", split: true, light: { "amt-out": "#C00", glow: "#123456" }, dark: { bg: "#101010" }, extra: 1 }), fill);
  assert.strictEqual(r.theme.name, "Sunset");
  assert.strictEqual(r.theme.light["amt-out"], "#cc0000");
  assert.strictEqual(r.theme.light.bg, builtin("warm", "light").bg);
  assert.strictEqual(r.theme.dark.bg, "#101010");
  assert.strictEqual(r.theme.dark.panel, builtin("warm", "dark").panel);
  assert.deepStrictEqual(r.ignored, ["extra", "light.glow"]);
  assert.deepStrictEqual(t.themeFromJSON(JSON.stringify({ format: "kisiauthong-theme", version: 1, basedOn: "cool", light: {}, dark: { bg: "#000" } }), fill).ignored, ["dark"], "dark colours of a light-only theme");
  const err = (o) => t.themeFromJSON(typeof o === "string" ? o : JSON.stringify(o), fill);
  assert.deepStrictEqual(err("{not json"), { error: "json" });
  assert.deepStrictEqual(err([1]), { error: "json" });
  assert.deepStrictEqual(err({ version: 1 }), { error: "format" });
  assert.deepStrictEqual(err({ format: "kisiauthong-theme", version: 2 }), { error: "version" });
  assert.deepStrictEqual(err({ format: "kisiauthong-theme", version: 1, basedOn: "neon" }), { error: "basedOn" });
  assert.deepStrictEqual(err({ format: "kisiauthong-theme", version: 1, light: { bg: "rgb(0,0,0)" } }), { error: "hex", key: "light.bg" });
  assert.deepStrictEqual(err({ format: "kisiauthong-theme", version: 1, light: { bg: "red" } }), { error: "hex", key: "light.bg" });
});

test("theme.js: custom themes are kept on the device; missing colours come from the base; a choice of a gone theme is Default", () => {
  const s = loadTheme();
  assert.strictEqual(s.t.writeCustomThemes([mine(), { id: "nope" }, mine({ id: "thm-older1", light: { bg: "#ffffff" } })]), true);
  const kept = s.t.readCustomThemes();
  assert.deepStrictEqual(kept.map((x) => x.id), ["thm-abc123", "thm-older1"], "what is not a theme is dropped");
  // a theme saved before a colour existed (here: all but one) gets the missing ones from its base theme
  assert.strictEqual(kept[1].light.bg, "#ffffff");
  assert.strictEqual(kept[1].light.panel, builtin("cool", "light").panel);
  assert.strictEqual(s.t.normTheme(mine({ split: true }), null), null, "split without dark colours");
  assert.ok(s.t.normTheme(mine({ split: true, dark: {} }), (th, m) => builtin(th, m)).dark.bg, "filled when a base is given");
  s.store["kisiauthong.theme"] = JSON.stringify({ theme: "thm-gone99", mode: "dark" });
  assert.deepStrictEqual(s.t.readThemePrefs(), { theme: "default", mode: "dark" });
  assert.match(s.t.newThemeId(), /^thm-[a-z0-9]{6,32}$/);
});

test("theme.js: a custom theme's colours go on <html> over its base; light-only themes stay light in dark mode", () => {
  const s = loadTheme({ media: { "(prefers-color-scheme: dark)": true } });
  s.t.writeCustomThemes([mine(), mine({ id: "thm-split01", split: true, dark: Object.assign(builtin("cool", "dark"), { "amt-out": "#ff8fb0" }) })]);
  s.t.writeThemePrefs({ theme: "thm-abc123", mode: "system" });
  assert.deepStrictEqual(s.t.applyTheme(), { theme: "cool", mode: "light", custom: "thm-abc123" });
  assert.deepStrictEqual({ ...s.html.dataset }, { theme: "cool", mode: "light" });
  assert.strictEqual(s.props["--amt-out"], "#b42350");
  assert.strictEqual(s.meta.content, mine().light.side);
  s.t.writeThemePrefs({ theme: "thm-split01", mode: "system" });
  assert.deepStrictEqual(s.t.applyTheme(), { theme: "cool", mode: "dark", custom: "thm-split01" });
  assert.strictEqual(s.props["--amt-out"], "#ff8fb0");
  s.t.writeThemePrefs({ theme: "warm", mode: "system" });
  s.t.applyTheme();
  assert.deepStrictEqual(s.props, {}, "a built-in theme leaves no inline colours");
  // the system asking for more contrast wins over a custom theme too
  s.t.writeThemePrefs({ theme: "thm-abc123", mode: "light" });
  s.media["(prefers-contrast: more)"] = true;
  assert.deepStrictEqual(s.t.applyTheme(), { theme: "contrast", mode: "light" });
  assert.deepStrictEqual(s.props, {});
});

test("theme.js: merging synced themes by id keeps the newer copy", () => {
  const { t } = loadTheme();
  const a = [mine({ name: "Old", updatedAt: "2026-11-24T01:00:00Z" }), mine({ id: "thm-local01" })];
  const b = [mine({ name: "New", updatedAt: "2026-11-24T02:00:00Z" }), mine({ id: "thm-remote1" })];
  const m = t.mergeThemes(a, b);
  assert.deepStrictEqual(m.map((x) => [x.id, x.name]), [["thm-abc123", "New"], ["thm-local01", "Teal night"], ["thm-remote1", "Teal night"]]);
  assert.strictEqual(t.mergeThemes(b.slice().reverse(), a)[1].name, "New", "whichever side it comes from");
  assert.strictEqual(t.sameThemes(m, m.slice().reverse()), true);
  assert.strictEqual(t.sameThemes(a, b), false);
});

test("theme.js: signed out is Default from the first frame after a reload (issue #101)", () => {
  const store = { "kisiauthong.theme": JSON.stringify({ theme: "warm", mode: "light" }) };
  let s = loadTheme({ store });
  assert.strictEqual(s.html.dataset.theme, "warm");
  s.t.setThemeSignedOut(true);
  assert.strictEqual(store["kisiauthong.signedOut"], "1");
  s = loadTheme({ store }); // the reload, before app.js has asked the server anything
  assert.strictEqual(s.html.dataset.theme, "default");
  s.t.setThemeSignedOut(false);
  assert.ok(!("kisiauthong.signedOut" in store));
  assert.strictEqual(loadTheme({ store }).html.dataset.theme, "warm");
});

require("./run-tests.js")(tests);
