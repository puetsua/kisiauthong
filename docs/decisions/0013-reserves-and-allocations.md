<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0013 — Reserves own their allocations; allocations are not transactions

Date: 2026-11-17
Status: accepted (replaces 0003; amends 0004, 0011 and 0012)

## Context

A money box was a tag of kind `goal`, and putting money into it was a
transaction of type `allocate` (ADR 0003). An allocation moves no money:
balance derivation already ignored it. Storing a decision as a money
movement bent the rest of the model around it:

- Transaction carried a second tag field (`tagId`, the money box) and a
  signed amount, both only for allocations.
- Budgets, spending reports, quick picks and search had to leave
  allocations out.
- A tag could not change between category and money box without breaking
  the transactions that pointed at it the other way.

## Decision

- **Transaction** is only a money movement: `transfer` with
  `fromAccountId`, `toAccountId`, a positive amount and its categories.
  The `allocate` type, the transaction's `tagId` and signed amounts are
  gone (`expense` and `income` stay accepted as shorthands for transfers).
- **Tag** is only a category, optionally a budget (a limit and a period,
  ADR 0004). The kind `goal` is retired, so a tag has no kind to switch.
- **Reserve** (UI: "Reserve" / 「預留款」) is a new element: `id`, `name`,
  `currency`, optional `targetMinor` and `targetDate`.
- **Allocation** belongs to one reserve: `id`, `reserveId`, `accountId`
  (an own account), signed `amountMinor` (+ puts money in, − takes it
  out, never 0), `currency` (the account's), `date`, optional `time`/`tz`,
  `note`, `memo`, `createdAt`, and, when a template made it,
  `transactionTemplateId` + `occurrenceDate`.
- Derived, never stored:
  - a reserve's **saved** amount = Σ its allocations in the reserve's
    currency; allocations in another currency are shown but not added
    (as ADR 0011 had it for tags);
  - an account's **reserved** amount = Σ allocations on it; its **free**
    amount = balance − reserved;
  - the per-account split of a reserve.
- Rules:
  - An allocation may not take out more than the reserve holds in that
    account (per reserve and account, Σ ≥ 0), as in ADR 0003.
  - Putting in more than an account's free amount is allowed, and so is
    spending that leaves an account holding less than it reserves; the
    account then shows a warning ("reserved more than its balance").
    Spending never changes a reserve: the two are not linked.
  - Deleting a reserve deletes its allocations, after the UI shows how
    many.
  - Undoing a decision is a new dated allocation, never an edit of
    history (as before); editing and deleting single allocations stays
    possible for typos.
- **Templates** stay the one generator (ADR 0012 unchanged otherwise): a
  template is either a transaction template or an **allocation template**
  (`reserveId`, `accountId`, signed amount). Its occurrences become
  allocations, posted at once because no money moves, at most one per
  (template, occurrence date).
- **API** (breaking, allowed while 0.x): `/api/reserves`,
  `/api/reserves/{id}`, `/api/reserves/{id}/allocations`,
  `/api/reserves/{id}/complete` (one take-out per account holding money,
  all or nothing), `/api/allocations/{id}`, under a new API key scope
  `reserves:write`; `GET /api/state` returns `reserves` (with
  `savedMinor` and the split), `allocations`, and per account
  `reservedMinor` / `freeMinor`. `type: "allocate"` / `"release"` on
  transactions is rejected and tags have no kind. MCP tools follow
  (`list_reserves`, `list_allocations`, `create_reserve`,
  `add_allocation`, `delete_allocation`). The export gains `reserves` and
  `allocations`.
- **UI**: a Reserves page in the navigation, one page per reserve with
  its allocation history by day, week, month or year, and **Put in**,
  **Take out**, **Complete** (take out everything) and **Use** (take out
  an amount, then open the add form with that account and amount: two
  independent records). The add form loses its Allocate type; the Tags
  page shows categories and budgets only. The dashboard widget
  `moneyboxes` becomes `reserves`.

## Migration

Migration 14, inside one database transaction, after a backup:

1. Create `reserves` and `allocations`.
2. Every `goal` tag becomes a reserve with the **same id**, name, currency,
   target and target date; the tag row is removed.
3. Every `allocate` transaction becomes an allocation with the **same
   id**, reserve (its old `tag_id`), account, signed amount, currency,
   date, time, tz, note, memo, created time, template and occurrence
   date; the transaction row is removed. A planned one (if any) becomes a
   normal allocation.
4. Every allocate template becomes an allocation template (`tagId` →
   `reserveId`); its schedule and history are kept.
5. Saved dashboard layouts rename the widget `moneyboxes` to `reserves`.
6. Links of transactions to money boxes are dropped; a category still
   kept only in a transaction's or template's old single `tagId` becomes
   a link. An allocation whose money box was deleted keeps a placeholder
   reserve named "(money box)" with the old id, so no amount is lost.
7. The columns only those used (`transactions.account_id`,
   `transactions.tag_id`, `tags.kind`, `tags.target_minor`,
   `tags.target_date`) are dropped.

No amount, date, note or id is lost; a migration test runs it on a copy
of a real book and checks counts and sums before and after.

## Consequences

- One meaning per element: transactions move money, reserves earmark it,
  tags label it. The category ↔ money box switch (and its `dropUses`
  flag) disappears.
- A downgraded server cannot read a migrated book (0.x, accepted; back up
  before updating).
- Code that only existed for allocations-as-transactions is deleted, not
  kept for compatibility.
