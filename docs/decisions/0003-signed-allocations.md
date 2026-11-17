<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0003 — One allocation type with a signed amount (no `release`)

Date: 2026-11-15
Status: superseded by 0013 (allocations belong to reserves, not transactions; the signed amount stays)

## Context

Money boxes had two decision records: `allocate` (earmark part of an
account's balance) and `release` (give it back). They are the same
decision in two directions, like expense and income were before 0002.

## Decision

- `release` is no longer a stored type. Stored types are **`transfer`**
  and **`allocate`**.
- An allocation's `amount_minor` is **signed**: positive moves money into
  the money box, negative takes it back out. Zero is rejected. Every other
  amount (transfers) stays strictly positive.
- An allocation may not take out more than the account holds for that
  money box: per (account, money box), Σ allocations ≥ 0, checked against
  all other posted allocations (so editing one is judged without itself).
- The API accepts `type: "release"` as a shorthand for a negative
  allocation.
- The web UI has one Allocate mode; the amount field accepts a negative
  value, and a negative allocation reads money box → account with a "−".

## Migration

Migration 2 (`PRAGMA user_version` 1 → 2): every `release` row becomes an
`allocate` row with the amount negated. Nothing else changes.

## Consequences

- Allocated per (account, money box) = Σ signed allocations; saved per
  money box = Σ over its accounts. One rule instead of two.
- Undoing a decision is still a new dated record (a negative allocation),
  never an edit of history.
