<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0011 — A budget or money box counts only its own currency

Date: 2026-11-16
Status: accepted

## Context

A transaction is in one currency: transfers between own accounts must
share it, and a currency change is spending in one and income in the
other. Budgets and money boxes have a currency too, but their totals
added up linked transactions of any currency, so a JPY expense tagged
with a TWD budget counted 2,500 yen as 2,500 dollars.

## Decision

- A transaction adds to a tag's budget spending or money-box savings only
  when it is in the tag's currency.
- In any other currency the tag stays on the transaction as a label: it
  shows in lists, filters and the tag's transaction count, but no amount
  of it reaches the budget or the money box. There is no conversion.
- An allocation in another currency still earmarks part of its own
  account's balance (the account's free and earmarked amounts are in the
  account's currency); it just is not part of the money box's savings.
- The spending report already groups by currency and never mixes them, so
  it is unchanged.
