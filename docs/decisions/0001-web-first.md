<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0001 — Build web first; desktop and mobile are future plans

Date: 2026-11-15
Status: accepted

## Decision

Build the web application first: a Go server (stdlib only, no build step)
serving a static web UI, storing data in **SQLite first** (single file,
pure-Go driver, portable SQL so a PostgreSQL adapter can be added later
without changing the domain model; plain JSON is the seed/import/export
format, not the live store — JSONC is deprecated, no compatibility shim). Desktop
(Windows/Linux/macOS) and Android clients are explicitly future plans —
they will sync against this server's API when built, and no code is
written for them now.

## Consequences

- The four-element kernel (Account, Transaction, Tag, TransactionTemplate)
  is implemented once in the server's derivation code and tested there.
- The web UI is plain HTML/CSS/JS served by the Go binary so a self-hoster
  runs one thing with no Node toolchain. A framework rewrite is a new ADR.
- `agents.md` platform table marks desktop/mobile as planned, not current.
