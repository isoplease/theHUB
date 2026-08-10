#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod startup;

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent, Wry,
};

struct TrayMenuItems {
    show: MenuItem<Wry>,
    hide: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[tauri::command]
fn set_tray_language(language: String, items: State<'_, TrayMenuItems>) -> Result<(), String> {
    let (show, hide, quit) = if language == "en" {
        ("Open Application", "Hide", "Exit")
    } else {
        ("Uygulamayı Aç", "Gizle", "Çıkış")
    };

    items
        .show
        .set_text(show)
        .map_err(|error| error.to_string())?;
    items
        .hide
        .set_text(hide)
        .map_err(|error| error.to_string())?;
    items
        .quit
        .set_text(quit)
        .map_err(|error| error.to_string())?;
    Ok(())
}

const MAX_NOTE_BACKUP_BYTES: usize = 100_000;
const MAX_NOTE_EXPORT_BYTES: usize = 10_000_000;
const MAX_NOTE_BACKUPS: usize = 10;

fn write_new_file_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Geçersiz dosya yolu".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("file")
    ));
    fs::write(&temporary_path, data).map_err(|error| error.to_string())?;
    fs::rename(&temporary_path, path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        error.to_string()
    })
}

#[tauri::command]
fn backup_quick_note(app: tauri::AppHandle, text: String) -> Result<String, String> {
    if text.len() > MAX_NOTE_BACKUP_BYTES {
        return Err("Not yedeği izin verilen boyutu aşıyor".to_string());
    }

    let backup_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("quick-note-backups");
    fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let backup_path = backup_directory.join(format!("quick-note-{timestamp}.thehub-notes"));
    write_new_file_atomically(&backup_path, text.as_bytes())?;

    let mut backups = fs::read_dir(&backup_directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|extension| extension.to_str()) == Some("thehub-notes")
        })
        .collect::<Vec<_>>();
    backups.sort();
    let obsolete_count = backups.len().saturating_sub(MAX_NOTE_BACKUPS);
    for obsolete in backups.into_iter().take(obsolete_count) {
        let _ = fs::remove_file(obsolete);
    }

    Ok(backup_directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_note_export(path: String, format: String, data: Vec<u8>) -> Result<(), String> {
    if data.len() > MAX_NOTE_EXPORT_BYTES {
        return Err("Dışa aktarılacak dosya izin verilen boyutu aşıyor".to_string());
    }

    let expected_extension = match format.as_str() {
        "txt" => "txt",
        "html" => "html",
        "pdf" => "pdf",
        _ => return Err("Desteklenmeyen dışa aktarma biçimi".to_string()),
    };
    let export_path = PathBuf::from(path);
    if export_path
        .extension()
        .and_then(|extension| extension.to_str())
        != Some(expected_extension)
    {
        return Err("Dosya uzantısı seçilen biçimle eşleşmiyor".to_string());
    }

    let parent = export_path
        .parent()
        .ok_or_else(|| "Geçersiz dışa aktarma yolu".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary_path = export_path.with_extension(format!("{expected_extension}.tmp"));
    fs::write(&temporary_path, data).map_err(|error| error.to_string())?;
    if export_path.exists() {
        fs::remove_file(&export_path).map_err(|error| {
            let _ = fs::remove_file(&temporary_path);
            error.to_string()
        })?;
    }
    fs::rename(&temporary_path, &export_path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        error.to_string()
    })
}

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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_tray_language,
            backup_quick_note,
            write_note_export
        ])
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
            app.manage(TrayMenuItems {
                show: show_item.clone(),
                hide: hide_item.clone(),
                quit: quit_item.clone(),
            });

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("application icon").clone())
                .tooltip("theHUB")
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
