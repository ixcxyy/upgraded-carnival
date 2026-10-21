//! Signal / Noise, the desktop app: a window with the game's UI, and one command that forwards
//! everything to the Rust core (`k28_app::App`). The emulator, the compiler driver and the
//! checkers all live there; this file only wires them to Tauri.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

struct Core(Arc<k28_app::App>);

/// Every UI request: `call(cmd, args)` → JSON, or an error string. Work runs on a blocking
/// thread so a long build or a debugger step never freezes the window.
#[tauri::command]
async fn call(core: tauri::State<'_, Core>, cmd: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let app = core.0.clone();
    tauri::async_runtime::spawn_blocking(move || app.call(&cmd, &args))
        .await
        .map_err(|e| format!("internal error: {}", e))?
}

/// Where the bundled compiler and SDK are: the app's resource folder when installed, or the
/// source tree's `resources` folder when running with `tauri dev`.
fn resource_dir(app: &tauri::App) -> PathBuf {
    if let Ok(r) = app.path().resource_dir() {
        // Windows hands out \\?\C:\… here; zig, the DWARF it writes and Explorer all want C:\….
        let r = dunce::simplified(&r).to_path_buf();
        if r.join("sdk").join("link.ld").is_file() {
            return r;
        }
        let nested = r.join("resources");
        if nested.join("sdk").join("link.ld").is_file() {
            return nested;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir().expect("no app data folder on this system");
            let data = dunce::simplified(&data).to_path_buf();
            std::fs::create_dir_all(&data).ok();
            let res = resource_dir(app);
            app.manage(Core(Arc::new(k28_app::App::new(data, res))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("the game could not start its window");
}
