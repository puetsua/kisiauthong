// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

// Passkeys (WebAuthn; ADR 0007). A user adds passkeys from My account and
// can then sign in with one alone, without a username: the authenticator
// returns the user handle (the user id). User verification (PIN,
// fingerprint, face) is required, so a passkey counts as both factors.
//
// The relying party is the host the browser used: its name is the RP ID and
// scheme://host the origin, unless KISIAUTHONG_ORIGIN pins one (e.g.
// https://books.example.org behind a proxy). WebAuthn needs a domain name:
// http://localhost works, http://127.0.0.1 does not.

const ceremonyTTL = 5 * time.Minute

// relyingParty builds the WebAuthn configuration for this request's origin.
func relyingParty(r *http.Request) (*webauthn.WebAuthn, error) {
	origin := os.Getenv("KISIAUTHONG_ORIGIN")
	if origin == "" {
		scheme := "http"
		if isSecure(r) {
			scheme = "https"
		}
		origin = scheme + "://" + r.Host
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return nil, errors.New("cannot tell this server's address for passkeys")
	}
	if net.ParseIP(u.Hostname()) != nil {
		return nil, errors.New("passkeys need a host name, not an IP address: open this app as http://localhost:" + u.Port() + " or by its domain name")
	}
	return webauthn.New(&webauthn.Config{RPID: u.Hostname(), RPDisplayName: "KiSiauThong", RPOrigins: []string{strings.TrimSuffix(origin, "/")}})
}

// ceremonies hold WebAuthn session data between begin and finish, by token.
var ceremonies = struct {
	sync.Mutex
	m map[string]ceremony
}{m: map[string]ceremony{}}

type ceremony struct {
	data    webauthn.SessionData
	uid     string // registration: who is adding a passkey
	expires time.Time
}

func putCeremony(c ceremony) string {
	tok := randomToken(24)
	ceremonies.Lock()
	defer ceremonies.Unlock()
	now := time.Now()
	for k, v := range ceremonies.m {
		if now.After(v.expires) {
			delete(ceremonies.m, k)
		}
	}
	c.expires = now.Add(ceremonyTTL)
	ceremonies.m[tok] = c
	return tok
}

func takeCeremony(tok string) (ceremony, bool) {
	ceremonies.Lock()
	defer ceremonies.Unlock()
	c, ok := ceremonies.m[tok]
	delete(ceremonies.m, tok)
	return c, ok && time.Now().Before(c.expires)
}

// waUser adapts a user and their passkeys to the webauthn library.
type waUser struct {
	u     *User
	creds []webauthn.Credential
}

func (w *waUser) WebAuthnID() []byte                         { return []byte(w.u.ID) }
func (w *waUser) WebAuthnName() string                       { return w.u.Username }
func (w *waUser) WebAuthnDisplayName() string                { return w.u.DisplayName }
func (w *waUser) WebAuthnCredentials() []webauthn.Credential { return w.creds }
func (w *waUser) WebAuthnIcon() string                       { return "" }

// Passkey is a stored passkey as My account lists it.
type Passkey struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

func credID(c webauthn.Credential) string { return base64.RawURLEncoding.EncodeToString(c.ID) }

