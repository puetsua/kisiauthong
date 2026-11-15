// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBasePath(t *testing.T) {
	for in, want := range map[string]string{"": "/", "/": "/", "kisiauthong": "/kisiauthong/", "/kisiauthong": "/kisiauthong/", "/a/b/": "/a/b/"} {
		if got := normBasePath(in); got != want {
			t.Errorf("normBasePath(%q) = %q", in, want)
		}
	}
	s := openTestStore(t)
	prev, prevBase := store, basePath
	store, basePath = s, "/kisiauthong/"
	t.Cleanup(func() { store, basePath = prev, prevBase })
	srv := httptest.NewServer(withBasePath(newMux(""), basePath))
	t.Cleanup(srv.Close)
	c := newClient(t, srv)
	c.c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	var st authStatus
	if code := c.do("GET", "/kisiauthong/api/auth/status", nil, &st); code != 200 || !st.NeedsSetup {
		t.Fatalf("under the base path: %d %+v", code, st)
	}
	if code := c.do("GET", "/api/auth/status", nil, nil); code != 404 {
		t.Fatalf("outside the base path: %d", code)
	}
	if code := c.do("GET", "/healthz", nil, nil); code != 200 {
		t.Fatalf("healthz at the root: %d", code)
	}
	res, err := c.c.Get(srv.URL + "/kisiauthong")
	if err != nil || res.StatusCode != 301 || res.Header.Get("Location") != "/kisiauthong/" {
		t.Fatalf("redirect to the trailing slash: %v %+v", err, res)
	}
	// the session cookie belongs to the base path only
	req, _ := http.NewRequest("POST", srv.URL+"/kisiauthong/api/auth/setup", strings.NewReader(`{"username":"alice","password":"correct horse"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 201 {
		t.Fatalf("setup: %v %+v", err, res)
	}
	if ck := res.Header.Get("Set-Cookie"); !strings.Contains(ck, "Path=/kisiauthong/") {
		t.Fatalf("cookie path: %s", ck)
	}
	if code := c.do("GET", "/kisiauthong/api/state", nil, nil); code != 401 {
		t.Fatalf("no cookie, no books: %d", code)
	}
}
