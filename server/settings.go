// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// dashboardWidgets is the known widget types, in default order.
var dashboardWidgets = []string{"balances", "budgets", "spending", "reserves", "accounts", "recent"}

// extraWidgets are known widget types that are not on the default dashboard;
// a user adds them in Customize. "income" is Income this month (issue #125).
var extraWidgets = []string{"income"}

// retiredWidgets were once valid; saved layouts that still name them are cleaned, not rejected.
// "expected" left the dashboard when expected transactions moved to the notification bell.
var retiredWidgets = map[string]bool{"expected": true}

// WidgetOptions customises one dashboard widget. Zero values mean "default".
type WidgetOptions struct {
	Size    string   `json:"size,omitempty"`    // "full" or "half"
	Title   string   `json:"title,omitempty"`   // overrides the built-in label
	Rows    int      `json:"rows,omitempty"`    // row limit for list widgets
	Include []string `json:"include,omitempty"` // item ids / currency codes to show; empty = all
	Columns []string `json:"columns,omitempty"` // shown columns in order (table widgets); empty = default
	By      string   `json:"by,omitempty"`      // income: rows by "category" (default) or "source"
}

// widgetColumns is the column keys each table widget offers (web/app.js WIDGET_COLS).
var widgetColumns = map[string][]string{
	"budgets":  {"name", "spent", "progress", "used", "limit", "remaining", "period"},
	"spending": {"name", "share", "pct", "spent"},
	"income":   {"name", "share", "pct", "received"},
	"accounts": {"name", "currency", "balance", "earmarked", "scheduled", "free", "limit", "owed"},
}

// retiredColumns were once offered; saved layouts that still list them are cleaned.
// The accounts "type" (kind) column went with account types (ADR 0005).
var retiredColumns = map[string]bool{"accounts.type": true}

// WidgetItem is one widget on the dashboard. A type may appear any number of
// times, each with its own options (e.g. two Accounts widgets for different accounts).
type WidgetItem struct {
	ID   string `json:"id"`   // client-chosen, unique within the dashboard
	Type string `json:"type"` // one of dashboardWidgets
	WidgetOptions
}

// DashboardSettings is the dashboard's widgets, top to bottom.
type DashboardSettings struct {
	Items []WidgetItem `json:"items"`
}

