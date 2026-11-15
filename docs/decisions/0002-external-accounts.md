<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0002 — Expense and income are transfers to and from external accounts

Date: 2026-11-15
Status: accepted

## Context

Transactions had five stored types: `expense`, `income`, `transfer`,
`allocate`, `release`. Expense and income are the same thing as a
transfer — money moving from one place to another — except that one side
is outside the user's books. Keeping them as separate types meant three
code paths for balances, three shapes of record, and no way to say *who*
was paid or who paid.

## Decision

- New account kind **`external`**: a place outside the user's books (an
  employer, a shop, "the world"). External accounts have no currency, no
  opening balance and no balance of their own; they never appear in
  balances, totals or account lists of the user's money.
- A system account **`acc-external`** ("External") is the anonymous
  external account. Users may add named external accounts.
- Stored transaction types are now only **`transfer`**, **`allocate`**,
  **`release`**.
  - Spending = a transfer from an own account to an external account.
  - Income = a transfer from an external account to an own account.
  - A transfer needs at least one own account; external → external is
    rejected.
  - Currency comes from the own side. Between two own accounts the
    currencies must match; converting currency is spending in one
    currency and income in the other (no FX transfers, as before).
  - Category tags may be attached to transfers (never money boxes).
- `allocate` / `release` are unchanged (money-box decisions on an own
  account), but can no longer target an external account.
- The API keeps accepting `type: "expense"` / `"income"` as shorthands;
  the server stores them as transfers with the anonymous external account
  (or a named external account the client gives).
- The web UI keeps Expense / Income / Transfer as editing modes and as
  labels, derived from which side is external.
- Budgets and spending reports count transfers from own to external.

## Migration

Migration 1 (`PRAGMA user_version` 0 → 1) creates `acc-external`, rewrites
stored `expense` / `income` rows and transaction templates as transfers,
and leaves everything else untouched. Migrations are numbered, append-only
and run once at start-up.

## Consequences

- One balance rule for every movement: subtract from `from`, add to `to`.
- Payees / payers can become real accounts later (per-payee totals) without
  another model change.
- Clients must treat `kind: external` accounts as outside the books.
