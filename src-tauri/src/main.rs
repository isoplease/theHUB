#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod convert;
mod pdf_pages;
#[cfg(target_os = "windows")]
mod joystick;
mod startup;

use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent, Wry,
};

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy, serde::Deserialize, serde::Serialize)]
struct SavedWindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct WindowStateStore {
    path: PathBuf,
    initial: Option<SavedWindowState>,
    ready: Arc<AtomicBool>,
}

const DIAGNOSTIC_LOG_MAX_BYTES: u64 = 512 * 1024;
const MEDIA_STALL_THRESHOLD: Duration = Duration::from_secs(5);
const RENDERER_STALL_THRESHOLD: Duration = Duration::from_secs(30);
const MEDIA_ASYNC_TIMEOUT: Duration = Duration::from_secs(3);

struct MediaWatchState {
    operation: Option<&'static str>,
    started_at: Option<Instant>,
    stall_logged: bool,
}

struct RendererWatchState {
    last_heartbeat: Instant,
    monitoring_visible_window: bool,
    stall_logged: bool,
}

struct DiagnosticsState {
    log_path: Option<PathBuf>,
    marker_path: Option<PathBuf>,
    clean_exit: AtomicBool,
    log_lock: Mutex<()>,
    media_watch: Mutex<MediaWatchState>,
    renderer_watch: Mutex<RendererWatchState>,
    last_media_failure: Mutex<Option<(&'static str, Instant)>>,
}

impl DiagnosticsState {
    fn initialize(app: &tauri::AppHandle) -> Result<Arc<Self>, String> {
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join("logs");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let log_path = directory.join("thehub-diagnostics.log");
        let marker_path = directory.join("session-active.marker");
        rotate_diagnostic_log(&log_path);
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| error.to_string())?;

        let previous_session_incomplete = marker_path.exists();
        fs::write(
            &marker_path,
            format!(
                "pid={} started_unix_ms={}",
                std::process::id(),
                unix_timestamp_millis()
            ),
        )
        .map_err(|error| error.to_string())?;

        let state = Arc::new(Self {
            log_path: Some(log_path),
            marker_path: Some(marker_path),
            clean_exit: AtomicBool::new(false),
            log_lock: Mutex::new(()),
            media_watch: Mutex::new(MediaWatchState {
                operation: None,
                started_at: None,
                stall_logged: false,
            }),
            renderer_watch: Mutex::new(RendererWatchState {
                last_heartbeat: Instant::now(),
                monitoring_visible_window: false,
                stall_logged: false,
            }),
            last_media_failure: Mutex::new(None),
        });
        if previous_session_incomplete {
            state.record(
                "PREVIOUS_SESSION_NOT_CLEAN",
                "Previous process left its active-session marker behind",
            );
        }
        Ok(state)
    }

    fn disabled() -> Arc<Self> {
        Arc::new(Self {
            log_path: None,
            marker_path: None,
            clean_exit: AtomicBool::new(false),
            log_lock: Mutex::new(()),
            media_watch: Mutex::new(MediaWatchState {
                operation: None,
                started_at: None,
                stall_logged: false,
            }),
            renderer_watch: Mutex::new(RendererWatchState {
                last_heartbeat: Instant::now(),
                monitoring_visible_window: false,
                stall_logged: false,
            }),
            last_media_failure: Mutex::new(None),
        })
    }

    fn record(&self, event: &str, detail: &str) {
        let Some(log_path) = &self.log_path else {
            return;
        };
        if let Ok(_guard) = self.log_lock.lock() {
            append_diagnostic_log(log_path, event, detail);
        }
    }

    fn begin_media_operation(&self, operation: &'static str) {
        if let Ok(mut watch) = self.media_watch.lock() {
            watch.operation = Some(operation);
            watch.started_at = Some(Instant::now());
            watch.stall_logged = false;
        }
    }

    fn finish_media_operation(&self) {
        if let Ok(mut watch) = self.media_watch.lock() {
            watch.operation = None;
            watch.started_at = None;
            watch.stall_logged = false;
        }
    }

    fn check_media_stall(&self) {
        let operation = if let Ok(mut watch) = self.media_watch.lock() {
            if !watch.stall_logged
                && watch
                    .started_at
                    .is_some_and(|started| started.elapsed() >= MEDIA_STALL_THRESHOLD)
            {
                watch.stall_logged = true;
                watch.operation
            } else {
                None
            }
        } else {
            None
        };
        if let Some(operation) = operation {
            self.record(
                "MEDIA_OPERATION_STALLED",
                &format!("operation={operation} exceeded 5 seconds"),
            );
        }
    }

    fn renderer_heartbeat(&self) {
        if let Ok(mut watch) = self.renderer_watch.lock() {
            watch.last_heartbeat = Instant::now();
            watch.stall_logged = false;
        }
    }

    fn check_renderer_stall(&self, window_is_active: bool, watchdog_was_suspended: bool) {
        let should_record = if let Ok(mut watch) = self.renderer_watch.lock() {
            if watchdog_was_suspended {
                watch.last_heartbeat = Instant::now();
                watch.stall_logged = false;
                false
            } else if !window_is_active {
                watch.monitoring_visible_window = false;
                watch.stall_logged = false;
                false
            } else if !watch.monitoring_visible_window {
                watch.monitoring_visible_window = true;
                watch.last_heartbeat = Instant::now();
                false
            } else if !watch.stall_logged
                && watch.last_heartbeat.elapsed() >= RENDERER_STALL_THRESHOLD
            {
                watch.stall_logged = true;
                true
            } else {
                false
            }
        } else {
            false
        };
        if should_record {
            self.record(
                "RENDERER_UNRESPONSIVE",
                "Visible renderer missed heartbeats for at least 30 seconds",
            );
        }
    }

    fn record_media_failure(&self, event: &'static str, detail: &str) {
        let should_record = if let Ok(mut last) = self.last_media_failure.lock() {
            let should_record = last.as_ref().is_none_or(|(previous_event, recorded_at)| {
                *previous_event != event || recorded_at.elapsed() >= Duration::from_secs(300)
            });
            if should_record {
                *last = Some((event, Instant::now()));
            }
            should_record
        } else {
            false
        };
        if should_record {
            self.record(event, detail);
        }
    }

    fn mark_clean_exit(&self) {
        if !self.clean_exit.swap(true, Ordering::AcqRel) {
            if let Some(marker_path) = &self.marker_path {
                let _ = fs::remove_file(marker_path);
            }
        }
    }
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn rotate_diagnostic_log(path: &Path) {
    if fs::metadata(path)
        .map(|metadata| metadata.len() >= DIAGNOSTIC_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let previous = path.with_extension("log.old");
        let _ = fs::remove_file(&previous);
        let _ = fs::rename(path, previous);
    }
}

fn append_diagnostic_log(path: &Path, event: &str, detail: &str) {
    rotate_diagnostic_log(path);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "unix_ms={} version={} event={} detail={}",
            unix_timestamp_millis(),
            env!("CARGO_PKG_VERSION"),
            event,
            detail
        );
    }
}

