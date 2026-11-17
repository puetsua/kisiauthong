// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestManualTransactionsDoNotCollideOnTemplateKey(t *testing.T) {
	b := sampleBook(t)
	// seed already contains several manual transactions; adding two more must succeed
	for _, id := range []string{"manual-1", "manual-2"} {
		tx := Transaction{ID: id, FromAccountID: "acc-a", ToAccountID: ExternalAccountID, Type: "transfer", State: "posted", AmountMinor: 100, Currency: "TWD", Date: "2026-10-20", Note: "manual"}
		if err := b.insertTransaction(tx); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	// a duplicate generated occurrence must be rejected
	dup := Transaction{ID: "dup-1", FromAccountID: "acc-a", ToAccountID: ExternalAccountID, Type: "transfer", State: "planned", AmountMinor: 100, Currency: "TWD", Date: "2026-10-12", TransactionTemplateID: "tpl-streaming", OccurrenceDate: "2026-10-12"}
	if err := b.insertTransaction(dup); err == nil {
		t.Fatalf("duplicate generated occurrence was accepted")
	}
}

func TestSettingsPersist(t *testing.T) {
	b := sampleBook(t)
	if _, ok, _ := b.getSetting("dashboard"); ok {
		t.Fatalf("dashboard setting should start unset")
	}
	want := `{"order":["reserves","balances"],"hidden":["recent"]}`
	if err := b.setSetting("dashboard", want); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, ok, err := b.getSetting("dashboard")
	if err != nil || !ok || got != want {
		t.Fatalf("get = %q ok=%v err=%v, want %q", got, ok, err, want)
	}
	if err := b.setSetting("dashboard", `{"order":[],"hidden":[]}`); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _, _ = b.getSetting("dashboard")
	if got != `{"order":[],"hidden":[]}` {
		t.Fatalf("overwrite not stored: %q", got)
	}
}

func TestUpdatesPersist(t *testing.T) {
	b := sampleBook(t)
	a := b.data.Accounts[0]
	a.Name = "Renamed account"
	if err := b.updateAccount(a); err != nil {
		t.Fatalf("update account: %v", err)
	}
	if got := b.data.accountByID(a.ID); got == nil || got.Name != "Renamed account" {
		t.Fatalf("account not updated: %+v", got)
	}

	tag := b.data.Tags[0]
	tag.Name = "Renamed tag"
	if err := b.updateTag(tag); err != nil {
		t.Fatalf("update tag: %v", err)
	}
	if got := b.data.tagByID(tag.ID); got == nil || got.Name != "Renamed tag" {
		t.Fatalf("tag not updated")
	}

	tx := b.data.Transactions[0]
	old := tx.AmountMinor
	tx.AmountMinor = old + 500
	tx.Note = "Edited note"
	if err := b.updateTransaction(tx); err != nil {
		t.Fatalf("update transaction: %v", err)
	}
	if got := b.data.transactionByID(tx.ID); got == nil || got.AmountMinor != old+500 || got.Note != "Edited note" {
		t.Fatalf("transaction not updated: %+v", got)
	}

	tpl := b.data.TransactionTemplates[0]
	tpl.Name = "Renamed template"
	tpl.Template.AmountMinor += 100
	if err := b.updateTemplate(tpl); err != nil {
		t.Fatalf("update template: %v", err)
	}
	if got := b.data.templateByID(tpl.ID); got == nil || got.Name != "Renamed template" {
		t.Fatalf("template not updated: %+v", got)
	}
}

// The sample data must respect the money-box invariants: no account without
// a limit below zero, and allocations never exceed an account's balance.
func TestSeedRespectsBalanceInvariants(t *testing.T) {
	d := sampleBook(t).data
	if len(d.Transactions) <= 50 {
		t.Fatalf("seed should hold more than one page of transactions, got %d", len(d.Transactions))
	}
	for _, a := range d.Accounts {
		if a.IsExternal() {
			continue // outside the books: no balance of its own
		}
		bal, reserved := d.Balance(a.ID), d.Reserved(a.ID)
		if a.LimitMinor == nil && bal < 0 {
			t.Errorf("%s balance %d < 0", a.ID, bal)
		}
		if reserved > bal {
			t.Errorf("%s reserved %d > balance %d", a.ID, reserved, bal)
		}
	}
	for _, tt := range d.TransactionTags {
		if d.transactionByID(tt.TransactionID) == nil {
			t.Errorf("tag link to unknown transaction %s", tt.TransactionID)
		}
	}
}

