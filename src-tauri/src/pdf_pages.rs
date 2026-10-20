//! PDF'i sayfa resimlerine cevirip html olarak yazar: gorunum birebir korunur, hicbir sey kaymaz.
//! Sayfalar Windows'un kendi PDF motoruyla (Windows.Data.Pdf) cizilir; Word gerekmez.

use std::{io::Write, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use windows::{
    core::HSTRING,
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Globalization::Language,
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::{
        Streams::{DataReader, DataWriter, InMemoryRandomAccessStream},
        StorageFile,
    },
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

/// Cizim cozunurlugu: 96 dpi'nin 2 kati (okunakli ve makul boyutta).
const SCALE: f64 = 2.0;

struct Page {
    png: Vec<u8>,
    /// Sayfa boyutu, 96 dpi piksel.
    width: u32,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("PDF okunamadi: {e}")
}

fn render(path: &Path, scale: f64, max_dimension: f64) -> Result<Vec<Page>, String> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.to_string_lossy().as_ref())).map_err(err)?.join().map_err(err)?;
    let document = PdfDocument::LoadFromFileAsync(&file).map_err(err)?.join().map_err(err)?;
    let count = document.PageCount().map_err(err)?;
    let mut pages = Vec::with_capacity(count as usize);
    for index in 0..count {
        let page = document.GetPage(index).map_err(err)?;
        let size = page.Size().map_err(err)?;
        let options = PdfPageRenderOptions::new().map_err(err)?;
        let factor = scale.min(max_dimension / (size.Width.max(size.Height) as f64).max(1.0));
        options.SetDestinationWidth((size.Width as f64 * factor).round() as u32).map_err(err)?;
        options.SetDestinationHeight((size.Height as f64 * factor).round() as u32).map_err(err)?;
        let stream = InMemoryRandomAccessStream::new().map_err(err)?;
        page.RenderWithOptionsToStreamAsync(&stream, &options).map_err(err)?.join().map_err(err)?;
        let length = stream.Size().map_err(err)? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(err)?).map_err(err)?;
        reader.LoadAsync(length).map_err(err)?.join().map_err(err)?;
        let mut png = vec![0u8; length as usize];
        reader.ReadBytes(&mut png).map_err(err)?;
        pages.push(Page { png, width: size.Width.round().max(1.0) as u32 });
    }
    if pages.is_empty() {
        return Err("PDF bos".into());
    }
    Ok(pages)
}

pub fn to_html(source: &Path, output: &Path) -> Result<(), String> {
    let pages = render(source, SCALE, f64::MAX)?;
    let mut html = String::from(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>PDF</title>\n<style>body{margin:0;background:#e5e5e5}img{display:block;margin:16px auto;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}</style></head><body>\n",
    );
    for page in &pages {
        html.push_str(&format!("<img width=\"{}\" src=\"data:image/png;base64,{}\" alt=\"\">\n", page.width, STANDARD.encode(&page.png)));
    }
    html.push_str("</body></html>\n");
    std::fs::write(output, html).map_err(|e| e.to_string())
}

fn ocr_engine() -> Result<OcrEngine, String> {
    if let Ok(engine) = OcrEngine::TryCreateFromUserProfileLanguages() {
        return Ok(engine);
    }
    for tag in ["tr", "en-US"] {
        if let Ok(language) = Language::CreateLanguage(&HSTRING::from(tag)) {
            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                return Ok(engine);
            }
        }
    }
    Err("OCR dili yuklu degil (Ayarlar > Dil'den Turkce/Ingilizce dil paketini ekleyin)".into())
}

/// Taranmis PDF'in her sayfasini Windows'un kendi OCR motoruyla okur (sayfa basina bir metin).
pub fn ocr_pages(source: &Path) -> Result<Vec<String>, String> {
    let engine = ocr_engine()?;
    let max_dimension = OcrEngine::MaxImageDimension().unwrap_or(2600) as f64;
    // OCR icin yuksek cozunurluk (96 dpi x3), motorun izin verdigi en buyuk kenara kirpilir.
    let pages = render(source, 3.0, max_dimension)?;
    let mut texts = Vec::with_capacity(pages.len());
    for page in &pages {
        let stream = InMemoryRandomAccessStream::new().map_err(err)?;
        let writer = DataWriter::CreateDataWriter(&stream.GetOutputStreamAt(0).map_err(err)?).map_err(err)?;
        writer.WriteBytes(&page.png).map_err(err)?;
        writer.StoreAsync().map_err(err)?.join().map_err(err)?;
        writer.FlushAsync().map_err(err)?.join().map_err(err)?;
        let decoder = BitmapDecoder::CreateAsync(&stream).map_err(err)?.join().map_err(err)?;
        let bitmap = decoder.GetSoftwareBitmapAsync().map_err(err)?.join().map_err(err)?;
        let result = engine.RecognizeAsync(&bitmap).map_err(err)?.join().map_err(err)?;
        texts.push(result.Text().map_err(err)?.to_string());
    }
    Ok(texts)
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Metin sayfalarindan duz bir docx yazar (her satir bir paragraf, sayfalar arasinda sayfa sonu).
pub fn write_text_docx(pages: &[String], output: &Path) -> Result<(), String> {
    let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    let mut put = |name: &str, data: &[u8], zip: &mut zip::ZipWriter<std::fs::File>| -> Result<(), String> {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())
    };
    put(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        &mut zip,
    )?;
    put(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        &mut zip,
    )?;
    let mut body = String::new();
    for (index, page) in pages.iter().enumerate() {
        let mut first = true;
        for line in page.lines() {
            let break_before = if index > 0 && first { "<w:pageBreakBefore/>" } else { "" };
            first = false;
            body.push_str(&format!("<w:p><w:pPr>{break_before}</w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", xml_escape(line)));
        }
    }
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    put("word/document.xml", document.as_bytes(), &mut zip)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Word'un urettigi docx/txt'te okunabilir metin var mi? Yoksa PDF taranmis resimdir.
pub fn has_text(output: &Path) -> bool {
    let is_docx = output.extension().is_some_and(|e| e.eq_ignore_ascii_case("docx"));
    if !is_docx {
        return std::fs::read(output).map(|b| String::from_utf8_lossy(&b).chars().filter(|c| c.is_alphanumeric()).count() >= 20).unwrap_or(false);
    }
    let Ok(file) = std::fs::File::open(output) else { return false };
    let Ok(mut archive) = zip::ZipArchive::new(file) else { return false };
    let Ok(mut entry) = archive.by_name("word/document.xml") else { return false };
    let mut xml = String::new();
    if std::io::Read::read_to_string(&mut entry, &mut xml).is_err() {
        return false;
    }
    let mut count = 0;
    let mut rest = xml.as_str();
    while let Some(start) = rest.find("<w:t") {
        rest = &rest[start + 4..];
        let Some(open_end) = rest.find('>') else { break };
        if rest.as_bytes().first().is_some_and(|b| *b != b'>' && *b != b' ') {
            continue;
        }
        let after = &rest[open_end + 1..];
        let Some(close) = after.find("</w:t>") else { break };
        count += after[..close].chars().filter(|c| c.is_alphanumeric()).count();
        if count >= 20 {
            return true;
        }
        rest = &after[close..];
    }
    false
}