fn install_panic_diagnostics(diagnostics: Arc<DiagnosticsState>) {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown".to_string());
        diagnostics.record("RUST_PANIC", &format!("location={location}"));
        default_hook(info);
    }));
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteRecoveryBackup {
    content: String,
    updated_at: String,
}

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
const MAX_RICH_NOTE_BACKUP_BYTES: usize = 4_000_000;
const MAX_NOTE_EXPORT_BYTES: usize = 10_000_000;
const MAX_NOTE_BACKUPS: usize = 10;
const MAX_RICH_NOTE_BACKUPS: usize = 5;
const RICH_NOTE_PREFIX: &str = "dashboard-rich-note-v1:";
const QUICK_NOTE_WORKSPACE_COUNT: u8 = 4;

fn validate_note_workspace(workspace_id: u8) -> Result<(), String> {
    if (1..=QUICK_NOTE_WORKSPACE_COUNT).contains(&workspace_id) {
        Ok(())
    } else {
        Err("Geçersiz not çalışma alanı".to_string())
    }
}

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

fn remove_oldest_backups(
    directory: &Path,
    prefix: &str,
    extension: &str,
    keep: usize,
) -> Result<(), String> {
    let mut backups = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(prefix))
                && path.extension().and_then(|value| value.to_str()) == Some(extension)
        })
        .collect::<Vec<_>>();
    backups.sort();
    let obsolete_count = backups.len().saturating_sub(keep);
    for obsolete in backups.into_iter().take(obsolete_count) {
        let _ = fs::remove_file(obsolete);
    }
    Ok(())
}

fn quick_note_backup_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|path| path.join("quick-note-backups"))
}

#[tauri::command]
fn backup_quick_note(
    app: tauri::AppHandle,
    text: String,
    content: String,
    updated_at: String,
    workspace_id: u8,
) -> Result<String, String> {
    validate_note_workspace(workspace_id)?;
    if text.len() > MAX_NOTE_BACKUP_BYTES {
        return Err("Not yedeği izin verilen boyutu aşıyor".to_string());
    }
    if content.len() > MAX_RICH_NOTE_BACKUP_BYTES || !content.starts_with(RICH_NOTE_PREFIX) {
        return Err("Biçimli not yedeği geçersiz veya çok büyük".to_string());
    }

    let backup_directory = quick_note_backup_directory(&app)?;
    fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let plain_prefix = format!("quick-note-workspace-{workspace_id}-");
    let rich_prefix = format!("quick-note-rich-workspace-{workspace_id}-");
    let backup_path = backup_directory.join(format!("{plain_prefix}{timestamp}.thehub-notes"));
    write_new_file_atomically(&backup_path, text.as_bytes())?;

    let rich_backup = NoteRecoveryBackup {
        content,
        updated_at,
    };
    let rich_path = backup_directory.join(format!("{rich_prefix}{timestamp}.json"));
    let rich_data = serde_json::to_vec(&rich_backup).map_err(|error| error.to_string())?;
    write_new_file_atomically(&rich_path, &rich_data)?;

    remove_oldest_backups(
        &backup_directory,
        &plain_prefix,
        "thehub-notes",
        MAX_NOTE_BACKUPS,
    )?;
    remove_oldest_backups(
        &backup_directory,
        &rich_prefix,
        "json",
        MAX_RICH_NOTE_BACKUPS,
    )?;

    Ok(backup_directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_quick_note_backup(
    app: tauri::AppHandle,
    workspace_id: u8,
) -> Result<Option<NoteRecoveryBackup>, String> {
    validate_note_workspace(workspace_id)?;
    let directory = quick_note_backup_directory(&app)?;
    if !directory.exists() {
        return Ok(None);
    }

    let rich_prefix = format!("quick-note-rich-workspace-{workspace_id}-");
    let mut backups = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with(&rich_prefix)
                        || (workspace_id == 1
                            && name.starts_with("quick-note-rich-")
                            && !name.starts_with("quick-note-rich-workspace-"))
                })
                && path.extension().and_then(|value| value.to_str()) == Some("json")
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    backups.reverse();

    for path in backups {
        let Ok(data) = fs::read(path) else { continue };
        let Ok(backup) = serde_json::from_slice::<NoteRecoveryBackup>(&data) else {
            continue;
        };
        if backup.content.starts_with(RICH_NOTE_PREFIX)
            && backup.content.len() <= MAX_RICH_NOTE_BACKUP_BYTES
        {
            return Ok(Some(backup));
        }
    }
    Ok(None)
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

fn bring_main_window_to_front(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        // Briefly promote the window in the Z-order, then return it to normal
        // so the shortcut never leaves the dashboard permanently always-on-top.
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
    }
}

fn should_hide_main_window(is_visible: bool, is_minimized: bool, is_focused: bool) -> bool {
    is_visible && !is_minimized && is_focused
}

/// Gorev cubugu modunda HUB kapanmaz/gizlenmez; yalnizca tepsiden "Cikis" kapatir.
static TASKBAR_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn taskbar_mode() -> bool {
    TASKBAR_MODE.load(Ordering::Acquire)
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let should_hide = should_hide_main_window(
        window.is_visible().unwrap_or(false),
        window.is_minimized().unwrap_or(false),
        window.is_focused().unwrap_or(false),
    );
    if should_hide && !taskbar_mode() {
        let _ = window.hide();
    } else {
        bring_main_window_to_front(app);
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if taskbar_mode() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn show_window_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL), Code::F12)
}

fn is_show_window_shortcut(shortcut: &Shortcut) -> bool {
    shortcut.matches(Modifiers::CONTROL, Code::F12)
}

#[cfg(target_os = "windows")]
mod windows_work_area {
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        size: u32,
        monitor: Rect,
        work: Rect,
        flags: u32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn MonitorFromRect(rect: *const Rect, flags: u32) -> isize;
        fn MonitorFromWindow(window: isize, flags: u32) -> isize;
        fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetWindowRect(window: isize, rect: *mut Rect) -> i32;
        fn IsIconic(window: isize) -> i32;
        fn IsWindowVisible(window: isize) -> i32;
        fn SetWindowPos(window: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn FindWindowW(class: *const u16, title: *const u16) -> isize;
        fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
    }

