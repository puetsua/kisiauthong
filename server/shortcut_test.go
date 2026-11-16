// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// A template that never repeats is a shortcut for the add form: it is stored,
// listed with no next date, and generates nothing (ADR 0012).
func TestShortcutTemplate(t *testing.T) {
	b := sampleBook(t)
	body := `{"name":"Breakfast","template":{"type":"expense","accountId":"acc-a","amountMinor":8500,"tagIds":["tag-food"],"note":"Breakfast"},
		"schedule":{"frequency":"never","interval":3,"dayOfMonth":5,"startDate":"2026-01-01"}}`
	w := httptest.NewRecorder()
	handleCreateTemplate(w, httptest.NewRequest("POST", "/api/templates", strings.NewReader(body)), b)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var tp TransactionTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &tp); err != nil {
		t.Fatal(err)
	}
	if tp.Schedule != (Schedule{Frequency: "never", Interval: 1}) {
		t.Fatalf("schedule kept extra fields: %+v", tp.Schedule)
	}
	if tp.Template.Type != "transfer" || len(tp.Template.TagIDs) != 1 {
		t.Fatalf("template body: %+v", tp.Template)
	}
	if occ := Occurrences(tp, "2000-01-01", "2099-12-31"); len(occ) != 0 {
		t.Fatalf("a shortcut has occurrences: %v", occ)
	}
	before := len(b.data.Transactions)
	if _, err := b.GenerateDue("2026-12-31"); err != nil {
		t.Fatal(err)
	}
	for _, x := range b.data.Transactions[before:] {
		if x.TransactionTemplateID == tp.ID {
			t.Fatalf("generated from a shortcut: %+v", x)
		}
	}
}

func TestNormalizeSchedule(t *testing.T) {
	for _, c := range []struct {
		in Schedule
		ok bool
	}{
		{Schedule{Frequency: "never"}, true},
		{Schedule{StartDate: "2026-01-01"}, true}, // empty frequency stays monthly
		{Schedule{Frequency: "weekly", StartDate: "2026-01-01", EndDate: "2026-06-30"}, true},
		{Schedule{Frequency: "hourly", StartDate: "2026-01-01"}, false},
		{Schedule{Frequency: "monthly"}, false},                                           // no start date
		{Schedule{Frequency: "monthly", StartDate: "2026-01-01", EndDate: "soon"}, false}, // bad end date
	} {
		s := c.in
		err := normalizeSchedule(&s)
		if (err == nil) != c.ok {
			t.Fatalf("%+v: err %v", c.in, err)
		}
		if c.ok && c.in.Frequency == "" && s.Frequency != "monthly" {
			t.Fatalf("empty frequency became %q", s.Frequency)
		}
	}
}
