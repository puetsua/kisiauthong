// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// 記數通 KiSiauThong app shell for macOS, Windows, iOS and Android (ADR 0019).
//
// The first version is online-only: the window shows the web UI of the user's
// own server, loaded from that server, so its sign-in cookie, same-origin API
// calls and base path work exactly as in a browser. The shell adds three
// things: the bundled server screen (../src) to enter or fix a server address,
// the saved server list (profiles.rs), and a small bridge (bridge.js) through
// which the server's Settings → Servers lists and manages that list. It can
// also update itself from the project's releases: Android through the system
// installer (update.rs, UpdatePlugin.kt; ADR 0020), Windows and macOS through
// Tauri's updater (ADR 0024). On Android the server check runs in Kotlin
// (ProbePlugin.kt).

mod probe;
mod profiles;
mod update;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, State, Url, Webview, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use profiles::{origin_of, Profile, Store};

const WINDOW: &str = "main";
const BRIDGE_JS: &str = include_str!("bridge.js");

struct Shell {
    store: Mutex<Store>,
    file: PathBuf,
    /// origins that already have a remote capability for the bridge
    granted: Mutex<HashSet<String>>,
    /// what the last update check found; install only ever uses this
    update: Mutex<Option<updates::Pending>>,
    /// set when the user opens App updates: the screen's check on load may run
    /// once, and not again when Back returns to the screen (ADR 0020)
    update_asked: AtomicBool,
}

impl Shell {
    fn persist(&self, store: &Store) -> Result<(), String> {
        store.save(&self.file).map_err(|e| format!("Could not write {}: {e}", self.file.display()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    /// the system locale, such as zh-Hant-TW; the screen picks its language from it
    locale: String,
    /// this app's version, such as 0.3.0
    version: String,
    /// android, ios, macos, windows, linux
    platform: &'static str,
    active: Option<String>,
    servers: Vec<Profile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    /// android, ios, macos, windows, linux
    platform: &'static str,
    /// whether the app can update itself (Android, Windows, macOS; ADR 0020, 0024)
    updates: bool,
}

#[derive(Serialize)]
struct UpdateCheck {
    current: String,
    update: Option<update::Found>,
    /// false: GitHub was not asked (the screen loaded without the user asking)
    checked: bool,
}

#[derive(Serialize)]
struct ServerList {
    active: Option<String>,
    servers: Vec<Profile>,
}

/// The bundled server screen: exactly tauri://localhost on Apple platforms
/// (and Linux), http://tauri.localhost on Windows and Android. Nothing else
/// counts, not https://tauri.localhost nor another tauri:// host; check_url
/// also refuses to save a server on the app's own host names.
fn is_local(url: &Url) -> bool {
    #[cfg(any(windows, target_os = "android"))]
    return url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none();
    #[cfg(not(any(windows, target_os = "android")))]
    return url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none();
}

fn screen_url(params: &[(&str, &str)]) -> Url {
    #[cfg(any(windows, target_os = "android"))]
    const BASE: &str = "http://tauri.localhost/index.html";
    #[cfg(not(any(windows, target_os = "android")))]
    const BASE: &str = "tauri://localhost/index.html";
    let mut u = Url::parse(BASE).expect("static url");
    if !params.is_empty() {
        u.query_pairs_mut().extend_pairs(params);
    }
    u
}

/// Whether a page belongs to a saved server (same scheme, host and port).
fn known(store: &Store, url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let o = url.origin().ascii_serialization();
    store.servers.iter().any(|p| origin_of(&p.url).as_deref() == Some(o.as_str()))
}

fn parse(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("Not a valid address: {e}"))
}

fn settings_of(p: &Profile) -> Result<Url, String> {
    let mut u = parse(&p.url)?;
    u.set_fragment(Some("settings"));
    Ok(u)
}

/// Lets pages of a saved server's origin call the bridge commands, and only those.
fn grant(app: &AppHandle, server_url: &str) {
    let Some(origin) = origin_of(server_url) else { return };
    let shell = app.state::<Shell>();
    let mut granted = shell.granted.lock().unwrap();
    if granted.contains(&origin) {
        return;
    }
    let cap = CapabilityBuilder::new(format!("server-{}", granted.len() + 1))
        .remote(format!("{origin}/*"))
        .local(false)
        .window(WINDOW)
        .permission("bridge");
    match app.add_capability(cap) {
        Ok(()) => {
            granted.insert(origin);
        }
        Err(e) => eprintln!("could not open the app bridge to {origin}: {e}"),
    }
}

// The capabilities already limit who may call what; the commands check again
// against the current list, because a removed server keeps its capability
// until the app restarts: Tauri can add a capability at run time but not take
// one back, and a deny capability would stay if the same server is added again.
fn require_local(w: &Webview) -> Result<(), String> {
    match w.url() {
        Ok(u) if is_local(&u) => Ok(()),
        _ => Err("Not allowed from this page.".into()),
    }
}

fn require_known(w: &Webview, shell: &Shell) -> Result<(), String> {
    let u = w.url().map_err(|e| e.to_string())?;
    if is_local(&u) || known(&shell.store.lock().unwrap(), &u) {
        Ok(())
    } else {
        Err("Not allowed from this page.".into())
    }
}

fn go(w: &Webview, url: Url) -> Result<(), String> {
    w.navigate(url).map_err(|e| e.to_string())
}

fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
            eprintln!("could not open a link in the system browser: {e}");
        }
    }
}

