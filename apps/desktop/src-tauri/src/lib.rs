mod acpx;
mod backup;
mod claude_acp;
mod claude_cli;
mod deer_log;
pub mod mcp_server;
mod webdav;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            acpx::acpx_chat,
            acpx::acpx_env_check,
            acpx::ai_engine_status,
            acpx::ai_engine_install,
            backup::export_backup,
            backup::import_backup,
            deer_log::diag_log,
            webdav::webdav_request,
            webdav::webdav_upload_file,
            webdav::webdav_download_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
