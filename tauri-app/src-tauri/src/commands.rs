use crate::document::*;
use crate::settings::*;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

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
fn path_is_excluded(path: &Path) -> bool {
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
    content: serde_json::Value,
    meta_updates: Option<serde_json::Value>,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
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
        if updates.get("settings").is_some() {
            meta.settings = updates
                .get("settings")
                .cloned()
                .filter(|value| !value.is_null());
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

#[tauri::command]
pub fn set_current_folder(path: String, state: tauri::State<DocState>) -> Result<(), String> {
    let folder = PathBuf::from(path);
    if !folder.is_dir() {
        return Err("선택한 경로가 폴더가 아닙니다.".to_string());
    }
    remember_recent_folder(&state, &folder);
    *state.current_folder.lock().unwrap() = Some(folder);
    Ok(())
}

#[tauri::command]
pub fn get_current_folder(state: tauri::State<DocState>) -> Option<String> {
    state
        .current_folder
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

/// Returns previously opened workspace folders (most recent first), skipping any that no
/// longer exist on disk so the welcome screen only offers folders that can actually be opened.
#[tauri::command]
pub fn get_recent_folders(state: tauri::State<DocState>) -> Vec<String> {
    let settings = state.settings.lock().unwrap();
    settings
        .recent_folders
        .iter()
        .filter(|f| Path::new(f).is_dir())
        .cloned()
        .collect()
}

#[tauri::command]
pub fn list_folder_documents(
    folder: Option<String>,
    state: tauri::State<DocState>,
) -> Result<Vec<ExplorerEntry>, String> {
    let root = match folder {
        Some(path) => PathBuf::from(path),
        None => state
            .current_folder
            .lock()
            .unwrap()
            .clone()
            .ok_or("현재 폴더가 선택되지 않았습니다.")?,
    };

    if !root.is_dir() {
        return Err("선택한 경로가 폴더가 아닙니다.".to_string());
    }

    let mut entries = Vec::new();
    collect_explorer_entries(&root, 0, &mut entries)?;
    Ok(entries)
}

#[tauri::command]
pub fn create_document_in_folder(
    folder: String,
    file_name: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let safe_name = sanitize_document_file_name(&file_name)?;
    let path = deduplicate_path(&PathBuf::from(folder), &safe_name);
    new_document(path.to_string_lossy().to_string(), state)
}

/// 탐색기의 파일/폴더 이름을 변경한다. 현재 열려 있는 문서를 이름 변경 대상으로
/// 포함하고 있으면 상태(file_path)와 최근 문서 목록도 함께 갱신한다.
#[tauri::command]
pub fn rename_entry(
    path: String,
    new_name: String,
    state: tauri::State<DocState>,
) -> Result<ExplorerEntry, String> {
    let old_path = PathBuf::from(&path);
    if !old_path.exists() {
        return Err("대상을 찾을 수 없습니다.".to_string());
    }
    let is_dir = old_path.is_dir();

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("이름을 입력하세요.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("이름에 경로 구분자를 사용할 수 없습니다.".to_string());
    }

    let final_name = if is_dir || trimmed.ends_with(".sdoc") || trimmed.ends_with(".tiptap.json") {
        trimmed.to_string()
    } else if is_document_path(&old_path) {
        // 원본 문서 파일의 확장자 스타일(.sdoc 또는 .tiptap.json)을 유지한다.
        let original_name = old_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if original_name.ends_with(".tiptap.json") {
            format!("{}.tiptap.json", trimmed)
        } else {
            format!("{}.sdoc", trimmed)
        }
    } else {
        // 문서가 아닌 파일(이미지, drawio 등)은 사용자가 입력한 이름을 그대로 사용하고,
        // 확장자가 없으면 원본 확장자를 유지한다.
        let original_ext = old_path.extension().and_then(|e| e.to_str());
        match original_ext {
            Some(ext)
                if !trimmed
                    .to_lowercase()
                    .ends_with(&format!(".{}", ext.to_lowercase())) =>
            {
                format!("{}.{}", trimmed, ext)
            }
            _ => trimmed.to_string(),
        }
    };

    let parent = old_path.parent().ok_or("상위 폴더를 찾을 수 없습니다.")?;
    let new_path = parent.join(&final_name);

    if new_path != old_path {
        if new_path.exists() {
            return Err("동일한 이름의 파일 또는 폴더가 이미 존재합니다.".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;

        // 현재 열려 있는 문서(또는 그 상위 폴더)를 이름 변경했다면 상태를 함께 갱신한다.
        {
            let mut file_path_guard = state.file_path.lock().unwrap();
            if let Some(current) = file_path_guard.clone() {
                if current == old_path {
                    *file_path_guard = Some(new_path.clone());
                } else if is_dir {
                    if let Ok(rel) = current.strip_prefix(&old_path) {
                        *file_path_guard = Some(new_path.join(rel));
                    }
                }
            }
        }
        {
            let mut settings = state.settings.lock().unwrap();
            let old_str = old_path.to_string_lossy().to_string();
            let new_str = new_path.to_string_lossy().to_string();
            for f in settings.recent_files.iter_mut() {
                if *f == old_str {
                    *f = new_str.clone();
                }
            }
            save_settings(&settings).ok();
        }
    }

    Ok(ExplorerEntry {
        name: final_name,
        path: new_path.to_string_lossy().to_string(),
        kind: if is_dir {
            "folder".to_string()
        } else {
            "file".to_string()
        },
        depth: 0,
        is_document: !is_dir && is_document_path(&new_path),
    })
}

/// 탐색기의 파일/폴더를 삭제한다. 영구 삭제 대신 OS 휴지통(Recycle Bin/Trash)으로 이동시켜
/// VS Code 탐색기의 "삭제"(휴지통으로 이동)와 동일한 안전망을 제공한다. 삭제 대상이 현재
/// 열려 있는 문서(또는 그 상위 폴더)라면 관련 상태를 정리해 저장 시 오류가 나지 않도록 한다.
#[tauri::command]
pub fn delete_entry(path: String, state: tauri::State<DocState>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("대상을 찾을 수 없습니다.".to_string());
    }

    // 삭제 직후 휴지통 목록에서 방금 만든 항목을 찾아내기 위한 기준 시각(약간의 여유를 둬
    // 시계 오차/초 단위 반올림으로 인해 방금 생성된 항목을 놓치지 않도록 한다).
    let since = Utc::now().timestamp() - 2;
    trash::delete(&target).map_err(|e| format!("휴지통으로 이동하지 못했습니다: {e}"))?;

    if let Some(item) = find_trash_item(&target, since) {
        let mut stack = state.recent_deletions.lock().unwrap();
        stack.push(item);
        if stack.len() > MAX_RECENT_DELETIONS {
            stack.remove(0);
        }
    }

    // 삭제한 파일(또는 그 하위)이 현재 열려 있는 문서였다면 file_path를 비워 저장 시
    // 존재하지 않는 경로에 덮어쓰려는 시도를 방지한다.
    {
        let mut file_path_guard = state.file_path.lock().unwrap();
        if let Some(current) = file_path_guard.clone() {
            if current == target || current.starts_with(&target) {
                *file_path_guard = None;
            }
        }
    }
    // 최근 문서 목록에서도 삭제된 경로(및 그 하위 문서)를 제거한다.
    {
        let mut settings = state.settings.lock().unwrap();
        let target_str = target.to_string_lossy().to_string();
        settings
            .recent_files
            .retain(|f| f != &target_str && !PathBuf::from(f).starts_with(&target));
        save_settings(&settings).ok();
    }

    Ok(())
}

/// 되돌릴 수 있는 삭제 내역(휴지통 이동 스택)이 하나라도 있는지 확인한다. 사이드바 우클릭
/// 메뉴의 "삭제 취소" 항목 활성화 여부를 판단하는 데 사용된다.
#[tauri::command]
pub fn has_recent_deletions(state: tauri::State<DocState>) -> bool {
    !state.recent_deletions.lock().unwrap().is_empty()
}

/// 가장 최근에 `delete_entry`로 삭제한 파일/폴더를 원래 위치로 복원한다("실행 취소").
/// 복원에 성공한 경우에만 스택에서 제거하므로, 충돌 등으로 복원이 실패하면 다시 시도할 수
/// 있도록 항목이 남아 있는다.
#[tauri::command]
pub fn undo_last_delete(state: tauri::State<DocState>) -> Result<String, String> {
    let item = {
        let stack = state.recent_deletions.lock().unwrap();
        stack
            .last()
            .cloned()
            .ok_or("되돌릴 삭제 내역이 없습니다.")?
    };
    let restored_path = item.original_path();
    restore_trash_item(item).map_err(|e| format!("복원하지 못했습니다: {e}"))?;
    state.recent_deletions.lock().unwrap().pop();
    Ok(restored_path.to_string_lossy().to_string())
}

/// `target`이 휴지통으로 이동된 직후, 그에 대응하는 `TrashItem`을 찾아낸다.
/// Windows와 Linux(freedesktop trash)에서만 지원되는 `trash::os_limited::list`에 의존하므로
/// macOS에서는 항상 `None`을 반환한다(파일은 여전히 Finder의 휴지통에서 복구 가능하지만,
/// 앱 내 "되돌리기"는 지원하지 않는다).
#[cfg(any(
    windows,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn find_trash_item(target: &Path, since: i64) -> Option<trash::TrashItem> {
    let name = target.file_name()?;
    let parent = target.parent()?.to_path_buf();
    trash::os_limited::list()
        .ok()?
        .into_iter()
        .filter(|item| {
            item.name == name && item.original_parent == parent && item.time_deleted >= since
        })
        .max_by_key(|item| item.time_deleted)
}

#[cfg(not(any(
    windows,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
)))]
fn find_trash_item(_target: &Path, _since: i64) -> Option<trash::TrashItem> {
    None
}

