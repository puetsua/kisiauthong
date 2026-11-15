// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import "testing"

// ext is the anonymous external account: income comes from it, spending goes to it.
var ext = Account{ID: ExternalAccountID, Name: "External", Kind: "external"}

func sample() Data {
	return Data{
		Accounts: []Account{{ID: "a", Name: "A", Currency: "TWD", OpeningBalanceMinor: 60000000}, ext},
		Transactions: []Transaction{
			{ID: "1", FromAccountID: ExternalAccountID, ToAccountID: "a", Type: "transfer", State: "posted", AmountMinor: 8000000, Date: "2026-10-05"},
			{ID: "2", FromAccountID: "a", ToAccountID: ExternalAccountID, Type: "transfer", State: "posted", AmountMinor: 3000000, Date: "2026-10-10"},
			{ID: "3", FromAccountID: "a", ToAccountID: ExternalAccountID, Type: "transfer", State: "planned", AmountMinor: 999999, Date: "2026-10-12"},
			{ID: "4", AccountID: "a", TagID: "goal", Type: "allocate", State: "posted", AmountMinor: 40000000, Date: "2026-03-01"},
			{ID: "5", AccountID: "a", TagID: "goal", Type: "allocate", State: "posted", AmountMinor: -5000000, Date: "2026-10-01"}, // taken back out
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
	if got := d.BudgetSpent("food", "2026-10-15"); got != 3000000 {
		t.Fatalf("spent = %d, want 3000000 (planned excluded)", got)
	}
	if got := d.BudgetSpent("food", "2026-11-15"); got != 0 {
		t.Fatalf("spent Nov = %d, want 0", got)
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
