// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.yaml.in/yaml/v3"
)

// api/openapi.yaml against the real route table (issue #102). The routes come
// from newMux in main.go, read with go/parser, and every spec path is routed
// through the real mux; methods, auth and status codes are checked by sending
// requests to it, since the handlers pick methods and sub-paths themselves.

// anyMethod lists the paths whose handlers answer every method alike; the spec
// documents GET for them (it says so in their descriptions). /api/state is a
// bug (issue #105): drop it here once its handler answers 405.
var anyMethod = map[string]bool{"/healthz": true, "/api/auth/status": true, "/api/state": true}

// notAPI lists registered patterns that are not part of the API: "/" is the web
// UI's files, registered only when there is a web UI to serve.
var notAPI = map[string]bool{"/": true}

var probeMethods = []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch}

type specOp struct {
	path, method string
	public       bool     // security: []
	session      bool     // the session cookie is accepted
	apiKey       bool     // an API key is accepted
	scope        string   // x-api-key-scope; "" is any key
	adminOnly    bool     // x-admin-only
	codes        []string // documented response codes
	stream       bool     // 200 is text/event-stream
}

func loadSpec(t *testing.T) (paths []string, ops map[string][]specOp) {
	t.Helper()
	b, err := os.ReadFile("../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Paths map[string]map[string]yaml.Node `yaml:"paths"`
	}
	if err := yaml.Unmarshal(b, &doc); err != nil {
		t.Fatalf("api/openapi.yaml: %v", err)
	}
	ops = map[string][]specOp{}
	for p, item := range doc.Paths {
		paths = append(paths, p)
		for m, node := range item {
			method := strings.ToUpper(m)
			if !slices.Contains(probeMethods, method) {
				if m != "parameters" {
					t.Errorf("%s: unexpected key %q", p, m)
				}
				continue
			}
			var op struct {
				Security  *[]map[string][]string `yaml:"security"`
				Scope     string                 `yaml:"x-api-key-scope"`
				Admin     bool                   `yaml:"x-admin-only"`
				Responses map[string]struct {
					Content map[string]interface{} `yaml:"content"`
				} `yaml:"responses"`
			}
			if err := node.Decode(&op); err != nil {
				t.Fatalf("%s %s: %v", method, p, err)
			}
			if op.Security == nil {
				t.Errorf("%s %s: no security; write security: [] for a public operation", method, p)
				continue
			}
			o := specOp{path: p, method: method, public: len(*op.Security) == 0, scope: op.Scope, adminOnly: op.Admin}
			for _, req := range *op.Security {
				for name := range req {
					switch name {
					case "session":
						o.session = true
					case "apiKey":
						o.apiKey = true
					default:
						t.Errorf("%s %s: unknown security scheme %q", method, p, name)
					}
				}
			}
			if o.scope != "" && (!o.apiKey || !slices.Contains(allScopes, o.scope)) {
				t.Errorf("%s %s: x-api-key-scope %q needs an apiKey requirement and a known scope", method, p, o.scope)
			}
			for code, r := range op.Responses {
				o.codes = append(o.codes, code)
				if _, ok := r.Content["text/event-stream"]; ok && code == "200" {
					o.stream = true
				}
			}
			ops[p] = append(ops[p], o)
		}
	}
	sort.Strings(paths)
	return paths, ops
}

// registeredPatterns are the patterns newMux passes to mux.Handle and mux.HandleFunc.
func registeredPatterns(t *testing.T) []string {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, d := range f.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "newMux" {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != "HandleFunc" && sel.Sel.Name != "Handle") {
				return true
			}
			if x, ok := sel.X.(*ast.Ident); !ok || x.Name != "mux" {
				return true
			}
			lit, ok := call.Args[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				t.Errorf("newMux registers a route that is not a string literal: %v", call.Args[0])
				return true
			}
			p, _ := strconv.Unquote(lit.Value)
			out = append(out, p)
			return true
		})
	}
	if len(out) < 10 {
		t.Fatalf("found only %d routes in newMux", len(out))
	}
	return out
}

