// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// testBook is the signed-in user's books for the settings handler tests.
var testBook *Book

func withTestStore(t *testing.T) {
	t.Helper()
	s := openTestStore(t)
	prev := store
	store = s
	testBook = addTestUser(t, s, "alice", true)
	t.Cleanup(func() { store = prev })
}

func doSettings(t *testing.T, method, body string) (int, Settings) {
	t.Helper()
	req := httptest.NewRequest(method, "/api/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleSettings(rec, req, testBook)
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
	if s.General.DefaultCurrency != "TWD" || itemList(s.Dashboard) != strings.Join(dashboardWidgets, ",") {
		t.Fatalf("unexpected defaults: %+v", s)
	}
	if s.About.SourceURL != "https://example.invalid/src" {
		t.Fatalf("sourceUrl not from env: %q", s.About.SourceURL)
	}
}

func TestSettingsPartialUpdateKeepsOtherSection(t *testing.T) {
	withTestStore(t)
	if code, _ := doSettings(t, http.MethodPut, `{"dashboard":{"items":[{"id":"recent","type":"recent"},{"id":"b","type":"balances"}]}}`); code != 200 {
		t.Fatalf("PUT dashboard: %d", code)
	}
	code, s := doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":" jpy "}}`)
	if code != 200 {
		t.Fatalf("PUT general: %d", code)
	}
	if s.General.DefaultCurrency != "JPY" {
		t.Fatalf("currency not normalised: %q", s.General.DefaultCurrency)
	}
	if itemList(s.Dashboard) != "recent,b:balances" {
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

// Issue #71: the currency order the Spending rows (GET /api/state, MCP) use follows the
// frequently used currencies, default first, and changes when Settings do.
func TestCurrencyOrderFollowsSettings(t *testing.T) {
	withTestStore(t)
	if got := strings.Join(testBook.currencyOrder(), ","); got != "TWD" {
		t.Fatalf("default order: %s", got)
	}
	if code, _ := doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":"TWD","currencies":["USD","JPY"]}}`); code != 200 {
		t.Fatalf("PUT: %d", code)
	}
	if got := strings.Join(testBook.currencyOrder(), ","); got != "TWD,USD,JPY" {
		t.Fatalf("order: %s", got)
	}
	if code, _ := doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":"JPY"}}`); code != 200 {
		t.Fatalf("PUT: %d", code)
	}
	if got := strings.Join(testBook.currencyOrder(), ","); got != "JPY,TWD,USD" {
		t.Fatalf("order after a new default: %s", got)
	}
	// a row stored before the list was normalised reads as the web UI gets it: upper case, default first
	if err := testBook.setSetting("general", `{"defaultCurrency":"usd","currencies":["jpy","USD","eur"]}`); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(testBook.currencyOrder(), ","); got != "USD,JPY,EUR" {
		t.Fatalf("order from a raw stored row: %s", got)
	}
}

func TestSettingsLanguage(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.Language != "" {
		t.Fatalf("language should default to browser (empty), got %q", s.General.Language)
	}
	code, s := doSettings(t, http.MethodPut, `{"general":{"language":"zh-TW"}}`)
	if code != 200 || s.General.Language != "zh-TW" || s.General.DefaultCurrency != "TWD" {
		t.Fatalf("set zh-TW: %d %+v", code, s.General)
	}
	// changing the currency keeps the language
	if _, s = doSettings(t, http.MethodPut, `{"general":{"defaultCurrency":"JPY"}}`); s.General.Language != "zh-TW" {
		t.Fatalf("language lost: %+v", s.General)
	}
	if _, s = doSettings(t, http.MethodPut, `{"general":{"language":""}}`); s.General.Language != "" {
		t.Fatalf("back to browser default: %+v", s.General)
	}
	for _, bad := range []string{"zh-CN", "fr", "ZH-TW", "th"} {
		if code, _ := doSettings(t, http.MethodPut, `{"general":{"language":"`+bad+`"}}`); code != 400 {
			t.Errorf("language %q: want 400, got %d", bad, code)
		}
	}
}

func TestSettingsPageWidth(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.PageWidth != "default" {
		t.Fatalf("default page width: %q", s.General.PageWidth)
	}
	for _, w := range []string{"wide", "full", "default"} {
		if code, s := doSettings(t, http.MethodPut, `{"general":{"pageWidth":"`+w+`"}}`); code != 200 || s.General.PageWidth != w {
			t.Fatalf("set %s: %d %+v", w, code, s.General)
		}
	}
	doSettings(t, http.MethodPut, `{"general":{"pageWidth":"wide"}}`)
	if _, s := doSettings(t, http.MethodPut, `{"general":{"openDays":20}}`); s.General.PageWidth != "wide" {
		t.Fatalf("page width lost: %+v", s.General)
	}
	for _, bad := range []string{"huge", "Wide", "1600px"} {
		if code, _ := doSettings(t, http.MethodPut, `{"general":{"pageWidth":"`+bad+`"}}`); code != 400 {
			t.Errorf("pageWidth %q: want 400, got %d", bad, code)
		}
	}
}

func TestSettingsOpenDays(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.OpenDays != 7 {
		t.Fatalf("default open days: %d", s.General.OpenDays)
	}
	if code, s := doSettings(t, http.MethodPut, `{"general":{"openDays":14}}`); code != 200 || s.General.OpenDays != 14 {
		t.Fatalf("set 14: %d %+v", code, s.General)
	}
	if _, s := doSettings(t, http.MethodPut, `{"general":{"pageWidth":"wide"}}`); s.General.OpenDays != 14 {
		t.Fatalf("open days lost: %+v", s.General)
	}
	for _, bad := range []string{"-1", "91", `"7"`} {
		if code, _ := doSettings(t, http.MethodPut, `{"general":{"openDays":`+bad+`}}`); code != 400 {
			t.Errorf("openDays %s: want 400, got %d", bad, code)
		}
	}
}

func TestSettingsDismissedNotifications(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.Notifications.Dismissed == nil || len(s.Notifications.Dismissed) != 0 {
		t.Fatalf("dismissed should start empty: %+v", s.Notifications)
	}
	code, s := doSettings(t, http.MethodPut, `{"notifications":{"dismissed":["budget-over:tag-food:2026-11"," goal-reached:tag-house ","budget-over:tag-food:2026-11"]}}`)
	if code != 200 || strings.Join(s.Notifications.Dismissed, ",") != "budget-over:tag-food:2026-11,goal-reached:tag-house" {
		t.Fatalf("dismiss: %d %+v", code, s.Notifications)
	}
	// other sections leave it alone
	if _, s = doSettings(t, http.MethodPut, `{"general":{"language":"zh-TW"}}`); len(s.Notifications.Dismissed) != 2 {
		t.Fatalf("dismissed lost: %+v", s.Notifications)
	}
	long := strings.Repeat("x", 121)
	for _, bad := range []string{`{"notifications":{"dismissed":[""]}}`, `{"notifications":{"dismissed":["` + long + `"]}}`, `{"notifications":{"dismissed":"x"}}`} {
		if code, _ := doSettings(t, http.MethodPut, bad); code != 400 {
			t.Errorf("%s: want 400, got %d", bad, code)
		}
	}
}

func TestSettingsLegacyGeneralRowGetsList(t *testing.T) {
	withTestStore(t)
	if err := testBook.setSetting("general", `{"defaultCurrency":"JPY","transactionsPerPage":20}`); err != nil {
		t.Fatal(err)
	}
	if _, s := doSettings(t, http.MethodGet, ""); strings.Join(s.General.Currencies, ",") != "JPY,TWD" || s.General.PageWidth != "default" || s.General.OpenDays != 7 {
		t.Fatalf("legacy row: %+v", s.General)
	}
}

// itemList renders a dashboard as "id" (when id == type) or "id:type", in order.
func itemList(d DashboardSettings) string {
	out := []string{}
	for _, w := range d.Items {
		if w.ID == w.Type {
			out = append(out, w.ID)
		} else {
			out = append(out, w.ID+":"+w.Type)
		}
	}
	return strings.Join(out, ",")
}

func TestSettingsDashboardWidgetOptions(t *testing.T) {
	withTestStore(t)
	code, s := doSettings(t, http.MethodPut, `{"dashboard":{"items":[
		{"id":"recent","type":"recent","size":"half","title":"  Latest  ","rows":10},
		{"id":"accounts","type":"accounts","include":["acc-a","acc-b"]}]}}`)
	if code != 200 {
		t.Fatalf("PUT: %d", code)
	}
	r := s.Dashboard.Items[0]
	if r.Size != "half" || r.Title != "Latest" || r.Rows != 10 {
		t.Fatalf("recent options: %+v", r)
	}
	if strings.Join(s.Dashboard.Items[1].Include, ",") != "acc-a,acc-b" {
		t.Fatalf("accounts include: %+v", s.Dashboard.Items[1])
	}
}

func TestSettingsWidgetTypeRepeats(t *testing.T) {
	withTestStore(t)
	code, s := doSettings(t, http.MethodPut, `{"dashboard":{"items":[
		{"id":"accounts","type":"accounts","title":"Banks","include":["acc-a","acc-b"]},
		{"id":"w-cards","type":"accounts","title":"Cards","include":["acc-c"],"size":"half"},
		{"id":"w-2","type":"balances","include":["TWD"]},
		{"id":"w-3","type":"balances","include":["JPY"]}]}}`)
	if code != 200 {
		t.Fatalf("PUT: %d", code)
	}
	if itemList(s.Dashboard) != "accounts,w-cards:accounts,w-2:balances,w-3:balances" || s.Dashboard.Items[1].Title != "Cards" {
		t.Fatalf("items: %+v", s.Dashboard.Items)
	}
	// stored and read back unchanged
	if _, s = doSettings(t, http.MethodGet, ""); itemList(s.Dashboard) != "accounts,w-cards:accounts,w-2:balances,w-3:balances" {
		t.Fatalf("after reload: %s", itemList(s.Dashboard))
	}
	// an empty dashboard is allowed
	if code, s = doSettings(t, http.MethodPut, `{"dashboard":{"items":[]}}`); code != 200 || len(s.Dashboard.Items) != 0 {
		t.Fatalf("empty: %d %+v", code, s.Dashboard)
	}
}

func TestSettingsWidgetColumns(t *testing.T) {
	withTestStore(t)
	code, s := doSettings(t, http.MethodPut, `{"dashboard":{"items":[{"id":"a","type":"accounts","columns":["name","type","currency","free"]}]}}`)
	if code != 200 || strings.Join(s.Dashboard.Items[0].Columns, ",") != "name,currency,free" { // the retired kind column is dropped
		t.Fatalf("columns: %d %+v", code, s.Dashboard.Items)
	}
	for _, body := range []string{
		`{"dashboard":{"items":[{"id":"a","type":"accounts","columns":["name","nope"]}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"accounts","columns":["name","name"]}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"budgets","columns":["currency"]}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent","columns":["name"]}]}}`,
	} {
		if code, _ := doSettings(t, http.MethodPut, body); code != 400 {
			t.Errorf("%s: want 400, got %d", body, code)
		}
	}
}

func TestSettingsLegacyDashboardBecomesItems(t *testing.T) {
	withTestStore(t)
	// saved before widgets were reusable: one per type, hidden ones off the dashboard,
	// types missing from order shown at the end, retired types dropped
	if err := testBook.setSetting("dashboard", `{"order":["recent","expected","balances","budgets"],"hidden":["budgets","expected"],"widgets":{"recent":{"rows":3},"expected":{"rows":3}}}`); err != nil {
		t.Fatal(err)
	}
	_, s := doSettings(t, http.MethodGet, "")
	if itemList(s.Dashboard) != "recent,balances,spending,reserves,accounts" || s.Dashboard.Items[0].Rows != 3 {
		t.Fatalf("legacy layout: %s %+v", itemList(s.Dashboard), s.Dashboard.Items)
	}
	// an older client sending the old shape is converted too
	code, s := doSettings(t, http.MethodPut, `{"dashboard":{"order":["expected","spending"],"hidden":["balances","budgets","reserves","accounts","recent"]}}`)
	if code != 200 || itemList(s.Dashboard) != "spending" {
		t.Fatalf("PUT old shape: %d %s", code, itemList(s.Dashboard))
	}
	// a stored layout that no longer validates falls back to the default instead of breaking settings
	if err := testBook.setSetting("dashboard", `{"items":[{"id":"x","type":"nope"}]}`); err != nil {
		t.Fatal(err)
	}
	if code, s = doSettings(t, http.MethodGet, ""); code != 200 || itemList(s.Dashboard) != strings.Join(dashboardWidgets, ",") {
		t.Fatalf("broken stored layout: %d %s", code, itemList(s.Dashboard))
	}
}

func TestSettingsNumberFormat(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.NumberFormat != "grouped" {
		t.Fatalf("default: %q", s.General.NumberFormat)
	}
	for _, f := range []string{"plain", "four", "grouped"} {
		if code, s := doSettings(t, http.MethodPut, `{"general":{"numberFormat":"`+f+`"}}`); code != 200 || s.General.NumberFormat != f {
			t.Fatalf("%s: %d %q", f, code, s.General.NumberFormat)
		}
	}
	// the retired 萬・億・兆 style becomes groups of four
	if code, s := doSettings(t, http.MethodPut, `{"general":{"numberFormat":"cjk"}}`); code != 200 || s.General.NumberFormat != "four" {
		t.Fatalf("cjk: %d %q", code, s.General.NumberFormat)
	}
}

func TestSettingsAmountStyle(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.AmountStyle != "both" {
		t.Fatalf("default: %q", s.General.AmountStyle)
	}
	for _, v := range []string{"sign", "color", "both"} {
		if code, s := doSettings(t, http.MethodPut, `{"general":{"amountStyle":"`+v+`"}}`); code != 200 || s.General.AmountStyle != v {
			t.Fatalf("%s: %d %q", v, code, s.General.AmountStyle)
		}
	}
	doSettings(t, http.MethodPut, `{"general":{"amountStyle":"color"}}`)
	if _, s := doSettings(t, http.MethodPut, `{"general":{"pageWidth":"wide"}}`); s.General.AmountStyle != "color" {
		t.Fatalf("amount style lost: %+v", s.General)
	}
	for _, bad := range []string{"none", "Color", "signs"} {
		if code, _ := doSettings(t, http.MethodPut, `{"general":{"amountStyle":"`+bad+`"}}`); code != 400 {
			t.Errorf("amountStyle %q: want 400, got %d", bad, code)
		}
	}
	// a row saved before the setting existed reads as the default
	if err := testBook.setSetting("general", `{"defaultCurrency":"TWD","currencies":["TWD"]}`); err != nil {
		t.Fatal(err)
	}
	if code, s := doSettings(t, http.MethodGet, ""); code != 200 || s.General.AmountStyle != "both" {
		t.Fatalf("old row: %d %q", code, s.General.AmountStyle)
	}
}

func TestSettingsTimeZone(t *testing.T) {
	withTestStore(t)
	if _, s := doSettings(t, http.MethodGet, ""); s.General.TimeZone != "" {
		t.Fatalf("default should follow the device: %q", s.General.TimeZone)
	}
	if code, s := doSettings(t, http.MethodPut, `{"general":{"timeZone":"Asia/Tokyo"}}`); code != 200 || s.General.TimeZone != "Asia/Tokyo" {
		t.Fatalf("set zone: %d %q", code, s.General.TimeZone)
	}
	if code, s := doSettings(t, http.MethodPut, `{"general":{"timeZone":""}}`); code != 200 || s.General.TimeZone != "" {
		t.Fatalf("back to auto: %d %q", code, s.General.TimeZone)
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
		`{"dashboard":{"items":[{"id":"a","type":"nope"}]}}`,
		`{"dashboard":{"items":[{"id":"","type":"recent"}]}}`,
		`{"dashboard":{"items":[{"id":"has space","type":"recent"}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent"},{"id":"a","type":"budgets"}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent","size":"huge"}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent","rows":51}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent","rows":-1}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"recent","title":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}]}}`,
		`{"dashboard":{"items":[{"id":"a","type":"accounts","include":[""]}]}}`,
		`{"general":{"timeZone":"Mars/Olympus"}}`,
		`{"general":{"numberFormat":"roman"}}`,
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
	handleExport(rec, httptest.NewRequest(http.MethodGet, "/api/export", nil), testBook)
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
