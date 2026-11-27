// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"fmt"
	"regexp"
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

func (d *Data) transactionByID(id string) *Transaction {
	for i := range d.Transactions {
		if d.Transactions[i].ID == id {
			return &d.Transactions[i]
		}
	}
	return nil
}

func (d *Data) templateByID(id string) *TransactionTemplate {
	for i := range d.TransactionTemplates {
		if d.TransactionTemplates[i].ID == id {
			return &d.TransactionTemplates[i]
		}
	}
	return nil
}

func (d *Data) tagByID(id string) *Tag {
	for i := range d.Tags {
		if d.Tags[i].ID == id {
			return &d.Tags[i]
		}
	}
	return nil
}

// normalizeTransaction stores every transaction as a transfer (ADR 0013).
// "expense" and "income" are accepted as shorthands and become transfers to
// or from an external account (the anonymous one unless the client names
// another external account). It takes the currency from the user's own
// account and rejects combinations the rules forbid: two different accounts,
// at least one of them the user's own; between two own accounts the currency
// must match (converting currency is spending in one and income in the
// other); a positive amount; categories that exist.
func (d *Data) normalizeTransaction(t *Transaction) error {
	if err := normalizeWhen(&t.Date, &t.Time, &t.TZ, &t.At); err != nil {
		return err
	}
	t.Note, t.Memo = strings.TrimSpace(t.Note), strings.TrimSpace(t.Memo)
	if utf8.RuneCountInString(t.Note) > maxTitleRunes {
		return fmt.Errorf("title longer than %d characters", maxTitleRunes)
	}
	if utf8.RuneCountInString(t.Memo) > maxMemoRunes {
		return fmt.Errorf("note longer than %d characters", maxMemoRunes)
	}
	if t.State == "" || t.State == "scheduled" {
		// scheduled is derived from the date and only served (ADR 0014); written back, it is posted
		t.State = "posted"
	}
	if t.State != "posted" && t.State != "planned" {
		return fmt.Errorf("state must be posted or planned (a posted transaction dated after today is scheduled)")
	}
	switch t.Type {
	case "expense", "income":
		if err := d.expandShorthand(&t.Type, &t.AccountID, &t.FromAccountID, &t.ToAccountID); err != nil {
			return err
		}
		return d.normalizeTransaction(t)
	case "transfer":
		if t.AmountMinor <= 0 {
			return fmt.Errorf("amountMinor must be positive")
		}
		cur, err := d.transferCurrency(t.FromAccountID, t.ToAccountID)
		if err != nil {
			return err
		}
		ids, err := d.categoryIDs(t.TagIDs)
		if err != nil {
			return err
		}
		t.TagIDs = ids
		t.AccountID = ""
		t.Currency = cur
	default:
		return fmt.Errorf("type must be transfer (expense and income are accepted as shorthands); reserves take allocations")
	}
	return nil
}

