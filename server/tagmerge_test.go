// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
)

func i64(v int64) *int64 { return &v }

// mergeBook is a made-up book for merge tests: lunch tags spelled four ways, two with
// budgets, a transport budget, transactions with one or two of them, a template using
// two, a dashboard widget picking some, and dismissed budget notifications.
func mergeBook(t *testing.T) *Book {
	t.Helper()
	b := addTestUser(t, openTestStore(t), "alice", false)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(b.insertAccount(Account{ID: "acc-x", Name: "Wallet", Kind: "own", Currency: "TWD"}))
	for _, tg := range []Tag{
		{ID: "t-lunch", Name: "Lunch"},
		{ID: "t-lunch2", Name: "lunch", LimitMinor: i64(300000), Currency: "TWD", Cycle: "monthly"},
		{ID: "t-lunch3", Name: "Lunch ", LimitMinor: i64(500000), Currency: "TWD", Cycle: "weekly", CycleEvery: 2, CycleStart: "2026-01-05"},
		{ID: "t-lunch4", Name: "午餐"},
		{ID: "t-bus", Name: "Bus", LimitMinor: i64(100000), Currency: "TWD", Cycle: "monthly"},
		{ID: "t-other", Name: "Other"},
	} {
		must(b.insertTag(tg))
	}
	must(b.reload())
	add := func(id string, tags ...string) {
		t.Helper()
		x := Transaction{ID: id, Type: "expense", State: "posted", AccountID: "acc-x", AmountMinor: 10000, Date: "2026-03-01", TagIDs: tags}
		must(b.data.normalizeTransaction(&x))
		must(b.insertTransaction(x))
		for _, tg := range x.TagIDs {
			must(b.linkTag(x.ID, tg))
		}
	}
	add("x1", "t-lunch")
	add("x2", "t-lunch2")
	add("x3", "t-other", "t-lunch2", "t-lunch") // two merged tags: ends with the target once, in place
	add("x4", "t-lunch4", "t-other")
	add("x5", "t-bus")
	add("x6")
	must(b.insertTemplate(TransactionTemplate{ID: "tp1", Name: "Office lunch", Enabled: true,
		Template: TemplateBody{Type: "transfer", FromAccountID: "acc-x", ToAccountID: ExternalAccountID, AmountMinor: 12000, Currency: "TWD", TagIDs: []string{"t-lunch4", "t-lunch2", "t-other"}},
		Schedule: Schedule{Frequency: "monthly", Interval: 1, DayOfMonth: 5, StartDate: "2026-01-05"}}))
	must(b.insertTemplate(TransactionTemplate{ID: "tp2", Name: "Bus pass", Enabled: true,
		Template: TemplateBody{Type: "transfer", FromAccountID: "acc-x", ToAccountID: ExternalAccountID, AmountMinor: 1200, Currency: "TWD", TagIDs: []string{"t-bus"}},
		Schedule: Schedule{Frequency: "monthly", Interval: 1, DayOfMonth: 1, StartDate: "2026-01-01"}}))
	must(b.saveJSONSetting("dashboard", DashboardSettings{Items: []WidgetItem{
		{ID: "budgets", Type: "budgets", WidgetOptions: WidgetOptions{Include: []string{"t-lunch2", "t-bus", "t-lunch3"}}},
		{ID: "spending", Type: "spending"},
		{ID: "acc", Type: "accounts", WidgetOptions: WidgetOptions{Include: []string{"acc-x"}}},
	}}))
	must(b.saveJSONSetting("notifications", NotificationSettings{Dismissed: []string{
		"budget-over:t-lunch2:2026-03-01", "budget-near:t-lunch3:2026-03-02", "budget-over:t-bus:2026-03-01", "other:t-lunch2:x"}}))
	must(b.reload())
	return b
}

// snapshot is everything a merge may touch, for comparing before and after.
type bookSnapshot struct {
	Tags      []Tag
	Links     map[string][]string
	Templates map[string]string
	Settings  map[string]string
}

