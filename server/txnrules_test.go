// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"strings"
	"testing"
)

func seededData(t *testing.T) *Data {
	t.Helper()
	return sampleBook(t).data
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
		"bad state":               {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID, AmountMinor: 1, State: "maybe"},
		"transfer of zero":        {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID},
		"negative transfer":       {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID, AmountMinor: -5},
		"allocation of zero":      {Type: "allocate", AccountID: "acc-a", TagID: "tag-house"},
	}
	for name, tx := range cases {
		if err := d.normalizeTransaction(&tx); err == nil {
			t.Errorf("%s: accepted %+v", name, tx)
		}
	}
	tx := Transaction{Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-jpy", AmountMinor: 100}
	if err := d.normalizeTransaction(&tx); err == nil || !strings.Contains(err.Error(), "spending in TWD and income in JPY") {
		t.Errorf("cross-currency transfer should explain spending + income, got %v", err)
	}
}

func TestExpenseAndIncomeBecomeTransfers(t *testing.T) {
	d := seededData(t)
	d.Accounts = append(d.Accounts, Account{ID: "acc-shop", Name: "Shop", Kind: "external"})
	exp := Transaction{Type: "expense", AccountID: "acc-jpy", Currency: "TWD", TagID: "tag-travel", AmountMinor: 500}
	if err := d.normalizeTransaction(&exp); err != nil {
		t.Fatal(err)
	}
	if exp.Type != "transfer" || exp.FromAccountID != "acc-jpy" || exp.ToAccountID != ExternalAccountID || exp.AccountID != "" || exp.Currency != "JPY" || exp.TagID != "tag-travel" {
		t.Errorf("expense shorthand: %+v", exp)
	}
	named := Transaction{Type: "expense", AccountID: "acc-b", ToAccountID: "acc-shop", AmountMinor: 500}
	if err := d.normalizeTransaction(&named); err != nil || named.ToAccountID != "acc-shop" || named.Currency != "TWD" {
		t.Errorf("expense to a named external account: %v %+v", err, named)
	}
	inc := Transaction{Type: "income", AccountID: "acc-a", FromAccountID: "acc-b", AmountMinor: 500} // from must be external; an own account is ignored
	if err := d.normalizeTransaction(&inc); err != nil || inc.FromAccountID != ExternalAccountID || inc.ToAccountID != "acc-a" {
		t.Errorf("income shorthand: %v %+v", err, inc)
	}
	// an external account has no currency: the own side decides, so JPY spending can go to the same external account
	tr := Transaction{Type: "transfer", FromAccountID: "acc-jpy", ToAccountID: "acc-shop", Currency: "TWD", AmountMinor: 500}
	if err := d.normalizeTransaction(&tr); err != nil || tr.Currency != "JPY" {
		t.Errorf("own JPY -> external: %v %+v", err, tr)
	}
	al := Transaction{Type: "allocate", AccountID: "acc-a", TagID: "tag-house", State: "planned", AmountMinor: 500}
	if err := d.normalizeTransaction(&al); err != nil || al.State != "posted" || al.Currency != "TWD" {
		t.Errorf("allocate: %v %+v", err, al)
	}
}

func TestSignedAllocations(t *testing.T) {
	d := seededData(t)
	held := d.Allocated("acc-a", "tag-furniture") // the seed keeps part of Furniture in Savings A
	if held <= 0 {
		t.Fatalf("seed should hold Furniture in acc-a, got %d", held)
	}
	rel := Transaction{Type: "release", AccountID: "acc-a", TagID: "tag-furniture", AmountMinor: 1000}
	if err := d.normalizeTransaction(&rel); err != nil || rel.Type != "allocate" || rel.AmountMinor != -1000 {
		t.Errorf("release shorthand: %v %+v", err, rel)
	}
	out := Transaction{Type: "allocate", AccountID: "acc-a", TagID: "tag-furniture", AmountMinor: -held}
	if err := d.normalizeTransaction(&out); err != nil {
		t.Errorf("taking out exactly what is held: %v", err)
	}
	over := Transaction{Type: "allocate", AccountID: "acc-a", TagID: "tag-furniture", AmountMinor: -held - 1}
	if err := d.normalizeTransaction(&over); err == nil || !strings.Contains(err.Error(), "more than is allocated") {
		t.Errorf("over-release accepted: %v", err)
	}
	if err := (&Transaction{Type: "allocate", AccountID: "acc-c", TagID: "tag-furniture", AmountMinor: -1}).normalizeOn(d); err == nil {
		t.Errorf("releasing from an account that holds none of the money box was accepted")
	}
	// editing an allocation is checked against the others, not itself
	var existing Transaction
	for _, x := range d.Transactions {
		if x.Type == "allocate" && x.AccountID == "acc-a" && x.TagID == "tag-furniture" && x.AmountMinor > 0 {
			existing = x
		}
	}
	edit := existing
	edit.AmountMinor = -(held - existing.AmountMinor) // flip it so the pair ends at exactly zero
	if err := d.normalizeTransaction(&edit); err != nil {
		t.Errorf("edit excluding itself: %v", err)
	}
}

