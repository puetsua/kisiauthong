// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"testing"
	"time"
)

// Scheduled transactions (ADR 0014): a posted transaction dated after today is not in
// balances yet; what it takes from an own account is held, what it brings is incoming.

func TestTodayZoneFallback(t *testing.T) {
	// 17:30 UTC on Nov 17 is already Nov 18 in Taipei
	at := time.Date(2026, 11, 17, 17, 30, 0, 0, time.UTC)
	t.Setenv("KISIAUTHONG_TZ", "Asia/Taipei")
	if got := todayAt(at, ""); got != "2026-11-18" {
		t.Fatalf("KISIAUTHONG_TZ: %s", got)
	}
	if got := todayAt(at, "Europe/London"); got != "2026-11-17" {
		t.Fatalf("the user's zone comes first: %s", got)
	}
	if got := todayAt(at, "America/Los_Angeles"); got != "2026-11-17" {
		t.Fatalf("Los Angeles: %s", got)
	}
	want := at.In(time.Local).Format("2006-01-02")
	for _, env := range []string{"", "Not/AZone", "Local"} {
		t.Setenv("KISIAUTHONG_TZ", env)
		if got := todayAt(at, ""); got != want {
			t.Fatalf("KISIAUTHONG_TZ=%q: %s, want the process zone's %s", env, got, want)
		}
	}
}

func TestBookTodayFollowsSettings(t *testing.T) {
	b := sampleBook(t)
	t.Setenv("KISIAUTHONG_TZ", "Pacific/Kiritimati") // UTC+14
	if got, want := b.today(), todayAt(time.Now(), "Pacific/Kiritimati"); got != want {
		t.Fatalf("Auto follows KISIAUTHONG_TZ: %s, want %s", got, want)
	}
	if err := b.setSetting("general", `{"defaultCurrency":"TWD","timeZone":"Pacific/Pago_Pago"}`); err != nil { // UTC-11
		t.Fatal(err)
	}
	if got, want := b.today(), todayAt(time.Now(), "Pacific/Pago_Pago"); got != want {
		t.Fatalf("the Settings zone wins: %s, want %s", got, want)
	}
}

// books: bank A, card C (limit), employer E (external); today is 2026-11-18
func scheduledBooks(txns ...Transaction) Data {
	limit := int64(6000000)
	return Data{
		Accounts: []Account{
			{ID: "a", Name: "A", Kind: "own", Currency: "TWD", OpeningBalanceMinor: 8520000},
			{ID: "c", Name: "Card", Kind: "own", Currency: "TWD", OpeningBalanceMinor: -788000, LimitMinor: &limit},
			{ID: "emp", Name: "Employer", Kind: "external"}, ext,
		},
		Tags:         []Tag{{ID: "food", Name: "Food", Currency: "TWD"}},
		Reserves:     []Reserve{{ID: "trip", Name: "Trip", Currency: "TWD"}},
		Allocations:  []Allocation{{ID: "al", ReserveID: "trip", AccountID: "a", Currency: "TWD", AmountMinor: 1200000, Date: "2026-11-01"}},
		Transactions: txns,
	}
}

func tx(id, from, to string, amt int64, date string) Transaction {
	return Transaction{ID: id, Type: "transfer", State: "posted", FromAccountID: from, ToAccountID: to, Currency: "TWD", AmountMinor: amt, Date: date}
}

