// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The window frame's buttons (issue #32). Dragging and double-click to
// maximize come from Tauri's data-tauri-drag-region. Only this bundled
// webview has the window permissions; server pages have none.
"use strict";
(function () {
  const t = window.__TAURI_INTERNALS__;
  if (!t) return;
  const label = t.metadata && t.metadata.currentWindow ? t.metadata.currentWindow.label : "main";
  const win = (cmd) => t.invoke("plugin:window|" + cmd, { label });
  if (/Mac/.test(navigator.platform)) document.documentElement.classList.add("mac");
  document.getElementById("min").addEventListener("click", () => win("minimize"));
  document.getElementById("max").addEventListener("click", () => win("toggle_maximize"));
  document.getElementById("close").addEventListener("click", () => win("close"));
  window.addEventListener("focus", () => document.body.classList.remove("blur"));
  window.addEventListener("blur", () => document.body.classList.add("blur"));
})();
