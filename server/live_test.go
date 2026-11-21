// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Live updates (issue #55): every write to a user's books, from any path, sends
// that user's open event streams a "change" event with the new revision; reads
// send nothing, and other users hear nothing.

type sseEvent struct{ Name, Rev string }

type sseStream struct {
	events chan sseEvent
	done   chan struct{}
	cancel context.CancelFunc
}

// openEvents opens GET /api/events with the client's cookies (or an Authorization header).
func openEvents(t *testing.T, c *client, header ...string) *sseStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", c.srv.URL+"/api/events", nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := c.c.Do(req)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		cancel()
		t.Fatalf("events: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if resp.Header.Get("X-Accel-Buffering") != "no" || !strings.Contains(resp.Header.Get("Cache-Control"), "no-transform") {
		t.Errorf("proxy headers: %v", resp.Header)
	}
	s := &sseStream{events: make(chan sseEvent, 32), done: make(chan struct{}), cancel: cancel}
	go func() {
		defer close(s.done)
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		name := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				var d struct{ Rev string }
				_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &d)
				s.events <- sseEvent{name, d.Rev}
			}
		}
	}()
	t.Cleanup(cancel)
	return s
}

func (s *sseStream) next(t *testing.T, within time.Duration) (sseEvent, bool) {
	t.Helper()
	select {
	case e := <-s.events:
		return e, true
	case <-time.After(within):
		return sseEvent{}, false
	}
}

func (s *sseStream) expectChange(t *testing.T, what string) string {
	t.Helper()
	e, ok := s.next(t, 2*time.Second)
	if !ok || e.Name != "change" || e.Rev == "" {
		t.Fatalf("%s: no change event (%+v, %v)", what, e, ok)
	}
	// a write that reloads more than once may send a second notice; take the latest
	for {
		more, ok := s.next(t, 150*time.Millisecond)
		if !ok {
			return e.Rev
		}
		e = more
	}
}

func (s *sseStream) expectQuiet(t *testing.T, what string) {
	t.Helper()
	if e, ok := s.next(t, 300*time.Millisecond); ok {
		t.Fatalf("%s: unexpected event %+v", what, e)
	}
}

func stateRev(t *testing.T, c *client) string {
	t.Helper()
	var st map[string]interface{}
	if code := c.do("GET", "/api/state", nil, &st); code != 200 {
		t.Fatalf("state: %d", code)
	}
	rev, _ := st["rev"].(string)
	return rev
}

func TestLiveEvents(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	addTestUser(t, s, "bob", true)
	alice, bob, anon := newClient(t, srv), newClient(t, srv), newClient(t, srv)
	signedIn(t, alice, "alice")
	signedIn(t, bob, "bob")

	if code := anon.do("GET", "/api/events", nil, nil); code != 401 {
		t.Fatalf("signed out: %d", code)
	}
	if code := alice.do("POST", "/api/events", nil, nil); code != 405 {
		t.Fatalf("POST: %d", code)
	}

	a, b := openEvents(t, alice), openEvents(t, bob)
	ready, ok := a.next(t, 2*time.Second)
	if !ok || ready.Name != "ready" || ready.Rev != stateRev(t, alice) {
		t.Fatalf("ready: %+v, state rev %s", ready, stateRev(t, alice))
	}
	b.next(t, 2*time.Second) // bob's ready

	// reads announce nothing
	alice.do("GET", "/api/state", nil, nil)
	alice.do("GET", "/api/export", nil, nil)
	alice.do("GET", "/api/settings", nil, nil)
	a.expectQuiet(t, "reads")

	// a transaction from the web UI: alice's stream hears it, with the revision /api/state now reports
	var st struct {
		Accounts []Account `json:"accounts"`
		Tags     []Tag     `json:"tags"`
	}
	alice.do("GET", "/api/state", nil, &st)
	var own string
	for _, x := range st.Accounts {
		if x.Kind == "own" {
			own = x.ID
			break
		}
	}
	txn := map[string]interface{}{"type": "expense", "accountId": own, "amountMinor": 12300, "currency": "TWD", "date": time.Now().Format("2006-01-02"), "note": "Live lunch (fake)"}
	if code := alice.do("POST", "/api/transactions", txn, nil); code != 201 {
		t.Fatalf("add transaction: %d", code)
	}
	rev := a.expectChange(t, "web write")
	if rev == ready.Rev || rev != stateRev(t, alice) {
		t.Fatalf("revision after the write: event %s, ready %s, state %s", rev, ready.Rev, stateRev(t, alice))
	}
	b.expectQuiet(t, "another user's write")

	// an API key, through REST and through MCP (an assistant adding transactions)
	key := createKey(t, alice, "Bot", ScopeRead, ScopeTransactions, ScopeTags)
	bot := newClient(t, srv)
	if code := bot.do("POST", "/api/transactions", txn, nil, "Authorization", "Bearer "+key.Key); code != 201 {
		t.Fatalf("key write: %d", code)
	}
	a.expectChange(t, "API key write")
	var rpc map[string]interface{}
	if code := bot.do("POST", "/mcp", map[string]interface{}{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]interface{}{"name": "create_tag", "arguments": map[string]interface{}{"name": "Live tag (fake)"}}}, &rpc,
		"Authorization", "Bearer "+key.Key, "Accept", "application/json, text/event-stream"); code != 200 || rpc["error"] != nil {
		t.Fatalf("mcp: %d %v", code, rpc)
	}
	a.expectChange(t, "MCP tool")

	// settings, and a tag merge and its undo; its dry run is a read
	if code := alice.do("PUT", "/api/settings", map[string]interface{}{"general": map[string]interface{}{"defaultCurrency": "JPY"}}, nil); code != 200 {
		t.Fatalf("settings: %d", code)
	}
	a.expectChange(t, "settings")
	alice.do("GET", "/api/state", nil, &st)
	ids := map[string]string{}
	for _, x := range st.Tags {
		ids[x.Name] = x.ID
	}
	target, source := ids["Live tag (fake)"], ""
	for name, id := range ids {
		if name != "Live tag (fake)" {
			source = id
			break
		}
	}
	var p MergePreview
	if code := alice.do("POST", "/api/tags/"+target+"/merge", map[string]interface{}{"sourceIds": []string{source}, "dryRun": true}, &p); code != 200 {
		t.Fatalf("dry run: %d", code)
	}
	a.expectQuiet(t, "merge dry run")
	if code := alice.do("POST", "/api/tags/"+target+"/merge", map[string]interface{}{"sourceIds": []string{source}}, &p); code != 200 {
		t.Fatalf("merge: %d", code)
	}
	a.expectChange(t, "merge")
	if code := alice.do("POST", "/api/tag-merges/"+p.MergeID+"/undo", nil, nil); code != 200 {
		t.Fatalf("undo: %d", code)
	}
	a.expectChange(t, "undo")

	// a second page of alice's (another device) hears the same change
	a2 := openEvents(t, alice)
	a2.next(t, 2*time.Second)
	alice.do("POST", "/api/transactions", txn, nil)
	if r1, r2 := a.expectChange(t, "first page"), a2.expectChange(t, "second page"); r1 != r2 {
		t.Fatalf("two pages, two revisions: %s %s", r1, r2)
	}

	// closing a page unsubscribes it
	a2.cancel()
	<-a2.done
	deadline := time.Now().Add(2 * time.Second)
	for s.live.streams("usr-alice") != 1 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if n := s.live.streams("usr-alice"); n != 1 {
		t.Fatalf("streams after closing one: %d", n)
	}
}

