// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"fmt"
	"time"
)

// Budget periods (ADR 0004). A budgeted category tag has a limit per period:
//
//	cycle      "daily" | "weekly" | "monthly" (default) | "yearly" | "range"
//	cycleEvery the period is N units long: every 2 weeks, every 3 months… (default 1)
//	cycleStart the first day of one period, anchoring the rest; empty = calendar-aligned
//	           (weeks start on Monday, months on the 1st, years on January 1)
//	cycleEnd   "range" only: a single fixed period cycleStart..cycleEnd
//
// Month-based periods keep the anchor's day of month and clamp it to the last
// day of shorter months: monthly from the 31st runs Feb 28 → Mar 30, Mar 31 → Apr 29.
var budgetCycles = map[string]bool{"daily": true, "weekly": true, "monthly": true, "yearly": true, "range": true}

const maxCycleEvery = 99

// calendarAnchor is where unanchored periods are counted from: a Monday and a January 1.
const calendarAnchor = "2024-01-01"

func fmtDate(t time.Time) string { return t.Format("2006-01-02") }

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// addMonthsClamped moves anchor by n months, keeping its day of month or the month's last day.
func addMonthsClamped(anchor time.Time, n int) time.Time {
	first := time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, n, 0)
	day := anchor.Day()
	if dim := daysInMonth(first.Year(), first.Month()); day > dim {
		day = dim
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC)
}

// floorDiv rounds toward minus infinity, so periods before the anchor line up too.
func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// BudgetPeriod returns the period of a budgeted tag that contains ref, as inclusive dates.
// A "range" budget has one period whatever ref is.
func BudgetPeriod(t Tag, ref string) (start, end string) {
	every := t.CycleEvery
	if every < 1 {
		every = 1
	}
	cycle := t.Cycle
	if cycle == "" {
		cycle = "monthly"
	}
	if cycle == "range" {
		return t.CycleStart, t.CycleEnd
	}
	anchorS := t.CycleStart
	if anchorS == "" {
		anchorS = calendarAnchor
	}
	anchor, r := parseDate(anchorS), parseDate(ref)
	switch cycle {
	case "daily", "weekly":
		length := every
		if cycle == "weekly" {
			length *= 7
		}
		days := int(r.Sub(anchor).Hours() / 24)
		s := anchor.AddDate(0, 0, floorDiv(days, length)*length)
		return fmtDate(s), fmtDate(s.AddDate(0, 0, length-1))
	default: // monthly, yearly
		months := every
		if cycle == "yearly" {
			months *= 12
		}
		diff := (r.Year()-anchor.Year())*12 + int(r.Month()-anchor.Month())
		k := floorDiv(diff, months) * months
		s := addMonthsClamped(anchor, k)
		if s.After(r) { // ref falls before the anchor day in its month
			k -= months
			s = addMonthsClamped(anchor, k)
		}
		return fmtDate(s), fmtDate(addMonthsClamped(anchor, k+months).AddDate(0, 0, -1))
	}
}

// normalizeTag validates a tag: a category, a budget when it has a limit (ADR 0004, 0013).
func normalizeTag(t *Tag) error {
	if err := validMemo(&t.Memo); err != nil {
		return err
	}
	if err := validTagGroup(&t.Group); err != nil {
		return err
	}
	t.Currency = normCurrency(t.Currency)
	{
		if t.LimitMinor == nil {
			t.Cycle, t.CycleEvery, t.CycleStart, t.CycleEnd, t.Currency = "", 0, "", "", ""
			return nil
		}
		if *t.LimitMinor <= 0 {
			return fmt.Errorf("budget limit must be more than zero")
		}
		if !currencyRe.MatchString(t.Currency) {
			return fmt.Errorf("a budget needs a 3-letter currency code")
		}
		if t.Cycle == "" {
			t.Cycle = "monthly"
		}
		if !budgetCycles[t.Cycle] {
			return fmt.Errorf("budget period must be daily, weekly, monthly, yearly or range")
		}
		if t.Cycle == "range" {
			if !validDate(t.CycleStart) || !validDate(t.CycleEnd) {
				return fmt.Errorf("a date-range budget needs a start and an end date")
			}
			if t.CycleEnd < t.CycleStart {
				return fmt.Errorf("budget end date is before its start date")
			}
			t.CycleEvery = 0
			return nil
		}
		t.CycleEnd = ""
		if t.CycleEvery == 1 {
			t.CycleEvery = 0 // 1 is the default; store it as unset
		}
		if t.CycleEvery < 0 || t.CycleEvery > maxCycleEvery {
			return fmt.Errorf("budget period length must be 1-%d", maxCycleEvery)
		}
		if t.CycleStart != "" && !validDate(t.CycleStart) {
			return fmt.Errorf("budget start date must be YYYY-MM-DD")
		}
		return nil
	}
}
