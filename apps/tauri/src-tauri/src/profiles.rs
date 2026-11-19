// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Saved servers (ADR 0019): a list of profiles plus the id of the one in use,
// kept as servers.json in the app data folder. Nothing else is stored: the
// sign-in session is the server's cookie inside the webview.

use std::fs;
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// the server's base address, ending in a slash: https://example.com/kisiauthong/
    pub url: String,
    /// UTC ISO 8601, when the app last switched to this server
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub active: Option<String>,
    #[serde(default)]
    pub servers: Vec<Profile>,
}

fn one() -> u32 {
    1
}

impl Store {
    /// Reads the file; a missing file is an empty list. A file that cannot be
    /// read as a list is moved aside (servers.json.unreadable-<seconds>), never
    /// overwritten, and the app starts with an empty list.
    pub fn load(path: &Path) -> Store {
        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => return Store { version: 1, ..Store::default() },
        };
        match serde_json::from_str::<Store>(&text) {
            Ok(mut s) => {
                if s.active.as_ref().is_some_and(|a| !s.servers.iter().any(|p| &p.id == a)) {
                    s.active = None;
                }
                s
            }
            Err(e) => {
                let aside = path.with_extension(format!("json.unreadable-{}", unix_now()));
                eprintln!("servers.json is unreadable ({e}); moved to {}", aside.display());
                let _ = fs::rename(path, aside);
                Store { version: 1, ..Store::default() }
            }
        }
    }

    /// Writes a temporary file next to it, then renames it over the old one.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(io::Error::other)?)?;
        fs::rename(tmp, path)
    }

    pub fn get(&self, id: &str) -> Option<&Profile> {
        self.servers.iter().find(|p| p.id == id)
    }

    pub fn active_profile(&self) -> Option<&Profile> {
        self.active.as_deref().and_then(|a| self.get(a))
    }

    /// Adds or changes a server and returns its id. With an id, that profile
    /// gets the url (and the name, when given). Without one, a profile with
    /// the same url is reused, else a new one is added. name: None keeps the
    /// saved name, Some("") clears it.
    pub fn upsert(&mut self, id: Option<&str>, name: Option<&str>, url: &str) -> Result<String, String> {
        let name = name.map(|n| n.trim().chars().take(80).collect::<String>());
        let idx = match id {
            Some(id) => Some(self.servers.iter().position(|p| p.id == id).ok_or("That server is no longer saved.")?),
            None => self.servers.iter().position(|p| p.url == url),
        };
        let idx = match idx {
            Some(i) => i,
            None => {
                self.servers.push(Profile { id: uuid::Uuid::new_v4().to_string(), name: None, url: url.into(), last_used: None });
                self.servers.len() - 1
            }
        };
        let p = &mut self.servers[idx];
        p.url = url.into();
        if let Some(n) = name {
            p.name = if n.is_empty() { None } else { Some(n) };
        }
        Ok(p.id.clone())
    }

    /// Makes a saved server the one in use.
    pub fn activate(&mut self, id: &str, now: String) -> Option<&Profile> {
        let p = self.servers.iter_mut().find(|p| p.id == id)?;
        p.last_used = Some(now);
        self.active = Some(p.id.clone());
        self.active_profile()
    }

    /// Removes a server. When it was the one in use, the most recently used of
    /// the rest takes over (None when none is left).
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.servers.len();
        self.servers.retain(|p| p.id != id);
        if self.servers.len() == before {
            return false;
        }
        if self.active.as_deref() == Some(id) {
            // ISO 8601 UTC strings sort by time; never used sorts first
            self.active = self.servers.iter().max_by(|a, b| a.last_used.cmp(&b.last_used)).map(|p| p.id.clone());
        }
        true
    }
}

