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

fn diagram_output(language: &str) -> (&'static str, &'static str) {
    if language == "d2" {
        ("svg", "image/svg+xml")
    } else {
        ("png", "image/png")
    }
}

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
    let (output_path, response_mime) = diagram_output(language);
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
        path.push(output_path);
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
        .header(ACCEPT, response_mime)
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
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let valid_content_type = if language == "d2" {
        content_type.is_some_and(|value| value.trim().eq_ignore_ascii_case(response_mime))
    } else {
        content_type
            .and_then(|value| value.split(';').next())
            .is_some_and(|value| value.trim().eq_ignore_ascii_case(response_mime))
    };
    if !valid_content_type {
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
    let (width, height) = if language == "d2" {
        validate_svg(&bytes)?
    } else {
        validate_png(&bytes)?
    };
    let result = DiagramRenderResult {
        data_url: format!(
            "data:{response_mime};base64,{}",
            BASE64_STANDARD.encode(&bytes)
        ),
        width,
        height,
        cached: false,
    };
    Ok(result)
}

fn validate_svg(bytes: &[u8]) -> Result<(u32, u32), DiagramRenderError> {
    let source = std::str::from_utf8(bytes).map_err(|_| DiagramRenderError::invalid_response())?;
    if !source.chars().all(is_valid_xml_character) {
        return Err(DiagramRenderError::invalid_response());
    }
    let mut parser = SvgParser::new(source.trim_start_matches('\u{feff}'));
    parser.parse()
}

struct SvgParser<'a> {
    source: &'a str,
    position: usize,
    stack: Vec<String>,
    root_seen: bool,
    root_closed: bool,
    dimensions: Option<(u32, u32)>,
    style_content: Option<String>,
}

