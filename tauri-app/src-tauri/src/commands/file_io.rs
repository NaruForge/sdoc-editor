use super::{
    assets::{canonical_asset_path, validate_plain_basename},
    DocState,
};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const IMPORT_EXTENSIONS: &[&str] = &[
    "sdoc", "json", "md", "markdown", "html", "htm", "css", "adoc", "asciidoc",
];
const EXPORT_EXTENSIONS: &[&str] = &["html", "htm", "md", "markdown", "adoc", "asciidoc"];
const DOCUMENT_RELATIVE_EXTENSIONS: &[&str] = &["sdoc", "json", "css"];

fn lowercase_extension(path: &Path) -> Result<String, String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "File path is missing a supported extension".into())
}

pub(super) fn validate_import_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err("Import path must be a regular file".into());
    }
    let extension = lowercase_extension(&canonical)?;
    if !IMPORT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported import extension: {extension}"));
    }
    Ok(canonical)
}

pub(super) fn validate_export_path(path: &Path) -> Result<PathBuf, String> {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Export path must have a Unicode file name")?;
    validate_plain_basename(filename)?;
    let extension = lowercase_extension(path)?;
    if !EXPORT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Unsupported export extension: {extension}"));
    }
    let parent = path.parent().ok_or("Export path has no parent directory")?;
    let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_parent.is_dir() {
        return Err("Export parent must be a directory".into());
    }
    Ok(canonical_parent.join(filename))
}

pub(super) fn resolve_document_path(
    doc_path: &Path,
    workspace_root: Option<&Path>,
    input: &str,
) -> Result<PathBuf, String> {
    let input = Path::new(input);
    if input.is_absolute() {
        return Err("Document settings cannot grant access to an absolute path".into());
    }
    let candidate = doc_path
        .parent()
        .ok_or("Invalid document path")?
        .join(input);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err("Resolved document path must be a regular file".into());
    }
    let extension = lowercase_extension(&canonical)?;
    if !DOCUMENT_RELATIVE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "Unsupported document-relative extension: {extension}"
        ));
    }
    let root = workspace_root
        .or_else(|| doc_path.parent())
        .ok_or("Document path has no parent directory")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("Relative path escapes the current workspace".into());
    }
    Ok(canonical)
}

#[tauri::command]
pub fn write_export_file(path: String, content: String) -> Result<(), String> {
    let path = validate_export_path(Path::new(&path))?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_import_file(path: String) -> Result<String, String> {
    let path = validate_import_path(Path::new(&path))?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// ─── Resolve file path for asset protocol ───────────────────────────

#[tauri::command]
pub fn resolve_asset_path(
    relative_path: String,
    state: tauri::State<DocState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let path = canonical_asset_path(&doc_path, &relative_path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resolve_document_relative_path(
    path: String,
    state: tauri::State<DocState>,
) -> Result<String, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let workspace_root = state.current_folder.lock().unwrap().clone();
    resolve_document_path(&doc_path, workspace_root.as_deref(), &path)
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod security_tests {
    use super::{resolve_document_path, validate_export_path, validate_import_path};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sdoc-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn import_reads_only_regular_supported_text_files() {
        let root = temp_dir("imports");
        let markdown = root.join("input.md");
        let executable = root.join("input.exe");
        fs::write(&markdown, "# Safe").unwrap();
        fs::write(&executable, "not text").unwrap();

        assert!(validate_import_path(&markdown).is_ok());
        assert!(validate_import_path(&executable).is_err());
        assert!(validate_import_path(&root).is_err());
        assert!(validate_import_path(&root.join("missing.md")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_writes_only_supported_document_formats() {
        let root = temp_dir("exports");
        assert!(validate_export_path(&root.join("output.html")).is_ok());
        assert!(validate_export_path(&root.join("output.md")).is_ok());
        assert!(validate_export_path(&root.join("output.adoc")).is_ok());
        assert!(validate_export_path(&root.join("output.exe")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relative_document_paths_cannot_escape_the_workspace() {
        let root = temp_dir("document-paths");
        let workspace = root.join("workspace");
        let chapter_dir = workspace.join("chapters");
        fs::create_dir_all(&chapter_dir).unwrap();
        let doc = chapter_dir.join("chapter.sdoc");
        let sibling = workspace.join("shared.sdoc");
        let outside = root.join("outside.sdoc");
        fs::write(&doc, "{}").unwrap();
        fs::write(&sibling, "{}").unwrap();
        fs::write(&outside, "{}").unwrap();

        assert_eq!(
            resolve_document_path(&doc, Some(&workspace), "../shared.sdoc").unwrap(),
            sibling.canonicalize().unwrap()
        );
        assert!(resolve_document_path(&doc, Some(&workspace), "../../outside.sdoc").is_err());
        assert!(resolve_document_path(&doc, Some(&workspace), &outside.to_string_lossy()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