// probeEnv is a fresh store: alice, an administrator with the sample books, and
// bob, who is not one, with sessions and API keys made directly in the database.
type probeEnv struct {
	mux      *http.ServeMux
	alice    *Book
	ids      map[string]string // path prefix before {id} → an id that exists
	admin    string            // session tokens
	nonAdmin string
}

func newProbeEnv(t *testing.T) *probeEnv {
	t.Helper()
	s := openTestStore(t)
	prev := store
	store = s
	t.Cleanup(func() { store = prev })
	signinFailures.reset("192.0.2.1")
	alice := addTestUser(t, s, "alice", true)
	bob := addTestUser(t, s, "bob", false)
	if _, err := s.db.Exec(`UPDATE users SET is_admin=1 WHERE id=?`, alice.uid); err != nil {
		t.Fatal(err)
	}
	e := &probeEnv{mux: newMux(""), alice: alice}
	e.admin, e.nonAdmin = e.session(t, alice.uid), e.session(t, bob.uid)
	victim := "key-victim"
	e.insertKey(t, victim, alice.uid, []string{ScopeRead})
	d := alice.data
	if len(d.Accounts) == 0 || len(d.Tags) == 0 || len(d.Reserves) == 0 || len(d.Allocations) == 0 ||
		len(d.Transactions) == 0 || len(d.TransactionTemplates) == 0 {
		t.Fatal("the sample books lack a record to probe with")
	}
	e.ids = map[string]string{
		"/api/accounts/": d.Accounts[0].ID, "/api/tags/": d.Tags[0].ID, "/api/tag-merges/": "mrg-none",
		"/api/reserves/": d.Reserves[0].ID, "/api/allocations/": d.Allocations[0].ID,
		"/api/transactions/": d.Transactions[0].ID, "/api/templates/": d.TransactionTemplates[0].ID,
		"/api/users/": bob.uid, "/api/me/keys/": victim, "/api/me/passkeys/": "pk-none",
	}
	return e
}

