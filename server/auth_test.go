// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// testServer serves the full API over a fresh store; each client has its own cookies.
func testServer(t *testing.T) (*httptest.Server, *Store) {
	t.Helper()
	s := openTestStore(t)
	prev := store
	store = s
	srv := httptest.NewServer(newMux(""))
	t.Cleanup(func() { srv.Close(); store = prev })
	signinFailures.reset("127.0.0.1")
	return srv, s
}

type client struct {
	t   *testing.T
	srv *httptest.Server
	c   *http.Client
}

func newClient(t *testing.T, srv *httptest.Server) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, srv: srv, c: &http.Client{Jar: jar}}
}

// do sends JSON (body may be nil) and decodes the reply into out (may be nil).
func (c *client) do(method, path string, body interface{}, out interface{}, header ...string) int {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	res, err := c.c.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func TestFirstRunSetupAndSignIn(t *testing.T) {
	srv, _ := testServer(t)
	c := newClient(t, srv)
	var st authStatus
	if c.do("GET", "/api/auth/status", nil, &st); !st.NeedsSetup || st.User != nil {
		t.Fatalf("fresh install: %+v", st)
	}
	if code := c.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("books without signing in: %d", code)
	}
	if code := c.do("POST", "/api/auth/setup", map[string]string{"username": "al", "password": "correct horse"}, nil); code != 400 {
		t.Fatalf("short username accepted: %d", code)
	}
	if code := c.do("POST", "/api/auth/setup", map[string]string{"username": "alice", "password": "short"}, nil); code != 400 {
		t.Fatalf("short password accepted: %d", code)
	}
	var u User
	if code := c.do("POST", "/api/auth/setup", map[string]string{"username": "alice", "password": "correct horse", "displayName": "Alice"}, &u); code != 201 || !u.IsAdmin || u.DisplayName != "Alice" {
		t.Fatalf("setup: %d %+v", code, u)
	}
	var state map[string]json.RawMessage
	if code := c.do("GET", "/api/state", nil, &state); code != 200 || string(state["transactions"]) != "[]" {
		t.Fatalf("the first user starts with an empty book: %d %s", code, state["transactions"])
	}
	// only once
	other := newClient(t, srv)
	if code := other.do("POST", "/api/auth/setup", map[string]string{"username": "mallory", "password": "correct horse"}, nil); code != 409 {
		t.Fatalf("second setup: %d", code)
	}
	// sign out, then in again
	if code := c.do("POST", "/api/auth/logout", nil, nil); code != 200 {
		t.Fatalf("logout: %d", code)
	}
	if code := c.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("after logout: %d", code)
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "wrong horse"}, nil); code != 401 {
		t.Fatalf("wrong password: %d", code)
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"username": "nobody", "password": "correct horse"}, nil); code != 401 {
		t.Fatalf("unknown user: %d", code)
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"username": "ALICE", "password": "correct horse"}, nil); code != 200 {
		t.Fatalf("login (username is case-insensitive): %d", code)
	}
	if code := c.do("GET", "/api/state", nil, nil); code != 200 {
		t.Fatalf("after login: %d", code)
	}
}