func TestTransactionTime(t *testing.T) {
	d := seededData(t)
	tx := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Date: "2026-11-15", Time: "23:30", TZ: "Asia/Taipei"}
	if err := d.normalizeTransaction(&tx); err != nil || tx.At != "2026-11-15T15:30:00Z" {
		t.Fatalf("Taipei 23:30: %v %q", err, tx.At)
	}
	// the same wall time in Tokyo is an hour earlier in UTC; the stored date stays the local one
	tokyo := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Date: "2026-11-16", Time: "00:30", TZ: "Asia/Tokyo"}
	if err := d.normalizeTransaction(&tokyo); err != nil || tokyo.At != "2026-11-15T15:30:00Z" || tokyo.Date != "2026-11-16" {
		t.Fatalf("Tokyo 00:30: %v %+v", err, tokyo)
	}
	// daylight saving: New York in July is UTC-4
	ny := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Date: "2026-07-04", Time: "09:00", TZ: "America/New_York"}
	if err := d.normalizeTransaction(&ny); err != nil || ny.At != "2026-07-04T13:00:00Z" {
		t.Fatalf("New York: %v %q", err, ny.At)
	}
	// date-only: no zone, no instant, even if the client sent them
	plain := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Date: "2026-11-15", TZ: "Asia/Taipei", At: "x"}
	if err := d.normalizeTransaction(&plain); err != nil || plain.TZ != "" || plain.At != "" {
		t.Fatalf("date-only: %v %+v", err, plain)
	}
	for _, bad := range []Transaction{
		{Date: "2026-11-15", Time: "24:00", TZ: "Asia/Taipei"},
		{Date: "2026-11-15", Time: "9:00", TZ: "Asia/Taipei"},
		{Date: "2026-11-15", Time: "09:00"},
		{Date: "2026-11-15", Time: "09:00", TZ: "Mars/Olympus"},
		{Date: "2026-11-15", Time: "09:00", TZ: "Local"},
		{Date: "2026-13-01"},
	} {
		bad.Type, bad.AccountID, bad.AmountMinor = "expense", "acc-b", 100
		if err := d.normalizeTransaction(&bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
}

func TestTitleAndMemo(t *testing.T) {
	d := seededData(t)
	ok := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Note: "  Lunch  ", Memo: "  With Alex.\nSplit later.  "}
	if err := d.normalizeTransaction(&ok); err != nil || ok.Note != "Lunch" || ok.Memo != "With Alex.\nSplit later." {
		t.Errorf("trim: %v %+v", err, ok)
	}
	long := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Memo: strings.Repeat("記", maxMemoRunes+1)}
	if err := d.normalizeTransaction(&long); err == nil {
		t.Errorf("over-long memo accepted")
	}
	fits := Transaction{Type: "expense", AccountID: "acc-b", AmountMinor: 100, Memo: strings.Repeat("記", maxMemoRunes)}
	if err := d.normalizeTransaction(&fits); err != nil {
		t.Errorf("memo at the limit (counted in characters, not bytes): %v", err)
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
	limit, zero := int64(5), int64(0)
	ext := Account{Name: "Shop", Kind: "external", Currency: "TWD", OpeningBalanceMinor: 100, LimitMinor: &limit}
	if err := validateAccount(&ext); err != nil || ext.Currency != "" || ext.OpeningBalanceMinor != 0 || ext.LimitMinor != nil {
		t.Errorf("external account not cleared: %v %+v", err, ext)
	}
	own := Account{Name: " Card ", Currency: "twd", Icon: "card", LimitMinor: &limit}
	if err := validateAccount(&own); err != nil || own.Kind != "own" || own.Name != "Card" || own.Currency != "TWD" {
		t.Errorf("own account defaults: %v %+v", err, own)
	}
	// account types from before ADR 0005 are still accepted and become the icon
	legacy := Account{Name: "Visa", Kind: "credit_card", Currency: "TWD"}
	if err := validateAccount(&legacy); err != nil || legacy.Kind != "own" || legacy.Icon != "card" {
		t.Errorf("legacy kind: %v %+v", err, legacy)
	}
	for _, a := range []Account{{Kind: "own", Currency: "TWD"}, {Name: "x", Kind: "own"}, {Name: "x", Currency: "TWD", Kind: "vault"},
		{Name: "x", Currency: "TWD", Icon: "Bad Icon"}, {Name: "x", Currency: "TWD", LimitMinor: &zero}} {
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
		if tx.Type != "transfer" && tx.Type != "allocate" {
			t.Errorf("%s: stored type %q", tx.ID, tx.Type)
		}
	}
}

func (t *Transaction) normalizeOn(d *Data) error { return d.normalizeTransaction(t) }
