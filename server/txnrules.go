// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import "fmt"

// normalizeTransaction checks which fields a transaction type uses, clears the
// ones it does not, and sets the currency from the account(s), so a client
// cannot store a combination the domain rules forbid:
//   - expense / income: one account; tag optional but never a money box
//   - transfer: two different accounts in the same currency (converting
//     currency is spending in one and income in the other); no tag
//   - allocate / release: one account and a money box (goal tag); always posted
func (d *Data) normalizeTransaction(t *Transaction) error {
	tagByID := func(id string) *Tag {
		for i := range d.Tags {
			if d.Tags[i].ID == id {
				return &d.Tags[i]
			}
		}
		return nil
	}
	if t.State == "" {
		t.State = "posted"
	}
	if t.State != "posted" && t.State != "planned" {
		return fmt.Errorf("state must be posted or planned")
	}
	switch t.Type {
	case "expense", "income", "allocate", "release":
		a := d.accountByID(t.AccountID)
		if a == nil {
			return fmt.Errorf("accountId must be an existing account")
		}
		t.FromAccountID, t.ToAccountID = "", ""
		t.Currency = a.Currency
		if t.Type == "allocate" || t.Type == "release" {
			tag := tagByID(t.TagID)
			if tag == nil || tag.Kind != "goal" {
				return fmt.Errorf("%s needs tagId of a money box (goal tag)", t.Type)
			}
			t.State = "posted" // a decision moves no cash, there is nothing to confirm
		} else if t.TagID != "" {
			tag := tagByID(t.TagID)
			if tag == nil {
				return fmt.Errorf("tagId must be an existing tag")
			}
			if tag.Kind == "goal" {
				return fmt.Errorf("a money box tag is only for allocate/release")
			}
		}
	case "transfer":
		from, to := d.accountByID(t.FromAccountID), d.accountByID(t.ToAccountID)
		if from == nil || to == nil {
			return fmt.Errorf("transfer needs existing fromAccountId and toAccountId")
		}
		if from.ID == to.ID {
			return fmt.Errorf("transfer needs two different accounts")
		}
		if from.Currency != to.Currency {
			return fmt.Errorf("transfer accounts must share a currency; record spending in %s and income in %s instead", from.Currency, to.Currency)
		}
		t.AccountID, t.TagID = "", ""
		t.Currency = from.Currency
	default:
		return fmt.Errorf("type must be expense, income, transfer, allocate or release")
	}
	return nil
}