func snap(t *testing.T, b *Book) bookSnapshot {
	t.Helper()
	s := bookSnapshot{Tags: slices.Clone(b.data.Tags), Links: map[string][]string{}, Templates: map[string]string{}, Settings: map[string]string{}}
	for _, x := range b.data.Transactions {
		s.Links[x.ID] = x.TagIDs
	}
	q := func(sqlText string, into map[string]string) {
		rows, err := b.s.db.Query(sqlText, b.uid)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err != nil {
				t.Fatal(err)
			}
			into[k] = v
		}
	}
	q(`SELECT id,template_json FROM transaction_templates WHERE user_id=?`, s.Templates)
	q(`SELECT key,value FROM settings WHERE user_id=?`, s.Settings)
	return s
}

func sameSnap(a, b bookSnapshot) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

func mergeCode(err error) int {
	var me *mergeError
	if errors.As(err, &me) {
		return me.code
	}
	return 0
}

func TestMergeTags(t *testing.T) {
	b := mergeBook(t)
	before := snap(t, b)
	name := "Lunch (all)"
	req := MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch4"}, Name: &name}

	// dryRun reports and changes nothing
	req.DryRun = true
	p, err := b.mergeTags("t-lunch", req)
	if err != nil {
		t.Fatal(err)
	}
	if p.Transactions != 4 || p.AffectedTransactions != 3 || p.DuplicateLinks != 1 || p.Tag.Name != name ||
		!slices.Equal(p.Templates, []string{"tp1"}) || !slices.Equal(p.Widgets, []string{"budgets"}) || p.DroppedKeys != 1 ||
		p.Budget.Outcome != "source" || p.Budget.From != "t-lunch2" || p.MergeID != "" || len(p.Conflicts) != 0 {
		t.Fatalf("preview: %+v", p)
	}
	if !sameSnap(before, snap(t, b)) {
		t.Fatal("dryRun changed the book")
	}

	// the merge
	req.DryRun = false
	p, err = b.mergeTags("t-lunch", req)
	if err != nil {
		t.Fatal(err)
	}
	if p.MergeID == "" {
		t.Fatal("no merge id")
	}
	d := b.data
	if d.tagByID("t-lunch2") != nil || d.tagByID("t-lunch4") != nil {
		t.Fatal("sources not deleted")
	}
	tg := d.tagByID("t-lunch")
	// the lone source budget moved to the target, every field of it
	if tg.Name != name || tg.LimitMinor == nil || *tg.LimitMinor != 300000 || tg.Currency != "TWD" || tg.Cycle != "monthly" {
		t.Fatalf("target: %+v", tg)
	}
	want := map[string][]string{"x1": {"t-lunch"}, "x2": {"t-lunch"}, "x3": {"t-other", "t-lunch"}, "x4": {"t-lunch", "t-other"}, "x5": {"t-bus"}, "x6": nil}
	for id, w := range want {
		if got := d.transactionByID(id).TagIDs; !slices.Equal(got, w) {
			t.Fatalf("%s: %v, want %v", id, got, w)
		}
	}
	var n int
	b.s.db.QueryRow(`SELECT count(*) FROM transaction_tags WHERE user_id=? AND transaction_id='x3'`, b.uid).Scan(&n)
	if n != 2 {
		t.Fatalf("x3 has %d links", n)
	}
	for _, tp := range d.TransactionTemplates {
		if tp.ID == "tp1" && !slices.Equal(tp.Template.TagIDs, []string{"t-lunch", "t-other"}) {
			t.Fatalf("template: %v", tp.Template.TagIDs)
		}
	}
	set, err := b.loadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if inc := set.Dashboard.Items[0].Include; !slices.Equal(inc, []string{"t-lunch", "t-bus", "t-lunch3"}) {
		t.Fatalf("widget include: %v", inc)
	}
	if !slices.Equal(set.Dashboard.Items[2].Include, []string{"acc-x"}) {
		t.Fatalf("other widget touched: %v", set.Dashboard.Items[2].Include)
	}
	if dis := set.Notifications.Dismissed; !slices.Equal(dis, []string{"budget-near:t-lunch3:2026-03-02", "budget-over:t-bus:2026-03-01", "other:t-lunch2:x"}) {
		t.Fatalf("dismissed: %v", dis)
	}

	// undo puts every row back, then refuses a second time
	if _, err := b.undoMerge(p.MergeID); err != nil {
		t.Fatal(err)
	}
	after := snap(t, b)
	// the stored dashboard is rewritten in the current shape; compare it as settings
	if !slices.EqualFunc(before.Tags, after.Tags, func(x, y Tag) bool { return sameTag(x, y) }) {
		t.Fatalf("tags: %+v", after.Tags)
	}
	for id, l := range before.Links {
		if !slices.Equal(after.Links[id], l) {
			t.Fatalf("links of %s: %v, want %v", id, after.Links[id], l)
		}
	}
	for id, js := range before.Templates {
		if after.Templates[id] != js {
			t.Fatalf("template %s: %s", id, after.Templates[id])
		}
	}
	set, _ = b.loadSettings()
	if inc := set.Dashboard.Items[0].Include; !slices.Equal(inc, []string{"t-lunch2", "t-bus", "t-lunch3"}) {
		t.Fatalf("widget after undo: %v", inc)
	}
	if dis := set.Notifications.Dismissed; len(dis) != 4 || !slices.Contains(dis, "budget-over:t-lunch2:2026-03-01") {
		t.Fatalf("dismissed after undo: %v", dis)
	}
	if _, err := b.undoMerge(p.MergeID); mergeCode(err) != 409 {
		t.Fatalf("double undo: %v", err)
	}
	if _, err := b.undoMerge("merge-nope"); mergeCode(err) != 404 {
		t.Fatalf("unknown merge: %v", err)
	}
	// a fresh load from the database agrees with the in-memory book
	delete(b.s.books, b.uid)
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(b.data.transactionByID("x3").TagIDs, []string{"t-other", "t-lunch2", "t-lunch"}) {
		t.Fatalf("reloaded x3: %v", b.data.transactionByID("x3").TagIDs)
	}
}