/// The window stays on the server screen and the saved servers; anything else
/// opens in the system browser.
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    if is_local(url) || matches!(url.scheme(), "about" | "blob") {
        return true;
    }
    let ok = known(&app.state::<Shell>().store.lock().unwrap(), url);
    if !ok {
        open_outside(app, url);
    }
    ok
}

/* ---------- commands of the server screen (local only) ---------- */

#[tauri::command]
fn app_state(app: AppHandle, webview: Webview, shell: State<'_, Shell>) -> Result<AppState, String> {
    require_local(&webview)?;
    let s = shell.store.lock().unwrap();
    Ok(AppState {
        locale: sys_locale::get_locale().unwrap_or_default(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        active: s.active.clone(),
        servers: s.servers.clone(),
    })
}

#[tauri::command]
async fn probe(app: AppHandle, webview: Webview, url: String) -> Result<probe::Probe, String> {
    require_local(&webview)?;
    let u = parse(&url)?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Only http:// and https:// addresses are supported.".into());
    }
    #[cfg(target_os = "android")]
    return Ok(android::probe(&app, u.as_str()).await);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(probe::get(u.as_str()).await)
    }
}

/// Saves a checked address. connect: make it the server in use and open it;
/// otherwise (an edit) go back to Settings of the server in use.
#[tauri::command]
fn save_server(
    app: AppHandle,
    webview: Webview,
    shell: State<'_, Shell>,
    id: Option<String>,
    name: Option<String>,
    url: String,
    connect: bool,
) -> Result<(), String> {
    require_local(&webview)?;
    let url = profiles::check_url(&url)?;
    let target = {
        let mut s = shell.store.lock().unwrap();
        let pid = s.upsert(id.as_deref(), name.as_deref(), &url)?;
        let target = match (connect, s.active_profile()) {
            (false, Some(a)) => settings_of(a)?,
            _ => {
                s.activate(&pid, profiles::now_iso());
                parse(&url)?
            }
        };
        shell.persist(&s)?;
        target
    };
    grant(&app, &url);
    go(&webview, target)
}

/// Where Back from the bundled screen may go: `back` only when it is a page of
/// a saved server.
fn back_to(store: &Store, back: Option<&str>) -> Option<Url> {
    back.and_then(|b| Url::parse(b).ok()).filter(|u| known(store, u))
}

/// Whether the App updates screen may ask GitHub now: always on a tap, and on
/// load only once after the user opened the screen (the flag is used up).
fn may_check(asked: &AtomicBool, on_load: bool) -> bool {
    let was_asked = asked.swap(false, Ordering::SeqCst);
    !on_load || was_asked
}

