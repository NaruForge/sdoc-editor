use super::{path_is_excluded, DocState};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

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
