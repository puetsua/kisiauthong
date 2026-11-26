// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Compressed JSON answers (issue #132): JSON goes out gzip-compressed when the
// request accepts it, with Vary: Accept-Encoding and a correct Content-Length;
// the live event stream, images and small answers are left alone.

// rawGet sends GET path with the given Accept-Encoding ("" sends none) and
// returns the answer with its body exactly as it came over the wire.
func rawGet(t *testing.T, c *client, path, acceptEncoding string) (*http.Response, []byte) {
	t.Helper()
	tr := &http.Transport{DisableCompression: true} // no transparent decoding: we check the bytes
	t.Cleanup(tr.CloseIdleConnections)
	hc := &http.Client{Jar: c.c.Jar, Transport: tr}
	req, _ := http.NewRequest("GET", c.srv.URL+path, nil)
	if acceptEncoding != "" {
		req.Header.Set("Accept-Encoding", acceptEncoding)
	}
	res, err := hc.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("GET %s: read: %v", path, err)
	}
	return res, body
}

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return out
}

func hasVaryAcceptEncoding(h http.Header) bool {
	for _, v := range h.Values("Vary") {
		for _, f := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(f), "Accept-Encoding") {
				return true
			}
		}
	}
	return false
}

// checkLength fails unless a Content-Length, when present, is the length of the bytes sent.
func checkLength(t *testing.T, what string, res *http.Response, body []byte) {
	t.Helper()
	if cl := res.Header.Get("Content-Length"); cl != "" && cl != strconv.Itoa(len(body)) {
		t.Errorf("%s: Content-Length %s for %d bytes on the wire", what, cl, len(body))
	}
	if res.ContentLength >= 0 && res.ContentLength != int64(len(body)) {
		t.Errorf("%s: ContentLength %d for %d bytes on the wire", what, res.ContentLength, len(body))
	}
}

func TestGzipState(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	c := newClient(t, srv)
	signedIn(t, c, "alice")

	plainRes, plain := rawGet(t, c, "/api/state", "")
	if plainRes.StatusCode != 200 || plainRes.Header.Get("Content-Encoding") != "" {
		t.Fatalf("no Accept-Encoding: %d %q", plainRes.StatusCode, plainRes.Header.Get("Content-Encoding"))
	}
	if !hasVaryAcceptEncoding(plainRes.Header) {
		t.Errorf("a plain JSON answer lacks Vary: Accept-Encoding: %v", plainRes.Header)
	}
	if len(plain) < gzipMinSize {
		t.Fatalf("the sample state is only %d bytes: the test needs a body worth compressing", len(plain))
	}
	checkLength(t, "plain", plainRes, plain)

	for _, ae := range []string{"gzip", "gzip, deflate, br, zstd", "br;q=1.0, gzip;q=0.8", "*"} {
		res, wire := rawGet(t, c, "/api/state", ae)
		if res.StatusCode != 200 || res.Header.Get("Content-Encoding") != "gzip" {
			t.Fatalf("Accept-Encoding %q: %d %q", ae, res.StatusCode, res.Header.Get("Content-Encoding"))
		}
		if !hasVaryAcceptEncoding(res.Header) {
			t.Errorf("Accept-Encoding %q: no Vary: Accept-Encoding: %v", ae, res.Header)
		}
		if ct := res.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Accept-Encoding %q: Content-Type %q", ae, ct)
		}
		checkLength(t, "gzip", res, wire)
		if len(wire) >= len(plain)/2 {
			t.Errorf("Accept-Encoding %q: %d bytes compressed from %d", ae, len(wire), len(plain))
		}
		// the same books either way (only "today"-independent bytes: the same request twice)
		if got := gunzip(t, wire); !bytes.Equal(got, plain) {
			t.Errorf("Accept-Encoding %q: the decompressed body differs from the plain one", ae)
		}
	}

	for _, ae := range []string{"identity", "gzip;q=0", "br", "*;q=0", "gzip;q=0, *"} {
		res, wire := rawGet(t, c, "/api/state", ae)
		if res.Header.Get("Content-Encoding") != "" || !bytes.Equal(wire, plain) {
			t.Errorf("Accept-Encoding %q: got %q, %d bytes", ae, res.Header.Get("Content-Encoding"), len(wire))
		}
		if !hasVaryAcceptEncoding(res.Header) {
			t.Errorf("Accept-Encoding %q: no Vary: Accept-Encoding", ae)
		}
		checkLength(t, ae, res, wire)
	}

	// the ordinary Go client asks for gzip itself and reads the books as usual
	var st map[string]interface{}
	if code := c.do("GET", "/api/state", nil, &st); code != 200 || st["accounts"] == nil {
		t.Fatalf("decoded state: %d %v", code, st != nil)
	}
}