impl<'a> SvgParser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            position: 0,
            stack: Vec::new(),
            root_seen: false,
            root_closed: false,
            dimensions: None,
            style_content: None,
        }
    }

    fn parse(&mut self) -> Result<(u32, u32), DiagramRenderError> {
        while self.position < self.source.len() {
            if self.remaining().starts_with("<!--") {
                self.consume_comment()?;
            } else if self.remaining().starts_with("<?xml") && !self.root_seen {
                self.consume_xml_declaration()?;
            } else if self.remaining().starts_with("<![CDATA[") {
                self.consume_cdata()?;
            } else if self.remaining().starts_with("</") {
                self.consume_end_tag()?;
            } else if self.remaining().starts_with('<') {
                if self.remaining().starts_with("<!") || self.remaining().starts_with("<?") {
                    return Err(DiagramRenderError::invalid_response());
                }
                self.consume_start_tag()?;
            } else {
                self.consume_text()?;
            }
        }

        if !self.root_seen || !self.root_closed || !self.stack.is_empty() {
            return Err(DiagramRenderError::invalid_response());
        }
        self.dimensions
            .ok_or_else(DiagramRenderError::invalid_response)
    }

    fn remaining(&self) -> &'a str {
        &self.source[self.position..]
    }

    fn consume_comment(&mut self) -> Result<(), DiagramRenderError> {
        let end = self.remaining()[4..]
            .find("-->")
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let content = &self.remaining()[4..4 + end];
        if content.contains("--") {
            return Err(DiagramRenderError::invalid_response());
        }
        self.position += 4 + end + 3;
        Ok(())
    }

    fn consume_xml_declaration(&mut self) -> Result<(), DiagramRenderError> {
        let end = self
            .remaining()
            .find("?>")
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let declaration = &self.remaining()[..end + 2];
        if !declaration.starts_with("<?xml ") {
            return Err(DiagramRenderError::invalid_response());
        }
        self.position += end + 2;
        Ok(())
    }

    fn consume_cdata(&mut self) -> Result<(), DiagramRenderError> {
        if self.stack.is_empty() {
            return Err(DiagramRenderError::invalid_response());
        }
        let end = self.remaining()[9..]
            .find("]]>")
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let content = &self.remaining()[9..9 + end];
        if let Some(style) = &mut self.style_content {
            style.push_str(content);
        }
        self.position += 9 + end + 3;
        Ok(())
    }

    fn consume_text(&mut self) -> Result<(), DiagramRenderError> {
        let length = self.remaining().find('<').unwrap_or(self.remaining().len());
        let text = &self.remaining()[..length];
        if (self.stack.is_empty() && !text.trim().is_empty()) || text.contains("]]>") {
            return Err(DiagramRenderError::invalid_response());
        }
        let decoded = decode_xml_entities(text)?;
        if let Some(style) = &mut self.style_content {
            style.push_str(&decoded);
        }
        self.position += length;
        Ok(())
    }

    fn consume_start_tag(&mut self) -> Result<(), DiagramRenderError> {
        if self.root_closed {
            return Err(DiagramRenderError::invalid_response());
        }
        if self.style_content.is_some() {
            return Err(DiagramRenderError::invalid_response());
        }
        self.position += 1;
        let name = self.consume_name()?.to_string();
        if !is_valid_qname(&name) {
            return Err(DiagramRenderError::invalid_response());
        }
        let local_name = name
            .rsplit(':')
            .next()
            .unwrap_or(&name)
            .to_ascii_lowercase();
        if !self.root_seen {
            if name != "svg" {
                return Err(DiagramRenderError::invalid_response());
            }
            self.root_seen = true;
        } else if self.stack.is_empty() {
            return Err(DiagramRenderError::invalid_response());
        }
        if is_forbidden_svg_element(&local_name) {
            return Err(DiagramRenderError::invalid_response());
        }

        let mut attributes = HashMap::new();
        let self_closing = loop {
            self.skip_whitespace();
            if self.remaining().starts_with("/>") {
                self.position += 2;
                break true;
            }
            if self.remaining().starts_with('>') {
                self.position += 1;
                break false;
            }
            let attribute_name = self.consume_name()?.to_string();
            if !is_valid_qname(&attribute_name) {
                return Err(DiagramRenderError::invalid_response());
            }
            self.skip_whitespace();
            if !self.remaining().starts_with('=') {
                return Err(DiagramRenderError::invalid_response());
            }
            self.position += 1;
            self.skip_whitespace();
            let value = self.consume_quoted_value()?;
            if attributes.insert(attribute_name, value).is_some() {
                return Err(DiagramRenderError::invalid_response());
            }
        };

        validate_svg_attributes(&attributes)?;
        if self.stack.is_empty() {
            if attributes.get("xmlns").map(String::as_str) != Some("http://www.w3.org/2000/svg") {
                return Err(DiagramRenderError::invalid_response());
            }
            self.dimensions = Some(svg_dimensions(&attributes)?);
        }
        if local_name == "style" {
            if self.style_content.is_some() || self_closing {
                return Err(DiagramRenderError::invalid_response());
            }
            self.style_content = Some(String::new());
        }
        if self_closing {
            if self.stack.is_empty() {
                self.root_closed = true;
            }
        } else {
            self.stack.push(name);
        }
        Ok(())
    }

    fn consume_end_tag(&mut self) -> Result<(), DiagramRenderError> {
        self.position += 2;
        let name = self.consume_name()?.to_string();
        if !is_valid_qname(&name) {
            return Err(DiagramRenderError::invalid_response());
        }
        self.skip_whitespace();
        if !self.remaining().starts_with('>') {
            return Err(DiagramRenderError::invalid_response());
        }
        self.position += 1;
        let open_name = self
            .stack
            .pop()
            .ok_or_else(DiagramRenderError::invalid_response)?;
        if name != open_name {
            return Err(DiagramRenderError::invalid_response());
        }
        if name
            .rsplit(':')
            .next()
            .is_some_and(|local| local.eq_ignore_ascii_case("style"))
        {
            let style = self
                .style_content
                .take()
                .ok_or_else(DiagramRenderError::invalid_response)?;
            validate_css(&style, true)?;
        }
        if self.stack.is_empty() {
            self.root_closed = true;
        }
        Ok(())
    }

    fn consume_name(&mut self) -> Result<&'a str, DiagramRenderError> {
        let start = self.position;
        let mut characters = self.remaining().char_indices();
        let Some((_, first)) = characters.next() else {
            return Err(DiagramRenderError::invalid_response());
        };
        if !is_xml_name_start(first) {
            return Err(DiagramRenderError::invalid_response());
        }
        let mut length = first.len_utf8();
        for (offset, character) in characters {
            if !is_xml_name_character(character) {
                length = offset;
                break;
            }
            length = offset + character.len_utf8();
        }
        self.position += length;
        Ok(&self.source[start..self.position])
    }

    fn consume_quoted_value(&mut self) -> Result<String, DiagramRenderError> {
        let quote = self
            .remaining()
            .chars()
            .next()
            .filter(|character| matches!(character, '\'' | '"'))
            .ok_or_else(DiagramRenderError::invalid_response)?;
        self.position += 1;
        let end = self
            .remaining()
            .find(quote)
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let value = &self.remaining()[..end];
        if value.contains('<') {
            return Err(DiagramRenderError::invalid_response());
        }
        let decoded = decode_xml_entities(value)?;
        self.position += end + quote.len_utf8();
        Ok(decoded)
    }

    fn skip_whitespace(&mut self) {
        let length = self
            .remaining()
            .chars()
            .take_while(|character| character.is_ascii_whitespace())
            .map(char::len_utf8)
            .sum::<usize>();
        self.position += length;
    }
}

