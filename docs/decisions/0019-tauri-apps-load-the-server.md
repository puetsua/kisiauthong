<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0019 — Tauri apps that open the user's own server

Date: 2026-11-19
Status: accepted (issue #28), amended by issue #30 (questions before
destructive actions go through the native dialog) and issue #35 (a way back to
the server screen while signed out); supersedes the "desktop and mobile are
future plans" part of ADR 0001

## Context

ADR 0001 built the web first and left desktop and Android as future clients
that would sync against the server. People now want an app icon on their phone
and computer, and a self-hoster may run the server under a base path
(`https://example.com/kisiauthong/`, `KISIAUTHONG_BASE_PATH`) or reach it only
over a private network such as Tailscale. The web UI already covers phones
(ADR 0001, `docs/ui-guide.md`), so a second UI would only duplicate it.

How the web UI is loaded decides whether it works unchanged:

- **Sign-in is a cookie** (ADR 0007), `HttpOnly`, `SameSite=Lax`, with `Path`
  set to the base path. It is sent only to pages of the server's own origin.
- **Every API call is same-origin and relative** (`api/…` against the page's
  base). Bundling the UI into the app would make the server a cross-origin API:
  CORS, `SameSite=None` cookies or tokens in JavaScript storage — weaker, and a
  second deployment shape to maintain.
- **Passkeys** (WebAuthn) are bound to the server's host name.

## Decision

- **One Tauri 2 project, `apps/tauri/`, for macOS, Windows, iOS and Android.**
  Linux comes later (Tauri supports it; it is not built or tested yet). The
  React / React Native / Expo plan of `AGENTS.md` is not the first version.
- **Online-only.** The window loads the web UI from the server the user
  entered, so the UI always comes from that server, with its cookie, base path
  and version. Offline use and sync are a separate, later issue; nothing in the
  app stores books.
- **A bundled server screen** (`apps/tauri/src/`, the B mockup of issue #28)
  asks for one server address the first time. The address is normalised
  (trimmed, `https://` added when there is no scheme, base path kept, query and
  fragment dropped, trailing slash) and checked with `GET <address>api/auth/status`:
  a KiSiauThong server answers 200 with JSON holding a boolean `needsSetup`.
  `/healthz` cannot tell it from any other server. The check runs in the Rust
  shell (one GET, system TLS and trust store); `connect.js` decides what the
  answer means, so the rules are plain functions tested in Node
  (`scripts/test-app.js`). Errors are distinct and plain: cannot connect (with
  the address tried, the field stays filled), answers but is not a KiSiauThong
  server, unencrypted `http://` blocked, certificate not trusted. On success the
  window navigates to the server and its normal sign-in appears. At every launch
  the screen checks the server in use first, so an unreachable server shows the
  same error instead of a blank window.
- **Unencrypted `http://` only on the user's own network**: loopback, private
  and link-local addresses, Tailscale's `100.64.0.0/10`, IPv6 ULA, `localhost`,
  `.local` and single-label names. This is what Apple's App Transport Security
  allows with `NSAllowsLocalNetworking` (set in `Info.plist`), applied on every
  platform so a server works the same on each. Anything else needs `https://`.
  The server screen applies it before the check, and the shell repeats it when
  saving (`profiles::check_url`); both sides are tested against the same cases
  (`apps/tauri/test/cleartext-cases.json`). The shell also refuses to save a
  server on its own host names (`tauri.localhost`, `ipc.localhost`), and only
  the exact address of the bundled screen counts as local.
- **Saved servers are profiles**: `servers.json` in the app data folder holds a
  list of `{ id, name?, url, lastUsed? }` and the active id. The first-run
  screen asks for exactly one address; more fit later without a format change.
- **Settings → Servers**, only inside the app, at the bottom of Settings just
  above About: the saved servers with an *In use* marker, Switch, Edit, Remove
  and Add server. Removing the server in use opens the last used of the rest;
  removing the last one returns to the server screen. Add and Edit open the
  bundled server screen (in the web UI's language), so there is one address
  form with one set of checks and errors.
- **Signed out** (issue #35): Settings needs a signed-in user, so every
  signed-out step of the sign-in card (sign in, two-step code, first-user
  setup) ends, only inside the app, with a row naming the server (its host
  and port, from the page's own address) and a *Change server* link. The link
  opens the server screen's Add server form through the same bridge call as
  Settings → Add server: an address already saved is switched to, a new one
  is checked and saved, and Cancel comes back to the sign-in page. A wrong or
  unwanted server can thus be changed without signing in.
- **The bridge.** Settings is rendered by the server's web UI, so the shell
  injects a small script (`bridge.js`) into its window that defines
  `window.kisiauthongApp` (`servers`, `use`, `remove`, `add`, `edit`, `confirm`). Tauri
  refuses app commands from remote pages unless a capability allows them; the
  shell adds one at run time per saved server origin, granting only that set,
  and each command checks the caller's origin against the current list again
  (a removed server keeps its capability until the app restarts: Tauri can add
  a capability at run time but not take one back, and a deny capability would
  stay if the same server is added again). The server
  screen alone may check addresses and save servers. The web UI's hook is a few
  lines in `web/app.js` that do nothing in a browser, where `kisiauthongApp` is
  undefined.
- **The window stays on the server screen and the saved origins.** Any other
  navigation, every `target="_blank"` link and every `window.open` opens in the
  system browser.
- **No nudging** (ADR 0015): no suggested servers, no prompts to add one, no
  highlighted choice.

## Consequences

- The Go server and the web UI need no changes to be used by the app beyond the
  Servers hook; a server upgrade updates the app's UI at once.
- Without a network path to the server the app shows only the server screen's
  error. Offline use needs the sync design of AGENTS.md §7 and its own ADR.
- Webview limits, documented in `apps/tauri/README.md`: passkeys need
  associated domains / Digital Asset Links per server, which a self-hosted app
  cannot ship, so sign in with a password (and TOTP) in the app; `<a download>`
  (Data → Export JSON) saves to the Downloads folder and reveals the file on
  desktop, while iOS and Android have no download handler yet.
- **Questions before destructive actions** (issue #30). `window.confirm()`
  answers false at once in WKWebView (macOS, iOS), because wry gives the
  webview no confirm panel, so a plain `if (!confirm(…)) return;` would stop
  every delete in the Apple apps. The web UI therefore asks through one
  helper, `askConfirm(text, action)` in `web/app.js`, used by every question
  (deleting a transaction, reserve, allocation or user, removing a passkey or
  a server, revoking an API key). In a browser it is `window.confirm()`, with
  no visible change. Inside the app it calls `kisiauthongApp.confirm()`, the
  system dialog with the action and Cancel buttons in the web UI's language
  (rfd on macOS and Windows, the backend of tauri-plugin-dialog; the plugin
  itself is not used because it replaces `window.confirm` with an async
  function, which would make such guards go on without asking). Where the
  shell has no native dialog yet (iOS, Android) it falls back to
  `window.confirm()`: Android shows its own dialog; on iOS these actions still
  do nothing until the iOS build adds a native dialog.
- iOS and Android builds need Xcode and the Android SDK; they are scripted in
  `apps/tauri/README.md` and not built in CI yet. Store signing and releases are
  a later issue.
