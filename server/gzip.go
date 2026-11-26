// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

package main

import (
	"compress/gzip"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// gzipMinSize is the smallest JSON body worth compressing: below it the gzip
// header and the work cost more than they save, and the answer goes out plain
// with its Content-Length.
const gzipMinSize = 1024

var gzipPool = sync.Pool{New: func() interface{} { return gzip.NewWriter(nil) }}

// withGzip compresses JSON answers with gzip when the request accepts it
// (issue #132): GET /api/state carries the whole books and is fetched again
// after every write and every live update, so on a phone it is most of the wait.
// Only application/json bodies are touched. The live event stream
// (/api/events) is left out by path, so nothing ever buffers it, and so is
// everything that is not JSON (the web UI's files, avatars and other images)
// or already carries a Content-Encoding. Every JSON answer says
// Vary: Accept-Encoding, compressed or not.
func withGzip(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/events" {
			h.ServeHTTP(w, r)
			return
		}
		gw := &gzipWriter{ResponseWriter: w, accept: acceptsGzip(r.Header.Get("Accept-Encoding")), head: r.Method == http.MethodHead}
		h.ServeHTTP(gw, r)
		gw.finish()
	})
}

// acceptsGzip tells whether an Accept-Encoding header allows gzip
// (an explicit "gzip" or "*" with a q-value above zero).
func acceptsGzip(header string) bool {
	star := false
	for _, part := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(part, ";")
		name = strings.ToLower(strings.TrimSpace(name))
		if name != "gzip" && name != "*" {
			continue
		}
		ok := true
		for _, p := range strings.Split(params, ";") {
			k, v, _ := strings.Cut(p, "=")
			if strings.EqualFold(strings.TrimSpace(k), "q") {
				q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				ok = err == nil && q > 0
			}
		}
		if name == "gzip" {
			return ok // an explicit gzip entry wins over "*"
		}
		star = ok
	}
	return star
}

// gzipWriter holds a JSON answer's status and first bytes back until it knows
// whether the body is worth compressing; anything else passes straight through.
type gzipWriter struct {
	http.ResponseWriter
	accept bool // the request accepts gzip
	head   bool // a HEAD request: there is no body to compress

	code    int    // the status held back while buf fills; 0 before WriteHeader
	buf     []byte // the body so far, while it is shorter than gzipMinSize
	decided bool   // the status went out: plain or gz from here on
	gz      *gzip.Writer
}

// jsonAnswer tells whether the answer about to go out is JSON with a body
// that has no encoding yet.
func (g *gzipWriter) jsonAnswer(code int) bool {
	if code < 200 || code == http.StatusNoContent || code == http.StatusNotModified || code == http.StatusPartialContent || g.head {
		return false
	}
	h := g.Header()
	if h.Get("Content-Encoding") != "" || h.Get("Content-Range") != "" {
		return false // already encoded, or a byte range of the plain file
	}
	mt, _, err := mime.ParseMediaType(h.Get("Content-Type"))
	return err == nil && mt == "application/json"
}

func (g *gzipWriter) WriteHeader(code int) {
	if g.decided || g.code != 0 {
		return // the status is already set; net/http would warn about a second one
	}
	if code >= 100 && code < 200 {
		g.ResponseWriter.WriteHeader(code) // informational: the real status comes later
		return
	}
	if !g.jsonAnswer(code) {
		g.decided = true
		g.ResponseWriter.WriteHeader(code)
		return
	}
	g.Header().Add("Vary", "Accept-Encoding")
	if !g.accept {
		g.decided = true
		g.ResponseWriter.WriteHeader(code)
		return
	}
	g.code = code // held: the body decides between plain and gzip
}

func (g *gzipWriter) Write(p []byte) (int, error) {
	if !g.decided && g.code == 0 {
		g.WriteHeader(http.StatusOK)
	}
	if g.decided {
		if g.gz != nil {
			return g.gz.Write(p)
		}
		return g.ResponseWriter.Write(p)
	}
	g.buf = append(g.buf, p...)
	if len(g.buf) >= gzipMinSize {
		if err := g.startGzip(); err != nil {
			return 0, err
		}
	}
	return len(p), nil
}

// startGzip sends the held status with Content-Encoding: gzip and compresses
// the held bytes and everything after them.
func (g *gzipWriter) startGzip() error {
	h := g.Header()
	h.Del("Content-Length") // it would be the plain length
	h.Set("Content-Encoding", "gzip")
	g.decided = true
	g.ResponseWriter.WriteHeader(g.code)
	g.gz = gzipPool.Get().(*gzip.Writer)
	g.gz.Reset(g.ResponseWriter)
	buf := g.buf
	g.buf = nil
	_, err := g.gz.Write(buf)
	return err
}

// FlushError sends what is held or compressed so far; http.ResponseController
// finds it before Unwrap.
func (g *gzipWriter) FlushError() error {
	if !g.decided && g.code != 0 {
		if err := g.startGzip(); err != nil {
			return err
		}
	}
	if g.gz != nil {
		if err := g.gz.Flush(); err != nil {
			return err
		}
	}
	return http.NewResponseController(g.ResponseWriter).Flush()
}

func (g *gzipWriter) Flush() { _ = g.FlushError() }

// Unwrap lets http.ResponseController reach the connection (deadlines).
func (g *gzipWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }

// finish ends the answer once the handler returns: a held body that stayed
// small goes out plain with its length, a compressed one gets its gzip trailer.
func (g *gzipWriter) finish() {
	switch {
	case g.gz != nil:
		_ = g.gz.Close()
		g.gz.Reset(nil)
		gzipPool.Put(g.gz)
		g.gz = nil
	case !g.decided && g.code != 0:
		g.decided = true
		g.Header().Set("Content-Length", strconv.Itoa(len(g.buf)))
		g.ResponseWriter.WriteHeader(g.code)
		_, _ = g.ResponseWriter.Write(g.buf)
		g.buf = nil
	}
}
