// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// API keys (ADR 0008): a user creates keys for scripts and AI agents, each
// with the scopes it needs and an optional expiry. A key acts for its user
// only, on the REST API (Authorization: Bearer kst_…) and on MCP. The key
// is shown once; only its SHA-256 hash is stored. Keys can never manage
// sign-in methods, keys or users.

const (
	keyPrefix      = "kst_"
	maxKeysPerUser = 50
	lastUsedEvery  = time.Minute // how often last_used_at is refreshed
)

const apiKeyTable = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, hint TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);
`

// Migration 12: API keys.
func migrateAPIKeys(tx *sql.Tx) error {
	_, err := tx.Exec(apiKeyTable)
	return err
}

// APIKey is a key as My account lists it (never the key itself).
type APIKey struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Hint       string   `json:"hint"` // "kst_AbC…xyz"
	Scopes     []string `json:"scopes"`
	CreatedAt  string   `json:"createdAt"`
	LastUsedAt string   `json:"lastUsedAt,omitempty"`
	ExpiresAt  string   `json:"expiresAt,omitempty"`
}

func validScopes(in []string) ([]string, error) {
	known := map[string]bool{}
	for _, s := range allScopes {
		known[s] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, s := range allScopes { // canonical order
		for _, x := range in {
			if x == s && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
	}
	for _, x := range in {
		if !known[x] {
			return nil, fmt.Errorf("unknown permission: %q", x)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("choose at least one permission")
	}
	return out, nil
}

// keyPrincipal resolves an "Authorization: Bearer kst_…" header.
func (s *Store) keyPrincipal(h string) (*Principal, error) {
	tok := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	if !strings.HasPrefix(h, "Bearer ") || !strings.HasPrefix(tok, keyPrefix) {
		return nil, errUnauthorized
	}
	var id, uid, scopes, lastUsed, expires string
	err := s.db.QueryRow(`SELECT k.id,k.user_id,k.scopes,k.last_used_at,k.expires_at FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=?`,
		tokenHash(tok)).Scan(&id, &uid, &scopes, &lastUsed, &expires)
	if err != nil {
		return nil, fmt.Errorf("invalid API key")
	}
	now := time.Now().UTC()
	if expires != "" && now.Format(time.RFC3339) >= expires {
		return nil, fmt.Errorf("this API key has expired")
	}
	if last, err := time.Parse(time.RFC3339, lastUsed); err != nil || now.Sub(last) > lastUsedEvery {
		_, _ = s.db.Exec(`UPDATE api_keys SET last_used_at=? WHERE id=?`, now.Format(time.RFC3339), id)
	}
	p := &Principal{UserID: uid, KeyID: id, scopes: map[string]bool{}}
	for _, sc := range strings.Split(scopes, ",") {
		p.scopes[sc] = true
	}
	return p, nil
}

// GET /api/me/keys lists keys; POST {name, scopes, expiresInDays} creates one and returns it once.
func handleKeys(w http.ResponseWriter, r *http.Request, u *User) {
	switch r.Method {
	case http.MethodGet:
		rows, err := store.db.Query(`SELECT id,name,hint,scopes,created_at,last_used_at,expires_at FROM api_keys WHERE user_id=? ORDER BY created_at DESC`, u.ID)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		defer rows.Close()
		out := []APIKey{}
		for rows.Next() {
			var k APIKey
			var scopes string
			if err := rows.Scan(&k.ID, &k.Name, &k.Hint, &scopes, &k.CreatedAt, &k.LastUsedAt, &k.ExpiresAt); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			k.Scopes = strings.Split(scopes, ",")
			out = append(out, k)
		}
		writeJSON(w, 200, out)
	case http.MethodPost:
		var body struct {
			Name          string   `json:"name"`
			Scopes        []string `json:"scopes"`
			ExpiresInDays int      `json:"expiresInDays"`
		}
		if !decode(w, r, &body) {
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" || utf8.RuneCountInString(name) > 60 {
			writeErr(w, 400, "give the key a name of up to 60 characters")
			return
		}
		scopes, err := validScopes(body.Scopes)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		if body.ExpiresInDays < 0 || body.ExpiresInDays > 3650 {
			writeErr(w, 400, "expiry must be 0 (never) to 3650 days")
			return
		}
		var n int
		_ = store.db.QueryRow(`SELECT count(*) FROM api_keys WHERE user_id=?`, u.ID).Scan(&n)
		if n >= maxKeysPerUser {
			writeErr(w, 409, fmt.Sprintf("at most %d keys; revoke one first", maxKeysPerUser))
			return
		}
		now := time.Now().UTC()
		k := APIKey{ID: newID("key"), Name: name, Scopes: scopes, CreatedAt: now.Format(time.RFC3339)}
		if body.ExpiresInDays > 0 {
			k.ExpiresAt = now.AddDate(0, 0, body.ExpiresInDays).Format(time.RFC3339)
		}
		secret := keyPrefix + randomToken(32)
		k.Hint = secret[:8] + "…" + secret[len(secret)-4:]
		if _, err := store.db.Exec(`INSERT INTO api_keys(id,user_id,name,hint,key_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)`,
			k.ID, u.ID, k.Name, k.Hint, tokenHash(secret), strings.Join(scopes, ","), k.CreatedAt, k.ExpiresAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 201, map[string]interface{}{"key": secret, "apiKey": k})
	default:
		writeErr(w, 405, "GET or POST only")
	}
}

// DELETE /api/me/keys/{id} revokes a key at once.
func handleKey(w http.ResponseWriter, r *http.Request, u *User) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // api me keys <id>
	if len(parts) != 4 || r.Method != http.MethodDelete {
		writeErr(w, 404, "not found")
		return
	}
	id := parts[3]
	res, err := store.db.Exec(`DELETE FROM api_keys WHERE user_id=? AND id=?`, u.ID, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 404, "key not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
