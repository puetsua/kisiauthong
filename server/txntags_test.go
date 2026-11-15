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
		TagID: "tag-fun", TagIDs: []string{"tag-food", "tag-fun"}})
	if err != nil {
		t.Fatal(err)
	}
	got := b.data.transactionByID(saved.ID)
	if !slices.Equal(got.TagIDs, []string{"tag-food", "tag-fun"}) || got.TagID != "" {
		t.Fatalf("categories: %+v / %q", got.TagIDs, got.TagID)
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

	// a category only in the old tag_id column still counts as one
	if _, err := b.exec(`INSERT INTO transactions(user_id,id,account_id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,time,tz,note,memo) VALUES(?,'txn-old','','acc-a','acc-external','tag-food','transfer','posted',500,'TWD',?,'','','','')`, today); err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if old := b.data.transactionByID("txn-old"); !slices.Equal(old.TagIDs, []string{"tag-food"}) || old.TagID != "" {
		t.Fatalf("old row: %+v / %q", old.TagIDs, old.TagID)
	}
	if n := b.data.BudgetSpent("tag-food", today, today); n != 500 {
		t.Fatalf("old row in budget: %d", n)
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
	call(toolUpdateTransaction, `{"id":"`+id+`","tagId":"tag-transport"}`)
	if cats := b.data.transactionByID(id).TagIDs; !slices.Equal(cats, []string{"tag-transport"}) {
		t.Fatalf("tagId sets one: %+v", cats)
	}
	call(toolUpdateTransaction, `{"id":"`+id+`","tagIds":[]}`)
	if cats := b.data.transactionByID(id).TagIDs; len(cats) != 0 {
		t.Fatalf("empty tagIds clears: %+v", cats)
	}
	if _, err := toolAddTransaction(b, json.RawMessage(`{"kind":"spending","amount":"1","accountId":"acc-a","tagIds":["tag-house"]}`)); err == nil {
		t.Fatal("a money box as a category was accepted")
	}
}

// a template saved with one category before ADR 0010 generates it as a category
func TestOldTemplateCategory(t *testing.T) {
	b := sampleBook(t)
	if _, err := b.exec(`INSERT INTO transaction_templates(user_id,id,name,enabled,template_json,schedule_json) VALUES(?,'tpl-old','Old',1,?,?)`,
		`{"fromAccountId":"acc-a","toAccountId":"acc-external","tagId":"tag-food","type":"transfer","amountMinor":100,"currency":"TWD","note":"x"}`,
		`{"frequency":"monthly","interval":1,"dayOfMonth":1,"startDate":"2026-01-01","endDate":"2026-01-31"}`); err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.GenerateDue("2026-02-01"); err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if got := b.data.transactionByID("txn-tpl-old-2026-01-01"); got == nil || !slices.Equal(got.TagIDs, []string{"tag-food"}) {
		t.Fatalf("generated: %+v", got)
	}
}
