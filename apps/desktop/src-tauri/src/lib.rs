mod acpx;
mod claude_acp;
mod claude_cli;
mod deer_log;
pub mod mcp_server;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            claude_acp::claude_chat,
            acpx::acpx_chat,
            acpx::acpx_env_check,
            deer_log::diag_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
