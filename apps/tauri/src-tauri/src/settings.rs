// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The app's own settings, in settings.json next to servers.json. They belong
// to this installed app, not to a server or a user, so the web UI does not
// store them. Today there is one: whether the app checks for a newer version
// when it opens (ADR 0025).

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// ask GitHub for a newer app once each time the app opens; on by default
    pub check_updates_at_launch: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { check_updates_at_launch: true }
    }
}

impl Settings {
    /// A missing or unreadable file gives the defaults; nothing else in it matters.
    pub fn load(path: &Path) -> Settings {
        fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(io::Error::other)?)?;
        fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn on_by_default_and_kept_when_turned_off() {
        let dir = std::env::temp_dir().join(format!("kst-settings-{}", uuid::Uuid::new_v4()));
        let file = dir.join("settings.json");
        assert!(Settings::load(&file).check_updates_at_launch, "no file: on");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&file, "not json").unwrap();
        assert!(Settings::load(&file).check_updates_at_launch, "unreadable: the default");
        fs::write(&file, "{}").unwrap();
        assert!(Settings::load(&file).check_updates_at_launch, "missing key: the default");
        Settings { check_updates_at_launch: false }.save(&file).unwrap();
        assert!(!Settings::load(&file).check_updates_at_launch);
        assert_eq!(fs::read_to_string(&file).unwrap().contains("\"checkUpdatesAtLaunch\": false"), true);
        let _ = fs::remove_dir_all(&dir);
    }
}
