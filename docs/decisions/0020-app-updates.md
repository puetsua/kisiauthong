<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0020 — App updates (Android first)

Date: 2026-11-19
Status: accepted (issue #34); desktop updates are issue #33

## Context

The Tauri apps (ADR 0019) load the web UI from the user's server, so the UI
updates whenever the server does. The app shell itself does not: the Rust
side, the bridge (`window.kisiauthongApp`), the bundled server screen and
their permissions only change when a new app is installed. Many self-hosters
install the Android app from a GitHub release instead of a store, and nothing
would tell them, or let them install, a newer one.

Tauri's updater plugin is desktop only. On Android, an app can only update
itself by handing a downloaded APK to the system installer, which installs it
only when it is signed with the same key as the installed app. iOS apps can
only be updated by the App Store or TestFlight.

AGENTS.md §10 allows no network calls beyond the user's own server. An update
check has to ask somewhere else.

## Decision

- **Android, from GitHub releases, started by the user.** Settings → About
  shows an *App* row with the app's version (only in the app). On Android it
  also has *Check for updates*, which opens the bundled *App updates* screen.
  The screen checks at once, shows "Version X is available (size)", and
  installs only when the user taps *Download and install*. Coming back to the
  screen with Back does not check again: the shell allows one check on load
  per opening from Settings. There is no check at launch, no badge and no
  banner (ADR 0015).
- **The one request beyond the user's server.** The check is
  `GET https://api.github.com/repos/puetsua/kisiauthong/releases/latest`, sent
  only when the user asks. It carries no account, server or user data, just a
  generic `User-Agent`. The screen says that updates come from GitHub. This is
  the only exception to AGENTS.md §10.
- **The shell decides what to install; pages cannot.**
  - Release side:
    - The release URL and the download prefix
      (`https://github.com/puetsua/kisiauthong/releases/download/<tag>/`) are
      compiled into the app.
    - `latest` never returns drafts or pre-releases; the app skips a
      pre-release tag anyway.
    - The APK is the asset `kisiauthong-app-<version>-android.apk`.
    - GitHub's per-asset `digest` (`sha256:…`) is required.
    - Versions compare as semver; tags have no `v` (ADR 0009).
  - App side:
    - `update_check` and `update_install` answer only the bundled screen. They
      are not in the `bridge` permission set.
    - Install takes no arguments: it uses what the last check found.
    - Saved servers' pages get only `appInfo` (version, platform, whether
      updates work) and `updates` (open the screen).
  - The rules are plain Rust (`src/update.rs`) with unit tests.
- **Android does the I/O** (`gen/android/.../UpdatePlugin.kt`).
  - HTTPS uses the system's trust store.
  - The download goes to the app's cache and must match the release's size
    and SHA-256 before the installer sees it.
  - `REQUEST_INSTALL_PACKAGES` is declared. The first install opens Android's
    *Install unknown apps* setting for the app, and the user taps install
    again.
  - The installer then refuses an APK signed with another key.
  - The cached APK is deleted the next time the app starts.
- **One release key, forever.**
  - Release builds sign with the key named in `gen/android/keystore.properties`
    (`storeFile`, `password`, `keyAlias`), which is never committed.
  - The release workflow writes that file from the secrets
    `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`, builds the
    universal APK with the tag as its version, and attaches it to the release.
    Without the secrets it warns and the release has no Android app.
  - Losing the key means installed apps can no longer update; they have to be
    uninstalled and installed again.
- **`gen/android` is committed** now that it is customised: the update plugin,
  the permission, release signing and the app's own launcher icons. Its build
  output and per-build files stay ignored by its own `.gitignore` files.
- **Testing without a release.** A debug build reads two lines from
  `update-source.txt` in the app data folder: a release URL and a download
  prefix. This lets a local server stand in for GitHub. Release builds ignore
  the file (`cfg(debug_assertions)`).
- **iOS:** no updates from inside the app; the App Store or TestFlight
  updates it once it is published there. **Desktop:** issue #33 (Tauri
  updater).

## Consequences

- A sideloaded Android app can be kept current without a store, and the user
  sees and starts every step.
- Google Play restricts `REQUEST_INSTALL_PACKAGES`. A Play build, if one comes,
  needs a flavour without it, and Play itself would update that build.
- An app that cannot reach GitHub shows "Could not reach GitHub" with the
  reason. Nothing else depends on GitHub.
- Release notes mention the APK only when it was built.
- Not yet decided: a server whose web UI needs a newer bridge should say so,
  for example "This server needs app version X or later". `appInfo` gives the
  web UI what it needs to do that later.