/// Leaves the bundled screen: to `back` when it is a page of a saved server
/// (the App updates screen passes the page that opened it), otherwise to the
/// active server's Settings.
#[tauri::command]
fn cancel_form(webview: Webview, shell: State<'_, Shell>, back: Option<String>) -> Result<(), String> {
    require_local(&webview)?;
    let target = {
        let store = shell.store.lock().unwrap();
        match back_to(&store, back.as_deref()) {
            Some(u) => u,
            None => match store.active_profile() {
                Some(a) => settings_of(a)?,
                None => screen_url(&[]),
            },
        }
    };
    go(&webview, target)
}

/// Asks GitHub for the latest release, only when the user asked: a tap on
/// Check (`on_load` false), or the screen loading right after the user opened
/// it from Settings (`on_load` true, once per opening).
#[tauri::command]
async fn update_check(app: AppHandle, webview: Webview, on_load: Option<bool>) -> Result<UpdateCheck, String> {
    require_local(&webview)?;
    let current = app.package_info().version.to_string();
    if !may_check(&app.state::<Shell>().update_asked, on_load.unwrap_or(false)) {
        return Ok(UpdateCheck { current, update: None, checked: false });
    }
    let pending = updates::check(&app, &current).await?;
    let found = pending.as_ref().map(updates::found);
    *app.state::<Shell>().update.lock().unwrap() = pending;
    Ok(UpdateCheck { current, update: found, checked: true })
}

/// Downloads and installs what the last check found; nothing from the page.
#[tauri::command]
async fn update_install(app: AppHandle, webview: Webview) -> Result<String, String> {
    require_local(&webview)?;
    let pending = app.state::<Shell>().update.lock().unwrap().clone();
    let u = pending.ok_or("checkFirst")?;
    updates::install(&app, u).await
}

/* ---------- the bridge: also from saved servers' pages ---------- */

#[tauri::command]
fn app_info(app: AppHandle, webview: Webview, shell: State<'_, Shell>) -> Result<AppInfo, String> {
    require_known(&webview, &shell)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        updates: updates::SUPPORTED,
    })
}

/// Opens the bundled screen's App updates page; Back returns to Settings → About
/// on the server that opened it.
#[tauri::command]
fn open_updates(webview: Webview, shell: State<'_, Shell>, lang: Option<String>) -> Result<(), String> {
    require_known(&webview, &shell)?;
    let mut back = webview.url().map_err(|e| e.to_string())?;
    back.set_fragment(Some("settings?about"));
    shell.update_asked.store(true, Ordering::SeqCst);
    let mut params = vec![("mode", "update"), ("back", back.as_str())];
    if let Some(lang) = lang.as_deref() {
        params.push(("lang", lang));
    }
    go(&webview, screen_url(&params))
}

#[tauri::command]
fn servers(webview: Webview, shell: State<'_, Shell>) -> Result<ServerList, String> {
    require_known(&webview, &shell)?;
    let s = shell.store.lock().unwrap();
    Ok(ServerList { active: s.active.clone(), servers: s.servers.clone() })
}

#[tauri::command]
fn use_server(webview: Webview, shell: State<'_, Shell>, id: String) -> Result<(), String> {
    require_known(&webview, &shell)?;
    let target = {
        let mut s = shell.store.lock().unwrap();
        let url = s.activate(&id, profiles::now_iso()).ok_or("That server is no longer saved.")?.url.clone();
        shell.persist(&s)?;
        parse(&url)?
    };
    go(&webview, target)
}

/// Removing the server in use opens the last used of the rest, or the server
/// screen when none is left.
#[tauri::command]
fn remove_server(webview: Webview, shell: State<'_, Shell>, id: String) -> Result<(), String> {
    require_known(&webview, &shell)?;
    let (was_active, next) = {
        let mut s = shell.store.lock().unwrap();
        let was_active = s.active.as_deref() == Some(id.as_str());
        if !s.remove(&id) {
            return Err("That server is no longer saved.".into());
        }
        shell.persist(&s)?;
        (was_active, s.active_profile().map(|p| p.url.clone()))
    };
    if !was_active {
        return Ok(());
    }
    go(&webview, match next {
        Some(u) => parse(&u)?,
        None => screen_url(&[]),
    })
}

