//! Joystick katmanindan gelen dosya donusturme istekleri.
//! Resimler dogrudan Rust ile, belgeler arka planda sicak tutulan bir Word ile cevrilir.

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex, Once},
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};

const WORKER_SCRIPT: &str = include_str!("worker.ps1");
const DOCUMENT_SOURCES: &[&str] = &["docx", "doc", "rtf", "odt", "txt", "html", "htm", "pdf"];
const DOCUMENT_TARGETS: &[&str] = &["pdf", "docx", "html", "txt", "rtf"];
const IMAGE_SOURCES: &[&str] = &["png", "jpg", "jpeg", "jfif", "bmp", "gif", "tif", "tiff", "ico"];
const IMAGE_TARGETS: &[&str] = &["png", "jpg", "bmp", "gif", "tiff"];
/// Word hazirlanirken ve her belge icin beklenecek en uzun sure.
const WORD_START_TIMEOUT: Duration = Duration::from_secs(60);
const JOB_TIMEOUT: Duration = Duration::from_secs(120);
/// Bu kadar suredir is gelmezse Word kapatilir (bellek geri verilir).
const IDLE_LIMIT: Duration = Duration::from_secs(300);

struct Worker {
    child: Child,
    stdin: ChildStdin,
    replies: mpsc::Receiver<String>,
    last_use: Instant,
}

impl Worker {
    fn stop(mut self) {
        let _ = writeln!(self.stdin, "quit");
        let _ = self.stdin.flush();
        thread::sleep(Duration::from_millis(300));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);
static REAPER: Once = Once::new();

fn spawn_worker() -> Result<Worker, String> {
    let script_path = std::env::temp_dir().join("thehub-word-worker.ps1");
    // PowerShell 5.1 BOM'suz dosyayi ANSI okur.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(WORKER_SCRIPT.as_bytes());
    std::fs::write(&script_path, bytes).map_err(|e| e.to_string())?;
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("Word calisani baslatilamadi")?;
    let stdout = child.stdout.take().ok_or("Word calisani baslatilamadi")?;
    let (sender, replies) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    match replies.recv_timeout(WORD_START_TIMEOUT) {
        Ok(line) if line.trim() == "READY" => {}
        _ => {
            let _ = child.kill();
            return Err("Word baslatilamadi (yuklu mu?)".into());
        }
    }
    Ok(Worker { child, stdin, replies, last_use: Instant::now() })
}

fn start_reaper() {
    REAPER.call_once(|| {
        thread::spawn(|| loop {
            thread::sleep(Duration::from_secs(15));
            let Ok(mut guard) = WORKER.lock() else { continue };
            if guard.as_ref().is_some_and(|w| w.last_use.elapsed() > IDLE_LIMIT) {
                if let Some(worker) = guard.take() {
                    worker.stop();
                }
            }
        });
    });
}

/// Word'u onceden baslatir; kullanici yon secerken baslangic gecikmesi (~5 sn) gizlenir.
pub fn prewarm() {
    thread::spawn(|| {
        start_reaper();
        if let Ok(mut guard) = WORKER.lock() {
            if guard.is_none() {
                if let Ok(worker) = spawn_worker() {
                    *guard = Some(worker);
                }
            }
        }
    });
}

fn convert_document(source: &Path, output: &Path) -> Result<(), String> {
    start_reaper();
    let mut guard = WORKER.lock().map_err(|_| "Word calisani kilitli".to_string())?;
    if guard.is_none() {
        *guard = Some(spawn_worker()?);
    }
    let worker = guard.as_mut().expect("worker");
    let encode = |p: &Path| STANDARD.encode(p.to_string_lossy().as_bytes());
    let request = format!("{}\t{}", encode(source), encode(output));
    let sent = writeln!(worker.stdin, "{request}").and_then(|_| worker.stdin.flush());
    let reply = if sent.is_ok() { worker.replies.recv_timeout(JOB_TIMEOUT).ok() } else { None };
    worker.last_use = Instant::now();
    match reply {
        Some(line) if line.trim() == "OK" => Ok(()),
        Some(line) => {
            let detail = line
                .strip_prefix("ERR ")
                .and_then(|b| STANDARD.decode(b.trim()).ok())
                .and_then(|b| String::from_utf8(b).ok())
                .unwrap_or_else(|| "Donusturme basarisiz".into());
            Err(detail.lines().next().unwrap_or("Donusturme basarisiz").trim().to_string())
        }
        None => {
            // Calisan yanit vermedi: kapat, bir sonraki istek yenisini baslatsin.
            if let Some(dead) = guard.take() {
                dead.stop();
            }
            Err("Donusturme zaman asimina ugradi".into())
        }
    }
}

fn convert_image(source: &Path, output: &Path, target: &str) -> Result<(), String> {
    let image = image::ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    if target == "jpg" {
        // JPEG seffaflik tasimaz: beyaz zemine yapistir.
        let rgba = image.to_rgba8();
        let mut flat = image::RgbImage::new(rgba.width(), rgba.height());
        for (x, y, pixel) in rgba.enumerate_pixels() {
            let alpha = pixel[3] as u32;
            let mix = |c: u8| ((c as u32 * alpha + 255 * (255 - alpha)) / 255) as u8;
            flat.put_pixel(x, y, image::Rgb([mix(pixel[0]), mix(pixel[1]), mix(pixel[2])]));
        }
        flat.save_with_format(output, image::ImageFormat::Jpeg).map_err(|e| e.to_string())
    } else {
        let format = match target {
            "png" => image::ImageFormat::Png,
            "bmp" => image::ImageFormat::Bmp,
            "gif" => image::ImageFormat::Gif,
            "tiff" => image::ImageFormat::Tiff,
            other => return Err(format!("Desteklenmeyen resim bicimi: {other}")),
        };
        image.save_with_format(output, format).map_err(|e| e.to_string())
    }
}

/// Word HTML'i resimleri yan klasore (`<ad>_dosyalar`) koyar; masaustunde duzen bozulur.
/// Gecici klasore cevrilir, resimler HTML'e gomulur ve tek dosya yazilir.
fn convert_html(source: &Path, output: &Path) -> Result<(), String> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let work = std::env::temp_dir().join(format!("thehub-html-{stamp}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = (|| {
        let temp_html = work.join("belge.html");
        convert_document(source, &temp_html)?;
        let mut html = std::fs::read(&temp_html).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(&work).map_err(|e| e.to_string())?.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            for file in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
                let name = file.file_name().to_string_lossy().into_owned();
                let mime = match extension(&file.path()).as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" | "jpe" => "image/jpeg",
                    "gif" => "image/gif",
                    "bmp" => "image/bmp",
                    "svg" => "image/svg+xml",
                    _ => continue,
                };
                let Ok(data) = std::fs::read(file.path()) else { continue };
                let uri = format!("data:{mime};base64,{}", STANDARD.encode(data));
                for reference in [format!("{dir_name}/{name}"), format!("{}/{}", dir_name.replace(' ', "%20"), name.replace(' ', "%20"))] {
                    html = replace_bytes(&html, reference.as_bytes(), uri.as_bytes());
                }
            }
        }
        std::fs::write(output, html).map_err(|e| e.to_string())
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

