mod commands;
mod document;
mod settings;

use commands::DocState;
use settings::load_settings;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings();

    // Check CLI arguments for file path (e.g. double-click on .sdoc file)
    let initial_file: Option<std::path::PathBuf> = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists() && p.extension().map_or(false, |e| {
            let ext = e.to_string_lossy().to_lowercase();
            ext == "sdoc" || ext == "json"
        }));

    let initial_folder = initial_file.as_ref().and_then(|path| path.parent().map(std::path::Path::to_path_buf));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(DocState {
            file_path: Mutex::new(initial_file),
            current_folder: Mutex::new(initial_folder),
            settings: Mutex::new(settings),
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::save_document,
            commands::new_document,
            commands::get_current_file_path,
            commands::set_current_folder,
            commands::get_current_folder,
            commands::list_folder_documents,
            commands::create_document_in_folder,
            commands::save_image,
            commands::copy_image_to_doc,
            commands::create_drawio_file,
            commands::open_drawio_external,
            commands::copy_drawio_to_doc,
            commands::start_file_watcher,
            commands::get_settings,
            commands::get_editor_settings,
            commands::update_settings,
            commands::get_recent_files,
            commands::write_export_file,
            commands::read_import_file,
            commands::resolve_asset_path,
            commands::resolve_document_relative_path,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
