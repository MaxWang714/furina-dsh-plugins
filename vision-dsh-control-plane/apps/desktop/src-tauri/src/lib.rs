#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, RunEvent, WindowEvent};

struct GatewayProcess(Mutex<Option<Child>>);

#[tauri::command]
fn product_info() -> serde_json::Value {
    serde_json::json!({"name":"Vision","displayName":"神之眼","version":"0.1.0","gateway":"127.0.0.1:8787"})
}

#[tauri::command]
fn gateway_status() -> serde_json::Value {
    serde_json::json!({"running": true, "bind":"127.0.0.1:8787", "provider":"127.0.0.1:8790"})
}

fn locate_server(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    let current = std::env::current_dir().ok()?;
    let candidates = [
        current.join("dist/server.js"),
        current.join("..").join("dist/server.js"),
        current.join("..").join("..").join("dist/server.js"),
        app.path().resource_dir().ok()?.join("server.js"),
    ];
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| (p, current))
}

fn start_gateway(app: &tauri::AppHandle) -> Option<Child> {
    let (server, cwd) = locate_server(app)?;
    Command::new("node")
        .arg(server)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .ok()
}

fn stop_gateway(state: &GatewayProcess) {
    if let Ok(mut child) = state.0.lock() {
        if let Some(mut process) = child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(GatewayProcess(Mutex::new(None)))
        .setup(|app| {
            let state = app.state::<GatewayProcess>();
            if let Some(child) = start_gateway(app.handle()) {
                *state.0.lock().expect("gateway state lock") = Some(child);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let state = window.app_handle().state::<GatewayProcess>();
                stop_gateway(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![product_info, gateway_status])
        .build(tauri::generate_context!())
        .expect("error while building Vision desktop")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                let state = app.state::<GatewayProcess>();
                stop_gateway(&state);
            }
        });
}
