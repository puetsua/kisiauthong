// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func seededData(t *testing.T) *Data {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.db.Close() })
	return &s.data
}

func TestNormalizeTransactionRejects(t *testing.T) {
	d := seededData(t)
	cases := map[string]Transaction{
		"unknown type":            {Type: "refund", AccountID: "acc-a"},
		"expense without account": {Type: "expense"},
		"expense unknown account": {Type: "expense", AccountID: "acc-nope"},
		"expense with money box":  {Type: "expense", AccountID: "acc-b", TagID: "tag-house"},
		"income unknown tag":      {Type: "income", AccountID: "acc-a", TagID: "tag-nope"},
		"transfer missing to":     {Type: "transfer", FromAccountID: "acc-a"},
		"transfer same account":   {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-a"},
		"transfer across TWD/JPY": {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-jpy"},
		"allocate without box":    {Type: "allocate", AccountID: "acc-a"},
		"allocate to a category":  {Type: "allocate", AccountID: "acc-a", TagID: "tag-food"},
		"release unknown account": {Type: "release", AccountID: "acc-nope", TagID: "tag-house"},
		"bad state":               {Type: "expense", AccountID: "acc-b", State: "maybe"},
	}
	for name, tx := range cases {
		if err := d.normalizeTransaction(&tx); err == nil {
			t.Errorf("%s: accepted %+v", name, tx)
		}
	}
	tx := Transaction{Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-jpy"}
	if err := d.normalizeTransaction(&tx); err == nil || !strings.Contains(err.Error(), "spending in TWD and income in JPY") {
		t.Errorf("cross-currency transfer should explain spending + income, got %v", err)
	}
}

func TestNormalizeTransactionClearsUnusedFields(t *testing.T) {
	d := seededData(t)
	exp := Transaction{Type: "expense", AccountID: "acc-jpy", FromAccountID: "acc-a", ToAccountID: "acc-b", Currency: "TWD", TagID: "tag-travel"}
	if err := d.normalizeTransaction(&exp); err != nil {
		t.Fatal(err)
	}
	if exp.FromAccountID != "" || exp.ToAccountID != "" || exp.Currency != "JPY" || exp.State != "posted" {
		t.Errorf("expense not normalised: %+v", exp)
	}
	tr := Transaction{Type: "transfer", AccountID: "acc-c", FromAccountID: "acc-a", ToAccountID: "acc-b", TagID: "tag-food", Currency: "JPY", State: "planned"}
	if err := d.normalizeTransaction(&tr); err != nil {
		t.Fatal(err)
	}
	if tr.AccountID != "" || tr.TagID != "" || tr.Currency != "TWD" || tr.State != "planned" {
		t.Errorf("transfer not normalised: %+v", tr)
	}
	al := Transaction{Type: "allocate", AccountID: "acc-a", TagID: "tag-house", State: "planned"}
	if err := d.normalizeTransaction(&al); err != nil {
		t.Fatal(err)
	}
	if al.State != "posted" || al.Currency != "TWD" {
		t.Errorf("allocate not normalised: %+v", al)
	}
}

// Every transaction in the sample data must already satisfy the rules.
func TestSeedTransactionsFollowRules(t *testing.T) {
	d := seededData(t)
	for _, tx := range d.Transactions {
		c := tx
		if err := d.normalizeTransaction(&c); err != nil {
			t.Errorf("%s: %v", tx.ID, err)
		}
	}
}
