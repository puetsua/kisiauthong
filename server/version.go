// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"regexp"
	"strings"
	"time"
)

// Build information, stamped at build time (ADR 0018):
//
//	-ldflags "-X main.appVersion=0.2.0 -X main.commit=<full sha>
//	          -X main.buildTime=2026-11-12T08:30:05Z [-X main.channel=nightly]"
//
// A release stamps its tag (no "v" prefix); a nightly stamps
// <latest release>-<MMDD in Asia/Taipei>-<sha7> and channel=nightly. A build
// without ldflags is "dev" with no commit or build time.
var (
	appVersion = "dev"
	commit     = ""
	buildTime  = ""
	channel    = ""
)

var commitRe = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// buildAbout fills the version fields of Settings → About. Values that do
// not look like a commit hash or an RFC 3339 time are left out, so a
// mistyped build flag shows nothing rather than something misleading.
func buildAbout(a *AboutInfo) {
	a.Version = strings.TrimSpace(appVersion)
	if a.Version == "" {
		a.Version = "dev"
	}
	if c := strings.ToLower(strings.TrimSpace(commit)); commitRe.MatchString(c) {
		a.Commit = c
	}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(buildTime)); err == nil {
		a.BuildTime = t.UTC().Format(time.RFC3339)
	}
	a.Nightly = strings.TrimSpace(channel) == "nightly"
}
