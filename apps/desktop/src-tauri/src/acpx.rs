//! acpx 连接层（聊天唯一链路）：spawn 一次性 `acpx claude` 进程，
//! 会话记录由 acpx 管理（~/.acpx，命名会话 `-s deer-<threadId>`），stdout
//! 是未经包装的 ACP JSON-RPC NDJSON（spike 报告 docs/spike-acpx.md），
//! 文本/思考增量解析直接复用 claude_acp 模块的纯函数。
//!
//! 关键设计：
//! - Deer 不自管 ACP 会话生命周期：每个聊天线程映射一个 acpx 命名会话，
//!   跨进程恢复、队列、落盘都由 acpx 完成；Deer 只在 NO_SESSION 时用
//!   存下的 ACP session id 走 `sessions new --resume-session` 修复映射。
//! - 冷环境直接 prompt 会报 -32002 NO_SESSION，需先 `sessions new`；
//!   npm 首拉偶发 `spawn Unknown system error -88`，spawn/ensure 均需重试。
//! - 权限策略 `--deny-all`：伴读聊天不允许 agent 用工具；仅放行 Deer 书架
//!   MCP server 的三个工具（--mcp-config + --allowed-tools，见
//!   mcp_server.rs），推荐书籍时模型能查书架/读进度，工具结果里的书单经
//!   books 事件推给前端成书卡。
//! - 深度思考恒开：每轮注入 MAX_THINKING_TOKENS=10000，回复先流思考
//!   （agent_thought_chunk，前端折叠展示）再流正文。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::claude_acp::{
    delta_from_line, find_node, parse_rpc_response, CHAT_GATE, EVENT_CHUNK,
    IDLE_BEFORE_FIRST_CHUNK, IDLE_BETWEEN_CHUNKS, PROMPT_TIMEOUT,
};
use crate::claude_cli::{
    known_bin_dirs, parse_node_version, probe_shell_path, read_oauth_token, split_path_env,
};
use crate::deer_log::{log, LOG_HINT};

/// 锁定的 acpx 版本线（spike 锁 0.21.1；pre-1.0 CLI 面可能破坏，升级走显式变更）。
const ACPX_VERSION_PREFIX: &str = "0.21.";
/// acpx 官方要求的最低 Node 版本（22.13）。
const MIN_NODE: (u64, u64) = (22, 13);
/// Deer 的 acpx 命名会话前缀，后接引擎 id 与线程 id（映射规则：deer-<engine>-<threadId>）。
const RECORD_PREFIX: &str = "deer-";
const STDERR_TAIL_LINES: usize = 20;
/// 聊天请求的排队等待上限：在途时后来的请求最多等这么久拿门闩，超时拒绝。
/// （CHAT_GATE 是单门闩，实际最多 1 个在排队 + 1 个在跑。）
const CHAT_QUEUE_WAIT: Duration = Duration::from_secs(120);
/// 瞬时 spawn 失败（npm exec 冷缓存 -88）的重试上限与间隔。
const TRANSIENT_RETRIES: usize = 3;
const TRANSIENT_RETRY_DELAY: Duration = Duration::from_millis(800);
/// Deer 书架 MCP server 挂载名：工具名形如 mcp__deer__search_books。
const MCP_SERVER_NAME: &str = "deer";
/// 权限只放行书架 MCP 的三个工具，其余工具仍被 --deny-all 拒绝。
const ALLOWED_MCP_TOOLS: &str =
    "mcp__deer__search_books,mcp__deer__get_reading_state,mcp__deer__get_library";

#[derive(Debug, Serialize)]
pub struct AcpxEnvStatus {
    pub ok: bool,
    pub node_ok: bool,
    pub node_version: Option<String>,
    pub acpx_version: Option<String>,
    /// ok=false 时的安装/修复指引（含 Node 与 acpx 两条）。
    pub message: String,
}

/// 引擎 id 白名单（acpx@0.21.1 内置 27 个 agent）与各自的厂商 CLI 可执行名
/// （探测「已安装」用；npx 现取的引擎也按厂商 CLI 探测，装了显示已安装）。
const AI_ENGINE_SPECS: &[(&str, &str)] = &[
    ("claude", "claude"),
    ("codex", "codex"),
    ("kimi", "kimi"),
    ("qwen", "qwen"),
    ("gemini", "gemini"),
    ("cursor", "cursor-agent"),
    ("copilot", "copilot"),
    ("antigravity", "antigravity"),
    ("devin", "devin"),
    ("droid", "droid"),
    ("fast-agent", "fast-agent"),
    ("fx", "fx"),
    ("grok-build", "grok"),
    ("iflow", "iflow"),
    ("junie", "junie"),
    ("kilocode", "kilocode"),
    ("kiro", "kiro-cli-chat"),
    ("mcode", "mcode"),
    ("mux", "mux"),
    ("octomind", "octomind"),
    ("opencode", "opencode"),
    ("pi", "pi"),
    ("pool", "pool"),
    ("qoder", "qodercli"),
    ("trae", "traecli"),
    ("zeroclaw", "zeroclaw"),
    ("openclaw", "openclaw"),
];

/// 前端传来的引擎 id 是否在白名单内。
pub(crate) fn is_known_engine(engine: &str) -> bool {
    AI_ENGINE_SPECS.iter().any(|(id, _)| *id == engine)
}

/* ------------------------------------------------------------------ */
/* 纯函数（供单测覆盖）                                                 */
/* ------------------------------------------------------------------ */

/// 线程 id → acpx 命名会话名（deer-<engine>-<threadId>，按引擎隔离会话，
/// 换引擎即换上下文）。acpx 对会话名的约束未知，只保留字母数字、连字符与
/// 下划线，其余一律替换成连字符，保证跨端（前端/Rust）推导一致。
pub(crate) fn record_name(engine: &str, thread_id: &str) -> String {
    let safe: String = thread_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{RECORD_PREFIX}{engine}-{safe}")
}

