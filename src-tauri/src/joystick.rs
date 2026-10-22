//! Explorer'da dosya surukleyip Shift'e basinca fare imlecinin cevresinde joystick katmani acar.
//! Katman tam ekran seffaf bir penceredir; surukleme hedefi olarak dosya yolunu kendisi alir.

use std::{
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn GetAsyncKeyState(key: i32) -> i16;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn WindowFromPoint(point: Point) -> isize;
    fn GetAncestor(window: isize, flags: u32) -> isize;
    fn GetClassNameW(window: isize, buffer: *mut u16, max: i32) -> i32;
    fn FindWindowW(class: *const u16, title: *const u16) -> isize;
    fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
    fn GetWindowThreadProcessId(window: isize, process: *mut u32) -> u32;
    fn SendMessageW(window: isize, message: u32, wparam: usize, lparam: isize) -> isize;
    fn ScreenToClient(window: isize, point: *mut Point) -> i32;
    fn MonitorFromPoint(point: Point, flags: u32) -> isize;
    #[link_name = "GetMonitorInfoW"]
    fn GetMonitorInfoRaw(monitor: isize, info: *mut [i32; 10]) -> i32;
    fn GetClientRect(window: isize, rect: *mut [i32; 4]) -> i32;
    fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn VirtualAllocEx(process: isize, address: usize, size: usize, kind: u32, protect: u32) -> usize;
    fn VirtualFreeEx(process: isize, address: usize, size: usize, kind: u32) -> i32;
    fn WriteProcessMemory(process: isize, address: usize, buffer: *const u8, size: usize, written: *mut usize) -> i32;
    fn ReadProcessMemory(process: isize, address: usize, buffer: *mut u8, size: usize, read: *mut usize) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

#[repr(C)]
struct FindInfo {
    flags: u32,
    text: usize,
    param: isize,
    point: Point,
    direction: u32,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Masaustu simge listesi (SysListView32).
fn desktop_listview() -> Option<isize> {
    let progman = wide("Progman");
    let defview = wide("SHELLDLL_DefView");
    let listview = wide("SysListView32");
    let worker = wide("WorkerW");
    unsafe {
        let mut host = FindWindowW(progman.as_ptr(), std::ptr::null());
        let mut view = if host != 0 { FindWindowExW(host, 0, defview.as_ptr(), std::ptr::null()) } else { 0 };
        let mut after = 0;
        while view == 0 {
            host = FindWindowExW(0, after, worker.as_ptr(), std::ptr::null());
            if host == 0 {
                return None;
            }
            view = FindWindowExW(host, 0, defview.as_ptr(), std::ptr::null());
            after = host;
        }
        match FindWindowExW(view, 0, listview.as_ptr(), std::ptr::null()) {
            0 => None,
            lv => Some(lv),
        }
    }
}

/// Masaustundeki bir simgeyi bulur; `target` (masaustu liste koordinati) verilirse oraya tasir.
/// Simgenin o anki konumunu dondurur (Explorer kendi dizilimini uygulamis olabilir).
fn desktop_icon(names: &[String], target: Option<(i32, i32)>) -> Option<(i32, i32)> {
    const PROCESS_ACCESS: u32 = 0x0008 | 0x0010 | 0x0020; // VM_OPERATION | VM_READ | VM_WRITE
    const MEM_COMMIT_RESERVE: u32 = 0x3000;
    const MEM_RELEASE: u32 = 0x8000;
    const PAGE_READWRITE: u32 = 0x04;
    const LVM_GETITEMPOSITION: u32 = 0x1010;
    const LVM_SETITEMPOSITION: u32 = 0x100F;
    const LVM_FINDITEMW: u32 = 0x1053;
    const LVFI_STRING: u32 = 0x0002;
    let lv = desktop_listview()?;
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(lv, &mut pid) };
    let process = unsafe { OpenProcess(PROCESS_ACCESS, 0, pid) };
    if process == 0 {
        return None;
    }
    let mut result = None;
    let remote = unsafe { VirtualAllocEx(process, 0, 4096, MEM_COMMIT_RESERVE, PAGE_READWRITE) };
    if remote != 0 {
        for name in names {
            let text = wide(name);
            let text_bytes = unsafe { std::slice::from_raw_parts(text.as_ptr() as *const u8, text.len() * 2) };
            let text_at = remote + 256;
            let info = FindInfo { flags: LVFI_STRING, text: text_at, param: 0, point: Point { x: 0, y: 0 }, direction: 0 };
            let mut written = 0usize;
            unsafe {
                WriteProcessMemory(process, text_at, text_bytes.as_ptr(), text_bytes.len(), &mut written);
                WriteProcessMemory(process, remote, &info as *const FindInfo as *const u8, std::mem::size_of::<FindInfo>(), &mut written);
            }
            let index = unsafe { SendMessageW(lv, LVM_FINDITEMW, usize::MAX, remote as isize) };
            if index < 0 {
                continue;
            }
            if let Some((x, y)) = target {
                let (x, y) = (x.max(0) as u32, y.max(0) as u32);
                unsafe { SendMessageW(lv, LVM_SETITEMPOSITION, index as usize, ((y << 16) | (x & 0xFFFF)) as isize) };
            }
            // Konumu geri oku: Explorer yerlesimi ezmis olabilir.
            let position_at = remote + 128;
            unsafe { SendMessageW(lv, LVM_GETITEMPOSITION, index as usize, position_at as isize) };
            let mut bytes = [0u8; 8];
            let mut read = 0usize;
            if unsafe { ReadProcessMemory(process, position_at, bytes.as_mut_ptr(), 8, &mut read) } != 0 {
                result = Some((
                    i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
                    i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
                ));
            }
            break;
        }
        unsafe { VirtualFreeEx(process, remote, 0, MEM_RELEASE) };
    }
    unsafe { CloseHandle(process) };
    result
}

/// Masaustundeki simge dizisinin (sutun sutun, yukaridan asagi) bir sonraki bos hucresini bulur;
/// `names` ile eslesen yeni simge sayima katilmaz. Donen konum liste koordinatindadir.
fn next_desktop_slot(names: &[String], screen: (i32, i32)) -> Option<(i32, i32)> {
    const PROCESS_ACCESS: u32 = 0x0008 | 0x0010 | 0x0020;
    const LVM_GETITEMCOUNT: u32 = 0x1004;
    const LVM_GETITEMSPACING: u32 = 0x1033;
    const LVM_GETITEMPOSITION: u32 = 0x1010;
    const LVM_FINDITEMW: u32 = 0x1053;
    let lv = desktop_listview()?;
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(lv, &mut pid) };
    let process = unsafe { OpenProcess(PROCESS_ACCESS, 0, pid) };
    if process == 0 {
        return None;
    }
    let remote = unsafe { VirtualAllocEx(process, 0, 4096, 0x3000, 0x04) };
    let mut result = None;
    if remote != 0 {
        let packed = unsafe { SendMessageW(lv, LVM_GETITEMSPACING, 0, 0) } as u32;
        let (cx, cy) = ((packed & 0xFFFF) as i32, (packed >> 16) as i32);
        let mut rect = [0i32; 4];
        unsafe { GetClientRect(lv, &mut rect) };
        let height = rect[3];
        let count = unsafe { SendMessageW(lv, LVM_GETITEMCOUNT, 0, 0) } as usize;
        // Yeni dosyanin indeksi (sayimdan haric tutulur).
        let mut own = usize::MAX;
        for name in names {
            let text = wide(name);
            let bytes = unsafe { std::slice::from_raw_parts(text.as_ptr() as *const u8, text.len() * 2) };
            let info = FindInfo { flags: 0x0002, text: remote + 256, param: 0, point: Point { x: 0, y: 0 }, direction: 0 };
            let mut written = 0usize;
            unsafe {
                WriteProcessMemory(process, remote + 256, bytes.as_ptr(), bytes.len(), &mut written);
                WriteProcessMemory(process, remote, &info as *const FindInfo as *const u8, std::mem::size_of::<FindInfo>(), &mut written);
            }
            let index = unsafe { SendMessageW(lv, LVM_FINDITEMW, usize::MAX, remote as isize) };
            if index >= 0 {
                own = index as usize;
                break;
            }
        }
        // Birakilan noktanin monitoru (calisma alani) liste koordinatinda.
        let monitor = unsafe { MonitorFromPoint(Point { x: screen.0, y: screen.1 }, 2) };
        let mut info = [0i32; 10];
        info[0] = 40;
        let mut work = None;
        if monitor != 0 && unsafe { GetMonitorInfoRaw(monitor, &mut info) } != 0 {
            let mut a = Point { x: info[5], y: info[6] };
            let mut b = Point { x: info[7], y: info[8] };
            unsafe {
                ScreenToClient(lv, &mut a);
                ScreenToClient(lv, &mut b);
            }
            work = Some((a.x, a.y, b.x, b.y));
        }
        let _ = height;
        if let (true, Some((wx0, wy0, wx1, wy1))) = (cx > 0 && cy > 0, work) {
            let mut positions = Vec::new();
            for index in 0..count {
                if index == own {
                    continue;
                }
                unsafe { SendMessageW(lv, LVM_GETITEMPOSITION, index, (remote + 128) as isize) };
                let mut bytes = [0u8; 8];
                let mut read = 0usize;
                if unsafe { ReadProcessMemory(process, remote + 128, bytes.as_mut_ptr(), 8, &mut read) } == 0 {
                    continue;
                }
                let x = i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                let y = i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
                if x >= wx0 - cx / 2 && x < wx1 && y >= wy0 - cy / 2 && y < wy1 {
                    positions.push((x, y));
                }
            }
            // Izgara kaymasi (kenar boslugu) mevcut simgelerden ogrenilir.
            let (ox, oy) = positions.first().map_or((0, 0), |&(x, y)| ((x - wx0).rem_euclid(cx), (y - wy0).rem_euclid(cy)));
            let cell = |x: i32, y: i32| (((x - wx0 - ox) as f64 / cx as f64).round() as i32, ((y - wy0 - oy) as f64 / cy as f64).round() as i32);
            let taken: std::collections::HashSet<(i32, i32)> = positions.iter().map(|&(x, y)| cell(x, y)).collect();
            let rows = ((wy1 - wy0 - oy) / cy).max(1);
            let columns = ((wx1 - wx0 - ox) / cx).max(1) + 1;
            // Soldan saga, her sutunda yukaridan asagi ilk bos hucre.
            'search: for column in 0..columns {
                for row in 0..rows {
                    if !taken.contains(&(column, row)) {
                        result = Some((wx0 + ox + column * cx, wy0 + oy + row * cy));
                        break 'search;
                    }
                }
            }
        }
        unsafe { VirtualFreeEx(process, remote, 0, 0x8000) };
    }
    unsafe { CloseHandle(process) };
    result
}

