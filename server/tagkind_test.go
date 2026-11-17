// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"slices"
	"testing"
)

// A used tag switches between category and money box only with dropUses (ADR 0004).
func TestSwitchUsedTagKind(t *testing.T) {
	srv, s := testServer(t)
	b := addTestUser(t, s, "alice", true)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	count := func(q string, args ...interface{}) int {
		var n int
		if err := s.db.QueryRow(q, append([]interface{}{"usr-alice"}, args...)...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	allocs := func() int { return count(`SELECT count(*) FROM transactions WHERE user_id=? AND tag_id='tag-house'`) }
	if allocs() == 0 || count(`SELECT count(*) FROM transaction_tags WHERE user_id=? AND tag_id='tag-food'`) == 0 {
		t.Fatal("sample data lacks uses to drop")
	}
	txns := count(`SELECT count(*) FROM transactions WHERE user_id=?`)

	// money box -> category: refused without the flag, nothing changes
	asCat := map[string]interface{}{"name": "House fund", "kind": "category"}
	if code := alice.do("PUT", "/api/tags/tag-house", asCat, nil); code != 400 {
		t.Fatalf("without dropUses: %d", code)
	}
	if allocs() == 0 {
		t.Fatal("a refused switch dropped allocations")
	}
	n := allocs()
	asCat["dropUses"] = true
	if code := alice.do("PUT", "/api/tags/tag-house", asCat, nil); code != 200 {
		t.Fatalf("with dropUses: %d", code)
	}
	if allocs() != 0 || count(`SELECT count(*) FROM transactions WHERE user_id=?`) != txns-n {
		t.Fatal("allocations not dropped, or other transactions lost")
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if tg := b.data.tagByID("tag-house"); tg.Kind != "category" {
		t.Fatalf("kind %q", tg.Kind)
	}
	for _, tp := range b.data.TransactionTemplates {
		if tp.Template.TagID == "tag-house" {
			t.Fatalf("template %s still allocates to it", tp.ID)
		}
	}

	// category (a budget) -> money box: its transactions stay, without the tag
	tpl := map[string]interface{}{"name": "Lunch", "enabled": true, "schedule": map[string]interface{}{"frequency": "never"},
		"template": map[string]interface{}{"type": "expense", "accountId": "acc-a", "amountMinor": 1000, "currency": "TWD", "tagIds": []string{"tag-food"}}}
	if code := alice.do("POST", "/api/templates", tpl, nil); code != 201 {
		t.Fatalf("template: %d", code)
	}
	before := count(`SELECT count(*) FROM transactions WHERE user_id=?`)
	asBox := map[string]interface{}{"name": "Food", "kind": "goal", "currency": "TWD", "targetMinor": 100000, "dropUses": true}
	if code := alice.do("PUT", "/api/tags/tag-food", asBox, nil); code != 200 {
		t.Fatalf("category to money box: %d", code)
	}
	if count(`SELECT count(*) FROM transactions WHERE user_id=?`) != before {
		t.Fatal("transactions were deleted")
	}
	if count(`SELECT count(*) FROM transaction_tags WHERE user_id=? AND tag_id='tag-food'`) != 0 {
		t.Fatal("links kept")
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	for _, tp := range b.data.TransactionTemplates {
		if slices.Contains(tp.Template.TagIDs, "tag-food") {
			t.Fatalf("template %s still has the tag", tp.ID)
		}
	}
	if tg := b.data.tagByID("tag-food"); tg.Kind != "goal" || tg.LimitMinor != nil {
		t.Fatalf("after: %+v", tg)
	}
}