/// Node 版本是否满足 acpx 要求（≥22.13）。
pub(crate) fn node_satisfies(version: &[u64]) -> bool {
    match (version.first(), version.get(1)) {
        (Some(&major), Some(&minor)) => {
            major > MIN_NODE.0 || (major == MIN_NODE.0 && minor >= MIN_NODE.1)
        }
        // 只有大版本号（如 "v22"）时按该大版本达标处理
        (Some(&major), None) => major > MIN_NODE.0 || major == MIN_NODE.0,
        _ => false,
    }
}

/// acpx 版本是否在锁定线内。
pub(crate) fn version_locked(acpx_version: &str) -> bool {
    acpx_version.starts_with(ACPX_VERSION_PREFIX)
}

/// 从 acpx stdout 解析出的一帧 JSON 里提取 ACP session id：
/// session/update 通知的 params.sessionId，或 session/new 响应的 result.sessionId。
pub(crate) fn session_id_from_value(v: &Value) -> Option<String> {
    if let Some(id) = v
        .get("params")
        .and_then(|p| p.get("sessionId"))
        .and_then(Value::as_str)
    {
        return Some(id.to_string());
    }
    v.get("result")?
        .get("sessionId")
        .and_then(Value::as_str)
        .map(String::from)
}

/// 错误帧的一行摘要（message + code），用于错误文案与分类。
pub(crate) fn error_summary(v: &Value) -> Option<String> {
    let err = v.get("error")?;
    let code = err.get("code").map(|c| c.to_string()).unwrap_or_default();
    let message = err.get("message").and_then(Value::as_str).unwrap_or("unknown");
    Some(format!("{code} {message}"))
}

/// acpx 输出里是否是「会话不存在」错误（冷环境直接 prompt 的 -32002）。
pub(crate) fn is_no_session_error(output: &str) -> bool {
    output.contains("-32002") || output.contains("NO_SESSION")
}

/// 是否是 npm exec 冷缓存导致的瞬时 spawn 失败（spike 实测 `Unknown system error -88`）。
pub(crate) fn is_transient_spawn_error(output: &str) -> bool {
    output.contains("Unknown system error") || output.contains("-88")
}

/// 书架 MCP server 的挂载配置：ACP mcpServers 数组形态（spike 实测 acpx
/// 只认数组，对象形态报 "expected array"）。指向当前二进制的
/// --mcp-server 模式，GUI 外的 harness 与内置聊天用同一份。
pub(crate) fn mcp_server_config(exe: &Path) -> Value {
    json!({
        "mcpServers": [
            { "name": MCP_SERVER_NAME, "command": exe.to_string_lossy(), "args": ["--mcp-server"] }
        ]
    })
}

/// 把 MCP 挂载配置写到临时文件，返回路径；定位不到自身可执行文件时
/// 返回 None（聊天不带 MCP 工具继续跑，只是没有书架能力）。
fn write_mcp_config() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let path = std::env::temp_dir().join("deer-mcp-server.json");
    std::fs::write(&path, mcp_server_config(&exe).to_string()).ok()?;
    Some(path)
}

/// 一次 prompt 调用的完整参数（prompt 经 `-f -` 走 stdin，避免被当成选项）。
/// 注意：--format/--json-strict/--deny-all 是顶层选项，必须放在引擎子命令
/// 之前（子命令不继承它们，放后面会退出并打印帮助）。
/// mcp_config 有值时同样在顶层追加 --mcp-config 与 --allowed-tools：
/// 权限仍是 --deny-all，只精确放行书架 MCP 的三个工具（spike 实测
/// allowed-tools 能在 deny-all 之下放行指定 MCP 工具）。
pub(crate) fn prompt_args(engine: &str, record: &str, mcp_config: Option<&Path>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--format".into(),
        "json".into(),
        "--json-strict".into(),
        "--deny-all".into(),
    ];
    if let Some(path) = mcp_config {
        args.push("--mcp-config".into());
        args.push(path.to_string_lossy().into_owned());
        args.push("--allowed-tools".into());
        args.push(ALLOWED_MCP_TOOLS.into());
    }
    args.push("--timeout".into());
    args.push((PROMPT_TIMEOUT.as_secs() - 10).to_string());
    args.push(engine.into());
    args.push("-s".into());
    args.push(record.into());
    args.push("-f".into());
    args.push("-".into());
    args
}

