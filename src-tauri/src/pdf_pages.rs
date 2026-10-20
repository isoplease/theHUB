//! PDF'i sayfa resimlerine cevirip html olarak yazar: gorunum birebir korunur, hicbir sey kaymaz.
//! Sayfalar Windows'un kendi PDF motoruyla (Windows.Data.Pdf) cizilir; Word gerekmez.

use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use windows::{
    core::HSTRING,
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Storage::{
        Streams::{DataReader, InMemoryRandomAccessStream},
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

fn render(path: &Path) -> Result<Vec<Page>, String> {
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
        options.SetDestinationWidth((size.Width as f64 * SCALE).round() as u32).map_err(err)?;
        options.SetDestinationHeight((size.Height as f64 * SCALE).round() as u32).map_err(err)?;
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
    let pages = render(source)?;
    let mut html = String::from(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>PDF</title>\n<style>body{margin:0;background:#e5e5e5}img{display:block;margin:16px auto;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}</style></head><body>\n",
    );
    for page in &pages {
        html.push_str(&format!("<img width=\"{}\" src=\"data:image/png;base64,{}\" alt=\"\">\n", page.width, STANDARD.encode(&page.png)));
    }
    html.push_str("</body></html>\n");
    std::fs::write(output, html).map_err(|e| e.to_string())
}
