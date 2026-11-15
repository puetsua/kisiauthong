// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import "testing"

// ext is the anonymous external account: income comes from it, spending goes to it.
var ext = Account{ID: ExternalAccountID, Name: "External", Kind: "external"}

func sample() Data {
	return Data{
		Accounts: []Account{{ID: "a", Name: "A", Currency: "TWD", OpeningBalanceMinor: 60000000}, ext},
		Tags:     []Tag{{ID: "food", Name: "Food", Kind: "category", Currency: "TWD"}, {ID: "goal", Name: "Goal", Kind: "goal", Currency: "TWD"}},
		Transactions: []Transaction{
			{ID: "1", FromAccountID: ExternalAccountID, ToAccountID: "a", Type: "transfer", State: "posted", Currency: "TWD", AmountMinor: 8000000, Date: "2026-10-05"},
			{ID: "2", FromAccountID: "a", ToAccountID: ExternalAccountID, Type: "transfer", State: "posted", Currency: "TWD", AmountMinor: 3000000, Date: "2026-10-10"},
			{ID: "3", FromAccountID: "a", ToAccountID: ExternalAccountID, Type: "transfer", State: "planned", Currency: "TWD", AmountMinor: 999999, Date: "2026-10-12"},
			{ID: "4", AccountID: "a", TagID: "goal", Type: "allocate", State: "posted", Currency: "TWD", AmountMinor: 40000000, Date: "2026-03-01"},
			{ID: "5", AccountID: "a", TagID: "goal", Type: "allocate", State: "posted", Currency: "TWD", AmountMinor: -5000000, Date: "2026-10-01"}, // taken back out
		},
	}
}

func TestBalanceIgnoresPlannedAndAllocate(t *testing.T) {
	d := sample()
	if got := d.Balance("a"); got != 65000000 {
		t.Fatalf("balance = %d, want 65000000", got)
	}
	if got := d.Allocated("a", "goal"); got != 35000000 {
		t.Fatalf("allocated = %d, want 35000000", got)
	}
	if got := d.TagSaved("goal"); got != 35000000 {
		t.Fatalf("saved = %d, want 35000000", got)
	}
}

func TestOccurrencesClampMonthEnd(t *testing.T) {
	tpl := TransactionTemplate{Schedule: Schedule{Frequency: "monthly", Interval: 1, DayOfMonth: 31, StartDate: "2026-01-31"}}
	got := Occurrences(tpl, "2026-01-31", "2026-03-31")
	want := []string{"2026-01-31", "2026-02-28", "2026-03-31"}
	if len(got) != len(want) {
		t.Fatalf("occurrences = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("occurrences = %v, want %v", got, want)
		}
	}
}

func TestBudgetSpentCurrentMonthOnly(t *testing.T) {
	d := sample()
	d.TransactionTags = []TransactionTag{{TransactionID: "2", TagID: "food"}, {TransactionID: "3", TagID: "food"}}
	if got := d.BudgetSpent("food", "2026-10-01", "2026-10-31"); got != 3000000 {
		t.Fatalf("spent = %d, want 3000000 (planned excluded)", got)
	}
	if got := d.BudgetSpent("food", "2026-11-01", "2026-11-30"); got != 0 {
		t.Fatalf("spent Nov = %d, want 0", got)
	}
}

