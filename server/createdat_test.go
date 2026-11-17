// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import "testing"

// A new transaction records when it was entered; editing keeps it (migration 13).
func TestTransactionCreatedAt(t *testing.T) {
	b := sampleBook(t)
	saved, err := b.addTransaction(Transaction{Type: "expense", AccountID: "acc-a", AmountMinor: 900, Date: "2025-01-15"})
	if err != nil {
		t.Fatal(err)
	}
	got := b.data.transactionByID(saved.ID)
	if len(got.CreatedAt) != len("2006-01-02T15:04:05.000Z") {
		t.Fatalf("created at %q", got.CreatedAt)
	}
	stamp := got.CreatedAt
	u := *got
	u.Note = "changed"
	u.CreatedAt = ""
	if err := b.updateTransaction(u); err != nil {
		t.Fatal(err)
	}
	if after := b.data.transactionByID(saved.ID).CreatedAt; after != stamp {
		t.Fatalf("edit changed created at: %q -> %q", stamp, after)
	}
	later, err := b.addTransaction(Transaction{Type: "expense", AccountID: "acc-a", AmountMinor: 100, Date: "2024-01-01"})
	if err != nil {
		t.Fatal(err)
	}
	if b.data.transactionByID(later.ID).CreatedAt < stamp {
		t.Fatal("a later entry sorts before an earlier one")
	}
}
