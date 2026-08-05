use super::{DiagramState, DocState};
use crate::settings::{
    save_settings, to_editor_settings, validate_diagram_renderer_settings, DiagramRendererConsent,
    DiagramRendererSettings,
};
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
    diagram_state: tauri::State<DiagramState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    let renderer_update = validate_renderer_update(&updates, &settings.diagram_renderer)?;
    let revoke_renderer = renderer_update.as_ref().is_some_and(|candidate| {
        settings.diagram_renderer.consent == DiagramRendererConsent::Granted
            && candidate.consent != DiagramRendererConsent::Granted
    });
    // Merge updates into current settings
    let mut current = serde_json::to_value(&*settings).map_err(|e| e.to_string())?;
    if let (Some(cur_obj), Some(upd_obj)) = (current.as_object_mut(), updates.as_object()) {
        for (key, value) in upd_obj {
            if key == "diagramRenderer" {
                let validated = renderer_update
                    .as_ref()
                    .ok_or_else(|| "diagramRenderer is invalid.".to_string())?;
                cur_obj.insert(
                    key.clone(),
                    serde_json::to_value(validated).map_err(|error| error.to_string())?,
                );
            } else {
                cur_obj.insert(key.clone(), value.clone());
            }
        }
    }
    *settings = serde_json::from_value(current).map_err(|e| e.to_string())?;
    save_settings(&settings)?;
    if revoke_renderer {
        diagram_state.cancel_all_and_clear_cache();
    }

    // Notify webview of settings change
    app.emit("settings-changed", to_editor_settings(&settings))
        .ok();
    Ok(())
}

fn validate_renderer_update(
    updates: &serde_json::Value,
    current: &DiagramRendererSettings,
) -> Result<Option<DiagramRendererSettings>, String> {
    let Some(value) = updates.get("diagramRenderer") else {
        return Ok(None);
    };
    let object = value
        .as_object()
        .ok_or_else(|| "diagramRenderer must be an object.".to_string())?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "consent" | "endpoint" | "allowPrivateNetwork"))
    {
        return Err("diagramRenderer contains an unsupported setting.".to_string());
    }

    let mut candidate = current.clone();
    if let Some(value) = object.get("consent") {
        candidate.consent = serde_json::from_value(value.clone()).map_err(|_| {
            "diagramRenderer.consent must be undecided, granted, or declined.".to_string()
        })?;
    }
    if let Some(value) = object.get("endpoint") {
        candidate.endpoint = value
            .as_str()
            .ok_or_else(|| "diagramRenderer.endpoint must be a string.".to_string())?
            .to_string();
    }
    if let Some(value) = object.get("allowPrivateNetwork") {
        candidate.allow_private_network = value
            .as_bool()
            .ok_or_else(|| "diagramRenderer.allowPrivateNetwork must be a boolean.".to_string())?;
    }
    validate_diagram_renderer_settings(&candidate)?;
    Ok(Some(candidate))
}

#[tauri::command]
pub fn get_recent_files(state: tauri::State<DocState>) -> Vec<String> {
    state.settings.lock().unwrap().recent_files.clone()
}

#[cfg(test)]
mod tests {
    use super::validate_renderer_update;
    use crate::settings::{DiagramRendererConsent, DiagramRendererSettings};

    #[test]
    fn rejects_invalid_untrusted_renderer_updates() {
        let current = DiagramRendererSettings {
            endpoint: "https://renderer.example.com/kroki".to_string(),
            ..DiagramRendererSettings::default()
        };
        assert!(validate_renderer_update(
            &serde_json::json!({ "diagramRenderer": { "consent": "allowed" } }),
            &current,
        )
        .is_err());
        assert!(validate_renderer_update(
            &serde_json::json!({ "diagramRenderer": { "endpoint": "http://example.com" } }),
            &current,
        )
        .is_err());
        assert!(validate_renderer_update(
            &serde_json::json!({ "diagramRenderer": { "headers": { "X-Test": "secret" } } }),
            &current,
        )
        .is_err());
        assert!(validate_renderer_update(
            &serde_json::json!({
                "diagramRenderer": {
                    "consent": "granted",
                    "endpoint": "https://kroki.io",
                    "allowPrivateNetwork": false
                }
            }),
            &current,
        )
        .is_ok());
        let partial = validate_renderer_update(
            &serde_json::json!({ "diagramRenderer": { "consent": "granted" } }),
            &current,
        )
        .unwrap()
        .unwrap();
        assert_eq!(partial.consent, DiagramRendererConsent::Granted);
        assert_eq!(partial.endpoint, current.endpoint);
        assert!(validate_renderer_update(
            &serde_json::json!({ "diagramRenderer": { "enabled": true } }),
            &current,
        )
        .is_err());
    }
}

// ─── Export (delegated to frontend converters, just handles file I/O) ──
