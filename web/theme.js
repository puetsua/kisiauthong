// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Themes (issue #85, ADR 0027). Loaded in <head> right after style.css, so the
// page is drawn in its theme from the first frame. The choice and the custom
// themes are kept on this device (localStorage) unless the user turns on sync
// (app.js); the built-in colours are the [data-theme] token blocks at the top
// of style.css. The second half is plain functions the theme editor uses:
// colour maths, derived colours, the theme JSON and merging synced themes.
"use strict";
const THEMES = ["default", "contrast", "warm", "cool"];
const THEME_MODES = ["system", "light", "dark"];
const THEME_KEY = "kisiauthong.theme";
const THEMES_KEY = "kisiauthong.themes";
const SIGNED_OUT_KEY = "kisiauthong.signedOut";
const THEME_DEFAULTS = { theme: "default", mode: "system" };
const MAX_CUSTOM_THEMES = 20;
// The colours a theme sets, in style.css order. A custom theme stores all of them; the few
// tokens that are not plain colours (--sideline, --scrim, --shadow-rgb, --toast-line,
// --toast-hover) always come from the theme it is based on. scripts/test-themes.js checks this list.
const THEME_TOKENS = ["bg", "panel", "surface", "field", "soft", "hover", "hover2", "line", "rule", "fieldline", "track", "ink", "muted",
  "on-accent", "on-status", "side", "side2", "sidehover", "sidetext", "sidemuted", "sidestrong", "accent", "accent2", "accentsoft", "focus",
  "amt-in", "amt-out", "pos", "posbg", "amber", "amberbg", "amberline", "amberink", "plannedbg", "peekbg", "red", "redbg",
  "sched", "schedbg", "schedink", "schedline", "nightlybg", "nightlyline", "nightlyink", "nightlysideink",
  "ico-out", "ico-out-bg", "ico-move", "ico-move-bg", "ico-rsv", "ico-rsv-bg", "toast-bg", "toast-ink", "cropbg",
  "series-1", "series-2", "series-3", "series-4", "series-5"];
// the colours the editor offers; every other one is derived from these (deriveTheme) or kept from the base
const THEME_MAIN = ["amt-in", "amt-out", "bg", "panel", "ink", "muted", "line", "accent", "side", "sidetext", "pos", "amber", "red", "sched"];
const THEME_JSON_FORMAT = "kisiauthong-theme";
const THEME_JSON_VERSION = 1;
const THEME_ID_RE = /^thm-[a-z0-9]{6,32}$/;

// what the browser would not store (private window, blocked or full storage) wins for this page
let themeKept = null, themesKept = null;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };

