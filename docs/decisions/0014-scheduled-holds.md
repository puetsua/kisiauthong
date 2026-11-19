<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0014 — A future-dated transaction is scheduled and holds its amount

Date: 2026-11-18
Status: accepted (issue #7)

## Context

A transaction dated in the future counted in balances at once: a card
payment entered on the 18th for the 20th lowered the bank balance and paid
down the card two days early. Users want such a transaction to move no money
until its date, while the amount stays out of reach (it should not be
reserved or spent meanwhile), and to post by itself on the date.

The existing `planned` state (template occurrences waiting for
confirmation) does not fit: it holds nothing and needs a person to confirm.
"Today" was also the server process's zone everywhere, so in a UTC container
the first eight hours of a Taipei day were still yesterday.

Three options were mocked up: a stored `scheduled` state with a post job
(A), `planned` with an auto-post flag and the hold folded into reserved (B),
and a derived state where the date decides (C). Decision: C's model with A's
presentation.

## Decision

- **Nothing new is stored.** A `posted` transaction with `date > today(user)`
  *is* scheduled. The server serves it with `state: "scheduled"`
  (read-only); a client that writes `scheduled` back has it stored as
  `posted`. There is no migration, no background job and no write when the
  date arrives: the derivation simply changes, so there is no sync churn and
  nothing can be left stale. Existing future-dated rows start holding at
  once.
- **Sums take today.** `Balance`, `BudgetSpent`, `SpendingByCategory` and
  "last activity" count a posted row only when `date ≤ today`. Budgets and
  spending reports count a scheduled row once it posts.
- **Held and incoming.** Only money leaving an **own** account is held:
  spending (own → external) and transfers between own accounts, on the
  source. Income (external → own) holds nothing; it shows as *incoming* on
  the destination and is not added to free. A card as destination shows a
  scheduled payment as incoming; spending from a card holds against it like
  any own account.
- **Free = balance − reserved − held.** The hold is not an Allocation and is
  shown apart from reserved, so ADR 0013 stands as it is (reserved = Σ
  allocations, spending never touches a reserve). Holding more than the free
  amount warns, never blocks.
- **API.** `/api/state` accounts gain `heldMinor`, `incomingMinor`,
  `projectedMinor` (the balance once everything scheduled has posted) and
  `nextHeldDate` / `nextIncomingDate`; `freeMinor` subtracts held. MCP:
  `list_transactions state=scheduled` lists rows dated after today,
  `list_accounts` gains `held`, `incoming` and `projected`, `add_transaction`
  with a future date is scheduled by definition.
- **Post now** sets the date to today: `POST /api/transactions/{id}/post`
  does so for a scheduled row, as does MCP `update_transaction state=posted`
  without a date, and the web drawer's "Post now" button. Editing the date to
  today or earlier posts a row; moving it after today schedules it again.
  Changing the amount or the source, or deleting the row, moves or releases
  the hold at once.
- **One today.** `today(user)` is the date in the user's Settings time
  zone; when that is Auto, in `KISIAUTHONG_TZ`; else in the server process's
  zone. Every server-side "today" uses it (state, MCP, default dates,
  Generate). The granularity is the date: a row with a time posts at the
  start of its date, as budgets and reports use the date (ADR 0006).
- **UI.** Scheduled is blue (`--sched`, `--schedbg`, `--schedink`,
  `--schedline`), distinct from the amber of expected and the purple of
  reserved: a blue segment in the account bar parted from the reserved one by
  a 2px gap, with a legend (Free / Reserved / Scheduled / Scheduled in); a
  Free / Reserved / Scheduled (not posted) split on the dashboard balances;
  a blue "Scheduled · posts on its date" section above the period feed that
  lists every scheduled row whatever its date; a blue note in the drawer.
  *Amended by ADR 0016:* the card legend shows the scheduled amount only
  (no dates, no Scheduled in line), Transactions folds the section into one
  line, and the dates and rows are listed on each account's page.
- `planned` keeps its meaning. Templates still generate planned rows that
  wait for confirmation; letting a template generate posted rows ahead of
  their date (and so get holds) is a later decision.

## Consequences

- The model has no way to say "future-dated but already happened" and no
  opt-out of the hold; no real case is known.
- Every sum must take today, and a missed spot would count a row early;
  tests cover today/tomorrow, month end, income, an external source and a
  card.
- Around midnight a client and the server in different zones can disagree
  about today for a few hours. Nothing is stored, so nothing needs
  reconciling; the web client uses the earlier of the two for "Post now".
- Answers AGENTS.md §11 "auto-post or confirm" for hand-entered rows (they
  post by date); for templates the question stays open.
