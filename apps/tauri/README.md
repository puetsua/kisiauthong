<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 記數通 KiSiauThong apps (Tauri 2)

One Tauri 2 project for **macOS, Windows, iOS and Android**. The first version
is **online-only**: the window shows the web UI of the user's own KiSiauThong
server, loaded from that server. Why, and what is deferred, is in
[ADR 0019](../../docs/decisions/0019-tauri-apps-load-the-server.md).

```text
apps/tauri/
  src/                  the bundled server screen (plain HTML/CSS/JS, no build step)
    index.html          first run, Add server, Edit server
    connect.js          pure rules: normalise an address, the http:// rule, read the check's answer
    strings.js          English and zh-TW strings of the screen
    first-run.js        the screen's behaviour
    update.js           the App updates screen (mode=update; Android)
    style.css           tokens copied from web/style.css (checked by scripts/test-app.js)
  src-tauri/
    src/lib.rs          window, navigation guard, commands, per-server capabilities
    src/profiles.rs     servers.json: saved servers and the one in use
    src/probe.rs        GET <server>api/auth/status with the system TLS stack
    src/update.rs       app updates: pick a newer release's APK (ADR 0020)
    src/bridge.js       injected into every page: window.kisiauthongApp, links to the system browser
    capabilities/       the bundled screen's capability (saved servers get theirs at run time)
    permissions/app.toml  the "server-screen" and "bridge" permission sets
    Info.plist, Info.ios.plist  App Transport Security: https, except on the local network
  test/cleartext-cases.json   where http:// is allowed; the same cases for connect.js and profiles.rs
    gen/android/        the Android project (committed): UpdatePlugin.kt, manifest, release signing, icons
```

## How it works