// ---- colours ----
function normHex(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v == null ? "" : v).trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
// a → b by t (0 … 1)
function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
function luminance(h) {
  const c = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// WCAG 2 contrast ratio, 1 … 21
function contrastRatio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function hexToHsv(h) {
  const [r, g, b] = hexRgb(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbHex([f(5), f(3), f(1)].map((x) => x * 255));
}
// white or near-black, whichever reads better on all the given backgrounds
function bestText(bgs) {
  const score = (c) => Math.min(...bgs.map((b) => contrastRatio(c, b)));
  return score("#ffffff") >= score("#16121c") ? "#ffffff" : "#16121c";
}
// from → toward, in steps, until it stands out by `min` against every background
function reachContrast(from, toward, bgs, min) {
  for (let i = 0; i <= 20; i++) { const c = mixHex(from, toward, i / 20); if (bgs.every((b) => contrastRatio(c, b) >= min)) return c; }
  return toward;
}
// Every colour of one mode from its main colours (THEME_MAIN); the rest (the nightly chip, the
// cropper, chart colours after the first) stays as in `base`, the mode's current colours.
function deriveTheme(main, base) {
  const t = Object.assign({}, base);
  for (const k of THEME_MAIN) if (normHex(main[k])) t[k] = normHex(main[k]);
  const mix = mixHex;
  t.surface = t.panel; t.field = t.panel;
  t.soft = mix(t.panel, t.bg, 0.5);
  t.hover = mix(t.panel, t.ink, 0.05); t.hover2 = mix(t.panel, t.ink, 0.1);
  t.rule = mix(t.panel, t.line, 0.7); t.track = mix(t.panel, t.ink, 0.12);
  t.fieldline = reachContrast(t.line, t.ink, [t.panel, t.bg], 3);
  t["on-accent"] = bestText([t.accent]);
  t.accent2 = mix(t.accent, t.ink, 0.15); t.accentsoft = mix(t.panel, t.accent, 0.12);
  t.focus = t.amber;
  t.side2 = mix(t.side, t.sidetext, 0.18); t.sidehover = mix(t.side, t.sidetext, 0.1);
  t.sidemuted = mix(t.sidetext, t.side, 0.3); t.sidestrong = bestText([t.side, t.side2]);
  t.posbg = mix(t.panel, t.pos, 0.12);
  t.amberbg = mix(t.panel, t.amber, 0.1); t.amberline = mix(t.panel, t.amber, 0.35); t.amberink = mix(t.amber, t.ink, 0.45);
  t.plannedbg = mix(t.panel, t.amber, 0.18); t.peekbg = mix(t.panel, t.amber, 0.35);
  t.redbg = mix(t.panel, t.red, 0.1);
  t.schedbg = mix(t.panel, t.sched, 0.1); t.schedink = mix(t.sched, t.ink, 0.4); t.schedline = mix(t.panel, t.sched, 0.3);
  t["on-status"] = bestText([t.amber, t.red]);
  // the row icons: a tint of the card with the glyph in the colour it stands for (spending, a transfer, a reserve)
  t["ico-out-bg"] = mix(t.panel, t["amt-out"], 0.14); t["ico-out"] = reachContrast(t["amt-out"], t.ink, [t["ico-out-bg"]], 3);
  t["ico-move-bg"] = mix(t.panel, t.sched, 0.12); t["ico-move"] = reachContrast(t.sched, t.ink, [t["ico-move-bg"]], 3);
  t["ico-rsv-bg"] = mix(t.panel, t.accent, 0.12); t["ico-rsv"] = reachContrast(t.accent, t.ink, [t["ico-rsv-bg"]], 3);
  t["toast-bg"] = t.side; t["toast-ink"] = t.sidestrong;
  t["series-1"] = t.accent;
  return t;
}

// ---- custom themes ----
// One theme, cleaned: unknown or broken colours dropped and missing ones filled from `fill`
// (a function (basedOn, mode) → colours) when given; null when it is not a complete theme.
function normTheme(t, fill) {
  if (!t || typeof t !== "object" || !THEME_ID_RE.test(t.id) || !THEMES.includes(t.basedOn)) return null;
  const name = String(t.name || "").trim().slice(0, 60);
  if (!name) return null;
  const colours = (src, mode) => {
    const base = fill ? fill(t.basedOn, mode) : null, out = {};
    for (const k of THEME_TOKENS) { const v = normHex(src && src[k]) || (base && base[k]); if (v) out[k] = v; }
    return THEME_TOKENS.every((k) => out[k]) ? out : null;
  };
  const split = !!t.split, light = colours(t.light, "light"), dark = split ? colours(t.dark, "dark") : null;
  if (!light || (split && !dark)) return null;
  return { id: t.id, name, basedOn: t.basedOn, split, light, dark, updatedAt: Date.parse(t.updatedAt) ? t.updatedAt : new Date(0).toISOString() };
}
function readCustomThemes() {
  let v = themesKept;
  if (!v) try { v = JSON.parse(lsGet(THEMES_KEY) || "[]"); } catch (e) { v = []; }
  return (Array.isArray(v) ? v : []).map((t) => normTheme(t)).filter(Boolean).slice(0, MAX_CUSTOM_THEMES);
}
function writeCustomThemes(list) {
  const v = list.slice(0, MAX_CUSTOM_THEMES);
  if (lsSet(THEMES_KEY, JSON.stringify(v))) { themesKept = null; return true; }
  themesKept = v; return false;
}
const customTheme = (id, list) => (list || readCustomThemes()).find((t) => t.id === id) || null;
function newThemeId() {
  const a = new Uint8Array(8);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return "thm-" + [...a].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}
// Merge two lists by id, the newer updatedAt winning (ADR 0027); `a`'s order first, then what only `b` has.
function mergeThemes(a, b) {
  const by = new Map();
  for (const t of [...a, ...b]) { const o = by.get(t.id); if (!o || Date.parse(t.updatedAt) > Date.parse(o.updatedAt)) by.set(t.id, t); }
  return [...by.values()];
}
// the same themes at the same versions
const sameThemes = (a, b) => a.length === b.length && a.every((t) => b.some((u) => u.id === t.id && u.updatedAt === t.updatedAt));

// ---- theme JSON (the editor's copy / paste field) ----
function themeToJSON(t) {
  const full = (m) => Object.fromEntries(THEME_TOKENS.map((k) => [k, m[k]]));
  return JSON.stringify({ format: THEME_JSON_FORMAT, version: THEME_JSON_VERSION, name: t.name, basedOn: t.basedOn, split: !!t.split, light: full(t.light), dark: t.split ? full(t.dark) : null }, null, 2);
}
// A pasted theme. Missing colours are filled from basedOn's (fill(basedOn, mode)); unknown keys are
// listed in `ignored`; anything but a hex colour is refused. → { theme, ignored } or { error, key }
function themeFromJSON(text, fill) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return { error: "json" }; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "json" };
  if (o.format !== THEME_JSON_FORMAT) return { error: "format" };
  if (o.version !== THEME_JSON_VERSION) return { error: "version" };
  const basedOn = o.basedOn == null ? "default" : o.basedOn;
  if (!THEMES.includes(basedOn)) return { error: "basedOn" };
  const known = ["format", "version", "name", "basedOn", "split", "light", "dark", "id", "updatedAt"];
  const ignored = Object.keys(o).filter((k) => !known.includes(k));
  const split = !!o.split, out = {};
  for (const mode of split ? ["light", "dark"] : ["light"]) {
    const src = o[mode] && typeof o[mode] === "object" && !Array.isArray(o[mode]) ? o[mode] : {};
    const base = fill(basedOn, mode), m = {};
    for (const [k, v] of Object.entries(src)) {
      if (!THEME_TOKENS.includes(k)) { ignored.push(`${mode}.${k}`); continue; }
      const h = normHex(v);
      if (!h) return { error: "hex", key: `${mode}.${k}` };
      m[k] = h;
    }
    for (const k of THEME_TOKENS) if (!m[k]) m[k] = base[k];
    out[mode] = m;
  }
  if (!split && o.dark != null) ignored.push("dark");
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
  return { theme: { name, basedOn, split, light: out.light, dark: split ? out.dark : null }, ignored };
}

