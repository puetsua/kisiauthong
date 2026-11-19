<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0018 — Showing the version, and where it comes from

Date: 2026-11-19
Status: accepted (issue #14)

## Context

Users and testers need to know which build they are running, for example to
report a bug against the nightly test site. The version used to be visible only
to administrators on the Server page, and nightly builds were stamped
`nightly-<sha7>`, which says nothing about the release they are based on.

## Decision

- **Where.** The version string sits under the licence line at the foot of the
  sidebar, and at the foot of the More sheet on phones. Both link to
  Settings → About. That section shows:
  - **Version.** For a nightly build it adds a teal `nightly` chip and the note
    that it is the automatic test build.
  - **Build time**, in the viewer's display time zone, with the zone name.
  - **Commit**, a short hash linking to `<source URL>/commit/<full hash>`, with
    a Copy button for the full hash.

  The Build time and Commit rows appear only when the build stamped them.
  Nothing is suggested or highlighted beyond that chip (ADR 0015).
- **No `v` prefix** anywhere, as for tags (ADR 0009).
- **The source of truth is the build.** It stamps four Go variables with
  `-ldflags -X`, and the server never derives them at run time:

  | Variable | Release | Nightly | Without ldflags |
  |---|---|---|---|
  | `main.appVersion` | the tag, `0.2.0` | `<latest release tag>-<MMDD>-<sha7>`, e.g. `0.2.0-1118-c22ff51` | `dev` |
  | `main.commit` | full commit hash | full commit hash | empty |
  | `main.buildTime` | RFC 3339 UTC | RFC 3339 UTC | empty |
  | `main.channel` | empty | `nightly` | empty |

  - `scripts/build-release.sh`, `deploy/Dockerfile` (`VERSION`, `COMMIT`,
    `BUILD_TIME` build arguments), `ci.yml` and `release.yml` stamp the
    release ones.
  - The nightly build script stamps its own. It builds from a source tarball
    without git history, so `git describe` is not available: the base version
    comes from the GitHub API (latest release, falling back to the newest
    tag), with any `v` removed.
- **MMDD is the build date in Asia/Taipei, fixed when the build is stamped.**
  - The version string is one identifier that everyone quotes the same way, in
    bug reports, logs and the admin page. It cannot follow each viewer's time
    zone.
  - The nightly build runs in Taipei, so a 03:00 build is stamped with that
    night's local date.
  - The Build time row is a clock reading in the viewer's zone, so it can fall
    on a different date than the MMDD in the version. It shows the zone name
    so that difference can be explained.
- **API.** Every signed-in user already reads `GET /api/settings`, and its
  `about` object now carries `version`, `commit`, `buildTime` and `nightly`
  next to `sourceUrl`.
  - Nothing else is exposed: no host, path, runtime or database data. That
    stays on the admin-only `/api/admin/server`.
  - The sign-in page does not show the version: signed out, there is nothing
    to show it with, and the server has no reason to tell anonymous visitors
    which build it runs.
  - A commit that is not a hex hash, or a build time that is not RFC 3339, is
    left out rather than shown.

## Consequences

- Release downloads and images now carry the commit and build time.
- Changing the nightly scheme is a build-script change only. The app shows
  whatever was stamped, and the `nightly` chip depends on `channel`, not on
  the shape of the version string.