func (e *probeEnv) session(t *testing.T, uid string) string {
	t.Helper()
	tok := randomToken(32)
	now := time.Now().UTC()
	if _, err := store.db.Exec(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)`,
		tokenHash(tok), uid, now.Format(time.RFC3339), now.Add(time.Hour).Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	return tok
}

func (e *probeEnv) insertKey(t *testing.T, id, uid string, scopes []string) string {
	t.Helper()
	secret := keyPrefix + randomToken(32)
	if _, err := store.db.Exec(`INSERT INTO api_keys(id,user_id,name,hint,key_hash,scopes,created_at) VALUES(?,?,?,?,?,?,?)`,
		id, uid, id, "kst_…", tokenHash(secret), strings.Join(scopes, ","), time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	return secret
}

// key is a new key of alice's with these scopes.
func (e *probeEnv) key(t *testing.T, scopes ...string) string {
	return e.insertKey(t, newID("key"), e.alice.uid, scopes)
}

var pathParam = regexp.MustCompile(`\{[^}/]+\}`)

// concrete fills a spec path's {id} with a record that exists.
func (e *probeEnv) concrete(t *testing.T, p string) string {
	t.Helper()
	i := strings.Index(p, "{")
	if i < 0 {
		return p
	}
	id, ok := e.ids[p[:i]]
	if !ok {
		t.Fatalf("%s: add an id for %s to newProbeEnv", p, p[:i])
	}
	return pathParam.ReplaceAllString(p, id)
}

type probe struct {
	code int
	err  string
}

// missed: the request reached no handler that serves this method and path.
func (r probe) missed() bool {
	return r.code == http.StatusMethodNotAllowed || (r.code == http.StatusNotFound && (r.err == "not found" || r.err == ""))
}

// send makes a request with an empty body; cookie is a session token, key an API key.
func (e *probeEnv) send(method, path, cookie, key string, stream bool) probe {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = "192.0.2.1:1234"
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: cookie})
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	if stream { // an event stream ends when its request does: end it at once
		ctx, cancel := context.WithCancel(req.Context())
		cancel()
		req = req.WithContext(ctx)
	}
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, req)
	var body struct {
		Error string `json:"error"`
	}
	if strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		_ = json.Unmarshal(w.Body.Bytes(), &body)
	}
	return probe{w.Code, body.Error}
}

func TestOpenAPICoversRoutes(t *testing.T) {
	paths, ops := loadSpec(t)
	patterns := registeredPatterns(t)

	// every spec path is routed to a registered API pattern, and every pattern has a spec path
	e := newProbeEnv(t)
	covered := map[string]bool{}
	for _, p := range paths {
		_, pattern := e.mux.Handler(httptest.NewRequest(http.MethodGet, e.concrete(t, p), nil))
		if pattern == "" || notAPI[pattern] || !slices.Contains(patterns, pattern) {
			t.Errorf("api/openapi.yaml lists %s, which no API route in newMux serves (pattern %q)", p, pattern)
			continue
		}
		covered[pattern] = true
	}
	for _, p := range patterns {
		if !notAPI[p] && !covered[p] {
			t.Errorf("newMux registers %s, but api/openapi.yaml has no path it serves", p)
		}
	}

	others := func(scope string) []string {
		var out []string
		for _, s := range allScopes {
			if s != scope {
				out = append(out, s)
			}
		}
		return out
	}
	for _, p := range paths {
		documented := map[string]bool{}
		for _, o := range ops[p] {
			documented[o.method] = true
		}
		// a method the spec leaves out reaches no handler
		if !anyMethod[p] {
			e := newProbeEnv(t)
			for _, m := range probeMethods {
				if !documented[m] {
					if r := e.send(m, e.concrete(t, p), e.admin, "", false); !r.missed() {
						t.Errorf("%s %s answers %d %q, but api/openapi.yaml does not list it", m, p, r.code, r.err)
					}
				}
			}
		}
		// each documented operation: its handler, auth and status codes
		for _, o := range ops[p] {
			e := newProbeEnv(t)
			path := e.concrete(t, p)
			name := o.method + " " + p
			check := func(who string, r probe, want ...int) {
				t.Helper()
				if r.missed() {
					t.Errorf("%s (%s): reaches no handler: %d %q", name, who, r.code, r.err)
				}
				if len(want) > 0 && !slices.Contains(want, r.code) {
					t.Errorf("%s (%s): got %d %q, want %v", name, who, r.code, r.err, want)
				}
				if !slices.Contains(o.codes, strconv.Itoa(r.code)) && !slices.Contains(o.codes, "default") {
					t.Errorf("%s (%s): answers %d %q, which api/openapi.yaml does not document", name, who, r.code, r.err)
				}
			}
			notAuthErr := func(who string, r probe) {
				t.Helper()
				check(who, r)
				if r.code == 401 || r.code == 403 {
					t.Errorf("%s (%s): refused: %d %q", name, who, r.code, r.err)
				}
			}
			send := func(cookie, key string) probe { return e.send(o.method, path, cookie, key, o.stream) }

			if o.public {
				notAuthErr("signed out", send("", ""))
				notAuthErr("session", send(e.session(t, e.alice.uid), ""))
				continue
			}
			check("signed out", send("", ""), 401)
			if o.adminOnly {
				check("not an administrator", send(e.nonAdmin, ""), 403)
			}
			if !o.session {
				check("session without a key", send(e.admin, ""), 401)
			}
			if o.apiKey {
				if o.scope != "" {
					check("key without "+o.scope, send("", e.key(t, others(o.scope)...)), 403)
					notAuthErr("key with "+o.scope, send("", e.key(t, o.scope)))
				} else {
					notAuthErr("key", send("", e.key(t, ScopeTransactions)))
				}
			} else {
				check("key", send("", e.key(t, allScopes...)), 401)
			}
			if o.session {
				notAuthErr("session", send(e.session(t, e.alice.uid), ""))
			}
		}
	}
}
