use super::DocState;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"];

pub(super) fn validate_plain_basename(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
    {
        return Err("Asset name must be a plain file name".into());
    }

    let device_stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(device_stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device_stem
            .strip_prefix("COM")
            .or_else(|| device_stem.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'));
    if reserved {
        return Err("Asset name is reserved by Windows".into());
    }
    Ok(name)
}

fn normalize_extension(extension: &str, allowed: &[&str]) -> Result<String, String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if extension.is_empty()
        || !extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        || !allowed.contains(&extension.as_str())
    {
        return Err(format!("Unsupported asset extension: {extension}"));
    }
    Ok(extension)
}

pub(super) fn normalize_image_filename(name: &str, extension: &str) -> Result<String, String> {
    let name = validate_plain_basename(name)?;
    let extension = normalize_extension(extension, IMAGE_EXTENSIONS)?;
    if name
        .to_ascii_lowercase()
        .ends_with(&format!(".{extension}"))
    {
        Ok(name.to_string())
    } else {
        Ok(format!("{name}.{extension}"))
    }
}

pub(super) fn normalize_drawio_filename(name: &str) -> Result<String, String> {
    let name = validate_plain_basename(name)?;
    let lower = name.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".drawio.svg")
        .or_else(|| lower.strip_suffix(".drawio"))
        .map(|suffixless| &name[..suffixless.len()])
        .unwrap_or(name);
    if stem.is_empty() {
        return Err("Draw.io file name cannot be empty".into());
    }
    Ok(format!("{stem}.drawio.svg"))
}

fn validate_image_source(path: &Path) -> Result<(), String> {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Image source must have a Unicode file name")?;
    validate_plain_basename(filename)?;
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .ok_or("Image source is missing an extension")?;
    normalize_extension(extension, IMAGE_EXTENSIONS)?;
    Ok(())
}

fn validate_drawio_source(path: &Path) -> Result<(), String> {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Draw.io source must have a Unicode file name")?;
    validate_plain_basename(filename)?;
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".drawio.svg") || lower.ends_with(".drawio") {
        Ok(())
    } else {
        Err("Draw.io source must end with .drawio or .drawio.svg".into())
    }
}

fn prepare_asset_dir(doc_path: &Path, directory: &str) -> Result<PathBuf, String> {
    let doc_dir = doc_path.parent().ok_or("Invalid document path")?;
    let canonical_doc_dir = doc_dir.canonicalize().map_err(|error| error.to_string())?;
    let asset_dir = doc_dir.join(directory);
    fs::create_dir_all(&asset_dir).map_err(|error| error.to_string())?;
    let canonical_asset_dir = asset_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical_asset_dir.starts_with(&canonical_doc_dir) {
        return Err("Asset directory escapes the document directory".into());
    }
    Ok(canonical_asset_dir)
}

fn compound_name_parts(filename: &str) -> (&str, &str) {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".drawio.svg") {
        (
            &filename[..filename.len() - ".drawio.svg".len()],
            ".drawio.svg",
        )
    } else if let Some(extension) = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
    {
        let suffix_length = extension.len() + 1;
        (
            &filename[..filename.len() - suffix_length],
            &filename[filename.len() - suffix_length..],
        )
    } else {
        (filename, "")
    }
}

pub(super) fn create_unique_asset(dir: &Path, filename: &str) -> Result<(PathBuf, File), String> {
    let (stem, suffix) = compound_name_parts(filename);
    for number in 1..=10_000 {
        let candidate_name = if number == 1 {
            filename.to_string()
        } else {
            format!("{stem}-{number}{suffix}")
        };
        let candidate = dir.join(candidate_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not allocate a unique asset file name".into())
}

fn copy_exclusive(source: &Path, dir: &Path, filename: &str) -> Result<PathBuf, String> {
    let (target, mut output) = create_unique_asset(dir, filename)?;
    let result = (|| {
        let mut input = File::open(source).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|error| error.to_string())?;
        output.flush().map_err(|error| error.to_string())
    })();
    if let Err(error) = result {
        drop(output);
        let _ = fs::remove_file(&target);
        return Err(error);
    }
    Ok(target)
}

fn validated_relative_asset(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("Asset path must be document-relative".into());
    }
    let mut normal_components = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(value) => normal_components.push(value),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Asset path cannot escape the document directory".into());
            }
        }
    }
    if normal_components.len() < 2
        || !matches!(normal_components[0].to_str(), Some("images" | "drawio"))
    {
        return Err("Asset path must be inside ./images or ./drawio".into());
    }
    Ok(normal_components.iter().collect())
}

