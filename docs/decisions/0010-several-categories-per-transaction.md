<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0010 — Several categories per transaction

Date: 2026-11-16
Status: accepted

## Context

Tags were always meant to be many-to-many with transactions, and the
server kept a `transaction_tags` link table that budgets and the spending
report already read. The API, the form and the transaction itself still
carried one `tagId`, so a purchase such as snacks bought on a trip could
not be both Food and Travel.

## Decision

- A transfer (spending, income or between own accounts) has **`tagIds`**:
  zero or more categories, kept in `transaction_tags` in the order given.
  A money box is never one of them.
- An allocation keeps **`tagId`**: exactly one money box. It has no
  `tagIds`.
- Older clients may still send a single `tagId` with a transfer; it is
  taken as one category. A transfer saved before this change with a
  category only in the `tag_id` column reads it back as its category, so
  no migration is needed. Templates follow the same rules.
- Editing a transaction replaces its categories with the `tagIds` sent;
  none means uncategorised.
- Every budget and spending total counts the whole amount under each of
  the transaction's categories, so category totals can add up to more
  than the money spent. Splitting one amount across categories is a
  split transaction, still a non-goal.
- MCP: `add_transaction` and `update_transaction` take `tagIds`;
  `tagId` on a non-allocation sets a single category.
- The web form shows categories as toggles, and the transaction filter
  matches a transaction with any of its categories.