fn is_xml_name_start(character: char) -> bool {
    character.is_ascii_alphabetic() || matches!(character, '_' | ':')
}

fn is_xml_name_character(character: char) -> bool {
    is_xml_name_start(character) || character.is_ascii_digit() || matches!(character, '-' | '.')
}

fn is_valid_qname(name: &str) -> bool {
    !name.starts_with(':') && !name.ends_with(':') && name.matches(':').count() <= 1
}

fn is_valid_xml_character(character: char) -> bool {
    matches!(character, '\u{9}' | '\u{a}' | '\u{d}')
        || ('\u{20}'..='\u{d7ff}').contains(&character)
        || ('\u{e000}'..='\u{fffd}').contains(&character)
        || ('\u{10000}'..='\u{10ffff}').contains(&character)
}

fn decode_xml_entities(value: &str) -> Result<String, DiagramRenderError> {
    let mut decoded = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(index) = remaining.find('&') {
        decoded.push_str(&remaining[..index]);
        remaining = &remaining[index + 1..];
        let end = remaining
            .find(';')
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let entity = &remaining[..end];
        let character = match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "apos" => '\'',
            "quot" => '"',
            _ => entity
                .strip_prefix("#x")
                .and_then(|digits| u32::from_str_radix(digits, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|digits| digits.parse::<u32>().ok())
                })
                .and_then(char::from_u32)
                .filter(|character| is_valid_xml_character(*character))
                .ok_or_else(DiagramRenderError::invalid_response)?,
        };
        decoded.push(character);
        remaining = &remaining[end + 1..];
    }
    decoded.push_str(remaining);
    Ok(decoded)
}

fn is_forbidden_svg_element(local_name: &str) -> bool {
    matches!(
        local_name,
        "script"
            | "foreignobject"
            | "iframe"
            | "frame"
            | "frameset"
            | "object"
            | "embed"
            | "audio"
            | "video"
            | "canvas"
            | "animate"
            | "animatemotion"
            | "animatetransform"
            | "discard"
            | "set"
    )
}

fn validate_svg_attributes(attributes: &HashMap<String, String>) -> Result<(), DiagramRenderError> {
    for (name, value) in attributes {
        let local_name = name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase();
        if local_name.starts_with("on")
            || matches!(
                local_name.as_str(),
                "src" | "action" | "formaction" | "poster"
            )
            || name.eq_ignore_ascii_case("xml:base")
        {
            return Err(DiagramRenderError::invalid_response());
        }
        if (name == "xmlns" && value != "http://www.w3.org/2000/svg")
            || (name.starts_with("xmlns:") && value != "http://www.w3.org/1999/xlink")
        {
            return Err(DiagramRenderError::invalid_response());
        }
        if matches!(local_name.as_str(), "href") && !is_internal_fragment(value) {
            return Err(DiagramRenderError::invalid_response());
        }
        if local_name == "style" {
            validate_css(value, false)?;
        } else if value.to_ascii_lowercase().contains("url(") {
            validate_css_urls(value, false)?;
        }
    }
    Ok(())
}

fn is_internal_fragment(value: &str) -> bool {
    let value = value.trim();
    value.starts_with('#')
        && value.len() > 1
        && value[1..].chars().all(|character| {
            !character.is_ascii_whitespace() && !matches!(character, '"' | '\'' | '<' | '>')
        })
}

