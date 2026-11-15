<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0008 — API keys with permissions, and MCP for AI agents

Date: 2026-11-15
Status: accepted

## Context

Users want scripts and AI agents to read and record their books without
sharing their password or session, and with only the access each needs.

## Decision

### API keys

- A signed-in user creates keys in My account: a name, one or more
  **scopes** and an optional expiry (30 days, 90 days, 1 year or never).
  Scopes: `read`, `transactions:write`, `accounts:write`, `tags:write`,
  `templates:write`, `settings:write`. A write scope does not imply `read`.
- A key is `kst_` followed by 256 random bits (base64url). It is shown once;
  the server stores its SHA-256 hash, a short hint (`kst_AbCd…wxyz`), the
  scopes, and when it was created, last used (refreshed at most once a
  minute) and expires. Up to 50 keys per user; revoking takes effect at once.
- A key is sent as `Authorization: Bearer kst_…` and acts for its user
  only. Every data endpoint declares the scope it needs: `read` for reads,
  the matching write scope otherwise; a missing scope is `403`.
- Keys never reach account management: `/api/me…` (profile, password,
  TOTP, passkeys, keys) and `/api/users` accept only a signed-in session,
  so a leaked key cannot lock its owner out or mint more keys.
- Requests with a key carry no cookie, so the same-origin check that
  protects cookie sessions does not apply to them.

## Migration

Migration 12 adds the `api_keys` table (`user_id`, `name`, `hint`,
`key_hash` unique, `scopes`, `created_at`, `last_used_at`, `expires_at`).
