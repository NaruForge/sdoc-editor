use crate::settings::{
    classify_address, validate_diagram_renderer_settings, AddressClass, DiagramRendererConsent,
    DiagramRendererSettings,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{redirect::Policy, StatusCode, Url};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

const SOURCE_LIMIT: usize = 100 * 1024;
const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const RENDER_TIMEOUT: Duration = Duration::from_secs(10);
const TEST_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_DIMENSION: u32 = 8192;
const MAX_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 64;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramRenderResult {
    data_url: String,
    width: u32,
    height: u32,
    cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramRenderError {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

impl DiagramRenderError {
    fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }

    fn disabled() -> Self {
        Self::new(
            "disabled",
            "External diagram rendering is turned off.",
            false,
        )
    }

    fn invalid_endpoint() -> Self {
        Self::new(
            "invalid-endpoint",
            "Enter a valid diagram renderer endpoint.",
            false,
        )
    }

    fn blocked_address() -> Self {
        Self::new(
            "blocked-address",
            "The diagram renderer network address is not allowed.",
            false,
        )
    }

    fn cancelled() -> Self {
        Self::new("cancelled", "Diagram rendering was cancelled.", false)
    }

    fn offline() -> Self {
        Self::new(
            "offline",
            "The diagram renderer could not be reached.",
            true,
        )
    }

    fn invalid_response() -> Self {
        Self::new(
            "invalid-response",
            "The diagram renderer returned an invalid response.",
            false,
        )
    }
}

#[derive(Clone)]
struct CacheEntry {
    data_url: String,
    width: u32,
    height: u32,
    byte_length: usize,
}

#[derive(Default)]
struct DiagramCache {
    entries: HashMap<String, CacheEntry>,
    order: VecDeque<String>,
    bytes: usize,
}

impl DiagramCache {
    fn get(&mut self, key: &str) -> Option<DiagramRenderResult> {
        let entry = self.entries.get(key)?.clone();
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.to_string());
        Some(DiagramRenderResult {
            data_url: entry.data_url,
            width: entry.width,
            height: entry.height,
            cached: true,
        })
    }

    fn insert(&mut self, key: String, result: &DiagramRenderResult) {
        let byte_length = result.data_url.len();
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous.byte_length);
            self.order.retain(|candidate| candidate != &key);
        }
        self.entries.insert(
            key.clone(),
            CacheEntry {
                data_url: result.data_url.clone(),
                width: result.width,
                height: result.height,
                byte_length,
            },
        );
        self.order.push_back(key);
        self.bytes += byte_length;
        while self.entries.len() > MAX_CACHE_ENTRIES || self.bytes > MAX_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(entry) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(entry.byte_length);
            }
        }
    }
}

pub struct DiagramState {
    semaphore: Arc<Semaphore>,
    cancellations: Mutex<HashMap<String, Arc<CancellationToken>>>,
    cache: Mutex<DiagramCache>,
    revocation_epoch: AtomicU64,
}

impl Default for DiagramState {
    fn default() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(2)),
            cancellations: Mutex::new(HashMap::new()),
            cache: Mutex::new(DiagramCache::default()),
            revocation_epoch: AtomicU64::new(0),
        }
    }
}

impl DiagramState {
    fn revocation_epoch(&self) -> u64 {
        self.revocation_epoch.load(Ordering::SeqCst)
    }

    pub fn cancel_all_and_clear_cache(&self) {
        self.revocation_epoch.fetch_add(1, Ordering::SeqCst);
        let cancellations = {
            let mut registered = self.cancellations.lock().unwrap();
            registered
                .drain()
                .map(|(_, token)| token)
                .collect::<Vec<_>>()
        };
        for token in cancellations {
            token.cancel();
        }
        *self.cache.lock().unwrap() = DiagramCache::default();
    }
}

#[tauri::command]
pub async fn render_diagram(
    request_id: String,
    language: String,
    source: String,
    document_state: tauri::State<'_, super::DocState>,
    diagram_state: tauri::State<'_, DiagramState>,
) -> Result<DiagramRenderResult, DiagramRenderError> {
    let revocation_epoch = diagram_state.revocation_epoch();
    let settings = document_state
        .settings
        .lock()
        .unwrap()
        .diagram_renderer
        .clone();
    if settings.consent != DiagramRendererConsent::Granted {
        return Err(DiagramRenderError::disabled());
    }
    run_registered_render(
        &request_id,
        &language,
        &source,
        settings,
        RENDER_TIMEOUT,
        &diagram_state,
        revocation_epoch,
    )
    .await
}