fn validate_css(css: &str, allow_embedded_font: bool) -> Result<(), DiagramRenderError> {
    let lower = css.to_ascii_lowercase();
    if css.contains('\\')
        || css.contains('&')
        || lower.contains("@import")
        || lower.contains("javascript:")
        || lower.contains("expression(")
        || lower.contains("-moz-binding")
    {
        return Err(DiagramRenderError::invalid_response());
    }
    for at_rule in lower.split('@').skip(1) {
        let name: String = at_rule
            .chars()
            .take_while(|character| character.is_ascii_alphabetic() || *character == '-')
            .collect();
        if !name.is_empty() && name != "font-face" {
            return Err(DiagramRenderError::invalid_response());
        }
    }
    validate_css_urls(css, allow_embedded_font)
}

fn validate_css_urls(css: &str, allow_embedded_font: bool) -> Result<(), DiagramRenderError> {
    let lower = css.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(relative_start) = lower[offset..].find("url(") {
        let start = offset + relative_start + 4;
        let end = css[start..]
            .find(')')
            .map(|end| start + end)
            .ok_or_else(DiagramRenderError::invalid_response)?;
        let target = css[start..end]
            .trim()
            .trim_matches(|character| matches!(character, '\'' | '"'))
            .trim();
        if !is_internal_fragment(target)
            && !(allow_embedded_font && is_embedded_base64_font(target))
        {
            return Err(DiagramRenderError::invalid_response());
        }
        offset = end + 1;
    }
    Ok(())
}

fn is_embedded_base64_font(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let Some(data) = lower.strip_prefix("data:") else {
        return false;
    };
    let Some((media_type, payload)) = data.split_once(",") else {
        return false;
    };
    let Some(media_type) = media_type.strip_suffix(";base64") else {
        return false;
    };
    matches!(
        media_type,
        "font/woff"
            | "font/woff2"
            | "application/font-woff"
            | "application/font-woff2"
            | "application/x-font-woff"
    ) && !payload.is_empty()
        && payload.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=')
        })
}

fn svg_dimensions(attributes: &HashMap<String, String>) -> Result<(u32, u32), DiagramRenderError> {
    let dimensions = attributes
        .get("width")
        .zip(attributes.get("height"))
        .and_then(|(width, height)| Some((parse_svg_length(width)?, parse_svg_length(height)?)))
        .or_else(|| {
            let view_box = attributes
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("viewBox"))?
                .1;
            parse_view_box(view_box)
        })
        .ok_or_else(DiagramRenderError::invalid_response)?;
    bounded_dimensions(dimensions.0, dimensions.1)
}

fn parse_svg_length(value: &str) -> Option<f64> {
    let value = value.trim();
    let number = value.strip_suffix("px").unwrap_or(value).trim();
    let parsed = number.parse::<f64>().ok()?;
    (parsed.is_finite() && parsed > 0.0).then_some(parsed)
}

fn parse_view_box(value: &str) -> Option<(f64, f64)> {
    let values = value
        .split(|character: char| character.is_ascii_whitespace() || character == ',')
        .filter(|value| !value.is_empty())
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if values.len() != 4 || values.iter().any(|value| !value.is_finite()) {
        return None;
    }
    (values[2] > 0.0 && values[3] > 0.0).then_some((values[2], values[3]))
}