    /// Pencereyi odak almadan en-ustte (gorev cubugunun ustunde) tutar.
    /// tao ayni bayragi tekrar uygulamadigi icin dogrudan SetWindowPos gerekir.
    pub fn raise_topmost(window: isize) {
        const HWND_TOPMOST: isize = -1;
        const SWP_NOSIZE: u32 = 0x0001;
        const SWP_NOMOVE: u32 = 0x0002;
        const SWP_NOACTIVATE: u32 = 0x0010;
        unsafe {
            SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn window_rect(window: isize) -> Option<Rect> {
        let mut rect = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        (window != 0 && unsafe { GetWindowRect(window, &mut rect) } != 0).then_some(rect)
    }

    /// Secilen ekranin gorev cubugu: (ekran, calisma alani, bildirim alani sol kenari).
    pub struct TaskbarGeometry {
        pub monitor: (i32, i32, i32, i32),
        pub work_bottom: i32,
        pub tray_left: Option<i32>,
    }

    pub fn taskbar_geometry(x: i32, y: i32) -> Option<TaskbarGeometry> {
        const MONITOR_DEFAULTTONEAREST: u32 = 2;
        let rect = Rect { left: x, top: y, right: x + 1, bottom: y + 1 };
        let monitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) };
        if monitor == 0 {
            return None;
        }
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 },
            work: Rect { left: 0, top: 0, right: 0, bottom: 0 },
            flags: 0,
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        // Once ana, sonra ikincil gorev cubugu; bu ekranda olani sec.
        let mut tray_left = None;
        for class in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            let class_name = wide(class);
            let tray = unsafe { FindWindowW(class_name.as_ptr(), std::ptr::null()) };
            let Some(tray_rect) = window_rect(tray) else { continue };
            let center_x = (tray_rect.left + tray_rect.right) / 2;
            let center_y = (tray_rect.top + tray_rect.bottom) / 2;
            let on_monitor = center_x >= info.monitor.left && center_x < info.monitor.right
                && center_y >= info.monitor.top && center_y < info.monitor.bottom;
            if !on_monitor {
                continue;
            }
            let notify_name = wide("TrayNotifyWnd");
            let notify = unsafe { FindWindowExW(tray, 0, notify_name.as_ptr(), std::ptr::null()) };
            tray_left = window_rect(notify).map(|notify_rect| notify_rect.left);
            break;
        }
        Some(TaskbarGeometry {
            monitor: (info.monitor.left, info.monitor.top, info.monitor.right, info.monitor.bottom),
            work_bottom: info.work.bottom,
            tray_left,
        })
    }

    pub fn nearest(x: i32, y: i32, width: u32, height: u32) -> Option<(i32, i32, i32, i32)> {
        const MONITOR_DEFAULTTONEAREST: u32 = 2;
        let rect = Rect {
            left: x,
            top: y,
            right: x.saturating_add(width.min(i32::MAX as u32) as i32),
            bottom: y.saturating_add(height.min(i32::MAX as u32) as i32),
        };
        let monitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) };
        if monitor == 0 {
            return None;
        }

        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            work: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            flags: 0,
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        Some((
            info.work.left,
            info.work.top,
            info.work.right,
            info.work.bottom,
        ))
    }

    fn monitor_info(window: isize) -> Option<(isize, MonitorInfo)> {
        const MONITOR_DEFAULTTONEAREST: u32 = 2;
        let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
        if monitor == 0 {
            return None;
        }
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            monitor: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            work: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            flags: 0,
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return None;
        }
        Some((monitor, info))
    }

    fn covers(rect: &Rect, area: &Rect) -> bool {
        const TOLERANCE: i32 = 4;
        rect.left <= area.left.saturating_add(TOLERANCE)
            && rect.top <= area.top.saturating_add(TOLERANCE)
            && rect.right >= area.right.saturating_sub(TOLERANCE)
            && rect.bottom >= area.bottom.saturating_sub(TOLERANCE)
    }

    pub fn media_polling_allowed(app_window: isize) -> bool {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground == 0 || foreground == app_window {
            return true;
        }
        if unsafe { IsWindowVisible(foreground) } == 0 || unsafe { IsIconic(foreground) } != 0 {
            return true;
        }
        let Some((app_monitor, _)) = monitor_info(app_window) else {
            return true;
        };
        let Some((foreground_monitor, foreground_info)) = monitor_info(foreground) else {
            return true;
        };
        if app_monitor != foreground_monitor {
            return true;
        }
        let mut foreground_rect = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(foreground, &mut foreground_rect) } == 0 {
            return true;
        }
        !covers(&foreground_rect, &foreground_info.monitor)
            && !covers(&foreground_rect, &foreground_info.work)
    }
}

#[tauri::command]
fn should_poll_media(window: tauri::WebviewWindow) -> bool {
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        window
            .hwnd()
            .map(|handle| windows_work_area::media_polling_allowed(handle.0 as isize))
            .unwrap_or(true)
    }
    #[cfg(not(target_os = "windows"))]
    true
}

fn clamp_window_state(mut state: SavedWindowState) -> SavedWindowState {
    #[cfg(target_os = "windows")]
    if let Some((left, top, right, bottom)) =
        windows_work_area::nearest(state.x, state.y, state.width, state.height)
    {
        let work_width = right.saturating_sub(left).max(1) as u32;
        let work_height = bottom.saturating_sub(top).max(1) as u32;
        state.width = state.width.min(work_width);
        state.height = state.height.min(work_height);
        state.x = state
            .x
            .clamp(left, right.saturating_sub(state.width as i32));
        state.y = state
            .y
            .clamp(top, bottom.saturating_sub(state.height as i32));
    }
    state
}