pub(super) fn canonical_asset_path(
    doc_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = validated_relative_asset(relative_path)?;
    let asset_kind = relative
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .ok_or("Asset path has no valid root directory")?
        .to_string();
    let doc_dir = doc_path.parent().ok_or("Invalid document path")?;
    let canonical_doc_dir = doc_dir.canonicalize().map_err(|error| error.to_string())?;
    let candidate = doc_dir
        .join(relative)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !candidate.starts_with(&canonical_doc_dir) || !candidate.is_file() {
        return Err("Asset path is outside the document directory or is not a file".into());
    }
    match asset_kind.as_str() {
        "images" => validate_image_source(&candidate)?,
        "drawio" => validate_drawio_source(&candidate)?,
        _ => return Err("Asset path must be inside ./images or ./drawio".into()),
    }
    Ok(candidate)
}

fn canonical_drawio_path(doc_path: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical_doc_dir = doc_path
        .parent()
        .ok_or("Invalid document path")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_drawio_dir = canonical_doc_dir
        .join("drawio")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let canonical_path = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_path.starts_with(&canonical_drawio_dir) || !canonical_path.is_file() {
        return Err("Draw.io path is outside this document's drawio directory".into());
    }
    validate_drawio_source(&canonical_path)?;
    Ok(canonical_path)
}

// ─── Image Operations ───────────────────────────────────────────────

#[tauri::command]
pub fn save_image(
    image_name: String,
    image_data: String, // base64
    extension: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let images_dir = prepare_asset_dir(&doc_path, "images")?;
    let filename = normalize_image_filename(&image_name, &extension)?;

    let bytes = base64_decode(&image_data)?;
    let (target, mut output) = create_unique_asset(&images_dir, &filename)?;
    if let Err(error) = output.write_all(&bytes) {
        drop(output);
        let _ = fs::remove_file(&target);
        return Err(error.to_string());
    }
    let filename = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Generated image name is not valid Unicode")?
        .to_string();

    let relative_path = format!("./images/{}", filename);
    Ok(serde_json::json!({
        "imagePath": relative_path,
        "filePath": target.to_string_lossy(),
        "imageName": image_name,
    }))
}

#[tauri::command]
pub fn copy_image_to_doc(
    source_path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let images_dir = prepare_asset_dir(&doc_path, "images")?;

    let source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !source.is_file() {
        return Err("Image source is not a regular file".into());
    }
    validate_image_source(&source)?;
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();

    let target = copy_exclusive(&source, &images_dir, &filename)?;
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    let relative_path = format!("./images/{}", final_name);
    Ok(serde_json::json!({
        "imagePath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": final_name,
    }))
}

// ─── Draw.io Operations ─────────────────────────────────────────────

#[tauri::command]
pub fn create_drawio_file(
    file_name: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let drawio_dir = prepare_asset_dir(&doc_path, "drawio")?;
    let filename = normalize_drawio_filename(&file_name)?;
    let target = drawio_dir.join(&filename);

    // Write empty SVG that draw.io can open
    let empty_svg = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="1px" height="1px" viewBox="-0.5 -0.5 1 1" content="&lt;mxfile&gt;&lt;diagram&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;"></svg>"#;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("Draw.io file already exists: {filename}")
            } else {
                error.to_string()
            }
        })?;
    if let Err(error) = output.write_all(empty_svg.as_bytes()) {
        drop(output);
        let _ = fs::remove_file(&target);
        return Err(error.to_string());
    }

    let relative_path = format!("./drawio/{}", filename);
    Ok(serde_json::json!({
        "drawioPath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": filename,
    }))
}