#[tauri::command]
pub async fn test_diagram_renderer(
    request_id: String,
    settings: serde_json::Value,
    document_state: tauri::State<'_, super::DocState>,
    diagram_state: tauri::State<'_, DiagramState>,
) -> Result<DiagramRenderResult, DiagramRenderError> {
    let revocation_epoch = diagram_state.revocation_epoch();
    let persisted_consent = document_state
        .settings
        .lock()
        .unwrap()
        .diagram_renderer
        .consent;
    if persisted_consent != DiagramRendererConsent::Granted {
        return Err(DiagramRenderError::disabled());
    }
    let settings: DiagramRendererSettings =
        serde_json::from_value(settings).map_err(|_| DiagramRenderError::invalid_endpoint())?;
    if settings.consent != DiagramRendererConsent::Granted {
        return Err(DiagramRenderError::disabled());
    }
    validate_diagram_renderer_settings(&settings).map_err(map_settings_error)?;
    run_registered_render(
        &request_id,
        "graphviz",
        "digraph { ready }",
        settings,
        TEST_TIMEOUT,
        &diagram_state,
        revocation_epoch,
    )
    .await
}

#[tauri::command]
pub fn cancel_diagram_render(
    request_id: String,
    diagram_state: tauri::State<'_, DiagramState>,
) -> bool {
    let token = diagram_state
        .cancellations
        .lock()
        .unwrap()
        .remove(&request_id);
    if let Some(token) = token {
        token.cancel();
        true
    } else {
        false
    }
}

async fn run_registered_render(
    request_id: &str,
    language: &str,
    source: &str,
    settings: DiagramRendererSettings,
    timeout: Duration,
    state: &DiagramState,
    expected_revocation_epoch: u64,
) -> Result<DiagramRenderResult, DiagramRenderError> {
    if settings.consent != DiagramRendererConsent::Granted {
        return Err(DiagramRenderError::disabled());
    }
    if request_id.is_empty() || request_id.len() > 256 {
        return Err(DiagramRenderError::invalid_response());
    }
    let language = validate_language(language)?;
    if source.len() > SOURCE_LIMIT {
        return Err(DiagramRenderError::new(
            "source-too-large",
            "Diagram source exceeds the 100 KiB limit.",
            false,
        ));
    }
    validate_diagram_renderer_settings(&settings).map_err(map_settings_error)?;
    if state.revocation_epoch() != expected_revocation_epoch {
        return Err(DiagramRenderError::disabled());
    }

    let token = Arc::new(CancellationToken::new());
    if let Some(previous) = state
        .cancellations
        .lock()
        .unwrap()
        .insert(request_id.to_string(), token.clone())
    {
        previous.cancel();
    }
    if state.revocation_epoch() != expected_revocation_epoch {
        let mut cancellations = state.cancellations.lock().unwrap();
        if cancellations
            .get(request_id)
            .is_some_and(|current| Arc::ptr_eq(current, &token))
        {
            cancellations.remove(request_id);
        }
        return Err(DiagramRenderError::disabled());
    }

    let render = render_with_limits(language, source, &settings, state);
    let outcome = match tokio::time::timeout(timeout, token.run_until_cancelled(render)).await {
        Ok(Some(result)) => result,
        Ok(None) => Err(DiagramRenderError::cancelled()),
        Err(_) => Err(DiagramRenderError::new(
            "timeout",
            "Diagram rendering timed out.",
            true,
        )),
    };

    let mut cancellations = state.cancellations.lock().unwrap();
    if cancellations
        .get(request_id)
        .is_some_and(|current| Arc::ptr_eq(current, &token))
    {
        cancellations.remove(request_id);
    }
    outcome
}

fn map_settings_error(message: String) -> DiagramRenderError {
    if message.contains("network address") || message.contains("Private-network") {
        DiagramRenderError::blocked_address()
    } else {
        DiagramRenderError::invalid_endpoint()
    }
}

