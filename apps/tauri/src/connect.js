// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Pure helpers for the app's server screen (ADR 0019): turn what the user typed
// into a server address, decide whether unencrypted http:// is allowed for it,
// and read the answer of GET <address>api/auth/status. No DOM and no network,
// so scripts/test-app.js runs them in Node; index.html loads this file as is.
"use strict";
(function (root) {
  const STATUS_PATH = "api/auth/status";

  // normalizeServerUrl("books.example.org/kisiauthong") → { ok: true, url: "https://books.example.org/kisiauthong/" }
  // Trims, adds https:// when there is no scheme, keeps a base path, drops query and fragment,
  // and ends with a slash. Errors: "empty", "invalid", "scheme" (not http or https), "credentials".
  function normalizeServerUrl(input) {
    let s = String(input == null ? "" : input).trim();
    if (!s) return { ok: false, error: "empty" };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      // "mailto:x" names a scheme; "localhost:8080/x" is a host and a port
      if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/?#]+:\d+(?:[/?#]|$)/.test(s)) return { ok: false, error: "scheme" };
      s = "https://" + s;
    }
    let u;
    try { u = new URL(s); } catch (e) { return { ok: false, error: "invalid" }; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "scheme" };
    if (!u.hostname) return { ok: false, error: "invalid" };
    if (u.username || u.password) return { ok: false, error: "credentials" };
    u.search = "";
    u.hash = "";
    let path = u.pathname.replace(/\/index\.html?$/i, "/");
    if (!path.endsWith("/")) path += "/";
    u.pathname = path;
    return { ok: true, url: u.href };
  }

  // the address the check asks: relative to the base path, as the web UI does
  function statusUrl(serverUrl) { return serverUrl + STATUS_PATH; }

  // Unencrypted http:// is allowed only on the user's own network: loopback,
  // private and link-local addresses, Tailscale's 100.64.0.0/10, IPv6 ULA and
  // link-local, localhost, .local names and single-label host names. This is
  // the set Apple's App Transport Security allows with NSAllowsLocalNetworking;
  // the app applies it on every platform so a server works the same everywhere.
  function cleartextAllowed(serverUrl) {
    let u;
    try { u = new URL(serverUrl); } catch (e) { return false; }
    if (u.protocol !== "http:") return true;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
    const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
      const a = +v4[1], b = +v4[2];
      return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    if (h.includes(":")) return h === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
    return !h.includes(".");
  }

  // The base address after redirects: a proxy may send http:// to https:// or move the path.
  function baseFromFinal(serverUrl, finalUrl) {
    if (!finalUrl) return serverUrl;
    let f;
    try { f = new URL(finalUrl); } catch (e) { return serverUrl; }
    f.search = "";
    f.hash = "";
    if (!f.pathname.endsWith("/" + STATUS_PATH)) return serverUrl;
    f.pathname = f.pathname.slice(0, -STATUS_PATH.length);
    return f.href;
  }

  // classifyProbe(serverUrl, probe) reads what the app shell's probe saw:
  //   { status, finalUrl, contentType, body }  an answer, or
  //   { error: "tls" | "connect" | "timeout" | "other", detail }  no answer.
  // A KiSiauThong server answers 200 with JSON holding a boolean needsSetup
  // (/healthz alone cannot tell it from any other server).
  // Result: { ok: true, url } or { ok: false, kind, url } with kind
  // "certificate", "unreachable", "notServer" or "cleartext".
  function classifyProbe(serverUrl, probe) {
    const fail = (kind, url) => ({ ok: false, kind, url: url || serverUrl });
    if (!probe || typeof probe !== "object") return fail("unreachable");
    if (probe.error === "tls") return fail("certificate");
    if (probe.error) return fail("unreachable");
    if (probe.status !== 200) return fail("notServer");
    let j;
    try { j = JSON.parse(probe.body); } catch (e) { return fail("notServer"); }
    if (!j || typeof j !== "object" || typeof j.needsSetup !== "boolean") return fail("notServer");
    const url = baseFromFinal(serverUrl, probe.finalUrl);
    if (!cleartextAllowed(url)) return fail("cleartext", url);
    return { ok: true, url };
  }

  // checkServer(input, probe) runs the whole check; probe(statusUrl) is the
  // shell's network call. Result as classifyProbe, or { ok: false, kind: "invalid", error }.
  async function checkServer(input, probe) {
    const n = normalizeServerUrl(input);
    if (!n.ok) return { ok: false, kind: "invalid", error: n.error, url: "" };
    if (!cleartextAllowed(n.url)) return { ok: false, kind: "cleartext", url: n.url };
    let p;
    try { p = await probe(statusUrl(n.url)); } catch (e) { p = { error: "other", detail: String(e) }; }
    return classifyProbe(n.url, p);
  }

  // the same choice as the web UI's pickLang: Traditional Chinese for zh-TW / zh-Hant, else English
  function pickLang(tags) {
    for (const l of [].concat(tags || [])) {
      const x = String(l).toLowerCase().replace(/_/g, "-");
      if (x === "zh-tw" || x.startsWith("zh-hant")) return "zh-TW";
      if (x.startsWith("en")) return "en";
    }
    return "en";
  }

  const api = { normalizeServerUrl, statusUrl, cleartextAllowed, baseFromFinal, classifyProbe, checkServer, pickLang };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KstConnect = api;
})(this);