#[tauri::command]
pub fn open_drawio_external(path: String, state: tauri::State<DocState>) -> Result<(), String> {
    // Try to open with draw.io desktop app
    let doc_path = state
        .file_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("No file open")?;
    let drawio_path = canonical_drawio_path(&doc_path, Path::new(&path))?;

    // On Windows, try known draw.io desktop locations, then fallback to system default
    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var("PROGRAMFILES").unwrap_or_default();
        let candidates = vec![
            format!("{}\\draw.io\\draw.io.exe", program_files),
            format!("{}\\drawio\\drawio.exe", program_files),
        ];
        for candidate in &candidates {
            if Path::new(candidate).exists() {
                std::process::Command::new(candidate)
                    .arg(&drawio_path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    // Fallback: open with system default application
    open::that(&drawio_path).map_err(|e| {
        format!(
            "Failed to open Draw.io file. Please install draw.io desktop app.\nError: {}",
            e
        )
    })
}

#[tauri::command]
pub fn copy_drawio_to_doc(
    source_path: String,
    state: tauri::State<DocState>,
) -> Result<serde_json::Value, String> {
    let file_path = state.file_path.lock().unwrap().clone();
    let doc_path = file_path.ok_or("No file open")?;
    let drawio_dir = prepare_asset_dir(&doc_path, "drawio")?;

    let source = PathBuf::from(&source_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !source.is_file() {
        return Err("Draw.io source is not a regular file".into());
    }
    validate_drawio_source(&source)?;
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();
    let target = copy_exclusive(&source, &drawio_dir, &filename)?;
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    let relative_path = format!("./drawio/{}", final_name);
    Ok(serde_json::json!({
        "drawioPath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": final_name,
    }))
}

// ─── File Watcher ───────────────────────────────────────────────────

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    // Strip data URI prefix if present
    let pure = if let Some(pos) = data.find(",") {
        &data[pos + 1..]
    } else {
        data
    };

    // Simple base64 decode
    let decoded = pure
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();

    // Use a basic base64 decoder
    base64_decode_impl(&decoded)
}

fn base64_decode_impl(input: &str) -> Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in input.bytes() {
        if c == b'=' {
            break;
        }
        let val = match CHARS.iter().position(|&b| b == c) {
            Some(v) => v as u32,
            None => continue,
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(output)
}

#[cfg(test)]
mod security_tests {
    use super::{
        canonical_asset_path, create_unique_asset, normalize_drawio_filename,
        normalize_image_filename,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sdoc-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_asset_names_that_are_not_plain_basenames() {
        for name in [
            "",
            ".",
            "..",
            "../escape",
            "dir/file",
            r"dir\file",
            "C:escape",
            "CON",
        ] {
            assert!(
                normalize_image_filename(name, "png").is_err(),
                "accepted {name:?}"
            );
            assert!(
                normalize_drawio_filename(name).is_err(),
                "accepted {name:?}"
            );
        }
    }

    #[test]
    fn enforces_supported_asset_extensions() {
        assert_eq!(
            normalize_image_filename("figure", ".PNG").unwrap(),
            "figure.png"
        );
        assert!(normalize_image_filename("figure", "exe").is_err());
        assert_eq!(
            normalize_drawio_filename("architecture").unwrap(),
            "architecture.drawio.svg"
        );
        assert_eq!(
            normalize_drawio_filename("architecture.drawio.svg").unwrap(),
            "architecture.drawio.svg"
        );
    }

    #[test]
    fn resolves_only_existing_assets_inside_the_document_directory() {
        let root = temp_dir("asset-containment");
        let doc = root.join("document.sdoc");
        let images = root.join("images");
        fs::write(&doc, "{}").unwrap();
        fs::create_dir(&images).unwrap();
        fs::write(images.join("inside.png"), b"png").unwrap();
        fs::write(images.join("secret.txt"), b"text").unwrap();
        assert!(canonical_asset_path(&doc, "./images/inside.png").is_ok());
        assert!(canonical_asset_path(&doc, "./images/secret.txt").is_err());
        assert!(canonical_asset_path(&doc, "./images/../../outside.png").is_err());
        assert!(canonical_asset_path(&doc, "./other/file.png").is_err());
        assert!(canonical_asset_path(&doc, "./images/missing.png").is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_unique_assets_without_overwriting_existing_files() {
        let root = temp_dir("exclusive-create");
        fs::write(root.join("diagram.drawio.svg"), b"original").unwrap();

        let (path, mut output) = create_unique_asset(&root, "diagram.drawio.svg").unwrap();
        use std::io::Write;
        output.write_all(b"new").unwrap();
        drop(output);

        assert_eq!(
            fs::read(root.join("diagram.drawio.svg")).unwrap(),
            b"original"
        );
        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "diagram-2.drawio.svg"
        );
        assert_eq!(fs::read(path).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }
}
