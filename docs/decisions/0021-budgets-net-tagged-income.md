<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0021 — A budget counts net spending: tagged income takes it off

Date: 2026-11-21
Status: accepted

## Context

A budget's spent amount (ADR 0004) added up only spending (own →
external) linked to its tag. Money that comes back for the same purpose
did not count: a friend paying back their share of a trip, a refund to a
credit card, a deposit returned. A user who paid 12,000 for two tickets
and got 7,000 back saw 12,000 spent against the trip budget, and the only
way to show the real cost was to split or edit the original record.

## Decision

- A budget's spent amount is **tagged spending minus tagged income** in
  its period: income (external → own, a card refund included) linked to
  the tag takes off the spending. The user decides what counts by tagging
  the income; untagged income never touches a budget.
- It is **not floored at 0**. When more comes back than went out in a
  period, spent is negative and remaining is more than the limit. This is
  no rollover rule (still open, AGENTS.md §11): every period counts only
  its own transactions.
- Income counts in the period of its own date, like spending; a refund in
  the next period lowers the next period's spent amount.
- The currency rule is ADR 0011's: income counts only in the budget's
  currency; in any other currency the tag is just a label.
- Transfers between own accounts never count, in either direction.
- Income linked to several tags takes the full amount off each of their
  budgets, as spending adds in full to each (ADR 0010).
- Scheduled income (dated after today) and `planned` occurrences count
  once they post, as spending does (ADR 0014).
- The spending report (Spending by category: the dashboard widget, MCP
  `spending_by_category`) stays **gross spending**: income does not reduce it.
  The same tag can therefore show more there than its budget's spent.

## Consequences

- `BudgetSpent` on the server and the budget preview in the tag merge
  dialog both net tagged income; the budget card's bar is empty below 0.
- Existing books change on upgrade: income already carrying a budget's
  tag starts reducing that budget's spent amount at once.