#[tauri::command]
fn open_server_form(
    webview: Webview,
    shell: State<'_, Shell>,
    mode: String,
    id: Option<String>,
    lang: Option<String>,
) -> Result<(), String> {
    require_known(&webview, &shell)?;
    let mut params = vec![("mode", if mode == "edit" { "edit" } else { "add" })];
    if let Some(id) = id.as_deref() {
        params.push(("id", id));
    }
    if let Some(lang) = lang.as_deref() {
        params.push(("lang", lang));
    }
    go(&webview, screen_url(&params))
}

#[tauri::command]
fn open_external(app: AppHandle, webview: Webview, shell: State<'_, Shell>, url: String) -> Result<(), String> {
    require_known(&webview, &shell)?;
    open_outside(&app, &parse(&url)?);
    Ok(())
}

/// A yes/no question in a native dialog, in the web UI's words. WKWebView
/// (macOS, iOS) has no confirm panel, so window.confirm() answers false there.
#[cfg(desktop)]
#[tauri::command]
async fn confirm(
    app: AppHandle,
    webview: Webview,
    shell: State<'_, Shell>,
    message: String,
    ok: Option<String>,
    cancel: Option<String>,
) -> Result<bool, String> {
    require_known(&webview, &shell)?;
    let window = webview.window();
    let labels = ok.zip(cancel);
    let (tx, rx) = std::sync::mpsc::channel();
    // as tauri-plugin-dialog does: build the dialog on the main thread, wait for it on another
    app.run_on_main_thread(move || {
        let buttons = match labels.clone() {
            Some((ok, cancel)) => rfd::MessageButtons::OkCancelCustom(ok, cancel),
            None => rfd::MessageButtons::OkCancel,
        };
        let shown = rfd::AsyncMessageDialog::new()
            .set_level(rfd::MessageLevel::Warning)
            .set_description(message)
            .set_buttons(buttons)
            .set_parent(&window)
            .show();
        std::thread::spawn(move || {
            let yes = match tauri::async_runtime::block_on(shown) {
                rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes => true,
                rfd::MessageDialogResult::Custom(label) => labels.is_some_and(|(ok, _)| label == ok),
                _ => false,
            };
            let _ = tx.send(yes);
        });
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false)).await.map_err(|e| e.to_string())
}

/// iOS and Android: no native dialog yet; the web UI falls back to window.confirm()
/// (a real dialog on Android, always false on iOS).
#[cfg(mobile)]
#[tauri::command]
fn confirm(_message: String, _ok: Option<String>, _cancel: Option<String>) -> Result<bool, String> {
    Err("No native dialog on this platform yet.".into())
}

/* ---------- Android: the Kotlin side of updates and the server check ---------- */

#[cfg(target_os = "android")]
mod android {
    use serde::Deserialize;
    use tauri::plugin::PluginHandle;
    use tauri::{AppHandle, Manager, Wry};

    use crate::probe::{self, Probe};
    use crate::update::{self, Found, Update};

    pub const SUPPORTED: bool = true;
    pub type Pending = Update;

    pub fn found(u: &Update) -> Found {
        Found { version: u.version.clone(), size: Some(u.size) }
    }

    // One Tauri plugin per Kotlin class: Android keeps plugins by the Tauri
    // plugin's name, so a second class under the same name would replace the first.
    struct UpdateHandle(PluginHandle<Wry>);
    struct ProbeHandle(PluginHandle<Wry>);

    /// UpdatePlugin.kt
    pub fn update_plugin() -> tauri::plugin::TauriPlugin<Wry> {
        tauri::plugin::Builder::new("appupdate")
            .setup(|app, api| {
                app.manage(UpdateHandle(api.register_android_plugin("io.github.puetsua.kisiauthong", "UpdatePlugin")?));
                Ok(())
            })
            .build()
    }

    /// ProbePlugin.kt
    pub fn probe_plugin() -> tauri::plugin::TauriPlugin<Wry> {
        tauri::plugin::Builder::new("appprobe")
            .setup(|app, api| {
                app.manage(ProbeHandle(api.register_android_plugin("io.github.puetsua.kisiauthong", "ProbePlugin")?));
                Ok(())
            })
            .build()
    }