// A JSON answer too small to gain from gzip goes out plain, with its length.
func TestGzipSmallAnswerStaysPlain(t *testing.T) {
	srv, _ := testServer(t)
	c := newClient(t, srv)
	for _, path := range []string{"/healthz", "/api/auth/status", "/api/state"} { // the last one: 401
		res, wire := rawGet(t, c, path, "gzip")
		if res.Header.Get("Content-Encoding") != "" {
			t.Errorf("%s: %d-byte answer compressed", path, len(wire))
		}
		if res.Header.Get("Content-Length") != strconv.Itoa(len(wire)) {
			t.Errorf("%s: Content-Length %q for %d bytes", path, res.Header.Get("Content-Length"), len(wire))
		}
		if !hasVaryAcceptEncoding(res.Header) {
			t.Errorf("%s: no Vary: Accept-Encoding", path)
		}
	}
}

// The export download is JSON too, and stays a download.
func TestGzipExport(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	c := newClient(t, srv)
	signedIn(t, c, "alice")
	_, plain := rawGet(t, c, "/api/export", "")
	res, wire := rawGet(t, c, "/api/export", "gzip")
	if res.Header.Get("Content-Encoding") != "gzip" || !strings.HasPrefix(res.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatalf("export: %v", res.Header)
	}
	if !bytes.Equal(gunzip(t, wire), plain) {
		t.Error("the decompressed export differs from the plain one")
	}
}

// The avatar is an image: it goes out as it is, whatever the request accepts.
func TestGzipLeavesImagesAlone(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	c := newClient(t, srv)
	signedIn(t, c, "alice")
	if code := c.do("PUT", "/api/me/avatar", map[string]string{"image": pngDataURL(t, 256)}, nil); code != 200 {
		t.Fatalf("upload: %d", code)
	}
	_, plain := rawGet(t, c, "/api/users/usr-alice/avatar", "")
	res, wire := rawGet(t, c, "/api/users/usr-alice/avatar", "gzip")
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("avatar: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	if res.Header.Get("Content-Encoding") != "" || hasVaryAcceptEncoding(res.Header) || !bytes.Equal(wire, plain) {
		t.Errorf("avatar touched: %v, %d bytes (plain %d)", res.Header, len(wire), len(plain))
	}
	checkLength(t, "avatar", res, wire)
}

// The live event stream is never compressed or held back: the first event
// arrives at once, and a change arrives as soon as the books change.
func TestGzipLeavesEventStreamAlone(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	c := newClient(t, srv)
	signedIn(t, c, "alice")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tr := &http.Transport{DisableCompression: true}
	defer tr.CloseIdleConnections()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := (&http.Client{Jar: c.c.Jar, Transport: tr}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Encoding") != "" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("events: %v", res.Header)
	}
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	waitFor := func(prefix string) {
		t.Helper()
		deadline := time.After(2 * time.Second)
		for {
			select {
			case l, ok := <-lines:
				if !ok {
					t.Fatalf("stream ended before %q", prefix)
				}
				if strings.HasPrefix(l, prefix) {
					return
				}
			case <-deadline:
				t.Fatalf("no %q within 2s: the stream is held back", prefix)
			}
		}
	}
	waitFor("event: ready")
	txn := map[string]interface{}{"type": "expense", "accountId": "acc-a", "amountMinor": 12300, "currency": "TWD", "date": time.Now().Format("2006-01-02"), "note": "Gzip lunch (fake)"}
	if code := c.do("POST", "/api/transactions", txn, nil); code != 201 {
		t.Fatalf("add transaction: %d", code)
	}
	waitFor("event: change")
}

