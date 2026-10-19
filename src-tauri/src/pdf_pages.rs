//! PDF'i sayfa resimlerine cevirip docx/html olarak yazar: gorunum birebir korunur, hicbir sey kaymaz.
//! Sayfalar Windows'un kendi PDF motoruyla (Windows.Data.Pdf) cizilir; Word gerekmez.

use std::{io::Write, path::Path};

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
    height: u32,
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
        pages.push(Page { png, width: size.Width.round().max(1.0) as u32, height: size.Height.round().max(1.0) as u32 });
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

pub fn to_docx(source: &Path, output: &Path) -> Result<(), String> {
    let pages = render(source)?;
    let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    let mut put = |name: &str, data: &[u8], zip: &mut zip::ZipWriter<std::fs::File>| -> Result<(), String> {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())
    };
    put(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        &mut zip,
    )?;
    put(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        &mut zip,
    )?;
    let mut relationships = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    let mut body = String::new();
    for (index, page) in pages.iter().enumerate() {
        let number = index + 1;
        relationships.push_str(&format!(
            r#"<Relationship Id="rId{number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page{number}.png"/>"#
        ));
        // 96 dpi piksel -> EMU (9525 EMU/px).
        let (cx, cy) = (page.width as u64 * 9525, page.height as u64 * 9525);
        let break_before = if index > 0 { "<w:pageBreakBefore/>" } else { "" };
        body.push_str(&format!(
            r#"<w:p><w:pPr>{break_before}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{number}" name="Sayfa {number}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{number}" name="page{number}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId{number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
        ));
    }
    relationships.push_str("</Relationships>");
    // Sayfa boyutu ilk sayfadan (96 dpi piksel -> twip: x15); kenar boslugu yok, tasmayi onlemek icin kucuk pay.
    let first = &pages[0];
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>{body}<w:sectPr><w:pgSz w:w="{}" w:h="{}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>"#,
        first.width * 15,
        first.height * 15 + 60,
    );
    put("word/document.xml", document.as_bytes(), &mut zip)?;
    put("word/_rels/document.xml.rels", relationships.as_bytes(), &mut zip)?;
    for (index, page) in pages.iter().enumerate() {
        put(&format!("word/media/page{}.png", index + 1), &page.png, &mut zip)?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}
