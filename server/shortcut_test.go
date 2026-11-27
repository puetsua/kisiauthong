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

// A shortcut may have no amount, no tags and no title (issue #121): the add form
// leaves them empty. A repeating template still needs a positive amount, on
// create and on update, because what it generates always has one.
func TestShortcutWithoutAmount(t *testing.T) {
	b := sampleBook(t)
	create := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handleCreateTemplate(w, httptest.NewRequest("POST", "/api/templates", strings.NewReader(body)), b)
		return w
	}
	w := create(`{"name":"Coffee","template":{"type":"expense","accountId":"acc-a"},"schedule":{"frequency":"never"}}`)
	if w.Code != 201 {
		t.Fatalf("shortcut without an amount: %d %s", w.Code, w.Body)
	}
	var tp TransactionTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &tp); err != nil {
		t.Fatal(err)
	}
	if tp.Template.AmountMinor != 0 || tp.Template.Note != "" || len(tp.Template.TagIDs) != 0 {
		t.Fatalf("filled in something: %+v", tp.Template)
	}
	if got := b.data.templateByID(tp.ID); got == nil || got.Template.AmountMinor != 0 {
		t.Fatalf("stored: %+v", got)
	}
	for _, c := range []struct{ name, body string }{
		{"repeating without an amount", `{"name":"Rent","template":{"type":"expense","accountId":"acc-a"},"schedule":{"frequency":"monthly","startDate":"2026-01-01"}}`},
		{"empty frequency (monthly) without an amount", `{"name":"Rent","template":{"type":"expense","accountId":"acc-a","amountMinor":0},"schedule":{"startDate":"2026-01-01"}}`},
		{"negative shortcut amount", `{"name":"Coffee","template":{"type":"expense","accountId":"acc-a","amountMinor":-5},"schedule":{"frequency":"never"}}`},
	} {
		if w := create(c.body); w.Code != 400 {
			t.Fatalf("%s: %d %s", c.name, w.Code, w.Body)
		}
	}
	// turning the shortcut into a repeating template needs an amount
	put := func(body string) int {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("PUT", "/api/templates/"+tp.ID, strings.NewReader(body))
		handleTemplate(w, r, b)
		return w.Code
	}
	if code := put(`{"name":"Coffee","template":{"type":"expense","accountId":"acc-a"},"schedule":{"frequency":"weekly","startDate":"2026-01-01"}}`); code != 400 {
		t.Fatalf("update to repeating without an amount: %d", code)
	}
	if code := put(`{"name":"Coffee","template":{"type":"expense","accountId":"acc-a","amountMinor":150},"schedule":{"frequency":"weekly","startDate":"2026-01-01"}}`); code != 200 {
		t.Fatalf("update to repeating with an amount: %d", code)
	}
	if code := put(`{"name":"Coffee","template":{"type":"expense","accountId":"acc-a"},"schedule":{"frequency":"never"}}`); code != 200 {
		t.Fatalf("update back to a shortcut without an amount: %d", code)
	}
}