/// Ilk acilista pencereyi birincil ekranin calisma alaninin sag kenarina,
/// tam yukseklikte yaslar (Windows Notes benzeri yan panel).
fn default_dock_state(
    scale_factor: f64,
    taskbar: bool,
    expanded: bool,
    origin: (i32, i32),
    size_factor: f64,
) -> Option<SavedWindowState> {
    #[cfg(target_os = "windows")]
    {
        let (left, top, right, bottom) = windows_work_area::nearest(origin.0, origin.1, 1, 1)?;
        if taskbar {
            // Serit gorev cubugunun bos alanina oturur: sag kenar bildirim alaninin
            // hemen solu, alt kenar ekranin alt kenari. Acilinca ayni kenardan yukari buyur.
            let geometry = windows_work_area::taskbar_geometry(origin.0, origin.1)?;
            let (monitor_left, monitor_top, monitor_right, monitor_bottom) = geometry.monitor;
            let measured = monitor_bottom - geometry.work_bottom;
            let bar_height = if measured >= 24 { measured } else { (48.0 * scale_factor).round() as i32 };
            let wanted_width = (if expanded { (560.0 * size_factor).max(400.0) } else { 400.0 }) * scale_factor;
            let width = (wanted_width.round() as i32).min(monitor_right - monitor_left).max(1);
            let panel = if expanded { (620.0 * size_factor * scale_factor).round() as i32 } else { 0 };
            let height = (bar_height + panel).min(monitor_bottom - monitor_top).max(1);
            let right_edge = geometry
                .tray_left
                .unwrap_or(monitor_right - (280.0 * scale_factor).round() as i32)
                - (8.0 * scale_factor).round() as i32;
            return Some(SavedWindowState {
                x: (right_edge - width).max(monitor_left),
                y: monitor_bottom - height,
                width: width as u32,
                height: height as u32,
            });
        }
        let width = ((700.0 * size_factor * scale_factor).round() as i32).min(right - left).max(1);
        return Some(SavedWindowState {
            x: right - width,
            y: top,
            width: width as u32,
            height: bottom.saturating_sub(top).max(1) as u32,
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (scale_factor, taskbar, expanded, origin, size_factor);
        None
    }
}

fn read_window_state(path: &Path) -> Option<SavedWindowState> {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
}

fn current_window_state(window: &tauri::WebviewWindow) -> Option<SavedWindowState> {
    if window.is_minimized().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return None;
    }

    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        Some(SavedWindowState {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    } else {
        None
    }
}

fn write_window_state(state: SavedWindowState, state_path: &Path) {
    if let Some(parent) = state_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(
        state_path,
        serde_json::to_string_pretty(&state).unwrap_or_default(),
    );
}

fn save_window_state(window: &tauri::WebviewWindow, state_path: &Path) {
    if let Some(state) = current_window_state(window) {
        write_window_state(state, state_path);
    }
}

#[tauri::command]
fn open_shortcut_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > 32_768 {
        return Err("Geçersiz kısayol yolu".to_string());
    }

    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("Kısayol hedefi bulunamadı".to_string());
    }

    app.opener()
        .open_path(target.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_shortcut_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = validate_shortcut_url(&url)?;

    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn validate_shortcut_url(url: &str) -> Result<tauri::Url, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 2_048 {
        return Err("Geçersiz kısayol adresi".to_string());
    }

    let parsed = tauri::Url::parse(trimmed).map_err(|_| "Geçersiz kısayol adresi".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Yalnızca HTTP ve HTTPS adresleri açılabilir".to_string());
    }

    Ok(parsed)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaSessionSnapshot {
    supported: bool,
    has_session: bool,
    title: String,
    artist: String,
    playing: bool,
    can_previous: bool,
    can_toggle: bool,
    can_next: bool,
}

impl MediaSessionSnapshot {
    fn empty(supported: bool) -> Self {
        Self {
            supported,
            has_session: false,
            title: String::new(),
            artist: String::new(),
            playing: false,
            can_previous: false,
            can_toggle: false,
            can_next: false,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum MediaAction {
    Previous,
    Toggle,
    Next,
}

#[cfg(target_os = "windows")]
async fn await_media_operation<T>(
    operation: windows_future::IAsyncOperation<T>,
    operation_name: &'static str,
) -> Result<T, String>
where
    T: windows::core::RuntimeType,
{
    use windows::core::Interface;
    use windows_future::IAsyncInfo;

    let cancellation_handle = operation.clone();
    match tokio::time::timeout(MEDIA_ASYNC_TIMEOUT, operation).await {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => {
            if let Ok(info) = cancellation_handle.cast::<IAsyncInfo>() {
                let _ = info.Cancel();
            }
            Err(format!("{operation_name} timed out after 3 seconds"))
        }
    }
}

#[cfg(target_os = "windows")]
async fn current_media_session(
) -> Result<Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession>, String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    let operation = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|error| error.to_string())?;
    let manager = await_media_operation(operation, "media session request").await?;
    Ok(manager.GetCurrentSession().ok())
}

async fn query_media_session() -> Result<MediaSessionSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

        let Some(session) = current_media_session().await? else {
            return Ok(MediaSessionSnapshot::empty(true));
        };
        let properties = match session.TryGetMediaPropertiesAsync() {
            Ok(operation) => await_media_operation(operation, "media properties request")
                .await
                .ok(),
            Err(_) => None,
        };
        let playback = session.GetPlaybackInfo().ok();
        let controls = playback.as_ref().and_then(|value| value.Controls().ok());
        let title = properties
            .as_ref()
            .and_then(|value| value.Title().ok())
            .map(|value| value.to_string())
            .unwrap_or_default();
        let artist = properties
            .as_ref()
            .and_then(|value| value.Artist().ok())
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                properties
                    .as_ref()
                    .and_then(|value| value.AlbumArtist().ok())
                    .map(|value| value.to_string())
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                properties
                    .as_ref()
                    .and_then(|value| value.Subtitle().ok())
                    .map(|value| value.to_string())
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or_default();

        Ok(MediaSessionSnapshot {
            supported: true,
            has_session: true,
            title,
            artist,
            playing: playback
                .as_ref()
                .and_then(|value| value.PlaybackStatus().ok())
                == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing),
            can_previous: controls
                .as_ref()
                .and_then(|value| value.IsPreviousEnabled().ok())
                .unwrap_or(false),
            can_toggle: controls
                .as_ref()
                .and_then(|value| value.IsPlayEnabled().ok())
                .unwrap_or(false)
                || controls
                    .as_ref()
                    .and_then(|value| value.IsPauseEnabled().ok())
                    .unwrap_or(false),
            can_next: controls
                .as_ref()
                .and_then(|value| value.IsNextEnabled().ok())
                .unwrap_or(false),
        })
    }

    #[cfg(not(target_os = "windows"))]
    Ok(MediaSessionSnapshot::empty(false))
}

#[tauri::command]
async fn get_media_session(
    diagnostics: State<'_, Arc<DiagnosticsState>>,
) -> Result<MediaSessionSnapshot, String> {
    let diagnostics = Arc::clone(diagnostics.inner());
    diagnostics.begin_media_operation("query");
    let result = on_mta_thread(query_media_session()).await;
    diagnostics.finish_media_operation();
    if let Err(error) = &result {
        diagnostics.record_media_failure("MEDIA_QUERY_FAILED", error);
    }
    result
}

/// WinRT medya cagrilari ayri, MTA baslatilmis bir is parcaciginda calisir: tamamlanma geri cagrilari
/// uygulamanin STA/ileti dongusu olan is parcaciklarina baglanmaz ve zaman asimina dusmez.
async fn on_mta_thread<T, F>(future: F) -> T
where
    T: Send + 'static,
    F: std::future::Future<Output = T> + Send + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let _ = sender.send(tauri::async_runtime::block_on(future));
    });
    tauri::async_runtime::spawn_blocking(move || receiver.recv().expect("medya is parcacigi"))
        .await
        .expect("medya bekleme")
}

