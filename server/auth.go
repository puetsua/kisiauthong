// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Users and sign-in (ADR 0007). Every request to /api is made by a
// principal: a user signed in with a session cookie, or (ADR 0008) an API
// key acting for its user with the scopes it was given.

const (
	sessionCookie = "kst_session"
	sessionTTL    = 30 * 24 * time.Hour
	minPassword   = 8
	maxPassword   = 200
)

// Scopes an API key can hold. A browser session holds all of them.
const (
	ScopeRead         = "read"
	ScopeTransactions = "transactions:write"
	ScopeAccounts     = "accounts:write"
	ScopeTags         = "tags:write"
	ScopeTemplates    = "templates:write"
	ScopeSettings     = "settings:write"
)

var allScopes = []string{ScopeRead, ScopeTransactions, ScopeAccounts, ScopeTags, ScopeTemplates, ScopeSettings}

// Principal is who is making a request and what they may do.
type Principal struct {
	UserID string
	KeyID  string          // set when the request came with an API key
	scopes map[string]bool // nil: everything (a signed-in session)
}

func (p *Principal) can(scope string) bool { return p.scopes == nil || p.scopes[scope] }

// User is a user as the API shows them; secrets never leave the server.
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	IsAdmin      bool   `json:"isAdmin"`
	TOTPEnabled  bool   `json:"totpEnabled"`
	RecoveryLeft int    `json:"recoveryCodesLeft,omitempty"`
	HasAvatar    bool   `json:"hasAvatar"`
	AvatarVer    int    `json:"avatarVersion"`
	AvatarColor  string `json:"avatarColor"`
	CreatedAt    string `json:"createdAt"`
}

const userCols = `id,username,display_name,is_admin,totp_enabled,recovery_codes,avatar IS NOT NULL,avatar_version,avatar_color,created_at`

func scanUser(row interface{ Scan(...interface{}) error }) (*User, error) {
	var u User
	var admin, totp, avatar int
	var rec string
	if err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &admin, &totp, &rec, &avatar, &u.AvatarVer, &u.AvatarColor, &u.CreatedAt); err != nil {
		return nil, err
	}
	if totp != 0 {
		var hashes []string
		_ = json.Unmarshal([]byte(rec), &hashes)
		u.RecoveryLeft = len(hashes)
	}
	u.IsAdmin, u.TOTPEnabled, u.HasAvatar = admin != 0, totp != 0, avatar != 0
	if u.DisplayName == "" {
		u.DisplayName = u.Username
	}
	return &u, nil
}

func (s *Store) userByID(id string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE id=?`, id))
}

// needsSetup: nobody can sign in yet, so the first visit creates (or claims) the first user.
func (s *Store) needsSetup() (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT count(*) FROM users WHERE username <> ''`).Scan(&n)
	return n == 0, err
}

/* ---------- passwords: Argon2id ---------- */

const (
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 2
	argonKeyLen  = 32
)

func hashPassword(pw string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads, b64(salt), b64(key)), nil
}

func verifyPassword(encoded, pw string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var m uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[4])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[5])
	if err1 != nil || err2 != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash makes a sign-in for an unknown user cost as much as for a known one.
var dummyHash, _ = hashPassword("not a real password")

/* ---------- tokens and sessions ---------- */

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the system's random source failing is not recoverable
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func tokenHash(t string) string { s := sha256.Sum256([]byte(t)); return hex.EncodeToString(s[:]) }

func isSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Store) startSession(w http.ResponseWriter, r *http.Request, uid string) error {
	tok := randomToken(32)
	now := time.Now().UTC()
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now.Format(time.RFC3339)); err != nil {
		return err
	}
	if _, err := s.db.Exec(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)`,
		tokenHash(tok), uid, now.Format(time.RFC3339), now.Add(sessionTTL).Format(time.RFC3339)); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: tok, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isSecure(r)})
	return nil
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isSecure(r)})
}

// sessionUserID is the signed-in user of a request's session cookie, if any.
func (s *Store) sessionUserID(r *http.Request) (string, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return "", false
	}
	var uid string
	err = s.db.QueryRow(`SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?`,
		tokenHash(c.Value), time.Now().UTC().Format(time.RFC3339)).Scan(&uid)
	return uid, err == nil
}

// sameOrigin rejects cross-site writes made with the session cookie: a browser
// always sends Origin on a cross-origin POST/PUT/DELETE.
func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

var errUnauthorized = errors.New("sign in required")

// authenticate finds the principal of a request: an API key in the
// Authorization header, or the session cookie. Caller holds store.mu.
func (s *Store) authenticate(r *http.Request) (*Principal, error) {
	if h := r.Header.Get("Authorization"); h != "" {
		return s.keyPrincipal(h)
	}
	uid, ok := s.sessionUserID(r)
	if !ok {
		return nil, errUnauthorized
	}
	return &Principal{UserID: uid}, nil
}

// api wraps a data handler: it authenticates, checks the scope, holds the
// store lock and hands the handler the caller's own books.
func api(scope string, h func(w http.ResponseWriter, r *http.Request, b *Book)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		defer store.mu.Unlock()
		p, err := store.authenticate(r)
		if err != nil {
			writeErr(w, 401, err.Error())
			return
		}
		if p.KeyID == "" && r.Method != http.MethodGet && !sameOrigin(r) {
			writeErr(w, 403, "cross-site request refused")
			return
		}
		need := scope
		if need == "" { // read for GET, the handler's write scope otherwise
			need = ScopeRead
		}
		if !p.can(need) {
			writeErr(w, 403, "this API key lacks the "+need+" permission")
			return
		}
		b, err := store.book(p.UserID)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		h(w, r, b)
	}
}

// writeScope picks the scope for a handler that reads on GET and writes otherwise.
func writeScope(r *http.Request, write string) string {
	if r.Method == http.MethodGet {
		return ScopeRead
	}
	return write
}

// apiRW is api with read on GET and a write scope on everything else.
func apiRW(write string, h func(w http.ResponseWriter, r *http.Request, b *Book)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { api(writeScope(r, write), h)(w, r) }
}

// sessionOnly wraps account-management handlers: only a signed-in person,
// never an API key, may change sign-in methods, keys or users.
func sessionOnly(h func(w http.ResponseWriter, r *http.Request, u *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		defer store.mu.Unlock()
		uid, ok := store.sessionUserID(r)
		if !ok || r.Header.Get("Authorization") != "" {
			writeErr(w, 401, errUnauthorized.Error())
			return
		}
		if r.Method != http.MethodGet && !sameOrigin(r) {
			writeErr(w, 403, "cross-site request refused")
			return
		}
		u, err := store.userByID(uid)
		if err != nil {
			writeErr(w, 401, errUnauthorized.Error())
			return
		}
		h(w, r, u)
	}
}

/* ---------- sign-in throttling ---------- */

// failures counts recent failed sign-ins per client address, to slow guessing.
type failures struct {
	mu    sync.Mutex
	byKey map[string][]time.Time
}

var signinFailures = &failures{byKey: map[string][]time.Time{}}

const (
	failWindow = 15 * time.Minute
	failLimit  = 10
)

func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (f *failures) blocked(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	cut := time.Now().Add(-failWindow)
	recent := f.byKey[key][:0]
	for _, t := range f.byKey[key] {
		if t.After(cut) {
			recent = append(recent, t)
		}
	}
	f.byKey[key] = recent
	return len(recent) >= failLimit
}

func (f *failures) add(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byKey[key] = append(f.byKey[key], time.Now())
}

func (f *failures) reset(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.byKey, key)
}

/* ---------- validation ---------- */

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$`)

func validCredentials(username, password string) error {
	if !usernameRe.MatchString(username) {
		return fmt.Errorf("username must be 3-32 letters, digits, '.', '_' or '-'")
	}
	return validPassword(password)
}

func validPassword(pw string) error {
	if n := utf8.RuneCountInString(pw); n < minPassword || n > maxPassword {
		return fmt.Errorf("password must be %d-%d characters", minPassword, maxPassword)
	}
	return nil
}

func cleanDisplayName(n string) (string, error) {
	n = strings.TrimSpace(n)
	if utf8.RuneCountInString(n) > 60 {
		return "", fmt.Errorf("display name longer than 60 characters")
	}
	return n, nil
}

/* ---------- handlers ---------- */

type authStatus struct {
	NeedsSetup bool  `json:"needsSetup"`
	User       *User `json:"user"`
}

// GET /api/auth/status: whether the first user still has to be set up, and who is signed in.
func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	store.mu.Lock()
	defer store.mu.Unlock()
	setup, err := store.needsSetup()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := authStatus{NeedsSetup: setup}
	if uid, ok := store.sessionUserID(r); ok {
		out.User, _ = store.userByID(uid)
	}
	writeJSON(w, 200, out)
}

