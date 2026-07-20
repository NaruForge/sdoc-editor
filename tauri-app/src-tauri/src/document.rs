use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// .sdoc envelope structure
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

/// Unwrap an .sdoc file: handles both envelope and legacy bare doc formats.
pub fn unwrap_sdoc(value: &serde_json::Value) -> (SdocMeta, serde_json::Value) {
    if let Some(sdoc_version) = value.get("sdoc").and_then(|v| v.as_str()) {
        let meta: SdocMeta = value
            .get("meta")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();
        let doc = value
            .get("doc")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"type": "doc", "content": []}));
        let _ = sdoc_version; // used for future version checks
        (meta, migrate_attributes(doc))
    } else if value.get("type").and_then(|v| v.as_str()) == Some("doc") {
        // Legacy bare doc
        (SdocMeta::default(), migrate_attributes(value.clone()))
    } else {
        (
            SdocMeta::default(),
            serde_json::json!({"type": "doc", "content": []}),
        )
    }
}

/// Wrap doc + meta back into .sdoc envelope format.
pub fn wrap_sdoc(meta: &SdocMeta, doc: &serde_json::Value) -> SdocEnvelope {
    SdocEnvelope {
        sdoc: "1.0".to_string(),
        meta: meta.clone(),
        doc: doc.clone(),
    }
}

/// Migrate legacy attribute names (data-caption → caption, etc.)
fn migrate_attributes(mut node: serde_json::Value) -> serde_json::Value {
    if let Some(attrs) = node.get_mut("attrs").and_then(|a| a.as_object_mut()) {
        let renames: Vec<(String, String)> = attrs
            .keys()
            .filter(|k| k.starts_with("data-"))
            .map(|k| (k.clone(), k.trim_start_matches("data-").to_string()))
            .collect();
        for (old, new) in renames {
            if let Some(val) = attrs.remove(&old) {
                attrs.insert(new, val);
            }
        }
    }
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            *child = migrate_attributes(child.clone());
        }
    }
    node
}

/// Extract title from first H1 heading in document.
pub fn extract_title(doc: &serde_json::Value) -> Option<String> {
    let content = doc.get("content")?.as_array()?;
    for node in content {
        if node.get("type").and_then(|t| t.as_str()) == Some("heading")
            && node
                .get("attrs")
                .and_then(|a| a.get("level"))
                .and_then(|l| l.as_u64())
                == Some(1)
        {
            return Some(get_text_content(node));
        }
    }
    None
}

fn get_text_content(node: &serde_json::Value) -> String {
    let mut result = String::new();
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        result.push_str(text);
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            result.push_str(&get_text_content(child));
        }
    }
    result
}

/// Assign auto IDs to headings, images, and tables.
pub fn assign_auto_ids(doc: &mut serde_json::Value) {
    let mut used_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut img_counter = 0u32;
    let mut table_counter = 0u32;

    if let Some(content) = doc.get_mut("content").and_then(|c| c.as_array_mut()) {
        for node in content.iter_mut() {
            let node_type = node
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            match node_type.as_str() {
                "heading" => {
                    let level = node
                        .get("attrs")
                        .and_then(|a| a.get("level"))
                        .and_then(|l| l.as_u64())
                        .unwrap_or(1);
                    if level == 1 {
                        img_counter = 0;
                        table_counter = 0;
                    }
                    let text = get_text_content(node);
                    let base_id = slugify(&text);
                    let id = make_unique_id(&base_id, &mut used_ids);
                    let attrs = node
                        .as_object_mut()
                        .unwrap()
                        .entry("attrs")
                        .or_insert_with(|| serde_json::json!({}));
                    attrs
                        .as_object_mut()
                        .unwrap()
                        .insert("id".to_string(), serde_json::json!(id));
                }
                "image" => {
                    img_counter += 1;
                    let base_id = format!("figure-{}", img_counter);
                    let id = make_unique_id(&base_id, &mut used_ids);
                    let attrs = node
                        .as_object_mut()
                        .unwrap()
                        .entry("attrs")
                        .or_insert_with(|| serde_json::json!({}));
                    attrs
                        .as_object_mut()
                        .unwrap()
                        .insert("id".to_string(), serde_json::json!(id));
                }
                "table" => {
                    table_counter += 1;
                    let base_id = format!("table-{}", table_counter);
                    let id = make_unique_id(&base_id, &mut used_ids);
                    let attrs = node
                        .as_object_mut()
                        .unwrap()
                        .entry("attrs")
                        .or_insert_with(|| serde_json::json!({}));
                    attrs
                        .as_object_mut()
                        .unwrap()
                        .insert("id".to_string(), serde_json::json!(id));
                }
                _ => {}
            }
        }
    }
}

