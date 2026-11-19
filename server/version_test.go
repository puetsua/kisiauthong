// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"sort"
	"strings"
	"testing"
)

// stamp sets the build variables as -ldflags would, for one test.
func stamp(t *testing.T, version, sha, built, ch string) {
	t.Helper()
	prev := [4]string{appVersion, commit, buildTime, channel}
	appVersion, commit, buildTime, channel = version, sha, built, ch
	t.Cleanup(func() { appVersion, commit, buildTime, channel = prev[0], prev[1], prev[2], prev[3] })
}

const testSHA = "c22ff51a3e9d07b41f6c2580e9a7d13b64f0c8e2" // made up

func TestBuildAbout(t *testing.T) {
	cases := []struct {
		name, version, sha, built, ch string
		want                          AboutInfo
	}{
		{"dev build without ldflags", "dev", "", "", "", AboutInfo{Version: "dev"}},
		{"empty version", " ", "", "", "", AboutInfo{Version: "dev"}},
		{"release", "0.2.0", testSHA, "2026-11-12T08:30:05Z", "",
			AboutInfo{Version: "0.2.0", Commit: testSHA, BuildTime: "2026-11-12T08:30:05Z"}},
		{"nightly", "0.2.0-1118-c22ff51", testSHA, "2026-11-17T19:00:12Z", "nightly",
			AboutInfo{Version: "0.2.0-1118-c22ff51", Commit: testSHA, BuildTime: "2026-11-17T19:00:12Z", Nightly: true}},
		{"build time in another zone is shown in UTC", "0.2.0", testSHA, "2026-11-18T03:00:12+08:00", "",
			AboutInfo{Version: "0.2.0", Commit: testSHA, BuildTime: "2026-11-17T19:00:12Z"}},
		{"upper-case hash", "0.2.0", strings.ToUpper(testSHA), "", "", AboutInfo{Version: "0.2.0", Commit: testSHA}},
		{"malformed flags are left out", "0.2.0", "not-a-hash", "yesterday", "stable",
			AboutInfo{Version: "0.2.0"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stamp(t, c.version, c.sha, c.built, c.ch)
			var got AboutInfo
			buildAbout(&got)
			if got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

// Every signed-in user sees the version in Settings → About, with nothing
// from the administration page; signed out, there is nothing to see.
func TestSettingsAboutVersion(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "bob", false) // not an administrator
	stamp(t, "0.2.0-1118-c22ff51", testSHA, "2026-11-17T19:00:12Z", "nightly")

	if code := newClient(t, srv).do("GET", "/api/settings", nil, nil); code != 401 {
		t.Fatalf("settings without signing in: %d", code)
	}
	bob := newClient(t, srv)
	signedIn(t, bob, "bob")
	var out struct{ About map[string]interface{} }
	if code := bob.do("GET", "/api/settings", nil, &out); code != 200 {
		t.Fatalf("GET /api/settings: %d", code)
	}
	keys := []string{}
	for k := range out.About {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "buildTime,commit,nightly,sourceUrl,version" {
		t.Fatalf("about exposes %v", keys)
	}
	if out.About["version"] != "0.2.0-1118-c22ff51" || out.About["commit"] != testSHA ||
		out.About["buildTime"] != "2026-11-17T19:00:12Z" || out.About["nightly"] != true {
		t.Fatalf("about: %+v", out.About)
	}

	// a release build: no nightly flag
	stamp(t, "0.2.0", testSHA, "2026-11-12T08:30:05Z", "")
	var rel struct{ About AboutInfo }
	bob.do("GET", "/api/settings", nil, &rel)
	if rel.About.Version != "0.2.0" || rel.About.Nightly {
		t.Fatalf("release about: %+v", rel.About)
	}
}
