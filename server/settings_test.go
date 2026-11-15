// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func withTestStore(t *testing.T) {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	prev := store
	store = s
	t.Cleanup(func() { store = prev; s.db.Close() })
}

func doSettings(t *testing.T, method, body string) (int, Settings) {
	t.Helper()
	req := httptest.NewRequest(method, "/api/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSettings(rec, req)
	var out Settings
	if rec.Code == 200 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec.Code, out
}

func TestSettingsDefaults(t *testing.T) {
	withTestStore(t)
	t.Setenv("KISIAUTHONG_SOURCE_URL", "https://example.invalid/src")
	code, s := doSettings(t, http.MethodGet, "")
	if code != 200 {
		t.Fatalf("GET: %d", code)
	}
	if s.General.DefaultCurrency != "TWD" || len(s.Dashboard.Order) != len(dashboardWidgets) || len(s.Dashboard.Hidden) != 0 {
		t.Fatalf("unexpected defaults: %+v", s)
	}
	if s.About.SourceURL != "https://example.invalid/src" {
		t.Fatalf("sourceUrl not from env: %q", s.About.SourceURL)
	}
}

func TestSettingsPartialUpdateKeepsOtherSection(t *testing.T) {
	withTestStore(t)
	if code, _ := doSettings(t, http.MethodPut, `{"dashboard":{"order":["recent","balances"],"hidden":["budgets"]}}`); code != 200 {
		t.Fatalf("PUT dashboard: %d", code)
	}
	code, s := doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":" jpy "}}`)
	if code != 200 {
		t.Fatalf("PUT general: %d", code)
	}
	if s.General.DefaultCurrency != "JPY" {
		t.Fatalf("currency not normalised: %q", s.General.DefaultCurrency)
	}
	if strings.Join(s.Dashboard.Order, ",") != "recent,balances" || strings.Join(s.Dashboard.Hidden, ",") != "budgets" {
		t.Fatalf("dashboard lost on general update: %+v", s.Dashboard)
	}
}

func TestSettingsFrequentCurrencies(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); strings.Join(s.General.Currencies, ",") != "TWD" {
		t.Fatalf("default list: %v", s.General.Currencies)
	}
	// USD, TWD, JPY use case: normalised, de-duplicated, default pinned first
	code, s := doSettings(t, http.MethodPut, `{"general":{"currencies":["usd","TWD"," jpy","USD"]}}`)
	if code != 200 || strings.Join(s.General.Currencies, ",") != "TWD,USD,JPY" || s.General.DefaultCurrency != "TWD" {
		t.Fatalf("set list: %d %+v", code, s.General)
	}
	// a new default moves to the front; the rest keep their order
	if _, s = doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":"JPY"}}`); strings.Join(s.General.Currencies, ",") != "JPY,TWD,USD" || s.General.DefaultCurrency != "JPY" {
		t.Fatalf("default-only update: %+v", s.General)
	}
	// a list without the default still shows it, first
	if _, s = doSettings(t, http.MethodPut, `{"general":{"currencies":["USD"]}}`); strings.Join(s.General.Currencies, ",") != "JPY,USD" {
		t.Fatalf("default removed from list: %v", s.General.Currencies)
	}
	// an empty list still holds the default
	if _, s = doSettings(t, http.MethodPut, `{"general":{"currencies":[]}}`); strings.Join(s.General.Currencies, ",") != "JPY" {
		t.Fatalf("empty list: %v", s.General.Currencies)
	}
	// a default that was never on the list is added
	if _, s = doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":"EUR","currencies":["USD","JPY"]}}`); strings.Join(s.General.Currencies, ",") != "EUR,USD,JPY" {
		t.Fatalf("unlisted default: %v", s.General.Currencies)
	}
}

func TestSettingsLegacyGeneralRowGetsList(t *testing.T) {
	withTestStore(t)
	if err := store.setSetting("general", `{"defaultCurrency":"JPY"}`); err != nil {
		t.Fatal(err)
	}
	if _, s := doSettings(t, http.MethodGet, ""); strings.Join(s.General.Currencies, ",") != "JPY,TWD" {
		t.Fatalf("legacy row: %+v", s.General)
	}
}

func TestSettingsDashboardWidgetOptions(t *testing.T) {
	withTestStore(t)
	code, s := doSettings(t, http.MethodPut, `{"dashboard":{"order":["spending","recent"],"hidden":[],"widgets":{"recent":{"size":"half","title":"  Latest  ","rows":10},"accounts":{"include":["acc-a","acc-b"]}}}}`)
	if code != 200 {
		t.Fatalf("PUT: %d", code)
	}
	r := s.Dashboard.Widgets["recent"]
	if r.Size != "half" || r.Title != "Latest" || r.Rows != 10 {
		t.Fatalf("recent options: %+v", r)
	}
	if strings.Join(s.Dashboard.Widgets["accounts"].Include, ",") != "acc-a,acc-b" {
		t.Fatalf("accounts include: %+v", s.Dashboard.Widgets["accounts"])
	}
	// a layout saved before widget options existed still loads with an empty map
	if err := store.setSetting("dashboard", `{"order":["recent"],"hidden":[]}`); err != nil {
		t.Fatal(err)
	}
	if _, s = doSettings(t, http.MethodGet, ""); s.Dashboard.Widgets == nil {
		t.Fatalf("widgets map should default to empty")
	}
}

func TestSettingsRejectsInvalid(t *testing.T) {
	withTestStore(t)
	for _, body := range []string{
		`{"general":{"defaultCurrency":"YEN1"}}`,
		`{"general":{"defaultCurrency":""}}`,
		`{"general":{"currencies":["USD","US"]}}`,
		`{"general":{"currencies":"USD"}}`,
		`{"dashboard":{"order":["nope"],"hidden":[]}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"nope":{}}}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"recent":{"size":"huge"}}}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"recent":{"rows":51}}}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"recent":{"rows":-1}}}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"recent":{"title":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}}}}`,
		`{"dashboard":{"order":[],"hidden":[],"widgets":{"accounts":{"include":[""]}}}}`,
		`{}`,
		`not json`,
	} {
		if code, _ := doSettings(t, http.MethodPut, body); code != 400 {
			t.Errorf("%s: want 400, got %d", body, code)
		}
	}
	// a rejected general update must not have been written
	if _, s := doSettings(t, http.MethodGet, ""); s.General.DefaultCurrency != "TWD" {
		t.Fatalf("invalid update was persisted: %q", s.General.DefaultCurrency)
	}
}

func TestExportDownloadsData(t *testing.T) {
	withTestStore(t)
	rec := httptest.NewRecorder()
	handleExport(rec, httptest.NewRequest(http.MethodGet, "/api/export", nil))
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Fatalf("not a download: %q", cd)
	}
	var d Data
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(d.Accounts) == 0 || d.Version != 1 {
		t.Fatalf("export missing seeded data: %+v", d)
	}
}
