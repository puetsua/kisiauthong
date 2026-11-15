// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
package main

import "io/fs"

// embeddedWeb is the web UI built into release binaries (build tag
// embedweb, see webembed.go and scripts/build-release.sh); nil in a
// development build, which serves ../web from disk.
var embeddedWeb fs.FS
