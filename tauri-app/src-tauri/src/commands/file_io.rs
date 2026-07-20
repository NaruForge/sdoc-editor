use super::DocState;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn write_export_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_import_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ─── Resolve file path for asset protocol ───────────────────────────

#[tauri::command]
pub fn resolve_asset_path(
    relative_path: String,
    state: tauri::State<DocState>,
) -> Result<String, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;

    // Strip leading "./" if present
    let clean = relative_path.trim_start_matches("./");
    let abs = doc_dir.join(clean);
    Ok(abs.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resolve_document_relative_path(
    path: String,
    state: tauri::State<DocState>,
) -> Result<String, String> {
    let input = PathBuf::from(&path);
    if input.is_absolute() {
        return Ok(input.to_string_lossy().to_string());
    }

    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    Ok(doc_dir.join(input).to_string_lossy().to_string())
}
