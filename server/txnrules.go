// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxTitleRunes = 200
	maxMemoRunes  = 4000
)

// ExternalAccountID is the anonymous external account: the other side of an
// expense or income when the user does not name a payee or payer.
const ExternalAccountID = "acc-external"

// IsExternal reports whether money in this account is outside the user's books.
func (a *Account) IsExternal() bool { return a.Kind == "external" }

// IsSpending: money leaves the user's books (an own account pays an external one).
func (d *Data) IsSpending(t Transaction) bool {
	from, to := d.accountByID(t.FromAccountID), d.accountByID(t.ToAccountID)
	return t.Type == "transfer" && from != nil && to != nil && !from.IsExternal() && to.IsExternal()
}

// IsIncome: money enters the user's books from an external account.
func (d *Data) IsIncome(t Transaction) bool {
	from, to := d.accountByID(t.FromAccountID), d.accountByID(t.ToAccountID)
	return t.Type == "transfer" && from != nil && to != nil && from.IsExternal() && !to.IsExternal()
}

func (d *Data) tagByID(id string) *Tag {
	for i := range d.Tags {
		if d.Tags[i].ID == id {
			return &d.Tags[i]
		}
	}
	return nil
}

// normalizeTransaction stores only two types: transfer and allocate.
// "expense" and "income" are accepted as shorthands and become transfers to
// or from an external account (the anonymous one unless the client names
// another external account). It clears unused fields, takes the currency
// from the user's own account, and rejects combinations the rules forbid:
//   - transfer: two different accounts, at least one of them the user's own;
//     between two own accounts the currency must match (converting currency
//     is spending in one and income in the other); tag optional, never a
//     money box
//   - allocate: one own account and a money box (goal tag); posted; the
//     amount is signed (negative takes money back out, ADR 0003) and may
//     not take out more than the account has allocated to that money box.
//     "release" is accepted as a shorthand for a negative allocation.
func (d *Data) normalizeTransaction(t *Transaction) error {
	t.Note, t.Memo = strings.TrimSpace(t.Note), strings.TrimSpace(t.Memo)
	if utf8.RuneCountInString(t.Note) > maxTitleRunes {
		return fmt.Errorf("title longer than %d characters", maxTitleRunes)
	}
	if utf8.RuneCountInString(t.Memo) > maxMemoRunes {
		return fmt.Errorf("note longer than %d characters", maxMemoRunes)
	}
	if t.State == "" {
		t.State = "posted"
	}
	if t.State != "posted" && t.State != "planned" {
		return fmt.Errorf("state must be posted or planned")
	}
	switch t.Type {
	case "expense", "income":
		if err := d.expandShorthand(&t.Type, &t.AccountID, &t.FromAccountID, &t.ToAccountID); err != nil {
			return err
		}
		return d.normalizeTransaction(t)
	case "release":
		if t.AmountMinor > 0 {
			t.AmountMinor = -t.AmountMinor
		}
		t.Type = "allocate"
		return d.normalizeTransaction(t)
	case "allocate":
		a := d.accountByID(t.AccountID)
		if a == nil || a.IsExternal() {
			return fmt.Errorf("accountId must be one of your own accounts")
		}
		tag := d.tagByID(t.TagID)
		if tag == nil || tag.Kind != "goal" {
			return fmt.Errorf("allocate needs tagId of a money box (goal tag)")
		}
		if t.AmountMinor == 0 {
			return fmt.Errorf("amountMinor must not be zero")
		}
		if left := d.allocatedExcept(a.ID, tag.ID, t.ID) + t.AmountMinor; left < 0 {
			return fmt.Errorf("cannot take out more than is allocated: %s holds less than that in this account", tag.Name)
		}
		t.FromAccountID, t.ToAccountID = "", ""
		t.Currency = a.Currency
		t.State = "posted" // a decision moves no cash, there is nothing to confirm
	case "transfer":
		if t.AmountMinor <= 0 {
			return fmt.Errorf("amountMinor must be positive")
		}
		cur, err := d.transferCurrency(t.FromAccountID, t.ToAccountID)
		if err != nil {
			return err
		}
		if t.TagID != "" {
			tag := d.tagByID(t.TagID)
			if tag == nil {
				return fmt.Errorf("tagId must be an existing tag")
			}
			if tag.Kind == "goal" {
				return fmt.Errorf("a money box tag is only for allocations")
			}
		}
		t.AccountID = ""
		t.Currency = cur
	default:
		return fmt.Errorf("type must be transfer or allocate (expense, income and release are accepted as shorthands)")
	}
	return nil
}