fn slugify(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || ('\u{AC00}'..='\u{D7A3}').contains(&c)
            {
                c
            } else if c == ' ' {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(|c: char| c == '-' || c == '_')
        .to_string()
}

fn make_unique_id(base: &str, used: &mut std::collections::HashSet<String>) -> String {
    let id = if base.is_empty() {
        "id".to_string()
    } else {
        base.to_string()
    };
    if used.insert(id.clone()) {
        return id;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{}-{}", id, n);
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

/// Sync cross-reference link texts with current numbering.
pub fn sync_cross_references(doc: &mut serde_json::Value) {
    // Build id → label map
    let label_map = build_label_map(doc);

    // Update all link texts
    update_link_texts(doc, &label_map);
}

fn build_label_map(doc: &serde_json::Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut h1 = 0u32;
    let mut h2 = 0u32;
    let mut h3 = 0u32;
    let mut img_counter = 0u32;
    let mut table_counter = 0u32;

    if let Some(content) = doc.get("content").and_then(|c| c.as_array()) {
        for node in content {
            let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match node_type {
                "heading" => {
                    let level = node
                        .get("attrs")
                        .and_then(|a| a.get("level"))
                        .and_then(|l| l.as_u64())
                        .unwrap_or(1);
                    match level {
                        1 => {
                            h1 += 1;
                            h2 = 0;
                            h3 = 0;
                            img_counter = 0;
                            table_counter = 0;
                        }
                        2 => {
                            h2 += 1;
                            h3 = 0;
                        }
                        3 => {
                            h3 += 1;
                        }
                        _ => {}
                    }
                    if let Some(id) = node
                        .get("attrs")
                        .and_then(|a| a.get("id"))
                        .and_then(|i| i.as_str())
                    {
                        let text = get_text_content(node);
                        let label = match level {
                            1 => format!("{}. {}", h1, text),
                            2 => format!("{}.{}. {}", h1, h2, text),
                            3 => format!("{}.{}.{}. {}", h1, h2, h3, text),
                            _ => text,
                        };
                        map.insert(id.to_string(), label);
                    }
                }
                "image" => {
                    img_counter += 1;
                    if let Some(id) = node
                        .get("attrs")
                        .and_then(|a| a.get("id"))
                        .and_then(|i| i.as_str())
                    {
                        let caption = node
                            .get("attrs")
                            .and_then(|a| a.get("caption"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("");
                        let label = if caption.is_empty() {
                            format!("Figure {}", img_counter)
                        } else {
                            format!("Figure {}: {}", img_counter, caption)
                        };
                        map.insert(id.to_string(), label);
                    }
                }
                "table" => {
                    table_counter += 1;
                    if let Some(id) = node
                        .get("attrs")
                        .and_then(|a| a.get("id"))
                        .and_then(|i| i.as_str())
                    {
                        let caption = node
                            .get("attrs")
                            .and_then(|a| a.get("caption"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("");
                        let label = if caption.is_empty() {
                            format!("Table {}", table_counter)
                        } else {
                            format!("Table {}: {}", table_counter, caption)
                        };
                        map.insert(id.to_string(), label);
                    }
                }
                _ => {}
            }
        }
    }
    map
}

fn update_link_texts(node: &mut serde_json::Value, label_map: &HashMap<String, String>) {
    // Check marks for internal links and collect the new label if any
    let new_label = node
        .get("marks")
        .and_then(|m| m.as_array())
        .and_then(|marks| {
            for mark in marks {
                if mark.get("type").and_then(|t| t.as_str()) == Some("link") {
                    if let Some(href) = mark
                        .get("attrs")
                        .and_then(|a| a.get("href"))
                        .and_then(|h| h.as_str())
                    {
                        if let Some(target_id) = href.strip_prefix('#') {
                            if let Some(label) = label_map.get(target_id) {
                                return Some(label.clone());
                            }
                        }
                    }
                }
            }
            None
        });

    if let Some(label) = new_label {
        if let Some(text) = node.get_mut("text") {
            *text = serde_json::json!(label);
        }
    }

    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        for child in content.iter_mut() {
            update_link_texts(child, label_map);
        }
    }
}

/// Clean trailing whitespace from text nodes.
pub fn clean_text_nodes(node: &mut serde_json::Value) {
    if let Some(content) = node.get_mut("content").and_then(|c| c.as_array_mut()) {
        // Recurse into children
        for child in content.iter_mut() {
            clean_text_nodes(child);
        }
        // Trim trailing whitespace on last text node
        if let Some(last) = content.last_mut() {
            if last.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(text) = last
                    .get_mut("text")
                    .and_then(|t| t.as_str().map(|s| s.to_string()))
                {
                    let trimmed = text.trim_end().to_string();
                    if trimmed.is_empty() {
                        content.pop();
                    } else {
                        last.as_object_mut()
                            .unwrap()
                            .insert("text".to_string(), serde_json::json!(trimmed));
                    }
                }
            }
        }
    }
}
