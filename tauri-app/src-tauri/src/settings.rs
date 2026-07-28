use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::PathBuf;

const SETTINGS_FILE: &str = "settings.json";
pub const DEFAULT_DIAGRAM_RENDERER_ENDPOINT: &str = "https://kroki.io";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagramRendererSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_diagram_renderer_endpoint")]
    pub endpoint: String,
    #[serde(default)]
    pub allow_private_network: bool,
}

impl Default for DiagramRendererSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: default_diagram_renderer_endpoint(),
            allow_private_network: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub heading_decoration: bool,
    #[serde(default = "default_primary_color")]
    pub heading_h1_color: String,
    #[serde(default = "default_primary_color")]
    pub heading_h2_color: String,
    #[serde(default = "default_primary_color")]
    pub heading_h3_color: String,
    #[serde(default = "default_center")]
    pub default_image_alignment: String,
    #[serde(default = "default_relative")]
    pub export_image_path: String,
    #[serde(default = "default_company_name")]
    pub theme_company_name: String,
    #[serde(default = "default_primary_color")]
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
    #[serde(default)]
    pub diagram_renderer: DiagramRendererSettings,
}

fn default_true() -> bool {
    true
}
fn default_primary_color() -> String {
    "#2563EB".to_string()
}
fn default_center() -> String {
    "center".to_string()
}
fn default_relative() -> String {
    "relative".to_string()
}
fn default_company_name() -> String {
    "Structured Doc Editor".to_string()
}
fn default_gray() -> String {
    "#6b6b6b".to_string()
}
fn default_font_family() -> String {
    "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif".to_string()
}
fn default_diagram_renderer_endpoint() -> String {
    DEFAULT_DIAGRAM_RENDERER_ENDPOINT.to_string()
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
        let mut settings: AppSettings = serde_json::from_str(&data).unwrap_or_default();
        if validate_diagram_renderer_settings(&settings.diagram_renderer).is_err() {
            settings.diagram_renderer = DiagramRendererSettings::default();
        }
        settings
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
        "headingDecoration": settings.heading_decoration,
        "headingH1Color": settings.heading_h1_color,
        "headingH2Color": settings.heading_h2_color,
        "headingH3Color": settings.heading_h3_color,
        "defaultImageAlignment": settings.default_image_alignment,
        "exportImagePath": settings.export_image_path,
    })
}

