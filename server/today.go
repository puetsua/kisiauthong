// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"encoding/json"
	"os"
	"time"
)

// "Today" on the server (ADR 0014). A transaction dated after today is
// scheduled: it is not in balances, budgets or reports yet, and what it takes
// from an own account is held. Every server-side "today" comes from here, in
// one zone: the user's Settings time zone, else KISIAUTHONG_TZ, else the zone
// of the server process.

// todayZone picks the zone that decides a user's today; userTZ is their
// Settings time zone ("" for Auto).
func todayZone(userTZ string) *time.Location {
	for _, tz := range []string{userTZ, os.Getenv("KISIAUTHONG_TZ")} {
		if tz == "" || tz == "Local" {
			continue
		}
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	return time.Local
}

// todayAt is the local date at instant now for a user with Settings time zone userTZ.
func todayAt(now time.Time, userTZ string) string {
	return now.In(todayZone(userTZ)).Format("2006-01-02")
}

// userTZ is the time zone the user chose in Settings, "" for Auto.
func (b *Book) userTZ() string {
	v, ok, err := b.getSetting("general")
	if err != nil || !ok {
		return ""
	}
	var g struct {
		TimeZone string `json:"timeZone"`
	}
	if json.Unmarshal([]byte(v), &g) != nil {
		return ""
	}
	return g.TimeZone
}

// currencyOrder is the user's frequently used currencies (Settings), default
// first, the order every list of currencies follows (issue #71). Without
// stored settings it is the default settings' list.
func (b *Book) currencyOrder() []string {
	g := defaultSettings().General
	if v, ok, err := b.getSetting("general"); err == nil && ok {
		_ = json.Unmarshal([]byte(v), &g)
	}
	out := []string{}
	if g.DefaultCurrency != "" {
		out = append(out, g.DefaultCurrency)
	}
	for _, c := range g.Currencies {
		if c != g.DefaultCurrency {
			out = append(out, c)
		}
	}
	return out
}

// today is the user's local date now.
func (b *Book) today() string { return todayAt(time.Now(), b.userTZ()) }
