// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"fmt"
	"regexp"
	"time"
	_ "time/tzdata" // IANA zones built in, so time zones work on hosts without a zoneinfo database
)

// When a transaction happened (ADR 0006): Date is the local date where it
// happened and stays the date budgets and reports use. An optional Time
// ("HH:MM") is local to TZ, the IANA zone it was entered in; together they
// fix an instant, served as At (UTC) so clients can show it in any zone.

var clockRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// normalizeWhen validates a date, an optional time and its zone, and derives the instant
// (for transactions and allocations alike).
func normalizeWhen(date, clock, tz, at *string) error {
	if *date != "" && !validDate(*date) {
		return fmt.Errorf("date must be YYYY-MM-DD")
	}
	if *clock == "" {
		*tz, *at = "", ""
		return nil
	}
	if !clockRe.MatchString(*clock) {
		return fmt.Errorf("time must be HH:MM (24-hour)")
	}
	if *tz == "" {
		return fmt.Errorf("a time needs its time zone")
	}
	if _, err := time.LoadLocation(*tz); err != nil || *tz == "Local" {
		return fmt.Errorf("unknown time zone: %s", *tz)
	}
	*at = instant(*date, *clock, *tz)
	return nil
}

// instant is the UTC moment of a local date and time in zone tz, or "" for a
// date-only transaction. A wall time skipped by a DST change resolves forward.
func instant(date, clock, tz string) string {
	if clock == "" || tz == "" {
		return ""
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return ""
	}
	at, err := time.ParseInLocation("2006-01-02 15:04", date+" "+clock, loc)
	if err != nil {
		return ""
	}
	return at.UTC().Format(time.RFC3339)
}
