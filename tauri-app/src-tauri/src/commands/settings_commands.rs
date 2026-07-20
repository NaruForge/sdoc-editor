use super::DocState;
use crate::settings::{save_settings, to_editor_settings};
use tauri::{AppHandle, Emitter};

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
