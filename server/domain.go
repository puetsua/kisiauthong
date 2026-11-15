// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"fmt"
	"sort"
	"time"
)

func parseDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func (d *Data) accountByID(id string) *Account {
	for i := range d.Accounts {
		if d.Accounts[i].ID == id {
			return &d.Accounts[i]
		}
	}
	return nil
}

// Balance ignores planned and allocate/release transactions.
func (d *Data) Balance(accountID string) int64 {
	var bal int64
	if a := d.accountByID(accountID); a != nil {
		bal = a.OpeningBalanceMinor
	}
	for _, t := range d.Transactions {
		if t.State != "posted" {
			continue
		}
		switch t.Type {
		case "income":
			if t.AccountID == accountID {
				bal += t.AmountMinor
			}
		case "expense":
			if t.AccountID == accountID {
				bal -= t.AmountMinor
			}
		case "transfer":
			if t.FromAccountID == accountID {
				bal -= t.AmountMinor
			}
			if t.ToAccountID == accountID {
				bal += t.AmountMinor
			}
		}
	}
	return bal
}

func (d *Data) Allocated(accountID, tagID string) int64 {
	var total int64
	for _, t := range d.Transactions {
		if t.State != "posted" || t.AccountID != accountID || t.TagID != tagID {
			continue
		}
		if t.Type == "allocate" {
			total += t.AmountMinor
		}
		if t.Type == "release" {
			total -= t.AmountMinor
		}
	}
	return total
}

func (d *Data) AllocatedForAccount(accountID string) int64 {
	var total int64
	for _, t := range d.Transactions {
		if t.State != "posted" || t.AccountID != accountID {
			continue
		}
		if t.Type == "allocate" {
			total += t.AmountMinor
		}
		if t.Type == "release" {
			total -= t.AmountMinor
		}
	}
	return total
}

func (d *Data) TagSaved(tagID string) int64 {
	var total int64
	for _, t := range d.Transactions {
		if t.State != "posted" || t.TagID != tagID {
			continue
		}
		if t.Type == "allocate" {
			total += t.AmountMinor
		}
		if t.Type == "release" {
			total -= t.AmountMinor
		}
	}
	return total
}

// BudgetSpent sums posted expenses linked to the tag in the month of ref (YYYY-MM-DD).
func (d *Data) BudgetSpent(tagID, ref string) int64 {
	month := ref[:7]
	linked := map[string]bool{}
	for _, tt := range d.TransactionTags {
		if tt.TagID == tagID {
			linked[tt.TransactionID] = true
		}
	}
	var total int64
	for _, t := range d.Transactions {
		if t.State == "posted" && t.Type == "expense" && linked[t.ID] && len(t.Date) >= 7 && t.Date[:7] == month {
			total += t.AmountMinor
		}
	}
	return total
}

func daysInMonth(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// Occurrences returns scheduled dates in [from, to] inclusive, clamping day-of-month.
func Occurrences(tpl TransactionTemplate, from, to string) []string {
	s := tpl.Schedule
	interval := s.Interval
	if interval < 1 {
		interval = 1
	}
	start := parseDate(s.StartDate)
	end := parseDate(to)
	if s.EndDate != "" && parseDate(s.EndDate).Before(end) {
		end = parseDate(s.EndDate)
	}
	fromT := parseDate(from)
	var out []string
	cur := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, time.UTC)
	for !cur.After(last) {
		var occ time.Time
		switch s.Frequency {
		case "daily":
			// handled below by day stepping from start
			occ = cur
		case "weekly":
			occ = cur
		default: // monthly, quarterly, yearly
			day := s.DayOfMonth
			if day < 1 {
				day = 1
			}
			if dim := daysInMonth(cur.Year(), cur.Month()); day > dim {
				day = dim
			}
			occ = time.Date(cur.Year(), cur.Month(), day, 0, 0, 0, 0, time.UTC)
		}
		if s.Frequency == "daily" || s.Frequency == "weekly" {
			step := interval
			if s.Frequency == "weekly" {
				step = interval * 7
			}
			for d := start; !d.After(end); d = d.AddDate(0, 0, step) {
				if !d.Before(fromT) {
					out = append(out, d.Format("2006-01-02"))
				}
			}
			break
		}
		if !occ.Before(start) && !occ.After(end) && !occ.Before(fromT) {
			out = append(out, occ.Format("2006-01-02"))
		}
		switch s.Frequency {
		case "quarterly":
			cur = cur.AddDate(0, 3*interval, 0)
		case "yearly":
			cur = cur.AddDate(interval, 0, 0)
		default:
			cur = cur.AddDate(0, interval, 0)
		}
	}
	sort.Strings(out)
	return out
}

func (d *Data) existingOccurrence(tplID, date string) bool {
	for _, t := range d.Transactions {
		if t.TransactionTemplateID == tplID && t.OccurrenceDate == date {
			return true
		}
	}
	return false
}

// GenerateDue materialises occurrences up to today (inclusive). allocate posts immediately, others planned.
func (s *Store) GenerateDue(today string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	created := 0
	for _, tpl := range s.data.TransactionTemplates {
		if !tpl.Enabled {
			continue
		}
		for _, occ := range Occurrences(tpl, tpl.Schedule.StartDate, today) {
			if s.data.existingOccurrence(tpl.ID, occ) {
				continue
			}
			state := "planned"
			if tpl.Template.Type == "allocate" {
				state = "posted"
			}
			t := Transaction{
				ID:        fmt.Sprintf("txn-%s-%s", tpl.ID, occ),
				AccountID: tpl.Template.AccountID, FromAccountID: tpl.Template.FromAccountID,
				ToAccountID: tpl.Template.ToAccountID, TagID: tpl.Template.TagID,
				Type: tpl.Template.Type, State: state, AmountMinor: tpl.Template.AmountMinor,
				Currency: tpl.Template.Currency, Date: occ, Note: tpl.Template.Note,
				TransactionTemplateID: tpl.ID, OccurrenceDate: occ,
			}
			if err := s.insertTransaction(t); err != nil {
				return created, err
			}
			s.data.Transactions = append(s.data.Transactions, t)
			created++
		}
	}
	return created, nil
}