func TestMergeBudgets(t *testing.T) {
	// the target's own budget wins over the sources'
	b := mergeBook(t)
	p, err := b.mergeTags("t-bus", MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch3"}})
	if err != nil {
		t.Fatal(err)
	}
	if p.Budget.Outcome != "target" || *b.data.tagByID("t-bus").LimitMinor != 100000 {
		t.Fatalf("target wins: %+v %+v", p.Budget, b.data.tagByID("t-bus"))
	}

	// no budget anywhere: none
	b = mergeBook(t)
	if p, err := b.mergeTags("t-lunch", MergeRequest{SourceIDs: []string{"t-lunch4"}}); err != nil || p.Budget.Outcome != "none" || b.data.tagByID("t-lunch").LimitMinor != nil {
		t.Fatalf("none: %v %+v", err, p)
	}

	// two sources with budgets and none on the target: the caller must choose
	b = mergeBook(t)
	before := snap(t, b)
	req := MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch3"}, DryRun: true}
	p, err = b.mergeTags("t-lunch", req)
	if err != nil || p.Budget.Outcome != "choose" || !slices.Equal(p.Budget.Candidates, []string{"t-lunch2", "t-lunch3"}) || !slices.Equal(p.Conflicts, []string{"budget-choice"}) {
		t.Fatalf("dry run conflict: %v %+v", err, p)
	}
	req.DryRun = false
	if _, err := b.mergeTags("t-lunch", req); mergeCode(err) != 409 || !strings.Contains(err.Error(), "budgetFrom") {
		t.Fatalf("no choice: %v", err)
	}
	for _, bad := range []string{"t-lunch4", "t-other", "bogus"} {
		req.BudgetFrom = bad
		if _, err := b.mergeTags("t-lunch", req); mergeCode(err) != 400 {
			t.Fatalf("budgetFrom %s: %v", bad, err)
		}
	}
	if !sameSnap(before, snap(t, b)) {
		t.Fatal("a refused merge changed the book")
	}
	req.BudgetFrom = "t-lunch3"
	if p, err = b.mergeTags("t-lunch", req); err != nil {
		t.Fatal(err)
	}
	tg := b.data.tagByID("t-lunch")
	if p.Budget.Outcome != "source" || *tg.LimitMinor != 500000 || tg.Cycle != "weekly" || tg.CycleEvery != 2 || tg.CycleStart != "2026-01-05" {
		t.Fatalf("chosen budget: %+v", tg)
	}
	if _, err := b.undoMerge(p.MergeID); err != nil {
		t.Fatal(err)
	}
	if tg := b.data.tagByID("t-lunch"); tg.LimitMinor != nil || tg.Cycle != "" {
		t.Fatalf("undo kept the budget: %+v", tg)
	}
	// or explicitly none
	if p, err = b.mergeTags("t-lunch", MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch3"}, BudgetFrom: BudgetNone}); err != nil || p.Budget.Outcome != "none" || b.data.tagByID("t-lunch").LimitMinor != nil {
		t.Fatalf("none chosen: %v %+v", err, p)
	}
}

func TestMergeValidation(t *testing.T) {
	b := mergeBook(t)
	before := snap(t, b)
	empty := ""
	for _, c := range []struct {
		target string
		req    MergeRequest
		code   int
	}{
		{"t-nope", MergeRequest{SourceIDs: []string{"t-lunch2"}}, 404},
		{"t-lunch", MergeRequest{}, 400},
		{"t-lunch", MergeRequest{SourceIDs: []string{"t-lunch"}}, 400},
		{"t-lunch", MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch2"}}, 400},
		{"t-lunch", MergeRequest{SourceIDs: []string{"t-nope"}}, 404},
		{"t-lunch", MergeRequest{SourceIDs: []string{"t-lunch2"}, Name: &empty}, 400},
	} {
		for _, dry := range []bool{true, false} {
			c.req.DryRun = dry
			if _, err := b.mergeTags(c.target, c.req); mergeCode(err) != c.code {
				t.Fatalf("%s %+v: %v, want %d", c.target, c.req, err, c.code)
			}
		}
	}
	if !sameSnap(before, snap(t, b)) {
		t.Fatal("a refused merge changed the book")
	}
}

// A failure anywhere inside the merge leaves the book as it was.
func TestMergeAtomic(t *testing.T) {
	b := mergeBook(t)
	before := snap(t, b)
	tagMergeTestHook = func(*sql.Tx) error { return errors.New("disk full") }
	defer func() { tagMergeTestHook = nil }()
	if _, err := b.mergeTags("t-lunch", MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch4"}}); err == nil {
		t.Fatal("merge did not fail")
	}
	delete(b.s.books, b.uid)
	if err := b.reload(); err != nil {
		t.Fatal(err)
	}
	if !sameSnap(before, snap(t, b)) {
		t.Fatal("a failed merge left changes behind")
	}
	var n int
	b.s.db.QueryRow(`SELECT count(*) FROM tag_merges`).Scan(&n)
	if n != 0 {
		t.Fatalf("merge log kept: %d", n)
	}
}

// Undo refuses, changing nothing, once what the merge left was changed.
func TestMergeUndoRefusesAfterEdits(t *testing.T) {
	merge := func(t *testing.T) (*Book, string) {
		b := mergeBook(t)
		p, err := b.mergeTags("t-lunch", MergeRequest{SourceIDs: []string{"t-lunch2", "t-lunch4"}})
		if err != nil {
			t.Fatal(err)
		}
		return b, p.MergeID
	}
	for name, edit := range map[string]func(t *testing.T, b *Book){
		"target renamed": func(t *testing.T, b *Book) {
			tg := *b.data.tagByID("t-lunch")
			tg.Name = "Food"
			if err := b.updateTag(tg); err != nil {
				t.Fatal(err)
			}
		},
		"transaction recategorised": func(t *testing.T, b *Book) {
			x := *b.data.transactionByID("x3")
			x.TagIDs = []string{"t-lunch"}
			if err := b.updateTransaction(x); err != nil {
				t.Fatal(err)
			}
		},
		"transaction deleted": func(t *testing.T, b *Book) {
			if _, err := b.deleteTransaction("x2"); err != nil {
				t.Fatal(err)
			}
		},
		"new transaction on the target": func(t *testing.T, b *Book) {
			if _, err := b.addTransaction(Transaction{Type: "expense", AccountID: "acc-x", AmountMinor: 5, Date: "2026-03-02", TagIDs: []string{"t-lunch"}}); err != nil {
				t.Fatal(err)
			}
		},
		"template edited": func(t *testing.T, b *Book) {
			for _, tp := range b.data.TransactionTemplates {
				if tp.ID == "tp1" {
					tp.Template.AmountMinor = 13000
					if err := b.updateTemplate(tp); err != nil {
						t.Fatal(err)
					}
				}
			}
		},
		"merged again": func(t *testing.T, b *Book) {
			if _, err := b.mergeTags("t-other", MergeRequest{SourceIDs: []string{"t-lunch"}}); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			b, id := merge(t)
			edit(t, b)
			before := snap(t, b)
			if _, err := b.undoMerge(id); mergeCode(err) != 409 {
				t.Fatalf("undo: %v", err)
			}
			if !sameSnap(before, snap(t, b)) {
				t.Fatal("a refused undo changed the book")
			}
		})
	}
	// edits the merge did not touch do not block it; a widget the user changed since is left alone
	t.Run("unrelated edits", func(t *testing.T) {
		b, id := merge(t)
		if _, err := b.deleteTransaction("x5"); err != nil {
			t.Fatal(err)
		}
		set, _ := b.loadSettings()
		set.Dashboard.Items[0].Include = []string{"t-bus"}
		if err := b.saveJSONSetting("dashboard", set.Dashboard); err != nil {
			t.Fatal(err)
		}
		if _, err := b.undoMerge(id); err != nil {
			t.Fatal(err)
		}
		set, _ = b.loadSettings()
		if !slices.Equal(set.Dashboard.Items[0].Include, []string{"t-bus"}) {
			t.Fatalf("user's widget overwritten: %v", set.Dashboard.Items[0].Include)
		}
		if b.data.tagByID("t-lunch2") == nil {
			t.Fatal("not undone")
		}
	})
}

func TestMergeAPI(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", true)
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")

	var p MergePreview
	body := map[string]interface{}{"sourceIds": []string{"tag-fun", "tag-transport"}, "dryRun": true}
	if code := alice.do("POST", "/api/tags/tag-food/merge", body, &p); code != 200 || p.Budget.Outcome != "target" || p.MergeID != "" {
		t.Fatalf("dry run: %d %+v", code, p)
	}
	if code := alice.do("POST", "/api/tags/tag-food/merge", map[string]interface{}{"sourceIds": []string{"tag-fun"}, "bogus": 1}, nil); code != 400 {
		t.Fatalf("unknown field: %d", code)
	}
	if code := alice.do("GET", "/api/tags/tag-food/merge", nil, nil); code != 404 {
		t.Fatalf("GET merge: %d", code)
	}
	body["dryRun"] = false
	if code := alice.do("POST", "/api/tags/tag-food/merge", body, &p); code != 200 || p.MergeID == "" {
		t.Fatalf("merge: %d %+v", code, p)
	}
	// bob's books are his own: same ids, untouched, and he cannot undo alice's merge
	var st map[string]interface{}
	bob.do("GET", "/api/state", nil, &st)
	if n := len(st["tags"].([]interface{})); n != 5 {
		t.Fatalf("bob's tags: %d", n)
	}
	if code := bob.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 404 {
		t.Fatalf("bob undoes alice's merge: %d", code)
	}
	if code := alice.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 200 {
		t.Fatalf("undo: %d", code)
	}
	if code := alice.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 409 {
		t.Fatalf("double undo: %d", code)
	}
	if code := alice.do("GET", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 405 {
		t.Fatalf("GET undo: %d", code)
	}

	// API keys: tags:write merges, read alone may not
	reader := createKey(t, alice, "Reader", ScopeRead)
	tagger := createKey(t, alice, "Tagger", ScopeRead, ScopeTags)
	anon := newClient(t, srv)
	if code := anon.do("POST", "/api/tags/tag-food/merge", body, nil, "Authorization", "Bearer "+reader.Key); code != 403 {
		t.Fatalf("reader merges: %d", code)
	}
	if code := anon.do("POST", "/api/tags/tag-food/merge", body, &p, "Authorization", "Bearer "+tagger.Key); code != 200 {
		t.Fatalf("tagger merges: %d", code)
	}
	if code := anon.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil, "Authorization", "Bearer "+reader.Key); code != 403 {
		t.Fatalf("reader undoes: %d", code)
	}
}

func TestMCPMergeTags(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	reader := createKey(t, alice, "Reader", ScopeRead)
	tagger := createKey(t, alice, "Tagger", ScopeRead, ScopeTags)
	anon := newClient(t, srv)
	call := func(k newKey, method string, params interface{}) rpcResult {
		t.Helper()
		var out rpcResult
		if code := anon.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, &out,
			"Authorization", "Bearer "+k.Key, "Accept", "application/json, text/event-stream"); code != 200 || out.Error != nil {
			t.Fatalf("%s: %d %+v", method, code, out.Error)
		}
		return out
	}
	listed := func(k newKey) bool {
		for _, tl := range call(k, "tools/list", nil).Result.Tools {
			if tl["name"] == "merge_tags" {
				return true
			}
		}
		return false
	}
	if listed(reader) || !listed(tagger) {
		t.Fatal("merge_tags does not follow the tags:write scope")
	}
	merge := func(k newKey, args map[string]interface{}) rpcResult {
		return call(k, "tools/call", map[string]interface{}{"name": "merge_tags", "arguments": args})
	}
	if out := merge(reader, map[string]interface{}{"targetId": "tag-food", "sourceIds": []string{"tag-fun"}}); !out.Result.IsError || !strings.Contains(out.Result.Content[0].Text, "tags:write") {
		t.Fatalf("reader merged: %+v", out.Result)
	}
	// two sources with budgets on a target without one: dry run shows the choice, a merge without it is refused
	out := merge(tagger, map[string]interface{}{"targetId": "tag-housing", "sourceIds": []string{"tag-fun", "tag-transport"}, "dryRun": true})
	if out.Result.IsError || out.Result.Structured["budget"].(map[string]interface{})["outcome"] != "choose" || out.Result.Structured["dryRun"] != true {
		t.Fatalf("dry run: %+v", out.Result)
	}
	if out := merge(tagger, map[string]interface{}{"targetId": "tag-housing", "sourceIds": []string{"tag-fun", "tag-transport"}}); !out.Result.IsError || !strings.Contains(out.Result.Content[0].Text, "budgetFrom") {
		t.Fatalf("merge without a choice: %+v", out.Result)
	}
	out = merge(tagger, map[string]interface{}{"targetId": "tag-housing", "sourceIds": []string{"tag-fun", "tag-transport"}, "budgetFrom": "tag-fun", "name": "Home & fun"})
	if out.Result.IsError || out.Result.Structured["mergeId"] == "" {
		t.Fatalf("merge: %+v", out.Result)
	}
	tags := call(tagger, "tools/call", map[string]interface{}{"name": "list_tags", "arguments": map[string]interface{}{}}).Result.Content[0].Text
	if strings.Contains(tags, "Entertainment") || !strings.Contains(tags, `Home \u0026 fun`) {
		t.Fatalf("tags after merge: %s", tags)
	}
}