/// Yeni olusan dosyanin simgesini masaustunde `screen` noktasina koyar ve yerinde kaldigini dogrular.
/// Explorer yeni ogeyi kendi bos yerine sonradan yerlestirebilir; konum geri okunur, uymuyorsa yeniden verilir.
pub fn place_on_desktop(path: &std::path::Path, screen: (i32, i32)) {
    let path = path.to_path_buf();
    thread::spawn(move || {
        let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let stem = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let names = vec![file, stem];
        let Some(list) = desktop_listview() else {
            log("masaustu listesi bulunamadi");
            return;
        };
        // Ekran noktasini liste koordinatina cevir; simge imlecin ortasinda dursun.
        let mut client = Point { x: screen.0, y: screen.1 };
        unsafe { ScreenToClient(list, &mut client) };
        let mut target = ((client.x - 40).max(0), (client.y - 40).max(0));
        // Simge, masaustundeki mevcut simge sirasinin hemen ardina gelir.
        if let Some(slot) = next_desktop_slot(&names, screen) {
            target = slot;
        }
        // Izgara hucresi kadar sapma kabul edilir (simgeler izgaraya oturur).
        let near = |p: (i32, i32)| (p.0 - target.0).abs() <= 40 && (p.1 - target.1).abs() <= 40;
        let mut last = None;
        for attempt in 0..16 {
            let current = desktop_icon(&names, Some(target));
            if let Some(position) = current {
                last = Some(position);
                // Ilk basarili atamadan sonra Explorer'in kendi yerlesimini uygulamasi icin bekle, sonra dogrula.
                thread::sleep(Duration::from_millis(350));
                if let Some(checked) = desktop_icon(&names, None) {
                    last = Some(checked);
                    if near(checked) {
                        log(&format!("simge yerlestirildi: hedef={target:?} konum={checked:?} deneme={}", attempt + 1));
                        return;
                    }
                }
            } else {
                thread::sleep(Duration::from_millis(250));
            }
        }
        log(&format!("simge hedefte kalmadi: hedef={target:?} son_konum={last:?}"));
    });
}

