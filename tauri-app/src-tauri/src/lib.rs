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
        .filter(|p| {
            p.exists()
                && p.extension().is_some_and(|e| {
                    let ext = e.to_string_lossy().to_lowercase();
                    ext == "sdoc" || ext == "json"
                })
        });

    let initial_folder = initial_file
        .as_ref()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
        .or_else(|| {
            // No file passed on the command line — restore the last workspace folder the
            // user had open, similar to VS Code reopening the previous workspace on launch.
            settings
                .recent_folders
                .iter()
                .map(std::path::PathBuf::from)
                .find(|p| p.is_dir())
        });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(DocState {
            file_path: Mutex::new(initial_file),
            current_folder: Mutex::new(initial_folder),
            settings: Mutex::new(settings),
            workspace_watch_root: Mutex::new(None),
            workspace_watch_generation: std::sync::atomic::AtomicU64::new(0),
            recent_deletions: Mutex::new(Vec::new()),
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
            commands::rename_entry,
            commands::delete_entry,
            commands::undo_last_delete,
            commands::has_recent_deletions,
            commands::create_folder,
            commands::reveal_in_file_explorer,
            commands::save_image,
            commands::copy_image_to_doc,
            commands::create_drawio_file,
            commands::open_drawio_external,
            commands::copy_drawio_to_doc,
            commands::start_file_watcher,
            commands::start_workspace_watcher,
            commands::get_settings,
            commands::get_editor_settings,
            commands::update_settings,
            commands::get_recent_files,
            commands::get_recent_folders,
            commands::write_export_file,
            commands::read_import_file,
            commands::resolve_asset_path,
            commands::resolve_document_relative_path,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
