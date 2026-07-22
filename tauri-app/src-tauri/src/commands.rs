use crate::atomic_write::{atomic_create_new, atomic_write};
use crate::document::*;
use crate::settings::*;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

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
    pub document_id: std::sync::Mutex<Option<String>>,
    pub document_revision: std::sync::Mutex<u64>,
    /// Exact source last opened or written by this process, used to detect external edits.
    pub document_source_text: std::sync::Mutex<Option<String>>,
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
    /// Supersedes the Draw.io watcher whenever the active document changes.
    pub drawio_watch_generation: std::sync::atomic::AtomicU64,
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

fn validate_save_request(
    active_document_id: Option<&str>,
    active_revision: u64,
    document_id: &str,
    revision: u64,
) -> Result<(), String> {
    if active_document_id != Some(document_id) {
        return Err("Save rejected: document identity does not match the active document".into());
    }
    if revision != active_revision {
        return Err(format!(
            "Save rejected: stale revision {revision}; expected {active_revision}"
        ));
    }
    Ok(())
}

fn validate_unchanged_source(expected: Option<&str>, current: &str) -> Result<(), String> {
    if expected.is_some_and(|source| source != current) {
        return Err(
            "Save rejected: the document was modified outside Structured Doc Editor".into(),
        );
    }
    Ok(())
}

fn current_workspace_contains(current_folder: Option<&Path>, canonical_target: &Path) -> bool {
    current_folder
        .and_then(|folder| folder.canonicalize().ok())
        .is_some_and(|folder| canonical_target.starts_with(folder))
}

fn validate_persisted_document(value: &serde_json::Value) -> Result<(), String> {
    fn migrate_legacy_attrs(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                if let Some(attrs) = map.get_mut("attrs").and_then(|entry| entry.as_object_mut()) {
                    for (legacy, canonical) in [
                        ("data-caption", "caption"),
                        ("data-align", "align"),
                        ("data-width", "width"),
                    ] {
                        if let Some(entry) = attrs.remove(legacy) {
                            attrs.insert(canonical.to_string(), entry);
                        }
                    }
                }
                for child in map.values_mut() {
                    migrate_legacy_attrs(child);
                }
            }
            serde_json::Value::Array(values) => {
                for child in values {
                    migrate_legacy_attrs(child);
                }
            }
            _ => {}
        }
    }

    let mut candidate = if value.get("type").and_then(|entry| entry.as_str()) == Some("doc") {
        serde_json::json!({ "sdoc": "1.0", "meta": {}, "doc": value })
    } else {
        let version = value
            .get("sdoc")
            .and_then(|entry| entry.as_str())
            .ok_or("Malformed document: missing sdoc version")?;
        if version != "1.0" {
            return Err(format!("Unsupported document version: {version}"));
        }
        let mut candidate = value.clone();
        if let Some(object) = candidate.as_object_mut() {
            object
                .entry("meta".to_string())
                .or_insert_with(|| serde_json::json!({}));
        }
        candidate
    };
    migrate_legacy_attrs(&mut candidate);
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = VALIDATOR.get_or_init(|| {
        let schema: serde_json::Value =
            serde_json::from_str(include_str!("../../../sdoc.schema.json"))
                .expect("bundled sdoc schema must be valid JSON");
        jsonschema::validator_for(&schema).expect("bundled sdoc schema must compile")
    });
    match validator.validate(&candidate) {
        Ok(()) => Ok(()),
        Err(error) => Err(format!(
            "Malformed document at {}: {}",
            error.instance_path, error
        )),
    }
}

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
    validate_persisted_document(&parsed)?;
    let (meta, doc) = unwrap_sdoc(&parsed);

    // Update state
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    let document_id = canonical_path.to_string_lossy().to_string();
    *state.file_path.lock().unwrap() = Some(canonical_path.clone());
    *state.document_id.lock().unwrap() = Some(document_id.clone());
    *state.document_revision.lock().unwrap() = 0;
    *state.document_source_text.lock().unwrap() = Some(text);
    if let Some(parent) = canonical_path.parent() {
        let mut current_folder = state.current_folder.lock().unwrap();
        let keep_workspace = current_workspace_contains(current_folder.as_deref(), &canonical_path);
        if !keep_workspace {
            *current_folder = Some(parent.to_path_buf());
            remember_recent_folder(&state, parent);
        }
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
        "filePath": canonical_path.to_string_lossy(),
        "documentId": document_id,
        "revision": 0,
    }))
}

