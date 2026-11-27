// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"testing"
)

// ADR 0029: a transaction's type follows its accounts. The API still takes and returns
// type; on input "transfer" (or none) means "from → to as given", and "expense" / "income"
// stay shorthands that must end up as what they say.
func TestTypeIsDerivedFromTheAccounts(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	shop := Account{}
	if code := alice.do("POST", "/api/accounts", map[string]interface{}{"name": "[TEST] Shop", "kind": "external"}, &shop); code != 201 {
		t.Fatalf("external account: %d", code)
	}
	cases := []struct {
		name     string
		body     map[string]interface{}
		code     int
		wantType string
	}{
		{"transfer own -> external is an expense", map[string]interface{}{"type": "transfer", "fromAccountId": "acc-b", "toAccountId": shop.ID}, 201, "expense"},
		{"transfer external -> own is an income", map[string]interface{}{"type": "transfer", "fromAccountId": shop.ID, "toAccountId": "acc-a"}, 201, "income"},
		{"transfer own -> own stays a transfer", map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": "acc-b"}, 201, "transfer"},
		{"no type: derived", map[string]interface{}{"fromAccountId": "acc-a", "toAccountId": ExternalAccountID}, 201, "expense"},
		{"expense shorthand", map[string]interface{}{"type": "expense", "accountId": "acc-b"}, 201, "expense"},
		{"income shorthand with a named payer", map[string]interface{}{"type": "income", "accountId": "acc-a", "fromAccountId": shop.ID}, 201, "income"},
		{"external -> external is rejected", map[string]interface{}{"type": "transfer", "fromAccountId": ExternalAccountID, "toAccountId": shop.ID}, 400, ""},
		{"an expense from an external account is rejected", map[string]interface{}{"type": "expense", "accountId": shop.ID}, 400, ""},
		{"unknown type", map[string]interface{}{"type": "refund", "fromAccountId": "acc-a", "toAccountId": "acc-b"}, 400, ""},
	}
	for _, c := range cases {
		body := map[string]interface{}{"amountMinor": 1000, "date": "2026-11-01", "note": "[TEST] " + c.name}
		for k, v := range c.body {
			body[k] = v
		}
		var got Transaction
		code := alice.do("POST", "/api/transactions", body, &got)
		if code != c.code {
			t.Errorf("%s: %d, want %d", c.name, code, c.code)
			continue
		}
		if code == 201 && got.Type != c.wantType {
			t.Errorf("%s: type %q, want %q", c.name, got.Type, c.wantType)
		}
	}
	// editing the accounts changes the type: an expense moved to an own account is a transfer
	var exp Transaction
	alice.do("POST", "/api/transactions", map[string]interface{}{"type": "expense", "accountId": "acc-a", "amountMinor": 500, "date": "2026-11-02", "tagIds": []string{"tag-food"}}, &exp)
	var moved Transaction
	if code := alice.do("PUT", "/api/transactions/"+exp.ID, map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": "acc-b", "amountMinor": 500, "date": "2026-11-02", "tagIds": []string{"tag-food"}}, &moved); code != 200 || moved.Type != "transfer" || len(moved.TagIDs) != 1 {
		t.Fatalf("edit to own -> own: %d %+v", code, moved)
	}
	var st struct{ Transactions []Transaction }
	alice.do("GET", "/api/state", nil, &st)
	for _, x := range st.Transactions {
		if x.ID == exp.ID && (x.Type != "transfer" || len(x.TagIDs) != 1) {
			t.Fatalf("served after the edit: %+v", x)
		}
	}
	// a template's type is derived the same way, and its stored JSON keeps the plain transfer form
	var tp TransactionTemplate
	if code := alice.do("POST", "/api/templates", map[string]interface{}{"name": "[TEST] Card payment", "enabled": true,
		"template": map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": "acc-b", "amountMinor": 1500, "tagIds": []string{"tag-food"}},
		"schedule": map[string]interface{}{"frequency": "monthly", "dayOfMonth": 20, "startDate": "2026-12-20"}}, &tp); code != 201 || tp.Template.Type != "transfer" || len(tp.Template.TagIDs) != 1 {
		t.Fatalf("transfer template: %d %+v", code, tp)
	}
	var tpExp TransactionTemplate
	if code := alice.do("POST", "/api/templates", map[string]interface{}{"name": "[TEST] Coffee", "enabled": true,
		"template": map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": shop.ID, "amountMinor": 120},
		"schedule": map[string]interface{}{"frequency": "never"}}, &tpExp); code != 201 || tpExp.Template.Type != "expense" {
		t.Fatalf("expense template from a transfer body: %d %+v", code, tpExp)
	}
	var stored string
	if err := s.db.QueryRow(`SELECT template_json FROM transaction_templates WHERE id=?`, tpExp.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var raw map[string]interface{}
	_ = json.Unmarshal([]byte(stored), &raw)
	if raw["type"] != "transfer" {
		t.Errorf("stored template type %v, want transfer (derived when loaded)", raw["type"])
	}
}

// A new database is created without a type column, and with the budget switch (ADR 0029).
func TestFreshSchemaHasNoStoredType(t *testing.T) {
	s := openTestStore(t)
	if has, err := hasColumnDB(s.db, "transactions", "type"); err != nil || has {
		t.Errorf("transactions.type in a new database (%v)", err)
	}
	if has, err := hasColumnDB(s.db, "tags", "count_transfers"); err != nil || !has {
		t.Errorf("tags.count_transfers missing in a new database (%v)", err)
	}
}

// A budget counts transfers between own accounts only when set to (off by default, ADR 0029).
func TestBudgetCountTransfers(t *testing.T) {
	d := sample()
	d.Accounts = append(d.Accounts, Account{ID: "card", Name: "Card", Currency: "TWD"}, Account{ID: "shop", Name: "Shop", Kind: "external"})
	limit := int64(1000000)
	d.Tags = append(d.Tags, Tag{ID: "trip", Name: "Trip", Currency: "TWD", LimitMinor: &limit})
	txn := func(id, from, to string, amt int64) Transaction {
		return Transaction{ID: id, FromAccountID: from, ToAccountID: to, Type: d.Kind(from, to), State: "posted", Currency: "TWD", AmountMinor: amt, Date: "2026-11-10"}
	}
	d.Transactions = []Transaction{
		txn("cash", "a", "card", 300000), // own -> own: cash for the trip
		txn("hotel", "card", "shop", 200000),
		txn("refund", "shop", "card", 50000),
	}
	for _, id := range []string{"cash", "hotel", "refund"} {
		d.TransactionTags = append(d.TransactionTags, TransactionTag{TransactionID: id, TagID: "trip"})
	}
	const today = "2026-11-20"
	if got, want := d.BudgetSpent("trip", "2026-11-01", "2026-11-30", today), int64(200000-50000); got != want {
		t.Fatalf("off: spent = %d, want %d", got, want)
	}
	d.Tags[len(d.Tags)-1].CountTransfers = true
	if got, want := d.BudgetSpent("trip", "2026-11-01", "2026-11-30", today), int64(300000+200000-50000); got != want {
		t.Fatalf("on: spent = %d, want %d", got, want)
	}
}

// The switch round-trips through the API, and a tag without a budget never keeps it.
func TestBudgetCountTransfersAPI(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	var tag Tag
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "[TEST] Trip", "currency": "TWD", "limitMinor": 1000000, "cycle": "monthly", "countTransfers": true}, &tag); code != 201 || !tag.CountTransfers {
		t.Fatalf("create: %d %+v", code, tag)
	}
	var tr Transaction
	alice.do("POST", "/api/transactions", map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": "acc-b", "amountMinor": 30000, "date": "2026-11-01", "tagIds": []string{tag.ID}}, &tr)
	var st struct {
		Tags []map[string]interface{}
	}
	alice.do("GET", "/api/state", nil, &st)
	found := false
	for _, x := range st.Tags {
		if x["id"] == tag.ID {
			found = true
			if x["countTransfers"] != true {
				t.Errorf("served without countTransfers: %v", x)
			}
		}
	}
	if !found {
		t.Fatalf("tag not served")
	}
	var plain Tag
	if code := alice.do("PUT", "/api/tags/"+tag.ID, map[string]interface{}{"name": "[TEST] Trip", "countTransfers": true}, &plain); code != 200 || plain.CountTransfers {
		t.Fatalf("a tag without a budget kept the switch: %d %+v", code, plain)
	}
}

// MCP add_transaction: kind transfer takes an external side too, and the kind follows the accounts.
func TestMCPTransferWithAnExternalSide(t *testing.T) {
	b := sampleBook(t)
	out, err := toolAddTransaction(b, json.RawMessage(`{"kind":"transfer","amount":"12","fromAccountId":"acc-external","toAccountId":"acc-a","title":"[TEST] refund"}`))
	if err != nil {
		t.Fatal(err)
	}
	if v := out["transaction"].(map[string]interface{}); v["kind"] != "income" {
		t.Fatalf("kind %v, want income: %v", v["kind"], v)
	}
	if _, err := toolAddTransaction(b, json.RawMessage(`{"kind":"transfer","amount":"12","fromAccountId":"acc-external","toAccountId":"acc-external"}`)); err == nil {
		t.Fatalf("external -> external accepted")
	}
}

// The spending report (the Spending widget, MCP spending_by_category) follows the budget switch
// (ADR 0029): off, only money paid to external accounts; on, a tagged transfer between own accounts
// counts under that budget's tag, in its currency, and never as uncategorised.
func TestSpendingFollowsCountTransfers(t *testing.T) {
	d := sample()
	d.Accounts = append(d.Accounts, Account{ID: "sav", Name: "Savings", Currency: "TWD"}, Account{ID: "jpy", Name: "Yen", Currency: "JPY"},
		Account{ID: "jpy2", Name: "Yen 2", Currency: "JPY"}, Account{ID: "shop", Name: "Shop", Kind: "external"})
	limit := int64(1000000)
	d.Tags = append(d.Tags, Tag{ID: "house", Name: "House fund", Currency: "TWD", LimitMinor: &limit}, Tag{ID: "label", Name: "Label"})
	txn := func(id, from, to, cur string, amt int64) Transaction {
		return Transaction{ID: id, FromAccountID: from, ToAccountID: to, Type: d.Kind(from, to), State: "posted", Currency: cur, AmountMinor: amt, Date: "2026-11-10"}
	}
	d.Transactions = []Transaction{
		txn("save", "a", "sav", "TWD", 500000),  // own -> own, tagged house and label
		txn("yen", "jpy", "jpy2", "JPY", 3000),  // own -> own in another currency, tagged house
		txn("plain", "a", "sav", "TWD", 70000),  // own -> own, untagged
		txn("buy", "a", "shop", "TWD", 20000),   // spending, tagged house
		txn("later", "a", "sav", "TWD", 900000), // scheduled (after today)
	}
	d.Transactions[4].Date = "2026-11-25"
	for _, l := range [][2]string{{"save", "house"}, {"save", "label"}, {"yen", "house"}, {"buy", "house"}, {"later", "house"}} {
		d.TransactionTags = append(d.TransactionTags, TransactionTag{TransactionID: l[0], TagID: l[1]})
	}
	const today = "2026-11-20"
	rows := func() map[string]int64 {
		m := map[string]int64{}
		for _, s := range d.SpendingByCategory(today, today, []string{"TWD"}) {
			m[s.TagID+"/"+s.Currency] = s.AmountMinor
		}
		return m
	}
	if got := rows(); len(got) != 1 || got["house/TWD"] != 20000 {
		t.Fatalf("off: %v, want only the spending under house", got)
	}
	d.Tags[len(d.Tags)-2].CountTransfers = true
	got := rows()
	if got["house/TWD"] != 20000+500000 {
		t.Errorf("on: house/TWD = %d, want %d", got["house/TWD"], 20000+500000)
	}
	if _, ok := got["house/JPY"]; ok {
		t.Errorf("on: a transfer in another currency than the budget's counted: %v", got)
	}
	if _, ok := got["label/TWD"]; ok {
		t.Errorf("on: a tag whose switch is off counted the transfer: %v", got)
	}
	if _, ok := got["/TWD"]; ok {
		t.Errorf("on: an untagged transfer counted as uncategorised: %v", got)
	}
	// the budget and the report agree on the transfers
	start, end := BudgetPeriod(d.Tags[len(d.Tags)-2], today)
	if spent := d.BudgetSpent("house", start, end, today); spent != got["house/TWD"] {
		t.Errorf("budget %d and report %d disagree", spent, got["house/TWD"])
	}
}

// MCP spending_by_category uses the same report.
func TestMCPSpendingFollowsCountTransfers(t *testing.T) {
	b := sampleBook(t)
	today := b.today()
	limit := int64(1000000)
	tag := Tag{ID: "tag-test-house", Name: "[TEST] House fund", Currency: "TWD", LimitMinor: &limit, Cycle: "monthly", CountTransfers: true}
	if err := b.insertTag(tag); err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.addTransaction(Transaction{Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-b", AmountMinor: 4321, Date: today, TagIDs: []string{tag.ID}}); err != nil {
		t.Fatal(err)
	}
	out, err := toolSpending(b, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range out["spending"].([]map[string]interface{}) {
		if r["categoryId"] == tag.ID && r["amountMinor"] == int64(4321) {
			found = true
		}
	}
	if !found {
		t.Fatalf("spending_by_category without the counted transfer: %v", out["spending"])
	}
}