// Two users' books never mix, even with the same ids.
func TestBooksAreSeparatePerUser(t *testing.T) {
	s := openTestStore(t)
	alice := addTestUser(t, s, "alice", true)
	bob := addTestUser(t, s, "bob", false)
	if len(bob.data.Transactions) != 0 || len(bob.data.Accounts) != 1 || bob.data.Accounts[0].ID != ExternalAccountID {
		t.Fatalf("a new user starts with only the External account: %+v", bob.data.Accounts)
	}
	// the same id in both books
	if err := bob.insertAccount(Account{ID: "acc-a", Name: "Bob's wallet", Kind: "own", Currency: "USD"}); err != nil {
		t.Fatalf("same id for another user: %v", err)
	}
	if err := bob.reload(); err != nil {
		t.Fatal(err)
	}
	if a := alice.data.accountByID("acc-a"); a == nil || a.Name != "Savings A" {
		t.Fatalf("alice's acc-a changed: %+v", a)
	}
	if a := bob.data.accountByID("acc-a"); a == nil || a.Name != "Bob's wallet" {
		t.Fatalf("bob's acc-a: %+v", a)
	}
	// deleting in one book leaves the other alone
	victim := alice.data.Transactions[0].ID
	if found, err := bob.deleteTransaction(victim); err != nil || found {
		t.Fatalf("bob deleted alice's transaction: %v %v", found, err)
	}
	if alice.data.transactionByID(victim) == nil {
		t.Fatalf("alice lost a transaction")
	}
}