const VK_LBUTTON: i32 = 0x01;
const VK_SHIFT: i32 = 0x10;
const DRAG_THRESHOLD: i32 = 10;
/// Surukleme yalniz bu pencerelerden baslarsa katman acilir (Explorer ve masaustu).
const SOURCE_CLASSES: &[&str] = &["CabinetWClass", "ExploreWClass", "WorkerW", "Progman"];

/// Hata ayiklama: %TEMP%\thehub-joystick.log (milisaniye damgali olaylar).
pub fn log(message: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("thehub-joystick.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() % 1_000_000)
            .unwrap_or(0);
        let _ = writeln!(file, "[{millis:06}] {message}");
    }
}

fn is_down(key: i32) -> bool {
    (unsafe { GetAsyncKeyState(key) } as u16) & 0x8000 != 0
}

fn cursor() -> Option<Point> {
    let mut p = Point { x: 0, y: 0 };
    (unsafe { GetCursorPos(&mut p) } != 0).then_some(p)
}

fn root_class_at(p: Point) -> String {
    let window = unsafe { WindowFromPoint(p) };
    if window == 0 {
        return String::new();
    }
    let root = match unsafe { GetAncestor(window, 2) } {
        0 => window,
        r => r,
    };
    let mut buffer = [0u16; 64];
    let len = unsafe { GetClassNameW(root, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..len.max(0) as usize])
}