func TestScheduledTodayTomorrowBoundary(t *testing.T) {
	d := scheduledBooks(
		tx("today", "a", ExternalAccountID, 10000, "2026-11-18"),
		tx("tomorrow", "a", ExternalAccountID, 20000, "2026-11-19"),
		tx("pay-card", "a", "c", 100000, "2026-11-20"),
	)
	const today = "2026-11-18"
	if got := d.Balance("a", today); got != 8520000-10000 {
		t.Fatalf("balance counts today only: %d", got)
	}
	if got := d.Held("a", today); got != 120000 {
		t.Fatalf("held: %d", got)
	}
	if got := d.Projected("a"); got != 8520000-130000 {
		t.Fatalf("projected: %d", got)
	}
	free := d.Balance("a", today) - d.Reserved("a") - d.Held("a", today)
	if free != 8520000-10000-1200000-120000 {
		t.Fatalf("free: %d", free)
	}
	if d.Reserved("a") != 1200000 {
		t.Fatalf("a hold is not an allocation: reserved %d", d.Reserved("a"))
	}
	// the card is paid down only on the date: until then the payment is incoming
	if got := d.Balance("c", today); got != -788000 {
		t.Fatalf("card balance: %d", got)
	}
	if got, held := d.Incoming("c", today), d.Held("c", today); got != 100000 || held != 0 {
		t.Fatalf("card incoming %d held %d", got, held)
	}
	if got := d.NextScheduled("a", today, true); got != "2026-11-19" {
		t.Fatalf("next held date: %s", got)
	}
	// a day later the first one has posted by itself, with nothing written
	if got := d.Balance("a", "2026-11-19"); got != 8520000-30000 {
		t.Fatalf("balance on the 19th: %d", got)
	}
	if got := d.Held("a", "2026-11-19"); got != 100000 {
		t.Fatalf("held on the 19th: %d", got)
	}
	if got := d.Balance("c", "2026-11-20"); got != -688000 {
		t.Fatalf("card paid on the 20th: %d", got)
	}
	if ServedState(d.Transactions[0], today) != "posted" || ServedState(d.Transactions[1], today) != "scheduled" {
		t.Fatalf("served states")
	}
	planned := tx("p", "a", ExternalAccountID, 5, "2026-11-30")
	planned.State = "planned"
	if ServedState(planned, today) != "planned" || Scheduled(planned, today) {
		t.Fatalf("planned stays planned")
	}
}

func TestScheduledAcrossMonthEnd(t *testing.T) {
	d := scheduledBooks(
		tx("nov30", "a", ExternalAccountID, 300, "2026-11-30"),
		tx("dec1", "a", ExternalAccountID, 500, "2026-12-01"),
	)
	d.TransactionTags = []TransactionTag{{TransactionID: "nov30", TagID: "food"}, {TransactionID: "dec1", TagID: "food"}}
	const today = "2026-11-30"
	if d.Balance("a", today) != 8520000-300 || d.Held("a", today) != 500 {
		t.Fatalf("month end: balance %d held %d", d.Balance("a", today), d.Held("a", today))
	}
	if got := d.BudgetSpent("food", "2026-12-01", "2026-12-31", today); got != 0 {
		t.Fatalf("December budget before December: %d", got)
	}
	if got := d.BudgetSpent("food", "2026-12-01", "2026-12-31", "2026-12-01"); got != 500 {
		t.Fatalf("December budget on Dec 1: %d", got)
	}
	if got := d.SpendingByCategory("2026-12-01", today, nil); len(got) != 0 {
		t.Fatalf("December spending before December: %+v", got)
	}
}

func TestScheduledBudgetsCountOncePosted(t *testing.T) {
	d := scheduledBooks(
		tx("lunch", "a", ExternalAccountID, 180, "2026-11-18"),
		tx("dinner", "a", ExternalAccountID, 900, "2026-11-25"),
		tx("card-buy", "c", ExternalAccountID, 400, "2026-11-19"),
	)
	d.TransactionTags = []TransactionTag{{TransactionID: "lunch", TagID: "food"}, {TransactionID: "dinner", TagID: "food"}, {TransactionID: "card-buy", TagID: "food"}}
	if got := d.BudgetSpent("food", "2026-11-01", "2026-11-30", "2026-11-18"); got != 180 {
		t.Fatalf("budget on the 18th: %d", got)
	}
	if got := d.BudgetSpent("food", "2026-11-01", "2026-11-30", "2026-11-25"); got != 180+900+400 {
		t.Fatalf("budget on the 25th: %d", got)
	}
	if got := d.SpendingByCategory("2026-11-18", "2026-11-18", nil); len(got) != 1 || got[0].AmountMinor != 180 {
		t.Fatalf("spending on the 18th: %+v", got)
	}
	// spending from a card holds against it, like any own account
	if got := d.Held("c", "2026-11-18"); got != 400 {
		t.Fatalf("card held: %d", got)
	}
}

func TestScheduledIncomeAndExternalSource(t *testing.T) {
	d := scheduledBooks(
		tx("salary", "emp", "a", 5000000, "2026-11-25"),
		tx("refund", ExternalAccountID, "c", 1000, "2026-11-19"),
	)
	const today = "2026-11-18"
	if d.Held("a", today) != 0 || d.Incoming("a", today) != 5000000 {
		t.Fatalf("income holds nothing and shows as incoming: held %d incoming %d", d.Held("a", today), d.Incoming("a", today))
	}
	if d.Balance("a", today) != 8520000 || d.Projected("a") != 8520000+5000000 {
		t.Fatalf("income is not in the balance before its date")
	}
	if d.Held("emp", today) != 0 || d.Held(ExternalAccountID, today) != 0 || d.Incoming("emp", today) != 0 || d.Projected("emp") != 0 {
		t.Fatalf("external accounts hold nothing")
	}
	if d.Incoming("c", today) != 1000 {
		t.Fatalf("card refund incoming: %d", d.Incoming("c", today))
	}
}

