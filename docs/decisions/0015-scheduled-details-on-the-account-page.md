<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0015 — Scheduled details live on the account's page

Date: 2026-11-18
Status: accepted (issue #10; amends the UI part of ADR 0014)

## Context

ADR 0014 put scheduled details on the top-level views: each account card
had a legend line with the first post date ("first posts 11/20") and a
second "Scheduled in" line, and Transactions opened with a blue section
listing every scheduled row of every account. Feedback: top-level views
should show amounts; the details belong behind the account they touch.
There was no account page: tapping a card opened the Edit dialog.

Three options were mocked up: one scheduled total on the card (A), a count
badge by the account name (B), and the blue bar segment alone (C). A was
chosen: it keeps a labelled amount for the blue segment, so Free +
Reserved + Scheduled still explain the balance at a glance.

## Decision

- **Cards show amounts only.** The account card (Accounts page, dashboard
  widget on phones, and the top of the account page) keeps the blue segment
  and one legend line, "Scheduled {amount}". No post dates, no "first", no
  Scheduled in line; an account with only incoming items shows nothing extra.
- **An own account has a page**, `#acct?id=…`, opened from its card or its
  name in the dashboard table (external accounts still open the Edit
  dialog). Under the same card it lists every scheduled row touching the
  account, soonest first, each with its post date and an amount signed from
  this account (− leaving, + arriving, incoming included), then the
  account's posted transactions by day / week / month / year. This list is
  the only place where post dates and per-item details are shown.
- **Transactions** folds the scheduled rows into one line, "{n} scheduled ·
  Open an account for details", that expands in place. It stays because the
  period feed cannot page past today, so far-future rows would otherwise be
  reachable only through search.
- No model or API change. `/api/state` still serves `nextHeldDate`,
  `incomingMinor` and `nextIncomingDate` (MCP and other clients may use
  them); the web card no longer does.

## Consequences

- Incoming money is invisible on the card until the account is opened; the
  count badge (option B) can be added later if that proves to be a problem.
- A card is the same everywhere, so a page that heads with it must not grow
  it; per-record details go in panels under the card (ui-guide).