    /// The release list and where downloads must come from. A debug build may
    /// read both from update-source.txt in the app data folder (two lines), to
    /// test against a local server; release builds always use GitHub.
    fn source(app: &AppHandle) -> (String, String) {
        #[cfg(debug_assertions)]
        if let Ok(dir) = app.path().app_data_dir() {
            if let Ok(s) = std::fs::read_to_string(dir.join("update-source.txt")) {
                let mut l = s.lines().map(str::trim).filter(|l| !l.is_empty());
                if let (Some(api), Some(dl)) = (l.next(), l.next()) {
                    return (api.into(), dl.into());
                }
            }
        }
        let _ = app;
        (update::RELEASES_API.into(), update::DOWNLOADS.into())
    }

    fn call<T: serde::de::DeserializeOwned + Send + 'static>(
        h: &PluginHandle<Wry>,
        cmd: &'static str,
        args: serde_json::Value,
    ) -> impl std::future::Future<Output = Result<T, String>> {
        let h = h.clone();
        async move {
            tauri::async_runtime::spawn_blocking(move || h.run_mobile_plugin::<T>(cmd, args))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())
        }
    }

    pub async fn check(app: &AppHandle, current: &str) -> Result<Option<Update>, String> {
        #[derive(Deserialize)]
        struct Fetched {
            status: u16,
            body: String,
        }
        let (api, downloads) = source(app);
        let f: Fetched = call(&app.state::<UpdateHandle>().0, "fetch", serde_json::json!({ "url": api }))
            .await
            .map_err(|e| if e.starts_with("badAnswer: ") { e } else { format!("unreachable: {e}") })?;
        match f.status {
            200..=299 => update::pick(&f.body, current, &downloads),
            404 => Ok(None),
            s => Err(format!("status: {s}")),
        }
    }

    pub async fn install(app: &AppHandle, u: Update) -> Result<String, String> {
        #[derive(Deserialize)]
        struct Started {
            status: String,
        }
        let r: Started = call(&app.state::<UpdateHandle>().0, "install", serde_json::json!({ "url": u.url, "sha256": u.sha256, "size": u.size }))
            .await
            .map_err(|e| {
                let coded = e == "checksum" || e.starts_with("download: ") || e.starts_with("installer: ");
                if coded { e } else { format!("download: {e}") }
            })?;
        Ok(r.status)
    }

    /// The server check, as probe::get answers it elsewhere.
    pub async fn probe(app: &AppHandle, url: &str) -> Probe {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Answer {
            status: Option<u16>,
            final_url: Option<String>,
            content_type: Option<String>,
            body: Option<String>,
            error: Option<String>,
            detail: Option<String>,
        }
        match call::<Answer>(&app.state::<ProbeHandle>().0, "probe", serde_json::json!({ "url": url })).await {
            Ok(a) => Probe {
                status: a.status,
                final_url: a.final_url,
                content_type: a.content_type,
                body: a.body,
                error: a.error.as_deref().map(probe::kind),
                detail: a.detail,
            },
            Err(e) => Probe { error: Some("other"), detail: Some(e), ..Probe::default() },
        }
    }
}

#[cfg(target_os = "android")]
use android as updates;

/* ---------- Windows and macOS: Tauri's updater (ADR 0024) ---------- */

#[cfg(desktop)]
mod desktop {
    use std::time::Duration;

    use tauri::{AppHandle, Url};
    use tauri_plugin_updater::{Error, Update, UpdaterExt};

    /// A stalled network (a captive portal, a half-open connection) must end in
    /// an error, not a screen stuck on Checking… or Downloading…, as on Android.
    const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
    /// The whole download; the packages are a few MB.
    const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

    use crate::update::{self, Found};

