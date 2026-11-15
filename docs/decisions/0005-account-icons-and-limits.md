<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0005 — Accounts have an icon, not a type; an optional limit

Date: 2026-11-15
Status: accepted (amends 0002 on account kinds)

## Context

Own accounts had a type (`bank`, `savings`, `cash`, `credit_card`,
`ewallet`, `investment`, `loan`). Apart from `external`, the type changed
nothing: it picked an icon and a label. The credit-card behaviour (owed
amount, utilisation, alerts) already came from the credit-limit field,
which any account could have, and `allow_negative` was stored but never
read. A credit card or a loan is simply an account whose balance runs
negative.

## Decision

- `kind` is **`own`** or **`external`** (ADR 0002). The old types are
  still accepted on input as `own`, and become the account's icon.
- Accounts get an **`icon`**: a short name from the client's icon set
  (bank, savings, cash, card, wallet, phone, coins, investment, loan,
  home, car, travel, gift, work, shop, globe). The server only checks the
  name's shape; an unknown name falls back to the default icon.
- The credit limit becomes an optional **`limitMinor`** on any own
  account (stored in the existing `credit_limit_minor` column). When set,
  the account shows owed = max(0, −balance) against it, its utilisation,
  and an alert from 80%. It is a warning threshold, never a block.
- `allow_negative` is no longer read or written by the API; any account
  may run negative.
- The dashboard Accounts widget loses its Kind column (saved layouts that
  list it are cleaned) and gains optional Limit and Owed columns.

## Migration

Migration 6: `accounts` gains `icon`. Each own account's old type becomes
its icon (`credit_card` → `card`, `ewallet` → `wallet`), and its kind
becomes `own`. External accounts are unchanged.

## Consequences

- The account form asks for name, currency, opening balance, an optional
  limit and an icon; an external account only for name and icon.
- The Accounts page lists accounts by name with their icons.
