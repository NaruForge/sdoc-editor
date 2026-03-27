use crate::document::*;
use crate::settings::*;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// State for the currently open document.
pub struct DocState {
    pub file_path: std::sync::Mutex<Option<PathBuf>>,
    pub settings: std::sync::Mutex<AppSettings>,
}

// ─── File Operations ────────────────────────────────────────────────

#[tauri::command]
pub fn open_document(path: String, state: tauri::State<DocState>) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let (meta, doc) = unwrap_sdoc(&parsed);

    // Update state
    *state.file_path.lock().unwrap() = Some(path.clone());

    // Add to recent files
    {
        let mut settings = state.settings.lock().unwrap();
        let path_str = path.to_string_lossy().to_string();
        settings.recent_files.retain(|f| f != &path_str);
        settings.recent_files.insert(0, path_str);
        if settings.recent_files.len() > 20 {
            settings.recent_files.truncate(20);
        }
        save_settings(&settings).ok();
    }

    Ok(serde_json::json!({
        "meta": meta,
        "doc": doc,
    }))
}

#[tauri::command]
pub fn save_document(
    content: serde_json::Value,
    meta_updates: Option<serde_json::Value>,
    state: tauri::State<DocState>,
) -> Result<(), String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let path = file_path.ok_or("No file open")?;

    // Read existing file to get current meta
    let existing_text = fs::read_to_string(&path).unwrap_or_default();
    let existing: serde_json::Value = serde_json::from_str(&existing_text).unwrap_or_default();
    let (mut meta, _) = unwrap_sdoc(&existing);

    // Apply meta updates if provided
    if let Some(updates) = meta_updates {
        if let Some(title) = updates.get("title").and_then(|t| t.as_str()) {
            meta.title = title.to_string();
        }
        if let Some(author) = updates.get("author").and_then(|a| a.as_str()) {
            meta.author = author.to_string();
        }
        if let Some(version) = updates.get("version").and_then(|v| v.as_str()) {
            meta.version = version.to_string();
        }
    }

    // Auto-extract title from first H1
    if let Some(title) = extract_title(&content) {
        meta.title = title;
    }

    // Update modified timestamp
    meta.modified = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    if meta.created.is_empty() {
        meta.created = meta.modified.clone();
    }

    // Process document
    let mut doc = content.clone();
    clean_text_nodes(&mut doc);
    assign_auto_ids(&mut doc);
    sync_cross_references(&mut doc);

    let envelope = wrap_sdoc(&meta, &doc);
    let json_str = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    fs::write(&path, json_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn new_document(path: String, state: tauri::State<DocState>) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&path);
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let meta = SdocMeta {
        title: String::new(),
        author: String::new(),
        version: "0.1".to_string(),
        created: now.clone(),
        modified: now,
    };
    let doc = serde_json::json!({
        "type": "doc",
        "content": [
            { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Untitled" }] },
            { "type": "paragraph" }
        ]
    });
    let envelope = wrap_sdoc(&meta, &doc);
    let json_str = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    fs::write(&path, json_str).map_err(|e| e.to_string())?;

    *state.file_path.lock().unwrap() = Some(path);

    Ok(serde_json::json!({
        "meta": meta,
        "doc": doc,
    }))
}

#[tauri::command]
pub fn get_current_file_path(state: tauri::State<DocState>) -> Option<String> {
    state.file_path.lock().unwrap().as_ref().map(|p| p.to_string_lossy().to_string())
}

// ─── Image Operations ───────────────────────────────────────────────

#[tauri::command]
pub fn save_image(
    image_name: String,
    image_data: String, // base64
    extension: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let images_dir = doc_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.{}", image_name, extension);
    let target = images_dir.join(&filename);

    let bytes = base64_decode(&image_data)?;
    fs::write(&target, bytes).map_err(|e| e.to_string())?;

    let relative_path = format!("./images/{}", filename);
    Ok(serde_json::json!({
        "imagePath": relative_path,
        "filePath": target.to_string_lossy(),
        "imageName": image_name,
    }))
}

#[tauri::command]
pub fn copy_image_to_doc(
    source_path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let images_dir = doc_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let filename = source.file_name().ok_or("No filename")?.to_string_lossy().to_string();

    // Deduplicate
    let target = deduplicate_path(&images_dir, &filename);
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    fs::copy(&source, &target).map_err(|e| e.to_string())?;

    let relative_path = format!("./images/{}", final_name);
    Ok(serde_json::json!({
        "imagePath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": final_name,
    }))
}

// ─── Draw.io Operations ─────────────────────────────────────────────

#[tauri::command]
pub fn create_drawio_file(
    file_name: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let drawio_dir = doc_dir.join("drawio");
    fs::create_dir_all(&drawio_dir).map_err(|e| e.to_string())?;

    let filename = if file_name.ends_with(".drawio.svg") {
        file_name.clone()
    } else {
        format!("{}.drawio.svg", file_name)
    };
    let target = drawio_dir.join(&filename);

    // Write empty SVG that draw.io can open
    let empty_svg = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="1px" height="1px" viewBox="-0.5 -0.5 1 1" content="&lt;mxfile&gt;&lt;diagram&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;"></svg>"#;
    fs::write(&target, empty_svg).map_err(|e| e.to_string())?;

    let relative_path = format!("./drawio/{}", filename);
    Ok(serde_json::json!({
        "drawioPath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": filename,
    }))
}