/// 从 tool_call_update（status=completed）的 rawOutput 里抽取书卡：
/// Deer 书架 MCP 工具的结果 text 块是 `{"deer":"books","books":[...]}`，
/// 按标记识别（不依赖工具名元数据），非书架工具的输出一律不产书卡。
pub(crate) fn book_cards_from_update(params: &Value) -> Option<Vec<Value>> {
    let update = params.get("update")?;
    if update.get("sessionUpdate")?.as_str()? != "tool_call_update" {
        return None;
    }
    if update.get("status")?.as_str()? != "completed" {
        return None;
    }
    for item in update.get("rawOutput")?.as_array()? {
        let Some(text) = item.get("text").and_then(Value::as_str) else {
            continue;
        };
        let Ok(payload) = serde_json::from_str::<Value>(text) else {
            continue;
        };
        if payload.get("deer").and_then(Value::as_str) == Some("books") {
            if let Some(books) = payload.get("books").and_then(Value::as_array) {
                if !books.is_empty() {
                    return Some(books.clone());
                }
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* 定位与版本检查                                                       */
/* ------------------------------------------------------------------ */

/// GUI 环境 PATH 拿不到用户安装目录，与 claude CLI 同款探测：已知目录 →
/// 登录 shell PATH → 继承 PATH（acpx 与各引擎 CLI 的状态探测共用）。
async fn search_dirs() -> Vec<PathBuf> {
    let home = std::env::var("HOME").ok();
    let known = known_bin_dirs(home.as_deref());
    let shell_dirs = probe_shell_path().await.unwrap_or_default();
    let path_dirs = std::env::var("PATH")
        .ok()
        .as_deref()
        .map(split_path_env)
        .unwrap_or_default();
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in known.iter().chain(&shell_dirs).chain(&path_dirs) {
        if seen.insert(dir.to_string_lossy().into_owned()) {
            out.push(dir.clone());
        }
    }
    out
}

fn candidates_in(dirs: &[PathBuf], bin: &str) -> Vec<PathBuf> {
    dirs.iter()
        .map(|dir| dir.join(bin))
        .collect()
}

async fn find_acpx() -> Result<PathBuf, String> {
    for candidate in candidates_in(&search_dirs().await, "acpx") {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "未找到 acpx（已探测 ~/.local/bin、~/.npm-global/bin、nvm、homebrew 与 PATH）。请在终端执行 npm install -g acpx@0.21.1 安装后重启应用。"
    ))
}

/// 单个引擎的本机状态：厂商 CLI 可执行文件在任一探测目录里即视为已安装。
fn engine_installed_in(dirs: &[PathBuf], bin: &str) -> bool {
    candidates_in(dirs, bin)
        .into_iter()
        .any(|candidate| candidate.is_file())
}

/// 跑 `node --version`，返回版本字符串（如 v24.20.0）。
async fn node_version(node: &Path) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        Command::new(node).arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// 跑 `acpx --version`，返回版本字符串。
async fn acpx_version(acpx: &Path) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        Command::new(acpx).arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Tauri command：acpx 环境自检（Node ≥22.13、acpx 已装且版本在锁定线内）。
/// 前端进入聊天即调用（acpx 是唯一链路，不达标时安装引导是唯一路径）。
#[tauri::command]
pub async fn acpx_env_check() -> AcpxEnvStatus {
    let node = find_node();
    let node_version = node_version(&node).await;
    let node_ok = node_version
        .as_deref()
        .and_then(parse_node_version)
        .map(|v| node_satisfies(&v))
        .unwrap_or(false);

    let acpx = find_acpx().await;
    let acpx_version = match &acpx {
        Ok(path) => acpx_version(path).await,
        Err(_) => None,
    };
    let version_ok = acpx_version
        .as_deref()
        .map(version_locked)
        .unwrap_or(false);

    let mut messages: Vec<String> = Vec::new();
    if !node_ok {
        messages.push(format!(
            "需要 Node ≥ {}.{}（当前：{}）。请安装 Node 22.13 以上版本（nvm install 22 或 brew install node）。",
            MIN_NODE.0,
            MIN_NODE.1,
            node_version.as_deref().unwrap_or("未找到 node")
        ));
    }
    if acpx_version.is_none() {
        messages.push(
            "未找到 acpx，请在终端执行 npm install -g acpx@0.21.1。".to_string(),
        );
    } else if !version_ok {
        messages.push(format!(
            "acpx 版本 {} 不在锁定线（{}x）内，请执行 npm install -g acpx@0.21.1。",
            acpx_version.as_deref().unwrap_or("?"),
            ACPX_VERSION_PREFIX
        ));
    }
    let ok = node_ok && version_ok;
    AcpxEnvStatus {
        ok,
        node_ok,
        node_version,
        acpx_version,
        message: if ok {
            String::new()
        } else {
            messages.join(" ")
        },
    }
}

/// 引擎 → 一键安装包（仅 acpx 官方 npm 适配器包；厂商 CLI 不代装，前端只展示官方安装方式）。
const AI_ENGINE_INSTALLS: &[(&str, &str, &str)] = &[
    ("claude", "@agentclientprotocol/claude-agent-acp", "^0.95.0"),
    ("codex", "@agentclientprotocol/codex-acp", "^1.1.5"),
    ("pi", "pi-acp", "^0.0.33"),
    ("mux", "mux", "^0.28.0"),
];

#[derive(Debug, Serialize)]
pub struct AiEngineStatus {
    pub id: String,
    pub installed: bool,
}

/// Tauri command：探测全部引擎的本机安装状态（纯文件检查，毫秒级）。
#[tauri::command]
pub async fn ai_engine_status() -> Vec<AiEngineStatus> {
    let dirs = search_dirs().await;
    AI_ENGINE_SPECS
        .iter()
        .map(|(id, bin)| AiEngineStatus {
            id: (*id).to_string(),
            installed: engine_installed_in(&dirs, bin),
        })
        .collect()
}

/// Tauri command：全局安装一个引擎的 acpx 适配器包（白名单 + 锁定版本线），
/// npm 输出逐行经 ai://install-log 推给前端；结束时推 done 帧（success=退出码）。
#[tauri::command]
pub async fn ai_engine_install(app: AppHandle, engine_id: String) -> Result<(), String> {
    let Some((_, pkg, range)) = AI_ENGINE_INSTALLS
        .iter()
        .find(|(id, _, _)| *id == engine_id)
    else {
        return Err(format!(
            "引擎 {engine_id} 不支持一键安装（厂商 CLI 请用官方方式安装）。"
        ));
    };
    let spec = format!("{pkg}@{range}");
    let node = find_node();
    let node_dir = node.parent().map(Path::to_path_buf);
    let npm = node_dir
        .as_ref()
        .map(|dir| dir.join("npm"))
        .filter(|npm| npm.is_file())
        .unwrap_or_else(|| PathBuf::from("npm"));
    let mut cmd = Command::new(&npm);
    cmd.args(["install", "-g", &spec])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = &node_dir {
        let path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}:{}", dir.display(), path));
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 npm 失败（{}）：{e}", npm.display()))?;
    log("install", &format!("npm install -g {spec} pid={:?}", child.id()));
    let emit_line = {
        let app = app.clone();
        let engine_id = engine_id.clone();
        move |line: String| {
            let _ = app.emit(
                "ai://install-log",
                json!({ "engineId": engine_id, "line": line }),
            );
        }
    };
    let mut stdout = BufReader::new(child.stdout.take().ok_or("npm stdout 不可用")?).lines();
    let mut stderr = BufReader::new(child.stderr.take().ok_or("npm stderr 不可用")?).lines();
    let emit_err_line = emit_line.clone();
    let out_task = tokio::spawn(async move {
        while let Ok(Some(line)) = stdout.next_line().await {
            log("install", &line);
            emit_line(line);
        }
    });
    let err_task = tokio::spawn(async move {
        while let Ok(Some(line)) = stderr.next_line().await {
            log("install", &line);
            emit_err_line(line);
        }
    });
    let _ = tokio::join!(out_task, err_task);
    let status = child.wait().await.map_err(|e| format!("npm 进程异常：{e}"))?;
    let success = status.success();
    log("install", &format!("npm install -g {spec} exit={status:?}"));
    let _ = app.emit(
        "ai://install-log",
        json!({ "engineId": engine_id, "done": true, "success": success }),
    );
    if success {
        Ok(())
    } else {
        Err(format!("安装 {spec} 失败（npm 退出码 {status}），详见安装日志。"))
    }
}

/// acpx_chat 的前置检查：找到 acpx、Node 版本达标、acpx 版本在锁定线内。
/// 每次对话都跑版本检查成本可接受（两次毫秒级子进程），换来版本被真正锁死。
async fn verify_env() -> Result<PathBuf, String> {
    let acpx = find_acpx().await?;
    let node = find_node();
    let nv = node_version(&node)
        .await
        .ok_or_else(|| "无法取得 node 版本。请确认 Node ≥22.13 已安装。".to_string())?;
    let parts = parse_node_version(&nv)
        .ok_or_else(|| format!("无法解析 node 版本（{nv}）。"))?;
    if !node_satisfies(&parts) {
        return Err(format!(
            "acpx 需要 Node ≥ {}.{}，当前 {nv}。请升级后重试。",
            MIN_NODE.0, MIN_NODE.1
        ));
    }
    let av = acpx_version(&acpx)
        .await
        .ok_or_else(|| "无法取得 acpx 版本，请重装：npm install -g acpx@0.21.1。".to_string())?;
    if !version_locked(&av) {
        return Err(format!(
            "acpx 版本 {av} 不在锁定线（{ACPX_VERSION_PREFIX}x）内。请执行 npm install -g acpx@0.21.1。"
        ));
    }
    Ok(acpx)
}

/* ------------------------------------------------------------------ */
/* acpx 子进程                                                          */
/* ------------------------------------------------------------------ */

fn spawn_cmd(acpx: &Path, args: &[String], home: &Path, engine: &str) -> Command {
    let node = find_node();
    let mut cmd = Command::new(acpx);
    cmd.args(args)
        .current_dir(home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // acpx 是 `#!/usr/bin/env node` 脚本：GUI 拉起时 PATH 没有用户目录，
    // 把探测到的 node 所在目录垫到最前面，env node 才能解析。
    if let Some(node_dir) = node.parent() {
        let path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}:{}", node_dir.display(), path));
    }
    // 可选 OAuth 令牌（用户自管的 ~/.config/deer/claude-oauth-token）：
    // 只有 claude 链路的适配器吃这个环境变量，其他引擎不注入。
    if engine == "claude" {
        if let Some(token) = read_oauth_token() {
            cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
        }
    }
    cmd
}

enum ReaderMsg {
    Line(String),
    Eof,
}

struct Tail {
    lines: Arc<Mutex<std::collections::VecDeque<String>>>,
}

impl Tail {
    fn new() -> Self {
        Self {
            lines: Arc::new(Mutex::new(std::collections::VecDeque::with_capacity(
                STDERR_TAIL_LINES,
            ))),
        }
    }

    fn clone_lines(&self) -> Arc<Mutex<std::collections::VecDeque<String>>> {
        self.lines.clone()
    }

    fn brief(&self) -> String {
        let buf = self.lines.lock().unwrap();
        if buf.is_empty() {
            return String::new();
        }
        let joined = buf.iter().map(String::as_str).collect::<Vec<_>>().join(" | ");
        format!("stderr 尾部：{joined}")
    }
}

struct PromptOutcome {
    text: String,
    session_id: Option<String>,
}

/// 跑一次 `acpx <engine> -s <record> -f -`：prompt 写进 stdin，逐行解析
/// stdout 的 ACP NDJSON，增量经 on_chunk 交给调用方（生产路径 emit 给前端）。
/// 返回累计正文、会话 id 与停止原因；错误信息携带 stderr 尾部与 stdout 里的
/// 错误响应原文，供上层分类（NO_SESSION / 瞬时 spawn 失败）。
async fn run_prompt<F: FnMut(&str, &'static str, String) + Send>(
    acpx: &Path,
    engine: &str,
    record: &str,
    prompt: &str,
    message_id: &str,
    mcp_config: Option<&Path>,
    on_chunk: &mut F,
) -> Result<PromptOutcome, String> {
    let t0 = std::time::Instant::now();
    let home = std::env::var("HOME").unwrap_or_default();
    let home = PathBuf::from(&home);
    let args = prompt_args(engine, record, mcp_config);
    let mut cmd = spawn_cmd(acpx, &args, &home, engine);
    // 深度思考恒开（claude 链路）：每轮注入 MAX_THINKING_TOKENS，
    // claude-agent-acp 会把它传给 SDK 的 maxThinkingTokens，思考内容以
    // agent_thought_chunk 流回。其他引擎由各自 CLI 的深度思考能力决定。
    if engine == "claude" {
        cmd.env("MAX_THINKING_TOKENS", "10000");
        log("acpx", "深度思考恒开（MAX_THINKING_TOKENS=10000，claude）");
    } else {
        log("acpx", &format!("引擎 {engine} 不注入 claude 专属思考预算"));
    }
    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("启动 acpx 失败（{}）：{e}", acpx.display());
        log("spawn", &msg);
        msg
    })?;
    log("spawn", &format!("acpx pid={:?} record={record}", child.id()));

    let mut stdin = child.stdin.take().ok_or("acpx stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("acpx stdout 不可用")?;
    let stderr = child.stderr.take().ok_or("acpx stderr 不可用")?;
    // prompt 走 stdin（-f -），写完即关，acpx 收到 EOF 才开始跑
    let _ = stdin.write_all(prompt.as_bytes()).await;
    let _ = stdin.shutdown().await;
    drop(stdin);

    let (tx, mut rx) = mpsc::channel::<ReaderMsg>(128);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    log("recv", &line);
                    if tx.send(ReaderMsg::Line(line)).await.is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
        let _ = tx.send(ReaderMsg::Eof).await;
    });

    let tail = Tail::new();
    {
        let tail_ref = tail.clone_lines();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log("stderr", &line);
                let mut buf = tail_ref.lock().unwrap();
                if buf.len() == STDERR_TAIL_LINES {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
        });
    }

    let mut accumulated = String::new();
    let mut session_id: Option<String> = None;
    let mut stop_reason: Option<String> = None;
    let mut saw_output = false;
    let mut stdout_errors: Vec<String> = Vec::new();

    loop {
        let idle = if saw_output {
            IDLE_BETWEEN_CHUNKS
        } else {
            IDLE_BEFORE_FIRST_CHUNK
        };
        let msg = match tokio::time::timeout(idle, rx.recv()).await {
            Ok(msg) => msg,
            Err(_) => {
                let err = format!(
                    "acpx 在 {} 秒内没有任何输出（stage=prompt）。常见原因是系统安全弹窗在等待确认或网络不通。{}诊断日志：{LOG_HINT}",
                    idle.as_secs(),
                    tail.brief()
                );
                log("timeout", &err);
                return Err(err);
            }
        };
        match msg {
            Some(ReaderMsg::Line(line)) => {
                if let Some(delta) = delta_from_line(&line) {
                    saw_output = true;
                    accumulated.push_str(&delta);
                    on_chunk(message_id, "message", delta);
                    continue;
                }
                let v = serde_json::from_str::<Value>(&line).ok();
                // 思考增量：delta_from_line 只取正文，思考块从 params 里单独拿
                if let Some(v) = &v {
                    if v.get("method").and_then(Value::as_str) == Some("session/update") {
                        saw_output = true;
                        if let Some(delta) = crate::claude_acp::thought_delta(v.get("params").unwrap_or(&Value::Null)) {
                            on_chunk(message_id, "thought", delta);
                        }
                        // 书架 MCP 工具结果里的书单：抽成 books 事件推给前端渲染书卡
                        if let Some(books) = book_cards_from_update(v.get("params").unwrap_or(&Value::Null)) {
                            if let Ok(delta) = serde_json::to_string(&books) {
                                on_chunk(message_id, "books", delta);
                            }
                        }
                        if session_id.is_none() {
                            session_id = session_id_from_value(v);
                        }
                        continue;
                    }
                }
                if let Some(v) = &v {
                    if session_id.is_none() {
                        session_id = session_id_from_value(v);
                    }
                    // 错误帧（含 id:null 的顶层错误，如 NO_SESSION -32002）要
                    // 收进错误文案，否则上层无法分类触发重试
                    if let Some(summary) = error_summary(v) {
                        stdout_errors.push(summary);
                    }
                }
                if let Some(resp) = parse_rpc_response(&line) {
                    match resp {
                        Err(e) => stdout_errors.push(e),
                        Ok(result) => {
                            if let Some(reason) = result.get("stopReason").and_then(Value::as_str) {
                                stop_reason = Some(reason.to_string());
                            }
                        }
                    }
                }
            }
            Some(ReaderMsg::Eof) | None => break,
        }
    }

    let status = child.wait().await;
    let exit_ok = matches!(&status, Ok(s) if s.success());
    log(
        "done",
        &format!(
            "record={record} exit={status:?} text_chars={} 耗时 {} ms",
            accumulated.chars().count(),
            t0.elapsed().as_millis()
        ),
    );
    if !exit_ok {
        let mut detail = format!("acpx 进程异常退出（{status:?}）。{}", tail.brief());
        for e in &stdout_errors {
            detail.push_str(&format!(" | stdout 错误：{e}"));
        }
        return Err(detail);
    }
    if let Some(reason) = &stop_reason {
        if reason == "refusal" {
            return Err("模型拒绝了这次请求。".to_string());
        }
    }
    Ok(PromptOutcome {
        text: accumulated,
        session_id,
    })
}

