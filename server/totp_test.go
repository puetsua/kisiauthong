// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B (SHA-1 secret "12345678901234567890"), last six digits.
func TestTOTPMatchesRFC6238(t *testing.T) {
	secret := b32.EncodeToString([]byte("12345678901234567890"))
	for _, c := range []struct {
		unix int64
		want string
	}{{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"}, {1234567890, "005924"}, {2000000000, "279037"}} {
		got, err := totpCode(secret, c.unix/totpStep)
		if err != nil || got != c.want {
			t.Errorf("T=%d: %s %v, want %s", c.unix, got, err, c.want)
		}
	}
}

func TestTOTPDriftAndReplay(t *testing.T) {
	secret := newTOTPSecret()
	now := time.Unix(1_800_000_000, 0)
	step := now.Unix() / totpStep
	prev, _ := totpCode(secret, step-1)
	next, _ := totpCode(secret, step+1)
	far, _ := totpCode(secret, step+3)
	if totpMatch(secret, prev, now, 0) != step-1 || totpMatch(secret, next, now, 0) != step+1 {
		t.Fatalf("one step of drift should be accepted")
	}
	if totpMatch(secret, far, now, 0) != -1 {
		t.Fatalf("a code three steps away was accepted")
	}
	if totpMatch(secret, prev, now, step-1) != -1 {
		t.Fatalf("a used step was accepted again")
	}
}

func TestTOTPSignIn(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	c := newClient(t, srv)
	c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)
	var setup struct{ Secret, URI, QR string }
	if code := c.do("POST", "/api/me/totp/setup", nil, &setup); code != 200 || setup.Secret == "" || !strings.HasPrefix(setup.QR, "data:image/png;base64,") || !strings.Contains(setup.URI, "issuer=KiSiauThong") {
		t.Fatalf("setup: %d %+v", code, setup)
	}
	if code := c.do("POST", "/api/me/totp/enable", map[string]string{"code": "000000"}, nil); code != 400 {
		t.Fatalf("wrong code enabled TOTP: %d", code)
	}
	now := time.Now().Unix() / totpStep
	cur, _ := totpCode(setup.Secret, now)
	var on struct{ RecoveryCodes []string }
	if code := c.do("POST", "/api/me/totp/enable", map[string]string{"code": cur}, &on); code != 200 || len(on.RecoveryCodes) != recoveryCount {
		t.Fatalf("enable: %d %+v", code, on)
	}
	var me User
	if c.do("GET", "/api/me", nil, &me); !me.TOTPEnabled || me.RecoveryLeft != recoveryCount {
		t.Fatalf("me: %+v", me)
	}

	// signing in now takes the password, then a code
	d := newClient(t, srv)
	var step1 struct {
		TOTPRequired bool `json:"totpRequired"`
		Ticket       string
	}
	if code := d.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, &step1); code != 200 || !step1.TOTPRequired || step1.Ticket == "" {
		t.Fatalf("login step 1: %d %+v", code, step1)
	}
	if code := d.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("signed in before the code: %d", code)
	}
	if code := d.do("POST", "/api/auth/totp", map[string]string{"ticket": step1.Ticket, "code": cur}, nil); code != 401 {
		t.Fatalf("the code used to turn TOTP on was accepted again: %d", code)
	}
	next, _ := totpCode(setup.Secret, now+1)
	if code := d.do("POST", "/api/auth/totp", map[string]string{"ticket": step1.Ticket, "code": next}, nil); code != 200 {
		t.Fatalf("login step 2: %d", code)
	}
	if code := d.do("GET", "/api/state", nil, nil); code != 200 {
		t.Fatalf("after the code: %d", code)
	}
	if code := d.do("POST", "/api/auth/totp", map[string]string{"ticket": step1.Ticket, "code": next}, nil); code != 401 {
		t.Fatalf("a ticket was used twice: %d", code)
	}

	// a recovery code works once
	e := newClient(t, srv)
	e.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, &step1)
	rc := strings.ToUpper(strings.ReplaceAll(on.RecoveryCodes[0], "-", "")) // typed without the dash, in capitals
	if code := e.do("POST", "/api/auth/totp", map[string]string{"ticket": step1.Ticket, "code": rc}, nil); code != 200 {
		t.Fatalf("recovery code: %d", code)
	}
	f := newClient(t, srv)
	f.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, &step1)
	if code := f.do("POST", "/api/auth/totp", map[string]string{"ticket": step1.Ticket, "code": on.RecoveryCodes[0]}, nil); code != 401 {
		t.Fatalf("recovery code used twice: %d", code)
	}
	if c.do("GET", "/api/me", nil, &me); me.RecoveryLeft != recoveryCount-1 {
		t.Fatalf("recovery codes left: %d", me.RecoveryLeft)
	}

	// turning it off needs a code
	if code := c.do("POST", "/api/me/totp/disable", map[string]string{"code": "123456"}, nil); code != 403 {
		t.Fatalf("disable with a wrong code: %d", code)
	}
	if code := c.do("POST", "/api/me/totp/disable", map[string]string{"code": on.RecoveryCodes[1]}, nil); code != 200 {
		t.Fatalf("disable: %d", code)
	}
	g := newClient(t, srv)
	var plain map[string]interface{}
	if code := g.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, &plain); code != 200 || plain["totpRequired"] != nil {
		t.Fatalf("after disabling, the password alone signs in: %d %v", code, plain)
	}
}
