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
}

type Transaction struct {
	ID                    string `json:"id"`
	AccountID             string `json:"accountId"`
	FromAccountID         string `json:"fromAccountId,omitempty"`
	ToAccountID           string `json:"toAccountId,omitempty"`
	TagID                 string `json:"tagId,omitempty"`
	Type                  string `json:"type"`
	State                 string `json:"state"`
	AmountMinor           int64  `json:"amountMinor"`
	Currency              string `json:"currency"`
	Date                  string `json:"date"`
	Note                  string `json:"note"`           // short title shown in lists
	Memo                  string `json:"memo,omitempty"` // longer free-text note
	TransactionTemplateID string `json:"transactionTemplateId,omitempty"`
	OccurrenceDate        string `json:"occurrenceDate,omitempty"`
}

type Range struct {
	Min int64 `json:"min"`
	Max int64 `json:"max"`
}

type TemplateBody struct {
	AccountID          string `json:"accountId,omitempty"`
	FromAccountID      string `json:"fromAccountId,omitempty"`
	ToAccountID        string `json:"toAccountId,omitempty"`
	TagID              string `json:"tagId,omitempty"`
	Type               string `json:"type"`
	AmountMinor        int64  `json:"amountMinor"`
	ExpectedRangeMinor *Range `json:"expectedRangeMinor,omitempty"`
	Currency           string `json:"currency"`
	Note               string `json:"note"`
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

type Tag struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	LimitMinor  *int64 `json:"limitMinor,omitempty"`
	Cycle       string `json:"cycle,omitempty"`      // budget period unit (budget.go)
	CycleEvery  int    `json:"cycleEvery,omitempty"` // period length in units; 0 = 1
	CycleStart  string `json:"cycleStart,omitempty"` // first day of one period; "" = calendar-aligned
	CycleEnd    string `json:"cycleEnd,omitempty"`   // "range" budgets only
	Currency    string `json:"currency,omitempty"`
	TargetMinor *int64 `json:"targetMinor,omitempty"`
	TargetDate  string `json:"targetDate,omitempty"`
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
}
