// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import "testing"

func sample() Data {
	return Data{
		Accounts: []Account{{ID: "a", Name: "A", Currency: "TWD", OpeningBalanceMinor: 60000000}},
		Transactions: []Transaction{
			{ID: "1", AccountID: "a", Type: "income", State: "posted", AmountMinor: 8000000, Date: "2026-10-05"},
			{ID: "2", AccountID: "a", Type: "expense", State: "posted", AmountMinor: 3000000, Date: "2026-10-10"},
			{ID: "3", AccountID: "a", Type: "expense", State: "planned", AmountMinor: 999999, Date: "2026-10-12"},
			{ID: "4", AccountID: "a", TagID: "goal", Type: "allocate", State: "posted", AmountMinor: 40000000, Date: "2026-03-01"},
			{ID: "5", AccountID: "a", TagID: "goal", Type: "release", State: "posted", AmountMinor: 5000000, Date: "2026-10-01"},
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
	d := Data{
		Tags: []Tag{{ID: "food", Kind: "category"}, {ID: "fun", Kind: "category"}, {ID: "trip", Kind: "label"}},
		Transactions: []Transaction{
			{ID: "1", Type: "expense", State: "posted", AmountMinor: 500, Currency: "TWD", Date: "2026-11-02"},
			{ID: "2", Type: "expense", State: "posted", AmountMinor: 300, Currency: "TWD", Date: "2026-11-30"},
			{ID: "3", Type: "expense", State: "posted", AmountMinor: 1000, Currency: "JPY", Date: "2026-11-10"},
			{ID: "4", Type: "expense", State: "planned", AmountMinor: 9999, Currency: "TWD", Date: "2026-11-12"},
			{ID: "5", Type: "expense", State: "posted", AmountMinor: 7777, Currency: "TWD", Date: "2026-10-31"},
			{ID: "6", Type: "income", State: "posted", AmountMinor: 8888, Currency: "TWD", Date: "2026-11-05"},
			{ID: "7", Type: "expense", State: "posted", AmountMinor: 40, Currency: "TWD", Date: "2026-11-06"},
			{ID: "8", Type: "expense", State: "posted", AmountMinor: 200, Currency: "TWD", Date: "2026-11-07"},
		},
		TransactionTags: []TransactionTag{
			{TransactionID: "1", TagID: "food"}, {TransactionID: "2", TagID: "food"}, {TransactionID: "3", TagID: "food"},
			{TransactionID: "4", TagID: "food"}, {TransactionID: "5", TagID: "food"}, {TransactionID: "6", TagID: "food"},
			{TransactionID: "8", TagID: "fun"}, {TransactionID: "8", TagID: "trip"},
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
