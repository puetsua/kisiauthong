<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0009 — Releases, Docker image and CI

Date: 2026-11-15
Status: accepted

## Context

Self-hosters need something to download and run, and the project needs
tests and vulnerability scans on every change. The server is pure Go
(SQLite through `modernc.org/sqlite`, no cgo), so it cross-compiles to every
platform from one Linux runner.

## Decision

- **One file per platform.** Release builds use the `embedweb` build tag:
  `scripts/build-release.sh` copies `web/` into `server/web/` (gitignored)
  and `go:embed` builds the UI into the executable. A development build
  still serves `../web` from disk; `KISIAUTHONG_WEB` overrides both. A
  release build keeps its database in `data/` under the working directory.
  Targets: Linux amd64/arm64/armv7, Windows amd64/arm64, macOS amd64/arm64,
  each archived (`.tar.gz`, `.zip` for Windows) with `LICENSE` and
  `README.md`, plus `SHA256SUMS`. The version is stamped with
  `-X main.appVersion`; `kisiauthong version` prints it.
- **Docker image** `ghcr.io/puetsua/kisiauthong` for linux/amd64, arm64 and
  arm/v7, built by `deploy/Dockerfile`: Go cross-compiles in the build
  stage (no emulation), and the final stage is distroless `static` running
  as uid 65532, with `/data` as the volume. Distroless has no shell, so the
  binary has a `healthcheck` subcommand for `HEALTHCHECK`. Tags: the
  version, `major.minor`, and `latest` for final releases only.
- **Go version.** `go.mod` requires Go 1.26 and dependencies are kept
  current; CI and releases build with the latest stable Go, and the image
  is built with that same version (`GO_VERSION` build argument), so the
  standard library is always patched. Older local toolchains download the
  required one automatically (`GOTOOLCHAIN=auto`).
- **Workflows.** `ci.yml`: gofmt, go vet (also with `embedweb`), `go test
  -race`, web syntax and translation checks, all release targets compile,
  and the image starts, turns healthy and serves the app. `security.yml`
  (every push and weekly): govulncheck, Trivy on the repository (dependencies,
  secrets, Dockerfile) and on the image (HIGH/CRITICAL with a fix fail the
  run), and CodeQL for Go, JavaScript and the workflows when the repository
  is public. `release.yml` on a version tag (`1.2.3`, no `v` prefix): tests and govulncheck, downloads,
  image, then the GitHub release with install notes; a tag with `-` is a
  pre-release. Dependabot proposes Go module, Actions and base-image updates
  weekly.
- **Path prefix.** The web UI uses URLs relative to its page, and
  `KISIAUTHONG_BASE_PATH` (e.g. `/kisiauthong`) makes the server answer
  under that prefix (redirecting `/kisiauthong` to `/kisiauthong/`, keeping
  `/healthz` at the root) and scope its session cookie to it, so one host
  name can carry several apps behind a reverse proxy.
- **AGPL §13.** Settings → About links to this repository unless
  `KISIAUTHONG_SOURCE_URL` names the source of a modified version.