async fn run_media_control(action: MediaAction) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(session) = current_media_session().await? else {
            return Ok(false);
        };
        let operation = match action {
            MediaAction::Previous => session.TrySkipPreviousAsync(),
            MediaAction::Toggle => session.TryTogglePlayPauseAsync(),
            MediaAction::Next => session.TrySkipNextAsync(),
        }
        .map_err(|error| error.to_string())?;
        await_media_operation(operation, "media control request").await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Ok(false)
    }
}

#[tauri::command]
async fn control_media(
    action: MediaAction,
    diagnostics: State<'_, Arc<DiagnosticsState>>,
) -> Result<bool, String> {
    let diagnostics = Arc::clone(diagnostics.inner());
    diagnostics.begin_media_operation("control");
    let result = on_mta_thread(run_media_control(action)).await;
    diagnostics.finish_media_operation();
    if let Err(error) = &result {
        diagnostics.record_media_failure("MEDIA_CONTROL_FAILED", error);
    }
    result
}

#[tauri::command]
fn record_diagnostic_event(
    kind: String,
    diagnostics: State<'_, Arc<DiagnosticsState>>,
) -> Result<(), String> {
    let event = match kind.as_str() {
        "frontend-error" => "FRONTEND_ERROR",
        "unhandled-rejection" => "FRONTEND_UNHANDLED_REJECTION",
        _ => return Err("Unsupported diagnostic event".to_string()),
    };
    diagnostics.record(
        event,
        "Renderer reported an unhandled fault; content omitted for privacy",
    );
    Ok(())
}

#[tauri::command]
fn renderer_heartbeat(diagnostics: State<'_, Arc<DiagnosticsState>>) {
    diagnostics.renderer_heartbeat();
}

#[tauri::command]
fn get_shortcut_icon(path: String) -> Result<Option<String>, String> {
    if path.trim().is_empty() || path.len() > 32_768 {
        return Err("Geçersiz kısayol yolu".to_string());
    }

    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("Kısayol hedefi bulunamadı".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use wintheon::file::{FileIcon, IconSize};

        let png = FileIcon::new(target)
            .extract_icon_as_png_at(IconSize::Large)
            .ok_or_else(|| "Windows Shell ikonu alınamadı".to_string())?;
        if png.len() > 1_048_576 {
            return Err("Windows Shell ikonu beklenenden büyük".to_string());
        }

        Ok(Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png)
        )))
    }

    #[cfg(not(target_os = "windows"))]
    Ok(None)
}

#[tauri::command]
fn prepare_main_window(
    window: tauri::WebviewWindow,
    decorations: bool,
    taskbar: bool,
    expanded: bool,
    monitor: usize,
    size: String,
    state: State<'_, WindowStateStore>,
) -> Result<(), String> {
    window
        .set_decorations(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_shadow(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;

    let first_preparation = !state.ready.load(Ordering::Acquire);
    // Secilen ekranin sol-ust koseyi bul; bulunamazsa birincil ekrana dus.
    let monitors = window.available_monitors().unwrap_or_default();
    let target = monitors.get(monitor).or_else(|| monitors.first());
    let origin = target.map(|m| (m.position().x, m.position().y)).unwrap_or((0, 0));
    let scale = target.map(|m| m.scale_factor()).unwrap_or(1.0);
    let size_factor = match size.as_str() {
        "small" => 0.8,
        "large" => 1.25,
        _ => 1.0,
    };
    let dock_state = default_dock_state(scale, taskbar, expanded, origin, size_factor);
    let docked = dock_state.is_some();
    let bounds = if let Some(dock) = dock_state {
        Some(dock)
    } else if first_preparation {
        state.initial
    } else if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        Some(SavedWindowState {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        })
    } else {
        None
    };

    let bounds = if docked { bounds } else { bounds.map(clamp_window_state) };
    TASKBAR_MODE.store(taskbar, Ordering::Release);
    if let Some(bounds) = bounds {
        window
            .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| error.to_string())?;
    }

    let _ = window.set_always_on_top(taskbar);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    if !taskbar {
        let _ = window.set_focus();
    }

    state.ready.store(true, Ordering::Release);
    save_window_state(&window, &state.path);
    Ok(())
}

#[cfg(target_os = "windows")]
mod screen_capture {
    #[repr(C)]
    struct BitmapInfoHeader {
        size: u32,
        width: i32,
        height: i32,
        planes: u16,
        bit_count: u16,
        compression: u32,
        size_image: u32,
        x_pels_per_meter: i32,
        y_pels_per_meter: i32,
        colors_used: u32,
        colors_important: u32,
    }

    #[repr(C)]
    struct BitmapInfo {
        header: BitmapInfoHeader,
        colors: [u32; 1],
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetDC(window: isize) -> isize;
        fn ReleaseDC(window: isize, dc: isize) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn CreateCompatibleBitmap(dc: isize, width: i32, height: i32) -> isize;
        fn SelectObject(dc: isize, object: isize) -> isize;
        fn BitBlt(dst: isize, x: i32, y: i32, w: i32, h: i32, src: isize, sx: i32, sy: i32, rop: u32) -> i32;
        fn GetDIBits(dc: isize, bitmap: isize, start: u32, lines: u32, bits: *mut u8, info: *mut BitmapInfo, usage: u32) -> i32;
        fn DeleteObject(object: isize) -> i32;
        fn DeleteDC(dc: isize) -> i32;
    }

    /// Ekranin (x, y, w, h) dikdortgenini RGBA bayt olarak alir (fiziksel piksel).
    pub fn capture(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
        const SRCCOPY: u32 = 0x00CC_0020;
        const CAPTUREBLT: u32 = 0x4000_0000;
        if width <= 0 || height <= 0 || width > 16_384 || height > 16_384 {
            return Err("Geçersiz ekran boyutu".to_string());
        }
        unsafe {
            let screen = GetDC(0);
            if screen == 0 {
                return Err("Ekran bağlamı alınamadı".to_string());
            }
            let memory = CreateCompatibleDC(screen);
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            let mut result = Err("Ekran kopyalanamadı".to_string());
            if memory != 0 && bitmap != 0 {
                let previous = SelectObject(memory, bitmap);
                if BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY | CAPTUREBLT) != 0 {
                    let mut info = BitmapInfo {
                        header: BitmapInfoHeader {
                            size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                            width,
                            height: -height,
                            planes: 1,
                            bit_count: 32,
                            compression: 0,
                            size_image: 0,
                            x_pels_per_meter: 0,
                            y_pels_per_meter: 0,
                            colors_used: 0,
                            colors_important: 0,
                        },
                        colors: [0],
                    };
                    let mut pixels = vec![0u8; width as usize * height as usize * 4];
                    let lines = GetDIBits(memory, bitmap, 0, height as u32, pixels.as_mut_ptr(), &mut info, 0);
                    if lines != 0 {
                        // GDI BGRA verir; PNG icin RGBA'ya cevir, alfa tam opak.
                        for pixel in pixels.chunks_exact_mut(4) {
                            pixel.swap(0, 2);
                            pixel[3] = 255;
                        }
                        result = Ok(pixels);
                    }
                }
                SelectObject(memory, previous);
            }
            if bitmap != 0 {
                DeleteObject(bitmap);
            }
            if memory != 0 {
                DeleteDC(memory);
            }
            ReleaseDC(0, screen);
            result
        }
    }
}

