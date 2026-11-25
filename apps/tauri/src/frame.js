// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The window frame's buttons (ADR 0026). Dragging and double-click to maximize
// come from Tauri's data-tauri-drag-region. Only this bundled webview has the
// window permissions; server pages have none.
//
// The shell calls kstFrame.focus() and kstFrame.max() when the window gains or
// loses focus or changes size: this webview's own focus events only say
// whether the frame or the page below it has the keyboard.
"use strict";
(function () {
  const t = window.__TAURI_INTERNALS__;
  if (!t) return;
  const label = t.metadata && t.metadata.currentWindow ? t.metadata.currentWindow.label : "main";
  const win = (cmd) => t.invoke("plugin:window|" + cmd, { label });
  const S = window.KstStrings[window.KstConnect.pickLang(navigator.languages || [navigator.language])];
  document.documentElement.lang = S === window.KstStrings["zh-TW"] ? "zh-Hant-TW" : "en";
  if (/Mac/.test(navigator.platform)) document.documentElement.classList.add("mac");
  // the dev build (issue #114): the shell sets this flag before the page loads
  if (window.kstDevBuild === true) document.querySelector(".name").append(" Dev");

  const max = document.getElementById("max");
  const named = (el, text) => { el.setAttribute("aria-label", text); el.title = text; };
  named(document.getElementById("min"), S.frameMinimize);
  named(document.getElementById("close"), S.frameClose);
  document.getElementById("min").addEventListener("click", () => win("minimize"));
  max.addEventListener("click", () => win("toggle_maximize"));
  document.getElementById("close").addEventListener("click", () => win("close"));
  // the webview's own menu (Back, Reload, Print…) makes no sense on a title bar
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  // A click on the bar gives this webview the keyboard; hand it back to the
  // page, so typing and shortcuts keep working (and after Alt+Tab too).
  window.addEventListener("focus", () => t.invoke("plugin:webview|set_webview_focus", { label: "content" }).catch(() => {}));

  window.kstFrame = {
    focus(on) { document.body.classList.toggle("blur", !on); },
    max(on) {
      document.body.classList.toggle("maxed", !!on);
      named(max, on ? S.frameRestore : S.frameMaximize);
    },
  };
  window.kstFrame.max(false);
})();
