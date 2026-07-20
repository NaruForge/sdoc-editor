use crate::document::*;
use crate::settings::*;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};

mod assets;
mod file_io;
mod settings_commands;
mod watchers;
mod workspace;
pub use assets::*;
pub use file_io::*;
pub use settings_commands::*;
pub use watchers::*;
pub use workspace::*;

const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".svelte-kit",
];
const MAX_EXPLORER_DEPTH: usize = 6;
const MAX_RECENT_FOLDERS: usize = 10;
const MAX_RECENT_DELETIONS: usize = 20;

/// True if any path component matches one of `EXCLUDED_DIRS` (e.g. `.git`, `node_modules`).
/// Used to filter out filesystem-watcher noise from directories the explorer never shows.
pub(super) fn path_is_excluded(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .is_some_and(|name| EXCLUDED_DIRS.contains(&name))
    })
}

/// Record `folder` as the most recently used workspace folder, persisting it so the welcome
/// screen can offer a "recent workspaces" list (and restore the last one on next launch),
/// similar to VS Code's recent workspaces feature.
fn remember_recent_folder(state: &DocState, folder: &Path) {
    let mut settings = state.settings.lock().unwrap();
    let folder_str = folder.to_string_lossy().to_string();
    settings.recent_folders.retain(|f| f != &folder_str);
    settings.recent_folders.insert(0, folder_str);
    if settings.recent_folders.len() > MAX_RECENT_FOLDERS {
        settings.recent_folders.truncate(MAX_RECENT_FOLDERS);
    }
    save_settings(&settings).ok();
}

/// State for the currently open document.
pub struct DocState {
    pub file_path: std::sync::Mutex<Option<PathBuf>>,
    pub current_folder: std::sync::Mutex<Option<PathBuf>>,
    pub settings: std::sync::Mutex<AppSettings>,
    /// Root folder currently being watched by the workspace file watcher (see
    /// `start_workspace_watcher`). Used to avoid restarting the watcher thread when the
    /// same folder is requested again, and to let a stale watcher thread notice it should
    /// stop once a different folder becomes active.
    pub workspace_watch_root: std::sync::Mutex<Option<PathBuf>>,
    /// Incremented every time a new workspace watcher is started. A running watcher thread
    /// compares its own snapshot against the current value to detect it has been superseded
    /// by a newer watcher (e.g. after switching folders) and should stop.
    pub workspace_watch_generation: std::sync::atomic::AtomicU64,
    /// Stack of recently trashed items (most recent last), used to implement "undo delete".
    /// Only populated on platforms where `trash::os_limited` is available (Windows/Linux);
    /// on macOS this stays empty and undo is unavailable (files are still safely in the
    /// Trash and recoverable via Finder).
    pub recent_deletions: std::sync::Mutex<Vec<trash::TrashItem>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub depth: usize,
    /// True for `.sdoc`/`.tiptap.json` files that can be opened directly in the editor.
    /// Other files (images, drawio sources, etc.) are shown for browsing/context-menu actions
    /// but must be opened with the system's default application instead.
    pub is_document: bool,
}

// ─── File Operations ────────────────────────────────────────────────

#[tauri::command]
pub fn open_document(
    path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let (meta, doc) = unwrap_sdoc(&parsed);

    // Update state
    *state.file_path.lock().unwrap() = Some(path.clone());
    if let Some(parent) = path.parent() {
        *state.current_folder.lock().unwrap() = Some(parent.to_path_buf());
        remember_recent_folder(&state, parent);
    }

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
        "filePath": path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn save_document(
    content: Option<serde_json::Value>,
    meta_updates: Option<serde_json::Value>,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let path = file_path.ok_or("No file open")?;

    // Read existing file to get current meta
    let existing_text = fs::read_to_string(&path).unwrap_or_default();
    let existing: serde_json::Value = serde_json::from_str(&existing_text).unwrap_or_default();
    let (mut meta, existing_doc) = unwrap_sdoc(&existing);

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
        if updates.get("settings").is_some() {
            meta.settings = updates
                .get("settings")
                .cloned()
                .filter(|value| !value.is_null());
        }
    }

    // Update modified timestamp
    meta.modified = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    if meta.created.is_empty() {
        meta.created = meta.modified.clone();
    }

    // The shared TypeScript document core owns semantic normalization. Metadata-only
    // updates preserve the existing document instead of replacing it with JSON null.
    let doc = content
        .filter(|value| !value.is_null())
        .unwrap_or(existing_doc);

    let envelope = wrap_sdoc(&meta, &doc);
    let json_str = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    fs::write(&path, json_str).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "modified": meta.modified,
        "filePath": path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn new_document(
    path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let meta = SdocMeta {
        title: String::new(),
        author: String::new(),
        version: "0.1".to_string(),
        created: now.clone(),
        modified: now,
        settings: None,
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

    *state.file_path.lock().unwrap() = Some(path.clone());
    if let Some(parent) = path.parent() {
        *state.current_folder.lock().unwrap() = Some(parent.to_path_buf());
        remember_recent_folder(&state, parent);
    }

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
        "filePath": path.to_string_lossy(),
    }))
}

#[tauri::command]
pub fn get_current_file_path(state: tauri::State<DocState>) -> Option<String> {
    state
        .file_path
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}
