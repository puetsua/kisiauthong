<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0022 — One version for the server and the apps

Date: 2026-11-21
Status: accepted (issue #52)

## Context

The repository holds the server (Go, with the web UI built in) and the
Tauri apps (`apps/tauri/`). A release tag (ADR 0009) builds the server
downloads, the Docker image and the Android APK (ADR 0020), all stamped
with the tag's version. The question is whether the apps should have a
version line of their own.

Today the app is a thin shell (ADR 0019). It shows the web UI of the
user's own server. Its own code is only the server screen, the saved
servers, the bridge and the Android updater, and it changes far less often
than the server.

## Decision

- **One version for everything** in the repository: a tag `1.2.3` releases
  the server, the image and the apps as `1.2.3`. There are no separate
  app tags.
- **An APK in every release.** A release that changes nothing in the shell
  still ships a new APK, and Android's Check for updates offers it. That
  costs the user one install now and then; in exchange, an app's version
  always names the release it came from.
- **No version checks between app and server.** Both sides check what the
  other offers, never which version it is:
  - The web UI checks which bridge functions exist (`appInfo`, `updates`,
    …) and leaves out what an older app lacks.
  - The shell only reads the server's sign-in status (`api/auth/status`).

  So any app works with any server, and a new release never requires
  upgrading both together.
- **Revisit when offline sync comes** (AGENTS.md §2, the sync ADR). The
  app will then have its own database, sync engine and release pace, and
  will meet servers of other versions for real. That is when to:
  - give the apps a version line of their own;
  - add a sync protocol version that both sides check;
  - and teach the updater to pick app releases.

## Consequences

- `release.yml` stays one pipeline, and the version rules of ADR 0009 and
  ADR 0018 apply unchanged to the apps.
- The updater can keep asking GitHub for `releases/latest`. With separate
  app releases it would have to list the releases and filter by tag.
- If the apps are split off later, their versions must continue above the
  last shared one. Android's version code comes from the version, and an
  installed app accepts only a higher one.
- `version` in `apps/tauri/src-tauri/tauri.conf.json` is only what builds
  outside a release carry: `release.yml` stamps the tag over it. A pull
  request's APK therefore shows that version and cannot be installed over a
  newer release without uninstalling first.