fn validate_language(language: &str) -> Result<&str, DiagramRenderError> {
    match language {
        "plantuml" | "d2" | "graphviz" => Ok(language),
        _ => Err(DiagramRenderError::invalid_response()),
    }
}

async fn render_with_limits(
    language: &str,
    source: &str,
    settings: &DiagramRendererSettings,
    state: &DiagramState,
) -> Result<DiagramRenderResult, DiagramRenderError> {
    let endpoint =
        Url::parse(&settings.endpoint).map_err(|_| DiagramRenderError::invalid_endpoint())?;
    let cache_key = cache_key(&endpoint, language, source, settings.allow_private_network);
    if let Some(cached) = state.cache.lock().unwrap().get(&cache_key) {
        return Ok(cached);
    }

    let permit = state
        .semaphore
        .acquire()
        .await
        .map_err(|_| DiagramRenderError::offline())?;
    let response = post_diagram(endpoint, language, source, settings.allow_private_network).await;
    drop(permit);

    let result = response?;
    state.cache.lock().unwrap().insert(cache_key, &result);
    Ok(result)
}

fn cache_key(endpoint: &Url, language: &str, source: &str, allow_private_network: bool) -> String {
    let mut digest = Sha256::new();
    digest.update(endpoint.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(language.as_bytes());
    digest.update(b"\0");
    digest.update(source.as_bytes());
    digest.update(b"\0");
    digest.update([u8::from(allow_private_network)]);
    format!("{:x}", digest.finalize())
}

async fn post_diagram(
    mut endpoint: Url,
    language: &str,
    source: &str,
    allow_private_network: bool,
) -> Result<DiagramRenderResult, DiagramRenderError> {
    let host = endpoint
        .host_str()
        .ok_or_else(DiagramRenderError::invalid_endpoint)?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = endpoint
        .port_or_known_default()
        .ok_or_else(DiagramRenderError::invalid_endpoint)?;
    let pinned = resolve_and_validate(&host, port, allow_private_network).await?;

    {
        let mut path = endpoint
            .path_segments_mut()
            .map_err(|_| DiagramRenderError::invalid_endpoint())?;
        path.pop_if_empty();
        path.push(language);
        path.push("png");
    }

    let mut builder = reqwest::Client::builder()
        .redirect(Policy::none())
        .no_proxy();
    if host.parse::<IpAddr>().is_err() {
        builder = builder.resolve(&host, pinned);
    }
    let client = builder.build().map_err(|_| DiagramRenderError::offline())?;
    let mut response = client
        .post(endpoint)
        .header(ACCEPT, "image/png")
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(source.as_bytes().to_vec())
        .send()
        .await
        .map_err(|_| DiagramRenderError::offline())?;

    let status = response.status();
    if status.is_redirection() {
        return Err(DiagramRenderError::new(
            "redirect",
            "Diagram renderer redirects are not allowed.",
            false,
        ));
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(DiagramRenderError::new(
            "rate-limited",
            "The diagram renderer is rate limited.",
            true,
        ));
    }
    if status.is_server_error() {
        return Err(DiagramRenderError::new(
            "server-error",
            "The diagram renderer is temporarily unavailable.",
            true,
        ));
    }
    if !status.is_success() {
        return Err(DiagramRenderError::invalid_response());
    }
    let is_png = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("image/png"));
    if !is_png {
        return Err(DiagramRenderError::invalid_response());
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT as u64)
    {
        return Err(DiagramRenderError::new(
            "response-too-large",
            "The diagram renderer response exceeds the 2 MiB limit.",
            false,
        ));
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DiagramRenderError::offline())?
    {
        if bytes.len().saturating_add(chunk.len()) > RESPONSE_LIMIT {
            return Err(DiagramRenderError::new(
                "response-too-large",
                "The diagram renderer response exceeds the 2 MiB limit.",
                false,
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let (width, height) = validate_png(&bytes)?;
    let result = DiagramRenderResult {
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&bytes)),
        width,
        height,
        cached: false,
    };
    Ok(result)
}

async fn resolve_and_validate(
    host: &str,
    port: u16,
    allow_private_network: bool,
) -> Result<SocketAddr, DiagramRenderError> {
    let explicit_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    let addresses: Vec<SocketAddr> = if let Ok(address) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(address, port)]
    } else {
        tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| DiagramRenderError::offline())?
            .collect()
    };
    if addresses.is_empty() {
        return Err(DiagramRenderError::offline());
    }

    let allowed = |address: IpAddr| {
        let class = classify_address(address);
        if explicit_loopback {
            class == AddressClass::Loopback
        } else {
            match class {
                AddressClass::Public => true,
                AddressClass::Private => allow_private_network,
                AddressClass::Loopback | AddressClass::AlwaysBlocked => false,
            }
        }
    };
    if addresses.iter().any(|address| !allowed(address.ip())) {
        return Err(DiagramRenderError::blocked_address());
    }
    Ok(addresses[0])
}