#[tauri::command]
pub fn open_drawio_external(path: String) -> Result<(), String> {
    // Try to open with draw.io desktop app
    let drawio_path = PathBuf::from(&path);
    if !drawio_path.exists() {
        return Err("Draw.io file not found".to_string());
    }

    // On Windows, try known draw.io desktop locations, then fallback to system default
    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var("PROGRAMFILES").unwrap_or_default();
        let candidates = vec![
            format!("{}\\draw.io\\draw.io.exe", program_files),
            format!("{}\\drawio\\drawio.exe", program_files),
        ];
        for candidate in &candidates {
            if Path::new(candidate).exists() {
                std::process::Command::new(candidate)
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    // Fallback: open with system default application
    open::that(&path).map_err(|e| format!(
        "Failed to open Draw.io file. Please install draw.io desktop app.\nError: {}", e
    ))
}

#[tauri::command]
pub fn copy_drawio_to_doc(
    source_path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let drawio_dir = doc_dir.join("drawio");
    fs::create_dir_all(&drawio_dir).map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let filename = source.file_name().ok_or("No filename")?.to_string_lossy().to_string();
    let target = deduplicate_path(&drawio_dir, &filename);
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    fs::copy(&source, &target).map_err(|e| e.to_string())?;

    let relative_path = format!("./drawio/{}", final_name);
    Ok(serde_json::json!({
        "drawioPath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": final_name,
    }))
}

// ─── File Watcher ───────────────────────────────────────────────────

#[tauri::command]
pub fn start_file_watcher(state: tauri::State<DocState>, app: AppHandle) -> Result<(), String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?.to_path_buf();
    let drawio_dir = doc_dir.join("drawio");

    if !drawio_dir.exists() {
        return Ok(()); // No drawio directory, nothing to watch
    }

    std::thread::spawn(move || {
        use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = RecommendedWatcher::new(tx, Config::default()).unwrap();
        watcher.watch(&drawio_dir, RecursiveMode::Recursive).ok();

        for event in rx {
            if let Ok(event) = event {
                match event.kind {
                    EventKind::Modify(_) | EventKind::Create(_) => {
                        for path in &event.paths {
                            if path.extension().and_then(|e| e.to_str()) == Some("svg") {
                                let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                                let relative_path = format!("./drawio/{}", filename);
                                let abs_path = path.to_string_lossy().to_string();
                                app.emit("drawio-file-updated", serde_json::json!({
                                    "relativePath": relative_path,
                                    "filePath": abs_path,
                                    "timestamp": chrono::Utc::now().timestamp_millis(),
                                })).ok();
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    });

    Ok(())
}

// ─── Settings ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: tauri::State<DocState>) -> serde_json::Value {
    let settings = state.settings.lock().unwrap();
    serde_json::to_value(&*settings).unwrap_or_default()
}

#[tauri::command]
pub fn get_editor_settings(state: tauri::State<DocState>) -> serde_json::Value {
    let settings = state.settings.lock().unwrap();
    to_editor_settings(&settings)
}

#[tauri::command]
pub fn update_settings(
    updates: serde_json::Value,
    state: tauri::State<DocState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    // Merge updates into current settings
    let mut current = serde_json::to_value(&*settings).map_err(|e| e.to_string())?;
    if let (Some(cur_obj), Some(upd_obj)) = (current.as_object_mut(), updates.as_object()) {
        for (key, value) in upd_obj {
            cur_obj.insert(key.clone(), value.clone());
        }
    }
    *settings = serde_json::from_value(current).map_err(|e| e.to_string())?;
    save_settings(&settings)?;

    // Notify webview of settings change
    app.emit("settings-changed", to_editor_settings(&settings)).ok();
    Ok(())
}

#[tauri::command]
pub fn get_recent_files(state: tauri::State<DocState>) -> Vec<String> {
    state.settings.lock().unwrap().recent_files.clone()
}

// ─── Export (delegated to frontend converters, just handles file I/O) ──

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

// ─── Utilities ──────────────────────────────────────────────────────

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    // Strip data URI prefix if present
    let pure = if let Some(pos) = data.find(",") {
        &data[pos + 1..]
    } else {
        data
    };

    // Simple base64 decode
    use std::io::Read;
    let decoded = pure
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();

    // Use a basic base64 decoder
    base64_decode_impl(&decoded)
}

fn base64_decode_impl(input: &str) -> Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in input.bytes() {
        if c == b'=' { break; }
        let val = match CHARS.iter().position(|&b| b == c) {
            Some(v) => v as u32,
            None => continue,
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(output)
}

fn deduplicate_path(dir: &Path, filename: &str) -> PathBuf {
    let target = dir.join(filename);
    if !target.exists() {
        return target;
    }
    let stem = Path::new(filename)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = Path::new(filename)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{}-{}{}", stem, n, ext));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}
