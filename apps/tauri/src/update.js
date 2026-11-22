// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The app's App updates screen (ADR 0020, 0024), opened with mode=update from
// Settings → About → Check for updates (Android, Windows, macOS). It checks at
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
  let S = window.KstStrings.en, found = null, busy = false, android = true;
  // Android hands the APK to the system installer; Windows and macOS install and restart
  const installLabel = () => (android ? S.updInstall : S.updRestart);

  function setButton(label, disabled) {
    $("updGo").textContent = label;
    $("updGo").disabled = !!disabled;
  }
  // the shell's errors are "code" or "code: detail" (src-tauri/src/update.rs)
  function describe(e) {
    const raw = reason(e), m = raw.match(/^(\w+)(?::\s*([\s\S]*))?$/);
    const bad = S.updErrBadRelease;
    const words = {
      unreachable: S.updErrUnreachable, status: S.updErrStatus, badAnswer: S.updErrBadAnswer, badVersion: S.updErrBadVersion, noApk: S.updErrNoApk,
      elsewhere: bad, noChecksum: bad, empty: bad, checksum: S.updErrChecksum, download: S.updErrDownload, installer: S.updErrInstaller,
      checkFirst: S.updErrCheckFirst, unsupported: S.updErrUnsupported,
      noRelease: S.updErrNoRelease, noBuild: S.updErrNoBuild, signature: S.updErrSignature, other: S.updErrOther,
    };
    return m && words[m[1]] ? fill(words[m[1]], { detail: m[2] || "" }) : raw;
  }
  function showError(title, text) {
    $("updErrTitle").textContent = title;
    $("updErrText").textContent = text;
    $("updErr").hidden = false;
  }

  // onLoad: the shell asks GitHub only right after the user opened this screen,
  // not when Back returns to it; a tap on Check always asks
  async function check(onLoad) {
    busy = true;
    found = null;
    $("updErr").hidden = true;
    $("updStatus").textContent = "";
    setButton(S.updChecking, true);
    try {
      const r = await call("update_check", { onLoad: !!onLoad });
      $("updVersion").textContent = fill(S.updVersion, { version: r.current });
      found = r.update || null;
      const avail = found && (found.size ? fill(S.updFound, { version: found.version, size: mb(found.size) }) : fill(S.updFoundNoSize, { version: found.version }));
      if (r.checked) $("updStatus").textContent = found ? avail : S.updLatest;
    } catch (e) {
      showError(S.updCheckFailed, describe(e));
    }
    busy = false;
    setButton(found ? installLabel() : S.updCheck);
  }

  async function install() {
    busy = true;
    $("updErr").hidden = true;
    setButton(S.updDownloading, true);
    $("updBack").disabled = true; // stay until the installer opens or an error shows
    if (!android) $("updStatus").textContent = S.updRestarting;
    try {
      // on Windows and macOS this only returns on an error: the app quits and restarts
      const status = await call("update_install");
      $("updStatus").textContent = status === "permission" ? S.updPermission : S.updStarted;
    } catch (e) {
      $("updStatus").textContent = "";
      showError(S.updInstallFailed, describe(e));
    }
    busy = false;
    $("updBack").disabled = false;
    // still enabled after the installer opened: each download is a new file, so a retry is safe
    setButton(installLabel());
  }

  async function init() {
    $("form").hidden = true; // before the first await, so the server form never flashes
    let st = { locale: "", version: "", platform: "" };
    try { st = await call("app_state"); } catch (e) { /* a plain browser */ }
    android = st.platform === "android";
    const lang = pickLang([q.get("lang"), st.locale, ...(navigator.languages || [])].filter(Boolean));
    S = window.KstStrings[lang];
    document.documentElement.lang = lang === "zh-TW" ? "zh-Hant-TW" : "en";
    $("upd").hidden = false;
    $("updTitle").textContent = S.updTitle;
    $("updVersion").textContent = st.version ? fill(S.updVersion, { version: st.version }) : "";
    $("updBack").textContent = S.updBack;
    $("updHint").textContent = S.updHint;
    // whether the app checks GitHub when it opens (ADR 0025); the shell keeps it in settings.json
    $("updAutoLabel").textContent = S.updAuto;
    $("updAuto").checked = st.checkUpdatesAtLaunch !== false;
    $("updAuto").addEventListener("change", (e) => {
      const on = e.target.checked;
      call("update_settings", { checkAtLaunch: on }).catch((err) => {
        e.target.checked = !on;
        showError(fill(S.updAutoFailed, { detail: reason(err) }), "");
      });
    });
    $("updGo").addEventListener("click", () => { if (!busy) (found ? install() : check(false)); });
    // back to Settings → About of the server that opened this screen; the shell checks it is a saved one
    $("updBack").addEventListener("click", () => { call("cancel_form", { back: q.get("back") }).catch(() => history.back()); });
    check(true);
  }
  init();
})();