fn validate_png(bytes: &[u8]) -> Result<(u32, u32), DiagramRenderError> {
    if bytes.len() < 33
        || &bytes[..8] != PNG_SIGNATURE
        || u32::from_be_bytes(bytes[8..12].try_into().unwrap_or_default()) != 13
        || &bytes[12..16] != b"IHDR"
    {
        return Err(DiagramRenderError::invalid_response());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap_or_default());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap_or_default());
    let pixels = u64::from(width) * u64::from(height);
    let bit_depth = bytes[24];
    let color_type = bytes[25];
    let valid_color_depth = matches!(
        (color_type, bit_depth),
        (0, 1 | 2 | 4 | 8 | 16) | (2, 8 | 16) | (3, 1 | 2 | 4 | 8) | (4, 8 | 16) | (6, 8 | 16)
    );
    let expected_crc = u32::from_be_bytes(bytes[29..33].try_into().unwrap_or_default());
    let actual_crc = crc32fast::hash(&bytes[12..29]);
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || pixels > MAX_PIXELS
        || !valid_color_depth
        || bytes[26] != 0
        || bytes[27] != 0
        || bytes[28] > 1
        || expected_crc != actual_crc
    {
        return Err(DiagramRenderError::invalid_response());
    }
    Ok((width, height))
}

