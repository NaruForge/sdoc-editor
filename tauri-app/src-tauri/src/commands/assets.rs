use super::{workspace::deduplicate_path, DocState};
use std::fs;
use std::path::{Path, PathBuf};

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
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let images_dir = doc_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = format!("{}.{}", image_name, extension);
    let target = images_dir.join(&filename);

    let bytes = base64_decode(&image_data)?;
    fs::write(&target, bytes).map_err(|e| e.to_string())?;

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
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let images_dir = doc_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();

    // Deduplicate
    let target = deduplicate_path(&images_dir, &filename);
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    fs::copy(&source, &target).map_err(|e| e.to_string())?;

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
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let drawio_dir = doc_dir.join("drawio");
    fs::create_dir_all(&drawio_dir).map_err(|e| e.to_string())?;

    let filename = if file_name.ends_with(".drawio.svg") {
        file_name.clone()
    } else {
        format!("{}.drawio.svg", file_name)
    };
    let target = drawio_dir.join(&filename);

    // Write empty SVG that draw.io can open
    let empty_svg = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="1px" height="1px" viewBox="-0.5 -0.5 1 1" content="&lt;mxfile&gt;&lt;diagram&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;"></svg>"#;
    fs::write(&target, empty_svg).map_err(|e| e.to_string())?;

    let relative_path = format!("./drawio/{}", filename);
    Ok(serde_json::json!({
        "drawioPath": relative_path,
        "filePath": target.to_string_lossy(),
        "fileName": filename,
    }))
}

#[tauri::command]
pub fn open_drawio_external(path: String) -> Result<(), String> {
    // Try to open with draw.io desktop app
    let drawio_path = PathBuf::from(&path);
    if !drawio_path.exists() {
        return Err("Draw.io file not found".to_string());
    }

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
                    .arg(&path)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    // Fallback: open with system default application
    open::that(&path).map_err(|e| {
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
    let doc_dir = doc_path.parent().ok_or("Invalid path")?;
    let drawio_dir = doc_dir.join("drawio");
    fs::create_dir_all(&drawio_dir).map_err(|e| e.to_string())?;

    let source = PathBuf::from(&source_path);
    let filename = source
        .file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .to_string();
    let target = deduplicate_path(&drawio_dir, &filename);
    let final_name = target.file_name().unwrap().to_string_lossy().to_string();

    fs::copy(&source, &target).map_err(|e| e.to_string())?;

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
