// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The app's server screen (ADR 0019). The shell opens it with a query string:
//   (none)     at launch: with no saved server it asks for one (the server
//              form); with one saved it never shows the form (issue #126): it
//              checks that server and opens it in the screen's place, or shows
//              why it cannot, with Retry and Change server
//   mode=add   Settings → Servers → Add server
//   mode=edit  Settings → Servers → Edit, with id=<profile id>
//   mode=update  Settings → About → Check for updates (Android): update.js
// lang=<tag> comes from the web UI so the screen keeps its language; otherwise
// the system locale decides. On success the shell moves the window to the server.
// index.html starts with every view hidden, so nothing shows before this
// script has decided which one to show.
"use strict";
(function () {
  const { checkServer, normalizeServerUrl, pickLang, serverToOpen } = window.KstConnect;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  if (q.get("mode") === "update") return;
  const call = (cmd, args) => {
    const t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args || {}) : Promise.reject(new Error("not running in the app"));
  };
  const reason = (err) => String(err && err.message ? err.message : err);
  let mode = ["add", "edit"].includes(q.get("mode")) ? q.get("mode") : "start";
  let S = window.KstStrings.en, editing = null, busy = false;
  // at launch: the saved server being opened, and which check is the latest
  // (a check the user left with Change server must not open the server)
  let opening = null, attempt = 0;

  function show(view) {
    $("form").hidden = view !== "form";
    $("open").hidden = view !== "open";
  }
  function setBusy(on) {
    busy = on;
    $("go").disabled = on;
    $("url").readOnly = on;
    $("name").readOnly = on;
    $("go").textContent = on ? S.connecting : mode === "edit" ? S.save : S.connect;
  }
  function clearError() {
    $("err").hidden = true;
    $("url").classList.remove("err");
    $("url").removeAttribute("aria-invalid");
  }
  // kind: invalid | unreachable | notServer | cleartext | certificate | save
  // box: "err" (the form) or "openErr" (the launch view)
  function fillError(box, kind, url) {
    $(box + "Title").textContent = S[kind + "Title"];
    const text = $(box + "Text");
    text.textContent = "";
    S[kind + "Text"].split("{url}").forEach((part, i) => {
      if (i) { const c = document.createElement("code"); c.textContent = url; text.append(c); }
      text.append(part);
    });
    $(box).hidden = false;
  }
  function showError(kind, url) {
    fillError("err", kind, url);
    $("url").classList.add("err");
    $("url").setAttribute("aria-invalid", "true");
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    clearError();
    let url = "";
    if (editing) {
      const n = normalizeServerUrl($("url").value);
      if (n.ok && n.url === editing.url) url = n.url; // only the name changed: nothing to check
    }
    setBusy(true);
    if (!url) {
      const typed = $("url").value.trim();
      const r = await checkServer(typed, (u) => call("probe", { url: u }));
      if (!r.ok) {
        setBusy(false);
        showError(r.kind, r.url || typed);
        return;
      }
      url = r.url;
    }
    $("url").value = url;
    // name: null keeps a saved name (at launch there is no name field), "" clears it
    const name = mode === "start" ? null : $("name").value.trim();
    try {
      await call("save_server", { id: editing ? editing.id : null, name, url, connect: mode !== "edit" });
    } catch (err) {
      setBusy(false);
      showError("save", reason(err));
    }
    // on success the shell navigates away; the button keeps saying Connecting… until then
  }

  // At launch with a saved server (issue #126): check it and open it in the
  // screen's place, as Connect would, but without the form. A server that
  // cannot be reached keeps this view, with the reason, Retry and Change server.
  async function openSaved() {
    const n = ++attempt;
    show("open");
    $("openErr").hidden = true;
    $("openRetry").hidden = true;
    $("openStatus").textContent = S.connecting;
    let r = await checkServer(opening.url, (u) => call("probe", { url: u }));
    if (n !== attempt) return;
    if (r.ok) {
      try {
        // its own entry, also when a redirect moved its address (as Connect saves it)
        await call("save_server", { id: opening.id, name: null, url: r.url, connect: true });
        return; // the shell opens the server; Connecting… stays until then
      } catch (err) {
        r = { ok: false, kind: "save", url: reason(err) };
      }
      if (n !== attempt) return;
    }
    $("openStatus").textContent = "";
    fillError("openErr", r.kind, r.url || opening.url);
    $("openRetry").hidden = false;
    $("openRetry").focus();
  }

  // Change server at launch: the server form, filled with the saved address.
  // Connect adds (or reuses) the address typed and opens it; the saved server
  // stays in Settings → Servers. Cancel goes back to opening the saved server.
  function changeServer() {
    attempt++; // a check still running is no longer wanted
    clearError();
    $("title").textContent = S.changeServer;
    $("url").value = opening.url;
    $("cancel").hidden = false;
    setBusy(false);
    show("form");
    $("url").focus();
  }

  async function init() {
    let st = { locale: "", active: null, servers: [] };
    try { st = await call("app_state"); } catch (e) { /* a plain browser: show the empty form */ }
    const lang = pickLang([q.get("lang"), st.locale, ...(navigator.languages || [])].filter(Boolean));
    S = window.KstStrings[lang];
    document.documentElement.lang = lang === "zh-TW" ? "zh-Hant-TW" : "en";
    if (mode === "edit") {
      editing = st.servers.find((s) => s.id === q.get("id")) || null;
      if (!editing) mode = "add";
    }
    $("title").textContent = mode === "add" ? S.addTitle : mode === "edit" ? S.editTitle : S.firstTitle;
    $("lead").textContent = S.firstLead;
    $("lead").hidden = mode === "edit";
    $("nameRow").hidden = mode === "start";
    $("nameLabel").textContent = S.nameLabel;
    $("urlLabel").textContent = S.urlLabel;
    const ex = document.createElement("span");
    ex.className = "mono";
    ex.textContent = "https://example.com/kisiauthong/";
    $("hint").textContent = S.hint + " ";
    $("hint").append(ex);
    $("cancel").textContent = S.cancel;
    $("cancel").hidden = mode === "start" || !st.active;
    setBusy(false);
    if (editing) { $("name").value = editing.name || ""; $("url").value = editing.url; }
    opening = mode === "start" ? serverToOpen(st) : null;
    if (!opening) { show("form"); return; }
    let host = opening.url;
    try { host = new URL(opening.url).host; } catch (e) { /* shown as saved */ }
    $("openTitle").textContent = opening.name || host;
    $("openUrl").textContent = opening.url;
    $("openRetry").textContent = S.retry;
    $("openChange").textContent = S.changeServer;
    openSaved();
  }

  $("form").addEventListener("submit", submit);
  $("url").addEventListener("input", () => { $("url").classList.remove("err"); $("url").removeAttribute("aria-invalid"); });
  $("cancel").addEventListener("click", () => {
    if (opening) { if (!busy) openSaved(); }
    else call("cancel_form").catch(() => {});
  });
  $("openRetry").addEventListener("click", () => { openSaved(); });
  $("openChange").addEventListener("click", changeServer);
  init();
})();