pub fn validate_diagram_renderer_settings(
    settings: &DiagramRendererSettings,
) -> Result<(), String> {
    if settings.endpoint.len() > 2_048 {
        return Err("The diagram renderer endpoint is too long.".to_string());
    }
    let url = reqwest::Url::parse(&settings.endpoint)
        .map_err(|_| "Enter a valid diagram renderer endpoint URL.".to_string())?;
    let authority_has_credentials = settings
        .endpoint
        .split_once("://")
        .map(|(_, rest)| {
            rest.split(['/', '?', '#'])
                .next()
                .is_some_and(|authority| authority.contains('@'))
        })
        .unwrap_or(false);
    if !matches!(url.scheme(), "http" | "https")
        || authority_has_credentials
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(
            "Diagram renderer endpoints cannot contain credentials, a query, or a fragment."
                .to_string(),
        );
    }

    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']');
    let explicit_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if url.scheme() == "http" && !explicit_loopback {
        return Err("Non-loopback diagram renderer endpoints must use HTTPS.".to_string());
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        match classify_address(address) {
            AddressClass::AlwaysBlocked => {
                return Err("This diagram renderer network address is not allowed.".to_string())
            }
            AddressClass::Private if !settings.allow_private_network => {
                return Err("Private-network endpoints require explicit opt-in.".to_string())
            }
            AddressClass::Loopback if !explicit_loopback => {
                return Err("This diagram renderer network address is not allowed.".to_string())
            }
            _ => {}
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AddressClass {
    Public,
    Loopback,
    Private,
    AlwaysBlocked,
}

pub(crate) fn classify_address(address: IpAddr) -> AddressClass {
    match address {
        IpAddr::V4(address) => classify_ipv4(address),
        IpAddr::V6(address) => classify_ipv6(address),
    }
}

fn classify_ipv4(address: Ipv4Addr) -> AddressClass {
    let value = u32::from(address);
    let in_range = |network: Ipv4Addr, prefix: u32| {
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        value & mask == u32::from(network) & mask
    };

    if address == Ipv4Addr::new(100, 100, 100, 200) || address == Ipv4Addr::new(168, 63, 129, 16) {
        AddressClass::AlwaysBlocked
    } else if in_range(Ipv4Addr::new(127, 0, 0, 0), 8) {
        AddressClass::Loopback
    } else if in_range(Ipv4Addr::new(10, 0, 0, 0), 8)
        || in_range(Ipv4Addr::new(172, 16, 0, 0), 12)
        || in_range(Ipv4Addr::new(192, 168, 0, 0), 16)
        || in_range(Ipv4Addr::new(100, 64, 0, 0), 10)
    {
        AddressClass::Private
    } else if in_range(Ipv4Addr::UNSPECIFIED, 8)
        || in_range(Ipv4Addr::new(169, 254, 0, 0), 16)
        || in_range(Ipv4Addr::new(192, 0, 0, 0), 24)
        || in_range(Ipv4Addr::new(192, 0, 2, 0), 24)
        || in_range(Ipv4Addr::new(192, 88, 99, 0), 24)
        || in_range(Ipv4Addr::new(198, 18, 0, 0), 15)
        || in_range(Ipv4Addr::new(198, 51, 100, 0), 24)
        || in_range(Ipv4Addr::new(203, 0, 113, 0), 24)
        || in_range(Ipv4Addr::new(224, 0, 0, 0), 4)
        || in_range(Ipv4Addr::new(240, 0, 0, 0), 4)
    {
        AddressClass::AlwaysBlocked
    } else {
        AddressClass::Public
    }
}

fn classify_ipv6(address: Ipv6Addr) -> AddressClass {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return classify_ipv4(mapped);
    }
    let value = u128::from(address);
    let in_range = |network: Ipv6Addr, prefix: u32| {
        let mask = if prefix == 0 {
            0
        } else {
            u128::MAX << (128 - prefix)
        };
        value & mask == u128::from(network) & mask
    };

    let translated_ipv4 = |shift: u32| {
        let embedded = ((value >> shift) & u128::from(u32::MAX)) as u32;
        classify_ipv4(Ipv4Addr::from(embedded))
    };

    if address == "fd00:ec2::254".parse::<Ipv6Addr>().unwrap() {
        AddressClass::AlwaysBlocked
    } else if address.is_loopback() {
        AddressClass::Loopback
    } else if in_range("fc00::".parse().unwrap(), 7) || in_range("64:ff9b:1::".parse().unwrap(), 48)
    {
        AddressClass::Private
    } else if in_range("64:ff9b::".parse().unwrap(), 96) {
        translated_ipv4(0)
    } else if in_range("2002::".parse().unwrap(), 16) {
        translated_ipv4(80)
    } else if address.is_unspecified()
        || in_range("::".parse().unwrap(), 96)
        || in_range("fe80::".parse().unwrap(), 10)
        || in_range("fec0::".parse().unwrap(), 10)
        || in_range("ff00::".parse().unwrap(), 8)
        || in_range("2001:db8::".parse().unwrap(), 32)
        || in_range("2001::".parse().unwrap(), 23)
    {
        AddressClass::AlwaysBlocked
    } else {
        AddressClass::Public
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_address, validate_diagram_renderer_settings, AddressClass, AppSettings,
        DiagramRendererSettings,
    };

    #[test]
    fn defaults_are_project_neutral() {
        let settings = AppSettings::default();

        assert_eq!(settings.heading_h1_color, "#2563EB");
        assert_eq!(settings.heading_h2_color, "#2563EB");
        assert_eq!(settings.heading_h3_color, "#2563EB");
        assert_eq!(settings.theme_primary_color, "#2563EB");
        assert_eq!(settings.theme_company_name, "Structured Doc Editor");
        assert!(!settings.diagram_renderer.enabled);
        assert_eq!(settings.diagram_renderer.endpoint, "https://kroki.io");
        assert!(!settings.diagram_renderer.allow_private_network);
    }

    #[test]
    fn validates_renderer_endpoint_trust_settings() {
        let mut settings = DiagramRendererSettings::default();
        assert!(validate_diagram_renderer_settings(&settings).is_ok());

        settings.endpoint = "http://localhost:8000".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_ok());
        settings.endpoint = "http://[::1]:8000".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_ok());
        settings.endpoint = "http://example.com".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
        settings.endpoint = "https://user@example.com".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
        settings.endpoint = "https://@example.com".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
        settings.endpoint = "https://example.com?q=secret".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
        settings.endpoint = "https://192.168.1.2".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
        settings.allow_private_network = true;
        assert!(validate_diagram_renderer_settings(&settings).is_ok());
        settings.endpoint = "https://169.254.169.254".to_string();
        assert!(validate_diagram_renderer_settings(&settings).is_err());
    }

    #[test]
    fn classifies_blocked_and_private_addresses() {
        assert_eq!(
            classify_address("127.0.0.1".parse().unwrap()),
            AddressClass::Loopback
        );
        assert_eq!(
            classify_address("10.0.0.1".parse().unwrap()),
            AddressClass::Private
        );
        assert_eq!(
            classify_address("169.254.169.254".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("100.100.100.200".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("fd00:ec2::254".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("224.0.0.1".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("::".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("fe80::1".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("::2".parse().unwrap()),
            AddressClass::AlwaysBlocked
        );
        assert_eq!(
            classify_address("64:ff9b::a00:1".parse().unwrap()),
            AddressClass::Private
        );
    }
}