fn bounded_dimensions(width: f64, height: f64) -> Result<(u32, u32), DiagramRenderError> {
    let width = width.ceil();
    let height = height.ceil();
    if width > f64::from(MAX_DIMENSION) || height > f64::from(MAX_DIMENSION) {
        return Err(DiagramRenderError::invalid_response());
    }
    let width = width as u32;
    let height = height as u32;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(DiagramRenderError::invalid_response());
    }
    Ok((width, height))
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
        cache_key, diagram_output, post_diagram, run_registered_render, validate_language,
        validate_png, validate_svg, DiagramCache, DiagramRenderResult, DiagramState,
        MAX_CACHE_ENTRIES, PNG_SIGNATURE,
    };
    use crate::settings::{DiagramRendererConsent, DiagramRendererSettings};
    use base64::Engine;
    use reqwest::Url;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
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
        serve_once_capturing_request(status, content_type, body, delay).0
    }

    fn serve_once_capturing_request(
        status: &str,
        content_type: &str,
        body: Vec<u8>,
        delay: Duration,
    ) -> (Url, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let content_type = content_type.to_string();
        let (request_sender, request_receiver) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let read = stream.read(&mut request).unwrap_or_default();
            let _ = request_sender.send(String::from_utf8_lossy(&request[..read]).into_owned());
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
        (
            Url::parse(&format!("http://{address}")).unwrap(),
            request_receiver,
        )
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
    fn maps_languages_to_their_supported_kroki_output() {
        assert_eq!(diagram_output("d2"), ("svg", "image/svg+xml"));
        assert_eq!(diagram_output("plantuml"), ("png", "image/png"));
        assert_eq!(diagram_output("graphviz"), ("png", "image/png"));
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
    fn validates_safe_svg_and_derives_bounded_dimensions() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480">
            <style>@font-face { font-family: d2; src: url('data:application/font-woff;base64,AA==') }</style>
            <defs><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs>
            <g clip-path="url(#clip)"><text>&amp;</text></g>
        </svg>"#;
        assert_eq!(validate_svg(svg).unwrap(), (640, 480));
        assert_eq!(
            validate_svg(
                br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120.4 80.1"><path d="M0 0"/></svg>"#
            )
            .unwrap(),
            (121, 81)
        );
        assert!(validate_svg(
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="8193" height="1"/>"#
        )
        .is_err());
        assert!(validate_svg(
            br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8192 8192"/>"#
        )
        .is_err());
        assert!(
            validate_svg(br#"<svg xmlns="http://www.w3.org/2000/svg" width="0" height="1"/>"#)
                .is_err()
        );
    }

    #[test]
    fn rejects_malformed_or_active_svg_content() {
        for svg in [
            br#"not svg"#.as_slice(),
            br#"<svg><g></svg>"#.as_slice(),
            br#"<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#.as_slice(),
            br#"<!ENTITY x SYSTEM "file:///etc/passwd"><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><foreignObject/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><iframe/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><animate/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><g onclick="alert(1)"/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://example.com/x.png"/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>@import url(https://example.com/x.css)</style></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>@keyframes spin {}</style></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>g { fill: url(https://example.com/x.svg) }</style></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><style>g { fill: u&#114;l(https://example.com/x.svg) }</style></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><a href="javascript:alert(1)"/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="u&#114;l(https://example.com/x.svg)"/></svg>"#.as_slice(),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text>&#0;</text></svg>"#.as_slice(),
        ] {
            assert!(
                validate_svg(svg).is_err(),
                "unsafe SVG unexpectedly accepted: {}",
                String::from_utf8_lossy(svg)
            );
        }
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

        let parameterized_svg = serve_once(
            "200 OK",
            "image/svg+xml; charset=utf-8",
            br#"<svg width="1" height="1"/>"#.to_vec(),
            Duration::ZERO,
        );
        let mime_error = post_diagram(parameterized_svg, "d2", "a -> b", false)
            .await
            .unwrap_err();
        assert_eq!(mime_error.code, "invalid-response");
    }

    #[tokio::test]
    async fn d2_requests_svg_and_returns_validated_svg_data_url() {
        let body = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><path d="M0 0"/></svg>"#
            .to_vec();
        let (endpoint, request) =
            serve_once_capturing_request("200 OK", "image/svg+xml", body.clone(), Duration::ZERO);

        let result = post_diagram(endpoint, "d2", "a -> b", false).await.unwrap();
        let request = request.recv_timeout(Duration::from_secs(1)).unwrap();

        assert!(request.starts_with("POST /d2/svg HTTP/1.1"));
        assert!(request
            .lines()
            .any(|line| line.eq_ignore_ascii_case("accept: image/svg+xml")));
        assert_eq!((result.width, result.height), (320, 180));
        assert_eq!(
            result.data_url,
            format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(body)
            )
        );
    }

    #[tokio::test]
    async fn non_d2_requests_remain_png() {
        let (endpoint, request) =
            serve_once_capturing_request("200 OK", "image/png", png_header(2, 3), Duration::ZERO);

        let result = post_diagram(endpoint, "graphviz", "digraph {}", false)
            .await
            .unwrap();
        let request = request.recv_timeout(Duration::from_secs(1)).unwrap();

        assert!(request.starts_with("POST /graphviz/png HTTP/1.1"));
        assert!(request
            .lines()
            .any(|line| line.eq_ignore_ascii_case("accept: image/png")));
        assert!(result.data_url.starts_with("data:image/png;base64,"));
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
