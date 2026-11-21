// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Live updates (issue #55, ADR 0023): after any write to a user's books, from the
// web UI, the REST API, MCP tools, template generation or an undo, the user's
// open pages get a "change" event over Server-Sent Events and fetch the books
// again. Events carry only a revision, never book data.
//
// Every write path ends in Book.reload() (or a settings write), so that is where
// changes are announced. The revision is "<start>-<n>": n counts the user's
// changes since this server started, so a page compares revisions for equality
// only; after a restart the prefix differs and the page fetches again.

const liveMaxStreams = 16 // open event streams per user; more are refused

// liveHeartbeat: a comment line this often keeps proxies from closing an idle
// stream, and the sign-in is checked again (a variable so tests can shorten it).
var liveHeartbeat = 25 * time.Second

type liveHub struct {
	mu    sync.Mutex
	start string
	rev   map[string]uint64
	subs  map[string]map[chan string]struct{}
}

func (h *liveHub) init() {
	if h.rev == nil {
		h.start = strconv.FormatInt(time.Now().UnixNano(), 36)
		h.rev = map[string]uint64{}
		h.subs = map[string]map[chan string]struct{}{}
	}
}

func (h *liveHub) revLocked(uid string) string {
	return fmt.Sprintf("%s-%d", h.start, h.rev[uid])
}

// revision is the user's current revision, as /api/state reports it.
func (h *liveHub) revision(uid string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.init()
	return h.revLocked(uid)
}

// changed counts a change to the user's books and tells their open streams.
// It never blocks: a stream that has not taken the last notice yet keeps that
// one, and the page fetches the latest books either way.
func (h *liveHub) changed(uid string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.init()
	h.rev[uid]++
	rev := h.revLocked(uid)
	for ch := range h.subs[uid] {
		select {
		case ch <- rev:
		default:
		}
	}
}

// subscribe opens a stream for the user; ok is false when they have too many open.
func (h *liveHub) subscribe(uid string) (ch chan string, rev string, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.init()
	if len(h.subs[uid]) >= liveMaxStreams {
		return nil, "", false
	}
	ch = make(chan string, 1)
	if h.subs[uid] == nil {
		h.subs[uid] = map[chan string]struct{}{}
	}
	h.subs[uid][ch] = struct{}{}
	return ch, h.revLocked(uid), true
}

func (h *liveHub) unsubscribe(uid string, ch chan string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs[uid], ch)
	if len(h.subs[uid]) == 0 {
		delete(h.subs, uid)
	}
}

// streams counts a user's open event streams (for tests).
func (h *liveHub) streams(uid string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs[uid])
}

// GET /api/events: a Server-Sent Events stream of "change" events for the
// signed-in user (or an API key with read access). It authenticates like every
// other endpoint, then lets go of the store lock for as long as it stays open,
// and checks the sign-in again with each heartbeat.
func handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "GET only")
		return
	}
	auth := func() (*Principal, int, string) {
		store.mu.Lock()
		defer store.mu.Unlock()
		p, err := store.authenticate(r)
		if err != nil {
			return nil, 401, err.Error()
		}
		if !p.can(ScopeRead) {
			return nil, 403, "this API key lacks the " + ScopeRead + " permission"
		}
		return p, 0, ""
	}
	p, code, why := auth()
	if p == nil {
		writeErr(w, code, why)
		return
	}
	hub := &store.live
	ch, rev, ok := hub.subscribe(p.UserID)
	if !ok {
		writeErr(w, 429, "too many open event streams")
		return
	}
	defer hub.unsubscribe(p.UserID, ch)

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // a long-lived response: no write deadline
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-store, no-transform")
	h.Set("X-Accel-Buffering", "no") // nginx and similar proxies: pass each event on at once
	w.WriteHeader(200)
	send := func(format string, args ...interface{}) bool {
		if _, err := fmt.Fprintf(w, format, args...); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	// retry: how long a browser waits before reconnecting; ready: the revision the stream starts at
	if !send("retry: 3000\nevent: ready\ndata: {\"rev\":%q}\n\n", rev) {
		return
	}
	tick := time.NewTicker(liveHeartbeat)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case rev := <-ch:
			if !send("event: change\ndata: {\"rev\":%q}\n\n", rev) {
				return
			}
		case <-tick.C:
			if again, _, _ := auth(); again == nil || again.UserID != p.UserID {
				return // signed out, or the key was revoked: the stream ends
			}
			if !send(": keep-alive\n\n") {
				return
			}
		}
	}
}
