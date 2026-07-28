#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            let state_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("window_state.json");

            if let Ok(contents) = fs::read_to_string(&state_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                    if let Some(x) = parsed.get("x").and_then(|v| v.as_f64()) {
                        if let Some(y) = parsed.get("y").and_then(|v| v.as_f64()) {
                            let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                        }
                    }
                    if let Some(width) = parsed.get("width").and_then(|v| v.as_f64()) {
                        if let Some(height) = parsed.get("height").and_then(|v| v.as_f64()) {
                            let _ = window.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
                        }
                    }
                }
            }

            let window_for_events = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    if let Ok(position) = window_for_events.outer_position() {
                        if let Ok(size) = window_for_events.outer_size() {
                            let state = serde_json::json!({
                                "x": position.x,
                                "y": position.y,
                                "width": size.width,
                                "height": size.height
                            });
                            let _ = fs::write(&state_path, serde_json::to_string_pretty(&state).unwrap_or_default());
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