// POST /api/auth/setup: the first user. On a database from before users
// existed this claims the owner and their books; on a new one it creates
// the first user, an administrator, with the sample books to explore.
func handleSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Username, Password, DisplayName string }
	if !decode(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if err := validCredentials(body.Username, body.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	name, err := cleanDisplayName(body.DisplayName)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if setup, err := store.needsSetup(); err != nil || !setup {
		writeErr(w, 409, "already set up: sign in instead")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	uid := OwnerID
	var exists int
	_ = store.db.QueryRow(`SELECT count(*) FROM users WHERE id=?`, OwnerID).Scan(&exists)
	if exists == 1 {
		_, err = store.db.Exec(`UPDATE users SET username=?,display_name=?,password_hash=?,is_admin=1 WHERE id=?`, body.Username, name, hash, OwnerID)
	} else {
		uid = newID("usr")
		_, err = store.db.Exec(`INSERT INTO users(id,username,display_name,password_hash,is_admin,created_at) VALUES(?,?,?,?,1,?)`, uid, body.Username, name, hash, now)
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	b := &Book{s: store, uid: uid}
	if err := b.startBook(exists == 0); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := store.startSession(w, r, uid); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	u, _ := store.userByID(uid)
	writeJSON(w, 201, u)
}

// POST /api/auth/login {username, password}.
func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Username, Password string }
	if !decode(w, r, &body) {
		return
	}
	key := clientKey(r)
	if signinFailures.blocked(key) {
		writeErr(w, 429, "too many failed sign-ins; try again in a few minutes")
		return
	}
	store.mu.Lock()
	var uid, hash string
	err := store.db.QueryRow(`SELECT id,password_hash FROM users WHERE username=? COLLATE NOCASE AND username <> ''`, strings.TrimSpace(body.Username)).Scan(&uid, &hash)
	store.mu.Unlock()
	if err == sql.ErrNoRows || hash == "" {
		verifyPassword(dummyHash, body.Password) // same cost whether or not the user exists
		signinFailures.add(key)
		writeErr(w, 401, "wrong username or password")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if !verifyPassword(hash, body.Password) {
		signinFailures.add(key)
		writeErr(w, 401, "wrong username or password")
		return
	}
	signinFailures.reset(key)
	store.mu.Lock()
	defer store.mu.Unlock()
	var totp int
	_ = store.db.QueryRow(`SELECT totp_enabled FROM users WHERE id=?`, uid).Scan(&totp)
	if totp != 0 { // the password passed; the session waits for the code
		writeJSON(w, 200, map[string]interface{}{"totpRequired": true, "ticket": newTicket(uid)})
		return
	}
	finishSignIn(w, r, uid)
}

// finishSignIn starts the session once every required factor has passed.
func finishSignIn(w http.ResponseWriter, r *http.Request, uid string) {
	if err := store.startSession(w, r, uid); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	u, _ := store.userByID(uid)
	writeJSON(w, 200, u)
}

// POST /api/auth/logout ends this session.
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		store.mu.Lock()
		_, _ = store.db.Exec(`DELETE FROM sessions WHERE token_hash=?`, tokenHash(c.Value))
		store.mu.Unlock()
	}
	clearSessionCookie(w, r)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// GET/PUT /api/me: the signed-in user's profile.
func handleMe(w http.ResponseWriter, r *http.Request, u *User) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, u)
	case http.MethodPut:
		var body struct {
			DisplayName *string `json:"displayName"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.DisplayName != nil {
			name, err := cleanDisplayName(*body.DisplayName)
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET display_name=? WHERE id=?`, name, u.ID); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		u, _ = store.userByID(u.ID)
		writeJSON(w, 200, u)
	default:
		writeErr(w, 405, "GET or PUT only")
	}
}

// POST /api/me/password {current, new}: other sessions are signed out.
func handleChangePassword(w http.ResponseWriter, r *http.Request, u *User) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Current, New string }
	if !decode(w, r, &body) {
		return
	}
	var hash string
	if err := store.db.QueryRow(`SELECT password_hash FROM users WHERE id=?`, u.ID).Scan(&hash); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if hash != "" && !verifyPassword(hash, body.Current) {
		writeErr(w, 403, "current password is wrong")
		return
	}
	if err := validPassword(body.New); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	nh, err := hashPassword(body.New)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if _, err := store.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, nh, u.ID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	cur, _ := r.Cookie(sessionCookie)
	keep := ""
	if cur != nil {
		keep = tokenHash(cur.Value)
	}
	if _, err := store.db.Exec(`DELETE FROM sessions WHERE user_id=? AND token_hash<>?`, u.ID, keep); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// keyPrincipal resolves an "Authorization: Bearer <key>" header (ADR 0008).
func (s *Store) keyPrincipal(h string) (*Principal, error) {
	return nil, errUnauthorized
}