func TestLiveEventsEndWhenSignedOut(t *testing.T) {
	prev := liveHeartbeat
	liveHeartbeat = 50 * time.Millisecond
	t.Cleanup(func() { liveHeartbeat = prev })
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	alice := newClient(t, srv)
	signedIn(t, alice, "alice")
	ev := openEvents(t, alice)
	ev.next(t, 2*time.Second)
	if code := alice.do("POST", "/api/auth/logout", nil, nil); code != 200 && code != 204 {
		t.Fatalf("logout: %d", code)
	}
	select {
	case <-ev.done:
	case <-time.After(2 * time.Second):
		t.Fatal("the stream stays open after signing out")
	}
}

func TestLiveEventsGenerateDue(t *testing.T) {
	s := openTestStore(t)
	b := addTestUser(t, s, "alice", true)
	before := s.live.revision(b.uid)
	n, err := b.GenerateDue(time.Now().AddDate(0, 2, 0).Format("2006-01-02"))
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Skip("the sample books have no template due")
	}
	if after := s.live.revision(b.uid); after == before {
		t.Fatalf("generated %d occurrences without a change notice", n)
	}
	// nothing left to generate: nothing to announce
	before = s.live.revision(b.uid)
	if n, _ := b.GenerateDue(time.Now().AddDate(0, 2, 0).Format("2006-01-02")); n != 0 || s.live.revision(b.uid) != before {
		t.Fatalf("a second run generated %d and changed the revision", n)
	}
}

func TestLiveHub(t *testing.T) {
	var h liveHub
	r0 := h.revision("u")
	ch, rev, ok := h.subscribe("u")
	if !ok || rev != r0 {
		t.Fatalf("subscribe: %v %s %s", ok, rev, r0)
	}
	h.changed("u")
	h.changed("u") // the stream has not read the first: no blocking, the newer one is dropped
	if got := <-ch; got == r0 {
		t.Fatalf("revision did not move: %s", got)
	}
	select {
	case got := <-ch:
		t.Fatalf("a second notice was queued: %s", got)
	default:
	}
	if h.revision("u") == r0 || h.revision("other") == h.revision("u") {
		t.Fatalf("revisions are per user: %s %s", h.revision("u"), h.revision("other"))
	}
	for i := 1; i < liveMaxStreams; i++ {
		if _, _, ok := h.subscribe("u"); !ok {
			t.Fatalf("stream %d refused", i+1)
		}
	}
	if _, _, ok := h.subscribe("u"); ok {
		t.Fatal("more than the limit of streams")
	}
	h.unsubscribe("u", ch)
	if _, _, ok := h.subscribe("u"); !ok {
		t.Fatal("a closed stream frees its place")
	}
}
