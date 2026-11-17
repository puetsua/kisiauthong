<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0004 — Two tag kinds; budget periods beyond the calendar month

Date: 2026-11-15
Status: accepted

## Context

Tags had four kinds: `category`, `goal`, `payee` and `label`.

- **Payee** overlapped with named external accounts (ADR 0002): an
  "Employer" or "7-Eleven" external account already records who was paid.
- **Label** behaved exactly like a category without a budget.
- Budgets only ran per calendar month, but people budget per week, per
  pay period (e.g. from the 25th), every two weeks, per quarter, per year,
  or for one fixed stretch such as a trip.

## Decision

- Tag kinds are **`category`** and **`goal`** (shown as "Money box").
  `label` and `payee` are no longer accepted; the API defaults a missing
  kind to `category`.
- A category becomes a budget by having `limit_minor` (> 0) and a
  `currency`. Its period is:
  - `cycle`: `daily | weekly | monthly | yearly | range` (default `monthly`)
  - `cycle_every`: the period is N units long (every 2 weeks, every 3
    months…), 1–99; stored as 0 when it is 1
  - `cycle_start`: the first day of one period, anchoring all others;
    empty means calendar-aligned (weeks from Monday, months from the 1st,
    years from January 1)
  - `cycle_end`: `range` only — a single fixed period
    `cycle_start..cycle_end`
- Month-based periods keep the anchor's day of month and clamp it to the
  last day of shorter months (monthly from the 31st: Feb 28 → Mar 30).
- Budget progress counts posted spending (own → external) linked to the
  tag with a date inside the current period. Spending reports stay per
  calendar month.
- A category without a limit carries no currency or period. A tag that
  transactions or templates use switches between category and money box
  only when the update says `dropUses: true`, after the client has warned
  that its uses go: a money box that becomes a category deletes its
  allocations and the templates that allocate to it (they mean nothing
  without a money box); a category that becomes a money box is taken off
  its transactions and templates, which are kept. Category and budget
  switch freely: a budget is a category with a limit.

## Migration

- Migration 4: tags of kind `label` or `payee` become `category`; their
  transaction links are kept.
- Migration 5: `tags` gains `cycle_every`, `cycle_start` and `cycle_end`
  (empty), so existing monthly budgets keep their calendar months.

## Consequences

- The web UI has no Budgets page: budgets, categories and money boxes are
  cards on the Tags page.
- Budget notifications are keyed by period start, so a dismissed alert
  returns when the next period runs over.
- Rollover between periods is still an open decision (AGENTS.md §11).
