// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"encoding/json"
	"slices"
	"testing"
)

// A transaction can carry several categories (ADR 0010).
func TestSeveralCategories(t *testing.T) {
	b := sampleBook(t)
	today := "2025-01-15" // a day without sample spending
	saved, err := b.addTransaction(Transaction{Type: "expense", AccountID: "acc-a", AmountMinor: 900, Date: today,
		TagIDs: []string{"tag-food", "tag-fun", "tag-fun"}})
	if err != nil {
		t.Fatal(err)
	}
	got := b.data.transactionByID(saved.ID)
	if !slices.Equal(got.TagIDs, []string{"tag-food", "tag-fun"}) {
		t.Fatalf("categories: %+v", got.TagIDs)
	}
	// each category's budget counts the whole amount
	for _, id := range []string{"tag-food", "tag-fun"} {
		if n := b.data.BudgetSpent(id, today, today); n != 900 {
			t.Fatalf("%s spent %d", id, n)
		}
	}
	// editing replaces the set; reopening the books keeps the order
	u := *got
	u.TagIDs = []string{"tag-transport", "tag-food"}
	if err := b.data.normalizeTransaction(&u); err != nil {
		t.Fatal(err)
	}
	if err := b.updateTransaction(u); err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if got := b.data.transactionByID(saved.ID); !slices.Equal(got.TagIDs, []string{"tag-transport", "tag-food"}) {
		t.Fatalf("after edit: %+v", got.TagIDs)
	}
	if n := b.data.BudgetSpent("tag-fun", today, today); n != 0 {
		t.Fatalf("removed category still counts: %d", n)
	}
	// none left: uncategorised
	u.TagIDs = nil
	if err := b.updateTransaction(u); err != nil {
		t.Fatal(err)
	}
	if got := b.data.transactionByID(saved.ID); len(got.TagIDs) != 0 {
		t.Fatalf("not cleared: %+v", got.TagIDs)
	}

}

func TestMCPCategories(t *testing.T) {
	b := sampleBook(t)
	call := func(f func(*Book, json.RawMessage) (map[string]interface{}, error), args string) map[string]interface{} {
		t.Helper()
		out, err := f(b, json.RawMessage(args))
		if err != nil {
			t.Fatalf("%s: %v", args, err)
		}
		return out["transaction"].(map[string]interface{})
	}
	tx := call(toolAddTransaction, `{"kind":"spending","amount":"12","accountId":"acc-a","tagIds":["tag-food","tag-fun"]}`)
	id := tx["id"].(string)
	if cats := b.data.transactionByID(id).TagIDs; !slices.Equal(cats, []string{"tag-food", "tag-fun"}) {
		t.Fatalf("add: %+v", cats)
	}
	call(toolUpdateTransaction, `{"id":"`+id+`","tagIds":["tag-transport"]}`)
	if cats := b.data.transactionByID(id).TagIDs; !slices.Equal(cats, []string{"tag-transport"}) {
		t.Fatalf("tagIds replaces: %+v", cats)
	}
	call(toolUpdateTransaction, `{"id":"`+id+`","tagIds":[]}`)
	if cats := b.data.transactionByID(id).TagIDs; len(cats) != 0 {
		t.Fatalf("empty tagIds clears: %+v", cats)
	}
	if _, err := toolAddTransaction(b, json.RawMessage(`{"kind":"spending","amount":"1","accountId":"acc-a","tagIds":["rsv-house"]}`)); err == nil {
		t.Fatal("a reserve as a category was accepted")
	}
}