// UnmarshalJSON also reads layouts saved before widgets were reusable,
// {order, hidden, widgets} with one widget per type, as the equivalent item list.
func (d *DashboardSettings) UnmarshalJSON(b []byte) error {
	var raw struct {
		Items   *[]WidgetItem            `json:"items"`
		Order   []string                 `json:"order"`
		Hidden  []string                 `json:"hidden"`
		Widgets map[string]WidgetOptions `json:"widgets"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	if raw.Items != nil {
		d.Items = *raw.Items
		return nil
	}
	skip := map[string]bool{}
	for _, t := range raw.Hidden {
		skip[t] = true
	}
	d.Items = []WidgetItem{}
	add := func(t string) {
		if !skip[t] {
			skip[t] = true
			d.Items = append(d.Items, WidgetItem{ID: t, Type: t, WidgetOptions: raw.Widgets[t]})
		}
	}
	for _, t := range raw.Order {
		add(t)
	}
	for _, t := range dashboardWidgets { // the old dashboard showed types missing from order at the end
		add(t)
	}
	return nil
}

const (
	maxWidgets       = 40
	maxWidgetTitle   = 60
	maxWidgetRows    = 50
	maxWidgetInclude = 200
)

var widgetIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

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
	// TimeZone shows transaction times in this IANA zone; "" follows the device (for travelling).
	TimeZone string `json:"timeZone"`
	// NumberFormat writes amounts as "grouped" (1,074,958), "four" (107 4958, split by a no-break space in the web UI) or "plain" (1074958).
	NumberFormat string `json:"numberFormat"`
	// AmountStyle is how the transaction list marks spending and income: "both" (+ / − and a
	// color), "sign" (+ / − only) or "color" (a color only). Issue #66.
	AmountStyle string `json:"amountStyle"`
	// Theme is the selected theme, present only when a device has turned on syncing the selected
	// theme (ADR 0027): a built-in name or the id of a theme in Settings.Themes. Each device keeps
	// its own light/dark mode, which is never synced.
	Theme *ThemeChoice `json:"theme,omitempty"`
}

// ThemeChoice is the synced selected theme (ADR 0027).
type ThemeChoice struct {
	Selected string `json:"selected"`
}

// CustomTheme is a user's own theme, uploaded when a device syncs its custom themes or selects
// it with selected-theme sync on (ADR 0027). Light holds the theme's colours (token name without
// the leading "--" → #rrggbb); Dark only when Split is on. Unknown token names are kept, so an
// older server stores what a newer client sends; the client ignores names it does not know.
type CustomTheme struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	BasedOn   string            `json:"basedOn"`
	Split     bool              `json:"split"`
	Light     map[string]string `json:"light"`
	Dark      map[string]string `json:"dark,omitempty"`
	UpdatedAt string            `json:"updatedAt"`
}

// builtinThemes are the themes web/style.css ships (ADR 0027).
var builtinThemes = map[string]bool{"default": true, "contrast": true, "warm": true, "cool": true}

const (
	maxCustomThemes = 20
	maxThemeName    = 60
	maxThemeTokens  = 100
)

var (
	themeIDRe    = regexp.MustCompile(`^thm-[a-z0-9]{6,32}$`)
	themeTokenRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	themeHexRe   = regexp.MustCompile(`^#(?:[0-9a-f]{3}|[0-9a-f]{6})$`)
)

func (c *ThemeChoice) validate() error {
	if !builtinThemes[c.Selected] && !themeIDRe.MatchString(c.Selected) {
		return fmt.Errorf("theme.selected must be default, contrast, warm, cool or a custom theme id")
	}
	return nil
}

// normThemeColours checks one mode's colours: known-looking names, hex only (#rgb becomes #rrggbb, lower case).
func normThemeColours(id string, m map[string]string) (map[string]string, error) {
	if len(m) == 0 {
		return nil, fmt.Errorf("theme %s: no colours", id)
	}
	if len(m) > maxThemeTokens {
		return nil, fmt.Errorf("theme %s: at most %d colours", id, maxThemeTokens)
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		if !themeTokenRe.MatchString(k) {
			return nil, fmt.Errorf("theme %s: invalid colour name %q", id, k)
		}
		v = strings.ToLower(strings.TrimSpace(v))
		if !themeHexRe.MatchString(v) {
			return nil, fmt.Errorf("theme %s: %s must be a hex colour like #1a2b3c", id, k)
		}
		if len(v) == 4 {
			v = "#" + string([]byte{v[1], v[1], v[2], v[2], v[3], v[3]})
		}
		out[k] = v
	}
	return out, nil
}

// validateThemes checks and normalises a whole uploaded list. It replaces the stored list;
// devices merge by id before uploading (newer updatedAt wins), so a theme deleted on a
// device that syncs its custom themes is deleted here too.
func validateThemes(list []CustomTheme) ([]CustomTheme, error) {
	if len(list) > maxCustomThemes {
		return nil, fmt.Errorf("at most %d custom themes", maxCustomThemes)
	}
	seen := map[string]bool{}
	out := make([]CustomTheme, 0, len(list))
	for _, t := range list {
		if !themeIDRe.MatchString(t.ID) {
			return nil, fmt.Errorf("theme id must be thm- and 6-32 lower-case letters or digits")
		}
		if seen[t.ID] {
			return nil, fmt.Errorf("duplicate theme id: %s", t.ID)
		}
		seen[t.ID] = true
		t.Name = strings.TrimSpace(t.Name)
		if t.Name == "" || utf8.RuneCountInString(t.Name) > maxThemeName {
			return nil, fmt.Errorf("theme %s: name must be 1-%d characters", t.ID, maxThemeName)
		}
		if !builtinThemes[t.BasedOn] {
			return nil, fmt.Errorf("theme %s: basedOn must be default, contrast, warm or cool", t.ID)
		}
		if _, err := time.Parse(time.RFC3339, t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("theme %s: updatedAt must be an RFC 3339 time", t.ID)
		}
		var err error
		if t.Light, err = normThemeColours(t.ID, t.Light); err != nil {
			return nil, err
		}
		if t.Split {
			if t.Dark, err = normThemeColours(t.ID, t.Dark); err != nil {
				return nil, fmt.Errorf("%v (dark, needed when split is on)", err)
			}
		} else {
			t.Dark = nil // light only: the light colours serve both modes
		}
		out = append(out, t)
	}
	return out, nil
}

const (
	defaultOpenDays = 7
	maxOpenDays     = 90
)

var pageWidths = map[string]bool{"default": true, "wide": true, "full": true}

var numberFormats = map[string]bool{"grouped": true, "four": true, "plain": true}

var amountStyles = map[string]bool{"both": true, "sign": true, "color": true}

// uiLanguages are the UI languages the web client ships translations for.
var uiLanguages = map[string]bool{"en": true, "zh-TW": true}

const maxCurrencies = 50

// AboutInfo is read-only and comes from the environment and the build, not
// the settings table. The version fields are the ones the build stamps
// (version.go); nothing about the host, paths or the database.
type AboutInfo struct {
	SourceURL string `json:"sourceUrl"`
	Version   string `json:"version"`   // "0.2.0", "0.2.0-1118-c22ff51" or "dev", never a "v" prefix
	Commit    string `json:"commit"`    // full commit hash, "" when the build did not stamp one
	BuildTime string `json:"buildTime"` // RFC 3339 UTC, "" when the build did not stamp one
	Nightly   bool   `json:"nightly"`   // an automatic nightly test build
}

// NotificationSettings remembers which derived notifications the user
// dismissed, by key (e.g. "budget-over:tag-food:2026-11"). Notifications
// themselves are computed from the data, never stored.
type NotificationSettings struct {
	Dismissed []string `json:"dismissed"`
}

const (
	maxDismissed   = 500
	maxDismissedID = 120
)

func (n *NotificationSettings) validate() error {
	if len(n.Dismissed) > maxDismissed {
		return fmt.Errorf("at most %d dismissed notifications", maxDismissed)
	}
	seen := map[string]bool{}
	list := []string{}
	for _, k := range n.Dismissed {
		k = strings.TrimSpace(k)
		if k == "" || len(k) > maxDismissedID {
			return fmt.Errorf("invalid notification key")
		}
		if !seen[k] {
			seen[k] = true
			list = append(list, k)
		}
	}
	n.Dismissed = list
	return nil
}

type Settings struct {
	Dashboard     DashboardSettings    `json:"dashboard"`
	General       GeneralSettings      `json:"general"`
	Notifications NotificationSettings `json:"notifications"`
	// Themes is the user's custom themes uploaded by their devices (ADR 0027); empty until one syncs.
	Themes []CustomTheme `json:"themes"`
	About  AboutInfo     `json:"about"`
}

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

// defaultDashboard has one widget of each type; a type's first widget uses the type as its id.
func defaultDashboard() DashboardSettings {
	d := DashboardSettings{Items: []WidgetItem{}}
	for _, t := range dashboardWidgets {
		d.Items = append(d.Items, WidgetItem{ID: t, Type: t})
	}
	return d
}

func defaultSettings() Settings {
	return Settings{
		Dashboard: defaultDashboard(),
		General:   GeneralSettings{DefaultCurrency: "TWD", Currencies: []string{"TWD"}, PageWidth: "default", OpenDays: defaultOpenDays, NumberFormat: "grouped", AmountStyle: "both"},
	}
}

func (d *DashboardSettings) validate() error {
	known := map[string]bool{}
	for _, t := range append(append([]string{}, dashboardWidgets...), extraWidgets...) {
		known[t] = true
	}
	items := []WidgetItem{}
	seen := map[string]bool{}
	for _, w := range d.Items {
		if retiredWidgets[w.Type] {
			continue
		}
		if !known[w.Type] {
			return fmt.Errorf("unknown dashboard widget: %s", w.Type)
		}
		if !widgetIDRe.MatchString(w.ID) {
			return fmt.Errorf("widget id must be 1-64 letters, digits, - or _")
		}
		if seen[w.ID] {
			return fmt.Errorf("duplicate widget id: %s", w.ID)
		}
		seen[w.ID] = true
		if w.Size != "" && w.Size != "full" && w.Size != "half" {
			return fmt.Errorf("widget %s: size must be full or half", w.ID)
		}
		w.Title = strings.TrimSpace(w.Title)
		if utf8.RuneCountInString(w.Title) > maxWidgetTitle {
			return fmt.Errorf("widget %s: title longer than %d characters", w.ID, maxWidgetTitle)
		}
		if w.Rows < 0 || w.Rows > maxWidgetRows {
			return fmt.Errorf("widget %s: rows must be 1-%d", w.ID, maxWidgetRows)
		}
		if len(w.Include) > maxWidgetInclude {
			return fmt.Errorf("widget %s: too many items in include", w.ID)
		}
		for _, x := range w.Include {
			if x == "" || len(x) > 64 {
				return fmt.Errorf("widget %s: invalid include entry", w.ID)
			}
		}
		if w.By != "" && (w.Type != "income" || (w.By != "category" && w.By != "source")) {
			return fmt.Errorf("widget %s: by must be category or source, on an income widget only", w.ID)
		}
		cols := w.Columns[:0:0]
		for _, k := range w.Columns {
			if !retiredColumns[w.Type+"."+k] {
				cols = append(cols, k)
			}
		}
		w.Columns = cols
		if len(w.Columns) > 0 {
			offered := map[string]bool{}
			for _, k := range widgetColumns[w.Type] {
				offered[k] = true
			}
			if len(offered) == 0 {
				return fmt.Errorf("widget %s: %s has no columns to choose", w.ID, w.Type)
			}
			used := map[string]bool{}
			for _, k := range w.Columns {
				if !offered[k] || used[k] {
					return fmt.Errorf("widget %s: unknown or repeated column %q", w.ID, k)
				}
				used[k] = true
			}
		}
		items = append(items, w)
	}
	if len(items) > maxWidgets {
		return fmt.Errorf("at most %d widgets", maxWidgets)
	}
	d.Items = items
	return nil
}

func normCurrency(c string) string { return strings.ToUpper(strings.TrimSpace(c)) }

// validate normalises codes and drops duplicates. The default currency is
// always on the list and always first; the rest keep the user's order.
func (g *GeneralSettings) validate() error {
	if g.TimeZone != "" {
		if _, err := time.LoadLocation(g.TimeZone); err != nil || g.TimeZone == "Local" {
			return fmt.Errorf("unknown time zone: %s", g.TimeZone)
		}
	}
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
	if g.NumberFormat == "" { // rows saved before this setting existed
		g.NumberFormat = "grouped"
	}
	if g.NumberFormat == "cjk" { // the 萬・億・兆 style was replaced by groups of four
		g.NumberFormat = "four"
	}
	if !numberFormats[g.NumberFormat] {
		return fmt.Errorf("numberFormat must be grouped, four or plain")
	}
	if g.AmountStyle == "" { // rows saved before this setting existed
		g.AmountStyle = "both"
	}
	if !amountStyles[g.AmountStyle] {
		return fmt.Errorf("amountStyle must be both, sign or color")
	}
	if g.PageWidth == "" { // rows saved before this setting existed
		g.PageWidth = "default"
	}
	if !pageWidths[g.PageWidth] {
		return fmt.Errorf("pageWidth must be default, wide or full")
	}
	if g.Theme != nil {
		if err := g.Theme.validate(); err != nil {
			return err
		}
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

// loadSettings reads the user's stored settings over the defaults. Caller holds store.mu.
func (s *Book) loadSettings() (Settings, error) {
	out := defaultSettings()
	if v, ok, err := s.getSetting("dashboard"); err != nil {
		return out, err
	} else if ok {
		if err := json.Unmarshal([]byte(v), &out.Dashboard); err != nil {
			return out, fmt.Errorf("stored dashboard setting is invalid JSON")
		}
	}
	if err := out.Dashboard.validate(); err != nil {
		// a broken layout must not take the rest of the settings down with it
		log.Printf("stored dashboard setting ignored: %v", err)
		out.Dashboard = defaultDashboard()
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
	if v, ok, err := s.getSetting("notifications"); err != nil {
		return out, err
	} else if ok {
		if err := json.Unmarshal([]byte(v), &out.Notifications); err != nil {
			return out, fmt.Errorf("stored notifications setting is invalid JSON")
		}
	}
	if out.Notifications.Dismissed == nil {
		out.Notifications.Dismissed = []string{}
	}
	out.Themes = []CustomTheme{}
	if v, ok, err := s.getSetting("themes"); err != nil {
		return out, err
	} else if ok {
		var list []CustomTheme
		if err := json.Unmarshal([]byte(v), &list); err != nil {
			return out, fmt.Errorf("stored themes setting is invalid JSON")
		}
		if list, err := validateThemes(list); err != nil {
			log.Printf("stored themes setting ignored: %v", err) // a broken list must not take the rest down
		} else {
			out.Themes = list
		}
	}
	out.About.SourceURL = os.Getenv("KISIAUTHONG_SOURCE_URL") // a modified version links its own source (AGPL §13)
	if out.About.SourceURL == "" {
		out.About.SourceURL = defaultSourceURL
	}
	buildAbout(&out.About)
	return out, nil
}

func (s *Book) saveJSONSetting(key string, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.setSetting(key, string(b))
}

// handleSettings serves GET/PUT /api/settings. PUT accepts any subset of
// {dashboard, general, notifications, themes}; omitted sections are left unchanged, fields
// omitted inside general keep their stored value, and themes replaces the whole list.
func handleSettings(w http.ResponseWriter, r *http.Request, b *Book) {
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var body struct {
			Dashboard     *DashboardSettings    `json:"dashboard"`
			General       json.RawMessage       `json:"general"`
			Notifications *NotificationSettings `json:"notifications"`
			Themes        *[]CustomTheme        `json:"themes"`
		}
		if !decode(w, r, &body) {
			return
		}
		var general *GeneralSettings
		if len(body.General) > 0 && string(body.General) != "null" {
			cur, err := b.loadSettings()
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
		if body.Dashboard == nil && general == nil && body.Notifications == nil && body.Themes == nil {
			writeErr(w, 400, "nothing to update: send dashboard, general, notifications and/or themes")
			return
		}
		var themes []CustomTheme
		if body.Themes != nil {
			var err error
			if themes, err = validateThemes(*body.Themes); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
		}
		if body.Notifications != nil {
			if err := body.Notifications.validate(); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
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
			if err := b.saveJSONSetting("dashboard", body.Dashboard); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if general != nil {
			if err := b.saveJSONSetting("general", general); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if body.Notifications != nil {
			if err := b.saveJSONSetting("notifications", body.Notifications); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if body.Themes != nil {
			if err := b.saveJSONSetting("themes", themes); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
	default:
		writeErr(w, 405, "GET or PUT only")
		return
	}
	out, err := b.loadSettings()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, out)
}

// handleExport serves GET /api/export: the whole book as plain JSON (the
// seed/import/export format), offered as a file download.
func handleExport(w http.ResponseWriter, r *http.Request, b *Book) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "GET only")
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="kisiauthong-export-%s.json"`, b.today()))
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, b.data)
}
