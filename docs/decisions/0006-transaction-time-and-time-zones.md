<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 0006 — Transaction time and time zones

Date: 2026-11-15
Status: accepted

## Context

Transactions had only a date. People want the time too, and they travel:
a coffee bought at 07:30 in Taipei is 00:30 Tokyo time on another day for
nobody, but it is 15:30 the previous day in Los Angeles. The web form also
took "today" from UTC, so before 08:00 in Taiwan it proposed yesterday.

## Decision

- A transaction keeps its **`date`**: the local date where it happened.
  It may add **`time`** (`HH:MM`, 24-hour, local) and then must carry
  **`tz`**, the IANA zone it was entered in. Without a time there is no
  zone; existing and template-generated transactions stay date-only.
- The server validates the zone (IANA database built into the binary)
  and derives **`at`**, the UTC instant, which is served but never stored.
- New transactions default to now on the device's clock and zone. Editing
  keeps the transaction's own date, time and zone.
- Settings → **Time zone**: "Auto" (default) shows times in the device's
  zone, so it follows the user when travelling; or a fixed IANA zone.
  Timed transactions are shown, sorted and grouped by day in that display
  zone; a time from another zone is marked and its local time is in the
  tooltip. Date-only transactions stay on their date in every zone.
- Budgets and reports keep using the stored local `date` (no UTC shift),
  so a purchase counts in the period of the day it was made where it was
  made.

## Migration

Migration 7: `transactions` gains `time` and `tz` (empty).

## Consequences

- Near midnight, a timed transaction viewed from another zone can appear
  under a different day in the list than the budget day it counts for.
