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

// Balance ignores planned transactions and allocations. Every money
// movement is a transfer; spending and income are transfers to / from an
// external account.
func (d *Data) Balance(accountID string) int64 {
	var bal int64
	if a := d.accountByID(accountID); a != nil {
		bal = a.OpeningBalanceMinor
	}
	for _, t := range d.Transactions {
		if t.State != "posted" || t.Type != "transfer" {
			continue
		}
		if t.FromAccountID == accountID {
			bal -= t.AmountMinor
		}
		if t.ToAccountID == accountID {
			bal += t.AmountMinor
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
		if t.Type == "allocate" { // signed: negative takes money back out of the money box
			total += t.AmountMinor
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
		if t.Type == "allocate" { // signed: negative takes money back out of the money box
			total += t.AmountMinor
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
		if t.Type == "allocate" { // signed: negative takes money back out of the money box
			total += t.AmountMinor
		}
	}
	return total
}

// BudgetSpent sums posted spending (own account -> external) linked to the tag in the month of ref (YYYY-MM-DD).
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
		if t.State == "posted" && d.IsSpending(t) && linked[t.ID] && len(t.Date) >= 7 && t.Date[:7] == month {
			total += t.AmountMinor
		}
	}
	return total
}

// TagSpend is posted expense in one currency for one category tag; TagID ""
// collects expenses with no category tag.
type TagSpend struct {
	TagID       string `json:"tagId"`
	Currency    string `json:"currency"`
	AmountMinor int64  `json:"amountMinor"`
}

// SpendingByCategory sums posted expenses in ref's calendar month per
// (category tag, currency), largest first. Currencies are never mixed. An
// expense linked to two category tags counts toward both, as in BudgetSpent.
func (d *Data) SpendingByCategory(ref string) []TagSpend {
	month := ref[:7]
	category := map[string]bool{}
	for _, t := range d.Tags {
		if t.Kind == "category" {
			category[t.ID] = true
		}
	}
	cats := map[string][]string{}
	for _, tt := range d.TransactionTags {
		if category[tt.TagID] {
			cats[tt.TransactionID] = append(cats[tt.TransactionID], tt.TagID)
		}
	}
	type key struct{ tag, cur string }
	sums := map[key]int64{}
	for _, t := range d.Transactions {
		if t.State != "posted" || !d.IsSpending(t) || len(t.Date) < 7 || t.Date[:7] != month {
			continue
		}
		tags := cats[t.ID]
		if len(tags) == 0 {
			tags = []string{""}
		}
		for _, tag := range tags {
			sums[key{tag, t.Currency}] += t.AmountMinor
		}
	}
	out := make([]TagSpend, 0, len(sums))
	for k, v := range sums {
		out = append(out, TagSpend{TagID: k.tag, Currency: k.cur, AmountMinor: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Currency != out[j].Currency {
			return out[i].Currency < out[j].Currency
		}
		if out[i].AmountMinor != out[j].AmountMinor {
			return out[i].AmountMinor > out[j].AmountMinor
		}
		return out[i].TagID < out[j].TagID
	})
	return out
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
			if t.Type == "transfer" && t.TagID != "" { // category link, as for hand-entered transactions
				if _, err := s.db.Exec(`INSERT OR IGNORE INTO transaction_tags(transaction_id,tag_id) VALUES(?,?)`, t.ID, t.TagID); err != nil {
					return created, err
				}
				s.data.TransactionTags = append(s.data.TransactionTags, TransactionTag{TransactionID: t.ID, TagID: t.TagID})
			}
			created++
		}
	}
	return created, nil
}