1. At launch the window opens the bundled server screen. With no saved server
   it asks for one address (variant B of issue #28). With one in use it checks
   it and opens it, or shows why it cannot, with the address filled in.
2. **Connect** normalises the address (trim, `https://` when there is no
   scheme, base path kept, trailing slash), refuses unencrypted `http://` off
   the local network, then asks `GET <address>api/auth/status`. A KiSiauThong
   server answers 200 with JSON holding a boolean `needsSetup`. The errors are:
   cannot connect, not a KiSiauThong server, unencrypted connection blocked,
   certificate not trusted.
3. The server is saved in `servers.json` in the app data folder
   (`~/Library/Application Support/io.github.puetsua.kisiauthong/` on macOS,
   `%APPDATA%\io.github.puetsua.kisiauthong\` on Windows) and the window goes
   to the server, where its own sign-in appears. Sessions are the server's
   cookies inside the webview, one set per server origin.
4. Inside the server's web UI, **Settings → Servers** (only in the app, just
   above About) lists the saved servers through `window.kisiauthongApp`:
   Switch, Edit, Remove and Add server. Add and Edit open the bundled screen
   again; Cancel goes back to Settings.
   Signed out, the sign-in card (sign in, two-step code, first-user setup)
   ends with a row naming the server's host and a **Change server** link to
   the same Add server form, so the server can be changed without signing in;
   Cancel goes back to the sign-in page. In a browser the row is not there.
5. Pages may only stay on the bundled screen or a saved server's origin. Other
   links, `target="_blank"` and `window.open` open in the system browser.
6. **App updates** ([ADR 0020](../../docs/decisions/0020-app-updates.md)).
   Settings → About shows the app's version. On Android, *Check for updates*
   opens the bundled App updates screen. It asks GitHub for the latest release,
   only then, and installs `kisiauthong-app-<version>-android.apk` only after
   the user taps *Download and install*. The download must match the size and
   SHA-256 in the release, and Android's installer requires the same signing
   key. Desktop updates are #33; iOS updates come from the App Store.

The bridge is reachable only from the bundled screen and from saved server
origins: Tauri rejects app commands from remote pages unless a capability
grants them, and the app adds one per saved origin at run time with only the
`bridge` set (list, switch, remove, open the add/edit screen, open a link
outside, ask a yes/no question in a native dialog, read the app's version,
open the App updates screen). Checking for and installing an update is only
allowed from the bundled screen. The commands check the calling page's origin
again; a removed server's capability stays until the app restarts, because
Tauri cannot take a run-time capability back.

Questions before destructive actions (delete a transaction, reserve,
allocation or user; remove a passkey or a server; revoke an API key) go
through `askConfirm` in `web/app.js`: `window.confirm()` in a browser, the
system dialog through `kisiauthongApp.confirm()` in the app. This matters on
macOS, where WKWebView answers `window.confirm()` with false without showing
anything.

## What does not work in the app (yet)

- **Passkeys.** WebAuthn in WKWebView, WebView2 and Android WebView needs the
  app to be associated with each server's domain (associated domains, Digital
  Asset Links), which an app for self-hosted servers cannot ship. Sign in with
  a password (and two-step codes) in the app; passkeys keep working in browsers.
- **Downloads** (`<a download>`, Settings → Data → Export JSON): on macOS and
  Windows the file is saved to the Downloads folder and shown in Finder /
  Explorer. iOS and Android have no download handler yet; export from a
  browser there.
- **Questions on iOS.** The shell has a native yes/no dialog on desktop only.
  On iOS the web UI falls back to `window.confirm()`, which WKWebView answers
  with false, so deleting, removing and revoking do nothing there until the
  iOS build adds a native dialog. Android shows its own dialog.
- **Offline use.** Nothing is cached; without a path to the server only the
  server screen's error shows. Sync is a later issue.
- **A server that stops answering mid-session** leaves the webview's own error
  (blank on macOS); quit and reopen to get the server screen's check.
- **Linux** is not built or tested yet.

## Build

Requirements: Node.js (for the Tauri CLI), Rust (`rustup`), and per platform
the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
cd apps/tauri
npm ci                         # the Tauri CLI, pinned in package-lock.json
npx tauri dev                  # run with the bundled screen; connect to any server
npx tauri build                # macOS: .app and .dmg in src-tauri/target/release/bundle/
npx tauri build --debug --bundles app   # quicker local check
cd src-tauri && cargo test     # Rust unit tests (profiles, origins, TLS errors)
node ../../scripts/test-app.js # the screen's rules, strings and tokens
```

Windows: the same `npx tauri build` on Windows gives `.msi` and `.exe`
installers (WebView2 is part of Windows 10/11).

A server to try against: `cd server && PORT=9728 go run .` and enter
`http://127.0.0.1:9728/` (loopback may use `http://`).

### iOS (not built here yet)

Needs a Mac with full **Xcode** (not only the Command Line Tools) and CocoaPods.

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
cd apps/tauri
npx tauri ios init             # creates src-tauri/gen/apple
npx tauri ios dev              # simulator or a connected device
npx tauri ios build            # needs a signing team (bundle > iOS > developmentTeam)
```

Check that `NSAppTransportSecurity` / `NSAllowsLocalNetworking` from
`Info.ios.plist` reached the generated `Info.plist`; without it every
`http://` server, even on the local network, is blocked by iOS.

### Android

Needs Android Studio with the SDK, the NDK and platform tools, and
`JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` set as in the Tauri prerequisites.

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
cd apps/tauri
npx tauri android dev          # src-tauri/gen/android is committed; do not run `android init` over it
npx tauri android build --apk
```

Release builds are signed with the key named in `src-tauri/gen/android/keystore.properties`
(`storeFile=<path to .jks>`, `password=…`, `keyAlias=kisiauthong`), which git
ignores; keep the key and its password outside the repo, backed up. Every
release must use the same key, or installed apps cannot update. The release
workflow builds the APK when the secrets `ANDROID_KEYSTORE_BASE64` (the `.jks`
file, base64) and `ANDROID_KEYSTORE_PASSWORD` are set.

To test updates without a release, a **debug** build reads `update-source.txt`
in the app data folder (`/data/user/0/io.github.puetsua.kisiauthong/`): line 1
is the release JSON URL, line 2 the prefix downloads must start with. Serve a
higher-version debug APK and a release JSON next to it, and use `adb reverse`
so the emulator reaches it as `127.0.0.1`.

Open points for Android:

- **Local network protection** (Android 17, target SDK 37): an app may reach
  addresses on the phone's own Wi-Fi network (192.168.x.x, 10.x, the
  emulator's 10.0.2.2) only with the runtime permission `ACCESS_LOCAL_NETWORK`.
  The app does not ask for it: the expected way to reach a home server from a
  phone is Tailscale or a similar VPN. Not yet tried on a device: that a
  Tailscale `100.x.y.z` address is outside this protection. In the emulator,
  use `adb reverse` and `127.0.0.1`.
- The server check uses rustls with the platform verifier on Android, which
  needs `rustls_platform_verifier::android::init_hosted` called with the JNI
  context at start-up (see the rustls-platform-verifier README); until then
  the check cannot verify certificates.
- `http://` on the local network needs cleartext traffic allowed in
  `gen/android/app/src/main/AndroidManifest.xml` (the generated template allows
  it only in debug builds); the app's own rule still blocks it off the local
  network.
- `src-tauri/gen/android` is committed (ADR 0020); `gen/apple` is still
  ignored until the iOS project is customised.
