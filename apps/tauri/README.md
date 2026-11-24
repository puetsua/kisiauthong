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
    update.js           the App updates screen (mode=update; Android, Windows, macOS)
    style.css           tokens copied from web/style.css (checked by scripts/test-app.js)
  src-tauri/
    src/lib.rs          window, navigation guard, commands, per-server capabilities
    src/profiles.rs     servers.json: saved servers and the one in use
    src/probe.rs        GET <server>api/auth/status with the system TLS stack
    src/update.rs       app updates: which release may be installed, pick its APK (ADR 0020, 0024)
    src/bridge.js       injected into every page: window.kisiauthongApp, links to the system browser
    capabilities/       the bundled screen's capability (saved servers get theirs at run time)
    permissions/app.toml  the "server-screen" and "bridge" permission sets
    Info.plist, Info.ios.plist  App Transport Security: https, except on the local network
    gen/android/        the Android project (committed): UpdatePlugin.kt, ProbePlugin.kt, manifest, release signing, icons
  test/cleartext-cases.json   where http:// is allowed; the same cases for connect.js and profiles.rs
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
   again; Cancel, like the system Back, goes back to Settings. The bundled
   screen never stays behind a server page in the window's history: when it
   opens a server (at launch, or after saving one) the server takes the
   screen's place, so Android's Back walks back through the web UI's pages
   without coming back to the screen (issue #67). Edit server → Save and App
   updates → Back also go back in history to Settings, which then shows the
   edited list or About anew, so Settings is not in history twice (issue
   #83). When the window opens another server (Switch, Remove of the server
   in use, Add server, or the server screen once the last one is removed),
   Android forgets the previous server's pages once the new page has loaded,
   so Back on it leaves the app (issue #84); WKWebView and WebView2 have no
   call to clear their history.
   Signed out, the sign-in card (sign in, two-step code, first-user setup)
   ends with a row naming the server's host and a **Change server** link to
   the same Add server form, so the server can be changed without signing in;
   Cancel goes back to the sign-in page. In a browser the row is not there.
5. Pages may only stay on the bundled screen or the server in use. A page of
   another saved server, or of one the window showed before, is refused, so
   Back (on Windows also Alt+Left and the mouse's Back button) cannot leave
   the server in use after Switch or Remove (issue #92). Other links,
   `target="_blank"` and `window.open` open in the system browser.
   On Windows and macOS the window has no system title bar: a second, bundled
   webview (`src/frame.html`) draws the bar above the page, and only it may
   move, maximize or close the window
   ([ADR 0026](../../docs/decisions/0026-desktop-window-frame.md)).
6. **App updates** ([ADR 0020](../../docs/decisions/0020-app-updates.md)).
   Settings → About shows the app's version. On Android, *Check for updates*
   opens the bundled App updates screen. It asks GitHub for the latest release,
   only then, and installs `kisiauthong-app-<version>-android.apk` only after
   the user taps *Download and install*. The download must match the size and
   SHA-256 in the release, and Android's installer requires the same signing
   key. On Windows and macOS ([ADR 0024](../../docs/decisions/0024-desktop-apps-and-updates.md))
   the same screen uses Tauri's updater: it reads the latest release's
   `latest.json`, and *Update and restart* installs the package only when its
   signature matches the updater key built into the app. iOS updates come
   from the App Store.
   Each time the app opens it also checks once, quietly
   ([ADR 0025](../../docs/decisions/0025-update-check-at-launch.md)): a newer
   version shows up only in Settings → About. The switch *Check for updates
   when the app opens* on the App updates screen turns this off; it is kept in
   `settings.json` next to `servers.json`.

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

Requirements: Node.js (for the Tauri CLI), Rust 1.90 or newer (`rustup`; the
`rust-version` in `src-tauri/Cargo.toml`), and per platform
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

Windows: `npx tauri build --bundles nsis` gives the setup `.exe` that
releases ship (WebView2 is part of Windows 10/11). It is built from our copy of
Tauri's NSIS template, `src-tauri/windows/installer.nsi`, where running a newer
or older setup over an installed app selects "Do not uninstall" (install over
it) instead of Tauri's "Uninstall before installing". When `@tauri-apps/cli`
is bumped, take the template of the new tag and apply the `kisiauthong:`
change again. macOS releases are
universal: `npx tauri build --target universal-apple-darwin --bundles app,dmg`
(after `rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

### Desktop updates (Windows, macOS)

Releases sign the update packages with the **updater key** (ADR 0024). Create
it once, keep it and its password backed up outside the repo (losing either
means installed desktop apps can no longer update), and put it in the
repository secrets:

```powershell
npx tauri signer generate -w "$HOME\.tauri\kisiauthong-updater.key"
Get-Content -Raw "$HOME\.tauri\kisiauthong-updater.key" | gh secret set TAURI_SIGNING_PRIVATE_KEY
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The public key (`kisiauthong-updater.key.pub`) is `plugins.updater.pubkey` in
`tauri.conf.json`. Local builds make no update packages and need no key;
`release.yml` adds `bundle.createUpdaterArtifacts` when the secret is set, and
`scripts/updater-manifest.js` writes `latest.json` from what it signed.

To try an update without a release, build two **debug** installers with a
throwaway key (`npx tauri signer generate --ci -p test -w test.key`, then
`npx tauri build --debug --bundles nsis --config` with `version`,
`bundle.createUpdaterArtifacts: true` and that key's
`plugins.updater.pubkey`, and `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` set).
Install the lower version, serve the higher one with a `latest.json` from
`scripts/updater-manifest.js` (its URLs pointed at the local server) on
`127.0.0.1`, and put that `latest.json` URL on the first line of
`update-source.txt` in the app data folder
(`%APPDATA%\io.github.puetsua.kisiauthong\`). Release builds ignore the file.

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

**Launcher icon.** An adaptive icon in three layers (`mipmap-*/ic_launcher_background`,
`_foreground` and `_monochrome`, the last for Android 13 themed icons), drawn
from the shapes of `web/icon.svg` by `python3 scripts/android-icons.py` (needs
Pillow) into `src-tauri/icons/android/` and `src-tauri/gen/android/`. The page
and the coin stay inside the 66dp safe zone, so no launcher mask crops them;
`node scripts/test-app.js` checks that. Do not use `tauri icon` for Android: it
puts the whole square icon in the foreground on a white background (issue #54).

Release builds are signed with the key named in `src-tauri/gen/android/keystore.properties`
(`storeFile=<path to .jks>`, `password=…`, `keyAlias=kisiauthong`), which git
ignores; keep the key and its password outside the repo, backed up. Every
release must use the same key, or installed apps cannot update. The release
workflow builds the APK when the secrets `ANDROID_KEYSTORE_BASE64` (the `.jks`
file, base64) and `ANDROID_KEYSTORE_PASSWORD` are set.

#### Getting the APK without building it

- **From a release:** the asset `kisiauthong-app-<version>-android.apk`,
  signed with the release key, when the release workflow had the signing
  secrets. Once installed, it updates itself (Settings → About → Check for
  updates).
- **From GitHub Actions:** the *Android* workflow (`.github/workflows/android.yml`)
  builds the APK on every pull request and push to `main` that touches
  `apps/tauri`, and on demand: Actions → Android → Run workflow, pick the
  branch. Open the finished run; the APK is the artifact `android-apk` (a zip
  holding `kisiauthong-android-<version>-<signing>.apk`). The run's summary
  shows the signing mode, the size, the SHA-256 and the signing certificate.
  It is the release build type for arm64 phones (almost every phone since
  2017); artifacts are kept for the repository's retention period (90 days by
  default).

Installing on a phone: copy the `.apk` to the phone (or `adb install
kisiauthong-android-….apk`), open it from the file manager or the browser's
downloads, allow *Install unknown apps* for that app when Android asks, and
tap Install.

**Signing in CI.** Android installs only signed APKs, and updates an app only
with an APK signed by the same key. Both workflows read the repository
secrets `ANDROID_KEYSTORE_BASE64` (the `.jks` keystore, base64-encoded) and
`ANDROID_KEYSTORE_PASSWORD` (its store and key password); the key alias is
`kisiauthong`. To create the key once and keep it backed up outside the repo:

```sh
keytool -genkeypair -keystore kisiauthong.jks -storetype PKCS12 -alias kisiauthong \
  -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=KiSiauThong"
base64 < kisiauthong.jks | tr -d '\n'   # the value of ANDROID_KEYSTORE_BASE64
```

With the secrets, the *Android* workflow signs with the release key (never
for pull requests from forks, which get no secrets). Without them, it signs
with a **throwaway key** made for that run, and the summary says so. Such an
APK installs and runs like a release one, but it is not the release key: an
app installed from it cannot be updated by a release APK or by the in-app
updater (Android refuses another key), nor by another CI run's APK, and an
app installed from a release cannot be replaced by it. Uninstall the other
one first; that deletes the app's data on the phone (the saved servers and
sign-in, not your books, which stay on the server). The release workflow
never uses a throwaway key: without the secrets the release has no APK.

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
- The server check runs in Kotlin on Android (`ProbePlugin.kt`, with
  `HttpURLConnection`), so it trusts the certificates and follows the network
  security policy the WebView does; the other platforms use reqwest
  (`src/probe.rs`). Both answer in the shape `src/connect.js` reads.
- Android allows cleartext traffic in every build (`usesCleartextTraffic` in
  `gen/android/app/build.gradle.kts`; the generated template allowed it only in
  debug builds, so a release could not open an `http://` server); the app's own
  rule (ADR 0019) still blocks `http://` off the user's own network.
- The app is drawn edge to edge (Android enforces it from target SDK 35);
  `MainActivity.kt` pads the content by the system bars, a display cutout and
  the open keyboard, because the web UI does not lay out around them.
- `src-tauri/gen/android` is committed (ADR 0020); `gen/apple` is still
  ignored until the iOS project is customised.
