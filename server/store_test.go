// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"path/filepath"
	"testing"
)

func TestManualTransactionsDoNotCollideOnTemplateKey(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.db.Close()
	// seed already contains several manual transactions; adding two more must succeed
	for _, id := range []string{"manual-1", "manual-2"} {
		tx := Transaction{ID: id, AccountID: "acc-a", Type: "expense", State: "posted", AmountMinor: 100, Currency: "TWD", Date: "2026-10-20", Note: "manual"}
		if err := s.insertTransaction(tx); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	// a duplicate generated occurrence must be rejected
	dup := Transaction{ID: "dup-1", AccountID: "acc-a", Type: "expense", State: "planned", AmountMinor: 100, Currency: "TWD", Date: "2026-10-12", TransactionTemplateID: "tpl-streaming", OccurrenceDate: "2026-10-12"}
	if err := s.insertTransaction(dup); err == nil {
		t.Fatalf("duplicate generated occurrence was accepted")
	}
}

func TestSettingsPersist(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.db.Close()
	if _, ok, _ := s.getSetting("dashboard"); ok {
		t.Fatalf("dashboard setting should start unset")
	}
	want := `{"order":["moneyboxes","balances"],"hidden":["recent"]}`
	if err := s.setSetting("dashboard", want); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, ok, err := s.getSetting("dashboard")
	if err != nil || !ok || got != want {
		t.Fatalf("get = %q ok=%v err=%v, want %q", got, ok, err, want)
	}
	if err := s.setSetting("dashboard", `{"order":[],"hidden":[]}`); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _, _ = s.getSetting("dashboard")
	if got != `{"order":[],"hidden":[]}` {
		t.Fatalf("overwrite not stored: %q", got)
	}
}

func TestUpdatesPersist(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.db.Close()

	a := s.data.Accounts[0]
	a.Name = "Renamed account"
	if err := s.updateAccount(a); err != nil {
		t.Fatalf("update account: %v", err)
	}
	if got := s.data.accountByID(a.ID); got == nil || got.Name != "Renamed account" {
		t.Fatalf("account not updated: %+v", got)
	}

	tag := s.data.Tags[0]
	tag.Name = "Renamed tag"
	if err := s.updateTag(tag); err != nil {
		t.Fatalf("update tag: %v", err)
	}
	found := false
	for _, x := range s.data.Tags {
		if x.ID == tag.ID && x.Name == "Renamed tag" {
			found = true
		}
	}
	if !found {
		t.Fatalf("tag not updated")
	}

	tx := s.data.Transactions[0]
	old := tx.AmountMinor
	tx.AmountMinor = old + 500
	tx.Note = "Edited note"
	if err := s.updateTransaction(tx); err != nil {
		t.Fatalf("update transaction: %v", err)
	}
	for _, x := range s.data.Transactions {
		if x.ID == tx.ID && (x.AmountMinor != old+500 || x.Note != "Edited note") {
			t.Fatalf("transaction not updated: %+v", x)
		}
	}

	tpl := s.data.TransactionTemplates[0]
	tpl.Name = "Renamed template"
	tpl.Template.AmountMinor += 100
	if err := s.updateTemplate(tpl); err != nil {
		t.Fatalf("update template: %v", err)
	}
	for _, x := range s.data.TransactionTemplates {
		if x.ID == tpl.ID && x.Name != "Renamed template" {
			t.Fatalf("template not updated: %+v", x)
		}
	}
}

// The sample data must respect the money-box invariants: no non-credit
// account below zero, and allocations never exceed an account's balance.
func TestSeedRespectsBalanceInvariants(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.db.Close()
	if len(s.data.Transactions) <= 50 {
		t.Fatalf("seed should hold more than one page of transactions, got %d", len(s.data.Transactions))
	}
	for _, a := range s.data.Accounts {
		if a.IsExternal() {
			continue // outside the books: no balance of its own
		}
		bal, alloc := s.data.Balance(a.ID), s.data.AllocatedForAccount(a.ID)
		if a.LimitMinor == nil && bal < 0 { // sample accounts without a limit stay positive
			t.Errorf("%s balance %d < 0", a.ID, bal)
		}
		if alloc > bal {
			t.Errorf("%s allocated %d > balance %d", a.ID, alloc, bal)
		}
	}
	for _, tt := range s.data.TransactionTags {
		found := false
		for _, tx := range s.data.Transactions {
			found = found || tx.ID == tt.TransactionID
		}
		if !found {
			t.Errorf("tag link to unknown transaction %s", tt.TransactionID)
		}
	}
}

// Migration 1 converts a database written before ADR 0002 in place.
func TestMigrationConvertsExpenseAndIncome(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	s, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	// rewind to a pre-migration database: old-style rows and templates, version 0
	mustExec := func(q string, args ...interface{}) {
		if _, err := s.db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec(`DELETE FROM accounts WHERE id=?`, ExternalAccountID)
	mustExec(`INSERT INTO transactions(id,account_id,type,state,amount_minor,currency,date,note) VALUES('old-exp','acc-b','expense','posted',500,'TWD','2026-11-01','Lunch'),('old-inc','acc-a','income','posted',900,'TWD','2026-11-02','Pay')`)
	mustExec(`UPDATE transaction_templates SET template_json='{"accountId":"acc-a","type":"income","amountMinor":8000000,"currency":"TWD","note":"Salary"}' WHERE id='tpl-salary'`)
	mustExec(`INSERT INTO transactions(id,account_id,tag_id,type,state,amount_minor,currency,date,note) VALUES('old-rel','acc-a','tag-furniture','release','posted',700,'TWD','2026-11-03','Back out')`)
	mustExec(`PRAGMA user_version = 0`)
	// a database from before migration 3 has no memo column
	mustExec(`ALTER TABLE transactions DROP COLUMN memo`)
	// before migration 4 tags could be labels and payees; before 5 budgets had no period columns
	mustExec(`INSERT INTO tags(id,name,kind) VALUES('old-label','trip-2026','label'),('old-payee','7-Eleven','payee')`)
	for _, c := range []string{"cycle_every", "cycle_start", "cycle_end"} {
		mustExec(`ALTER TABLE tags DROP COLUMN ` + c)
	}
	// before migration 6 own accounts had a type and no icon
	mustExec(`ALTER TABLE accounts DROP COLUMN icon`)
	mustExec(`UPDATE accounts SET kind='savings' WHERE id='acc-a'`)
	mustExec(`INSERT INTO accounts(id,name,kind,currency,opening_balance_minor,allow_negative,credit_limit_minor) VALUES('old-card','Visa','credit_card','TWD',0,1,5000000)`)
	s.db.Close()

	s, err = openStore(path) // runs the migration
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	if a := s.data.accountByID(ExternalAccountID); a == nil || !a.IsExternal() {
		t.Fatalf("anonymous external account missing after migration")
	}
	for _, id := range []string{"old-label", "old-payee"} {
		if tg := s.data.tagByID(id); tg == nil || tg.Kind != "category" {
			t.Errorf("migration 4: %s should be a category: %+v", id, tg)
		}
	}
	for id, icon := range map[string]string{"acc-a": "savings", "old-card": "card"} {
		if a := s.data.accountByID(id); a == nil || a.Kind != "own" || a.Icon != icon {
			t.Errorf("migration 6: %s should be own with icon %s: %+v", id, icon, a)
		}
	}
	if a := s.data.accountByID("old-card"); a == nil || a.LimitMinor == nil || *a.LimitMinor != 5000000 {
		t.Errorf("migration 6: the card keeps its limit: %+v", a)
	}
	if a := s.data.accountByID(ExternalAccountID); a == nil || a.Kind != "external" {
		t.Errorf("migration 6: external stays external: %+v", a)
	}
	if food := s.data.tagByID("tag-food"); food == nil || food.Cycle != "monthly" || food.CycleEvery != 0 || food.CycleStart != "" {
		t.Errorf("migration 5: monthly budget should keep its period: %+v", food)
	}
	byID := map[string]Transaction{}
	for _, tx := range s.data.Transactions {
		byID[tx.ID] = tx
	}
	if e := byID["old-exp"]; e.Type != "transfer" || e.FromAccountID != "acc-b" || e.ToAccountID != ExternalAccountID || e.AccountID != "" {
		t.Errorf("expense not converted: %+v", e)
	}
	if i := byID["old-inc"]; i.Type != "transfer" || i.FromAccountID != ExternalAccountID || i.ToAccountID != "acc-a" {
		t.Errorf("income not converted: %+v", i)
	}
	if r := byID["old-rel"]; r.Type != "allocate" || r.AmountMinor != -700 || r.AccountID != "acc-a" || r.TagID != "tag-furniture" {
		t.Errorf("release not converted (migration 2): %+v", r)
	}
	for _, tp := range s.data.TransactionTemplates {
		if tp.ID == "tpl-salary" && (tp.Template.Type != "transfer" || tp.Template.FromAccountID != ExternalAccountID || tp.Template.ToAccountID != "acc-a") {
			t.Errorf("template not converted: %+v", tp.Template)
		}
	}
	// migration 3 added the memo column back, and it round-trips
	tx := byID["old-exp"]
	tx.Memo = "Paid in cash"
	if err := s.updateTransaction(tx); err != nil {
		t.Fatalf("update with memo: %v", err)
	}
	for _, x := range s.data.Transactions {
		if x.ID == "old-exp" && x.Memo != "Paid in cash" {
			t.Errorf("memo not stored: %+v", x)
		}
	}
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil || v != len(migrations) {
		t.Errorf("user_version = %d, %v", v, err)
	}
}
