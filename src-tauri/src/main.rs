#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod startup;

use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn save_window_state(window: &tauri::WebviewWindow, state_path: &std::path::Path) {
    if window.is_minimized().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return;
    }

    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let state = serde_json::json!({
            "x": position.x,
            "y": position.y,
            "width": size.width,
            "height": size.height
        });

        if let Some(parent) = state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(
            state_path,
            serde_json::to_string_pretty(&state).unwrap_or_default(),
        );
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            #[cfg(target_os = "windows")]
            {
                if let Err(error) = startup::set_startup_enabled(true) {
                    eprintln!("Windows başlangıç kaydı oluşturulamadı: {error}");
                }
            }
            let show_item = MenuItem::with_id(app, "show", "Uygulamayı Aç", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Gizle", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("application icon").clone())
                .tooltip("Desktop Dashboard")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let state_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("window_state.json");

            if let Ok(contents) = fs::read_to_string(&state_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
                    if let Some(width) = parsed.get("width").and_then(|v| v.as_f64()) {
                        if let Some(height) = parsed.get("height").and_then(|v| v.as_f64()) {
                            let _ = window
                                .set_size(tauri::PhysicalSize::new(width as u32, height as u32));
                        }
                    }
                    if let Some(x) = parsed.get("x").and_then(|v| v.as_f64()) {
                        if let Some(y) = parsed.get("y").and_then(|v| v.as_f64()) {
                            let _ = window
                                .set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                        }
                    }
                }
            }

            let window_for_events = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    save_window_state(&window_for_events, &state_path);
                    api.prevent_close();
                    let _ = window_for_events.hide();
                }
                WindowEvent::Resized(_) if window_for_events.is_minimized().unwrap_or(false) => {
                    let _ = window_for_events.hide();
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    save_window_state(&window_for_events, &state_path);
                }
                _ => {}
            });

            show_main_window(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
