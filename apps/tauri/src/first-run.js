// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The app's server screen (ADR 0019). The shell opens it with a query string:
//   (none)     at launch: with no saved server it asks for one; with one in use
//              it checks that server and opens it, or shows why it cannot
//   mode=add   Settings → Servers → Add server
//   mode=edit  Settings → Servers → Edit, with id=<profile id>
// lang=<tag> comes from the web UI so the screen keeps its language; otherwise
// the system locale decides. On success the shell moves the window to the server.
"use strict";
(function () {
  const { checkServer, normalizeServerUrl, pickLang } = window.KstConnect;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const call = (cmd, args) => {
    const t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args || {}) : Promise.reject(new Error("not running in the app"));
  };
  let mode = ["add", "edit"].includes(q.get("mode")) ? q.get("mode") : "start";
  let S = window.KstStrings.en, editing = null, busy = false;

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
  function showError(kind, url) {
    $("errTitle").textContent = S[kind + "Title"];
    const box = $("errText");
    box.textContent = "";
    S[kind + "Text"].split("{url}").forEach((part, i) => {
      if (i) { const c = document.createElement("code"); c.textContent = url; box.append(c); }
      box.append(part);
    });
    $("err").hidden = false;
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
      showError("save", String(err && err.message ? err.message : err));
    }
    // on success the shell navigates away; the button keeps saying Connecting… until then
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
    const active = st.servers.find((s) => s.id === st.active);
    if (mode === "start" && active) { $("url").value = active.url; submit(); }
  }

  $("form").addEventListener("submit", submit);
  $("url").addEventListener("input", () => { $("url").classList.remove("err"); $("url").removeAttribute("aria-invalid"); });
  $("cancel").addEventListener("click", () => { call("cancel_form").catch(() => {}); });
  init();
})();
