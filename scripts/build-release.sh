#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 kisiauthong contributors
#
# Builds the release downloads: one archive per platform, each holding a
# single kisiauthong executable with the web UI built in, plus LICENSE and
# README.md, and SHA256SUMS over them all.
#
#   scripts/build-release.sh 1.2.3 [outdir]       (outdir defaults to dist/)
#
# The version (no "v" prefix), the commit (COMMIT, default: git HEAD) and the
# build time (BUILD_TIME, default: now, UTC) are stamped into the executable
# and shown in Settings → About (ADR 0018).
#
# Needs Go, tar, zip and sha256sum. The server is pure Go (SQLite included),
# so every platform cross-compiles with CGO_ENABLED=0.
set -euo pipefail

version="${1:?usage: scripts/build-release.sh <version> [outdir]}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${2:-$root/dist}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
commit="${COMMIT:-$(git -C "$root" rev-parse HEAD 2>/dev/null || true)}"
built="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
ldflags="-s -w -X main.appVersion=$version -X main.commit=$commit -X main.buildTime=$built"

# the web UI is embedded from server/web (build tag embedweb)
rm -rf "$root/server/web"
cp -r "$root/web" "$root/server/web"
trap 'rm -rf "$root/server/web" "$work"' EXIT

# os/arch[/arm version]
targets=(
  linux/amd64 linux/arm64 linux/arm/7
  windows/amd64 windows/arm64
  darwin/amd64 darwin/arm64
)

for target in "${targets[@]}"; do
  IFS=/ read -r goos goarch goarm <<<"$target"
  name="kisiauthong-${version}-${goos}-${goarch}${goarm:+v$goarm}"
  exe="kisiauthong"
  [[ "$goos" == windows ]] && exe="kisiauthong.exe"
  mkdir -p "$work/$name"
  echo "building $name"
  (cd "$root/server" && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" GOARM="$goarm" \
    go build -trimpath -tags embedweb -ldflags "$ldflags" -o "$work/$name/$exe" .)
  cp "$root/LICENSE" "$root/README.md" "$work/$name/"
  if [[ "$goos" == windows ]]; then
    (cd "$work" && zip -qr "$out/$name.zip" "$name")
  else
    tar -czf "$out/$name.tar.gz" -C "$work" "$name"
  fi
done

(cd "$out" && sha256sum kisiauthong-"$version"-* > SHA256SUMS && cat SHA256SUMS)