fn replace_bytes(haystack: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    if from.is_empty() {
        return haystack.to_vec();
    }
    let mut out = Vec::with_capacity(haystack.len());
    let mut index = 0;
    while index < haystack.len() {
        if haystack[index..].starts_with(from) {
            out.extend_from_slice(to);
            index += from.len();
        } else {
            out.push(haystack[index]);
            index += 1;
        }
    }
    out
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn free_output(source: &Path, target: &str, dest_dir: Option<&Path>) -> PathBuf {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("dosya");
    let dir = dest_dir.or_else(|| source.parent()).unwrap_or_else(|| Path::new("."));
    let mut candidate = dir.join(format!("{stem}.{target}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).{target}"));
        n += 1;
    }
    candidate
}

/// Dosyayi `target` bicimine cevirir; `dest_dir` yoksa kaynak dosyanin yanina yazar, yeni yolu dondurur.
pub fn convert(path: &str, target: &str, dest_dir: Option<&Path>) -> Result<String, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("Dosya bulunamadi".into());
    }
    let from = extension(&source);
    let is_image = IMAGE_SOURCES.contains(&from.as_str()) && IMAGE_TARGETS.contains(&target);
    let is_document = DOCUMENT_SOURCES.contains(&from.as_str()) && DOCUMENT_TARGETS.contains(&target);
    if !is_image && !is_document {
        return Err(format!(".{from} dosyasi {target} bicimine cevrilemez"));
    }
    let output = free_output(&source, target, dest_dir.filter(|d| d.is_dir()));
    if is_image {
        convert_image(&source, &output, target)?;
    } else if from == "pdf" && target == "html" {
        crate::pdf_pages::to_html(&source, &output)?;
    } else if target == "html" {
        convert_html(&source, &output)?;
    } else {
        convert_document(&source, &output)?;
    }
    if !output.is_file() {
        return Err("Donusturme basarisiz".into());
    }
    Ok(output.to_string_lossy().into_owned())
}

/// Dosyalardan biri Word ile cevrilecekse true (Word onceden baslatilabilir).
pub fn uses_word(paths: &[String]) -> bool {
    paths.iter().any(|p| DOCUMENT_SOURCES.contains(&extension(Path::new(p)).as_str()))
}

