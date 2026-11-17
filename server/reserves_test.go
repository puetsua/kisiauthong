// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import "testing"

// Reserves and their allocations over the HTTP API (ADR 0013).
func TestReservesAPI(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	alice := func() *Data {
		b, err := s.book("usr-alice")
		if err != nil {
			t.Fatal(err)
		}
		return b.data
	}
	addTestUser(t, s, "bob", false)
	ac, bc := newClient(t, srv), newClient(t, srv)
	signedIn(t, ac, "alice")
	signedIn(t, bc, "bob")

	var r Reserve
	if code := ac.do("POST", "/api/reserves", map[string]interface{}{"name": "Trip", "currency": "twd"}, &r); code != 201 || r.Currency != "TWD" || r.TargetMinor != nil {
		t.Fatalf("create without a target: %d %+v", code, r)
	}
	put := func(c *client, account string, amount int64) (int, Allocation) {
		var a Allocation
		code := c.do("POST", "/api/reserves/"+r.ID+"/allocations", map[string]interface{}{"accountId": account, "amountMinor": amount, "date": "2026-11-10", "note": "x"}, &a)
		return code, a
	}
	if code, a := put(ac, "acc-a", 3000); code != 201 || a.ReserveID != r.ID || a.Currency != "TWD" || a.CreatedAt == "" {
		t.Fatalf("put in: %d %+v", code, a)
	}
	if code, _ := put(ac, "acc-b", 2000); code != 201 {
		t.Fatalf("put in B: %d", code)
	}
	if code, _ := put(ac, "acc-b", -2001); code != 400 {
		t.Fatalf("took out more than held: %d", code)
	}
	if code, _ := put(ac, "acc-external", 1); code != 400 {
		t.Fatalf("allocated from an external account: %d", code)
	}
	if got := alice().ReserveSaved(r.ID); got != 5000 {
		t.Fatalf("saved = %d", got)
	}
	// a tag id is not a reserve, and a reserve id is not a tag
	if code := ac.do("POST", "/api/reserves/tag-food/allocations", map[string]interface{}{"accountId": "acc-a", "amountMinor": 1}, nil); code != 404 {
		t.Fatalf("allocated to a tag: %d", code)
	}
	// another user can neither see nor touch it
	if code, _ := put(bc, "acc-a", 1); code != 404 {
		t.Fatalf("bob allocated to alice's reserve: %d", code)
	}
	if code := bc.do("DELETE", "/api/reserves/"+r.ID, nil, nil); code != 404 {
		t.Fatalf("bob deleted alice's reserve: %d", code)
	}
	for _, a := range alice().Allocations {
		if a.ReserveID == r.ID {
			if code := bc.do("DELETE", "/api/allocations/"+a.ID, nil, nil); code != 404 {
				t.Fatalf("bob deleted alice's allocation: %d", code)
			}
		}
	}

	// fixing a typo: the edit is checked against the other allocations, keeps when it was entered
	var first Allocation
	for _, a := range alice().Allocations {
		if a.ReserveID == r.ID && a.AccountID == "acc-a" {
			first = a
		}
	}
	var fixed Allocation
	if code := ac.do("PUT", "/api/allocations/"+first.ID, map[string]interface{}{"accountId": "acc-a", "amountMinor": 3500, "date": "2026-11-09"}, &fixed); code != 200 ||
		fixed.AmountMinor != 3500 || fixed.CreatedAt != first.CreatedAt || fixed.ReserveID != r.ID {
		t.Fatalf("edit: %d %+v", code, fixed)
	}

	// complete takes out everything, account by account
	var out []Allocation
	if code := ac.do("POST", "/api/reserves/"+r.ID+"/complete", map[string]interface{}{"date": "2026-11-20"}, &out); code != 201 || len(out) != 2 {
		t.Fatalf("complete: %d %+v", code, out)
	}
	if got := alice().ReserveSaved(r.ID); got != 0 {
		t.Fatalf("after complete: %d", got)
	}
	if code := ac.do("POST", "/api/reserves/"+r.ID+"/complete", nil, nil); code != 400 {
		t.Fatalf("completed an empty reserve: %d", code)
	}

	// deleting a reserve removes its allocations and its allocation templates
	tpl := map[string]interface{}{"name": "Save", "template": map[string]interface{}{"type": "allocate", "accountId": "acc-a", "reserveId": r.ID, "amountMinor": 100},
		"schedule": map[string]interface{}{"frequency": "monthly", "interval": 1, "dayOfMonth": 1, "startDate": "2026-01-01"}}
	if code := ac.do("POST", "/api/templates", tpl, nil); code != 201 {
		t.Fatalf("allocation template: %d", code)
	}
	if code := ac.do("DELETE", "/api/reserves/"+r.ID, nil, nil); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	for _, a := range alice().Allocations {
		if a.ReserveID == r.ID {
			t.Fatalf("allocation left behind: %+v", a)
		}
	}
	for _, tp := range alice().TransactionTemplates {
		if tp.Template.ReserveID == r.ID {
			t.Fatalf("template left behind: %+v", tp)
		}
	}

	// the old ways are gone
	if code := ac.do("POST", "/api/transactions", map[string]interface{}{"type": "allocate", "accountId": "acc-a", "amountMinor": 1}, nil); code != 400 {
		t.Fatalf("allocate as a transaction: %d", code)
	}
}

// An allocation template generates each occurrence once, as an allocation.
func TestAllocationTemplatesGenerateOnce(t *testing.T) {
	b := sampleBook(t)
	before := len(b.data.Allocations)
	n1, err := b.GenerateDue("2027-01-05")
	if err != nil {
		t.Fatal(err)
	}
	gen := 0
	for _, a := range b.data.Allocations {
		if a.TransactionTemplateID == "tpl-house-payday" {
			gen++
			if a.ID != "alc-tpl-house-payday-"+a.OccurrenceDate || a.AmountMinor != 2000000 || a.ReserveID != "rsv-house" || a.Currency != "TWD" {
				t.Fatalf("generated: %+v", a)
			}
		}
	}
	if gen != 3 || len(b.data.Allocations) != before+3 { // 2026-11-05, 2026-12-05, 2027-01-05
		t.Fatalf("generated %d allocations (%d in all)", gen, len(b.data.Allocations)-before)
	}
	for _, tx := range b.data.Transactions {
		if tx.TransactionTemplateID == "tpl-house-payday" {
			t.Fatalf("an allocation template made a transaction: %+v", tx)
		}
	}
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	n2, err := b.GenerateDue("2027-01-05")
	if err != nil || n2 != 0 || n1 == 0 {
		t.Fatalf("second run created %d (first %d): %v", n2, n1, err)
	}
	if got := b.data.ReserveSaved("rsv-house"); got != 65000000+3*2000000 {
		t.Fatalf("saved = %d", got)
	}
}
