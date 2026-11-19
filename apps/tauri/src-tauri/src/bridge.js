// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Injected by the app into every page of its window (ADR 0019). It gives the
// server's web UI one object, kisiauthongApp, for Settings → Servers, and sends
// links meant for a new tab to the system browser. The app only answers these
// calls from the bundled server screen and from the origins of saved servers.
(function () {
  "use strict";
  if (window.top !== window || window.kisiauthongApp) return;
  var call = function (cmd, args) {
    var t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args || {}) : Promise.reject(new Error("app bridge unavailable"));
  };
  Object.defineProperty(window, "kisiauthongApp", {
    value: Object.freeze({
      // the bridge's own version: 2 added appInfo and updates
      version: 2,
      // → { active: id | null, servers: [{ id, name?, url, lastUsed? }] }
      servers: function () { return call("servers"); },
      // switch the window to another saved server
      use: function (id) { return call("use_server", { id: id }); },
      // forget a server; the one in use falls back to the last used, the last one to the server screen
      remove: function (id) { return call("remove_server", { id: id }); },
      // open the app's server screen to add or edit one, in the web UI's language
      add: function (lang) { return call("open_server_form", { mode: "add", id: null, lang: lang || null }); },
      edit: function (id, lang) { return call("open_server_form", { mode: "edit", id: id, lang: lang || null }); },
      // a native yes/no dialog → Promise<boolean>; window.confirm() does nothing in
      // WKWebView (macOS, iOS) because the webview has no confirm panel
      confirm: function (message, ok, cancel) { return call("confirm", { message: String(message), ok: ok || null, cancel: cancel || null }); },
      // → { version: "0.3.0", platform: "android" | "ios" | "macos" | "windows" | "linux", updates: boolean }
      appInfo: function () { return call("app_info"); },
      // open the app's App updates screen, which checks at once (only where appInfo().updates)
      updates: function (lang) { return call("open_updates", { lang: lang || null }); },
    }),
  });
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target !== "_blank" || a.hasAttribute("download")) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (!/^(https?|mailto):$/.test(u.protocol)) return;
    e.preventDefault();
    call("open_external", { url: u.href }).catch(function () {});
  }, true);
})();