// A single-user database from before migration 1, as the very first
// version created it, upgrades through every migration to the owner's books.
func TestMigrationsUpgradeTheFirstSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, currency TEXT NOT NULL,
		  opening_balance_minor INTEGER NOT NULL DEFAULT 0, allow_negative INTEGER NOT NULL DEFAULT 0,
		  credit_limit_minor INTEGER, statement_close_day INTEGER, payment_due_day INTEGER)`,
		`CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT '', from_account_id TEXT NOT NULL DEFAULT '',
		  to_account_id TEXT NOT NULL DEFAULT '', tag_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
		  state TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, date TEXT NOT NULL,
		  note TEXT NOT NULL DEFAULT '', transaction_template_id TEXT, occurrence_date TEXT,
		  UNIQUE(transaction_template_id, occurrence_date))`,
		`CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, limit_minor INTEGER,
		  cycle TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT '', target_minor INTEGER, target_date TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE transaction_tags (transaction_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(transaction_id, tag_id))`,
		`CREATE TABLE transaction_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
		  template_json TEXT NOT NULL, schedule_json TEXT NOT NULL)`,
		`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`INSERT INTO accounts(id,name,kind,currency,opening_balance_minor) VALUES('acc-a','Savings A','savings','TWD',100000),('acc-b','Bank B','bank','TWD',50000)`,
		`INSERT INTO accounts(id,name,kind,currency,opening_balance_minor,allow_negative,credit_limit_minor) VALUES('old-card','Visa','credit_card','TWD',0,1,5000000)`,
		`INSERT INTO tags(id,name,kind,limit_minor,cycle,currency) VALUES('tag-food','Food','category',1200000,'monthly','TWD')`,
		`INSERT INTO tags(id,name,kind,currency,target_minor) VALUES('tag-furniture','Furniture','goal','TWD',8000000)`,
		`INSERT INTO tags(id,name,kind) VALUES('old-label','trip-2026','label'),('old-payee','7-Eleven','payee')`,
		`INSERT INTO transactions(id,account_id,type,state,amount_minor,currency,date,note) VALUES('old-exp','acc-b','expense','posted',500,'TWD','2026-11-01','Lunch'),('old-inc','acc-a','income','posted',900,'TWD','2026-11-02','Pay')`,
		`INSERT INTO transactions(id,account_id,tag_id,type,state,amount_minor,currency,date,note) VALUES('old-alloc','acc-a','tag-furniture','allocate','posted',2000,'TWD','2026-11-02','Save'),('old-rel','acc-a','tag-furniture','release','posted',700,'TWD','2026-11-03','Back out')`,
		`INSERT INTO transactions(id,account_id,tag_id,type,state,amount_minor,currency,date,note,transaction_template_id,occurrence_date) VALUES('old-auto','acc-b','tag-furniture','allocate','planned',300,'TWD','2026-11-05','Auto','tpl-box','2026-11-05')`,
		`INSERT INTO transactions(id,account_id,tag_id,type,state,amount_minor,currency,date,note) VALUES('old-orphan','acc-a','gone-box','allocate','posted',50,'TWD','2026-11-04','Box deleted since')`,
		`INSERT INTO transactions(id,from_account_id,to_account_id,tag_id,type,state,amount_minor,currency,date,note) VALUES('old-food','acc-b','acc-external','tag-food','transfer','posted',80,'TWD','2026-11-06','One tag field'),('old-boxcat','acc-b','acc-external','tag-furniture','transfer','posted',90,'TWD','2026-11-06','Box as category')`,
		`INSERT INTO transaction_tags(transaction_id,tag_id) VALUES('old-exp','tag-food'),('old-exp','tag-furniture'),('old-alloc','tag-food')`,
		`INSERT INTO transaction_templates(id,name,enabled,template_json,schedule_json) VALUES('tpl-salary','Salary',1,'{"accountId":"acc-a","type":"income","amountMinor":8000000,"currency":"TWD","note":"Salary"}','{"frequency":"monthly","interval":1,"dayOfMonth":5,"startDate":"2026-01-05"}')`,
		`INSERT INTO transaction_templates(id,name,enabled,template_json,schedule_json) VALUES('tpl-box','Auto save',1,'{"accountId":"acc-b","tagId":"tag-furniture","type":"allocate","amountMinor":300,"currency":"TWD"}','{"frequency":"monthly","interval":1,"dayOfMonth":5,"startDate":"2026-11-05"}')`,
		`INSERT INTO transaction_templates(id,name,enabled,template_json,schedule_json) VALUES('tpl-lunch','Lunch',1,'{"fromAccountId":"acc-b","toAccountId":"acc-external","tagId":"tag-food","type":"transfer","amountMinor":120,"currency":"TWD"}','{"frequency":"never"}')`,
		`INSERT INTO settings(key,value) VALUES('general','{"defaultCurrency":"JPY"}'),('dashboard','{"order":["moneyboxes","balances"]}')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	db.Close()

	s, err := openStore(path) // runs every migration
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil || v != len(migrations) {
		t.Errorf("user_version = %d, %v", v, err)
	}
	// migration 8: everything belongs to the owner, who still has to be claimed
	if setup, _ := s.needsSetup(); !setup {
		t.Errorf("the owner should still need setting up")
	}
	b, err := s.book(OwnerID)
	if err != nil {
		t.Fatal(err)
	}
	d := b.data
	if a := d.accountByID(ExternalAccountID); a == nil || !a.IsExternal() {
		t.Fatalf("migration 1: anonymous external account missing")
	}
	byID := map[string]Transaction{}
	for _, tx := range d.Transactions {
		byID[tx.ID] = tx
	}
	if e := byID["old-exp"]; e.Type != "transfer" || e.FromAccountID != "acc-b" || e.ToAccountID != ExternalAccountID || e.AccountID != "" {
		t.Errorf("migration 1: expense not converted: %+v", e)
	}
	if i := byID["old-inc"]; i.Type != "transfer" || i.FromAccountID != ExternalAccountID || i.ToAccountID != "acc-a" {
		t.Errorf("migration 1: income not converted: %+v", i)
	}
	if tp := d.templateByID("tpl-salary"); tp == nil || tp.Template.Type != "transfer" || tp.Template.FromAccountID != ExternalAccountID || tp.Template.ToAccountID != "acc-a" {
		t.Errorf("migration 1: template not converted: %+v", tp)
	}
	// migration 14: money boxes become reserves with the same ids, allocations leave the transactions
	if r := d.allocationByID("old-rel"); r == nil || r.AmountMinor != -700 || r.AccountID != "acc-a" || r.ReserveID != "tag-furniture" || r.Note != "Back out" {
		t.Errorf("migrations 2 and 14: release not an allocation: %+v", r)
	}
	if r := d.reserveByID("tag-furniture"); r == nil || r.Name != "Furniture" || r.Currency != "TWD" || r.TargetMinor == nil || *r.TargetMinor != 8000000 {
		t.Errorf("migration 14: money box not a reserve: %+v", r)
	}
	if d.tagByID("tag-furniture") != nil {
		t.Errorf("migration 14: the money box is still a tag")
	}
	if got := d.ReserveSaved("tag-furniture"); got != 2000-700+300 {
		t.Errorf("migration 14: saved = %d", got)
	}
	if a := d.allocationByID("old-auto"); a == nil || a.TransactionTemplateID != "tpl-box" || a.OccurrenceDate != "2026-11-05" || a.AccountID != "acc-b" {
		t.Errorf("migration 14: generated allocation keeps its template: %+v", a)
	}
	if r := d.reserveByID("gone-box"); r == nil || d.allocationByID("old-orphan") == nil {
		t.Errorf("migration 14: an allocation whose money box is gone keeps a reserve: %+v", r)
	}
	if len(d.Allocations) != 4 {
		t.Errorf("migration 14: %d allocations, want 4", len(d.Allocations))
	}
	for _, id := range []string{"old-alloc", "old-rel", "old-auto", "old-orphan"} {
		if _, ok := byID[id]; ok {
			t.Errorf("migration 14: %s is still a transaction", id)
		}
	}
	if f := byID["old-food"]; len(f.TagIDs) != 1 || f.TagIDs[0] != "tag-food" {
		t.Errorf("migration 14: the single tag field becomes a link: %+v", f)
	}
	if f := byID["old-boxcat"]; len(f.TagIDs) != 0 {
		t.Errorf("migration 14: a money box is no category: %+v", f)
	}
	if tp := d.templateByID("tpl-box"); tp == nil || tp.Template.ReserveID != "tag-furniture" || tp.Template.Type != "allocate" {
		t.Errorf("migration 14: allocation template: %+v", tp)
	}
	if tp := d.templateByID("tpl-lunch"); tp == nil || len(tp.Template.TagIDs) != 1 || tp.Template.TagIDs[0] != "tag-food" {
		t.Errorf("migration 14: template category: %+v", tp)
	}
	if v, _, _ := b.getSetting("dashboard"); v != `{"order":["reserves","balances"]}` {
		t.Errorf("migration 14: dashboard widget renamed: %q", v)
	}
	for _, id := range []string{"old-label", "old-payee"} {
		if d.tagByID(id) == nil {
			t.Errorf("migration 4: %s should be a category", id)
		}
	}
	if food := d.tagByID("tag-food"); food == nil || food.Cycle != "monthly" || food.CycleEvery != 0 || food.CycleStart != "" {
		t.Errorf("migration 5: monthly budget should keep its period: %+v", food)
	}
	for id, icon := range map[string]string{"acc-a": "savings", "old-card": "card"} {
		if a := d.accountByID(id); a == nil || a.Kind != "own" || a.Icon != icon {
			t.Errorf("migration 6: %s should be own with icon %s: %+v", id, icon, a)
		}
	}
	if a := d.accountByID("old-card"); a == nil || a.LimitMinor == nil || *a.LimitMinor != 5000000 {
		t.Errorf("migration 6: the card keeps its limit: %+v", a)
	}
	if e := byID["old-exp"]; len(e.TagIDs) != 1 || e.TagIDs[0] != "tag-food" {
		t.Errorf("migrations 8 and 14: category links kept, money box links dropped: %+v", e.TagIDs)
	}
	if len(d.TransactionTags) != 2 {
		t.Errorf("migration 14: tag links: %+v", d.TransactionTags)
	}
	if v, ok, _ := b.getSetting("general"); !ok || v != `{"defaultCurrency":"JPY"}` {
		t.Errorf("migration 8: settings kept: %q", v)
	}
	// migrations 3 and 7: memo, time and zone round-trip
	tx := byID["old-exp"]
	tx.Memo, tx.Time, tx.TZ = "Paid in cash", "08:15", "Asia/Taipei"
	if err := b.updateTransaction(tx); err != nil {
		t.Fatalf("update with memo and time: %v", err)
	}
	if got := b.data.transactionByID("old-exp"); got.Memo != "Paid in cash" || got.At != "2026-11-01T00:15:00Z" {
		t.Errorf("memo/time not stored: %+v", got)
	}
}