// ---- choosing and applying ----
// the saved choice, or the defaults when there is none, it cannot be read, or its custom theme is gone
function readThemePrefs() {
  let v = themeKept;
  if (!v) try { v = JSON.parse(lsGet(THEME_KEY) || "null"); } catch (e) { /* bad JSON */ }
  v = v && typeof v === "object" ? v : {};
  const ok = THEMES.includes(v.theme) || (THEME_ID_RE.test(v.theme) && customTheme(v.theme));
  return { theme: ok ? v.theme : THEME_DEFAULTS.theme, mode: THEME_MODES.includes(v.mode) ? v.mode : THEME_DEFAULTS.mode };
}
function writeThemePrefs(p) {
  if (lsSet(THEME_KEY, JSON.stringify({ theme: p.theme, mode: p.mode }))) { themeKept = null; return true; }
  themeKept = { theme: p.theme, mode: p.mode }; return false;
}
// What the page shows. A system that asks for more contrast (or forces its own colours) gets
// High contrast whatever theme was chosen; "system" mode follows the system's light/dark; a custom
// theme without its own dark colours is light in either (ADR 0027). → { theme, mode[, custom] }
function resolveTheme(prefs, sys, customs) {
  const mode = prefs.mode === "system" ? (sys.dark ? "dark" : "light") : prefs.mode;
  if (sys.moreContrast) return { theme: "contrast", mode };
  const c = THEME_ID_RE.test(prefs.theme) ? customTheme(prefs.theme, customs) : null;
  if (c) return { theme: c.basedOn, mode: c.split ? mode : "light", custom: c.id };
  return { theme: THEMES.includes(prefs.theme) ? prefs.theme : THEME_DEFAULTS.theme, mode };
}
const THEME_QUERIES = { dark: ["(prefers-color-scheme: dark)"], moreContrast: ["(prefers-contrast: more)", "(forced-colors: active)"] };
function systemAppearance() {
  const on = (q) => { try { return typeof matchMedia === "function" && matchMedia(q).matches; } catch (e) { return false; } };
  return { dark: THEME_QUERIES.dark.some(on), moreContrast: THEME_QUERIES.moreContrast.some(on) };
}
// Signed out, the sign-in screen is always Default in the system's light or dark (it belongs to
// no one yet). app.js sets this while the sign-in screen is up and clears it after signing in; the
// device remembers it, so a signed-out reload is Default from the first frame (issue #101).
let themeSignedOut = lsGet(SIGNED_OUT_KEY) === "1";
function setThemeSignedOut(on) { themeSignedOut = !!on; lsSet(SIGNED_OUT_KEY, on ? "1" : null); return applyTheme(); }
// put a custom theme's colours (or none) as inline tokens on an element
function setThemeTokens(el, colours) {
  if (!el || !el.style || typeof el.style.setProperty !== "function") return;
  for (const k of THEME_TOKENS) { if (colours && colours[k]) el.style.setProperty("--" + k, colours[k]); else el.style.removeProperty("--" + k); }
}
function applyTheme() {
  const customs = readCustomThemes();
  const r = resolveTheme(themeSignedOut ? THEME_DEFAULTS : readThemePrefs(), systemAppearance(), customs);
  const el = document.documentElement;
  el.dataset.theme = r.theme;
  el.dataset.mode = r.mode;
  const c = r.custom ? customTheme(r.custom, customs) : null;
  setThemeTokens(el, c ? (c.split && r.mode === "dark" ? c.dark : c.light) : null);
  // the browser's own bars (Android Chrome, installed web app) take the theme's sidebar colour
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && typeof getComputedStyle === "function") {
    const side = String(getComputedStyle(el).getPropertyValue("--side") || "").trim();
    if (side) meta.setAttribute("content", side);
  }
  return r;
}
// a built-in theme's colours for one mode, read from style.css through a hidden element
function builtinTokens(theme, mode) {
  const el = document.createElement("span");
  el.hidden = true; el.dataset.theme = theme; el.dataset.mode = mode;
  (document.body || document.documentElement).appendChild(el);
  const cs = getComputedStyle(el), out = {};
  for (const k of THEME_TOKENS) out[k] = normHex(cs.getPropertyValue("--" + k)) || "#000000";
  el.remove();
  return out;
}

applyTheme();
const themeChanged = () => { applyTheme(); if (typeof onThemeChange === "function") onThemeChange(); };
if (typeof matchMedia === "function") {
  for (const q of [...THEME_QUERIES.dark, ...THEME_QUERIES.moreContrast]) {
    try { matchMedia(q).addEventListener("change", themeChanged); } catch (e) { /* old engines */ }
  }
}
// another tab of this site changed the choice or the custom themes
if (typeof addEventListener === "function") addEventListener("storage", (e) => {
  if (e.key === THEME_KEY) themeKept = null;
  if (e.key === THEMES_KEY) themesKept = null;
  if (e.key === THEME_KEY || e.key === THEMES_KEY) themeChanged();
});
