#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn hide_main_window(app: &tauri::AppHandle) {
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
    let result = query_media_session().await;
    diagnostics.finish_media_operation();
    if let Err(error) = &result {
        diagnostics.record_media_failure("MEDIA_QUERY_FAILED", error);
    }
    result
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
    let result = run_media_control(action).await;
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
    state: State<'_, WindowStateStore>,
) -> Result<(), String> {
    window
        .set_decorations(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_shadow(decorations)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())?;

    let first_preparation = !state.ready.load(Ordering::Acquire);
    let bounds = if first_preparation {
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

    if let Some(bounds) = bounds.map(clamp_window_state) {
        window
            .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| error.to_string())?;
    }

    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    state.ready.store(true, Ordering::Release);
    save_window_state(&window, &state.path);
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && is_show_window_shortcut(shortcut)
                    {
                        bring_main_window_to_front(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_tray_language,
            backup_quick_note,
            read_quick_note_backup,
            prepare_main_window,
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
                    let _ = window_for_events.hide();
                }
                WindowEvent::Resized(_) if window_for_events.is_minimized().unwrap_or(false) => {
                    let _ = window_for_events.hide();
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
                thread::sleep(std::time::Duration::from_secs(3));
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
    fn ctrl_f12_is_the_show_window_shortcut() {
        let shortcut = show_window_shortcut();
        assert!(is_show_window_shortcut(&shortcut));
        assert!(!shortcut.matches(Modifiers::ALT, Code::F12));
    }

    #[test]
    fn shortcut_urls_are_limited_to_safe_web_addresses() {
        assert!(validate_shortcut_url("https://example.com/path").is_ok());
        assert!(validate_shortcut_url("http://localhost:5173").is_ok());
        assert!(validate_shortcut_url("javascript:alert(1)").is_err());
        assert!(validate_shortcut_url("file:///C:/Windows/System32").is_err());
        assert!(validate_shortcut_url("https://user:password@example.com").is_err());
    }
}