// expandShorthand turns expense/income into a transfer with an external side.
// accountId (or the own side given as from/to) is the user's account; the
// other side defaults to the anonymous external account.
func (d *Data) expandShorthand(typ, accountID, fromID, toID *string) error {
	isExt := func(id string) bool { a := d.accountByID(id); return a != nil && a.IsExternal() }
	if *typ == "expense" {
		own := *accountID
		if own == "" {
			own = *fromID
		}
		ext := ExternalAccountID
		if *toID != "" && isExt(*toID) {
			ext = *toID
		}
		*fromID, *toID = own, ext
	} else {
		own := *accountID
		if own == "" {
			own = *toID
		}
		ext := ExternalAccountID
		if *fromID != "" && isExt(*fromID) {
			ext = *fromID
		}
		*fromID, *toID = ext, own
	}
	*typ, *accountID = "transfer", ""
	return nil
}

// transferCurrency validates the two sides of a transfer and returns the
// currency it is recorded in (the user's own account decides).
func (d *Data) transferCurrency(fromID, toID string) (string, error) {
	from, to := d.accountByID(fromID), d.accountByID(toID)
	if from == nil || to == nil {
		return "", fmt.Errorf("transfer needs existing fromAccountId and toAccountId")
	}
	if from.ID == to.ID {
		return "", fmt.Errorf("transfer needs two different accounts")
	}
	switch {
	case from.IsExternal() && to.IsExternal():
		return "", fmt.Errorf("a transfer needs at least one of your own accounts")
	case from.IsExternal():
		return to.Currency, nil
	case to.IsExternal():
		return from.Currency, nil
	}
	if from.Currency != to.Currency {
		return "", fmt.Errorf("transfer accounts must share a currency; record spending in %s and income in %s instead", from.Currency, to.Currency)
	}
	return from.Currency, nil
}

// normalizeTemplate applies the same rules to what a template generates.
func (d *Data) normalizeTemplate(b *TemplateBody) error {
	switch b.Type {
	case "expense", "income":
		if err := d.expandShorthand(&b.Type, &b.AccountID, &b.FromAccountID, &b.ToAccountID); err != nil {
			return err
		}
		return d.normalizeTemplate(b)
	case "allocate":
		a := d.accountByID(b.AccountID)
		if a == nil || a.IsExternal() {
			return fmt.Errorf("template accountId must be one of your own accounts")
		}
		if tag := d.tagByID(b.TagID); tag == nil || tag.Kind != "goal" {
			return fmt.Errorf("an allocate template needs a money box (goal tag)")
		}
		b.FromAccountID, b.ToAccountID, b.ExpectedRangeMinor = "", "", nil
		b.Currency = a.Currency
	case "transfer":
		cur, err := d.transferCurrency(b.FromAccountID, b.ToAccountID)
		if err != nil {
			return err
		}
		if b.TagID != "" {
			if tag := d.tagByID(b.TagID); tag == nil || tag.Kind == "goal" {
				return fmt.Errorf("template tagId must be an existing non-money-box tag")
			}
		}
		b.AccountID = ""
		b.Currency = cur
	default:
		return fmt.Errorf("a template generates a transfer or an allocate (expense and income are accepted as shorthands)")
	}
	return nil
}

// allocatedExcept is the posted allocation for (account, money box) without
// transaction skipID, so an edit is checked against everything else.
func (d *Data) allocatedExcept(accountID, tagID, skipID string) int64 {
	var total int64
	for _, t := range d.Transactions {
		if t.ID != skipID && t.State == "posted" && t.Type == "allocate" && t.AccountID == accountID && t.TagID == tagID {
			total += t.AmountMinor
		}
	}
	return total
}

func (d *Data) accountHasTransactions(id string) bool {
	for _, t := range d.Transactions {
		if t.AccountID == id || t.FromAccountID == id || t.ToAccountID == id {
			return true
		}
	}
	return false
}

// validateAccount checks kind-specific fields. External accounts have no
// currency or balance of their own; their transfers take the other side's.
func validateAccount(a *Account) error {
	if a.Name == "" {
		return fmt.Errorf("name required")
	}
	if a.IsExternal() {
		a.Currency, a.OpeningBalanceMinor, a.AllowNegative = "", 0, false
		a.CreditLimitMinor, a.StatementCloseDay, a.PaymentDueDay = nil, nil, nil
		return nil
	}
	if a.Currency == "" {
		return fmt.Errorf("currency required")
	}
	return nil
}
