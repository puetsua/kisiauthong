<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0029 — The type follows the accounts; one transaction form

Date: 2026-11-27
Issue: #148
Status: accepted

## Context

Since ADR 0002, every money movement has been stored as a transfer from one
account to another. Spending and income were labels derived from the
accounts. The stored `type` column still existed, though, and always held
`transfer`. The API returned `type: "transfer"` for everything.

The add form treated the three labels as different kinds of record:

- Expense and Income had Tags and Save as template.
- Transfer had neither, and both of its sides were limited to own accounts.

Two bugs followed from that split:

- saving an unchanged tagged transfer cleared its tags (#144);
- saving an unchanged transfer template turned it into an expense (#145).

The owner asked for the reverse: Transfer is the full form, and Expense and
Income are simplified transfers with one side kept to external accounts.

## Decision

- **The type is derived, never stored.** A transaction's type comes from
  its two accounts:
  - own → external is `expense`;
  - external → own is `income`;
  - own → own is `transfer`.
  - External → external is not a transaction and is rejected, as before.
    It moves no money in the user's books.
- **Migration 18** drops `transactions.type`.
  - Every row left by migrations 1 and 14 holds `transfer` with both
    accounts set, so nothing is lost.
  - The migration stops, rather than drop data, if it finds any other
    value.
  - Template bodies keep their JSON. A money movement is stored there as
    `transfer` with its accounts, and its type is derived again when the
    books load.
- **The API stays compatible.** `type` is still accepted and returned:
  - On output, `type` is the derived value: `expense`, `income` or
    `transfer`. Before this change it was always `transfer`. All three
    values were already in the OpenAPI enum.
  - On input, `transfer` (or no type) means "from `fromAccountId` to
    `toAccountId` as given". An external side then makes the record an
    expense or an income.
  - `expense` and `income` remain shorthands (`accountId` plus an
    optional named external account), and the result must be what they
    say.
  - The Tauri apps load the web UI from the server (ADR 0019), so they
    follow the server with no app release.
  - MCP `add_transaction` with `kind: transfer` also takes an external
    side.
- **One form.** The add/edit form has the same fields on every tab, in
  this order: Title, From, To, Amount, Date and time, Tags, Note, and
  Save as template.
  - **Transfer** offers any account on both sides. From lists own accounts,
    then external accounts. To follows the rules above. Choosing an external
    side simply makes the record spending or income.
  - **Expense** and **Income** are shortcuts:
    - Expense keeps To to external accounts and defaults to External.
    - Income keeps From to external accounts and defaults to External.
    - From always comes before To. On Income, the source comes first,
      then the own account.
  - **Field names are the only labels:**
    - From account / Paid to on Expense;
    - Received from / To account on Income;
    - From account / To account on Transfer.
  - When only the built-in External account exists, the locked side is
    shown read-only (greyed), not hidden.
  - **Switching tabs keeps the tags and the accounts** wherever the new tab
    allows them. Expense ⇄ Income swaps the two sides.
  - **A saved record opens on the tab its accounts give:** own → external on
    Expense, external → own on Income, own → own on Transfer.
- **Templates** get the same From and To for Expense, Income and Transfer.
  Put in reserve keeps Account and Reserve.
- **Budgets:** a budget tag gets **`countTransfers`** ("Count transfers
  between own accounts"). It is off by default and is stored as
  `tags.count_transfers`, added by migration 19.
  - Off: transfers between own accounts never count, as ADR 0021 says.
  - On: a tagged own → own transfer counts as spending in the budget's
    currency.
  - The tag page's net follows the same rule.
  - The spending report follows the switch too: the dashboard's Spending
    widget and MCP `spending_by_category`.
    - Off (the default): it counts only money paid to external accounts.
    - On: a transfer between own accounts with that budget's tag also counts,
      on that tag's row, in the budget's currency, as the budget counts it.
    - Such a transfer never counts as uncategorised spending, and never under
      a tag whose switch is off.
    - The report stays gross: income never reduces it (ADR 0021).
  - A tag without a budget never keeps the switch.

## Consequences

- API clients that read `type` see `expense` or `income` where they used to
  see `transfer`. The value comes from the same enum, and the accounts
  explain it.
- Changing a transaction's accounts changes its type, so an edit can turn an
  expense into a transfer. Nothing about the type needs separate
  maintenance.
- Credit-card payments and cash taken out for a trip can carry tags. With
  the switch on, they can count toward a budget, for example a savings
  budget filled by transfers.
- Supersedes the parts of ADR 0002 that describe Transfer as a separate
  editing mode without categories. Amends ADR 0021: own → own transfers
  count toward a budget, and in the spending report under its tag, when it
  is set to count them.