const SELECTION_SCRIPT: &str = include_str!("selection.ps1");
const DEAD_ZONE: f64 = 34.0;

#[derive(Clone, serde::Serialize)]
struct Slots {
    up: Option<&'static str>,
    right: Option<&'static str>,
    down: Option<&'static str>,
    left: Option<&'static str>,
}

fn slots_of(paths: &[String]) -> Slots {
    let [up, right, down, left] = crate::convert::slots_for(paths);
    Slots { up, right, down, left }
}

#[derive(Clone, serde::Serialize)]
struct OpenPayload {
    x: i32,
    y: i32,
    slots: Slots,
}

/// Seçim betiğini çalıştırır; çıktı satırlarını döndürür.
struct SelectionWorker {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    replies: std::sync::mpsc::Receiver<String>,
    last_use: std::time::Instant,
}

static SELECTION_WORKER: std::sync::Mutex<Option<SelectionWorker>> = std::sync::Mutex::new(None);

fn spawn_selection_worker() -> Option<SelectionWorker> {
    use std::io::{BufRead, BufReader};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    let path = std::env::temp_dir().join("thehub-selection.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(SELECTION_SCRIPT.as_bytes());
    std::fs::write(&path, bytes).ok()?;
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let (sender, replies) = std::sync::mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line.trim_start_matches('\u{feff}').trim().to_string()).is_err() {
                break;
            }
        }
    });
    match replies.recv_timeout(Duration::from_secs(15)) {
        Ok(line) if line == "READY" => Some(SelectionWorker { child, stdin, replies, last_use: std::time::Instant::now() }),
        _ => {
            let _ = child.kill();
            None
        }
    }
}

/// Secim okuyucuyu onceden baslatir; surukleme basladiginda sicak ve hazir olur.
pub fn prewarm_selection() {
    thread::spawn(|| {
        let Ok(mut guard) = SELECTION_WORKER.lock() else { return };
        if guard.is_none() {
            *guard = spawn_selection_worker();
        }
    });
}

/// Bosta kalan okuyucuyu kapatir (bellek geri verilir).
fn reap_selection(idle: Duration) {
    if let Ok(mut guard) = SELECTION_WORKER.lock() {
        if guard.as_ref().is_some_and(|w| w.last_use.elapsed() > idle) {
            if let Some(mut worker) = guard.take() {
                let _ = worker.child.kill();
            }
        }
    }
}

fn run_shell_script(hwnd: isize, class: &str, _mode: &str) -> Vec<String> {
    use std::io::Write;
    let Ok(mut guard) = SELECTION_WORKER.lock() else { return Vec::new() };
    for _ in 0..2 {
        if guard.is_none() {
            *guard = spawn_selection_worker();
        }
        let Some(worker) = guard.as_mut() else { return Vec::new() };
        while worker.replies.try_recv().is_ok() {}
        let sent = writeln!(worker.stdin, "{hwnd}|{class}").and_then(|_| worker.stdin.flush());
        let mut lines = Vec::new();
        let mut finished = false;
        if sent.is_ok() {
            while let Ok(line) = worker.replies.recv_timeout(Duration::from_secs(6)) {
                if line == "#END" {
                    finished = true;
                    break;
                }
                if !line.is_empty() {
                    lines.push(line);
                }
            }
        }
        if finished {
            worker.last_use = std::time::Instant::now();
            return lines;
        }
        if let Some(mut dead) = guard.take() {
            let _ = dead.child.kill();
        }
    }
    Vec::new()
}

