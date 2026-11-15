// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"strings"
	"testing"
)

type newKey struct {
	Key    string
	APIKey APIKey
}

func createKey(t *testing.T, c *client, name string, scopes ...string) newKey {
	t.Helper()
	var k newKey
	if code := c.do("POST", "/api/me/keys", map[string]interface{}{"name": name, "scopes": scopes}, &k); code != 201 || !strings.HasPrefix(k.Key, "kst_") {
		t.Fatalf("create key %s: %d %+v", name, code, k)
	}
	return k
}

func TestAPIKeys(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", false)
	alice, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")
	reader := createKey(t, alice, "Read only", ScopeRead)
	writer := createKey(t, alice, "Agent", ScopeRead, ScopeTransactions)
	bobKey := createKey(t, bob, "Bob's script", ScopeRead)
	anon := newClient(t, srv) // no cookies: only the key speaks
	bearer := func(k newKey) []string { return []string{"Authorization", "Bearer " + k.Key} }

	// read with a key
	var st struct{ Transactions []map[string]interface{} }
	if code := anon.do("GET", "/api/state", nil, &st, bearer(reader)...); code != 200 || len(st.Transactions) < 50 {
		t.Fatalf("read with key: %d %d", code, len(st.Transactions))
	}
	// a read-only key cannot write
	txn := map[string]interface{}{"type": "expense", "accountId": "acc-b", "amountMinor": 4500, "currency": "TWD", "date": "2026-11-15", "note": "From the agent"}
	if code := anon.do("POST", "/api/transactions", txn, nil, bearer(reader)...); code != 403 {
		t.Fatalf("read-only key wrote: %d", code)
	}
	// the writer can add transactions, but not accounts or settings
	if code := anon.do("POST", "/api/transactions", txn, nil, bearer(writer)...); code != 201 {
		t.Fatalf("writer key: %d", code)
	}
	if code := anon.do("POST", "/api/accounts", map[string]string{"name": "x", "currency": "TWD"}, nil, bearer(writer)...); code != 403 {
		t.Fatalf("accounts without the scope: %d", code)
	}
	if code := anon.do("PUT", "/api/settings", map[string]interface{}{"general": map[string]string{"defaultCurrency": "USD"}}, nil, bearer(writer)...); code != 403 {
		t.Fatalf("settings without the scope: %d", code)
	}
	// keys never manage keys, users or sign-in methods
	for _, path := range []string{"/api/me/keys", "/api/me", "/api/users", "/api/me/passkeys"} {
		if code := anon.do("GET", path, nil, nil, bearer(writer)...); code != 401 {
			t.Errorf("%s with a key: %d", path, code)
		}
	}
	// a key acts for its own user only
	var bs struct{ Transactions []map[string]interface{} }
	anon.do("GET", "/api/state", nil, &bs, bearer(bobKey)...)
	if len(bs.Transactions) != 0 {
		t.Fatalf("bob's key saw other books")
	}
	// the key itself is never listed again
	var list []APIKey
	if alice.do("GET", "/api/me/keys", nil, &list); len(list) != 2 || list[0].Hint == "" || strings.Contains(list[0].Hint, writer.Key[8:20]) {
		t.Fatalf("list: %+v", list)
	}
	// revoked: refused at once
	if code := alice.do("DELETE", "/api/me/keys/"+reader.APIKey.ID, nil, nil); code != 200 {
		t.Fatalf("revoke: %d", code)
	}
	if code := anon.do("GET", "/api/state", nil, nil, bearer(reader)...); code != 401 {
		t.Fatalf("revoked key: %d", code)
	}
	if code := bob.do("DELETE", "/api/me/keys/"+writer.APIKey.ID, nil, nil); code != 404 {
		t.Fatalf("bob revoked alice's key: %d", code)
	}
	// expired: refused
	if _, err := s.db.Exec(`UPDATE api_keys SET expires_at='2000-01-01T00:00:00Z' WHERE id=?`, writer.APIKey.ID); err != nil {
		t.Fatal(err)
	}
	if code := anon.do("GET", "/api/state", nil, nil, bearer(writer)...); code != 401 {
		t.Fatalf("expired key: %d", code)
	}
	// nonsense
	if code := anon.do("GET", "/api/state", nil, nil, "Authorization", "Bearer kst_nope"); code != 401 {
		t.Fatalf("made-up key: %d", code)
	}
	if code := alice.do("POST", "/api/me/keys", map[string]interface{}{"name": "x", "scopes": []string{"admin"}}, nil); code != 400 {
		t.Fatalf("unknown scope: %d", code)
	}
	if code := alice.do("POST", "/api/me/keys", map[string]interface{}{"name": "x", "scopes": []string{}}, nil); code != 400 {
		t.Fatalf("no scopes: %d", code)
	}
	var withExpiry newKey
	if code := alice.do("POST", "/api/me/keys", map[string]interface{}{"name": "Month", "scopes": []string{ScopeRead}, "expiresInDays": 30}, &withExpiry); code != 201 || withExpiry.APIKey.ExpiresAt == "" {
		t.Fatalf("expiring key: %d %+v", code, withExpiry)
	}
}
