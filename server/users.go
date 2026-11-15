// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"image"
	_ "image/jpeg" // avatars may be JPEG or PNG
	_ "image/png"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Avatars and user management (ADR 0007).

const (
	maxAvatarBytes = 512 << 10
	maxAvatarSide  = 1024
)

var colorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// PUT /api/me/avatar {image: data URL} sets a photo, {color: "#rrggbb"} the
// initials' colour; DELETE removes the photo.
func handleMyAvatar(w http.ResponseWriter, r *http.Request, u *User) {
	switch r.Method {
	case http.MethodPut:
		var body struct {
			Image *string `json:"image"`
			Color *string `json:"color"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes*2)
		if !decode(w, r, &body) {
			return
		}
		if body.Color != nil {
			c := strings.TrimSpace(*body.Color)
			if c != "" && !colorRe.MatchString(c) {
				writeErr(w, 400, "colour must be #rrggbb")
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET avatar_color=? WHERE id=?`, c, u.ID); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if body.Image != nil {
			img, typ, err := avatarImage(*body.Image)
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET avatar=?, avatar_type=?, avatar_version=avatar_version+1 WHERE id=?`, img, typ, u.ID); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
	case http.MethodDelete:
		if _, err := store.db.Exec(`UPDATE users SET avatar=NULL, avatar_type='', avatar_version=avatar_version+1 WHERE id=?`, u.ID); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	default:
		writeErr(w, 405, "PUT or DELETE only")
		return
	}
	u, _ = store.userByID(u.ID)
	writeJSON(w, 200, u)
}

// avatarImage checks a data URL holds a sane PNG or JPEG.
func avatarImage(dataURL string) ([]byte, string, error) {
	i := strings.Index(dataURL, ";base64,")
	if !strings.HasPrefix(dataURL, "data:") || i < 0 {
		return nil, "", errBadAvatar
	}
	raw, err := base64.StdEncoding.DecodeString(dataURL[i+8:])
	if err != nil || len(raw) == 0 || len(raw) > maxAvatarBytes {
		return nil, "", errBadAvatar
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 16 || cfg.Height < 16 || cfg.Width > maxAvatarSide || cfg.Height > maxAvatarSide {
		return nil, "", errBadAvatar
	}
	return raw, "image/" + format, nil
}

type avatarError struct{}

func (avatarError) Error() string {
	return "the photo must be a PNG or JPEG image, 16 to 1024 pixels wide and at most 512 KB"
}

var errBadAvatar = avatarError{}

// GET /api/users/{id}/avatar: any signed-in user may see others' photos.
func handleAvatar(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // api users <id> avatar
	if len(parts) != 4 || parts[3] != "avatar" || r.Method != http.MethodGet {
		writeErr(w, 404, "not found")
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, err := store.authenticate(r); err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	var img []byte
	var typ string
	if err := store.db.QueryRow(`SELECT avatar, avatar_type FROM users WHERE id=? AND avatar IS NOT NULL`, parts[2]).Scan(&img, &typ); err != nil {
		writeErr(w, 404, "no photo")
		return
	}
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Cache-Control", "private, max-age=86400") // the URL carries the version
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(img)
}

/* ---------- administrators: managing users ---------- */

// adminOnly is sessionOnly for administrators.
func adminOnly(h func(w http.ResponseWriter, r *http.Request, u *User)) http.HandlerFunc {
	return sessionOnly(func(w http.ResponseWriter, r *http.Request, u *User) {
		if !u.IsAdmin {
			writeErr(w, 403, "administrators only")
			return
		}
		h(w, r, u)
	})
}

func (s *Store) listUsers() ([]*User, error) {
	rows, err := s.db.Query(`SELECT ` + userCols + ` FROM users WHERE username <> '' ORDER BY created_at, username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) adminCount() int {
	var n int
	_ = s.db.QueryRow(`SELECT count(*) FROM users WHERE is_admin=1 AND username <> ''`).Scan(&n)
	return n
}

// GET /api/users lists users; POST adds one {username, displayName, password, isAdmin}.
func handleUsers(w http.ResponseWriter, r *http.Request, admin *User) {
	switch r.Method {
	case http.MethodGet:
		list, err := store.listUsers()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, list)
	case http.MethodPost:
		var body struct {
			Username, Password, DisplayName string
			IsAdmin                         bool
		}
		if !decode(w, r, &body) {
			return
		}
		body.Username = strings.TrimSpace(body.Username)
		if err := validCredentials(body.Username, body.Password); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		name, err := cleanDisplayName(body.DisplayName)
		if err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		var taken int
		_ = store.db.QueryRow(`SELECT count(*) FROM users WHERE username=? COLLATE NOCASE`, body.Username).Scan(&taken)
		if taken > 0 {
			writeErr(w, 409, "that username is taken")
			return
		}
		hash, err := hashPassword(body.Password)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		uid := newID("usr")
		if _, err := store.db.Exec(`INSERT INTO users(id,username,display_name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?,?)`,
			uid, body.Username, name, hash, b2i(body.IsAdmin), time.Now().UTC().Format(time.RFC3339)); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if err := (&Book{s: store, uid: uid}).startBook(false); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		u, _ := store.userByID(uid)
		writeJSON(w, 201, u)
	default:
		writeErr(w, 405, "GET or POST only")
	}
}

// PUT /api/users/{id} {isAdmin?, password?, displayName?}; DELETE removes the user and their books.
func handleUser(w http.ResponseWriter, r *http.Request, admin *User) {
	id, action, ok := pathID(r)
	if !ok || action != "" {
		writeErr(w, 404, "not found")
		return
	}
	target, err := store.userByID(id)
	if err != nil || target.Username == "" {
		writeErr(w, 404, "user not found")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var body struct {
			IsAdmin     *bool   `json:"isAdmin"`
			Password    *string `json:"password"`
			DisplayName *string `json:"displayName"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.IsAdmin != nil {
			if !*body.IsAdmin && target.IsAdmin && store.adminCount() <= 1 {
				writeErr(w, 409, "keep at least one administrator")
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET is_admin=? WHERE id=?`, b2i(*body.IsAdmin), id); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if body.DisplayName != nil {
			name, err := cleanDisplayName(*body.DisplayName)
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET display_name=? WHERE id=?`, name, id); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if body.Password != nil { // a reset: the user's sessions end
			if err := validPassword(*body.Password); err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			hash, err := hashPassword(*body.Password)
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			if _, err := store.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, hash, id); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			if id != admin.ID {
				if _, err := store.db.Exec(`DELETE FROM sessions WHERE user_id=?`, id); err != nil {
					writeErr(w, 500, err.Error())
					return
				}
			}
		}
		u, _ := store.userByID(id)
		writeJSON(w, 200, u)
	case http.MethodDelete:
		if id == admin.ID {
			writeErr(w, 409, "you cannot delete yourself")
			return
		}
		if err := store.deleteUser(id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	default:
		writeErr(w, 405, "PUT or DELETE only")
	}
}

// deleteUser removes a user, everything they could sign in with, and their books.
func (s *Store) deleteUser(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, t := range append(append([]string{}, tableNames...), "sessions", "passkeys", "api_keys") {
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE user_id=?`, id); err != nil && !isNoTable(err) {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM users WHERE id=?`, id); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	delete(s.books, id)
	return nil
}

func isNoTable(err error) bool { return err != nil && strings.Contains(err.Error(), "no such table") }

// Migration 11: avatars get a version, so their URL changes when they do.
func migrateAvatarVersion(tx *sql.Tx) error {
	has, err := hasColumn(tx, "users", "avatar_version")
	if err != nil || has {
		return err
	}
	_, err = tx.Exec(`ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0`)
	return err
}
