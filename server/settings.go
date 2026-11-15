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
)

// dashboardWidgets is the known widget set, in default order.
var dashboardWidgets = []string{"balances", "budgets", "expected", "moneyboxes", "accounts", "recent"}

type DashboardSettings struct {
	Order  []string `json:"order"`
	Hidden []string `json:"hidden"`
}

type GeneralSettings struct {
	DefaultCurrency string `json:"defaultCurrency"`
}

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
		General:   GeneralSettings{DefaultCurrency: "TWD"},
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
	if d.Order == nil {
		d.Order = []string{}
	}
	if d.Hidden == nil {
		d.Hidden = []string{}
	}
	return nil
}

func (g *GeneralSettings) validate() error {
	g.DefaultCurrency = strings.ToUpper(strings.TrimSpace(g.DefaultCurrency))
	if !currencyRe.MatchString(g.DefaultCurrency) {
		return fmt.Errorf("defaultCurrency must be a 3-letter ISO 4217 code")
	}
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
	if v, ok, err := s.getSetting("general"); err != nil {
		return out, err
	} else if ok {
		if err := json.Unmarshal([]byte(v), &out.General); err != nil {
			return out, fmt.Errorf("stored general setting is invalid JSON")
		}
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
// {dashboard, general}; omitted sections are left unchanged.
func handleSettings(w http.ResponseWriter, r *http.Request) {
	store.mu.Lock()
	defer store.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var body struct {
			Dashboard *DashboardSettings `json:"dashboard"`
			General   *GeneralSettings   `json:"general"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.Dashboard == nil && body.General == nil {
			writeErr(w, 400, "nothing to update: send dashboard and/or general")
			return
		}
		if body.Dashboard != nil {
			if err := body.Dashboard.validate(); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
		if body.General != nil {
			if err := body.General.validate(); err != nil {
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
		if body.General != nil {
			if err := store.saveJSONSetting("general", body.General); err != nil {
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
