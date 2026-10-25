use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Write;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_pdf(app: tauri::AppHandle, filename: String, data: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD.decode(data).map_err(|e| format!("Invalid PDF data: {e}"))?;
        if !bytes.starts_with(b"%PDF-") { return Err("Invalid PDF file.".into()); }
        let Some(selected) = app.dialog().file().set_title("Save PDF")
            .set_file_name(filename).add_filter("PDF document", &["pdf"]).blocking_save_file() else {
            return Ok(None);
        };
        let mut path = selected.into_path().map_err(|e| e.to_string())?;
        if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) {
            path.set_extension("pdf");
        }
        let parent = path.parent().ok_or("Invalid destination folder.")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("Could not save PDF: {e}"))?;
        temp.write_all(&bytes).map_err(|e| format!("Could not write PDF: {e}"))?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&path).map_err(|e| format!("Could not save PDF: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}
