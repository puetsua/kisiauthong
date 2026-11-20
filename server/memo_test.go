// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// Accounts and tags carry the user's own free-text note (issue #42): trimmed,
// at most 4000 characters like a transaction note, kept per user, exported,
// restored by a merge undo, and added to older databases by migration 16.

func TestAccountAndTagNotes(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	addTestUser(t, s, "bob", false)
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")

	// an own account: the note is trimmed and kept, line breaks included
	var a Account
	if code := alice.do("POST", "/api/accounts", map[string]interface{}{"name": "Bank", "kind": "own", "currency": "TWD",
		"memo": "  Ends in 0000 (fake)\nPayday on the 5th  "}, &a); code != 201 || a.Memo != "Ends in 0000 (fake)\nPayday on the 5th" {
		t.Fatalf("create account: %d %+v", code, a)
	}
	// 4000 characters (CJK, so more bytes than characters) fit; 4001 do not
	long := strings.Repeat("備", maxMemoRunes)
	var full Account
	if code := alice.do("PUT", "/api/accounts/"+a.ID, map[string]interface{}{"name": "Bank", "kind": "own", "currency": "TWD", "memo": long}, &full); code != 200 || full.Memo != long {
		t.Fatalf("4000 characters: %d", code)
	}
	if code := alice.do("PUT", "/api/accounts/"+a.ID, map[string]interface{}{"name": "Bank", "kind": "own", "currency": "TWD", "memo": long + "註"}, nil); code != 400 {
		t.Fatalf("4001 characters: %d", code)
	}
	if code := alice.do("POST", "/api/accounts", map[string]interface{}{"name": "Too long", "kind": "own", "currency": "TWD", "memo": long + "x"}, nil); code != 400 {
		t.Fatalf("create with 4001 characters: %d", code)
	}
	// PUT replaces the account: a body without a note clears it, as for its other optional fields
	var cleared Account
	if code := alice.do("PUT", "/api/accounts/"+a.ID, map[string]interface{}{"name": "Bank", "kind": "own", "currency": "TWD", "memo": "   "}, &cleared); code != 200 || cleared.Memo != "" {
		t.Fatalf("blank note: %d, %d characters left", code, len([]rune(cleared.Memo)))
	}
	alice.do("PUT", "/api/accounts/"+a.ID, map[string]interface{}{"name": "Bank", "kind": "own", "currency": "TWD", "memo": "Ends in 0000 (fake)"}, &a)

	// an external account keeps its note, even though its currency and balance are cleared
	var ext Account
	if code := alice.do("POST", "/api/accounts", map[string]interface{}{"name": "Employer", "kind": "external", "currency": "TWD", "openingBalanceMinor": 5, "memo": "Pays on the 5th"}, &ext); code != 201 || ext.Memo != "Pays on the 5th" || ext.Currency != "" {
		t.Fatalf("external account: %d %+v", code, ext)
	}

	// a category and a budget
	var cat, bud Tag
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Food", "memo": " Includes delivery apps "}, &cat); code != 201 || cat.Memo != "Includes delivery apps" {
		t.Fatalf("create category: %d %+v", code, cat)
	}
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Fun", "currency": "TWD", "limitMinor": 100000, "cycle": "monthly", "memo": "Movies and games"}, &bud); code != 201 || bud.Memo != "Movies and games" {
		t.Fatalf("create budget: %d %+v", code, bud)
	}
	if code := alice.do("PUT", "/api/tags/"+cat.ID, map[string]interface{}{"name": "Food", "memo": long + "x"}, nil); code != 400 {
		t.Fatalf("tag note too long: %d", code)
	}
	// turning the budget into a category keeps the note that is sent along
	var fun Tag
	if code := alice.do("PUT", "/api/tags/"+bud.ID, map[string]interface{}{"name": "Fun", "memo": "Movies and games"}, &fun); code != 200 || fun.Memo != "Movies and games" || fun.LimitMinor != nil {
		t.Fatalf("budget to category: %d %+v", code, fun)
	}

	// the state and the export carry the notes; bob sees none of them
	var st struct {
		Accounts []Account `json:"accounts"`
		Tags     []Tag     `json:"tags"`
	}
	alice.do("GET", "/api/state", nil, &st)
	notes := map[string]string{}
	for _, x := range st.Accounts {
		notes[x.Name] = x.Memo
	}
	for _, x := range st.Tags {
		notes[x.Name] = x.Memo
	}
	if notes["Bank"] != "Ends in 0000 (fake)" || notes["Employer"] != "Pays on the 5th" || notes["Food"] != "Includes delivery apps" || notes["Fun"] != "Movies and games" {
		t.Fatalf("state: %v", notes)
	}
	var exp Data
	if code := alice.do("GET", "/api/export", nil, &exp); code != 200 {
		t.Fatalf("export: %d", code)
	}
	if acc := exp.accountByID(a.ID); acc == nil || acc.Memo != "Ends in 0000 (fake)" {
		t.Fatalf("export account: %+v", acc)
	}
	if tg := exp.tagByID(cat.ID); tg == nil || tg.Memo != "Includes delivery apps" {
		t.Fatalf("export tag: %+v", tg)
	}
	var bobExp map[string]interface{}
	bob.do("GET", "/api/export", nil, &bobExp)
	if js, _ := json.Marshal(bobExp); strings.Contains(string(js), "0000 (fake)") || strings.Contains(string(js), "delivery apps") {
		t.Fatalf("bob sees alice's notes")
	}
	if code := bob.do("PUT", "/api/accounts/"+a.ID, map[string]interface{}{"name": "Mine", "kind": "own", "currency": "TWD", "memo": "x"}, nil); code != 404 {
		t.Fatalf("bob edits alice's account: %d", code)
	}

	// merging Fun into Food deletes Fun; undo brings it back with its note, and Food keeps its own
	var p MergePreview
	if code := alice.do("POST", "/api/tags/"+cat.ID+"/merge", map[string]interface{}{"sourceIds": []string{bud.ID}}, &p); code != 200 || p.MergeID == "" {
		t.Fatalf("merge: %d %+v", code, p)
	}
	if code := alice.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 200 {
		t.Fatalf("undo: %d", code)
	}
	alice.do("GET", "/api/state", nil, &st)
	for _, x := range st.Tags {
		notes[x.Name] = x.Memo
	}
	if notes["Fun"] != "Movies and games" || notes["Food"] != "Includes delivery apps" {
		t.Fatalf("after undo: %v", notes)
	}
}