    /// Linux is not built or released yet (ADR 0019).
    pub const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));
    pub type Pending = Update;

    pub fn found(u: &Update) -> Found {
        Found { version: u.version.clone(), size: None }
    }

    /// The release's update manifest. A debug build may read another one from
    /// update-source.txt in the app data folder (first line), to test against a
    /// local server; release builds always use GitHub.
    fn endpoint(app: &AppHandle) -> String {
        #[cfg(debug_assertions)]
        {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_data_dir() {
                if let Ok(s) = std::fs::read_to_string(dir.join("update-source.txt")) {
                    if let Some(l) = s.lines().map(str::trim).find(|l| !l.is_empty()) {
                        return l.into();
                    }
                }
            }
        }
        let _ = app;
        update::DESKTOP_MANIFEST.into()
    }

    /// The updater's errors as the codes the App updates screen puts into words.
    fn code(e: Error) -> String {
        match e {
            Error::Reqwest(e) => format!("unreachable: {e}"),
            Error::Network(e) => format!("unreachable: {e}"),
            Error::ReleaseNotFound => "noRelease".into(),
            Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "noBuild".into(),
            Error::Serialization(e) => format!("badAnswer: {e}"),
            Error::Semver(e) => format!("badAnswer: {e}"),
            Error::Minisign(_)
            | Error::Base64(_)
            | Error::SignatureUtf8(_)
            | Error::SignedVersionMismatch { .. }
            | Error::MissingSignedVersion => "signature".into(),
            e => format!("other: {e}"),
        }
    }

    pub async fn check(app: &AppHandle, _current: &str) -> Result<Option<Update>, String> {
        let url = Url::parse(&endpoint(app)).map_err(|e| format!("other: {e}"))?;
        app.updater_builder()
            .endpoints(vec![url])
            .map_err(code)?
            .version_comparator(|current, remote| update::accept(&current, &remote.version))
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(code)?
            .check()
            .await
            .map_err(code)
    }

    /// Downloads, checks the signature against the key built into the app, and
    /// installs. Windows runs the installer and quits; macOS replaces the app
    /// and restarts it here.
    pub async fn install(app: &AppHandle, mut u: Update) -> Result<String, String> {
        u.timeout = Some(DOWNLOAD_TIMEOUT);
        u.download_and_install(|_, _| {}, || {}).await.map_err(|e| match code(e) {
            c if c == "signature" || c.starts_with("unreachable") => c,
            c => format!("download: {c}"),
        })?;
        app.restart()
    }
}

#[cfg(desktop)]
use desktop as updates;

/// iOS apps are updated by the App Store (ADR 0020).
#[cfg(target_os = "ios")]
mod updates {
    use tauri::AppHandle;

    use crate::update::Found;

    pub const SUPPORTED: bool = false;
    const NOT_HERE: &str = "unsupported";
    pub type Pending = ();

    pub fn found(_: &()) -> Found {
        unreachable!("iOS never finds an update")
    }

    pub async fn check(_app: &AppHandle, _current: &str) -> Result<Option<()>, String> {
        Err(NOT_HERE.into())
    }

    pub async fn install(_app: &AppHandle, _u: ()) -> Result<String, String> {
        Err(NOT_HERE.into())
    }
}

/* ---------- the window ---------- */