/// 确保 acpx 命名会话存在：`<engine> sessions new -s <record>`，瞬时失败重试。
/// 有 ACP session id 时用 --resume-session 把旧会话接回来（NO_SESSION 修复路径）。
/// 带 MCP 配置创建会话，让内置聊天挂上的书架工具在会话里可用。
async fn ensure_session(
    acpx: &Path,
    engine: &str,
    record: &str,
    resume: Option<&str>,
    mcp_config: Option<&Path>,
) -> Result<(), String> {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    let mut args: Vec<String> = if let Some(path) = mcp_config {
        vec![
            "--mcp-config".into(),
            path.to_string_lossy().into_owned(),
            engine.to_string(),
            "sessions".to_string(),
            "new".to_string(),
            "-s".to_string(),
            record.to_string(),
        ]
    } else {
        vec![
            engine.to_string(),
            "sessions".to_string(),
            "new".to_string(),
            "-s".to_string(),
            record.to_string(),
        ]
    };
    if let Some(id) = resume {
        args.push("--resume-session".to_string());
        args.push(id.to_string());
    }
    let mut last_err = String::new();
    for attempt in 1..=TRANSIENT_RETRIES {
        let output = spawn_cmd(acpx, &args, &home, engine)
            .stdin(Stdio::null())
            .output()
            .await;
        match output {
            Ok(out) if out.status.success() => {
                log("acpx", &format!("sessions new 成功 record={record} resume={resume:?}"));
                return Ok(());
            }
            Ok(out) => {
                let combined = format!(
                    "{} {}",
                    String::from_utf8_lossy(&out.stderr),
                    String::from_utf8_lossy(&out.stdout)
                );
                log("acpx", &format!("sessions new 失败（第 {attempt} 次）：{combined}"));
                last_err = combined;
            }
            Err(e) => {
                log("acpx", &format!("sessions new spawn 失败（第 {attempt} 次）：{e}"));
                last_err = e.to_string();
            }
        }
        if attempt < TRANSIENT_RETRIES && is_transient_spawn_error(&last_err) {
            tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
        } else if attempt < TRANSIENT_RETRIES {
            // 非瞬时错误重试也无济于事，直接返回
            break;
        }
    }
    Err(format!("建立 acpx 会话失败（sessions new）：{last_err}"))
}