func TestMigrationAddsAccountAndTagNotes(t *testing.T) {
	s := openTestStore(t)
	b := addTestUser(t, s, "alice", true)
	path := s.path
	// make it a database from before migration 16
	for _, q := range []string{`ALTER TABLE accounts DROP COLUMN memo`, `ALTER TABLE tags DROP COLUMN memo`, `PRAGMA user_version = 15`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	nAcc, nTag := len(b.data.Accounts), len(b.data.Tags)
	s.db.Close()

	s2, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.db.Close()
	var v int
	if err := s2.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil || v != len(migrations) || v < 16 {
		t.Fatalf("user_version = %d, %v", v, err)
	}
	b2, err := s2.book("usr-alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(b2.data.Accounts) != nAcc || len(b2.data.Tags) != nTag {
		t.Fatalf("rows lost: %d/%d accounts, %d/%d tags", len(b2.data.Accounts), nAcc, len(b2.data.Tags), nTag)
	}
	for _, a := range b2.data.Accounts {
		if a.Memo != "" {
			t.Fatalf("account %s: note %q after migration", a.ID, a.Memo)
		}
	}
	a := b2.data.Accounts[0]
	a.Memo = "after the upgrade"
	if err := b2.updateAccount(a); err != nil || b2.data.accountByID(a.ID).Memo != "after the upgrade" {
		t.Fatalf("note on an upgraded database: %v", err)
	}
}

func TestMCPAccountAndTagNotes(t *testing.T) {
	s := openTestStore(t)
	b := addTestUser(t, s, "alice", false)
	if _, err := toolCreateAccount(b, json.RawMessage(`{"name":"Cash","currency":"TWD","note":"  In the drawer  "}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := toolCreateAccount(b, json.RawMessage(`{"name":"Landlord","external":true,"note":"Rent on the 1st"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := toolCreateTag(b, json.RawMessage(`{"name":"Pets","note":"Food and vet"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := toolCreateTag(b, json.RawMessage(`{"name":"Long","note":"`+strings.Repeat("x", maxMemoRunes+1)+`"}`)); err == nil {
		t.Fatal("a note over 4000 characters was accepted")
	}
	out, err := toolListAccounts(b, nil)
	if err != nil {
		t.Fatal(err)
	}
	js, _ := json.Marshal(out)
	if !strings.Contains(string(js), `"note":"In the drawer"`) || !strings.Contains(string(js), `"note":"Rent on the 1st"`) {
		t.Fatalf("list_accounts: %s", js)
	}
	out, err = toolListTags(b, nil)
	if err != nil {
		t.Fatal(err)
	}
	js, _ = json.Marshal(out)
	if !strings.Contains(string(js), `"note":"Food and vet"`) {
		t.Fatalf("list_tags: %s", js)
	}
	if strings.Count(string(js), `"note"`) != 1 {
		t.Fatalf("tags without a note should have no note key: %s", js)
	}
}