func TestSetupClaimsTheOwnerOfAnOldDatabase(t *testing.T) {
	srv, s := testServer(t)
	// as migration 8 leaves it: an owner with books but no way to sign in
	if _, err := s.db.Exec(`INSERT INTO users(id,is_admin,created_at) VALUES(?,1,?)`, OwnerID, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	owner := &Book{s: s, uid: OwnerID}
	if err := owner.startBook(true); err != nil {
		t.Fatal(err)
	}
	if err := owner.insertAccount(Account{ID: "acc-mine", Name: "Mine", Kind: "own", Currency: "TWD"}); err != nil {
		t.Fatal(err)
	}
	c := newClient(t, srv)
	var u User
	if code := c.do("POST", "/api/auth/setup", map[string]string{"username": "hank", "password": "correct horse"}, &u); code != 201 || u.ID != OwnerID {
		t.Fatalf("claim: %d %+v", code, u)
	}
	var state struct{ Accounts []struct{ ID string } }
	c.do("GET", "/api/state", nil, &state)
	found := false
	for _, a := range state.Accounts {
		found = found || a.ID == "acc-mine"
	}
	if !found {
		t.Fatalf("the owner's books were not kept: %+v", state.Accounts)
	}
}

func TestUsersSeeOnlyTheirOwnBooks(t *testing.T) {
	srv, s := testServer(t)
	alice := addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", false)
	a, b := newClient(t, srv), newClient(t, srv)
	a.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)
	b.do("POST", "/api/auth/login", map[string]string{"username": "bob", "password": "correct horse"}, nil)
	var bs struct {
		Accounts     []map[string]interface{}
		Transactions []map[string]interface{}
	}
	b.do("GET", "/api/state", nil, &bs)
	if len(bs.Transactions) != 0 || len(bs.Accounts) != 1 {
		t.Fatalf("bob sees someone else's books: %d accounts, %d transactions", len(bs.Accounts), len(bs.Transactions))
	}
	// bob cannot change or delete alice's transaction by id
	victim := alice.data.Transactions[0]
	if code := b.do("PUT", "/api/transactions/"+victim.ID, map[string]interface{}{"type": "expense", "date": "2026-11-01", "accountId": "acc-a", "amountMinor": 1, "currency": "TWD"}, nil); code != 404 {
		t.Fatalf("bob edited alice's transaction: %d", code)
	}
	if code := b.do("DELETE", "/api/transactions/"+victim.ID, nil, nil); code != 404 {
		t.Fatalf("bob deleted alice's transaction: %d", code)
	}
	// bob's own writes land in bob's books only
	if code := b.do("POST", "/api/accounts", map[string]interface{}{"name": "Wallet", "currency": "USD"}, nil); code != 201 {
		t.Fatalf("bob adds an account: %d", code)
	}
	var as struct{ Accounts []struct{ Name string } }
	a.do("GET", "/api/state", nil, &as)
	for _, x := range as.Accounts {
		if x.Name == "Wallet" {
			t.Fatalf("bob's account appeared in alice's books")
		}
	}
	// settings are per user too
	b.do("PUT", "/api/settings", map[string]interface{}{"general": map[string]string{"defaultCurrency": "USD"}}, nil)
	var aset Settings
	a.do("GET", "/api/settings", nil, &aset)
	if aset.General.DefaultCurrency != "TWD" {
		t.Fatalf("bob's settings leaked to alice: %q", aset.General.DefaultCurrency)
	}
}

func TestCrossSiteWritesAreRefused(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	c := newClient(t, srv)
	c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)
	if code := c.do("POST", "/api/accounts", map[string]interface{}{"name": "x", "currency": "TWD"}, nil, "Origin", "https://evil.example"); code != 403 {
		t.Fatalf("cross-site write: %d", code)
	}
	if code := c.do("POST", "/api/accounts", map[string]interface{}{"name": "x", "currency": "TWD"}, nil, "Origin", srv.URL); code != 201 {
		t.Fatalf("same-site write: %d", code)
	}
}

func TestPasswordChangeSignsOutOtherSessions(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	laptop, phone := newClient(t, srv), newClient(t, srv)
	for _, c := range []*client{laptop, phone} {
		c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)
	}
	if code := laptop.do("POST", "/api/me/password", map[string]string{"current": "wrong", "new": "battery staple"}, nil); code != 403 {
		t.Fatalf("wrong current password: %d", code)
	}
	if code := laptop.do("POST", "/api/me/password", map[string]string{"current": "correct horse", "new": "battery staple"}, nil); code != 200 {
		t.Fatalf("change: %d", code)
	}
	if code := laptop.do("GET", "/api/me", nil, nil); code != 200 {
		t.Fatalf("this session stays: %d", code)
	}
	if code := phone.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("other session kept: %d", code)
	}
	if code := phone.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "battery staple"}, nil); code != 200 {
		t.Fatalf("new password: %d", code)
	}
}

func TestRepeatedFailedSignInsAreSlowedDown(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	c := newClient(t, srv)
	for i := 0; i < failLimit; i++ {
		c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "guess"}, nil)
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil); code != 429 {
		t.Fatalf("after %d failures: %d", failLimit, code)
	}
}