#[tauri::command]
pub fn save_document(
    content: Option<serde_json::Value>,
    meta_updates: Option<serde_json::Value>,
    document_id: String,
    revision: u64,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let active_document_id = state.document_id.lock().unwrap().clone();
    let mut active_revision = state.document_revision.lock().unwrap();
    validate_save_request(
        active_document_id.as_deref(),
        *active_revision,
        &document_id,
        revision,
    )?;
    let file_path = state.file_path.lock().unwrap().clone();
    let path = file_path.ok_or("No file open")?;

    // Read existing file to get current meta
    let existing_text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let expected_source = state.document_source_text.lock().unwrap().clone();
    validate_unchanged_source(expected_source.as_deref(), &existing_text)?;
    let existing: serde_json::Value =
        serde_json::from_str(&existing_text).map_err(|e| e.to_string())?;
    validate_persisted_document(&existing)?;
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
    let envelope_value = serde_json::to_value(&envelope).map_err(|e| e.to_string())?;
    validate_persisted_document(&envelope_value)?;
    let json_str = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    atomic_write(&path, json_str.as_bytes())?;
    *state.document_source_text.lock().unwrap() = Some(json_str);
    *active_revision += 1;

    Ok(serde_json::json!({
        "modified": meta.modified,
        "filePath": path.to_string_lossy(),
        "documentId": document_id,
        "revision": *active_revision,
    }))
}

#[tauri::command]
pub fn new_document(
    path: String,
    envelope: serde_json::Value,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    create_document_at(&PathBuf::from(path), &envelope, &state)
}

pub(super) fn create_document_at(
    path: &Path,
    envelope: &serde_json::Value,
    state: &DocState,
) -> Result<serde_json::Value, String> {
    validate_new_document_target(path)?;
    if envelope.get("sdoc").and_then(|value| value.as_str()) != Some("1.0")
        || envelope.get("meta").is_none()
        || envelope.get("doc").is_none()
    {
        return Err("New document creation requires a complete SDOC 1.0 envelope".to_string());
    }
    validate_persisted_document(envelope)?;
    let (meta, doc) = unwrap_sdoc(envelope);
    let json_str = serde_json::to_string_pretty(envelope).map_err(|e| e.to_string())?;
    atomic_create_new(path, json_str.as_bytes())?;

    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    let document_id = canonical_path.to_string_lossy().to_string();
    *state.file_path.lock().unwrap() = Some(canonical_path.clone());
    *state.document_id.lock().unwrap() = Some(document_id.clone());
    *state.document_revision.lock().unwrap() = 0;
    *state.document_source_text.lock().unwrap() = Some(json_str);
    if let Some(parent) = canonical_path.parent() {
        let mut current_folder = state.current_folder.lock().unwrap();
        let keep_workspace = current_workspace_contains(current_folder.as_deref(), &canonical_path);
        if !keep_workspace {
            *current_folder = Some(parent.to_path_buf());
            remember_recent_folder(state, parent);
        }
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
        "filePath": canonical_path.to_string_lossy(),
        "documentId": document_id,
        "revision": 0,
    }))
}

