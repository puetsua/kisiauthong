// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"rsc.io/qr"
)

// TOTP second factor (RFC 6238; ADR 0007): HMAC-SHA1, 6 digits, 30-second
// steps, one step of clock drift either way. A used step is remembered so
// a code cannot be replayed. Ten one-time recovery codes are issued when
// TOTP is turned on, stored only as hashes.

const (
	totpDigits     = 6
	totpStep       = 30
	totpDrift      = 1
	recoveryCount  = 10
	ticketTTL      = 5 * time.Minute
	ticketAttempts = 5
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() string {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b32.EncodeToString(b)
}

func totpCode(secret string, step int64) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	n := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, n%1000000), nil
}

// totpMatch returns the step a code is valid for, or -1. Steps at or before
// lastStep were already used.
func totpMatch(secret, code string, now time.Time, lastStep int64) int64 {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return -1
	}
	cur := now.Unix() / totpStep
	for d := int64(-totpDrift); d <= totpDrift; d++ {
		step := cur + d
		if step <= lastStep {
			continue
		}
		want, err := totpCode(secret, step)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step
		}
	}
	return -1
}

func newRecoveryCodes() (codes []string, hashes []string) {
	for i := 0; i < recoveryCount; i++ {
		b := make([]byte, 5)
		if _, err := rand.Read(b); err != nil {
			panic(err)
		}
		c := strings.ToLower(b32.EncodeToString(b)) // 8 characters
		c = c[:4] + "-" + c[4:]
		codes = append(codes, c)
		hashes = append(hashes, tokenHash(c))
	}
	return codes, hashes
}

func normRecovery(c string) string {
	c = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(c), " ", ""))
	if len(c) == 8 {
		c = c[:4] + "-" + c[4:]
	}
	return c
}

// checkSecondFactor accepts a current TOTP code or an unused recovery code
// for the user, and records its use. Caller holds store.mu.
func (s *Store) checkSecondFactor(uid, code string) (bool, error) {
	var secret, rec string
	var last int64
	if err := s.db.QueryRow(`SELECT totp_secret,totp_last_step,recovery_codes FROM users WHERE id=? AND totp_enabled=1`, uid).Scan(&secret, &last, &rec); err != nil {
		return false, err
	}
	if step := totpMatch(secret, code, time.Now(), last); step >= 0 {
		_, err := s.db.Exec(`UPDATE users SET totp_last_step=? WHERE id=?`, step, uid)
		return err == nil, err
	}
	var hashes []string
	_ = json.Unmarshal([]byte(rec), &hashes)
	h := tokenHash(normRecovery(code))
	for i, x := range hashes {
		if subtle.ConstantTimeCompare([]byte(x), []byte(h)) == 1 {
			hashes = append(hashes[:i], hashes[i+1:]...)
			js, _ := json.Marshal(hashes)
			_, err := s.db.Exec(`UPDATE users SET recovery_codes=? WHERE id=?`, string(js), uid)
			return err == nil, err
		}
	}
	return false, nil
}

/* ---------- sign-in tickets: a password passed, the second factor is pending ---------- */

type ticket struct {
	uid      string
	expires  time.Time
	attempts int
}

var tickets = struct {
	sync.Mutex
	m map[string]*ticket
}{m: map[string]*ticket{}}

func newTicket(uid string) string {
	t := randomToken(24)
	tickets.Lock()
	defer tickets.Unlock()
	now := time.Now()
	for k, v := range tickets.m {
		if now.After(v.expires) {
			delete(tickets.m, k)
		}
	}
	tickets.m[t] = &ticket{uid: uid, expires: now.Add(ticketTTL)}
	return t
}

// ticketUser returns the user of a live ticket and counts the attempt.
func ticketUser(t string) (string, bool) {
	tickets.Lock()
	defer tickets.Unlock()
	x, ok := tickets.m[t]
	if !ok || time.Now().After(x.expires) || x.attempts >= ticketAttempts {
		delete(tickets.m, t)
		return "", false
	}
	x.attempts++
	return x.uid, true
}

func dropTicket(t string) {
	tickets.Lock()
	defer tickets.Unlock()
	delete(tickets.m, t)
}

// POST /api/auth/totp {ticket, code}: the second step of signing in.
func handleLoginTOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Ticket, Code string }
	if !decode(w, r, &body) {
		return
	}
	uid, ok := ticketUser(body.Ticket)
	if !ok {
		writeErr(w, 401, "sign-in expired; enter your password again")
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	good, err := store.checkSecondFactor(uid, body.Code)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if !good {
		signinFailures.add(clientKey(r))
		writeErr(w, 401, "wrong code")
		return
	}
	dropTicket(body.Ticket)
	signinFailures.reset(clientKey(r))
	finishSignIn(w, r, uid)
}

/* ---------- My account: turning TOTP on and off ---------- */

// POST /api/me/totp/setup: a new secret to scan, pending until a code confirms it.
func handleTOTPSetup(w http.ResponseWriter, r *http.Request, u *User) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	if u.TOTPEnabled {
		writeErr(w, 409, "two-step verification is already on")
		return
	}
	secret := newTOTPSecret()
	if _, err := store.db.Exec(`UPDATE users SET totp_secret=?, totp_last_step=0 WHERE id=?`, secret, u.ID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	label := "KiSiauThong:" + u.Username
	uri := fmt.Sprintf("otpauth://totp/%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		url.PathEscape(label), secret, url.QueryEscape("KiSiauThong"), totpDigits, totpStep)
	code, err := qr.Encode(uri, qr.M)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	code.Scale = 6
	writeJSON(w, 200, map[string]string{"secret": secret, "uri": uri, "qr": "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG())})
}

// POST /api/me/totp/enable {code}: confirms the pending secret; returns recovery codes once.
func handleTOTPEnable(w http.ResponseWriter, r *http.Request, u *User) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Code string }
	if !decode(w, r, &body) {
		return
	}
	var secret string
	if err := store.db.QueryRow(`SELECT totp_secret FROM users WHERE id=? AND totp_enabled=0`, u.ID).Scan(&secret); err != nil || secret == "" {
		writeErr(w, 409, "start the setup first")
		return
	}
	step := totpMatch(secret, body.Code, time.Now(), 0)
	if step < 0 {
		writeErr(w, 400, "that code does not match; check the time on your phone and try the next code")
		return
	}
	codes, hashes := newRecoveryCodes()
	js, _ := json.Marshal(hashes)
	if _, err := store.db.Exec(`UPDATE users SET totp_enabled=1, totp_last_step=?, recovery_codes=? WHERE id=?`, step, string(js), u.ID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"recoveryCodes": codes})
}

// POST /api/me/totp/disable {code}: needs a current code (or a recovery code).
func handleTOTPDisable(w http.ResponseWriter, r *http.Request, u *User) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "POST only")
		return
	}
	var body struct{ Code string }
	if !decode(w, r, &body) {
		return
	}
	if !u.TOTPEnabled {
		writeErr(w, 409, "two-step verification is off")
		return
	}
	good, err := store.checkSecondFactor(u.ID, body.Code)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if !good {
		writeErr(w, 403, "wrong code")
		return
	}
	if _, err := store.db.Exec(`UPDATE users SET totp_enabled=0, totp_secret='', totp_last_step=0, recovery_codes='' WHERE id=?`, u.ID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
