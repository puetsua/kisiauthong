// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// The administration page (ADR 0007): how this server is doing, for
// administrators only. It counts sign-in methods and keys but never shows
// anything from anyone's books.

// appVersion is set by release builds: -ldflags "-X main.appVersion=v1.2.3".
var appVersion = "dev"

// defaultSourceURL is where users of this server get its source (AGPL §13);
// whoever runs a modified version sets KISIAUTHONG_SOURCE_URL to theirs.
const defaultSourceURL = "https://github.com/puetsua/kisiauthong"

var startedAt = time.Now().UTC()

// GET /api/admin/server
func handleAdminServer(w http.ResponseWriter, r *http.Request, _ *User) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "GET only")
		return
	}
	count := func(q string, args ...interface{}) int {
		var n int
		_ = store.db.QueryRow(q, args...).Scan(&n)
		return n
	}
	var size int64
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if fi, err := os.Stat(store.path + suffix); err == nil {
			size += fi.Size()
		}
	}
	path := store.path
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	now := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, 200, map[string]interface{}{
		"version":   appVersion,
		"startedAt": startedAt.Format(time.RFC3339),
		"runtime":   runtime.Version() + " " + runtime.GOOS + "/" + runtime.GOARCH,
		"database": map[string]interface{}{
			"path": path, "sizeBytes": size, "schemaVersion": count(`PRAGMA user_version`),
		},
		"users":          count(`SELECT count(*) FROM users WHERE username <> ''`),
		"admins":         count(`SELECT count(*) FROM users WHERE username <> '' AND is_admin=1`),
		"twoStepUsers":   count(`SELECT count(*) FROM users WHERE username <> '' AND totp_enabled=1`),
		"passkeys":       count(`SELECT count(*) FROM passkeys`),
		"activeSessions": count(`SELECT count(*) FROM sessions WHERE expires_at > ?`, now),
		"apiKeys":        count(`SELECT count(*) FROM api_keys WHERE expires_at = '' OR expires_at > ?`, now),
	})
}
