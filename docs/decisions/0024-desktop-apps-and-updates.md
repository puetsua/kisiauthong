<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0024 — Desktop apps in releases, and their updates

Date: 2026-11-22
Status: accepted (issues #33, #70); extends ADR 0020

## Context

The Tauri apps (ADR 0019) were built for Windows and macOS only by hand. A
release (ADR 0009, 0022) had no installer for either (#70), and nothing could
update an installed desktop app (#33). ADR 0020 gave Android its own updater
and left the desktop to Tauri's updater plugin, which installs a package only
when it carries a valid signature from the updater key built into the app.

## Decision

- **Every release builds the desktop apps** (`release.yml`, job `desktop`),
  with the tag as their version, as it builds the APK:
  - **Windows:** one NSIS setup `.exe` for x64
    (`kisiauthong-app-<tag>-windows-x64-setup.exe`), installed for the
    current user, so no administrator rights are needed. No `.msi`: one
    installer is enough, and WiX refuses pre-release versions such as
    `1.2.3-beta.1`. Windows on ARM runs the x64 build.
  - **macOS:** one universal `.dmg` (Apple silicon and Intel,
    `kisiauthong-app-<tag>-macos.dmg`).
  - A failed desktop build leaves that app out of the release; it never holds
    back the server release. Both are in `SHA256SUMS`.
- **No code signing yet.** There is no Authenticode certificate and no Apple
  Developer ID, so Windows SmartScreen warns once on install and macOS asks
  for *Open Anyway* in System Settings on first launch (the app is ad-hoc
  signed, `signingIdentity: "-"`). Updates are expected not to repeat these
  warnings, because the updater downloads them itself and they carry no
  download mark (not yet verified on either system). The release notes say
  how to get past the warnings. Code signing is a follow-up.
- **Updates through Tauri's updater** (`tauri-plugin-updater`, desktop only):
  - **Signing.** The release signs the update packages (the setup `.exe`, and
    the macOS `.app.tar.gz`) with the updater key from the secrets
    `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The
    public key is in `tauri.conf.json`. `requireSignedVersion` is on, so a
    signature must name the version it was signed for, and an old, genuinely
    signed package cannot be passed off as a newer version. Without the
    secrets the installers still ship, with no updates for them.
  - **Manifest.** `scripts/updater-manifest.js` writes `latest.json` from the
    signed builds (`windows-x86_64`; `darwin-aarch64` and `darwin-x86_64`
    both point to the universal app). The app reads
    `https://github.com/puetsua/kisiauthong/releases/latest/download/latest.json`.
    GitHub's `latest` never resolves to a draft or a pre-release, and the
    app also refuses a pre-release version and a downgrade
    (`update::accept`, shared with Android).
  - **Only the shell runs the updater.** No capability grants `updater:*`.
    The App updates screen calls the same `update_check` and `update_install`
    as on Android, and pages of saved servers can only open that screen
    (`scripts/test-app.js` checks both).
  - **Install.** The screen shows "Version X is available", and *Update and
    restart* downloads the package, checks its signature and installs it.
    Windows runs the installer in passive mode (a progress bar, no
    questions), which restarts the app. macOS replaces the app and restarts
    it.
- **The request beyond the user's server** is the same exception as in
  ADR 0020: a request to GitHub, with no account, server or user data, and
  only the updater's generic `User-Agent`.
- **Linux** is not built yet; `appInfo().updates` is false there.

## Consequences

- Losing the updater key, or its password, means installed desktop apps can
  no longer update; they have to be installed again by hand. The key is kept
  outside the repository and backed up, like the Android key.
- The web UI needs no change: Settings → About already shows *Check for
  updates* wherever `appInfo().updates` is true.
- A debug build reads its manifest URL from the first line of
  `update-source.txt` in the app data folder, so updates can be tried against
  a local server (`npx tauri build --debug --bundles nsis` with a throwaway
  key; see `apps/tauri/README.md`). Release builds ignore the file.
- Not verified before the first release: the job itself, and a real update
  from one release to the next.
