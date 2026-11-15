// SPDX-License-Identifier: AGPL-3.0-or-later
package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"testing"
)

func pngDataURL(t *testing.T, side int) string {
	img := image.NewRGBA(image.Rect(0, 0, side, side))
	for i := range img.Pix {
		img.Pix[i] = byte(i)
	}
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func signedIn(t *testing.T, c *client, username string) {
	t.Helper()
	if code := c.do("POST", "/api/auth/login", map[string]string{"username": username, "password": "correct horse"}, nil); code != 200 {
		t.Fatalf("sign in %s: %d", username, code)
	}
}

func TestAvatar(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", false)
	addTestUser(t, s, "bob", false)
	a, b := newClient(t, srv), newClient(t, srv)
	signedIn(t, a, "alice")
	signedIn(t, b, "bob")
	var u User
	if code := a.do("PUT", "/api/me/avatar", map[string]string{"image": pngDataURL(t, 64)}, &u); code != 200 || !u.HasAvatar || u.AvatarVer != 1 {
		t.Fatalf("upload: %d %+v", code, u)
	}
	// others who are signed in can see it; strangers cannot
	res, err := b.c.Get(srv.URL + "/api/users/usr-alice/avatar")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || len(body) < 50 {
		t.Fatalf("serve: %d %s %d bytes", res.StatusCode, res.Header.Get("Content-Type"), len(body))
	}
	if res, _ := http.Get(srv.URL + "/api/users/usr-alice/avatar"); res.StatusCode != 401 {
		t.Fatalf("anonymous avatar: %d", res.StatusCode)
	}
	for name, img := range map[string]string{
		"not an image": "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<svg onload=alert(1)>")),
		"too small":    pngDataURL(t, 8),
		"too large":    pngDataURL(t, 513),
		"no data URL":  "https://example.org/me.png",
	} {
		if code := a.do("PUT", "/api/me/avatar", map[string]string{"image": img}, nil); code != 400 {
			t.Errorf("%s accepted: %d", name, code)
		}
	}
	if code := a.do("PUT", "/api/me/avatar", map[string]string{"color": "#2f6f73"}, &u); code != 200 || u.AvatarColor != "#2f6f73" {
		t.Fatalf("colour: %d %+v", code, u)
	}
	if code := a.do("PUT", "/api/me/avatar", map[string]string{"color": "red; background:url(x)"}, nil); code != 400 {
		t.Fatalf("bad colour accepted: %d", code)
	}
	if code := a.do("DELETE", "/api/me/avatar", nil, &u); code != 200 || u.HasAvatar || u.AvatarVer != 2 {
		t.Fatalf("remove: %d %+v", code, u)
	}
}

func TestAdminManagesUsers(t *testing.T) {
	srv, s := testServer(t)
	addTestUser(t, s, "alice", true)
	if _, err := s.db.Exec(`UPDATE users SET is_admin=1 WHERE id='usr-alice'`); err != nil {
		t.Fatal(err)
	}
	addTestUser(t, s, "bob", false)
	admin, bob := newClient(t, srv), newClient(t, srv)
	signedIn(t, admin, "alice")
	signedIn(t, bob, "bob")
	if code := bob.do("GET", "/api/users", nil, nil); code != 403 {
		t.Fatalf("a non-admin listed users: %d", code)
	}
	var list []User
	if code := admin.do("GET", "/api/users", nil, &list); code != 200 || len(list) != 2 {
		t.Fatalf("list: %d %+v", code, list)
	}
	// add a user: they start with an empty book and can sign in
	var carol User
	if code := admin.do("POST", "/api/users", map[string]interface{}{"username": "carol", "password": "correct horse", "displayName": "Carol"}, &carol); code != 201 || carol.IsAdmin {
		t.Fatalf("add: %d %+v", code, carol)
	}
	if code := admin.do("POST", "/api/users", map[string]interface{}{"username": "CAROL", "password": "correct horse"}, nil); code != 409 {
		t.Fatalf("duplicate username: %d", code)
	}
	cc := newClient(t, srv)
	signedIn(t, cc, "carol")
	var st struct{ Transactions []interface{} }
	if cc.do("GET", "/api/state", nil, &st); len(st.Transactions) != 0 {
		t.Fatalf("a new user's book should be empty")
	}
	// reset carol's password: her sessions end
	if code := admin.do("PUT", "/api/users/"+carol.ID, map[string]interface{}{"password": "battery staple"}, nil); code != 200 {
		t.Fatalf("reset: %d", code)
	}
	if code := cc.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("carol's session survived a reset: %d", code)
	}
	// the last administrator stays one
	if code := admin.do("PUT", "/api/users/usr-alice", map[string]interface{}{"isAdmin": false}, nil); code != 409 {
		t.Fatalf("demoted the last admin: %d", code)
	}
	if code := admin.do("PUT", "/api/users/"+carol.ID, map[string]interface{}{"isAdmin": true}, nil); code != 200 {
		t.Fatalf("promote: %d", code)
	}
	if code := admin.do("PUT", "/api/users/usr-alice", map[string]interface{}{"isAdmin": false}, nil); code != 200 {
		t.Fatalf("demote with another admin: %d", code)
	}
	// deleting a user removes their books and sessions; nobody deletes themselves
	if code := bob.do("DELETE", "/api/users/"+carol.ID, nil, nil); code != 403 {
		t.Fatalf("a non-admin deleted a user: %d", code)
	}
	cc2 := newClient(t, srv)
	cc2.do("POST", "/api/auth/login", map[string]string{"username": "carol", "password": "battery staple"}, nil)
	if code := cc2.do("DELETE", "/api/users/"+carol.ID, nil, nil); code != 409 {
		t.Fatalf("deleted yourself: %d", code)
	}
	if code := cc2.do("DELETE", "/api/users/usr-bob", nil, nil); code != 200 {
		t.Fatalf("delete bob: %d", code)
	}
	if code := bob.do("GET", "/api/state", nil, nil); code != 401 {
		t.Fatalf("a deleted user's session still works: %d", code)
	}
	var n int
	_ = s.db.QueryRow(`SELECT count(*) FROM accounts WHERE user_id='usr-bob'`).Scan(&n)
	if n != 0 {
		t.Fatalf("bob's books were left behind: %d accounts", n)
	}
}
