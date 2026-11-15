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
	d.Accounts = append(d.Accounts, Account{ID: "acc-shop", Name: "Shop", Kind: "external"})
	cases := map[string]Transaction{
		"unknown type":            {Type: "refund", AccountID: "acc-a"},
		"expense without account": {Type: "expense"},
		"expense unknown account": {Type: "expense", AccountID: "acc-nope"},
		"expense with money box":  {Type: "expense", AccountID: "acc-b", TagID: "tag-house"},
		"income unknown tag":      {Type: "income", AccountID: "acc-a", TagID: "tag-nope"},
		"transfer missing to":     {Type: "transfer", FromAccountID: "acc-a"},
		"transfer same account":   {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-a"},
		"transfer across TWD/JPY": {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-jpy"},
		"external to external":    {Type: "transfer", FromAccountID: ExternalAccountID, ToAccountID: "acc-shop"},
		"allocate without box":    {Type: "allocate", AccountID: "acc-a"},
		"allocate to a category":  {Type: "allocate", AccountID: "acc-a", TagID: "tag-food"},
		"allocate on external":    {Type: "allocate", AccountID: ExternalAccountID, TagID: "tag-house"},
		"release unknown account": {Type: "release", AccountID: "acc-nope", TagID: "tag-house"},
		"bad state":               {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID, State: "maybe"},
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

func TestExpenseAndIncomeBecomeTransfers(t *testing.T) {
	d := seededData(t)
	d.Accounts = append(d.Accounts, Account{ID: "acc-shop", Name: "Shop", Kind: "external"})
	exp := Transaction{Type: "expense", AccountID: "acc-jpy", Currency: "TWD", TagID: "tag-travel"}
	if err := d.normalizeTransaction(&exp); err != nil {
		t.Fatal(err)
	}
	if exp.Type != "transfer" || exp.FromAccountID != "acc-jpy" || exp.ToAccountID != ExternalAccountID || exp.AccountID != "" || exp.Currency != "JPY" || exp.TagID != "tag-travel" {
		t.Errorf("expense shorthand: %+v", exp)
	}
	named := Transaction{Type: "expense", AccountID: "acc-b", ToAccountID: "acc-shop"}
	if err := d.normalizeTransaction(&named); err != nil || named.ToAccountID != "acc-shop" || named.Currency != "TWD" {
		t.Errorf("expense to a named external account: %v %+v", err, named)
	}
	inc := Transaction{Type: "income", AccountID: "acc-a", FromAccountID: "acc-b"} // from must be external; an own account is ignored
	if err := d.normalizeTransaction(&inc); err != nil || inc.FromAccountID != ExternalAccountID || inc.ToAccountID != "acc-a" {
		t.Errorf("income shorthand: %v %+v", err, inc)
	}
	// an external account has no currency: the own side decides, so JPY spending can go to the same external account
	tr := Transaction{Type: "transfer", FromAccountID: "acc-jpy", ToAccountID: "acc-shop", Currency: "TWD"}
	if err := d.normalizeTransaction(&tr); err != nil || tr.Currency != "JPY" {
		t.Errorf("own JPY -> external: %v %+v", err, tr)
	}
	al := Transaction{Type: "allocate", AccountID: "acc-a", TagID: "tag-house", State: "planned"}
	if err := d.normalizeTransaction(&al); err != nil || al.State != "posted" || al.Currency != "TWD" {
		t.Errorf("allocate: %v %+v", err, al)
	}
}

func TestNormalizeTemplate(t *testing.T) {
	d := seededData(t)
	b := TemplateBody{Type: "income", AccountID: "acc-a", AmountMinor: 100}
	if err := d.normalizeTemplate(&b); err != nil || b.Type != "transfer" || b.FromAccountID != ExternalAccountID || b.ToAccountID != "acc-a" || b.Currency != "TWD" {
		t.Errorf("income template: %v %+v", err, b)
	}
	bad := TemplateBody{Type: "allocate", AccountID: "acc-a", TagID: "tag-food"}
	if err := d.normalizeTemplate(&bad); err == nil {
		t.Errorf("allocate template to a category accepted")
	}
}

func TestValidateAccount(t *testing.T) {
	limit := int64(5)
	ext := Account{Name: "Shop", Kind: "external", Currency: "TWD", OpeningBalanceMinor: 100, CreditLimitMinor: &limit}
	if err := validateAccount(&ext); err != nil || ext.Currency != "" || ext.OpeningBalanceMinor != 0 || ext.CreditLimitMinor != nil {
		t.Errorf("external account not cleared: %v %+v", err, ext)
	}
	for _, a := range []Account{{Kind: "bank", Currency: "TWD"}, {Name: "x", Kind: "bank"}} {
		if err := validateAccount(&a); err == nil {
			t.Errorf("accepted %+v", a)
		}
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
		if tx.Type != "transfer" && tx.Type != "allocate" && tx.Type != "release" {
			t.Errorf("%s: stored type %q", tx.ID, tx.Type)
		}
	}
}