// The wrapper on its own: what it compresses and what it leaves alone.
func TestGzipWriter(t *testing.T) {
	big := strings.Repeat(`{"note":"fake coffee"},`, 200)
	serve := func(method string, h http.HandlerFunc) (*httptest.ResponseRecorder, []byte) {
		req := httptest.NewRequest(method, "/x", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()
		withGzip(h).ServeHTTP(rec, req)
		return rec, rec.Body.Bytes()
	}

	t.Run("json with a Content-Length of its own", func(t *testing.T) {
		rec, body := serve("GET", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Content-Length", strconv.Itoa(len(big)))
			_, _ = io.WriteString(w, big)
		})
		if rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Content-Length") != "" {
			t.Fatalf("headers: %v", rec.Header())
		}
		if string(gunzip(t, body)) != big {
			t.Error("body differs")
		}
	})
	t.Run("json written in many small pieces", func(t *testing.T) {
		rec, body := serve("GET", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(201)
			for i := 0; i < len(big); i += 7 {
				_, _ = io.WriteString(w, big[i:min(i+7, len(big))])
			}
		})
		if rec.Code != 201 || rec.Header().Get("Content-Encoding") != "gzip" || string(gunzip(t, body)) != big {
			t.Fatalf("%d %v", rec.Code, rec.Header())
		}
	})
	t.Run("an error answer is compressed too", func(t *testing.T) {
		rec, body := serve("GET", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(400)
			_, _ = io.WriteString(w, big)
		})
		if rec.Code != 400 || string(gunzip(t, body)) != big {
			t.Fatalf("%d %v", rec.Code, rec.Header())
		}
	})
	for _, tc := range []struct {
		name string
		h    http.HandlerFunc
	}{
		{"an image", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			_, _ = io.WriteString(w, big)
		}},
		{"json that is already encoded", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Encoding", "br")
			_, _ = io.WriteString(w, big)
		}},
		{"an event stream", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, big)
		}},
		{"a byte range of a JSON file", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Range", "bytes 0-"+strconv.Itoa(len(big)-1)+"/99999")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, big)
		}},
		{"no content", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(204)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec, body := serve("GET", tc.h)
			if rec.Header().Get("Content-Encoding") == "gzip" || bytes.HasPrefix(body, []byte{0x1f, 0x8b}) {
				t.Fatalf("compressed: %v", rec.Header())
			}
			if tc.name != "no content" && string(body) != big {
				t.Error("body changed")
			}
		})
	}
	t.Run("HEAD", func(t *testing.T) {
		rec, _ := serve("HEAD", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, big)
		})
		if rec.Header().Get("Content-Encoding") != "" {
			t.Fatalf("HEAD says gzip: %v", rec.Header())
		}
	})
	t.Run("a flush sends what is held", func(t *testing.T) {
		rec, body := serve("GET", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"a":`)
			if err := http.NewResponseController(w).Flush(); err != nil {
				t.Errorf("flush: %v", err)
			}
			_, _ = io.WriteString(w, `1}`)
		})
		if !rec.Flushed || string(gunzip(t, body)) != `{"a":1}` {
			t.Fatalf("flushed %v, %v", rec.Flushed, rec.Header())
		}
	})
}

func TestAcceptsGzip(t *testing.T) {
	for h, want := range map[string]bool{
		"":                      false,
		"gzip":                  true,
		"GZIP":                  true,
		"deflate, gzip;q=1.0":   true,
		"gzip;q=0.001":          true,
		"gzip;q=0":              false,
		"gzip; q=0.0":           false,
		"identity":              false,
		"br, zstd":              false,
		"*":                     true,
		"*;q=0":                 false,
		"gzip;q=0, *":           false,
		"*, gzip;q=0":           false,
		"gzip;q=nonsense":       false,
		"x-gzip":                false,
		"gzip;level=9":          true,
		" gzip , deflate , br ": true,
	} {
		if got := acceptsGzip(h); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", h, got, want)
		}
	}
}