fn open_window(app: &AppHandle) -> tauri::Result<()> {
    let nav = app.clone();
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .initialization_script(BRIDGE_JS)
        .on_navigation(move |url| allow_navigation(&nav, url));
    #[cfg(desktop)]
    let builder = {
        use tauri::webview::{DownloadEvent, NewWindowResponse};
        let ext = app.clone();
        let dl = app.clone();
        let last = Mutex::new(None::<PathBuf>);
        builder
            .title("記數通 KiSiauThong")
            .inner_size(1180.0, 800.0)
            .min_inner_size(360.0, 520.0)
            .on_new_window(move |url, _| {
                open_outside(&ext, &url);
                NewWindowResponse::Deny
            })
            // Data → Export JSON: saved to the Downloads folder, then shown in Finder / Explorer
            .on_download(move |_, event| {
                match event {
                    DownloadEvent::Requested { destination, .. } => *last.lock().unwrap() = Some(destination.clone()),
                    DownloadEvent::Finished { path, success: true, .. } => {
                        if let Some(p) = path.filter(|p| !p.as_os_str().is_empty()).or_else(|| last.lock().unwrap().take()) {
                            let _ = dl.opener().reveal_item_in_dir(p);
                        }
                    }
                    _ => {}
                }
                true
            })
    };
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android::update_plugin()).plugin(android::probe_plugin());
    builder
        .invoke_handler(tauri::generate_handler![
            app_state,
            probe,
            save_server,
            cancel_form,
            update_check,
            update_install,
            app_info,
            open_updates,
            servers,
            use_server,
            remove_server,
            open_server_form,
            open_external,
            confirm
        ])
        .setup(|app| {
            let file = app.path().app_data_dir()?.join("servers.json");
            let store = Store::load(&file);
            let urls: Vec<String> = store.servers.iter().map(|p| p.url.clone()).collect();
            app.manage(Shell { store: Mutex::new(store), file, granted: Mutex::new(HashSet::new()), update: Mutex::new(None), update_asked: AtomicBool::new(false) });
            for u in &urls {
                grant(app.handle(), u);
            }
            open_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the KiSiauThong app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_and_known_pages() {
        assert!(is_local(&screen_url(&[])));
        assert!(is_local(&screen_url(&[("mode", "add")])));
        for other in [
            "https://tauri.localhost/",
            "https://tauri.localhost.example.org/",
            "http://tauri.localhost:8080/",
            "tauri://evil.example/",
            "tauri://localhost:9728/",
        ] {
            assert!(!is_local(&Url::parse(other).unwrap()), "{other} is not the server screen");
        }
        #[cfg(not(any(windows, target_os = "android")))]
        assert!(!is_local(&Url::parse("http://tauri.localhost/index.html").unwrap()), "only the platform's own form");
        let mut s = Store::default();
        s.upsert(None, None, "https://books.example.org/kisiauthong/").unwrap();
        assert!(known(&s, &Url::parse("https://books.example.org/kisiauthong/#settings").unwrap()));
        assert!(known(&s, &Url::parse("https://books.example.org/other-app/").unwrap()), "same origin");
        assert!(!known(&s, &Url::parse("http://books.example.org/kisiauthong/").unwrap()), "other scheme");
        assert!(!known(&s, &Url::parse("https://books.example.org:8443/").unwrap()), "other port");
        assert!(!known(&s, &Url::parse("https://www.gnu.org/licenses/agpl-3.0.html").unwrap()));
    }

    #[test]
    fn back_goes_only_to_a_saved_server() {
        let mut s = Store::default();
        s.upsert(None, None, "https://books.example.org/kisiauthong/").unwrap();
        let ok = "https://books.example.org/kisiauthong/#settings?about";
        assert_eq!(back_to(&s, Some(ok)).map(|u| u.to_string()).as_deref(), Some(ok));
        assert_eq!(back_to(&s, Some("https://evil.example/#settings")), None, "not a saved server");
        assert_eq!(back_to(&s, Some("http://tauri.localhost/index.html")), None, "not the screen itself");
        assert_eq!(back_to(&s, Some("not a url")), None);
        assert_eq!(back_to(&s, None), None);
    }

    #[test]
    fn the_screen_asks_github_once_per_opening() {
        let asked = AtomicBool::new(false);
        assert!(!may_check(&asked, true), "loaded without the user opening it (Back into the screen)");
        asked.store(true, Ordering::SeqCst); // the user opened App updates
        assert!(may_check(&asked, true), "the check on load right after opening");
        assert!(!may_check(&asked, true), "not again on the next load");
        assert!(may_check(&asked, false), "a tap on Check always asks");
        asked.store(true, Ordering::SeqCst);
        assert!(may_check(&asked, false));
        assert!(!may_check(&asked, true), "a tap uses up the opening too");
    }

    #[test]
    fn screen_urls_carry_the_mode() {
        let u = screen_url(&[("mode", "edit"), ("id", "a b"), ("lang", "zh-TW")]);
        assert!(is_local(&u));
        assert_eq!(u.path(), "/index.html");
        assert_eq!(u.query(), Some("mode=edit&id=a+b&lang=zh-TW"));
    }
}