func (s *Store) passkeyUser(uid string) (*waUser, error) {
	u, err := s.userByID(uid)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT credential_json FROM passkeys WHERE user_id=?`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	w := &waUser{u: u}
	for rows.Next() {
		var js string
		var c webauthn.Credential
		if err := rows.Scan(&js); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(js), &c) == nil {
			w.creds = append(w.creds, c)
		}
	}
	return w, rows.Err()
}

/* ---------- My account: adding, listing and removing passkeys ---------- */

// GET /api/me/passkeys lists them; POST begins adding one.
func handlePasskeys(w http.ResponseWriter, r *http.Request, u *User) {
	switch r.Method {
	case http.MethodGet:
		rows, err := store.db.Query(`SELECT id,name,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at`, u.ID)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		defer rows.Close()
		out := []Passkey{}
		for rows.Next() {
			var p Passkey
			if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.LastUsedAt); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			out = append(out, p)
		}
		writeJSON(w, 200, out)
	case http.MethodPost:
		rp, err := relyingParty(r)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		wu, err := store.passkeyUser(u.ID)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		exclude := make([]protocol.CredentialDescriptor, 0, len(wu.creds))
		for _, c := range wu.creds {
			exclude = append(exclude, c.Descriptor())
		}
		opts, data, err := rp.BeginRegistration(wu,
			webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
			webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired}),
			webauthn.WithExclusions(exclude))
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"token": putCeremony(ceremony{data: *data, uid: u.ID}), "options": opts})
	default:
		writeErr(w, 405, "GET or POST only")
	}
}

// POST /api/me/passkeys/finish?token=…&name=… with the browser's credential as the body.
// DELETE /api/me/passkeys/{id} removes one.
func handlePasskey(w http.ResponseWriter, r *http.Request, u *User) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // api me passkeys <id|finish>
	if len(parts) != 4 {
		writeErr(w, 404, "not found")
		return
	}
	if r.Method == http.MethodDelete && parts[3] != "finish" {
		id := parts[3]
		res, err := store.db.Exec(`DELETE FROM passkeys WHERE user_id=? AND id=?`, u.ID, id)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeErr(w, 404, "passkey not found")
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if parts[3] != "finish" || r.Method != http.MethodPost {
		writeErr(w, 404, "not found")
		return
	}
	c, ok := takeCeremony(r.URL.Query().Get("token"))
	if !ok || c.uid != u.ID {
		writeErr(w, 400, "this passkey setup expired; try again")
		return
	}
	rp, err := relyingParty(r)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	wu, err := store.passkeyUser(u.ID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	cred, err := rp.FinishRegistration(wu, c.data, r)
	if err != nil {
		writeErr(w, 400, "the passkey was not accepted: "+protocolDetail(err))
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" || utf8.RuneCountInString(name) > 60 {
		name = "Passkey"
	}
	js, _ := json.Marshal(cred)
	if _, err := store.db.Exec(`INSERT INTO passkeys(id,user_id,name,credential_json,created_at,last_used_at) VALUES(?,?,?,?,?,'')`,
		credID(*cred), u.ID, name, string(js), time.Now().UTC().Format(time.RFC3339)); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, Passkey{ID: credID(*cred), Name: name})
}

func protocolDetail(err error) string {
	var pe *protocol.Error
	if errors.As(err, &pe) && pe.DevInfo != "" {
		return pe.DevInfo
	}
	return err.Error()
}

/* ---------- signing in with a passkey ---------- */

// POST /api/auth/passkey: begin; POST /api/auth/passkey?token=… with the assertion: finish.
func handlePasskeyLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	rp, err := relyingParty(r)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	tok := r.URL.Query().Get("token")
	if tok == "" {
		opts, data, err := rp.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]interface{}{"token": putCeremony(ceremony{data: *data}), "options": opts})
		return
	}
	key := clientKey(r)
	if signinFailures.blocked(key) {
		writeErr(w, 429, "too many failed sign-ins; try again in a few minutes")
		return
	}
	c, ok := takeCeremony(tok)
	if !ok {
		writeErr(w, 400, "this sign-in expired; try again")
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var who *waUser
	cred, err := rp.FinishDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		wu, err := store.passkeyUser(string(userHandle))
		if err != nil {
			return nil, err
		}
		who = wu
		return wu, nil
	}, c.data, r)
	if err != nil || who == nil {
		signinFailures.add(key)
		writeErr(w, 401, "this passkey is not registered here")
		return
	}
	js, _ := json.Marshal(cred) // keeps the new signature counter
	if _, err := store.db.Exec(`UPDATE passkeys SET credential_json=?, last_used_at=? WHERE user_id=? AND id=?`,
		string(js), time.Now().UTC().Format(time.RFC3339), who.u.ID, credID(*cred)); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	signinFailures.reset(key)
	finishSignIn(w, r, who.u.ID)
}

// Migration 10: passkeys.
func migratePasskeys(tx *sql.Tx) error {
	_, err := tx.Exec(passkeyTable)
	return err
}

const passkeyTable = `
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, credential_json TEXT NOT NULL,
  created_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
`
