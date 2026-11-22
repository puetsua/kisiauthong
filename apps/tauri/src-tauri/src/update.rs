// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// App updates (ADR 0020, 0024). On Android the app can update itself from the
// project's GitHub releases: it reads the latest release, picks the app's APK,
// and hands it to the system installer after checking its SHA-256. Windows and
// macOS use Tauri's updater with the release's latest.json, signed with the
// updater key. This file holds the rules, with no network and no platform
// code, so they are tested on every platform. Asking GitHub is the app's one
// request to somewhere other than the user's own server.

// Errors are "code" or "code: detail"; the App updates screen (update.js)
// puts the code into words in the user's language.

// The APK rules are only called by the Android shell; elsewhere only the tests do.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use semver::Version;
use serde::{Deserialize, Serialize};

/// The latest final release; GitHub never answers this with a draft or a pre-release.
pub const RELEASES_API: &str = "https://api.github.com/repos/puetsua/kisiauthong/releases/latest";
/// Where release downloads live; the download must start with this and the tag.
pub const DOWNLOADS: &str = "https://github.com/puetsua/kisiauthong/releases/download/";

/// The desktop apps' update manifest in the latest final release (never a
/// pre-release: GitHub's `latest` skips them), made by scripts/updater-manifest.js.
#[cfg_attr(mobile, allow(dead_code))]
pub const DESKTOP_MANIFEST: &str = "https://github.com/puetsua/kisiauthong/releases/latest/download/latest.json";

/// The Android app in a release: kisiauthong-app-<version>-android.apk.
pub fn asset_name(version: &str) -> String {
    format!("kisiauthong-app-{version}-android.apk")
}

/// What the App updates screen is told about a found update.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Found {
    pub version: String,
    /// bytes, when the release says (the APK); the desktop manifest does not
    pub size: Option<u64>,
}

/// Whether a release may replace the installed app: newer, and a final
/// release. A pre-release never reaches an installed app, even when it is
/// marked as the latest by mistake.
pub fn accept(current: &Version, remote: &Version) -> bool {
    remote > current && remote.pre.is_empty()
}

/// An Android update the app found and may install.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub version: String,
    pub url: String,
    pub size: u64,
    /// lower-case hex
    pub sha256: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    browser_download_url: String,
    /// "sha256:<hex>", set by GitHub on every uploaded asset
    digest: Option<String>,
}

fn sha256_of(digest: Option<&str>) -> Option<String> {
    let hex = digest?.strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hex.to_ascii_lowercase())
}

