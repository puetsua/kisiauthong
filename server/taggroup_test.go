// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// A tag's group orders it in tag pickers (issue #127,
// ADR 0028): optional, trimmed with its white space folded, at most 100
// characters, kept per user, exported, kept through a merge and its undo, and
// added to older databases by migration 17.

func TestTagGroups(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	addTestUser(t, s, "bob", false)
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")

	var lunch, dinner, taxi Tag
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Lunch", "group": "  Food \n and  drink "}, &lunch); code != 201 || lunch.Group != "Food and drink" {
		t.Fatalf("create with a group: %d %+v", code, lunch)
	}
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Dinner", "group": "Food and drink", "currency": "TWD", "limitMinor": 300000, "cycle": "monthly"}, &dinner); code != 201 || dinner.Group != "Food and drink" {
		t.Fatalf("a budget with a group: %d %+v", code, dinner)
	}
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Taxi"}, &taxi); code != 201 || taxi.Group != "" {
		t.Fatalf("ungrouped: %d %+v", code, taxi)
	}
	// 100 characters (CJK) fit; 101 do not
	long := strings.Repeat("組", maxTagGroupRunes)
	if code := alice.do("PUT", "/api/tags/"+taxi.ID, map[string]interface{}{"name": "Taxi", "group": long}, nil); code != 200 {
		t.Fatalf("100 characters: %d", code)
	}
	if code := alice.do("PUT", "/api/tags/"+taxi.ID, map[string]interface{}{"name": "Taxi", "group": long + "x"}, nil); code != 400 {
		t.Fatalf("101 characters: %d", code)
	}
	if code := alice.do("POST", "/api/tags", map[string]interface{}{"name": "Bus", "group": long + "x"}, nil); code != 400 {
		t.Fatalf("create with 101 characters: %d", code)
	}
	// PUT replaces the tag: a body without a group (or a blank one) makes it ungrouped again
	var cleared Tag
	if code := alice.do("PUT", "/api/tags/"+taxi.ID, map[string]interface{}{"name": "Taxi", "group": "   "}, &cleared); code != 200 || cleared.Group != "" {
		t.Fatalf("blank group: %d %+v", code, cleared)
	}
	alice.do("PUT", "/api/tags/"+taxi.ID, map[string]interface{}{"name": "Taxi", "group": "Transport"}, &taxi)

	groups := func(c *client) map[string]string {
		var st struct {
			Tags []map[string]interface{} `json:"tags"`
		}
		c.do("GET", "/api/state", nil, &st)
		out := map[string]string{}
		for _, x := range st.Tags {
			g, has := x["group"]
			if has && g == "" {
				t.Fatalf("an empty group is sent: %v", x)
			}
			out[x["name"].(string)], _ = g.(string)
		}
		return out
	}
	if g := groups(alice); g["Lunch"] != "Food and drink" || g["Dinner"] != "Food and drink" || g["Taxi"] != "Transport" {
		t.Fatalf("state: %v", g)
	}
	var exp Data
	if code := alice.do("GET", "/api/export", nil, &exp); code != 200 {
		t.Fatalf("export: %d", code)
	}
	if tg := exp.tagByID(lunch.ID); tg == nil || tg.Group != "Food and drink" {
		t.Fatalf("export: %+v", tg)
	}
	// bob neither sees nor changes alice's groups
	if g := groups(bob); len(g) != 0 && g["Lunch"] != "" {
		t.Fatalf("bob sees alice's tags: %v", g)
	}
	if code := bob.do("PUT", "/api/tags/"+lunch.ID, map[string]interface{}{"name": "Lunch", "group": "Mine"}, nil); code != 404 {
		t.Fatalf("bob edits alice's tag: %d", code)
	}

	// merging Dinner into Taxi keeps Taxi's group; undo brings Dinner back in its own group
	var p MergePreview
	if code := alice.do("POST", "/api/tags/"+taxi.ID+"/merge", map[string]interface{}{"sourceIds": []string{dinner.ID}}, &p); code != 200 || p.MergeID == "" {
		t.Fatalf("merge: %d %+v", code, p)
	}
	if g := groups(alice); g["Taxi"] != "Transport" {
		t.Fatalf("after merge: %v", g)
	}
	if code := alice.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 200 {
		t.Fatalf("undo: %d", code)
	}
	if g := groups(alice); g["Dinner"] != "Food and drink" || g["Taxi"] != "Transport" {
		t.Fatalf("after undo: %v", g)
	}
}

func TestMigrationAddsTagGroup(t *testing.T) {
	s := openTestStore(t)
	b := addTestUser(t, s, "alice", true)
	path := s.path
	// make it a database from before migration 17
	for _, q := range []string{`ALTER TABLE tags DROP COLUMN tag_group`, `PRAGMA user_version = 16`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	nTag := len(b.data.Tags)
	if nTag == 0 {
		t.Fatal("the seeded book has no tags to carry over")
	}
	s.db.Close()

	s2, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.db.Close()
	var v int
	if err := s2.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil || v != len(migrations) || v < 17 {
		t.Fatalf("user_version = %d, %v", v, err)
	}
	b2, err := s2.book("usr-alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(b2.data.Tags) != nTag {
		t.Fatalf("tags lost: %d/%d", len(b2.data.Tags), nTag)
	}
	for _, tg := range b2.data.Tags {
		if tg.Group != "" {
			t.Fatalf("tag %s: group %q after migration", tg.ID, tg.Group)
		}
	}
	tg := b2.data.Tags[0]
	tg.Group = "after the upgrade"
	if err := b2.updateTag(tg); err != nil || b2.data.tagByID(tg.ID).Group != "after the upgrade" {
		t.Fatalf("group on an upgraded database: %v", err)
	}
}

func TestMCPTagGroups(t *testing.T) {
	s := openTestStore(t)
	b := addTestUser(t, s, "alice", false)
	if _, err := toolCreateTag(b, json.RawMessage(`{"name":"Coffee","group":" Food "}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := toolCreateTag(b, json.RawMessage(`{"name":"Rent"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := toolCreateTag(b, json.RawMessage(`{"name":"Long","group":"`+strings.Repeat("x", maxTagGroupRunes+1)+`"}`)); err == nil {
		t.Fatal("a group over 100 characters was accepted")
	}
	out, err := toolListTags(b, nil)
	if err != nil {
		t.Fatal(err)
	}
	js, _ := json.Marshal(out)
	if !strings.Contains(string(js), `"group":"Food"`) || strings.Count(string(js), `"group"`) != 1 {
		t.Fatalf("list_tags: %s", js)
	}
}