/// 跑一轮完整对话：prompt 失败时若是 NO_SESSION 或瞬时 spawn 错误，
/// 先 ensure（必要时 --resume-session 接回旧会话）再重试一次。
async fn run_acpx_chat<F: FnMut(&str, &'static str, String) + Send>(
    on_chunk: &mut F,
    message_id: &str,
    prompt: &str,
    engine: &str,
    record: &str,
    resume_session_id: Option<&str>,
) -> Result<crate::claude_acp::ClaudeChatResult, String> {
    let acpx = verify_env().await?;
    // MCP 挂载配置每轮重写（指向当前二进制的 --mcp-server 模式）；写不出
    // 就退化成无工具聊天。
    let mcp_config = write_mcp_config();
    log(
        "acpx",
        &format!(
            "engine={engine} {}",
            match &mcp_config {
                Some(path) => format!("书架 MCP server 已挂载（{}）", path.display()),
                None => "书架 MCP server 不可用（无法定位自身可执行文件），本轮无书架工具".to_string(),
            }
        ),
    );
    let mut outcome = run_prompt(
        acpx.as_path(),
        engine,
        record,
        prompt,
        message_id,
        mcp_config.as_deref(),
        on_chunk,
    )
    .await;
    if let Err(err) = &outcome {
        if is_no_session_error(err) || is_transient_spawn_error(err) {
            log("acpx", &format!("prompt 失败（{}），ensure 后重试一次", if is_no_session_error(err) { "NO_SESSION" } else { "瞬时" }));
            ensure_session(
                acpx.as_path(),
                engine,
                record,
                resume_session_id,
                mcp_config.as_deref(),
            )
            .await?;
            outcome = run_prompt(
                acpx.as_path(),
                engine,
                record,
                prompt,
                message_id,
                mcp_config.as_deref(),
                on_chunk,
            )
            .await;
        }
    }
    let outcome = outcome?;
    let session_id = outcome
        .session_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "acpx 输出里没有找到 ACP session id".to_string())?;
    Ok(crate::claude_acp::ClaudeChatResult {
        text: outcome.text,
        session_id,
    })
}

