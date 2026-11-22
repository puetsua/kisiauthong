// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Writes latest.json, the update manifest the Windows and macOS apps read from
// the latest release (ADR 0024), from the signed desktop builds in a folder:
//   kisiauthong-app-<tag>-windows-x64-setup.exe  + .sig   → windows-x86_64
//   kisiauthong-app-<tag>-macos.app.tar.gz       + .sig   → darwin-aarch64, darwin-x86_64 (universal)
// A platform whose file or signature is missing is left out. Prints nothing
// and exits 0 when no platform is signed, so the release goes on without it.
// Usage: node scripts/updater-manifest.js <tag> <dir> [repo]   (repo: owner/name)
"use strict";
const fs = require("fs");
const path = require("path");

const PLATFORMS = [
  { keys: ["windows-x86_64"], file: (tag) => `kisiauthong-app-${tag}-windows-x64-setup.exe` },
  { keys: ["darwin-aarch64", "darwin-x86_64"], file: (tag) => `kisiauthong-app-${tag}-macos.app.tar.gz` },
];

function manifest(tag, dir, repo, now = new Date()) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`not a release tag: ${tag}`);
  const platforms = {};
  for (const p of PLATFORMS) {
    const name = p.file(tag);
    const file = path.join(dir, name), sig = file + ".sig";
    if (!fs.existsSync(file) || !fs.existsSync(sig)) continue;
    const signature = fs.readFileSync(sig, "utf8").trim();
    if (!signature) throw new Error(`${name}.sig is empty`);
    const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
    for (const k of p.keys) platforms[k] = { signature, url };
  }
  if (!Object.keys(platforms).length) return null;
  return {
    version: tag,
    notes: `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
}

if (require.main === module) {
  const [tag, dir, repo = process.env.GITHUB_REPOSITORY || "puetsua/kisiauthong"] = process.argv.slice(2);
  if (!tag || !dir) {
    console.error("usage: node scripts/updater-manifest.js <tag> <dir> [owner/name]");
    process.exit(2);
  }
  const m = manifest(tag, dir, repo);
  if (m) process.stdout.write(JSON.stringify(m, null, 2) + "\n");
}

module.exports = { manifest };