/// Acik Explorer pencerelerinin klasorleri (pencere -> yol) ve masaustu klasoru.
#[derive(Clone, Default)]
struct Folders {
    windows: std::collections::HashMap<isize, std::path::PathBuf>,
    desktop: Option<std::path::PathBuf>,
}

/// Explorer / masaustunde secili dosyalari ve klasor haritasini tek PowerShell cagrisinda okur.
fn read_selection(hwnd: isize, class: &str) -> (Vec<String>, Folders) {
    let mut files = Vec::new();
    let mut folders = Folders::default();
    for line in run_shell_script(hwnd, class, "selection") {
        if let Some(path) = line.strip_prefix("#D|") {
            folders.desktop = Some(std::path::PathBuf::from(path));
        } else if let Some(rest) = line.strip_prefix("#F|") {
            if let Some((handle, path)) = rest.split_once('|') {
                if let Ok(handle) = handle.parse::<isize>() {
                    folders.windows.insert(handle, std::path::PathBuf::from(path));
                }
            }
        } else if std::path::Path::new(&line).is_file() {
            files.push(line);
        }
    }
    (files, folders)
}

/// Imlecin altindaki Explorer penceresinin (ya da masaustunun) klasoru; onbellekten, ek surec yok.
fn folder_at(p: Point, folders: &Folders) -> Option<std::path::PathBuf> {
    let class = root_class_at(p);
    let found = match class.as_str() {
        "WorkerW" | "Progman" => folders.desktop.clone(),
        c if SOURCE_CLASSES.contains(&c) => folders.windows.get(&root_window_at(p)).cloned(),
        _ => None,
    };
    found.filter(|d| d.is_dir())
}

/// 0 yukari, 1 sag, 2 asagi, 3 sol; merkez olu bolgedeyse None.
fn direction_at(dx: i32, dy: i32, scale: f64) -> Option<usize> {
    if f64::hypot(dx as f64, dy as f64) < DEAD_ZONE * scale {
        return None;
    }
    Some(if dx.abs() > dy.abs() {
        if dx > 0 { 1 } else { 3 }
    } else if dy > 0 {
        2
    } else {
        0
    })
}

fn root_window_at(p: Point) -> isize {
    let window = unsafe { WindowFromPoint(p) };
    match unsafe { GetAncestor(window, 2) } {
        0 => window,
        r => r,
    }
}

/// Esc tusuyla Explorer'in OLE surukleme dongusunu iptal eder (dosya yerinde kalir).
fn cancel_drag() {
    const KEYEVENTF_KEYUP: u32 = 2;
    unsafe {
        keybd_event(0x1B, 0, 0, 0);
        keybd_event(0x1B, 0, KEYEVENTF_KEYUP, 0);
    }
}

fn show_overlay(app: &AppHandle, at: Point, slots: &Slots) -> Option<(i32, i32, f64)> {
    if !READY.load(std::sync::atomic::Ordering::Acquire) {
        return None;
    }
    let overlay = app.get_webview_window("joystick")?;
    let monitor = overlay.monitor_from_point(at.x as f64, at.y as f64).ok().flatten()?;
    let (mx, my) = (monitor.position().x, monitor.position().y);
    let _ = overlay.set_size(tauri::PhysicalSize::new(monitor.size().width, monitor.size().height));
    let _ = overlay.set_position(tauri::PhysicalPosition::new(mx, my));
    let _ = overlay.emit("joystick-open", OpenPayload { x: at.x - mx, y: at.y - my, slots: slots.clone() });
    let _ = overlay.show();
    if let Ok(handle) = overlay.hwnd() {
        crate::windows_work_area::raise_topmost(handle.0 as isize);
    }
    Some((at.x, at.y, monitor.scale_factor()))
}

static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static CREATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Joystick sayfasi yuklenince arayuz bunu cagirir; o ana kadar katman gosterilmez.
#[tauri::command]
pub fn joystick_ready() {
    READY.store(true, std::sync::atomic::Ordering::Release);
}

