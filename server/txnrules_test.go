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
		"income unknown tag":      {Type: "income", AccountID: "acc-a", AmountMinor: 1, TagIDs: []string{"tag-nope"}},
		"transfer missing to":     {Type: "transfer", FromAccountID: "acc-a"},
		"transfer same account":   {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-a"},
		"transfer across TWD/JPY": {Type: "transfer", FromAccountID: "acc-a", ToAccountID: "acc-jpy"},
		"external to external":    {Type: "transfer", FromAccountID: ExternalAccountID, ToAccountID: "acc-shop"},
		"allocate is retired":     {Type: "allocate", AccountID: "acc-a", AmountMinor: 1},
		"release is retired":      {Type: "release", AccountID: "acc-a", AmountMinor: 1},
		"bad state":               {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID, AmountMinor: 1, State: "maybe"},
		"transfer of zero":        {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID},
		"negative transfer":       {Type: "transfer", FromAccountID: "acc-b", ToAccountID: ExternalAccountID, AmountMinor: -5},
		"a reserve as category":   {Type: "expense", AccountID: "acc-a", AmountMinor: 1, TagIDs: []string{"tag-food", "rsv-house"}},
		"unknown category":        {Type: "expense", AccountID: "acc-a", AmountMinor: 1, TagIDs: []string{"tag-nope"}},
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
	exp := Transaction{Type: "expense", AccountID: "acc-jpy", Currency: "TWD", TagIDs: []string{"tag-travel", "tag-travel"}, AmountMinor: 500}
	if err := d.normalizeTransaction(&exp); err != nil {
		t.Fatal(err)
	}
	if exp.Type != "expense" || exp.FromAccountID != "acc-jpy" || exp.ToAccountID != ExternalAccountID || exp.AccountID != "" || exp.Currency != "JPY" || len(exp.TagIDs) != 1 || exp.TagIDs[0] != "tag-travel" {
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
}

func TestSignedAllocations(t *testing.T) {
	d := seededData(t)
	held := d.ReservedIn("rsv-furniture", "acc-a", "") // the seed keeps part of Furniture in Savings A
	if held <= 0 {
		t.Fatalf("seed should hold Furniture in acc-a, got %d", held)
	}
	in := Allocation{ReserveID: "rsv-house", AccountID: "acc-jpy", AmountMinor: 500, Currency: "TWD", Date: "2026-11-01"}
	if err := d.normalizeAllocation(&in); err != nil || in.Currency != "JPY" {
		t.Errorf("the account decides the currency: %v %+v", err, in)
	}
	out := Allocation{ReserveID: "rsv-furniture", AccountID: "acc-a", AmountMinor: -held, Date: "2026-11-01"}
	if err := d.normalizeAllocation(&out); err != nil {
		t.Errorf("taking out exactly what is held: %v", err)
	}
	over := Allocation{ReserveID: "rsv-furniture", AccountID: "acc-a", AmountMinor: -held - 1, Date: "2026-11-01"}
	if err := d.normalizeAllocation(&over); err == nil || !strings.Contains(err.Error(), "cannot take out more") {
		t.Errorf("over-release accepted: %v", err)
	}
	for name, a := range map[string]Allocation{
		"from an account holding none": {ReserveID: "rsv-furniture", AccountID: "acc-c", AmountMinor: -1, Date: "2026-11-01"},
		"zero":                         {ReserveID: "rsv-house", AccountID: "acc-a", Date: "2026-11-01"},
		"unknown reserve":              {ReserveID: "rsv-nope", AccountID: "acc-a", AmountMinor: 1, Date: "2026-11-01"},
		"a tag as reserve":             {ReserveID: "tag-food", AccountID: "acc-a", AmountMinor: 1, Date: "2026-11-01"},
		"external account":             {ReserveID: "rsv-house", AccountID: ExternalAccountID, AmountMinor: 1, Date: "2026-11-01"},
		"no date":                      {ReserveID: "rsv-house", AccountID: "acc-a", AmountMinor: 1},
		"long note":                    {ReserveID: "rsv-house", AccountID: "acc-a", AmountMinor: 1, Date: "2026-11-01", Memo: strings.Repeat("x", maxMemoRunes+1)},
	} {
		if err := d.normalizeAllocation(&a); err == nil {
			t.Errorf("%s: accepted %+v", name, a)
		}
	}
	// editing an allocation is checked against the others, not itself
	var existing Allocation
	for _, x := range d.Allocations {
		if x.ReserveID == "rsv-furniture" && x.AccountID == "acc-a" && x.AmountMinor > 0 {
			existing = x
		}
	}
	edit := existing
	edit.AmountMinor = -(held - existing.AmountMinor) // flip it so the pair ends at exactly zero
	if err := d.normalizeAllocation(&edit); err != nil {
		t.Errorf("edit excluding itself: %v", err)
	}
}

func TestNormalizeReserve(t *testing.T) {
	target, zero := int64(100), int64(0)
	for _, r := range []Reserve{{Name: "Trip", Currency: "twd"}, {Name: "House", Currency: "TWD", TargetMinor: &target, TargetDate: "2027-12-31"}} {
		if err := normalizeReserve(&r); err != nil || r.Currency != "TWD" {
			t.Errorf("%+v: %v", r, err)
		}
	}
	for _, r := range []Reserve{{Name: " ", Currency: "TWD"}, {Name: "x"}, {Name: "x", Currency: "TWD", TargetMinor: &zero}, {Name: "x", Currency: "TWD", TargetDate: "2027-13-01"}} {
		if err := normalizeReserve(&r); err == nil {
			t.Errorf("accepted %+v", r)
		}
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
	if err := d.normalizeTemplate(&b); err != nil || b.Type != "income" || b.FromAccountID != ExternalAccountID || b.ToAccountID != "acc-a" || b.Currency != "TWD" {
		t.Errorf("income template: %v %+v", err, b)
	}
	bad := TemplateBody{Type: "allocate", AccountID: "acc-a", ReserveID: "tag-food"}
	if err := d.normalizeTemplate(&bad); err == nil {
		t.Errorf("allocation template to a category accepted")
	}
	good := TemplateBody{Type: "allocate", AccountID: "acc-jpy", ReserveID: "rsv-house", TagIDs: []string{"tag-food"}, AmountMinor: 100}
	if err := d.normalizeTemplate(&good); err != nil || good.Currency != "JPY" || good.TagIDs != nil {
		t.Errorf("allocation template: %v %+v", err, good)
	}
	tr := TemplateBody{Type: "expense", AccountID: "acc-a", ReserveID: "rsv-house", AmountMinor: 100}
	if err := d.normalizeTemplate(&tr); err != nil || tr.ReserveID != "" {
		t.Errorf("a transaction template keeps no reserve: %v %+v", err, tr)
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
		if want := d.Kind(tx.FromAccountID, tx.ToAccountID); tx.Type != want || c.Type != want {
			t.Errorf("%s: type %q / %q, the accounts make it %q", tx.ID, tx.Type, c.Type, want)
		}
	}
	for _, a := range d.Allocations {
		c := a
		if err := d.normalizeAllocation(&c); err != nil {
			t.Errorf("%s: %v", a.ID, err)
		}
	}
}