/// Reads GitHub's answer for the latest release. Ok(None): this app is up to
/// date. An error when the release is newer but carries no usable Android app.
/// `downloads` is where the APK must come from (DOWNLOADS, except in tests).
pub fn pick(json: &str, current: &str, downloads: &str) -> Result<Option<Update>, String> {
    let r: Release = serde_json::from_str(json).map_err(|e| format!("badAnswer: {e}"))?;
    if r.draft || r.prerelease {
        return Ok(None);
    }
    let c = Version::parse(current).map_err(|e| format!("badVersion: {current}: {e}"))?;
    let l = Version::parse(&r.tag_name).map_err(|e| format!("badAnswer: the release tag {:?}: {e}", r.tag_name))?;
    if !accept(&c, &l) {
        return Ok(None);
    }
    let name = asset_name(&r.tag_name);
    let a = r
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("noApk: {}", r.tag_name))?;
    let prefix = format!("{downloads}{}/", r.tag_name);
    if !a.browser_download_url.starts_with(&prefix) {
        return Err(format!("elsewhere: {}", r.tag_name));
    }
    let sha256 = sha256_of(a.digest.as_deref())
        .ok_or_else(|| format!("noChecksum: {}", r.tag_name))?;
    if a.size == 0 {
        return Err(format!("empty: {}", r.tag_name));
    }
    Ok(Some(Update { version: r.tag_name.clone(), url: a.browser_download_url.clone(), size: a.size, sha256 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "4C9A0BD5DC9CEC4BB415FF402C59B055C8DB8E0DCEC59132CD8B53A3B1DB222A";

    fn release(tag: &str, assets: &str) -> String {
        format!(r#"{{"tag_name":"{tag}","draft":false,"prerelease":false,"assets":[{assets}]}}"#)
    }
    fn apk(tag: &str, digest: &str) -> String {
        format!(
            r#"{{"name":"kisiauthong-app-{tag}-android.apk","size":18000000,"browser_download_url":"{DOWNLOADS}{tag}/kisiauthong-app-{tag}-android.apk","digest":"{digest}"}}"#
        )
    }

    #[test]
    fn only_newer_final_releases_are_accepted() {
        let v = |s| Version::parse(s).unwrap();
        assert!(accept(&v("0.5.0"), &v("0.6.0")));
        assert!(accept(&v("0.9.0"), &v("0.10.0")));
        assert!(accept(&v("1.0.0-beta.1"), &v("1.0.0")));
        assert!(!accept(&v("0.5.0"), &v("0.5.0")));
        assert!(!accept(&v("0.6.0"), &v("0.5.0")), "never a downgrade");
        assert!(!accept(&v("0.5.0"), &v("0.6.0-beta.1")), "never a pre-release");
    }

    #[test]
    fn picks_the_android_app_of_a_newer_release() {
        let other = r#"{"name":"kisiauthong-0.4.0-linux-amd64.tar.gz","size":1,"browser_download_url":"https://github.com/puetsua/kisiauthong/releases/download/0.4.0/x","digest":null}"#;
        let json = release("0.4.0", &format!("{other},{}", apk("0.4.0", &format!("sha256:{HEX}"))));
        let u = pick(&json, "0.3.0", DOWNLOADS).unwrap().unwrap();
        assert_eq!(u.version, "0.4.0");
        assert_eq!(u.url, format!("{DOWNLOADS}0.4.0/kisiauthong-app-0.4.0-android.apk"));
        assert_eq!(u.size, 18_000_000);
        assert_eq!(u.sha256, HEX.to_ascii_lowercase());
    }

    #[test]
    fn up_to_date_or_ahead_finds_nothing() {
        let json = release("0.4.0", &apk("0.4.0", &format!("sha256:{HEX}")));
        assert_eq!(pick(&json, "0.4.0", DOWNLOADS).unwrap(), None);
        assert_eq!(pick(&json, "0.5.0-beta.1", DOWNLOADS).unwrap(), None);
    }

    #[test]
    fn drafts_and_pre_releases_are_skipped() {
        let d = format!(r#"{{"tag_name":"0.4.0","draft":true,"prerelease":false,"assets":[{}]}}"#, apk("0.4.0", &format!("sha256:{HEX}")));
        assert_eq!(pick(&d, "0.3.0", DOWNLOADS).unwrap(), None);
        let p = format!(r#"{{"tag_name":"0.4.0-beta.1","draft":false,"prerelease":true,"assets":[]}}"#);
        assert_eq!(pick(&p, "0.3.0", DOWNLOADS).unwrap(), None);
        let unmarked = release("0.4.0-beta.1", &apk("0.4.0-beta.1", &format!("sha256:{HEX}")));
        assert_eq!(pick(&unmarked, "0.3.0", DOWNLOADS).unwrap(), None, "a pre-release tag even when not marked");
    }

    #[test]
    fn a_newer_release_without_a_usable_apk_is_an_error() {
        let none = release("0.4.0", "");
        assert_eq!(pick(&none, "0.3.0", DOWNLOADS).unwrap_err(), "noApk: 0.4.0");
        for bad in ["", "sha256:", "sha256:abc", "md5:0123", &format!("sha256:{}", "z".repeat(64))] {
            let json = release("0.4.0", &apk("0.4.0", bad));
            assert_eq!(pick(&json, "0.3.0", DOWNLOADS).unwrap_err(), "noChecksum: 0.4.0", "{bad:?}");
        }
        let elsewhere = release(
            "0.4.0",
            &format!(r#"{{"name":"kisiauthong-app-0.4.0-android.apk","size":5,"browser_download_url":"https://example.org/0.4.0/a.apk","digest":"sha256:{HEX}"}}"#),
        );
        assert_eq!(pick(&elsewhere, "0.3.0", DOWNLOADS).unwrap_err(), "elsewhere: 0.4.0");
        let other_tag = release(
            "0.4.0",
            &format!(r#"{{"name":"kisiauthong-app-0.4.0-android.apk","size":5,"browser_download_url":"{DOWNLOADS}0.3.0/kisiauthong-app-0.4.0-android.apk","digest":"sha256:{HEX}"}}"#),
        );
        assert_eq!(pick(&other_tag, "0.3.0", DOWNLOADS).unwrap_err(), "elsewhere: 0.4.0", "the download belongs to the release's own tag");
        let empty = release(
            "0.4.0",
            &format!(r#"{{"name":"kisiauthong-app-0.4.0-android.apk","size":0,"browser_download_url":"{DOWNLOADS}0.4.0/kisiauthong-app-0.4.0-android.apk","digest":"sha256:{HEX}"}}"#),
        );
        assert_eq!(pick(&empty, "0.3.0", DOWNLOADS).unwrap_err(), "empty: 0.4.0");
        assert!(pick("not json", "0.3.0", DOWNLOADS).unwrap_err().starts_with("badAnswer: "));
        assert!(pick(&release("latest", ""), "0.3.0", DOWNLOADS).unwrap_err().starts_with("badAnswer: "));
        assert!(pick(&release("v0.4.0", ""), "0.3.0", DOWNLOADS).unwrap_err().starts_with("badAnswer: "), "tags have no v");
        assert!(pick(&release("0.4.0", ""), "x", DOWNLOADS).unwrap_err().starts_with("badVersion: "));
    }
}
