// SPDX-License-Identifier: AGPL-3.0-or-later
// The app's own commands get permissions (allow-<command>), so the default
// capability and the per-server remote capabilities grant them one by one.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_state",
            "probe",
            "save_server",
            "cancel_form",
            "update_check",
            "update_install",
            "update_settings",
            "app_info",
            "open_updates",
            "returned",
            "servers",
            "use_server",
            "remove_server",
            "open_server_form",
            "open_external",
            "confirm",
        ]),
    ))
    .expect("failed to run tauri-build");
}