/// Tauri command：经 acpx 跑一轮聊天（唯一聊天链路，引擎由前端选定）。
/// 会话映射：thread_id → acpx 命名会话 deer-<engine>-<threadId>（record_name）。
/// 全局串行（CHAT_GATE，同一时刻只跑一个会话）；增量事件经 claude://chunk
/// 实时推送，前端渲染无差别。
#[tauri::command]
pub async fn acpx_chat(
    app: AppHandle,
    prompt: String,
    message_id: String,
    thread_id: String,
    resume_session_id: Option<String>,
    engine: Option<String>,
) -> Result<crate::claude_acp::ClaudeChatResult, String> {
    if prompt.trim().is_empty() {
        return Err("消息不能为空".to_string());
    }
    if thread_id.trim().is_empty() {
        return Err("缺少会话线程 id".to_string());
    }
    // 旧版前端不带 engine 时回落 claude；带了一律走白名单，杜绝任意子命令注入。
    let engine = engine.unwrap_or_else(|| "claude".to_string());
    if !is_known_engine(&engine) {
        return Err(format!("未知引擎：{engine}"));
    }
    let record = record_name(&engine, thread_id.trim());

    let permit = match CHAT_GATE.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            log("queue", "已有请求在途，排队等待");
            tokio::time::timeout(CHAT_QUEUE_WAIT, CHAT_GATE.lock())
                .await
                .map_err(|_| {
                    let err = format!(
                        "上一条回复还没结束，且队列已满（>{} 秒）。请等当前回复完成后重试。诊断日志：{LOG_HINT}",
                        CHAT_QUEUE_WAIT.as_secs()
                    );
                    log("queue", &format!("排队超时（{} 秒），拒绝请求", CHAT_QUEUE_WAIT.as_secs()));
                    err
                })?
        }
    };
    let _guard = permit;

    let app_for_chunks = app.clone();
    let mut emit_chunk = move |mid: &str, kind: &'static str, delta: String| {
        let _ = app_for_chunks.emit(
            EVENT_CHUNK,
            json!({
                "messageId": mid,
                "kind": kind,
                "delta": delta,
            }),
        );
    };
    run_acpx_chat(
        &mut emit_chunk,
        &message_id,
        &prompt,
        &engine,
        &record,
        resume_session_id.as_deref(),
    )
    .await
}