/// Joystick penceresi ilk surukleme baslayinca (arka planda) olusturulur; bos durumda bellek tutmaz.
fn ensure_overlay(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if app.get_webview_window("joystick").is_some() || CREATING.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let url = tauri::WebviewUrl::App("index.html?view=joystick".into());
        let built = tauri::WebviewWindowBuilder::new(&app, "joystick", url)
            .title("theHUB Joystick")
            .inner_size(800.0, 600.0)
            .resizable(false)
            .decorations(false)
            .shadow(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .focusable(false)
            .disable_drag_drop_handler()
            .build();
        if let Err(error) = built {
            log(&format!("joystick penceresi olusturulamadi: {error}"));
            CREATING.store(false, Ordering::Release);
        }
    });
}

/// Uzun suredir kullanilmayan katman penceresini kapatir (bellek geri verilir).
fn drop_overlay(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if let Some(window) = app.get_webview_window("joystick") {
        let _ = window.destroy();
    }
    READY.store(false, Ordering::Release);
    CREATING.store(false, Ordering::Release);
}

pub fn hide_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("joystick") {
        let _ = overlay.emit("joystick-close", ());
        let _ = overlay.hide();
    }
}

pub fn start(app: AppHandle) {
    use std::sync::{Arc, Mutex};
    thread::spawn(move || {
        let mut previous_button = false;
        let mut armed = false;
        let mut press = Point { x: 0, y: 0 };
        let mut press_root = (0isize, String::new());
        let mut selection_requested = false;
        let selection: Arc<Mutex<Option<Vec<String>>>> = Arc::new(Mutex::new(None));
        let folders: Arc<Mutex<Folders>> = Arc::new(Mutex::new(Folders::default()));
        // Katman acikken: (imlec x, y, olcek)
        let mut overlay: Option<(i32, i32, f64)> = None;
        let mut hover: Option<usize> = None;
        let mut sent_files = false;
        let mut last_activity = std::time::Instant::now();
        loop {
            thread::sleep(Duration::from_millis(25));
            if !previous_button {
                reap_selection(Duration::from_secs(120));
            }
            if overlay.is_none() && !previous_button && last_activity.elapsed() > Duration::from_secs(600) {
                if app.get_webview_window("joystick").is_some() {
                    drop_overlay(&app);
                }
                last_activity = std::time::Instant::now();
            }
            let button = is_down(VK_LBUTTON);
            let shift = is_down(VK_SHIFT);
            if !button {
                if overlay.take().is_some() {
                    // Birakma: vurgulanan yon varsa secili dosyalari cevir.
                    let files = selection.lock().ok().and_then(|g| g.clone()).unwrap_or_default();
                    log(&format!("birakildi: hover={hover:?} dosya={files:?}"));
                    let released_at = Instant::now();
                    hide_overlay(&app);
                    if let Some(direction) = hover {
                        if let Some(target) = crate::convert::slots_for(&files)[direction] {
                            // Katman kapanana kadar bekle (en fazla ~300 ms), sonra birakilan yerin klasorunu bul.
                            for _ in 0..10 {
                                if cursor().map(|p| root_class_at(p) != "Tauri Window").unwrap_or(true) {
                                    break;
                                }
                                thread::sleep(Duration::from_millis(30));
                            }
                            let release = cursor();
                            let known = folders.lock().map(|g| g.clone()).unwrap_or_default();
                            let dest = release.and_then(|p| folder_at(p, &known));
                            let on_desktop = release.map(|p| matches!(root_class_at(p).as_str(), "WorkerW" | "Progman")).unwrap_or(false);
                            let place_at = if on_desktop { release.map(|p| (p.x, p.y)) } else { None };
                            log(&format!("hedef={target} klasor={dest:?} hazirlik={} ms", released_at.elapsed().as_millis()));
                            crate::convert_in_background(app.clone(), files, target.to_string(), dest, place_at);
                        }
                    }
                }
                armed = false;
                previous_button = false;
                selection_requested = false;
                hover = None;
                sent_files = false;
                if let Ok(mut guard) = selection.lock() {
                    *guard = None;
                }
                continue;
            }
            if !previous_button {
                if let Some(p) = cursor() {
                    press = p;
                    let class = root_class_at(p);
                    armed = SOURCE_CLASSES.contains(&class.as_str());
                    press_root = (root_window_at(p), class);
                    if armed {
                        last_activity = std::time::Instant::now();
                        ensure_overlay(&app);
                        prewarm_selection();
                    }
                }
            }
            previous_button = true;
            if !armed {
                continue;
            }
            let Some(now) = cursor() else { continue };
            let moved = (now.x - press.x).abs() > DRAG_THRESHOLD || (now.y - press.y).abs() > DRAG_THRESHOLD;
            if moved && !selection_requested {
                // Surukleme basladi: secili dosyalari arka planda oku.
                selection_requested = true;
                let slot = Arc::clone(&selection);
                let folder_slot = Arc::clone(&folders);
                let (hwnd, class) = press_root.clone();
                thread::spawn(move || {
                    let (files, known) = read_selection(hwnd, &class);
                    log(&format!("secim okundu: {files:?}"));
                    // Belge cevirilecekse Word simdiden baslasin; kullanici yon secerken hazir olur.
                    if crate::convert::uses_word(&files) {
                        crate::convert::prewarm();
                    }
                    if let Ok(mut guard) = folder_slot.lock() {
                        *guard = known;
                    }
                    if let Ok(mut guard) = slot.lock() {
                        *guard = Some(files);
                    }
                });
            }
            let files = selection.lock().ok().and_then(|g| g.clone());
            if moved && shift && overlay.is_none() {
                let slots = slots_of(files.as_deref().unwrap_or(&[]));
                overlay = show_overlay(&app, now, &slots);
                if overlay.is_none() {
                    continue;
                }
                log(&format!("katman acildi dosya_hazir={} etiketler={:?}", files.is_some(), crate::convert::slots_for(files.as_deref().unwrap_or(&[]))));
                // Explorer surukleme dongusunu iptal et: birakinca hicbir dosya tasinmaz/kopyalanmaz,
                // yon secimi yalniz imlec konumundan okunur.
                cancel_drag();
                sent_files = files.is_some();
                hover = None;
            }
            if let Some((ox, oy, scale)) = overlay {
                if !sent_files {
                    if let Some(files) = &files {
                        if let Some(window) = app.get_webview_window("joystick") {
                            let _ = window.emit("joystick-files", slots_of(files));
                        }
                        sent_files = true;
                    }
                }
                let direction = direction_at(now.x - ox, now.y - oy, scale);
                if direction != hover {
                    hover = direction;
                    if let Some(window) = app.get_webview_window("joystick") {
                        let _ = window.emit("joystick-hover", direction);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dead_zone_and_directions() {
        assert_eq!(direction_at(0, 0, 1.0), None);
        assert_eq!(direction_at(-100, 10, 1.0), Some(3));
        assert_eq!(direction_at(100, -10, 1.0), Some(1));
        assert_eq!(direction_at(5, 90, 1.0), Some(2));
        assert_eq!(direction_at(-5, -90, 1.0), Some(0));
    }

    /// Masaustu acik makinede elle: cargo test desktop_icon_lands -- --ignored --nocapture
    #[test]
    #[ignore]
    fn selection_worker_is_fast_when_warm() {
        let t = std::time::Instant::now();
        let cold = run_shell_script(0, "Progman", "selection");
        let cold_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let warm = run_shell_script(0, "Progman", "selection");
        println!("soguk {cold_ms} ms, sicak {} ms, satir {}", t.elapsed().as_millis(), warm.len());
        assert!(!cold.is_empty());
    }

    #[test]
    #[ignore]
    fn desktop_icon_lands_where_it_was_dropped() {
        let desktop = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop");
        let file = desktop.join("hub-place-test.txt");
        let expected = next_desktop_slot(&["hub-place-test.txt".to_string()], (300, 300)).expect("siradaki hucre");
        println!("beklenen: {expected:?}");
        std::fs::write(&file, "x").unwrap();
        thread::sleep(Duration::from_millis(30));
        place_on_desktop(&file, (300, 300));
        thread::sleep(Duration::from_secs(4));
        let names = vec!["hub-place-test.txt".to_string()];
        let position = desktop_icon(&names, None);
        let _ = std::fs::remove_file(&file);
        println!("konum: {position:?}");
        let (x, y) = position.expect("simge bulunamadi");
        assert!((x - expected.0).abs() <= 40 && (y - expected.1).abs() <= 40, "simge hedefte degil: {x},{y}");
    }
}
