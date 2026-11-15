// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import "testing"

func TestAdminServer(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", false)
	if _, err := s.db.Exec(`UPDATE users SET is_admin=1 WHERE id='usr-alice'`); err != nil {
		t.Fatal(err)
	}
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")
	var info struct {
		Version        string
		Users, Admins  int
		ActiveSessions int
		Database       struct {
			SchemaVersion int
			SizeBytes     int64
		}
	}
	if code := alice.do("GET", "/api/admin/server", nil, &info); code != 200 || info.Users != 2 || info.Admins != 1 ||
		info.ActiveSessions != 2 || info.Database.SchemaVersion != len(migrations) || info.Version == "" {
		t.Fatalf("admin: %d %+v", code, info)
	}
	if code := bob.do("GET", "/api/admin/server", nil, nil); code != 403 {
		t.Fatalf("non-admin: %d", code)
	}
	k := createKey(t, alice, "Agent", ScopeRead)
	if code := newClient(t, srv).do("GET", "/api/admin/server", nil, nil, "Authorization", "Bearer "+k.Key); code != 401 {
		t.Fatalf("API key: %d", code)
	}
}
