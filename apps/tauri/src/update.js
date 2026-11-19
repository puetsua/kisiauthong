// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The app's App updates screen (ADR 0020), opened with mode=update from
// Settings → About → Check for updates (Android only for now). It checks at
// once, because the user just asked to; installing needs a second tap. The
// shell picks what to install (src-tauri/src/update.rs); this page only shows
// what it found and passes no address or version back.
"use strict";
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("mode") !== "update") return;
  const { pickLang } = window.KstConnect;
  const $ = (id) => document.getElementById(id);
  const call = (cmd, args) => {
    const t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args || {}) : Promise.reject(new Error("not running in the app"));
  };
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
  const reason = (e) => String(e && e.message ? e.message : e);
  let S = window.KstStrings.en, found = null, busy = false;

  function setButton(label, disabled) {
    $("updGo").textContent = label;
    $("updGo").disabled = !!disabled;
  }
  // the shell's errors are "code" or "code: detail" (src-tauri/src/update.rs)
  function describe(e) {
    const raw = reason(e), m = raw.match(/^(\w+)(?::\s*([\s\S]*))?$/);
    const bad = S.updErrBadRelease;
    const words = {
      unreachable: S.updErrUnreachable, status: S.updErrStatus, badAnswer: S.updErrBadAnswer, noApk: S.updErrNoApk,
      elsewhere: bad, noChecksum: bad, empty: bad, checksum: S.updErrChecksum, download: S.updErrDownload,
      checkFirst: S.updErrCheckFirst, unsupported: S.updErrUnsupported,
    };
    return m && words[m[1]] ? fill(words[m[1]], { detail: m[2] || "" }) : raw;
  }
  function showError(title, text) {
    $("updErrTitle").textContent = title;
    $("updErrText").textContent = text;
    $("updErr").hidden = false;
  }

  async function check() {
    busy = true;
    found = null;
    $("updErr").hidden = true;
    $("updStatus").textContent = "";
    setButton(S.updChecking, true);
    try {
      const r = await call("update_check");
      $("updVersion").textContent = fill(S.updVersion, { version: r.current });
      found = r.update || null;
      $("updStatus").textContent = found ? fill(S.updFound, { version: found.version, size: mb(found.size) }) : S.updLatest;
    } catch (e) {
      showError(S.updCheckFailed, describe(e));
    }
    busy = false;
    setButton(found ? S.updInstall : S.updCheck);
  }

  async function install() {
    busy = true;
    $("updErr").hidden = true;
    setButton(S.updDownloading, true);
    try {
      const status = await call("update_install");
      $("updStatus").textContent = status === "permission" ? S.updPermission : S.updStarted;
    } catch (e) {
      showError(S.updInstallFailed, describe(e));
    }
    busy = false;
    // still enabled after the installer opened: each download is a new file, so a retry is safe
    setButton(S.updInstall);
  }

  async function init() {
    let st = { locale: "", version: "" };
    try { st = await call("app_state"); } catch (e) { /* a plain browser */ }
    const lang = pickLang([q.get("lang"), st.locale, ...(navigator.languages || [])].filter(Boolean));
    S = window.KstStrings[lang];
    document.documentElement.lang = lang === "zh-TW" ? "zh-Hant-TW" : "en";
    $("form").hidden = true;
    $("upd").hidden = false;
    $("updTitle").textContent = S.updTitle;
    $("updVersion").textContent = st.version ? fill(S.updVersion, { version: st.version }) : "";
    $("updBack").textContent = S.updBack;
    $("updHint").textContent = S.updHint;
    $("updGo").addEventListener("click", () => { if (!busy) (found ? install() : check()); });
    // back to Settings → About of the server that opened this screen; the shell checks it is a saved one
    $("updBack").addEventListener("click", () => { call("cancel_form", { back: q.get("back") }).catch(() => history.back()); });
    check();
  }
  init();
})();
