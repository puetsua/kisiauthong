// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// dashboardWidgets is the known widget set, in default order.
var dashboardWidgets = []string{"balances", "budgets", "expected", "spending", "moneyboxes", "accounts", "recent"}

// WidgetOptions customises one dashboard widget. Zero values mean "default".
type WidgetOptions struct {
	Size    string   `json:"size,omitempty"`    // "full" or "half"
	Title   string   `json:"title,omitempty"`   // overrides the built-in label
	Rows    int      `json:"rows,omitempty"`    // row limit for list widgets
	Include []string `json:"include,omitempty"` // item ids / currency codes to show; empty = all
}

type DashboardSettings struct {
	Order   []string                 `json:"order"`
	Hidden  []string                 `json:"hidden"`
	Widgets map[string]WidgetOptions `json:"widgets"`
}

const (
	maxWidgetTitle   = 60
	maxWidgetRows    = 50
	maxWidgetInclude = 200
)

type GeneralSettings struct {
	DefaultCurrency string `json:"defaultCurrency"`
	// Currencies is the user's frequently used list, in display order. It is
	// a shortlist for pickers only; any ISO 4217 code can still be recorded.
	Currencies []string `json:"currencies"`
	// Language is the UI language: "" follows the browser, else one of uiLanguages.
	Language string `json:"language"`
	// PageWidth caps the content width: "default", "wide" or "full".
	PageWidth string `json:"pageWidth"`
	// OpenDays is how many of the newest days start expanded in the transaction list.
	OpenDays int `json:"openDays"`
}

const (
	defaultOpenDays = 7
	maxOpenDays     = 90
)

var pageWidths = map[string]bool{"default": true, "wide": true, "full": true}

// uiLanguages are the UI languages the web client ships translations for.
var uiLanguages = map[string]bool{"en": true, "zh-TW": true}

const maxCurrencies = 50

// AboutInfo is read-only and comes from the environment, not the settings table.
type AboutInfo struct {
	SourceURL string `json:"sourceUrl"`
}

type Settings struct {
	Dashboard DashboardSettings `json:"dashboard"`
	General   GeneralSettings   `json:"general"`
	About     AboutInfo         `json:"about"`
}

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

func defaultSettings() Settings {
	return Settings{
		Dashboard: DashboardSettings{Order: append([]string{}, dashboardWidgets...), Hidden: []string{}},
		General:   GeneralSettings{DefaultCurrency: "TWD", Currencies: []string{"TWD"}, PageWidth: "default", OpenDays: defaultOpenDays},
	}
}

func (d *DashboardSettings) validate() error {
	known := map[string]bool{}
	for _, id := range dashboardWidgets {
		known[id] = true
	}
	for _, id := range append(append([]string{}, d.Order...), d.Hidden...) {
		if !known[id] {
			return fmt.Errorf("unknown dashboard widget: %s", id)
		}
	}
	if d.Widgets == nil {
		d.Widgets = map[string]WidgetOptions{}
	}
	for id, w := range d.Widgets {
		if !known[id] {
			return fmt.Errorf("unknown dashboard widget: %s", id)
		}
		if w.Size != "" && w.Size != "full" && w.Size != "half" {
			return fmt.Errorf("widget %s: size must be full or half", id)
		}
		w.Title = strings.TrimSpace(w.Title)
		if utf8.RuneCountInString(w.Title) > maxWidgetTitle {
			return fmt.Errorf("widget %s: title longer than %d characters", id, maxWidgetTitle)
		}
		if w.Rows < 0 || w.Rows > maxWidgetRows {
			return fmt.Errorf("widget %s: rows must be 1-%d", id, maxWidgetRows)
		}
		if len(w.Include) > maxWidgetInclude {
			return fmt.Errorf("widget %s: too many items in include", id)
		}
		for _, x := range w.Include {
			if x == "" || len(x) > 64 {
				return fmt.Errorf("widget %s: invalid include entry", id)
			}
		}
		d.Widgets[id] = w
	}
	if d.Order == nil {
		d.Order = []string{}
	}
	if d.Hidden == nil {
		d.Hidden = []string{}
	}
	return nil
}

func normCurrency(c string) string { return strings.ToUpper(strings.TrimSpace(c)) }