func TestScheduledStateIsWrittenAsPosted(t *testing.T) {
	d := scheduledBooks()
	tr := tx("", "a", ExternalAccountID, 100, "2026-12-24")
	tr.State = "scheduled"
	if err := d.normalizeTransaction(&tr); err != nil || tr.State != "posted" {
		t.Fatalf("scheduled written back: %v %s", err, tr.State)
	}
	tr.State = "pending"
	if err := d.normalizeTransaction(&tr); err == nil {
		t.Fatalf("unknown state accepted")
	}
}

// The API serves scheduled rows and held amounts, edits move holds at once, and post posts now.
func TestScheduledOverAPI(t *testing.T) {
	t.Setenv("KISIAUTHONG_TZ", "Asia/Taipei")
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	c := newClient(t, srv)
	signedIn(t, c, "alice")
	today := todayAt(time.Now(), "Asia/Taipei")
	in2 := addDays(today, 2)

	type acct struct {
		ID                                                               string
		BalanceMinor, ReservedMinor, FreeMinor, HeldMinor, IncomingMinor int64
		ProjectedMinor                                                   int64
		NextHeldDate, NextIncomingDate                                   string
	}
	var st0 struct{ Accounts []acct }
	c.do("GET", "/api/state", nil, &st0)
	find := func(list []acct, id string) acct {
		for _, a := range list {
			if a.ID == id {
				return a
			}
		}
		t.Fatalf("no account %s", id)
		return acct{}
	}
	a0, b0 := find(st0.Accounts, "acc-a"), find(st0.Accounts, "acc-b")
	if a0.HeldMinor != 0 || a0.FreeMinor != a0.BalanceMinor-a0.ReservedMinor {
		t.Fatalf("sample books start with nothing held: %+v", a0)
	}

	var made Transaction
	if code := c.do("POST", "/api/transactions", map[string]interface{}{"type": "transfer", "fromAccountId": "acc-a", "toAccountId": "acc-b",
		"amountMinor": 100000, "date": in2}, &made); code != 201 || made.State != "scheduled" {
		t.Fatalf("create: %d %+v", code, made)
	}
	var st struct {
		Today        string
		Accounts     []acct
		Transactions []Transaction
	}
	c.do("GET", "/api/state", nil, &st)
	a, b := find(st.Accounts, "acc-a"), find(st.Accounts, "acc-b")
	if st.Today != today || a.BalanceMinor != a0.BalanceMinor || a.HeldMinor != 100000 || a.FreeMinor != a0.FreeMinor-100000 ||
		a.ProjectedMinor != a0.BalanceMinor-100000 || a.NextHeldDate != in2 {
		t.Fatalf("source: %+v (today %s)", a, st.Today)
	}
	if b.BalanceMinor != b0.BalanceMinor || b.IncomingMinor != 100000 || b.FreeMinor != b0.FreeMinor || b.NextIncomingDate != in2 {
		t.Fatalf("destination: %+v", b)
	}
	served := ""
	for _, x := range st.Transactions {
		if x.ID == made.ID {
			served = x.State
		}
	}
	if served != "scheduled" {
		t.Fatalf("served state %q", served)
	}

	// an edit moves the hold at once: a smaller amount from another account, sent back as "scheduled"
	body := map[string]interface{}{"type": "transfer", "fromAccountId": "acc-c", "toAccountId": "acc-b", "amountMinor": 40000, "date": in2, "state": "scheduled"}
	if code := c.do("PUT", "/api/transactions/"+made.ID, body, nil); code != 200 {
		t.Fatalf("edit: %d", code)
	}
	c.do("GET", "/api/state", nil, &st)
	if find(st.Accounts, "acc-a").HeldMinor != 0 || find(st.Accounts, "acc-c").HeldMinor != 40000 {
		t.Fatalf("hold did not move: %+v", st.Accounts)
	}

	// post now: the date becomes today and the money moves
	var posted Transaction
	if code := c.do("POST", "/api/transactions/"+made.ID+"/post", nil, &posted); code != 200 || posted.Date != today || posted.State != "posted" {
		t.Fatalf("post now: %d %+v", code, posted)
	}
	c.do("GET", "/api/state", nil, &st)
	if cc := find(st.Accounts, "acc-c"); cc.HeldMinor != 0 || find(st.Accounts, "acc-b").BalanceMinor != b0.BalanceMinor+40000 {
		t.Fatalf("after posting: %+v", cc)
	}

	// moving it into the future again schedules it again; deleting releases it
	body["date"] = addDays(today, 1)
	var again Transaction
	if c.do("PUT", "/api/transactions/"+made.ID, body, &again); again.State != "scheduled" {
		t.Fatalf("moved to tomorrow: %+v", again)
	}
	if code := c.do("DELETE", "/api/transactions/"+made.ID, nil, nil); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	c.do("GET", "/api/state", nil, &st)
	if find(st.Accounts, "acc-c").HeldMinor != 0 {
		t.Fatalf("delete did not release the hold")
	}

	// an external account has no balance, so nothing is projected for it
	var raw struct{ Accounts []map[string]interface{} }
	c.do("GET", "/api/state", nil, &raw)
	for _, m := range raw.Accounts {
		if _, ok := m["projectedMinor"]; ok && m["kind"] == "external" {
			t.Fatalf("projected on an external account: %+v", m)
		}
	}
}

