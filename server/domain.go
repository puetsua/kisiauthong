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

// Balance ignores planned transactions. Every money movement is a transfer;
// spending and income are transfers to / from an external account.
// Allocations move no money and never touch it (ADR 0013).
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

func (d *Data) reserveByID(id string) *Reserve {
	for i := range d.Reserves {
		if d.Reserves[i].ID == id {
			return &d.Reserves[i]
		}
	}
	return nil
}

func (d *Data) allocationByID(id string) *Allocation {
	for i := range d.Allocations {
		if d.Allocations[i].ID == id {
			return &d.Allocations[i]
		}
	}
	return nil
}

// Reserved is what an account holds for reserves: the sum of its signed allocations.
func (d *Data) Reserved(accountID string) int64 {
	var total int64
	for _, a := range d.Allocations {
		if a.AccountID == accountID {
			total += a.AmountMinor
		}
	}
	return total
}

// ReservedIn is what one reserve holds in one account, leaving out allocation skipID
// (so an edit is judged against everything else).
func (d *Data) ReservedIn(reserveID, accountID, skipID string) int64 {
	var total int64
	for _, a := range d.Allocations {
		if a.ID != skipID && a.ReserveID == reserveID && a.AccountID == accountID {
			total += a.AmountMinor
		}
	}
	return total
}

// ReserveSaved is what a reserve holds: its allocations in its own currency.
// In another currency an allocation is shown but not added (ADR 0011, 0013).
func (d *Data) ReserveSaved(id string) int64 {
	r := d.reserveByID(id)
	var total int64
	for _, a := range d.Allocations {
		if r != nil && a.ReserveID == id && a.Currency == r.Currency {
			total += a.AmountMinor
		}
	}
	return total
}

// ReserveShare is what a reserve holds in one account.
type ReserveShare struct {
	AccountID   string `json:"accountId"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// ReserveSplit is where a reserve's money is, account by account (non-zero only).
func (d *Data) ReserveSplit(id string) []ReserveShare {
	out := []ReserveShare{}
	for _, acc := range d.Accounts {
		if n := d.ReservedIn(id, acc.ID, ""); n != 0 {
			out = append(out, ReserveShare{AccountID: acc.ID, AmountMinor: n, Currency: acc.Currency})
		}
	}
	return out
}

// countsToward reports whether a transaction in currency cur adds to the
// tag's budget: only in the tag's own currency. In any other currency the
// tag is just a label on it (ADR 0011).
func (d *Data) countsToward(tagID, cur string) bool {
	tag := d.tagByID(tagID)
	return tag != nil && (tag.Currency == "" || tag.Currency == cur)
}

// BudgetSpent sums posted spending (own account -> external) in the tag's
// currency linked to the tag, with a date in [start, end] (inclusive
// YYYY-MM-DD; see BudgetPeriod).
func (d *Data) BudgetSpent(tagID, start, end string) int64 {
	linked := map[string]bool{}
	for _, tt := range d.TransactionTags {
		if tt.TagID == tagID {
			linked[tt.TransactionID] = true
		}
	}
	var total int64
	for _, t := range d.Transactions {
		if t.State == "posted" && d.IsSpending(t) && linked[t.ID] && t.Date >= start && t.Date <= end && d.countsToward(tagID, t.Currency) {
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
	cats := map[string][]string{}
	for _, tt := range d.TransactionTags {
		cats[tt.TransactionID] = append(cats[tt.TransactionID], tt.TagID)
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
	if s.Frequency == "never" || s.StartDate == "" { // a shortcut (ADR 0012), or no schedule to follow
		return nil
	}
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
	for _, a := range d.Allocations {
		if a.TransactionTemplateID == tplID && a.OccurrenceDate == date {
			return true
		}
	}
	return false
}

// GenerateDue materialises occurrences up to today (inclusive), at most once per (template, date).
// A transaction waits as planned until it is confirmed; an allocation template's occurrence is an
// allocation, final at once because no money moves (ADR 0013).
func (b *Book) GenerateDue(today string) (int, error) {
	created := 0
	for _, tpl := range b.data.TransactionTemplates {
		if !tpl.Enabled {
			continue
		}
		for _, occ := range Occurrences(tpl, tpl.Schedule.StartDate, today) {
			if b.data.existingOccurrence(tpl.ID, occ) {
				continue
			}
			if tpl.Template.Type == "allocate" {
				a := Allocation{
					ID: fmt.Sprintf("alc-%s-%s", tpl.ID, occ), ReserveID: tpl.Template.ReserveID, AccountID: tpl.Template.AccountID,
					AmountMinor: tpl.Template.AmountMinor, Currency: tpl.Template.Currency, Date: occ, Note: tpl.Template.Note,
					TransactionTemplateID: tpl.ID, OccurrenceDate: occ,
				}
				if err := b.insertAllocation(a); err != nil {
					return created, err
				}
				b.data.Allocations = append(b.data.Allocations, a)
				created++
				continue
			}
			t := Transaction{
				ID:            fmt.Sprintf("txn-%s-%s", tpl.ID, occ),
				FromAccountID: tpl.Template.FromAccountID, ToAccountID: tpl.Template.ToAccountID, TagIDs: tpl.Template.TagIDs,
				Type: tpl.Template.Type, State: "planned", AmountMinor: tpl.Template.AmountMinor,
				Currency: tpl.Template.Currency, Date: occ, Note: tpl.Template.Note,
				TransactionTemplateID: tpl.ID, OccurrenceDate: occ,
			}
			if err := b.insertTransaction(t); err != nil {
				return created, err
			}
			b.data.Transactions = append(b.data.Transactions, t)
			for _, id := range t.TagIDs { // category links, as for hand-entered transactions
				if err := b.linkTag(t.ID, id); err != nil {
					return created, err
				}
				b.data.TransactionTags = append(b.data.TransactionTags, TransactionTag{TransactionID: t.ID, TagID: id})
			}
			created++
		}
	}
	return created, nil
}
