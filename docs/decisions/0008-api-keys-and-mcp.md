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

### MCP

- `POST /mcp` speaks the Model Context Protocol over Streamable HTTP
  (versions 2025-11-25, 2025-06-18 and 2025-03-26): `initialize`, `ping`,
  `tools/list`, `tools/call`. Each request gets one JSON response; the
  server opens no event stream (`GET /mcp` is `405`) and keeps no MCP
  session, because every call is self-contained.
- Only an API key authenticates there, never the session cookie; a request
  without one is `401` with `WWW-Authenticate: Bearer`. MCP's OAuth flow is
  not offered: the user pastes a key into the agent's configuration.
  Requests carrying a foreign `Origin` are refused (DNS rebinding).
- Each tool needs one scope. `tools/list` shows only the tools the key may
  run; calling another returns a tool error naming the missing scope.
  - `read`: `list_accounts`, `list_tags` (budget progress, money boxes),
    `list_transactions` (date, account, tag, kind, state and text filters,
    paging), `spending_by_category`, `list_templates`.
  - `transactions:write`: `add_transaction` (spending, income, transfer,
    allocate), `update_transaction` (fields given only), `delete_transaction`.
  - `accounts:write`: `create_account`. `tags:write`: `create_tag`.
    `templates:write`: `generate_due`. `settings:write` has no tool.
- Tools speak in what a person thinks in: `spending`/`income` rather than
  transfers to and from external accounts, `title` and `note`. Amounts are
  decimal strings in the account's currency with the ISO 4217 exponent
  (`"120.50"`, `"980"` for JPY), each also given as integer `amountMinor`.
  Input amounts are parsed exactly (no floats); more decimals than the
  currency has, exponents and fractions are refused.
- The same validation as the REST API applies (same `Book` methods), and a
  key reaches only its own user's books.

## Migration

Migration 12 adds the `api_keys` table (`user_id`, `name`, `hint`,
`key_hash` unique, `scopes`, `created_at`, `last_used_at`, `expires_at`).