// validate normalises codes and drops duplicates. The default currency is
// always on the list and always first; the rest keep the user's order.
func (g *GeneralSettings) validate() error {
	g.DefaultCurrency = normCurrency(g.DefaultCurrency)
	if !currencyRe.MatchString(g.DefaultCurrency) {
		return fmt.Errorf("defaultCurrency must be a 3-letter ISO 4217 code")
	}
	if g.OpenDays == 0 { // rows saved before this setting existed
		g.OpenDays = defaultOpenDays
	}
	if g.OpenDays < 1 || g.OpenDays > maxOpenDays {
		return fmt.Errorf("openDays must be 1-%d", maxOpenDays)
	}
	if g.PageWidth == "" { // rows saved before this setting existed
		g.PageWidth = "default"
	}
	if !pageWidths[g.PageWidth] {
		return fmt.Errorf("pageWidth must be default, wide or full")
	}
	if g.Language != "" && !uiLanguages[g.Language] {
		return fmt.Errorf("language must be empty (browser default), en or zh-TW")
	}
	seen := map[string]bool{g.DefaultCurrency: true}
	list := []string{g.DefaultCurrency}
	for _, c := range g.Currencies {
		c = normCurrency(c)
		if !currencyRe.MatchString(c) {
			return fmt.Errorf("invalid currency code: %q", c)
		}
		if !seen[c] {
			seen[c] = true
			list = append(list, c)
		}
	}
	if len(list) > maxCurrencies {
		return fmt.Errorf("at most %d frequently used currencies", maxCurrencies)
	}
	g.Currencies = list
	return nil
}

// loadSettings reads stored settings over the defaults. Caller holds store.mu.
func (s *Store) loadSettings() (Settings, error) {
	out := defaultSettings()
	if v, ok, err := s.getSetting("dashboard"); err != nil {
		return out, err
	} else if ok {
		if err := json.Unmarshal([]byte(v), &out.Dashboard); err != nil {
			return out, fmt.Errorf("stored dashboard setting is invalid JSON")
		}
	}
	if out.Dashboard.Widgets == nil {
		out.Dashboard.Widgets = map[string]WidgetOptions{}
	}
	if v, ok, err := s.getSetting("general"); err != nil {
		return out, err
	} else if ok {
		if err := json.Unmarshal([]byte(v), &out.General); err != nil {
			return out, fmt.Errorf("stored general setting is invalid JSON")
		}
	}
	// rows saved before the currency list existed: keep their default listed
	if err := out.General.validate(); err != nil {
		return out, fmt.Errorf("stored general setting: %w", err)
	}
	out.About.SourceURL = os.Getenv("KISIAUTHONG_SOURCE_URL")
	return out, nil
}

func (s *Store) saveJSONSetting(key string, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.setSetting(key, string(b))
}

// handleSettings serves GET/PUT /api/settings. PUT accepts any subset of
// {dashboard, general}; omitted sections are left unchanged, and fields
// omitted inside general keep their stored value.
func handleSettings(w http.ResponseWriter, r *http.Request) {
	store.mu.Lock()
	defer store.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var body struct {
			Dashboard *DashboardSettings `json:"dashboard"`
			General   json.RawMessage    `json:"general"`
		}
		if !decode(w, r, &body) {
			return
		}
		var general *GeneralSettings
		if len(body.General) > 0 && string(body.General) != "null" {
			cur, err := store.loadSettings()
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			general = &cur.General
			if err := json.Unmarshal(body.General, general); err != nil {
				writeErr(w, 400, "invalid general: "+err.Error())
				return
			}
		}
		if body.Dashboard == nil && general == nil {
			writeErr(w, 400, "nothing to update: send dashboard and/or general")
			return
		}
		if body.Dashboard != nil {
			if err := body.Dashboard.validate(); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
		if general != nil {
			if err := general.validate(); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
		if body.Dashboard != nil {
			if err := store.saveJSONSetting("dashboard", body.Dashboard); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if general != nil {
			if err := store.saveJSONSetting("general", general); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
	default:
		writeErr(w, 405, "GET or PUT only")
		return
	}
	out, err := store.loadSettings()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, out)
}

// handleExport serves GET /api/export: the whole book as plain JSON (the
// seed/import/export format), offered as a file download.
func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "GET only")
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="kisiauthong-export-%s.json"`, time.Now().Format("2006-01-02")))
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, store.data)
}