fn validate_new_document_target(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Err(format!("A file already exists at {}", path.display()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "The document path has no parent folder".to_string())?;
    if !parent.is_dir() {
        return Err(format!(
            "The parent folder does not exist: {}",
            parent.display()
        ));
    }
    let extension_is_sdoc = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sdoc"));
    if !extension_is_sdoc {
        return Err("New documents must use the .sdoc extension".to_string());
    }
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    let canonical_target = canonical_parent.join(
        path.file_name()
            .ok_or_else(|| "The document path has no filename".to_string())?,
    );
    let components = canonical_target
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    if components.windows(2).any(|pair| {
        pair[0].eq_ignore_ascii_case(".sdoc") && pair[1].eq_ignore_ascii_case("templates")
    }) {
        return Err("Documents cannot be created inside .sdoc/templates".to_string());
    }
    Ok(())
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

#[cfg(test)]
mod persistence_tests {
    use super::{
        current_workspace_contains, validate_new_document_target, validate_persisted_document,
        validate_save_request, validate_unchanged_source,
    };

    #[test]
    fn rejects_a_delayed_save_for_another_document() {
        let error = validate_save_request(Some("document-b"), 0, "document-a", 0).unwrap_err();
        assert!(error.contains("identity"));
    }

    #[test]
    fn rejects_a_stale_revision() {
        let error = validate_save_request(Some("document-a"), 4, "document-a", 3).unwrap_err();
        assert!(error.contains("stale revision"));
    }

    #[test]
    fn rejects_an_external_edit_before_overwriting_it() {
        let error =
            validate_unchanged_source(Some("opened source"), "externally changed").unwrap_err();
        assert!(error.contains("modified outside"));
        assert!(validate_unchanged_source(Some("same"), "same").is_ok());
    }

    #[test]
    fn rejects_malformed_and_future_documents() {
        assert!(validate_persisted_document(&serde_json::json!({ "unexpected": true })).is_err());
        assert!(validate_persisted_document(&serde_json::json!({
            "sdoc": "2.0", "meta": {}, "doc": { "type": "doc", "content": [] }
        }))
        .unwrap_err()
        .contains("Unsupported"));
        assert!(validate_persisted_document(&serde_json::json!({
            "sdoc": "1.0", "meta": { "title": 42 },
            "doc": { "type": "doc", "content": [] }
        }))
        .is_err());
        assert!(validate_persisted_document(&serde_json::json!({
            "sdoc": "1.0", "meta": {},
            "doc": { "type": "doc", "content": [{ "type": "unknownBlock" }] }
        }))
        .is_err());
        assert!(validate_persisted_document(&serde_json::json!({
            "sdoc": "1.0", "meta": { "title": 42 },
            "doc": { "type": "doc", "content": [{
                "type": "image", "attrs": { "src": "images/a.png", "data-caption": "A" }
            }] }
        }))
        .is_err());
        assert!(validate_persisted_document(&serde_json::json!({
            "type": "doc", "content": [{ "type": "unknownBlock" }]
        }))
        .is_err());
    }

    #[test]
    fn validates_legacy_attributes_only_after_exact_migration() {
        assert!(validate_persisted_document(&serde_json::json!({
            "type": "doc", "content": [{
                "type": "image", "attrs": { "src": "images/a.png", "data-caption": "A" }
            }]
        }))
        .is_ok());
    }

    #[test]
    fn rejects_existing_and_template_folder_targets() {
        let root = std::env::temp_dir().join(format!("sdoc-new-target-{}", std::process::id()));
        let template_root = root.join(".sdoc").join("templates");
        std::fs::create_dir_all(&template_root).unwrap();
        let existing = root.join("existing.sdoc");
        std::fs::write(&existing, b"existing").unwrap();

        assert!(validate_new_document_target(&existing).is_err());
        assert!(validate_new_document_target(&template_root.join("new.sdoc")).is_err());
        assert!(validate_new_document_target(&root.join("new.txt")).is_err());
        assert!(validate_new_document_target(&root.join("new.sdoc")).is_ok());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_the_workspace_root_when_a_document_is_created_in_a_subfolder() {
        let root = std::env::temp_dir().join(format!("sdoc-workspace-root-{}", std::process::id()));
        let workspace = root.join("workspace");
        let chapter = workspace.join("chapters");
        let sibling = root.join("outside");
        std::fs::create_dir_all(&chapter).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let canonical_chapter = chapter.canonicalize().unwrap();
        let canonical_sibling = sibling.canonicalize().unwrap();

        assert!(current_workspace_contains(
            Some(&workspace),
            &canonical_chapter.join("new.sdoc")
        ));
        assert!(!current_workspace_contains(
            Some(&workspace),
            &canonical_sibling.join("new.sdoc")
        ));

        std::fs::remove_dir_all(root).unwrap();
    }
}