#[cfg(any(
    windows,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn restore_trash_item(item: trash::TrashItem) -> Result<(), trash::Error> {
    trash::os_limited::restore_all(vec![item])
}

#[cfg(not(any(
    windows,
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
)))]
fn restore_trash_item(_item: trash::TrashItem) -> Result<(), trash::Error> {
    Err(trash::Error::Unknown {
        description: "이 플랫폼에서는 삭제 되돌리기가 지원되지 않습니다.".to_string(),
    })
}

/// 지정된 상위 폴더 아래에 새 폴더를 생성한다. 동일 이름이 있으면 오류를 반환한다.
#[tauri::command]
pub fn create_folder(parent: String, folder_name: String) -> Result<ExplorerEntry, String> {
    let trimmed = folder_name.trim();
    if trimmed.is_empty() {
        return Err("폴더 이름을 입력하세요.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("폴더 이름에 경로 구분자를 사용할 수 없습니다.".to_string());
    }
    let parent_path = PathBuf::from(parent);
    if !parent_path.is_dir() {
        return Err("상위 폴더를 찾을 수 없습니다.".to_string());
    }
    let target = parent_path.join(trimmed);
    if target.exists() {
        return Err("동일한 이름의 파일 또는 폴더가 이미 존재합니다.".to_string());
    }
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    Ok(ExplorerEntry {
        name: trimmed.to_string(),
        path: target.to_string_lossy().to_string(),
        kind: "folder".to_string(),
        depth: 0,
        is_document: false,
    })
}

/// 지정된 파일/폴더를 OS 파일 탐색기에서 선택된 상태로 연다(Windows: 탐색기, macOS: Finder).
/// 지원하지 않는 플랫폼에서는 상위 폴더를 여는 것으로 대체한다.
#[tauri::command]
pub fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("대상을 찾을 수 없습니다.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let folder = if target.is_dir() {
            target.as_path()
        } else {
            target.parent().unwrap_or(&target)
        };
        open::that(folder).map_err(|e| e.to_string())?;
        Ok(())
    }
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
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();

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
    open::that(&path).map_err(|e| {
        format!(
            "Failed to open Draw.io file. Please install draw.io desktop app.\nError: {}",
            e
        )
    })
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
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();
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
        use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = RecommendedWatcher::new(tx, Config::default()).unwrap();
        watcher.watch(&drawio_dir, RecursiveMode::Recursive).ok();

        for event in rx.into_iter().flatten() {
            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) => {
                    for path in &event.paths {
                        if path.extension().and_then(|e| e.to_str()) == Some("svg") {
                            let filename = path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let relative_path = format!("./drawio/{}", filename);
                            let abs_path = path.to_string_lossy().to_string();
                            app.emit(
                                "drawio-file-updated",
                                serde_json::json!({
                                    "relativePath": relative_path,
                                    "filePath": abs_path,
                                    "timestamp": chrono::Utc::now().timestamp_millis(),
                                }),
                            )
                            .ok();
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Watch `folder` recursively and emit a debounced `workspace-changed` event whenever files or
/// subfolders are created, removed, or renamed anywhere inside it. This lets the sidebar
/// explorer refresh itself automatically — including changes made by external tools (e.g. the
/// draw.io desktop app saving a `.drawio.svg`, or files added/deleted in Explorer/Finder) —
/// without requiring the user to press the manual refresh button, matching VS Code's behavior.
///
/// Calling this again with the same `folder` is a cheap no-op. Calling it with a different
/// folder stops the previous watcher thread (it notices the generation counter changed on its
/// next poll and exits, dropping its `notify::Watcher`) and starts a new one for the new root.
#[tauri::command]
pub fn start_workspace_watcher(
    folder: String,
    state: tauri::State<DocState>,
    app: AppHandle,
) -> Result<(), String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err("선택한 경로가 폴더가 아닙니다.".to_string());
    }

    {
        let mut watched_root = state.workspace_watch_root.lock().unwrap();
        if watched_root.as_deref() == Some(root.as_path()) {
            return Ok(()); // Already watching this exact folder — nothing to do.
        }
        *watched_root = Some(root.clone());
    }
    let my_generation = state
        .workspace_watch_generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    std::thread::spawn(move || {
        use notify::event::ModifyKind;
        use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
        use std::sync::atomic::Ordering;
        use std::sync::mpsc::{self, RecvTimeoutError};
        use std::time::{Duration, Instant};

        const POLL_INTERVAL: Duration = Duration::from_millis(300);
        const DEBOUNCE: Duration = Duration::from_millis(400);

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create workspace watcher: {e}");
                return;
            }
        };
        if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
            return;
        }

        let mut dirty = false;
        let mut last_change = Instant::now();

        loop {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(Ok(event)) => {
                    let is_structural = matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(ModifyKind::Name(_))
                    );
                    let is_relevant =
                        is_structural && event.paths.iter().any(|p| !path_is_excluded(p));
                    if is_relevant {
                        dirty = true;
                        last_change = Instant::now();
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Workspace watcher error: {e}");
                }
                Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {}
            }

            // A newer watcher has taken over (folder switched) — stop and drop this one.
            if app
                .state::<DocState>()
                .workspace_watch_generation
                .load(Ordering::SeqCst)
                != my_generation
            {
                break;
            }

            if dirty && last_change.elapsed() >= DEBOUNCE {
                app.emit(
                    "workspace-changed",
                    serde_json::json!({
                        "folder": root.to_string_lossy(),
                    }),
                )
                .ok();
                dirty = false;
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
    app.emit("settings-changed", to_editor_settings(&settings))
        .ok();
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

// ─── Utilities ──────────────────────────────────────────────────────

fn collect_explorer_entries(
    folder: &Path,
    depth: usize,
    entries: &mut Vec<ExplorerEntry>,
) -> Result<(), String> {
    if depth > MAX_EXPLORER_DEPTH {
        return Ok(());
    }

    let mut children = fs::read_dir(folder)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    // VS Code Explorer 정렬 규칙: 폴더가 파일보다 먼저, 각각 대소문자 구분 없이 이름순.
    children.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase()),
        }
    });

    for child in children {
        let path = child.path();
        let name = child.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if EXCLUDED_DIRS.contains(&name.as_str()) {
                continue;
            }
            entries.push(ExplorerEntry {
                name,
                path: path.to_string_lossy().to_string(),
                kind: "folder".to_string(),
                depth,
                is_document: false,
            });
            collect_explorer_entries(&path, depth + 1, entries)?;
        } else {
            // 확장자와 무관하게 모든 파일을 표시한다(이미지, drawio 등). 편집기에서 바로 열 수
            // 있는 문서(.sdoc/.tiptap.json)인지 여부는 `is_document`로 프론트엔드에 전달한다.
            entries.push(ExplorerEntry {
                name,
                path: path.to_string_lossy().to_string(),
                kind: "file".to_string(),
                depth,
                is_document: is_document_path(&path),
            });
        }
    }

    Ok(())
}

fn is_document_path(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    path.extension().and_then(|ext| ext.to_str()) == Some("sdoc")
        || file_name.ends_with(".tiptap.json")
}

fn sanitize_document_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("파일 이름을 입력하세요.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("파일 이름에 경로 구분자를 사용할 수 없습니다.".to_string());
    }
    if trimmed.ends_with(".sdoc") || trimmed.ends_with(".tiptap.json") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{}.sdoc", trimmed))
    }
}

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    // Strip data URI prefix if present
    let pure = if let Some(pos) = data.find(",") {
        &data[pos + 1..]
    } else {
        data
    };

    // Simple base64 decode
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
        if c == b'=' {
            break;
        }
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