/* ------------------------------------------------------------------ */
/* 单测                                                                 */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_names_are_prefixed_and_sanitized() {
        // 会话名带引擎段：deer-<engine>-<threadId>，换引擎即换会话
        assert_eq!(
            record_name("claude", "thread_abc123"),
            "deer-claude-thread_abc123"
        );
        assert_eq!(record_name("codex", "thread_abc123"), "deer-codex-thread_abc123");
        // 线程 id 里的非法字符（冒号/空格/斜杠）替换成连字符，不能带出会话名语法
        assert_eq!(record_name("claude", "thread:x y"), "deer-claude-thread-x-y");
        assert_eq!(record_name("claude", "../etc"), "deer-claude----etc");
    }

    #[test]
    fn engines_are_whitelisted() {
        assert!(is_known_engine("claude"));
        assert!(is_known_engine("qwen"));
        assert!(!is_known_engine("rm -rf"));
        assert!(!is_known_engine(""));
        // 一键安装白名单与引擎白名单对得上（只有 4 个适配器包引擎）
        assert_eq!(AI_ENGINE_INSTALLS.len(), 4);
        for (id, pkg, range) in AI_ENGINE_INSTALLS {
            assert!(is_known_engine(id), "{id} 应在引擎白名单内");
            assert!(!pkg.is_empty() && range.starts_with('^'));
        }
    }

    #[test]
    fn node_version_boundary_is_22_13() {
        assert!(node_satisfies(&[24, 20, 0]));
        assert!(node_satisfies(&[22, 13, 0]));
        assert!(!node_satisfies(&[22, 12, 9]));
        assert!(!node_satisfies(&[21, 0, 0]));
        assert!(node_satisfies(&[23]));
        assert!(!node_satisfies(&[]));
    }

    #[test]
    fn acpx_version_must_be_on_locked_line() {
        assert!(version_locked("0.21.1"));
        assert!(version_locked("0.21.2"));
        assert!(!version_locked("0.22.0"));
        assert!(!version_locked("1.0.0"));
        assert!(!version_locked(""));
    }

    #[test]
    fn extracts_session_id_from_update_and_response() {
        let update: Value = serde_json::from_str(
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ff61f842","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你好"}}}}"#,
        )
        .unwrap();
        assert_eq!(session_id_from_value(&update).as_deref(), Some("ff61f842"));
        let resp: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"1c7e1d53"}}"#).unwrap();
        assert_eq!(session_id_from_value(&resp).as_deref(), Some("1c7e1d53"));
        let no_id: Value = serde_json::from_str(r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#).unwrap();
        assert_eq!(session_id_from_value(&no_id), None);
    }

    #[test]
    fn summarizes_error_frames_including_null_id() {
        // spike 实测：NO_SESSION 是 id:null 的顶层错误帧，必须能被摘要出来
        let frame: Value = serde_json::from_str(
            r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32002,"message":"No acpx session found","data":{"acpxCode":"NO_SESSION"}}}"#,
        )
        .unwrap();
        let summary = error_summary(&frame).unwrap();
        assert!(summary.contains("-32002"));
        assert!(summary.contains("No acpx session found"));
        assert!(error_summary(&serde_json::json!({"jsonrpc":"2.0","id":1,"result":{}})).is_none());
    }

    #[test]
    fn classifies_no_session_and_transient_errors() {
        // spike 实测：冷环境直接 prompt 报 -32002 NO_SESSION
        assert!(is_no_session_error(r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32002,"message":"NO_SESSION"}}"#));
        assert!(is_no_session_error("Error: NO_SESSION for cwd"));
        assert!(!is_no_session_error("all good"));

        // spike 实测：npm 首拉偶发 spawn Unknown system error -88
        assert!(is_transient_spawn_error("spawn Unknown system error -88"));
        assert!(is_transient_spawn_error("exec failed (-88)"));
        assert!(!is_transient_spawn_error("usage error"));
    }

    #[test]
    fn prompt_args_are_strict_json_and_deny_tools() {
        let args = prompt_args("claude", "deer-claude-thread_x", None);
        let joined = args.join(" ");
        // 顶层选项必须出现在引擎子命令之前（实测放后面会打印帮助退出）
        assert!(joined.find("--format json").unwrap() < joined.find("claude").unwrap());
        assert!(joined.contains("--json-strict"));
        // 权限策略：伴读聊天禁用工具（--deny-all）
        assert!(joined.contains("--deny-all"));
        // --json-strict 与 --verbose 互斥（spike 坑 3），绝不能同时出现
        assert!(!joined.contains("--verbose"));
        // prompt 走 stdin（-f -），不作为命令行参数出现
        assert!(joined.contains("-f -"));
        // 命名会话紧跟子命令（-s 是引擎子命令的选项）
        let claude_pos = joined.find("claude").unwrap();
        assert!(joined.find("-s deer-claude-thread_x").unwrap() > claude_pos);
    }

    #[test]
    fn prompt_args_take_engine_subcommand() {
        let args = prompt_args("qwen", "deer-qwen-thread_x", None);
        let joined = args.join(" ");
        // 引擎子命令由参数决定，顶层选项仍在其之前
        assert!(joined.find("--deny-all").unwrap() < joined.find("qwen").unwrap());
        assert!(joined.contains("-s deer-qwen-thread_x"));
    }

    #[test]
    fn prompt_args_inject_mcp_config_and_allow_only_shelf_tools() {
        let path = Path::new("/tmp/deer-mcp-server.json");
        let args = prompt_args("claude", "deer-claude-thread_x", Some(path));
        let joined = args.join(" ");
        let claude_pos = joined.find("claude").unwrap();
        // 顶层 --mcp-config 与 --allowed-tools 同样必须在 claude 之前
        let mcp_pos = joined.find("--mcp-config /tmp/deer-mcp-server.json").unwrap();
        assert!(mcp_pos < claude_pos);
        assert!(joined.contains("mcp__deer__search_books"));
        assert!(joined.contains("mcp__deer__get_reading_state"));
        assert!(joined.contains("mcp__deer__get_library"));
        // 权限仍是 deny-all，只精确放行书架工具
        assert!(joined.contains("--deny-all"));
    }

    #[test]
    fn mcp_config_uses_acp_array_shape() {
        // spike 实测：acpx 的 --mcp-config 只认 ACP 数组形态（对象报 expected array）
        let exe = Path::new("/Applications/deer.app/desktop");
        let config = mcp_server_config(exe);
        let servers = config["mcpServers"].as_array().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0]["name"], "deer");
        assert_eq!(servers[0]["command"], "/Applications/deer.app/desktop");
        assert_eq!(servers[0]["args"][0], "--mcp-server");
    }

    #[test]
    fn extracts_book_cards_from_completed_tool_update() {
        // spike 实测帧：completed 的 tool_call_update，rawOutput text 块带 deer:books 标记
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_1","status":"completed","rawOutput":[{"type":"text","text":"{\"books\":[{\"id\":\"b1\",\"title\":\"三国演义\",\"author\":\"罗贯中\",\"format\":\"epub\",\"progress\":0.02,\"coverPath\":\"/covers/b1.jpg\"}],\"deer\":\"books\"}"}]}}}"#;
        let v: Value = serde_json::from_str(line).unwrap();
        let books = book_cards_from_update(v.get("params").unwrap()).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0]["title"], "三国演义");

        // 权限被拒（status=failed，rawOutput 是字符串）不产书卡
        let denied = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","status":"failed","rawOutput":"User refused permission to run tool"}}}"#;
        let v: Value = serde_json::from_str(denied).unwrap();
        assert!(book_cards_from_update(v.get("params").unwrap()).is_none());

        // 无标记的其它工具结果（如 tool_reference）不产书卡
        let other = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","status":"completed","rawOutput":[{"type":"tool_reference","tool_name":"mcp__deer__search_books"}]}}}"#;
        let v: Value = serde_json::from_str(other).unwrap();
        assert!(book_cards_from_update(v.get("params").unwrap()).is_none());

        // tool_call（初始帧）不产书卡
        let pending = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","status":"pending","content":[]}}}"#;
        let v: Value = serde_json::from_str(pending).unwrap();
        assert!(book_cards_from_update(v.get("params").unwrap()).is_none());
    }

    /// 真实 acpx E2E（多 harness 一期验收证据）：`cargo test -- --ignored real_acpx`
    /// 走完整链路：verify_env → prompt → 命名会话续接。第一轮确认流式正文
    /// 与 ACP session id；第二轮用同一 record 跨进程恢复，确认模型记得上一轮。
    /// 依赖本机 acpx@0.21.x、Node ≥22.13、已登录的 claude CLI 与网络。
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "依赖本机 acpx 与已登录的 claude CLI，手工跑"]
    async fn real_acpx_chat_named_session_resume_round_trip() {
        let record = record_name("claude", "selftest-e2e");
        // 逐块到达时间（毫秒）：验证流式是否真的逐块（攒批会在日志里一眼看出）
        let chunks = std::sync::Mutex::new(Vec::<(u128, String)>::new());
        let t0 = std::time::Instant::now();
        let result = run_acpx_chat(
            &mut |_, _, delta: String| {
                chunks
                    .lock()
                    .unwrap()
                    .push((t0.elapsed().as_millis(), delta));
            },
            "e2e-msg-1",
            "回复两个字：收到",
            "claude",
            &record,
            None,
        )
        .await
        .expect("第一轮 acpx 会话应成功");
        assert!(
            result.text.contains("收到"),
            "第一轮正文应包含模型回复，实际：{}",
            result.text
        );
        assert!(!result.session_id.is_empty(), "应返回 ACP session id");
        let arrived = chunks.lock().unwrap();
        assert!(!arrived.is_empty(), "第一轮应收到流式增量");
        eprintln!(
            "E2E 流式到达：{} 块，首块 {} ms，末块 {} ms，跨度 {} ms",
            arrived.len(),
            arrived.first().unwrap().0,
            arrived.last().unwrap().0,
            arrived.last().unwrap().0 - arrived.first().unwrap().0
        );
        drop(arrived);

        // 跨进程恢复：同一 record 起全新 acpx 进程，模型应记得上一轮约定
        let chunks2 = std::sync::Mutex::new(Vec::<String>::new());
        let resumed = run_acpx_chat(
            &mut |_, _, delta: String| chunks2.lock().unwrap().push(delta),
            "e2e-msg-2",
            "我上一条消息让你回复的是哪两个字？只答那两个字。",
            "claude",
            &record,
            Some(&result.session_id),
        )
        .await
        .expect("第二轮 acpx 会话（跨进程恢复）应成功");
        assert!(
            resumed.text.contains("收到"),
            "恢复会话后模型应记得上一轮内容，实际：{}",
            resumed.text
        );
        eprintln!(
            "E2E OK: session_id={} turn1_chars={} turn2={}",
            result.session_id,
            result.text.chars().count(),
            resumed.text
        );
    }
}
