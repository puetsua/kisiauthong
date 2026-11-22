<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0025 — Check for app updates when the app opens

Date: 2026-11-22
Status: accepted (issue #68, and the launch check asked for in #33); amends
ADR 0020 and ADR 0024

## Context

ADR 0020 let the app ask GitHub for a newer version only when the user tapped
*Check for updates*. A sideloaded app then stays old until its user happens to
look (#68): nothing in the app says that a newer one exists. #33 asked the same
for the desktop apps: a quiet check at launch, the result in Settings, and an
off switch.

## Decision

- **A check each time the app opens**, on Android, Windows and macOS (where
  the app can update itself). It is on by default.
- **Off switch.** The App updates screen (bundled in the app, so it works with
  every server version) has *Check for updates when the app opens*. The
  setting belongs to the installed app, not to a server or a user. It is kept
  in `settings.json` next to `servers.json`. Only the bundled screen may change
  it (`update_settings`, in the `server-screen` permission set).
- **Quiet** (ADR 0015):
  - The result is kept by the shell and shown in Settings → About, as
    "Version X is available" next to the app's version
    (`kisiauthongApp.appInfo().available`).
  - There is no pop-up, badge, banner or sound.
  - A failed check is forgotten: nothing is shown, and the next launch tries
    again.
- **Nothing installs on its own.** Installing still needs *Check for updates*,
  then *Download and install* (Android) or *Update and restart* (desktop).
- **The same single request** as in ADR 0020 and ADR 0024 (the GitHub release
  API on Android, `latest.json` on desktop). It carries no account, server or
  user data, and only a generic `User-Agent`. It goes out at most once per
  launch, plus whenever the user checks. This stays the one exception to
  AGENTS.md §10.

## Consequences

- An app opened every day asks GitHub once a day. GitHub sees the IP address
  and that a KiSiauThong app exists there. The switch is for anyone who does
  not want that; the screen's hint explains it.
- Older web UIs ignore `available` and show the row as before. Older apps have
  no `available`, and the web UI shows nothing extra for them (ADR 0022).
- iOS still has no in-app updates, and so no check.
