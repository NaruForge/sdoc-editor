use super::{
    create_document_at, remember_recent_folder, DocState, ExplorerEntry, EXCLUDED_DIRS,
    MAX_EXPLORER_DEPTH, MAX_RECENT_DELETIONS,
};
use crate::settings::save_settings;
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_WORKSPACE_TEMPLATES: usize = 100;
const MAX_TEMPLATE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplateCandidate {
    pub id: String,
    pub source_label: String,
    pub file_name: String,
    pub path: String,
    pub raw_source: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplateDiagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplateDiscovery {
    pub candidates: Vec<WorkspaceTemplateCandidate>,
    pub diagnostics: Vec<WorkspaceTemplateDiagnostic>,
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
    envelope: serde_json::Value,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let safe_name = sanitize_document_file_name(&file_name)?;
    let workspace = state
        .current_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No workspace folder is open".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let target_folder = PathBuf::from(folder)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !target_folder.starts_with(&workspace) {
        return Err("The target folder is outside the current workspace".to_string());
    }
    create_document_at(&target_folder.join(safe_name), &envelope, &state)
}

#[tauri::command]
pub fn list_workspace_template_candidates(
    state: tauri::State<DocState>,
) -> Result<WorkspaceTemplateDiscovery, String> {
    let workspace = state
        .current_folder
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No workspace folder is open".to_string())?;
    discover_workspace_template_candidates(&workspace)
}

fn template_diagnostic(
    code: &str,
    path: &Path,
    message: impl Into<String>,
) -> WorkspaceTemplateDiagnostic {
    WorkspaceTemplateDiagnostic {
        code: code.to_string(),
        path: path.to_string_lossy().to_string(),
        message: message.into(),
    }
}

fn discover_workspace_template_candidates(
    workspace_folder: &Path,
) -> Result<WorkspaceTemplateDiscovery, String> {
    let workspace = workspace_folder
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !workspace.is_dir() {
        return Err("The workspace path is not a folder".to_string());
    }
    let source_label = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace")
        .to_string();
    let template_path = workspace.join(".sdoc").join("templates");
    if !template_path.exists() {
        return Ok(WorkspaceTemplateDiscovery {
            candidates: Vec::new(),
            diagnostics: Vec::new(),
        });
    }

    let mut diagnostics = Vec::new();
    let template_root = match template_path.canonicalize() {
        Ok(path) if path.starts_with(&workspace) && path.is_dir() => path,
        Ok(path) => {
            diagnostics.push(template_diagnostic(
                "template-root-outside-workspace",
                &template_path,
                format!(
                    "Template root resolves outside the workspace: {}",
                    path.display()
                ),
            ));
            return Ok(WorkspaceTemplateDiscovery {
                candidates: Vec::new(),
                diagnostics,
            });
        }
        Err(error) => {
            diagnostics.push(template_diagnostic(
                "template-root-unreadable",
                &template_path,
                error.to_string(),
            ));
            return Ok(WorkspaceTemplateDiscovery {
                candidates: Vec::new(),
                diagnostics,
            });
        }
    };

    let mut entries = Vec::new();
    for entry_result in fs::read_dir(&template_root).map_err(|error| error.to_string())? {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                diagnostics.push(template_diagnostic(
                    "template-unreadable",
                    &template_root,
                    error.to_string(),
                ));
                continue;
            }
        };
        if entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sdoc"))
        {
            entries.push(entry);
        }
    }
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    let mut candidates = Vec::new();
    for (index, entry) in entries.into_iter().enumerate() {
        let path = entry.path();
        if index >= MAX_WORKSPACE_TEMPLATES {
            diagnostics.push(template_diagnostic(
                "template-limit-exceeded",
                &path,
                format!("Only the first {MAX_WORKSPACE_TEMPLATES} templates are loaded"),
            ));
            break;
        }
        let canonical = match path.canonicalize() {
            Ok(path) if path.starts_with(&template_root) && path.starts_with(&workspace) => path,
            Ok(path) => {
                diagnostics.push(template_diagnostic(
                    "template-outside-workspace",
                    &entry.path(),
                    format!(
                        "Template resolves outside the workspace: {}",
                        path.display()
                    ),
                ));
                continue;
            }
            Err(error) => {
                diagnostics.push(template_diagnostic(
                    "template-unreadable",
                    &path,
                    error.to_string(),
                ));
                continue;
            }
        };
        let metadata = match canonical.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                diagnostics.push(template_diagnostic(
                    "template-not-file",
                    &path,
                    "Template candidate is not a regular file",
                ));
                continue;
            }
            Err(error) => {
                diagnostics.push(template_diagnostic(
                    "template-unreadable",
                    &path,
                    error.to_string(),
                ));
                continue;
            }
        };
        if metadata.len() > MAX_TEMPLATE_BYTES {
            diagnostics.push(template_diagnostic(
                "template-too-large",
                &path,
                format!("Template exceeds the {MAX_TEMPLATE_BYTES} byte limit"),
            ));
            continue;
        }
        let raw_source = match fs::read_to_string(&canonical) {
            Ok(source) => source,
            Err(error) => {
                diagnostics.push(template_diagnostic(
                    "template-unreadable",
                    &path,
                    error.to_string(),
                ));
                continue;
            }
        };
        let relative_path = canonical
            .strip_prefix(&workspace)
            .expect("validated workspace containment")
            .to_string_lossy()
            .replace('\\', "/");
        let file_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        candidates.push(WorkspaceTemplateCandidate {
            id: format!(
                "workspace:{}:{}",
                workspace.to_string_lossy(),
                relative_path
            ),
            source_label: source_label.clone(),
            file_name,
            path: canonical.to_string_lossy().to_string(),
            raw_source,
        });
    }

    Ok(WorkspaceTemplateDiscovery {
        candidates,
        diagnostics,
    })
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
    if trimmed.to_lowercase().ends_with(".sdoc") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{}.sdoc", trimmed))
    }
}

