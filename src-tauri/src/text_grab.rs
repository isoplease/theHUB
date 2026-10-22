//! Ekranda secilen bolgedeki yaziyi okuyup panoya kopyalar (Win+Shift+S benzeri, cikti metin).
//! Kisayol ekrani yakalar, tam ekran seffaf bir secim katmani acar; secimden sonra
//! kirpilan bolge Windows OCR ile okunur.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_notification::NotificationExt;

struct Frame {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

static FRAME: Mutex<Option<Frame>> = Mutex::new(None);

#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(owner: isize) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(format: u32, handle: isize) -> isize;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    fn GlobalLock(handle: isize) -> *mut u16;
    fn GlobalUnlock(handle: isize) -> i32;
    fn GlobalFree(handle: isize) -> isize;
}

fn set_clipboard_text(text: &str) -> Result<(), String> {
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let handle = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if handle == 0 {
            return Err("bellek ayrilamadi".into());
        }
        let target = GlobalLock(handle);
        if target.is_null() {
            GlobalFree(handle);
            return Err("bellek kilitlenemedi".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
        GlobalUnlock(handle);
        // Pano baska bir uygulamada aciksa kisa sure tekrar dene.
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(0) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            GlobalFree(handle);
            return Err("pano acilamadi".into());
        }
        EmptyClipboard();
        let ok = SetClipboardData(CF_UNICODETEXT, handle) != 0;
        CloseClipboard();
        if !ok {
            GlobalFree(handle);
            return Err("pano yazilamadi".into());
        }
    }
    Ok(())
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Imlecin bulundugu ekrani yakalar ve secim katmanini acar.
pub fn start(app: &AppHandle) {
    if app.get_webview_window("grab").is_some() {
        return;
    }
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(monitors) = app.available_monitors() else { return };
    let Some(monitor) = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        cursor.x >= p.x as f64 && cursor.x < (p.x + s.width as i32) as f64 && cursor.y >= p.y as f64 && cursor.y < (p.y + s.height as i32) as f64
    }) else {
        return;
    };
    let (position, size) = (*monitor.position(), *monitor.size());
    let Ok(rgba) = crate::screen_capture::capture(position.x, position.y, size.width as i32, size.height as i32) else { return };
    if let Ok(mut frame) = FRAME.lock() {
        *frame = Some(Frame { rgba, width: size.width, height: size.height });
    }
    let url = tauri::WebviewUrl::App("index.html?view=grab".into());
    let built = tauri::WebviewWindowBuilder::new(app, "grab", url)
        .title("theHUB")
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build();
    if let Ok(window) = built {
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
        let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Ok(mut frame) = FRAME.lock() {
        *frame = None;
    }
}

fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("grab") {
        let _ = window.destroy();
    }
}

#[tauri::command]
pub fn grab_cancel(app: AppHandle) {
    close(&app);
    if let Ok(mut frame) = FRAME.lock() {
        *frame = None;
    }
}

/// Secilen bolgeyi (fiziksel piksel, ekrana gore) okuyup panoya koyar.
#[tauri::command]
pub fn grab_finish(app: AppHandle, x: i32, y: i32, width: i32, height: i32) {
    close(&app);
    let frame = FRAME.lock().ok().and_then(|mut f| f.take());
    let Some(frame) = frame else { return };
    std::thread::spawn(move || {
        let outcome = read_region(&frame, x, y, width, height).and_then(|text| {
            if text.trim().is_empty() {
                Err("Secimde yazi bulunamadi".to_string())
            } else {
                set_clipboard_text(text.trim()).map(|_| text)
            }
        });
        match outcome {
            Ok(text) => {
                let preview: String = text.trim().chars().take(120).collect();
                notify(&app, "Metin kopyalandi", &preview);
            }
            Err(error) => notify(&app, "Metin kopyalanamadi", &error),
        }
    });
}

fn read_region(frame: &Frame, x: i32, y: i32, width: i32, height: i32) -> Result<String, String> {
    let x0 = x.clamp(0, frame.width as i32 - 1) as u32;
    let y0 = y.clamp(0, frame.height as i32 - 1) as u32;
    let w = (width.max(1) as u32).min(frame.width - x0);
    let h = (height.max(1) as u32).min(frame.height - y0);
    let image = image::RgbaImage::from_raw(frame.width, frame.height, frame.rgba.clone()).ok_or("goruntu okunamadi")?;
    let mut crop = image::imageops::crop_imm(&image, x0, y0, w, h).to_image();
    // Kucuk yazilar buyutulunce OCR belirgin iyilesir.
    let longest = w.max(h);
    if longest < 1200 {
        let factor = (1200 / longest.max(1)).clamp(1, 3);
        if factor > 1 {
            crop = image::imageops::resize(&crop, w * factor, h * factor, image::imageops::FilterType::CatmullRom);
        }
    }
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(crop)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    crate::pdf_pages::ocr_png(&png)
}
