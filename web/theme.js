// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Themes (issue #85, ADR 0027). Loaded in <head> right after style.css, so the
// page is drawn in its theme from the first frame. The choice is kept on this
// device only (localStorage); the colours themselves are the [data-theme] token
// blocks at the top of style.css.
"use strict";
const THEMES = ["default", "contrast", "warm", "cool"];
const THEME_MODES = ["system", "light", "dark"];
const THEME_KEY = "kisiauthong.theme";
const THEME_DEFAULTS = { theme: "default", mode: "system" };
let themeKept = null; // a choice the browser would not store (private window, blocked or full storage): it wins for this page

// the saved choice, or the defaults when there is none or it cannot be read
function readThemePrefs() {
  let v = themeKept;
  if (!v) try { v = JSON.parse(localStorage.getItem(THEME_KEY) || "null"); } catch (e) { /* private window, blocked storage, bad JSON */ }
  v = v && typeof v === "object" ? v : {};
  return { theme: THEMES.includes(v.theme) ? v.theme : THEME_DEFAULTS.theme, mode: THEME_MODES.includes(v.mode) ? v.mode : THEME_DEFAULTS.mode };
}
function writeThemePrefs(p) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify({ theme: p.theme, mode: p.mode })); themeKept = null; return true; }
  catch (e) { themeKept = { theme: p.theme, mode: p.mode }; return false; }
}
// What the page shows. A system that asks for more contrast (or forces its own colours)
// gets High contrast whatever theme was chosen; "system" mode follows the system's light/dark.
function resolveTheme(prefs, sys) {
  return {
    theme: sys.moreContrast ? "contrast" : prefs.theme,
    mode: prefs.mode === "system" ? (sys.dark ? "dark" : "light") : prefs.mode,
  };
}
const THEME_QUERIES = { dark: ["(prefers-color-scheme: dark)"], moreContrast: ["(prefers-contrast: more)", "(forced-colors: active)"] };
function systemAppearance() {
  const on = (q) => { try { return typeof matchMedia === "function" && matchMedia(q).matches; } catch (e) { return false; } };
  return { dark: THEME_QUERIES.dark.some(on), moreContrast: THEME_QUERIES.moreContrast.some(on) };
}
// Signed out, the sign-in screen is always Default in the system's light or dark (it belongs to
// no one yet); app.js sets this while the sign-in screen is up and clears it after signing in.
let themeSignedOut = false;
function setThemeSignedOut(on) { themeSignedOut = !!on; return applyTheme(); }
function applyTheme() {
  const r = resolveTheme(themeSignedOut ? THEME_DEFAULTS : readThemePrefs(), systemAppearance());
  const el = document.documentElement;
  el.dataset.theme = r.theme;
  el.dataset.mode = r.mode;
  // the browser's own bars (Android Chrome, installed web app) take the theme's sidebar colour
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && typeof getComputedStyle === "function") {
    const side = String(getComputedStyle(el).getPropertyValue("--side") || "").trim();
    if (side) meta.setAttribute("content", side);
  }
  return r;
}
applyTheme();
if (typeof matchMedia === "function") {
  for (const q of [...THEME_QUERIES.dark, ...THEME_QUERIES.moreContrast]) {
    try { matchMedia(q).addEventListener("change", () => { applyTheme(); if (typeof onThemeChange === "function") onThemeChange(); }); } catch (e) { /* old engines */ }
  }
}
// another tab of this site changed the choice
if (typeof addEventListener === "function") addEventListener("storage", (e) => { if (e.key === THEME_KEY) { themeKept = null; applyTheme(); if (typeof onThemeChange === "function") onThemeChange(); } });