#[cfg(test)]
mod template_tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sdoc-template-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".sdoc").join("templates")).unwrap();
        root
    }

    #[test]
    fn discovers_only_direct_regular_sdoc_files_in_stable_order() {
        let root = temp_workspace("discovery");
        let templates = root.join(".sdoc").join("templates");
        fs::write(templates.join("B.sdoc"), "{\"b\":true}").unwrap();
        fs::write(templates.join("a.sdoc"), "{\"a\":true}").unwrap();
        fs::write(templates.join("ignored.json"), "{}").unwrap();
        fs::create_dir(templates.join("nested")).unwrap();
        fs::write(templates.join("nested").join("hidden.sdoc"), "{}").unwrap();

        let result = discover_workspace_template_candidates(&root).unwrap();

        assert_eq!(
            result
                .candidates
                .iter()
                .map(|candidate| candidate.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["a.sdoc", "B.sdoc"]
        );
        assert!(result.diagnostics.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_oversized_templates_without_hiding_valid_candidates() {
        let root = temp_workspace("oversize");
        let templates = root.join(".sdoc").join("templates");
        fs::write(templates.join("valid.sdoc"), "{}").unwrap();
        let oversized = fs::File::create(templates.join("oversized.sdoc")).unwrap();
        oversized.set_len(MAX_TEMPLATE_BYTES + 1).unwrap();

        let result = discover_workspace_template_candidates(&root).unwrap();

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "template-too-large");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_template_symlink_that_escapes_the_workspace_when_supported() {
        let root = temp_workspace("symlink");
        let outside = root.with_extension("outside.sdoc");
        fs::write(&outside, "{}").unwrap();
        let link = root.join(".sdoc").join("templates").join("escape.sdoc");

        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link).is_ok();

        if linked {
            let result = discover_workspace_template_candidates(&root).unwrap();
            assert!(result.candidates.is_empty());
            assert_eq!(result.diagnostics[0].code, "template-outside-workspace");
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