/// Acilan gadget penceresinin son konumu: (ekran, sag kenar, alt kenar).
static PANEL_ANCHOR: std::sync::Mutex<Option<(usize, i32, i32)>> = std::sync::Mutex::new(None);
static PANEL_MONITOR: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn size_factor_of(size: &str) -> f64 {
    match size {
        "small" => 0.8,
        "large" => 1.25,
        _ => 1.0,
    }
}

/// Panel penceresi ilk acilista olusturulur (gizli bir WebView surekli bellek tutmasin).
static PANEL_PENDING_TAB: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn ensure_panel(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    use tauri::Emitter;
    if let Some(panel) = app.get_webview_window("panel") {
        return Ok(panel);
    }
    let url = tauri::WebviewUrl::App("index.html?view=panel".into());
    let panel = tauri::WebviewWindowBuilder::new(app, "panel", url)
        .title("theHUB Panel")
        .inner_size(560.0, 620.0)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    let panel_handle = app.clone();
    let panel_window = panel.clone();
    panel.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = panel_window.hide();
            let _ = panel_handle.emit("dock-closed", ());
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            // Kullanicinin tasidigi konum: sag/alt kenar sabitlenir.
            if panel_window.is_visible().unwrap_or(false) {
                if let (Ok(position), Ok(size)) = (panel_window.outer_position(), panel_window.outer_size()) {
                    if let Ok(mut anchor) = PANEL_ANCHOR.lock() {
                        *anchor = Some((
                            PANEL_MONITOR.load(Ordering::Acquire),
                            position.x + size.width as i32,
                            position.y + size.height as i32,
                        ));
                    }
                }
            }
        }
        _ => {}
    });
    Ok(panel)
}

/// Panel sayfasi yuklenince bekleyen sekmeyi yeniden gonderir (olay sayfa hazir olmadan kaybolabilir).
#[tauri::command]
fn panel_ready(app: tauri::AppHandle) {
    use tauri::Emitter;
    let tab = PANEL_PENDING_TAB.lock().ok().and_then(|g| g.clone());
    if let Some(tab) = tab {
        let _ = app.emit_to("panel", "dock-tab", tab);
    }
}

/// Seritten acilan gadget penceresini seridin hemen ustunde gosterir.
#[tauri::command]
async fn open_panel(app: tauri::AppHandle, tab: String, monitor: usize, size: String) -> Result<(), String> {
    use tauri::Emitter;
    let panel = ensure_panel(&app)?;
    let main = app.get_webview_window("main").ok_or("ana pencere yok")?;
    if !panel.is_visible().unwrap_or(false) {
        let monitors = main.available_monitors().unwrap_or_default();
        let target = monitors.get(monitor).or_else(|| monitors.first());
        let origin = target.map(|m| (m.position().x, m.position().y)).unwrap_or((0, 0));
        let scale = target.map(|m| m.scale_factor()).unwrap_or(1.0);
        let factor = size_factor_of(size.as_str());
        #[cfg(target_os = "windows")]
        let work = windows_work_area::nearest(origin.0, origin.1, 1, 1).unwrap_or((0, 0, 1920, 1040));
        #[cfg(not(target_os = "windows"))]
        let work = (0, 0, 1920, 1040);
        let max_width = (work.2 - work.0).max(1);
        let max_height = (work.3 - work.1).max(1);
        let width = (((560.0 * factor).max(420.0) * scale).round() as i32).min(max_width);
        let height = ((620.0 * factor * scale).round() as i32).min(max_height);
        let strip_window = app.get_webview_window(&format!("strip{monitor}")).unwrap_or_else(|| main.clone());
        let strip = (strip_window.outer_position().ok(), strip_window.outer_size().ok());
        let gap = (6.0 * scale).round() as i32;
        let saved = PANEL_ANCHOR
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .filter(|(saved_monitor, right, bottom)| {
                *saved_monitor == monitor
                    && *right > work.0
                    && *right <= work.2 + width
                    && *bottom > work.1
                    && *bottom <= work.3 + (200.0 * scale) as i32
            });
        let (right, bottom) = if let Some((_, right, bottom)) = saved {
            (right, bottom)
        } else if let (Some(position), Some(strip_size)) = strip {
            (position.x + strip_size.width as i32, position.y - gap)
        } else {
            (work.2, work.3 - gap)
        };
        let x = (right - width).max(work.0);
        let y = (bottom - height).max(work.1);
        PANEL_MONITOR.store(monitor, Ordering::Release);
        panel.set_size(tauri::PhysicalSize::new(width as u32, height as u32)).map_err(|e| e.to_string())?;
        panel.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        let _ = panel.set_always_on_top(true);
        panel.show().map_err(|e| e.to_string())?;
    }
    let _ = panel.unminimize();
    let _ = panel.set_focus();
    if let Ok(mut pending) = PANEL_PENDING_TAB.lock() {
        *pending = Some(tab.clone());
    }
    app.emit_to("panel", "dock-tab", tab).map_err(|e| e.to_string())
}

/// Surukleme baslangic konumu (fiziksel piksel); pencere minimize ise geri getirilir.
static PANEL_DRAG_ORIGIN: std::sync::Mutex<Option<(i32, i32)>> = std::sync::Mutex::new(None);

#[tauri::command]
fn begin_panel_drag(app: tauri::AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.unminimize();
        if let (Ok(position), Ok(mut origin)) = (panel.outer_position(), PANEL_DRAG_ORIGIN.lock()) {
            *origin = Some((position.x, position.y));
        }
    }
}

/// Baslangictan itibaren (dx, dy) fiziksel piksel kaydirir.
#[tauri::command]
fn drag_panel(app: tauri::AppHandle, dx: f64, dy: f64) {
    if !dx.is_finite() || !dy.is_finite() {
        return;
    }
    let origin = PANEL_DRAG_ORIGIN.lock().ok().and_then(|guard| *guard);
    if let (Some(panel), Some((x, y))) = (app.get_webview_window("panel"), origin) {
        let _ = panel.set_position(tauri::PhysicalPosition::new(x + dx.round() as i32, y + dy.round() as i32));
    }
}

#[tauri::command]
fn monitor_count(window: tauri::WebviewWindow) -> usize {
    window.available_monitors().map(|m| m.len()).unwrap_or(1).max(1)
}

