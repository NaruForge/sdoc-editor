use serde::{Deserialize, Serialize};

/// Persisted `.sdoc` envelope. Semantic document normalization is owned by
/// `shared/document/sdocUtils.ts`; the native host only transports the JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdocEnvelope {
    pub sdoc: String,
    pub meta: SdocMeta,
    pub doc: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SdocMeta {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
}

/// Read envelope metadata while preserving document content byte-for-byte at
/// the JSON-value level. The shared TypeScript boundary performs migration.
pub fn unwrap_sdoc(value: &serde_json::Value) -> (SdocMeta, serde_json::Value) {
    if value
        .get("sdoc")
        .and_then(|version| version.as_str())
        .is_some()
    {
        let meta = value
            .get("meta")
            .and_then(|meta| serde_json::from_value(meta.clone()).ok())
            .unwrap_or_default();
        let doc = value.get("doc").cloned().unwrap_or_else(empty_document);
        return (meta, doc);
    }

    if value.get("type").and_then(|node_type| node_type.as_str()) == Some("doc") {
        return (SdocMeta::default(), value.clone());
    }

    (SdocMeta::default(), empty_document())
}

pub fn wrap_sdoc(meta: &SdocMeta, doc: &serde_json::Value) -> SdocEnvelope {
    SdocEnvelope {
        sdoc: "1.0".to_string(),
        meta: meta.clone(),
        doc: doc.clone(),
    }
}

fn empty_document() -> serde_json::Value {
    serde_json::json!({ "type": "doc", "content": [] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/document-contract.json"
        ))
        .expect("shared document contract fixture must be valid JSON")
    }

    #[test]
    fn rust_host_preserves_legacy_content_for_typescript_migration() {
        let fixture = contract_fixture();
        let input = &fixture["legacyMigration"]["input"];
        let (_, doc) = unwrap_sdoc(input);
        assert_eq!(&doc, input);
    }

    #[test]
    fn envelope_round_trip_preserves_shared_contract_content_and_settings() {
        let fixture = contract_fixture();
        let envelope_input = &fixture["envelope"]["input"];
        let (meta, _) = unwrap_sdoc(envelope_input);
        let normalized_doc = fixture["normalization"]["doc"].clone();
        let wrapped = wrap_sdoc(&meta, &normalized_doc);
        let serialized = serde_json::to_value(wrapped).expect("envelope must serialize");
        let (round_trip_meta, round_trip_doc) = unwrap_sdoc(&serialized);

        assert_eq!(round_trip_doc, normalized_doc);
        assert_eq!(round_trip_meta.title, "Contract");
        assert_eq!(round_trip_meta.author, "Tester");
        assert_eq!(
            round_trip_meta.settings,
            Some(serde_json::json!({
                "captionStyle": "korean",
                "equationNumbering": "hierarchical"
            }))
        );
    }

    #[test]
    fn malformed_input_becomes_an_empty_document() {
        let (_, doc) = unwrap_sdoc(&serde_json::json!({ "unexpected": true }));
        assert_eq!(doc, empty_document());
    }
}
