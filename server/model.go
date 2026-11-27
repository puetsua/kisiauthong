// SPDX-License-Identifier: AGPL-3.0-or-later
package main

// Account is the user's own account or an external one (ADR 0002). Own
// accounts have no type (ADR 0005): an icon to tell them apart, and an
// optional limit for anything that runs negative, such as a card or a loan.
type Account struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Kind                string `json:"kind"` // "own" or "external"
	Icon                string `json:"icon,omitempty"`
	Currency            string `json:"currency"`
	OpeningBalanceMinor int64  `json:"openingBalanceMinor"`
	LimitMinor          *int64 `json:"limitMinor,omitempty"` // owed = max(0, -balance) is tracked against it
	StatementCloseDay   *int   `json:"statementCloseDay,omitempty"`
	PaymentDueDay       *int   `json:"paymentDueDay,omitempty"`
	Memo                string `json:"memo,omitempty"` // the user's own free-text note (issue #42)
}

// Transaction is a money movement (ADR 0013): from one account to another. Its type is
// derived from the accounts and never stored (ADR 0029): "expense" (own → external),
// "income" (external → own) or "transfer" (between own accounts).
type Transaction struct {
	ID                    string   `json:"id"`
	AccountID             string   `json:"accountId,omitempty"` // input only: the own account of an expense or income shorthand
	FromAccountID         string   `json:"fromAccountId,omitempty"`
	ToAccountID           string   `json:"toAccountId,omitempty"`
	TagIDs                []string `json:"tagIds,omitempty"` // its categories (ADR 0010)
	Type                  string   `json:"type"`             // derived from the accounts (ADR 0029); on input a check, or a shorthand
	State                 string   `json:"state"`
	AmountMinor           int64    `json:"amountMinor"`
	Currency              string   `json:"currency"`
	Date                  string   `json:"date"`                // local date where it happened (YYYY-MM-DD)
	Time                  string   `json:"time,omitempty"`      // optional local time "HH:MM" on Date (ADR 0006)
	TZ                    string   `json:"tz,omitempty"`        // IANA zone of Date and Time; set when Time is
	At                    string   `json:"at,omitempty"`        // derived: the instant in UTC (RFC 3339), never stored
	Note                  string   `json:"note"`                // short title shown in lists
	Memo                  string   `json:"memo,omitempty"`      // longer free-text note
	CreatedAt             string   `json:"createdAt,omitempty"` // when it was entered (UTC, ms); empty before migration 13
	TransactionTemplateID string   `json:"transactionTemplateId,omitempty"`
	OccurrenceDate        string   `json:"occurrenceDate,omitempty"`
}

type Range struct {
	Min int64 `json:"min"`
	Max int64 `json:"max"`
}

// TemplateBody is what a template generates: a transfer, or with type "allocate" an
// allocation into ReserveID from AccountID (ADR 0013).
type TemplateBody struct {
	AccountID          string   `json:"accountId,omitempty"` // an allocation's account; input for expense/income shorthands
	FromAccountID      string   `json:"fromAccountId,omitempty"`
	ToAccountID        string   `json:"toAccountId,omitempty"`
	ReserveID          string   `json:"reserveId,omitempty"` // an allocation template's reserve
	TagIDs             []string `json:"tagIds,omitempty"`    // categories of a transfer
	Type               string   `json:"type"`
	AmountMinor        int64    `json:"amountMinor"`
	ExpectedRangeMinor *Range   `json:"expectedRangeMinor,omitempty"`
	Currency           string   `json:"currency"`
	Note               string   `json:"note"`
}

type Schedule struct {
	Frequency  string `json:"frequency"`
	Interval   int    `json:"interval"`
	DayOfMonth int    `json:"dayOfMonth,omitempty"`
	Weekday    *int   `json:"weekday,omitempty"`
	StartDate  string `json:"startDate"`
	EndDate    string `json:"endDate,omitempty"`
}

type TransactionTemplate struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Enabled  bool         `json:"enabled"`
	Template TemplateBody `json:"template"`
	Schedule Schedule     `json:"schedule"`
}

// Tag is a category, a budget when it has a limit (ADR 0004, 0013).
type Tag struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	LimitMinor *int64 `json:"limitMinor,omitempty"`
	Cycle      string `json:"cycle,omitempty"`      // budget period unit (budget.go)
	CycleEvery int    `json:"cycleEvery,omitempty"` // period length in units; 0 = 1
	CycleStart string `json:"cycleStart,omitempty"` // first day of one period; "" = calendar-aligned
	CycleEnd   string `json:"cycleEnd,omitempty"`   // "range" budgets only
	Currency   string `json:"currency,omitempty"`   // a budget's currency
	Memo       string `json:"memo,omitempty"`       // the user's own free-text note (issue #42)
	Group      string `json:"group,omitempty"`      // orders it in tag pickers; "" = ungrouped (ADR 0028)
	// CountTransfers: a budget also counts transfers between own accounts that carry the tag (ADR 0029)
	CountTransfers bool `json:"countTransfers,omitempty"`
}

// Reserve earmarks money in own accounts, optionally toward a target (ADR 0013).
// What it holds is derived from its allocations, never stored.
type Reserve struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	TargetMinor *int64 `json:"targetMinor,omitempty"`
	TargetDate  string `json:"targetDate,omitempty"`
}

// Allocation is one decision to put money of an account into a reserve (positive)
// or take it back out (negative). It moves no money.
type Allocation struct {
	ID                    string `json:"id"`
	ReserveID             string `json:"reserveId"`
	AccountID             string `json:"accountId"`
	AmountMinor           int64  `json:"amountMinor"`
	Currency              string `json:"currency"` // the account's
	Date                  string `json:"date"`
	Time                  string `json:"time,omitempty"`
	TZ                    string `json:"tz,omitempty"`
	At                    string `json:"at,omitempty"` // derived, as on transactions
	Note                  string `json:"note"`
	Memo                  string `json:"memo,omitempty"`
	CreatedAt             string `json:"createdAt,omitempty"`
	TransactionTemplateID string `json:"transactionTemplateId,omitempty"`
	OccurrenceDate        string `json:"occurrenceDate,omitempty"`
}

type TransactionTag struct {
	TransactionID string `json:"transactionId"`
	TagID         string `json:"tagId"`
}

type Data struct {
	Version              int                   `json:"version"`
	Accounts             []Account             `json:"accounts"`
	Transactions         []Transaction         `json:"transactions"`
	Tags                 []Tag                 `json:"tags"`
	TransactionTags      []TransactionTag      `json:"transactionTags"`
	TransactionTemplates []TransactionTemplate `json:"transactionTemplates"`
	Reserves             []Reserve             `json:"reserves"`
	Allocations          []Allocation          `json:"allocations"`
}