func TestBudgetPeriod(t *testing.T) {
	cases := []struct {
		name       string
		tag        Tag
		ref        string
		start, end string
	}{
		{"monthly default", Tag{}, "2026-11-15", "2026-11-01", "2026-11-30"},
		{"monthly, first day", Tag{Cycle: "monthly"}, "2026-11-01", "2026-11-01", "2026-11-30"},
		{"monthly from the 25th, before it", Tag{Cycle: "monthly", CycleStart: "2026-01-25"}, "2026-11-10", "2026-10-25", "2026-11-24"},
		{"monthly from the 25th, after it", Tag{Cycle: "monthly", CycleStart: "2026-01-25"}, "2026-11-25", "2026-11-25", "2026-12-24"},
		{"monthly from the 31st clamps in February", Tag{Cycle: "monthly", CycleStart: "2026-01-31"}, "2026-03-05", "2026-02-28", "2026-03-30"},
		{"monthly from the 31st, leap year", Tag{Cycle: "monthly", CycleStart: "2028-01-31"}, "2028-02-29", "2028-02-29", "2028-03-30"},
		{"every 2 months", Tag{Cycle: "monthly", CycleEvery: 2, CycleStart: "2026-01-01"}, "2026-12-31", "2026-11-01", "2026-12-31"},
		{"every 3 months, before the anchor", Tag{Cycle: "monthly", CycleEvery: 3, CycleStart: "2026-02-01"}, "2026-01-15", "2025-11-01", "2026-01-31"},
		{"weekly from Monday by default", Tag{Cycle: "weekly"}, "2026-11-15", "2026-11-09", "2026-11-15"},
		{"every 2 weeks", Tag{Cycle: "weekly", CycleEvery: 2, CycleStart: "2026-11-02"}, "2026-11-20", "2026-11-16", "2026-11-29"},
		{"every 3 weeks, before the anchor", Tag{Cycle: "weekly", CycleEvery: 3, CycleStart: "2026-11-02"}, "2026-10-30", "2026-10-12", "2026-11-01"},
		{"daily", Tag{Cycle: "daily"}, "2026-11-15", "2026-11-15", "2026-11-15"},
		{"every 10 days", Tag{Cycle: "daily", CycleEvery: 10, CycleStart: "2026-11-01"}, "2026-11-25", "2026-11-21", "2026-11-30"},
		{"yearly", Tag{Cycle: "yearly"}, "2026-11-15", "2026-01-01", "2026-12-31"},
		{"yearly from April", Tag{Cycle: "yearly", CycleStart: "2020-04-01"}, "2026-03-31", "2025-04-01", "2026-03-31"},
		{"every 2 years", Tag{Cycle: "yearly", CycleEvery: 2, CycleStart: "2025-01-01"}, "2026-06-01", "2025-01-01", "2026-12-31"},
		{"date range", Tag{Cycle: "range", CycleStart: "2026-12-20", CycleEnd: "2027-01-05"}, "2026-11-15", "2026-12-20", "2027-01-05"},
	}
	for _, c := range cases {
		s, e := BudgetPeriod(c.tag, c.ref)
		if s != c.start || e != c.end {
			t.Errorf("%s: got %s..%s, want %s..%s", c.name, s, e, c.start, c.end)
		}
	}
}

func TestNormalizeTag(t *testing.T) {
	lim, zero, target := int64(500000), int64(0), int64(100)
	ok := []Tag{
		{Name: "Food"},
		{Name: "Food", Kind: "category", LimitMinor: &lim, Currency: "twd"},
		{Name: "Trip", Kind: "category", LimitMinor: &lim, Currency: "JPY", Cycle: "range", CycleStart: "2026-12-20", CycleEnd: "2026-12-31"},
		{Name: "Fun", Kind: "category", LimitMinor: &lim, Currency: "TWD", Cycle: "weekly", CycleEvery: 2, CycleStart: "2026-11-02"},
		{Name: "House", Kind: "goal", TargetMinor: &target, Currency: "TWD"},
	}
	for _, tg := range ok {
		if err := normalizeTag(&tg); err != nil {
			t.Errorf("%+v: %v", tg, err)
		}
	}
	plain := Tag{Name: "Rent", Kind: "category", Currency: "TWD", Cycle: "monthly"}
	if err := normalizeTag(&plain); err != nil || plain.Currency != "" || plain.Cycle != "" {
		t.Errorf("a category without a limit keeps no currency or period: %+v %v", plain, err)
	}
	b := Tag{Name: "Food", LimitMinor: &lim, Currency: "TWD", CycleEvery: 1}
	if err := normalizeTag(&b); err != nil || b.Cycle != "monthly" || b.CycleEvery != 0 {
		t.Errorf("defaults: %+v %v", b, err)
	}
	bad := []Tag{
		{Name: "x", Kind: "label"},
		{Name: "x", Kind: "payee"},
		{Name: "x", LimitMinor: &zero, Currency: "TWD"},
		{Name: "x", LimitMinor: &lim},
		{Name: "x", LimitMinor: &lim, Currency: "TWD", Cycle: "hourly"},
		{Name: "x", LimitMinor: &lim, Currency: "TWD", Cycle: "weekly", CycleEvery: 100},
		{Name: "x", LimitMinor: &lim, Currency: "TWD", Cycle: "monthly", CycleStart: "2026-13-01"},
		{Name: "x", LimitMinor: &lim, Currency: "TWD", Cycle: "range", CycleStart: "2026-12-01"},
		{Name: "x", LimitMinor: &lim, Currency: "TWD", Cycle: "range", CycleStart: "2026-12-01", CycleEnd: "2026-11-30"},
		{Name: "x", Kind: "goal", Currency: "TWD"},
	}
	for _, tg := range bad {
		if err := normalizeTag(&tg); err == nil {
			t.Errorf("accepted %+v", tg)
		}
	}
}

