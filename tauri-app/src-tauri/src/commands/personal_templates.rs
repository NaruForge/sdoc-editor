use super::validate_schema_document;
use crate::atomic_write::{atomic_create_new, atomic_write};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_PERSONAL_TEMPLATES: usize = 100;
const MAX_TEMPLATE_BYTES: u64 = 2 * 1024 * 1024;
const MUTATION_LOCK_STALE_MILLIS: u128 = 5 * 60 * 1000;
const STORAGE_SCOPE: &str = "local-user-home";
static TRASH_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static MUTATION_LOCK: Mutex<()> = Mutex::new(());

struct PersonalTemplateStore {
    root: PathBuf,
    trash: PathBuf,
}

struct PersonalTemplateIdentity {
    intrinsic_id: String,
    storage_id: String,
}

struct MutationFileLock {
    path: PathBuf,
    owner: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MutationLockLease {
    owner: String,
    created_at: u128,
}

impl MutationFileLock {
    fn acquire(root: &Path) -> Result<Self, String> {
        let path = root.join(".mutation.lock");
        let owner = format!(
            "rust-{}-{}",
            std::process::id(),
            TRASH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let lease = MutationLockLease {
            owner: owner.clone(),
            created_at: now_millis()?,
        };
        let payload = serde_json::to_vec(&lease).map_err(|error| error.to_string())?;
        for _ in 0..2 {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    if let Err(error) = file.write_all(&payload).and_then(|_| file.sync_all()) {
                        drop(file);
                        let _ = fs::remove_file(&path);
                        return Err(error.to_string());
                    }
                    return Ok(Self { path, owner });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.to_string()),
            }

            let existing = fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<MutationLockLease>(&bytes).ok());
            let created_at = match existing {
                Some(lease) => lease.created_at,
                None => fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .map_err(|error| error.to_string())?
                    .duration_since(UNIX_EPOCH)
                    .map_err(|error| error.to_string())?
                    .as_millis(),
            };
            if now_millis()?.saturating_sub(created_at) <= MUTATION_LOCK_STALE_MILLIS {
                return Err(
                    "Another host is already changing the personal template library".to_string(),
                );
            }
            let stale_path = root.join(format!(
                ".mutation.lock.stale.{}.{}",
                std::process::id(),
                TRASH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::rename(&path, &stale_path) {
                Ok(()) => {
                    let _ = fs::remove_file(stale_path);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("Unable to acquire the personal template library mutation lock".to_string())
    }
}

impl Drop for MutationFileLock {
    fn drop(&mut self) {
        let owned = fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<MutationLockLease>(&bytes).ok())
            .is_some_and(|lease| lease.owner == self.owner);
        if owned {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn now_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| error.to_string())
}

impl PersonalTemplateStore {
    fn from_default_home() -> Result<Self, String> {
        let home = dirs::home_dir().ok_or("Unable to resolve the user home directory")?;
        Self::from_home_root(&home)
    }

    fn from_home_root(home: &Path) -> Result<Self, String> {
        let canonical_home = home.canonicalize().map_err(|error| error.to_string())?;
        if !canonical_home.is_dir() {
            return Err("The user home path is not a directory".to_string());
        }
        let managed = ensure_contained_directory(&canonical_home, &home.join(".sdoc"))?;
        let root = ensure_contained_directory(&managed, &managed.join("templates"))?;
        let trash = ensure_contained_directory(&root, &root.join(".trash"))?;
        Ok(Self { root, trash })
    }

    fn list(&self) -> Result<PersonalTemplateDiscovery, String> {
        let mut diagnostics = Vec::new();
        let mut entries = Vec::new();
        for entry_result in fs::read_dir(&self.root).map_err(|error| error.to_string())? {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "read-failed".to_string(),
                        path: self.root.to_string_lossy().to_string(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            if entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("sdoc"))
            {
                entries.push(entry);
            }
        }
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

        let mut candidates = Vec::new();
        for (index, entry) in entries.into_iter().enumerate() {
            let display_path = entry.path();
            if index >= MAX_PERSONAL_TEMPLATES {
                diagnostics.push(PersonalTemplateDiagnostic {
                    code: "candidate-limit-exceeded".to_string(),
                    path: display_path.to_string_lossy().to_string(),
                    message: format!(
                        "Only the first {MAX_PERSONAL_TEMPLATES} personal templates are loaded"
                    ),
                });
                break;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let storage_id = match template_id_from_file_name(&file_name) {
                Ok(id) => id,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "unsafe-path".to_string(),
                        path: display_path.to_string_lossy().to_string(),
                        message: error,
                    });
                    continue;
                }
            };
            let canonical = match validate_existing_template_path(&self.root, &display_path) {
                Ok(path) => path,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "unsafe-path".to_string(),
                        path: display_path.to_string_lossy().to_string(),
                        message: error,
                    });
                    continue;
                }
            };
            let metadata = match canonical.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "read-failed".to_string(),
                        path: display_path.to_string_lossy().to_string(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            if metadata.len() > MAX_TEMPLATE_BYTES {
                diagnostics.push(PersonalTemplateDiagnostic {
                    code: "file-too-large".to_string(),
                    path: display_path.to_string_lossy().to_string(),
                    message: format!("Template exceeds the {MAX_TEMPLATE_BYTES} byte limit"),
                });
                continue;
            }
            let bytes = match fs::read(&canonical) {
                Ok(bytes) => bytes,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "read-failed".to_string(),
                        path: display_path.to_string_lossy().to_string(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let raw_source = match String::from_utf8(bytes.clone()) {
                Ok(source) => source,
                Err(error) => {
                    diagnostics.push(PersonalTemplateDiagnostic {
                        code: "read-failed".to_string(),
                        path: display_path.to_string_lossy().to_string(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            candidates.push(PersonalTemplateCandidate {
                storage_id,
                file_name,
                raw_source,
                fingerprint: fingerprint(&bytes),
                size_bytes: bytes.len() as u64,
            });
        }

        Ok(PersonalTemplateDiscovery {
            library_path: self.root.to_string_lossy().to_string(),
            storage_scope: STORAGE_SCOPE.to_string(),
            candidates,
            diagnostics,
        })
    }

    fn create(
        &self,
        template_id: &str,
        envelope: &Value,
    ) -> Result<PersonalTemplateReceipt, String> {
        let _guard = MUTATION_LOCK.lock().map_err(|error| error.to_string())?;
        let _file_lock = MutationFileLock::acquire(&self.root)?;
        let identity = validate_template_id(template_id)?;
        let bytes = serialize_template(&identity.intrinsic_id, envelope)?;
        let target = self.root.join(format!("{}.sdoc", identity.storage_id));
        validate_new_template_target(&self.root, &target)?;
        ensure_template_capacity(&self.root)?;
        atomic_create_new(&target, &bytes)?;
        Ok(PersonalTemplateReceipt {
            template_id: identity.intrinsic_id,
            file_name: target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            fingerprint: fingerprint(&bytes),
        })
    }

    fn update(
        &self,
        template_id: &str,
        expected_fingerprint: &str,
        envelope: &Value,
    ) -> Result<PersonalTemplateReceipt, String> {
        let _guard = MUTATION_LOCK.lock().map_err(|error| error.to_string())?;
        let _file_lock = MutationFileLock::acquire(&self.root)?;
        let identity = validate_template_id(template_id)?;
        let target = self.root.join(format!("{}.sdoc", identity.storage_id));
        let (_, current_bytes) =
            read_current_template(&self.root, &target, &identity.intrinsic_id)?;
        validate_expected_fingerprint(expected_fingerprint, &current_bytes)?;
        let new_bytes = serialize_template(&identity.intrinsic_id, envelope)?;
        atomic_write(&target, &new_bytes)?;
        Ok(PersonalTemplateReceipt {
            template_id: identity.intrinsic_id,
            file_name: target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            fingerprint: fingerprint(&new_bytes),
        })
    }

    fn trash(
        &self,
        template_id: &str,
        expected_fingerprint: &str,
    ) -> Result<PersonalTemplateTrashReceipt, String> {
        let _guard = MUTATION_LOCK.lock().map_err(|error| error.to_string())?;
        let _file_lock = MutationFileLock::acquire(&self.root)?;
        let identity = validate_template_id(template_id)?;
        let target = self.root.join(format!("{}.sdoc", identity.storage_id));
        let (_, current_bytes) =
            read_current_template(&self.root, &target, &identity.intrinsic_id)?;
        validate_expected_fingerprint(expected_fingerprint, &current_bytes)?;

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let sequence = TRASH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let current_fingerprint = fingerprint(&current_bytes);
        let trash_file_name = format!(
            "{}.{timestamp}.{sequence}.{}.sdoc",
            identity.storage_id,
            &current_fingerprint["sha256:".len().."sha256:".len() + 12]
        );
        let destination = self.trash.join(&trash_file_name);
        validate_new_template_target(&self.trash, &destination)?;
        fs::hard_link(&target, &destination).map_err(|error| error.to_string())?;
        if let Err(error) = fs::remove_file(&target) {
            let _ = fs::remove_file(&destination);
            return Err(error.to_string());
        }
        Ok(PersonalTemplateTrashReceipt {
            template_id: identity.intrinsic_id,
            trash_file_name,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTemplateDiscovery {
    pub library_path: String,
    pub storage_scope: String,
    pub candidates: Vec<PersonalTemplateCandidate>,
    pub diagnostics: Vec<PersonalTemplateDiagnostic>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTemplateCandidate {
    pub storage_id: String,
    pub file_name: String,
    pub raw_source: String,
    pub fingerprint: String,
    pub size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTemplateDiagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTemplateReceipt {
    pub template_id: String,
    pub file_name: String,
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTemplateTrashReceipt {
    pub template_id: String,
    pub trash_file_name: String,
}

fn ensure_contained_directory(boundary: &Path, path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        match fs::create_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_dir() || !canonical.starts_with(boundary) {
        return Err(format!(
            "Managed template directory escapes its allowed boundary: {}",
            path.display()
        ));
    }
    Ok(canonical)
}

fn validate_template_id(template_id: &str) -> Result<PersonalTemplateIdentity, String> {
    let storage_id = template_id
        .strip_prefix("user:")
        .ok_or_else(|| "Personal template id must use the user:<uuid> namespace".to_string())?;
    let canonical_storage_id = validate_storage_id(storage_id)?;
    Ok(PersonalTemplateIdentity {
        intrinsic_id: format!("user:{canonical_storage_id}"),
        storage_id: canonical_storage_id,
    })
}

fn validate_storage_id(storage_id: &str) -> Result<String, String> {
    let parsed = Uuid::parse_str(storage_id)
        .map_err(|_| "Personal template storage id must be a canonical UUID".to_string())?;
    let canonical = parsed.hyphenated().to_string();
    if storage_id != canonical {
        return Err(
            "Personal template storage id must use lowercase canonical UUID form".to_string(),
        );
    }
    Ok(canonical)
}

fn template_id_from_file_name(file_name: &str) -> Result<String, String> {
    let lower = file_name.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".sdoc")
        .ok_or_else(|| "Personal template filename must end with .sdoc".to_string())?;
    validate_storage_id(stem)
}

fn validate_existing_template_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let link_metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if link_metadata.file_type().is_symlink() {
        return Err("Personal template symlinks are not allowed".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("Personal template path escapes the managed library".to_string());
    }
    Ok(canonical)
}

fn validate_new_template_target(root: &Path, target: &Path) -> Result<(), String> {
    match fs::symlink_metadata(target) {
        Ok(_) => {
            return Err("A personal template with this id already exists".to_string());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Personal template target has no parent".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if parent != root {
        return Err("Personal template target escapes the managed library".to_string());
    }
    Ok(())
}

fn ensure_template_capacity(root: &Path) -> Result<(), String> {
    let mut count = 0usize;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sdoc"))
        {
            count += 1;
        }
    }
    if count >= MAX_PERSONAL_TEMPLATES {
        return Err(format!(
            "Personal template limit of {MAX_PERSONAL_TEMPLATES} has been reached"
        ));
    }
    Ok(())
}

fn serialize_template(template_id: &str, envelope: &Value) -> Result<Vec<u8>, String> {
    validate_schema_document(envelope)?;
    let envelope_id = envelope
        .get("meta")
        .and_then(|meta| meta.get("template"))
        .and_then(|template| template.get("id"))
        .and_then(Value::as_str)
        .ok_or("Personal template envelope is missing meta.template.id")?;
    if envelope_id != template_id {
        return Err("Personal template envelope id does not match its storage id".to_string());
    }
    let bytes = serde_json::to_vec_pretty(envelope).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(format!(
            "Personal template exceeds the {MAX_TEMPLATE_BYTES} byte limit"
        ));
    }
    Ok(bytes)
}

fn read_current_template(
    root: &Path,
    target: &Path,
    template_id: &str,
) -> Result<(Value, Vec<u8>), String> {
    let canonical = validate_existing_template_path(root, target)?;
    let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(format!(
            "Personal template exceeds the {MAX_TEMPLATE_BYTES} byte limit"
        ));
    }
    let envelope: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    validate_schema_document(&envelope)?;
    let existing_id = envelope
        .get("meta")
        .and_then(|meta| meta.get("template"))
        .and_then(|template| template.get("id"))
        .and_then(Value::as_str)
        .ok_or("Stored personal template is missing meta.template.id")?;
    if existing_id != template_id {
        return Err("Stored personal template id does not match its filename".to_string());
    }
    Ok((envelope, bytes))
}

fn fingerprint(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn validate_expected_fingerprint(expected: &str, current_bytes: &[u8]) -> Result<(), String> {
    let current = fingerprint(current_bytes);
    if expected != current {
        return Err("Personal template changed since the catalog was loaded".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn list_personal_template_candidates() -> Result<PersonalTemplateDiscovery, String> {
    PersonalTemplateStore::from_default_home()?.list()
}

#[tauri::command]
pub fn create_personal_template(
    template_id: String,
    envelope: Value,
) -> Result<PersonalTemplateReceipt, String> {
    PersonalTemplateStore::from_default_home()?.create(&template_id, &envelope)
}

#[tauri::command]
pub fn update_personal_template(
    template_id: String,
    expected_fingerprint: String,
    envelope: Value,
) -> Result<PersonalTemplateReceipt, String> {
    PersonalTemplateStore::from_default_home()?.update(
        &template_id,
        &expected_fingerprint,
        &envelope,
    )
}

#[tauri::command]
pub fn trash_personal_template(
    template_id: String,
    expected_fingerprint: String,
) -> Result<PersonalTemplateTrashReceipt, String> {
    PersonalTemplateStore::from_default_home()?.trash(&template_id, &expected_fingerprint)
}

#[tauri::command]
pub fn reveal_personal_template_library() -> Result<String, String> {
    let store = PersonalTemplateStore::from_default_home()?;
    open::that(&store.root).map_err(|error| error.to_string())?;
    Ok(store.root.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    const FIRST_STORAGE_ID: &str = "11111111-1111-4111-8111-111111111111";
    const SECOND_STORAGE_ID: &str = "22222222-2222-4222-8222-222222222222";
    const FIRST_ID: &str = "user:11111111-1111-4111-8111-111111111111";
    const SECOND_ID: &str = "user:22222222-2222-4222-8222-222222222222";

    fn temp_home(label: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!(
            "sdoc-personal-{label}-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    fn envelope(template_id: &str, title: &str) -> Value {
        serde_json::json!({
            "sdoc": "1.0",
            "meta": {
                "title": title,
                "template": {
                    "id": template_id,
                    "name": title
                }
            },
            "doc": {
                "type": "doc",
                "content": [{
                    "type": "heading",
                    "attrs": { "level": 1, "id": "document-title" },
                    "content": [{ "type": "text", "text": title }]
                }]
            }
        })
    }

    #[test]
    fn creates_the_managed_library_under_the_injected_home() {
        let home = temp_home("root");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();

        assert_eq!(
            store.root,
            home.canonicalize().unwrap().join(".sdoc").join("templates")
        );
        assert!(store.root.is_dir());
        assert!(store.root.join(".trash").is_dir());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_traversal_and_preserves_an_existing_template_on_collision() {
        let home = temp_home("collision");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();

        assert!(store
            .create("user:../escape", &envelope(FIRST_ID, "Escape"))
            .is_err());
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Original"))
            .unwrap();
        assert_eq!(created.template_id, FIRST_ID);
        assert!(store
            .create(FIRST_ID, &envelope(FIRST_ID, "Replacement"))
            .is_err());
        let raw = fs::read_to_string(store.root.join(format!("{FIRST_STORAGE_ID}.sdoc"))).unwrap();
        assert!(raw.contains("Original"));
        assert!(!raw.contains("Replacement"));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_an_envelope_whose_intrinsic_id_does_not_match_storage() {
        let home = temp_home("id-mismatch");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();

        let error = store
            .create(FIRST_ID, &envelope(SECOND_ID, "Mismatched"))
            .unwrap_err();
        assert!(error.contains("does not match"));
        assert!(!store.root.join(format!("{FIRST_STORAGE_ID}.sdoc")).exists());

        let mut legacy_attrs = envelope(FIRST_ID, "Legacy attrs");
        legacy_attrs["doc"]["content"] = serde_json::json!([{
            "type": "image",
            "attrs": { "src": "./images/example.png", "data-caption": "Legacy" }
        }]);
        assert!(store.create(FIRST_ID, &legacy_attrs).is_err());
        assert!(!store.root.join(format!("{FIRST_STORAGE_ID}.sdoc")).exists());

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn enforces_personal_template_size_and_catalog_count_limits() {
        let home = temp_home("limits");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let oversized_id = "user:ffffffff-ffff-4fff-8fff-ffffffffffff";
        let mut oversized = envelope(oversized_id, "Oversized");
        oversized["doc"]["content"][0]["content"][0]["text"] =
            Value::String("x".repeat(MAX_TEMPLATE_BYTES as usize));
        assert!(store.create(oversized_id, &oversized).is_err());

        for index in 1..=MAX_PERSONAL_TEMPLATES {
            let storage_id = Uuid::from_u128(index as u128).hyphenated().to_string();
            fs::write(store.root.join(format!("{storage_id}.sdoc")), b"{}").unwrap();
        }
        assert!(store
            .create(oversized_id, &envelope(oversized_id, "One too many"))
            .is_err());
        let overflow_storage_id = Uuid::from_u128((MAX_PERSONAL_TEMPLATES + 1) as u128)
            .hyphenated()
            .to_string();
        fs::write(
            store.root.join(format!("{overflow_storage_id}.sdoc")),
            b"{}",
        )
        .unwrap();
        let catalog = store.list().unwrap();
        assert_eq!(catalog.candidates.len(), MAX_PERSONAL_TEMPLATES);
        assert!(catalog
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "candidate-limit-exceeded"));

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_stale_updates_and_keeps_existing_bytes() {
        let home = temp_home("stale");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Original"))
            .unwrap();
        let path = store.root.join(format!("{FIRST_STORAGE_ID}.sdoc"));
        let original = fs::read(&path).unwrap();

        assert!(store
            .update(FIRST_ID, "sha256:stale", &envelope(FIRST_ID, "Changed"))
            .is_err());
        assert!(store.trash(FIRST_ID, "sha256:stale").is_err());
        assert_eq!(fs::read(&path).unwrap(), original);

        let updated = store
            .update(
                FIRST_ID,
                &created.fingerprint,
                &envelope(FIRST_ID, "Changed"),
            )
            .unwrap();
        assert_ne!(updated.fingerprint, created.fingerprint);
        assert!(fs::read_to_string(path).unwrap().contains("Changed"));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_a_mutation_while_another_host_owns_the_library_lock() {
        let home = temp_home("locked");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Original"))
            .unwrap();
        let path = store.root.join(format!("{FIRST_STORAGE_ID}.sdoc"));
        let original = fs::read(&path).unwrap();
        fs::write(store.root.join(".mutation.lock"), b"other host").unwrap();

        assert!(store
            .update(
                FIRST_ID,
                &created.fingerprint,
                &envelope(FIRST_ID, "Lost update"),
            )
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn recovers_an_expired_library_lock_left_by_a_crashed_host() {
        let home = temp_home("stale-lock");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Original"))
            .unwrap();
        fs::write(
            store.root.join(".mutation.lock"),
            serde_json::to_vec(&MutationLockLease {
                owner: "crashed-host".to_string(),
                created_at: 0,
            })
            .unwrap(),
        )
        .unwrap();

        store
            .update(
                FIRST_ID,
                &created.fingerprint,
                &envelope(FIRST_ID, "Recovered"),
            )
            .unwrap();
        assert!(
            fs::read_to_string(store.root.join(format!("{FIRST_STORAGE_ID}.sdoc")))
                .unwrap()
                .contains("Recovered")
        );
        assert!(!store.root.join(".mutation.lock").exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn recovers_an_old_partial_lock_payload_left_during_a_crash() {
        let home = temp_home("partial-lock");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Original"))
            .unwrap();
        let lock_path = store.root.join(".mutation.lock");
        fs::write(&lock_path, b"{\"owner\":").unwrap();
        fs::File::options()
            .write(true)
            .open(&lock_path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(UNIX_EPOCH))
            .unwrap();

        store
            .update(
                FIRST_ID,
                &created.fingerprint,
                &envelope(FIRST_ID, "Recovered"),
            )
            .unwrap();
        assert!(!lock_path.exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn moves_deleted_templates_to_internal_trash_and_excludes_them_from_catalog() {
        let home = temp_home("trash");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        let created = store
            .create(FIRST_ID, &envelope(FIRST_ID, "Disposable"))
            .unwrap();

        let receipt = store.trash(FIRST_ID, &created.fingerprint).unwrap();
        assert_eq!(receipt.template_id, FIRST_ID);
        assert!(!store.root.join(format!("{FIRST_STORAGE_ID}.sdoc")).exists());
        assert!(store
            .root
            .join(".trash")
            .join(receipt.trash_file_name)
            .is_file());
        assert!(store.list().unwrap().candidates.is_empty());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn isolates_unsafe_symlink_candidates_and_keeps_valid_templates() {
        let home = temp_home("symlink");
        let store = PersonalTemplateStore::from_home_root(&home).unwrap();
        store
            .create(FIRST_ID, &envelope(FIRST_ID, "Valid"))
            .unwrap();
        let outside = home.join("outside.sdoc");
        fs::write(
            &outside,
            serde_json::to_vec(&envelope(SECOND_ID, "Outside")).unwrap(),
        )
        .unwrap();
        let link = store.root.join(format!("{SECOND_STORAGE_ID}.sdoc"));

        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link).is_ok();

        if linked {
            let catalog = store.list().unwrap();
            assert_eq!(catalog.candidates.len(), 1);
            assert_eq!(catalog.candidates[0].storage_id, FIRST_STORAGE_ID);
        }
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_a_template_root_symlink_that_escapes_home() {
        let home = temp_home("root-symlink");
        let outside = temp_home("root-symlink-outside");
        fs::create_dir(home.join(".sdoc")).unwrap();
        let link = home.join(".sdoc").join("templates");

        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, &link).is_ok();

        if linked {
            assert!(PersonalTemplateStore::from_home_root(&home).is_err());
        }
        fs::remove_dir_all(home).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