/// Gorev cubugu modunda ana serit disindaki her ekranin gorev cubuguna da bir serit koyar.
/// `enabled` false ise ya da ekran ana seridin ekraniysa o ekranin seridi kapatilir.
#[tauri::command]
async fn sync_strips(app: tauri::AppHandle, enabled: bool, main_monitor: usize) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("ana pencere yok")?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    for index in 0..monitors.len().max(1) {
        let label = format!("strip{index}");
        let wanted = enabled && index != main_monitor && index < monitors.len();
        let existing = app.get_webview_window(&label);
        if !wanted {
            if let Some(window) = existing {
                let _ = window.destroy();
            }
            continue;
        }
        let monitor = &monitors[index];
        let origin = (monitor.position().x, monitor.position().y);
        let Some(bounds) = default_dock_state(monitor.scale_factor(), true, false, origin, 1.0) else { continue };
        let window = match existing {
            Some(window) => window,
            None => {
                let url = tauri::WebviewUrl::App(format!("index.html?view=strip&monitor={index}").into());
                let window = tauri::WebviewWindowBuilder::new(&app, &label, url)
                    .title("theHUB")
                    .decorations(false)
                    .resizable(false)
                    .shadow(false)
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .build()
                    .map_err(|e| e.to_string())?;
                // Gorev cubugu modunda serit kapanmaz.
                window.on_window_event(|event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                });
                window
            }
        };
        let _ = window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
        let _ = window.set_always_on_top(true);
        let _ = window.show();
    }
    Ok(())
}

#[tauri::command]
fn hide_joystick(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    joystick::hide_overlay(&app);
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

/// Dosyalari arka planda cevirir; sonucu Windows bildirimi olarak gosterir.
#[cfg(target_os = "windows")]
pub(crate) fn convert_in_background(app: tauri::AppHandle, paths: Vec<String>, target: String, dest_dir: Option<PathBuf>, place_at: Option<(i32, i32)>) {
    use tauri_plugin_notification::NotificationExt;
    thread::spawn(move || {
        let mut done = Vec::new();
        let mut failed = Vec::new();
        for path in &paths {
            let started = Instant::now();
            let result = convert::convert(path, &target, dest_dir.as_deref());
            joystick::log(&format!("donusturme {} ms: {path} -> {target}", started.elapsed().as_millis()));
            match result {
                Ok(output) => {
                    if let Some((x, y)) = place_at {
                        let offset = (done.len() as i32) * 90;
                        joystick::place_on_desktop(Path::new(&output), (x + offset, y));
                    }
                    done.push(output);
                }
                Err(error) => failed.push(error),
            }
        }
        joystick::log(&format!("cevirme sonucu: tamam={done:?} hata={failed:?}"));
        let name = |p: &String| Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let body = if let Some(error) = failed.first() {
            format!("{} dosya cevrilemedi: {}", failed.len(), error)
        } else if done.len() == 1 {
            format!("Hazir: {}", name(&done[0]))
        } else {
            format!("{} dosya .{} olarak hazir", done.len(), target)
        };
        let _ = app.notification().builder().title("theHUB").body(body).show();
    });
}

#[tauri::command]
fn close_panel(app: tauri::AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.hide();
    }
}

/// Gadget penceresini icerik yuksekligine sigdirir; alt kenar (seride bitisik) sabit kalir.
#[tauri::command]
fn fit_panel(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let Some(panel) = app.get_webview_window("panel") else {
        return Ok(());
    };
    if !panel.is_visible().unwrap_or(false) || !height.is_finite() || height <= 0.0 {
        return Ok(());
    }
    let scale = panel.scale_factor().unwrap_or(1.0);
    let (Ok(position), Ok(size)) = (panel.outer_position(), panel.outer_size()) else {
        return Ok(());
    };
    let monitor = panel.current_monitor().ok().flatten();
    let max_height = monitor.map(|m| m.size().height as i32).unwrap_or(1080);
    let wanted = ((height * scale).round() as i32).clamp((120.0 * scale) as i32, max_height);
    if (wanted - size.height as i32).abs() < 2 {
        return Ok(());
    }
    let bottom = position.y + size.height as i32;
    panel.set_size(tauri::PhysicalSize::new(size.width, wanted as u32)).map_err(|e| e.to_string())?;
    panel.set_position(tauri::PhysicalPosition::new(position.x, bottom - wanted)).map_err(|e| e.to_string())
}

/// Secilen ekrani PNG (data URL) olarak yakalar; gadget penceresi gorunmesin diye gizlenir.
#[tauri::command]
async fn capture_screen(app: tauri::AppHandle, monitor: usize) -> Result<String, String> {
    let main = app.get_webview_window("main").ok_or("ana pencere yok")?;
    let panel = app.get_webview_window("panel");
    let panel_was_visible = panel.as_ref().map(|p| p.is_visible().unwrap_or(false)).unwrap_or(false);
    if panel_was_visible {
        if let Some(panel) = &panel {
            let _ = panel.hide();
        }
        thread::sleep(Duration::from_millis(350));
    }
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    let target = monitors.get(monitor).or_else(|| monitors.first()).ok_or("ekran bulunamadı")?;
    let (x, y) = (target.position().x, target.position().y);
    let (width, height) = (target.size().width, target.size().height);

    #[cfg(target_os = "windows")]
    let pixels = screen_capture::capture(x, y, width as i32, height as i32);
    #[cfg(not(target_os = "windows"))]
    let pixels: Result<Vec<u8>, String> = Err("Ekran görüntüsü yalnız Windows'ta desteklenir".to_string());

    if panel_was_visible {
        if let Some(panel) = &panel {
            let _ = panel.show();
        }
    }

    let pixels = pixels?;
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&pixels).map_err(|e| e.to_string())?;
    }
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png_bytes)))
}

/// Ekran goruntusunu Resimler\theHUB klasorune yazar; ayni dosya adi uzerine yazilir.
#[tauri::command]
fn save_screenshot(app: tauri::AppHandle, filename: String, data: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let valid_name = !filename.is_empty()
        && filename.len() <= 80
        && filename.ends_with(".png")
        && filename
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !filename.contains("..");
    if !valid_name {
        return Err("Geçersiz dosya adı".to_string());
    }
    if data.len() > 80_000_000 {
        return Err("Görüntü çok büyük".to_string());
    }
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    if bytes.len() < 8 || bytes[..8] != [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return Err("PNG değil".to_string());
    }
    let folder = app
        .path()
        .picture_dir()
        .map_err(|e| e.to_string())?
        .join("theHUB");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let target = folder.join(&filename);
    let temporary = folder.join(format!("{filename}.tmp"));
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &target).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        e.to_string()
    })?;
    Ok(target.to_string_lossy().into_owned())
}

