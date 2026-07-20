use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_image_caption_prefix")]
    pub image_caption_prefix: String,
    #[serde(default = "default_table_caption_prefix")]
    pub table_caption_prefix: String,
    #[serde(default = "default_caption_numbering")]
    pub caption_numbering: String,
    #[serde(default = "default_true")]
    pub heading_numbering: bool,
    #[serde(default = "default_true")]
    pub heading_decoration: bool,
    #[serde(default = "default_lg_red")]
    pub heading_h1_color: String,
    #[serde(default = "default_lg_red")]
    pub heading_h2_color: String,
    #[serde(default = "default_lg_red")]
    pub heading_h3_color: String,
    #[serde(default = "default_center")]
    pub default_image_alignment: String,
    #[serde(default = "default_relative")]
    pub export_image_path: String,
    #[serde(default = "default_company_name")]
    pub theme_company_name: String,
    #[serde(default = "default_lg_red")]
    pub theme_primary_color: String,
    #[serde(default = "default_gray")]
    pub theme_accent_color: String,
    #[serde(default = "default_font_family")]
    pub theme_font_family: String,
    #[serde(default)]
    pub theme_custom_styles: String,
    #[serde(default)]
    pub recent_files: Vec<String>,
    /// Previously opened workspace folders (most recent first), used to restore the last
    /// workspace on launch and to let the user quickly switch between recent folders —
    /// analogous to VS Code's "Recent Workspaces" list.
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

fn default_image_caption_prefix() -> String {
    "Image".to_string()
}
fn default_table_caption_prefix() -> String {
    "Table".to_string()
}
fn default_caption_numbering() -> String {
    "sequential".to_string()
}
fn default_true() -> bool {
    true
}
fn default_lg_red() -> String {
    "#A50034".to_string()
}
fn default_center() -> String {
    "center".to_string()
}
fn default_relative() -> String {
    "relative".to_string()
}
fn default_company_name() -> String {
    "LG Magna e-Powertrain".to_string()
}
fn default_gray() -> String {
    "#6b6b6b".to_string()
}
fn default_font_family() -> String {
    "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        serde_json::from_str("{}").unwrap()
    }
}

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sdoc-editor");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join(SETTINGS_FILE)
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

/// Convert settings to the format expected by the webview editor.
pub fn to_editor_settings(settings: &AppSettings) -> serde_json::Value {
    serde_json::json!({
        "imageCaptionPrefix": settings.image_caption_prefix,
        "tableCaptionPrefix": settings.table_caption_prefix,
        "captionNumbering": settings.caption_numbering,
        "headingNumbering": settings.heading_numbering,
        "headingDecoration": settings.heading_decoration,
        "headingH1Color": settings.heading_h1_color,
        "headingH2Color": settings.heading_h2_color,
        "headingH3Color": settings.heading_h3_color,
        "defaultImageAlignment": settings.default_image_alignment,
        "exportImagePath": settings.export_image_path,
    })
}
