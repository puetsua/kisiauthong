// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"path/filepath"
	"testing"
	"time"
)

// testPasswordHash is computed once: Argon2id is deliberately slow.
var testPasswordHash = func() string { h, _ := hashPassword("correct horse"); return h }()

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.db.Close() })
	return s
}

// addTestUser creates a user who signs in with "correct horse", with the
// sample books when sample is set (else only the External account).
func addTestUser(t *testing.T, s *Store, username string, sample bool) *Book {
	t.Helper()
	uid := "usr-" + username
	if _, err := s.db.Exec(`INSERT INTO users(id,username,display_name,password_hash,created_at) VALUES(?,?,?,?,?)`,
		uid, username, username, testPasswordHash, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatalf("add user: %v", err)
	}
	b := &Book{s: s, uid: uid}
	if err := b.startBook(sample); err != nil {
		t.Fatalf("start book: %v", err)
	}
	return b
}

// sampleBook is a new store with one user holding the sample books.
func sampleBook(t *testing.T) *Book {
	t.Helper()
	return addTestUser(t, openTestStore(t), "alice", true)
}
