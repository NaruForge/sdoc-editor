use super::{path_is_excluded, DocState};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub fn stop_file_watcher(state: tauri::State<DocState>) -> Result<(), String> {
    state
        .drawio_watch_generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn start_file_watcher(state: tauri::State<DocState>, app: AppHandle) -> Result<(), String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let doc_dir = doc_path.parent().ok_or("Invalid path")?.to_path_buf();
    let document_id = state
        .document_id
        .lock()
        .unwrap()
        .clone()
        .ok_or("No document identity")?;
    let generation = state
        .drawio_watch_generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    std::thread::spawn(move || {
        use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
        use std::collections::HashMap;
        use std::sync::atomic::Ordering;
        use std::sync::mpsc::{self, RecvTimeoutError};
        use std::time::{Duration, Instant};

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("Failed to create Draw.io watcher: {error}");
                return;
            }
        };
        // Watch the document root cheaply so a drawio folder created later is observed.
        if watcher
            .watch(&doc_dir, RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }
        let drawio_dir = doc_dir.join("drawio");
        if let Some(canonical_drawio) = canonical_drawio_directory(&doc_dir, &drawio_dir) {
            watcher
                .watch(&canonical_drawio, RecursiveMode::Recursive)
                .ok();
        }
        let mut pending = HashMap::<String, (PathBuf, Instant)>::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(75)) {
                Ok(Ok(event))
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) =>
                {
                    for event_path in event.paths {
                        if event_path.is_dir()
                            && event_path.file_name().is_some_and(|name| {
                                name.to_string_lossy().eq_ignore_ascii_case("drawio")
                            })
                        {
                            if let Some(canonical_drawio) =
                                canonical_drawio_directory(&doc_dir, &event_path)
                            {
                                watcher
                                    .watch(&canonical_drawio, RecursiveMode::Recursive)
                                    .ok();
                            }
                            continue;
                        }
                        if let Some(relative_path) =
                            canonical_drawio_relative_path(&doc_dir, &event_path)
                        {
                            pending.insert(
                                relative_path.to_ascii_lowercase(),
                                (event_path, Instant::now()),
                            );
                        }
                    }
                }
                Ok(Ok(_)) => {}
                Ok(Err(error)) => eprintln!("Draw.io watcher error: {error}"),
                Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if app
                .state::<DocState>()
                .drawio_watch_generation
                .load(Ordering::SeqCst)
                != generation
            {
                break;
            }
            let ready: Vec<String> = pending
                .iter()
                .filter(|(_, (_, changed))| changed.elapsed() >= Duration::from_millis(150))
                .map(|(key, _)| key.clone())
                .collect();
            for key in ready {
                if let Some((event_path, _)) = pending.remove(&key) {
                    if let Some(relative_path) =
                        canonical_drawio_relative_path(&doc_dir, &event_path)
                    {
                        app.emit(
                            "drawio-file-updated",
                            serde_json::json!({
                                "documentId": document_id,
                                "generation": generation,
                                "relativePath": relative_path,
                                "timestamp": chrono::Utc::now().timestamp_millis(),
                            }),
                        )
                        .ok();
                    }
                }
            }
        }
    });

    Ok(())
}

fn canonical_drawio_relative_path(
    document_dir: &std::path::Path,
    candidate: &std::path::Path,
) -> Option<String> {
    let canonical_root = document_dir.canonicalize().ok()?;
    let canonical_candidate = candidate.canonicalize().ok()?;
    drawio_relative_path(&canonical_root, &canonical_candidate)
}

fn canonical_drawio_directory(
    document_dir: &std::path::Path,
    candidate: &std::path::Path,
) -> Option<PathBuf> {
    let canonical_root = document_dir.canonicalize().ok()?;
    let canonical_candidate = candidate.canonicalize().ok()?;
    let relative = canonical_candidate.strip_prefix(&canonical_root).ok()?;
    if relative.components().count() == 1
        && relative
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("drawio"))
    {
        Some(canonical_candidate)
    } else {
        None
    }
}

fn drawio_relative_path(
    document_dir: &std::path::Path,
    candidate: &std::path::Path,
) -> Option<String> {
    let relative = candidate.strip_prefix(document_dir).ok()?;
    let mut components = relative.components();
    if components
        .next()?
        .as_os_str()
        .to_string_lossy()
        .to_ascii_lowercase()
        != "drawio"
    {
        return None;
    }
    if !candidate
        .file_name()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".drawio.svg")
    {
        return None;
    }
    Some(format!(
        "./{}",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

#[cfg(test)]
mod drawio_watcher_tests {
    use super::drawio_relative_path;
    use std::path::Path;

    #[test]
    fn preserves_canonical_nested_relative_path_and_rejects_other_files() {
        let root = Path::new("C:/docs");
        assert_eq!(
            drawio_relative_path(root, Path::new("C:/docs/drawio/nested/system.drawio.svg")),
            Some("./drawio/nested/system.drawio.svg".to_string())
        );
        assert_eq!(
            drawio_relative_path(root, Path::new("C:/docs/images/system.drawio.svg")),
            None
        );
        assert_eq!(
            drawio_relative_path(root, Path::new("C:/docs/drawio/system.svg")),
            None
        );
    }
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
