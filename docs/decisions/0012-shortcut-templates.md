<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0012 — A template that never repeats is a shortcut

Date: 2026-11-16
Status: accepted

## Context

Everyday entries such as breakfast are the same each time apart from the
amount. Templates already hold everything a transaction needs (accounts,
categories, amount, title), but every template had a schedule and the
generator turned it into transactions, so they could not serve as a
manual starting point.

## Decision

- A schedule's `frequency` may be `never`. Such a template is a
  **shortcut**: the generator skips it, it has no next date, and the add
  form offers it as a one-tap fill. The date and time stay "now", the
  amount is ready to change, and the transaction is saved as usual. It
  does not carry `transaction_template_id`, which stays reserved for
  generated occurrences.
- The server now checks schedules: the frequency is one of `daily`,
  `weekly`, `monthly`, `quarterly`, `yearly` or `never` (empty still means
  monthly), and a repeating schedule needs a valid start date. A `never`
  schedule drops every other field.
- The add form also suggests, after the shortcuts, entries made at least
  twice in the last 60 days with the same type, account and title that no
  shortcut covers. These are derived in the client and never stored.
- No new element: this stays inside TransactionTemplate.