// categoryIDs checks a transaction's categories: each must be an existing tag;
// duplicates are dropped and the order is kept (ADR 0010).
func (d *Data) categoryIDs(ids []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		if d.tagByID(id) == nil {
			return nil, fmt.Errorf("unknown tag %q", id)
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

// normalizeReserve checks a reserve: a name, a currency, and an optional target and target date.
func normalizeReserve(r *Reserve) error {
	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		return fmt.Errorf("name required")
	}
	if utf8.RuneCountInString(r.Name) > 100 {
		return fmt.Errorf("name longer than 100 characters")
	}
	r.Currency = normCurrency(r.Currency)
	if !currencyRe.MatchString(r.Currency) {
		return fmt.Errorf("a reserve needs a 3-letter currency code")
	}
	if r.TargetMinor != nil && *r.TargetMinor <= 0 {
		return fmt.Errorf("a target must be more than zero, or left out")
	}
	if r.TargetDate != "" && !validDate(r.TargetDate) {
		return fmt.Errorf("target date must be YYYY-MM-DD")
	}
	return nil
}

// leavesPairHeld refuses removing allocation old from its (reserve, account) pair when the rest
// of the pair would hold less than nothing: a take-out that depended on it would be left over.
func (d *Data) leavesPairHeld(old *Allocation) error {
	if d.ReservedIn(old.ReserveID, old.AccountID, old.ID) < 0 {
		name := old.ReserveID
		if r := d.reserveByID(old.ReserveID); r != nil {
			name = r.Name
		}
		return fmt.Errorf("later take-outs from %s in this account depend on this allocation; delete or change those first", name)
	}
	return nil
}

// normalizeAllocation checks one allocation (ADR 0013): an existing reserve and own account,
// a signed amount that is not zero and does not take out more than the reserve holds in that
// account, and the account's currency.
func (d *Data) normalizeAllocation(a *Allocation) error {
	if err := normalizeWhen(&a.Date, &a.Time, &a.TZ, &a.At); err != nil {
		return err
	}
	if a.Date == "" {
		return fmt.Errorf("date required")
	}
	a.Note, a.Memo = strings.TrimSpace(a.Note), strings.TrimSpace(a.Memo)
	if utf8.RuneCountInString(a.Note) > maxTitleRunes {
		return fmt.Errorf("title longer than %d characters", maxTitleRunes)
	}
	if utf8.RuneCountInString(a.Memo) > maxMemoRunes {
		return fmt.Errorf("note longer than %d characters", maxMemoRunes)
	}
	r := d.reserveByID(a.ReserveID)
	if r == nil {
		return fmt.Errorf("unknown reserve %q", a.ReserveID)
	}
	acc := d.accountByID(a.AccountID)
	if acc == nil || acc.IsExternal() {
		return fmt.Errorf("accountId must be one of your own accounts")
	}
	if a.AmountMinor == 0 {
		return fmt.Errorf("amountMinor must not be zero")
	}
	if left := d.ReservedIn(r.ID, acc.ID, a.ID) + a.AmountMinor; left < 0 {
		return fmt.Errorf("cannot take out more than %s holds in this account", r.Name)
	}
	a.Currency = acc.Currency
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

var frequencies = map[string]bool{"daily": true, "weekly": true, "monthly": true, "quarterly": true, "yearly": true}

// normalizeSchedule checks a template's schedule. "never" makes the template a
// shortcut that fills in the add form and generates nothing (ADR 0012); an
// empty frequency stays monthly, as before.
func normalizeSchedule(s *Schedule) error {
	if s.Frequency == "never" {
		*s = Schedule{Frequency: "never", Interval: 1}
		return nil
	}
	if s.Frequency == "" {
		s.Frequency = "monthly"
	}
	if !frequencies[s.Frequency] {
		return fmt.Errorf("frequency must be daily, weekly, monthly, quarterly, yearly or never")
	}
	if s.Interval < 1 {
		s.Interval = 1
	}
	if !validDate(s.StartDate) {
		return fmt.Errorf("schedule startDate must be a date (YYYY-MM-DD)")
	}
	if s.EndDate != "" && !validDate(s.EndDate) {
		return fmt.Errorf("schedule endDate must be a date (YYYY-MM-DD)")
	}
	return nil
}

// checkTemplateAmount needs a positive amount on a template that repeats: what it
// generates is a transaction or an allocation, always one fixed positive amount.
// A shortcut (frequency never, ADR 0012) only fills in the add form, so it may
// have none (0), for entries whose amount differs every time (issue #121).
// Call it after normalizeSchedule.
func checkTemplateAmount(tp TransactionTemplate) error {
	a := tp.Template.AmountMinor
	if a < 0 || (a == 0 && tp.Schedule.Frequency != "never") {
		return fmt.Errorf("a repeating template needs a positive amount; only a shortcut (frequency never) may have none")
	}
	return nil
}

// normalizeTemplate applies the same rules to what a template generates.
func (d *Data) normalizeTemplate(b *TemplateBody) error {
	switch b.Type {
	case "expense", "income":
		if err := d.expandShorthand(&b.Type, &b.AccountID, &b.FromAccountID, &b.ToAccountID); err != nil {
			return err
		}
		return d.normalizeTemplate(b)
	case "allocate": // an allocation template (ADR 0013)
		a := d.accountByID(b.AccountID)
		if a == nil || a.IsExternal() {
			return fmt.Errorf("template accountId must be one of your own accounts")
		}
		if d.reserveByID(b.ReserveID) == nil {
			return fmt.Errorf("an allocation template needs a reserveId")
		}
		b.FromAccountID, b.ToAccountID, b.ExpectedRangeMinor, b.TagIDs = "", "", nil, nil
		b.Currency = a.Currency
	case "transfer":
		cur, err := d.transferCurrency(b.FromAccountID, b.ToAccountID)
		if err != nil {
			return err
		}
		ids, err := d.categoryIDs(b.TagIDs)
		if err != nil {
			return err
		}
		b.TagIDs, b.ReserveID = ids, ""
		b.AccountID = ""
		b.Currency = cur
	default:
		return fmt.Errorf("a template generates a transfer (expense and income are accepted as shorthands) or an allocate")
	}
	return nil
}

// accountInUse reports whether a transaction or an allocation names the account.
func (d *Data) accountInUse(id string) bool {
	for _, t := range d.Transactions {
		if t.FromAccountID == id || t.ToAccountID == id {
			return true
		}
	}
	for _, a := range d.Allocations {
		if a.AccountID == id {
			return true
		}
	}
	return false
}

// validateAccount checks kind-specific fields. External accounts have no
// currency or balance of their own; their transfers take the other side's.
// legacyAccountIcon maps the account types used before ADR 0005, still
// accepted as kind, to the icon they now are.
var legacyAccountIcon = map[string]string{"bank": "bank", "savings": "savings", "cash": "cash", "credit_card": "card",
	"ewallet": "wallet", "investment": "investment", "loan": "loan"}

var iconRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,23}$`)

// validMemo trims an account's or tag's note and keeps it within a transaction note's limit.
func validMemo(m *string) error {
	*m = strings.TrimSpace(*m)
	if utf8.RuneCountInString(*m) > maxMemoRunes {
		return fmt.Errorf("note longer than %d characters", maxMemoRunes)
	}
	return nil
}

// maxTagGroupRunes bounds a tag's group name, a short heading like a tag name.
const maxTagGroupRunes = 100

// validTagGroup trims a tag's group and folds runs of white space (line breaks
// included) into one space, so one group is never two headings (ADR 0028).
func validTagGroup(g *string) error {
	*g = strings.Join(strings.Fields(*g), " ")
	if utf8.RuneCountInString(*g) > maxTagGroupRunes {
		return fmt.Errorf("group longer than %d characters", maxTagGroupRunes)
	}
	return nil
}

func validateAccount(a *Account) error {
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" {
		return fmt.Errorf("name required")
	}
	if err := validMemo(&a.Memo); err != nil {
		return err
	}
	if icon, ok := legacyAccountIcon[a.Kind]; ok {
		a.Kind = "own"
		if a.Icon == "" {
			a.Icon = icon
		}
	}
	if a.Kind == "" {
		a.Kind = "own"
	}
	if a.Kind != "own" && a.Kind != "external" {
		return fmt.Errorf("account kind must be own or external")
	}
	if a.Icon != "" && !iconRe.MatchString(a.Icon) {
		return fmt.Errorf("invalid icon name")
	}
	if a.IsExternal() {
		a.Currency, a.OpeningBalanceMinor = "", 0
		a.LimitMinor, a.StatementCloseDay, a.PaymentDueDay = nil, nil, nil
		return nil
	}
	a.Currency = normCurrency(a.Currency)
	if !currencyRe.MatchString(a.Currency) {
		return fmt.Errorf("currency must be a 3-letter ISO 4217 code")
	}
	if a.LimitMinor != nil && *a.LimitMinor <= 0 {
		return fmt.Errorf("limit must be more than zero, or left empty")
	}
	return nil
}
