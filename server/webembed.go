// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors

//go:build embedweb

package main

import (
	"embed"
	"io/fs"
)

// The release build copies ../web to server/web first (scripts/build-release.sh,
// deploy/Dockerfile), so a self-hoster runs one file.
//
//go:embed all:web
var webFiles embed.FS

func init() {
	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
	embeddedWeb = sub
}