fn main() {
    let app = tauri::Builder::default()
        // Ikinci kopya acilmasin; var olan pencere one gelsin.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && is_show_window_shortcut(shortcut)
                    {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_tray_language,
            backup_quick_note,
            read_quick_note_backup,
            prepare_main_window,
            monitor_count,
            open_panel,
            panel_ready,
            joystick::joystick_ready,
            close_panel,
            hide_joystick,
            sync_strips,
            begin_panel_drag,
            drag_panel,
            fit_panel,
            capture_screen,
            save_screenshot,
            open_shortcut_path,
            open_shortcut_url,
            get_shortcut_icon,
            write_note_export,
            should_poll_media,
            get_media_session,
            control_media,
            record_diagnostic_event,
            renderer_heartbeat
        ])
        .setup(|app| {
            let diagnostics = DiagnosticsState::initialize(app.handle()).unwrap_or_else(|error| {
                eprintln!("Tanılama günlüğü başlatılamadı; uygulama devam ediyor: {error}");
                DiagnosticsState::disabled()
            });
            install_panic_diagnostics(Arc::clone(&diagnostics));
            let diagnostics_watch = Arc::downgrade(&diagnostics);
            let diagnostics_window = app.get_webview_window("main").expect("main window");
            thread::spawn(move || {
                let mut last_watchdog_tick = Instant::now();
                loop {
                    thread::sleep(Duration::from_secs(1));
                    let now = Instant::now();
                    let watchdog_was_suspended =
                        now.duration_since(last_watchdog_tick) > Duration::from_secs(5);
                    last_watchdog_tick = now;
                    let Some(diagnostics) = diagnostics_watch.upgrade() else {
                        return;
                    };
                    if diagnostics.clean_exit.load(Ordering::Acquire) {
                        return;
                    }
                    diagnostics.check_media_stall();
                    let window_is_active = diagnostics_window.is_visible().unwrap_or(false)
                        && !diagnostics_window.is_minimized().unwrap_or(false)
                        && diagnostics_window.is_focused().unwrap_or(false);
                    diagnostics.check_renderer_stall(window_is_active, watchdog_was_suspended);
                }
            });
            app.manage(diagnostics);

            let window = app.get_webview_window("main").expect("main window");
            if let Err(error) = app.global_shortcut().register(show_window_shortcut()) {
                eprintln!("Ctrl+F12 global kısayolu kaydedilemedi: {error}");
            }
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
                    "quit" => {
                        let state = app.state::<WindowStateStore>();
                        if state.ready.load(Ordering::Acquire) {
                            if let Some(window) = app.get_webview_window("main") {
                                save_window_state(&window, &state.path);
                            }
                        }
                        app.exit(0);
                    }
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
            let initial_state = read_window_state(&state_path);
            let persistence_ready = Arc::new(AtomicBool::new(false));
            app.manage(WindowStateStore {
                path: state_path.clone(),
                initial: initial_state,
                ready: persistence_ready.clone(),
            });

            let (state_sender, state_receiver) = mpsc::channel::<SavedWindowState>();
            let debounced_state_path = state_path.clone();
            thread::spawn(move || {
                while let Ok(mut latest) = state_receiver.recv() {
                    loop {
                        match state_receiver.recv_timeout(Duration::from_millis(400)) {
                            Ok(next) => latest = next,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                write_window_state(latest, &debounced_state_path);
                                break;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                write_window_state(latest, &debounced_state_path);
                                return;
                            }
                        }
                    }
                }
            });

            // Gorev cubugu modunda serit, gorev cubugu one gelse de ustte kalir.
            #[cfg(target_os = "windows")]
            {
                let raise_app = app.handle().clone();
                thread::spawn(move || loop {
                    thread::sleep(Duration::from_millis(250));
                    if !taskbar_mode() {
                        continue;
                    }
                    for (label, strip) in raise_app.webview_windows() {
                        if (label == "main" || label.starts_with("strip")) && strip.is_visible().unwrap_or(false) {
                            if let Ok(handle) = strip.hwnd() {
                                windows_work_area::raise_topmost(handle.0 as isize);
                            }
                        }
                    }
                });
            }

            #[cfg(target_os = "windows")]
            joystick::start(app.handle().clone());

            let window_for_events = window.clone();
            let ready_for_events = persistence_ready.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if ready_for_events.load(Ordering::Acquire) {
                        if let Some(state) = current_window_state(&window_for_events) {
                            let _ = state_sender.send(state);
                        }
                    }
                    api.prevent_close();
                    if !taskbar_mode() {
                        let _ = window_for_events.hide();
                    }
                }
                WindowEvent::Resized(_) if window_for_events.is_minimized().unwrap_or(false) => {
                    if taskbar_mode() {
                        let _ = window_for_events.unminimize();
                    } else {
                        let _ = window_for_events.hide();
                    }
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_)
                    if ready_for_events.load(Ordering::Acquire) =>
                {
                    if let Some(state) = current_window_state(&window_for_events) {
                        let _ = state_sender.send(state);
                    }
                }
                _ => {}
            });

            // React normally prepares and shows the window after applying the
            // selected frame mode. Keep a fallback so a frontend error can
            // never leave a running tray application permanently invisible.
            let fallback_app = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(12));
                if !persistence_ready.load(Ordering::Acquire) {
                    show_main_window(&fallback_app);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(diagnostics) = app.try_state::<Arc<DiagnosticsState>>() {
                diagnostics.mark_clean_exit();
            }
        }
    });
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn windows_media_session_can_be_queried_without_a_player() {
        assert!(tauri::async_runtime::block_on(query_media_session()).is_ok());
    }

    #[test]
    fn ctrl_f12_is_the_window_toggle_shortcut() {
        let shortcut = show_window_shortcut();
        assert!(is_show_window_shortcut(&shortcut));
        assert!(!shortcut.matches(Modifiers::ALT, Code::F12));
    }

    #[test]
    fn focused_main_window_is_hidden_by_the_toggle_shortcut() {
        assert!(should_hide_main_window(true, false, true));
        assert!(!should_hide_main_window(false, false, false));
        assert!(!should_hide_main_window(true, true, true));
        assert!(!should_hide_main_window(true, false, false));
    }

    #[test]
    fn shortcut_urls_are_limited_to_safe_web_addresses() {
        assert!(validate_shortcut_url("https://example.com/path").is_ok());
        assert!(validate_shortcut_url("http://localhost:5173").is_ok());
        assert!(validate_shortcut_url("javascript:alert(1)").is_err());
        assert!(validate_shortcut_url("file:///C:/Windows/System32").is_err());
        assert!(validate_shortcut_url("https://user:password@example.com").is_err());
    }

    #[test]
    #[ignore]
    fn media_query_timing() {
        for _ in 0..5 {
            let started = Instant::now();
            let result = tauri::async_runtime::block_on(query_media_session());
            println!("medya sorgusu {} ms: {:?}", started.elapsed().as_millis(), result.map(|s| (s.has_session, s.title)));
        }
    }
}
