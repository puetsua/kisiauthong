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

func TestSettingsRejectsInvalid(t *testing.T) {
	withTestStore(t)
	for _, body := range []string{
		`{"general":{"defaultCurrency":"YEN1"}}`,
		`{"general":{"defaultCurrency":""}}`,
		`{"dashboard":{"order":["nope"],"hidden":[]}}`,
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