/// The checks the shell repeats on an address from the server screen: http or
/// https, a host, no user name or password, no query or fragment, a trailing slash.
pub fn check_url(input: &str) -> Result<String, String> {
    let mut u = Url::parse(input.trim()).map_err(|_| "Not a valid address.".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none_or(str::is_empty) {
        return Err("Only http:// and https:// addresses are supported.".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("The address must not contain a user name or password.".into());
    }
    u.set_query(None);
    u.set_fragment(None);
    if !u.path().ends_with('/') {
        let p = format!("{}/", u.path());
        u.set_path(&p);
    }
    Ok(u.to_string())
}

/// scheme://host[:port] of an address, the unit the webview's cookies and the
/// app's permissions follow.
pub fn origin_of(url: &str) -> Option<String> {
    let u = Url::parse(url).ok()?;
    match u.scheme() {
        "http" | "https" => Some(u.origin().ascii_serialization()),
        _ => None,
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn now_iso() -> String {
    iso_utc(unix_now())
}

/// Seconds since 1970 as 2026-11-19T08:30:00Z (days to civil date after Howard Hinnant).
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        let mut s = Store { version: 1, ..Store::default() };
        let a = s.upsert(None, Some("Home"), "https://books.example.org/kisiauthong/").unwrap();
        let b = s.upsert(None, None, "https://nas.example.org/").unwrap();
        s.activate(&b, iso_utc(1_000)).unwrap();
        s.activate(&a, iso_utc(2_000)).unwrap();
        s
    }

    #[test]
    fn iso_dates() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso_utc(1_795_084_199), "2026-11-19T10:29:59Z");
    }

    #[test]
    fn upsert_reuses_the_same_url_and_keeps_or_clears_names() {
        let mut s = store();
        let again = s.upsert(None, None, "https://nas.example.org/").unwrap();
        assert_eq!(s.servers.len(), 2);
        assert_eq!(s.get(&again).unwrap().url, "https://nas.example.org/");
        let home = s.servers[0].id.clone();
        s.upsert(Some(&home), None, "https://books.example.org/kst/").unwrap();
        assert_eq!(s.get(&home).unwrap().name.as_deref(), Some("Home"), "None keeps the name");
        s.upsert(Some(&home), Some(" "), "https://books.example.org/kst/").unwrap();
        assert_eq!(s.get(&home).unwrap().name, None, "blank clears it");
        assert!(s.upsert(Some("gone"), None, "https://x.example/").is_err());
    }

    #[test]
    fn removing_the_server_in_use_falls_back_to_the_last_used_then_to_none() {
        let mut s = store();
        let home = s.active.clone().unwrap();
        let nas = s.servers[1].id.clone();
        let third = s.upsert(None, None, "http://100.64.0.12:9700/").unwrap();
        assert!(s.remove(&home));
        assert_eq!(s.active.as_deref(), Some(nas.as_str()), "NAS was used, the third never");
        assert!(s.remove(&third));
        assert_eq!(s.active.as_deref(), Some(nas.as_str()), "removing another keeps the one in use");
        assert!(s.remove(&nas));
        assert_eq!(s.active, None);
        assert!(!s.remove(&nas));
    }

    #[test]
    fn urls() {
        assert_eq!(check_url("https://Books.Example.org/kisiauthong").unwrap(), "https://books.example.org/kisiauthong/");
        assert_eq!(check_url("http://127.0.0.1:9728/?a=1#settings").unwrap(), "http://127.0.0.1:9728/");
        assert!(check_url("ftp://example.org/").is_err());
        assert!(check_url("https://me:pw@example.org/").is_err());
        assert!(check_url("not a url").is_err());
        assert_eq!(origin_of("https://books.example.org/kisiauthong/").as_deref(), Some("https://books.example.org"));
        assert_eq!(origin_of("http://100.64.0.12:9700/").as_deref(), Some("http://100.64.0.12:9700"));
        assert_eq!(origin_of("tauri://localhost/index.html"), None);
    }

    #[test]
    fn load_and_save_round_trip_and_unreadable_files_are_kept() {
        let dir = std::env::temp_dir().join(format!("kst-profiles-{}", uuid::Uuid::new_v4()));
        let file = dir.join("servers.json");
        assert_eq!(Store::load(&file).servers.len(), 0);
        let s = store();
        s.save(&file).unwrap();
        assert_eq!(Store::load(&file), s);
        fs::write(&file, "{not json").unwrap();
        assert_eq!(Store::load(&file).servers.len(), 0);
        let kept = fs::read_dir(&dir).unwrap().filter_map(Result::ok).any(|e| e.file_name().to_string_lossy().contains("unreadable"));
        assert!(kept, "the unreadable file is moved aside, not lost");
        fs::remove_dir_all(dir).unwrap();
    }
}
