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
		bal, alloc := s.data.Balance(a.ID), s.data.AllocatedForAccount(a.ID)
		if !a.AllowNegative && bal < 0 {
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
