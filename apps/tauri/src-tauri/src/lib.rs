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
// which the server's Settings → Servers lists and manages that list.

mod probe;
mod profiles;

use std::collections::HashSet;
use std::path::PathBuf;
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
    active: Option<String>,
    servers: Vec<Profile>,
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
fn app_state(webview: Webview, shell: State<'_, Shell>) -> Result<AppState, String> {
    require_local(&webview)?;
    let s = shell.store.lock().unwrap();
    Ok(AppState { locale: sys_locale::get_locale().unwrap_or_default(), active: s.active.clone(), servers: s.servers.clone() })
}

#[tauri::command]
async fn probe(webview: Webview, url: String) -> Result<probe::Probe, String> {
    require_local(&webview)?;
    let u = parse(&url)?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Only http:// and https:// addresses are supported.".into());
    }
    Ok(probe::get(u.as_str()).await)
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

#[tauri::command]
fn cancel_form(webview: Webview, shell: State<'_, Shell>) -> Result<(), String> {
    require_local(&webview)?;
    let target = match shell.store.lock().unwrap().active_profile() {
        Some(a) => settings_of(a)?,
        None => screen_url(&[]),
    };
    go(&webview, target)
}

/* ---------- the bridge: also from saved servers' pages ---------- */

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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_state,
            probe,
            save_server,
            cancel_form,
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
            app.manage(Shell { store: Mutex::new(store), file, granted: Mutex::new(HashSet::new()) });
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
    fn screen_urls_carry_the_mode() {
        let u = screen_url(&[("mode", "edit"), ("id", "a b"), ("lang", "zh-TW")]);
        assert!(is_local(&u));
        assert_eq!(u.path(), "/index.html");
        assert_eq!(u.query(), Some("mode=edit&id=a+b&lang=zh-TW"));
    }
}
