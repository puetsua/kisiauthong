// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

// softKey is a software authenticator holding one P-256 passkey.
type softKey struct {
	key    *ecdsa.PrivateKey
	id     []byte
	userID []byte
	count  uint32
}

var b64u = base64.RawURLEncoding

func newSoftKey(t *testing.T) *softKey {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &softKey{key: k, id: id}
}

func clientData(typ, challenge, origin string) []byte {
	b, _ := json.Marshal(map[string]string{"type": typ, "challenge": challenge, "origin": origin})
	return b
}

func authData(rpID string, flags byte, count uint32, attested []byte) []byte {
	h := sha256.Sum256([]byte(rpID))
	out := append(h[:], flags)
	var c [4]byte
	binary.BigEndian.PutUint32(c[:], count)
	return append(append(out, c[:]...), attested...)
}

// register answers navigator.credentials.create for these options.
func (k *softKey) register(t *testing.T, options map[string]interface{}, origin, rpID string) map[string]interface{} {
	pk := options["publicKey"].(map[string]interface{})
	user := pk["user"].(map[string]interface{})
	uid, err := b64u.DecodeString(user["id"].(string))
	if err != nil {
		t.Fatalf("user id: %v", err)
	}
	k.userID = uid
	x, y := k.key.PublicKey.X.FillBytes(make([]byte, 32)), k.key.PublicKey.Y.FillBytes(make([]byte, 32))
	cose, _ := cbor.Marshal(map[int]interface{}{1: 2, 3: -7, -1: 1, -2: x, -3: y})
	attested := append(make([]byte, 16), byte(len(k.id)>>8), byte(len(k.id)))
	attested = append(append(attested, k.id...), cose...)
	ad := authData(rpID, 0x45, 0, attested) // user present, user verified, attested credential data
	att, _ := cbor.Marshal(map[string]interface{}{"fmt": "none", "attStmt": map[string]interface{}{}, "authData": ad})
	return map[string]interface{}{
		"id": b64u.EncodeToString(k.id), "rawId": b64u.EncodeToString(k.id), "type": "public-key",
		"response": map[string]string{
			"attestationObject": b64u.EncodeToString(att),
			"clientDataJSON":    b64u.EncodeToString(clientData("webauthn.create", pk["challenge"].(string), origin)),
		},
	}
}

// sign answers navigator.credentials.get for these options.
func (k *softKey) sign(t *testing.T, options map[string]interface{}, origin, rpID string) map[string]interface{} {
	pk := options["publicKey"].(map[string]interface{})
	k.count++
	ad := authData(rpID, 0x05, k.count, nil) // user present, user verified
	cd := clientData("webauthn.get", pk["challenge"].(string), origin)
	h := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, ad...), h[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, k.key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return map[string]interface{}{
		"id": b64u.EncodeToString(k.id), "rawId": b64u.EncodeToString(k.id), "type": "public-key",
		"response": map[string]string{
			"authenticatorData": b64u.EncodeToString(ad), "clientDataJSON": b64u.EncodeToString(cd),
			"signature": b64u.EncodeToString(sig), "userHandle": b64u.EncodeToString(k.userID),
		},
	}
}

type ceremonyReply struct {
	Token   string
	Options map[string]interface{}
}

func TestPasskeys(t *testing.T) {
	const origin, rpID = "http://localhost:8080", "localhost"
	t.Setenv("KISIAUTHONG_ORIGIN", origin)
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	c := newClient(t, srv)
	c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)

	// add a passkey
	var begin ceremonyReply
	if code := c.do("POST", "/api/me/passkeys", nil, &begin); code != 200 || begin.Token == "" {
		t.Fatalf("begin registration: %d", code)
	}
	sel := begin.Options["publicKey"].(map[string]interface{})["authenticatorSelection"].(map[string]interface{})
	if sel["residentKey"] != "required" || sel["userVerification"] != "required" {
		t.Fatalf("passkeys must be discoverable and user-verified: %v", sel)
	}
	key := newSoftKey(t)
	if code := c.do("POST", "/api/me/passkeys/finish?token="+begin.Token+"&name="+url.QueryEscape("Laptop"), key.register(t, begin.Options, origin, rpID), nil); code != 201 {
		t.Fatalf("finish registration: %d", code)
	}
	if code := c.do("POST", "/api/me/passkeys/finish?token="+begin.Token, key.register(t, begin.Options, origin, rpID), nil); code != 400 {
		t.Fatalf("a registration token was used twice: %d", code)
	}
	var list []Passkey
	if c.do("GET", "/api/me/passkeys", nil, &list); len(list) != 1 || list[0].Name != "Laptop" {
		t.Fatalf("list: %+v", list)
	}

	// sign in with it, no username or password
	login := func(k *softKey, from string) (int, *client) {
		d := newClient(t, srv)
		var b ceremonyReply
		if code := d.do("POST", "/api/auth/passkey", nil, &b); code != 200 {
			t.Fatalf("begin login: %d", code)
		}
		return d.do("POST", "/api/auth/passkey?token="+b.Token, k.sign(t, b.Options, from, rpID), nil), d
	}
	code, d := login(key, origin)
	if code != 200 {
		t.Fatalf("passkey sign-in: %d", code)
	}
	var me User
	if d.do("GET", "/api/me", nil, &me); me.Username != "alice" {
		t.Fatalf("signed in as %+v", me)
	}
	if c.do("GET", "/api/me/passkeys", nil, &list); list[0].LastUsedAt == "" {
		t.Fatalf("last use not recorded: %+v", list)
	}
	// another site's page cannot use it
	if code, _ := login(key, "https://evil.example"); code != 401 {
		t.Fatalf("wrong origin: %d", code)
	}
	// a key that was never registered is refused
	stranger := newSoftKey(t)
	stranger.userID = key.userID
	if code, _ := login(stranger, origin); code != 401 {
		t.Fatalf("unknown passkey: %d", code)
	}
	// removed, it no longer signs in
	if code := c.do("DELETE", "/api/me/passkeys/"+list[0].ID, nil, nil); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := login(key, origin); code != 401 {
		t.Fatalf("deleted passkey still works: %d", code)
	}
}

func TestPasskeysNeedAHostName(t *testing.T) {
	srv, s := testServer(t) // served on 127.0.0.1
	addTestUser(t, s, "alice", false)
	c := newClient(t, srv)
	c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "correct horse"}, nil)
	var e map[string]string
	if code := c.do("POST", "/api/me/passkeys", nil, &e); code != 400 || e["error"] == "" {
		t.Fatalf("an IP address should be refused with a hint: %d %v", code, e)
	}
}
