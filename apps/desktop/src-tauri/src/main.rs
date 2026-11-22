// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 书架 MCP server 模式：跳过 GUI，stdio 上跑 MCP 协议直到对端关闭
    // （外置 harness 与内置聊天框的 acpx 都以子进程方式挂载，见 mcp_server.rs）。
    // 词典/百科工具要发异步 HTTP，需自建 tokio runtime 驱动。
    if std::env::args().any(|arg| arg == "--mcp-server") {
        let library =
            desktop_lib::mcp_server::load_library(&desktop_lib::mcp_server::default_data_dir());
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime 启动失败");
        let mut output = std::io::stdout().lock();
        rt.block_on(desktop_lib::mcp_server::run_stdio(
            &library,
            std::io::stdin().lock(),
            &mut output,
        ));
        return;
    }
    desktop_lib::run()
}