#[cfg(test)]
mod tests {
    use super::{
        cache_key, post_diagram, run_registered_render, validate_language, validate_png,
        DiagramCache, DiagramRenderResult, DiagramState, MAX_CACHE_ENTRIES, PNG_SIGNATURE,
    };
    use crate::settings::{DiagramRendererConsent, DiagramRendererSettings};
    use reqwest::Url;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;
    use tokio_util::sync::CancellationToken;

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::from(PNG_SIGNATURE.as_slice());
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        let crc = crc32fast::hash(&bytes[12..29]);
        bytes.extend_from_slice(&crc.to_be_bytes());
        bytes
    }

    fn serve_once(status: &str, content_type: &str, body: Vec<u8>, delay: Duration) -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let content_type = content_type.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            if !delay.is_zero() {
                thread::sleep(delay);
            }
            let headers = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.write_all(&body);
        });
        Url::parse(&format!("http://{address}")).unwrap()
    }

    #[test]
    fn accepts_only_supported_languages() {
        assert!(validate_language("plantuml").is_ok());
        assert!(validate_language("d2").is_ok());
        assert!(validate_language("graphviz").is_ok());
        assert!(validate_language("mermaid").is_err());
        assert!(validate_language("../plantuml").is_err());
    }

    #[test]
    fn validates_png_signature_ihdr_and_dimensions() {
        assert_eq!(validate_png(&png_header(640, 480)).unwrap(), (640, 480));
        assert!(validate_png(b"not a png").is_err());
        assert!(validate_png(&png_header(0, 10)).is_err());
        assert!(validate_png(&png_header(8193, 10)).is_err());
        assert!(validate_png(&png_header(8192, 8192)).is_err());
    }

    #[test]
    fn cache_is_bounded_and_marks_hits() {
        let mut cache = DiagramCache::default();
        let result = DiagramRenderResult {
            data_url: "data:image/png;base64,AA==".to_string(),
            width: 1,
            height: 1,
            cached: false,
        };
        for index in 0..=MAX_CACHE_ENTRIES {
            cache.insert(index.to_string(), &result);
        }
        assert_eq!(cache.entries.len(), MAX_CACHE_ENTRIES);
        assert!(cache.get("0").is_none());
        assert!(cache.get(&MAX_CACHE_ENTRIES.to_string()).unwrap().cached);
    }

    #[test]
    fn cache_key_separates_endpoint_language_and_source() {
        let endpoint = Url::parse("https://kroki.io").unwrap();
        assert_ne!(
            cache_key(&endpoint, "d2", "x -> y", false),
            cache_key(&endpoint, "graphviz", "x -> y", false)
        );
        assert_ne!(
            cache_key(&endpoint, "d2", "x -> y", false),
            cache_key(&endpoint, "d2", "x -> z", false)
        );
        assert_ne!(
            cache_key(&endpoint, "d2", "x -> y", false),
            cache_key(&endpoint, "d2", "x -> y", true)
        );
    }

    #[tokio::test]
    async fn request_boundary_rejects_redirect_mime_and_declared_oversize() {
        let redirect = serve_once("302 Found", "image/png", Vec::new(), Duration::ZERO);
        let redirect_error = post_diagram(redirect, "d2", "a -> b", false)
            .await
            .unwrap_err();
        assert_eq!(redirect_error.code, "redirect");

        let wrong_mime = serve_once("200 OK", "text/plain", b"not png".to_vec(), Duration::ZERO);
        let mime_error = post_diagram(wrong_mime, "graphviz", "digraph {}", false)
            .await
            .unwrap_err();
        assert_eq!(mime_error.code, "invalid-response");

        let oversized = serve_once(
            "200 OK",
            "image/png",
            vec![0; super::RESPONSE_LIMIT + 1],
            Duration::ZERO,
        );
        let size_error = post_diagram(oversized, "plantuml", "@startuml\n@enduml", false)
            .await
            .unwrap_err();
        assert_eq!(size_error.code, "response-too-large");
    }

    #[tokio::test]
    async fn registered_render_enforces_the_supplied_timeout() {
        let endpoint = serve_once(
            "200 OK",
            "image/png",
            png_header(1, 1),
            Duration::from_millis(150),
        );
        let settings = DiagramRendererSettings {
            consent: DiagramRendererConsent::Granted,
            endpoint: endpoint.to_string(),
            allow_private_network: false,
        };
        let state = DiagramState::default();
        let error = run_registered_render(
            "timeout-test",
            "d2",
            "a -> b",
            settings,
            Duration::from_millis(20),
            &state,
            state.revocation_epoch(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "timeout");
        assert!(error.retryable);
    }

    #[tokio::test]
    async fn registered_render_requires_granted_consent() {
        for consent in [
            DiagramRendererConsent::Undecided,
            DiagramRendererConsent::Declined,
        ] {
            let settings = DiagramRendererSettings {
                consent,
                ..DiagramRendererSettings::default()
            };
            let error = run_registered_render(
                "consent-test",
                "d2",
                "a -> b",
                settings,
                Duration::from_millis(20),
                &DiagramState::default(),
                0,
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, "disabled");
        }
    }

    #[test]
    fn revocation_cancels_requests_and_clears_cache() {
        let state = DiagramState::default();
        let epoch = state.revocation_epoch();
        let token = Arc::new(CancellationToken::new());
        state
            .cancellations
            .lock()
            .unwrap()
            .insert("pending".to_string(), token.clone());
        state.cache.lock().unwrap().insert(
            "cached".to_string(),
            &DiagramRenderResult {
                data_url: "data:image/png;base64,AA==".to_string(),
                width: 1,
                height: 1,
                cached: false,
            },
        );

        state.cancel_all_and_clear_cache();

        assert_eq!(state.revocation_epoch(), epoch + 1);
        assert!(token.is_cancelled());
        assert!(state.cancellations.lock().unwrap().is_empty());
        assert!(state.cache.lock().unwrap().entries.is_empty());
    }

    #[tokio::test]
    async fn revocation_epoch_rejects_a_render_that_started_before_revocation() {
        let state = DiagramState::default();
        let stale_epoch = state.revocation_epoch();
        state.cancel_all_and_clear_cache();

        let error = run_registered_render(
            "stale-consent",
            "graphviz",
            "digraph { a -> b }",
            DiagramRendererSettings {
                consent: DiagramRendererConsent::Granted,
                ..DiagramRendererSettings::default()
            },
            Duration::from_millis(20),
            &state,
            stale_epoch,
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "disabled");
        assert!(state.cancellations.lock().unwrap().is_empty());
    }
}