/// Dort yone (yukari, sag, asagi, sol) SABIT bicimler atanir; dosyanin kendi bicimi bos birakilir.
/// Yonler dosyaya gore kaymaz: belge icin PDF / DOCX / HTML / TXT, resim icin PNG / JPG / BMP / GIF.
pub fn slots_for(paths: &[String]) -> [Option<&'static str>; 4] {
    let mut slots = [None; 4];
    if paths.is_empty() {
        return slots;
    }
    let normalize = |ext: String| match ext.as_str() {
        "jpeg" | "jfif" => "jpg".to_string(),
        "htm" => "html".to_string(),
        "tif" => "tiff".to_string(),
        _ => ext,
    };
    let extensions: Vec<String> = paths.iter().map(|p| extension(Path::new(p))).collect();
    let fixed: [&'static str; 4] = if extensions.iter().all(|e| DOCUMENT_SOURCES.contains(&e.as_str())) {
        ["pdf", "docx", "html", "txt"]
    } else if extensions.iter().all(|e| IMAGE_SOURCES.contains(&e.as_str())) {
        ["png", "jpg", "bmp", "gif"]
    } else {
        return slots;
    };
    let own: Vec<String> = extensions.into_iter().map(normalize).collect();
    for (index, target) in fixed.iter().enumerate() {
        if !own.iter().any(|o| o == target) {
            slots[index] = Some(*target);
        }
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("thehub-convert-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn images_convert_between_formats_without_extra_processes() {
        let dir = temp_dir("img");
        let source = dir.join("a.png");
        image::RgbaImage::from_pixel(64, 48, image::Rgba([200, 30, 30, 128])).save(&source).unwrap();
        for target in ["jpg", "bmp", "gif", "tiff"] {
            let started = Instant::now();
            let output = convert(source.to_str().unwrap(), target, None).unwrap();
            assert!(Path::new(&output).is_file(), "{target} uretilmedi");
            assert!(started.elapsed() < Duration::from_secs(2), "{target} cok yavas");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unsupported_pairs_are_rejected() {
        let dir = temp_dir("bad");
        let source = dir.join("a.png");
        image::RgbaImage::new(4, 4).save(&source).unwrap();
        assert!(convert(source.to_str().unwrap(), "pdf", None).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn slots_skip_the_source_format() {
        let slots = slots_for(&["x.docx".to_string()]);
        assert_eq!(slots, [Some("pdf"), None, Some("html"), Some("txt")]);
        let slots = slots_for(&["x.jpeg".to_string()]);
        assert_eq!(slots, [Some("png"), None, Some("bmp"), Some("gif")]);
    }

    /// Word kurulu makinede elle: cargo test word_worker -- --ignored --nocapture
    #[test]
    #[ignore]
    fn word_worker_is_fast_after_warmup() {
        let dir = temp_dir("word");
        let source = dir.join("a.html");
        std::fs::write(&source, "<h1>Merhaba çğş</h1>").unwrap();
        let cold = Instant::now();
        convert(source.to_str().unwrap(), "pdf", None).unwrap();
        println!("soguk: {} ms", cold.elapsed().as_millis());
        let warm = Instant::now();
        convert(source.to_str().unwrap(), "docx", None).unwrap();
        println!("sicak: {} ms", warm.elapsed().as_millis());
        let more = Instant::now();
        convert(source.to_str().unwrap(), "txt", None).unwrap();
        println!("sicak 2: {} ms", more.elapsed().as_millis());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    #[ignore]
    fn pdf_to_html_is_single_file() {
        let desktop = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop");
        let pdf = desktop.join("ProATS.pdf");
        let scratch = temp_dir("pdfhtml");
        let started = Instant::now();
        let out = convert(pdf.to_str().unwrap(), "html", Some(&scratch)).expect("html");
        println!("pdf->html {} ms", started.elapsed().as_millis());
        assert!(std::fs::metadata(&out).unwrap().len() > 10_000);
        let entries: Vec<_> = std::fs::read_dir(&scratch).unwrap().flatten().map(|e| e.file_name()).collect();
        println!("cikti: {out} klasor icerigi: {entries:?}");
        assert_eq!(entries.len(), 1, "yan klasor kalmamali");
        let started = Instant::now();
        let docx = convert(pdf.to_str().unwrap(), "docx", Some(&scratch)).expect("docx");
        println!("pdf->docx {} ms ({docx})", started.elapsed().as_millis());
        let _ = std::fs::copy(&docx, "C:/Users/YIU/AppData/Local/Temp/claude/C--Users-YIU-Documents-GitHub-MehmetOS/99f3390d-522a-4c3e-a22f-adb3cd696e8f/scratchpad/ProATS-test.docx");
    }

    #[test]
    #[ignore]
    fn word_worker_recovers_after_word_is_killed() {
        let desktop = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop");
        let docx = desktop.join("ProATS (2).docx");
        let scratch = temp_dir("recover");
        convert(docx.to_str().unwrap(), "txt", Some(&scratch)).expect("ilk donusturme");
        let _ = Command::new("taskkill").args(["/F", "/IM", "WINWORD.EXE"]).output();
        thread::sleep(Duration::from_millis(500));
        let started = Instant::now();
        let first = convert(docx.to_str().unwrap(), "html", Some(&scratch));
        println!("kapatildiktan sonra html: {:?} {} ms", first.as_ref().map(|_| "ok"), started.elapsed().as_millis());
        convert(docx.to_str().unwrap(), "txt", Some(&scratch)).expect("txt");
        first.expect("html");
    }
}