func TestSpendingByCategoryPerCurrencyAndMonth(t *testing.T) {
	spend := func(id, from string, amt int64, cur, date, state string) Transaction {
		return Transaction{ID: id, Type: "transfer", FromAccountID: from, ToAccountID: ExternalAccountID, State: state, AmountMinor: amt, Currency: cur, Date: date}
	}
	d := Data{
		Accounts: []Account{{ID: "twd", Currency: "TWD"}, {ID: "jpy", Currency: "JPY"}, {ID: "b", Currency: "TWD"}, ext},
		Tags:     []Tag{{ID: "food", Kind: "category"}, {ID: "fun", Kind: "category"}, {ID: "trip", Kind: "label"}},
		Transactions: []Transaction{
			spend("1", "twd", 500, "TWD", "2026-11-02", "posted"),
			spend("2", "twd", 300, "TWD", "2026-11-30", "posted"),
			spend("3", "jpy", 1000, "JPY", "2026-11-10", "posted"),
			spend("4", "twd", 9999, "TWD", "2026-11-12", "planned"),
			spend("5", "twd", 7777, "TWD", "2026-10-31", "posted"),
			{ID: "6", Type: "transfer", FromAccountID: ExternalAccountID, ToAccountID: "twd", State: "posted", AmountMinor: 8888, Currency: "TWD", Date: "2026-11-05"},
			spend("7", "twd", 40, "TWD", "2026-11-06", "posted"),
			spend("8", "twd", 200, "TWD", "2026-11-07", "posted"),
			{ID: "9", Type: "transfer", FromAccountID: "twd", ToAccountID: "b", State: "posted", AmountMinor: 5555, Currency: "TWD", Date: "2026-11-08"},
		},
		TransactionTags: []TransactionTag{
			{TransactionID: "1", TagID: "food"}, {TransactionID: "2", TagID: "food"}, {TransactionID: "3", TagID: "food"},
			{TransactionID: "4", TagID: "food"}, {TransactionID: "5", TagID: "food"}, {TransactionID: "6", TagID: "food"},
			{TransactionID: "8", TagID: "fun"}, {TransactionID: "8", TagID: "trip"}, {TransactionID: "9", TagID: "food"},
		},
	}
	got := d.SpendingByCategory("2026-11-15")
	want := []TagSpend{
		{TagID: "food", Currency: "JPY", AmountMinor: 1000},
		{TagID: "food", Currency: "TWD", AmountMinor: 800},
		{TagID: "fun", Currency: "TWD", AmountMinor: 200},
		{TagID: "", Currency: "TWD", AmountMinor: 40},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("row %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestExternalSideDecidesSpendingAndIncome(t *testing.T) {
	d := sample()
	in, out, planned := d.Transactions[0], d.Transactions[1], d.Transactions[2]
	if !d.IsIncome(in) || d.IsSpending(in) || !d.IsSpending(out) || d.IsIncome(out) || !d.IsSpending(planned) {
		t.Fatalf("income/spending misclassified")
	}
	own := Transaction{Type: "transfer", FromAccountID: "a", ToAccountID: "a2"}
	d.Accounts = append(d.Accounts, Account{ID: "a2", Currency: "TWD"})
	if d.IsIncome(own) || d.IsSpending(own) {
		t.Fatalf("a transfer between own accounts is neither income nor spending")
	}
}

func TestListenAddrDefaultsToLoopback(t *testing.T) {
	cases := []struct{ host, port, want string }{
		{"", "", "127.0.0.1:8080"},
		{"", "8099", "127.0.0.1:8099"},
		{"0.0.0.0", "8080", "0.0.0.0:8080"},
		{"::1", "8080", "[::1]:8080"},
	}
	for _, c := range cases {
		if got := listenAddr(c.host, c.port); got != c.want {
			t.Errorf("listenAddr(%q, %q) = %q, want %q", c.host, c.port, got, c.want)
		}
	}
}

// A tag counts only transactions in its own currency; in another currency it is just a label (ADR 0011).
func TestTagCountsItsOwnCurrencyOnly(t *testing.T) {
	d := sample()
	d.Accounts = append(d.Accounts, Account{ID: "j", Name: "J", Currency: "JPY", OpeningBalanceMinor: 100000})
	d.Transactions = append(d.Transactions,
		Transaction{ID: "6", FromAccountID: "j", ToAccountID: ExternalAccountID, Type: "transfer", State: "posted", Currency: "JPY", AmountMinor: 2500, Date: "2026-10-11"},
		Transaction{ID: "7", AccountID: "j", TagID: "goal", Type: "allocate", State: "posted", Currency: "JPY", AmountMinor: 50000, Date: "2026-10-11"})
	d.TransactionTags = []TransactionTag{{TransactionID: "2", TagID: "food"}, {TransactionID: "6", TagID: "food"}}
	if got := d.BudgetSpent("food", "2026-10-01", "2026-10-31"); got != 3000000 {
		t.Fatalf("spent = %d, want 3000000 (the JPY expense only carries the label)", got)
	}
	if got := d.TagSaved("goal"); got != 35000000 {
		t.Fatalf("saved = %d, want 35000000 (the JPY allocation only carries the label)", got)
	}
	if got := d.Allocated("j", "goal"); got != 50000 {
		t.Fatalf("the JPY account still earmarks it: %d", got)
	}
}