func TestScheduledOverMCP(t *testing.T) {
	t.Setenv("KISIAUTHONG_TZ", "Asia/Taipei")
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	key := createKey(t, alice, "Agent", ScopeRead, ScopeTransactions)
	anon := newClient(t, srv)
	tool := func(name string, args map[string]interface{}) map[string]interface{} {
		t.Helper()
		var out rpcResult
		code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
			"params": map[string]interface{}{"name": name, "arguments": args}}, &out,
			"Authorization", "Bearer "+key.Key, "Accept", "application/json, text/event-stream")
		if code != 200 || out.Error != nil || out.Result.IsError {
			t.Fatalf("%s: %d %+v %+v", name, code, out.Error, out.Result.Content)
		}
		return out.Result.Structured
	}
	today := todayAt(time.Now(), "Asia/Taipei")
	next := addDays(today, 40) // next month or later: still listed
	added := tool("add_transaction", map[string]interface{}{"kind": "spending", "amount": "250", "accountId": "acc-b", "date": next})["transaction"].(map[string]interface{})
	if added["state"] != "scheduled" {
		t.Fatalf("a future date is scheduled: %+v", added)
	}
	list := tool("list_transactions", map[string]interface{}{"state": "scheduled"})
	if list["total"].(float64) != 1 {
		t.Fatalf("scheduled filter: %+v", list)
	}
	if n := tool("list_transactions", map[string]interface{}{"state": "posted", "from": next})["total"].(float64); n != 0 {
		t.Fatalf("a scheduled row is not listed as posted: %v", n)
	}
	var bankB map[string]interface{}
	for _, a := range tool("list_accounts", nil)["accounts"].([]interface{}) {
		if m := a.(map[string]interface{}); m["id"] == "acc-b" {
			bankB = m
		}
	}
	amt := func(k string) float64 { return bankB[k].(map[string]interface{})["amountMinor"].(float64) }
	if amt("held") != 25000 || amt("free") != amt("balance")-amt("reserved")-25000 || amt("projected") != amt("balance")-25000 || amt("incoming") != 0 {
		t.Fatalf("list_accounts: %+v", bankB)
	}
	upd := tool("update_transaction", map[string]interface{}{"id": added["id"], "state": "posted"})["transaction"].(map[string]interface{})
	if upd["state"] != "posted" || upd["date"] != today {
		t.Fatalf("posting a scheduled transaction now: %+v", upd)
	}
	if n := tool("list_transactions", map[string]interface{}{"state": "scheduled"})["total"].(float64); n != 0 {
		t.Fatalf("still scheduled: %v", n)
	}

	// a future-dated planned row posts now too, as over HTTP: it is not left scheduled
	planned := tool("add_transaction", map[string]interface{}{"kind": "spending", "amount": "80", "accountId": "acc-b", "date": next, "state": "planned"})["transaction"].(map[string]interface{})
	if planned["state"] != "planned" {
		t.Fatalf("planned: %+v", planned)
	}
	upd = tool("update_transaction", map[string]interface{}{"id": planned["id"], "state": "posted"})["transaction"].(map[string]interface{})
	if upd["state"] != "posted" || upd["date"] != today {
		t.Fatalf("posting a future planned transaction now: %+v", upd)
	}
}

func addDays(iso string, n int) string { return fmtDate(parseDate(iso).AddDate(0, 0, n)) }
