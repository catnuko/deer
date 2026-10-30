//! 通过 ACP（Agent Client Protocol）调用本机 claude CLI。
//!
//! 每个 prompt spawn 一个适配器进程（@zed-industries/claude-code-acp，
//! stdio 上跑 JSON-RPC），流程：initialize → session/new 或 session/load →
//! session/prompt。文本增量经 `claude://chunk` 事件推给前端；turn 结束后
//! 返回助手全文 + ACP session id（会话跨进程持久，由 claude 自己落盘）。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

const EVENT_CHUNK: &str = "claude://chunk";
const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
const ADAPTER_PACKAGE: &str = "@zed-industries/claude-code-acp";
const ADAPTER_ENTRY: &str = "dist/index.js";
const STDERR_TAIL_LINES: usize = 20;

#[derive(Debug, Serialize)]
pub struct ClaudeChatResult {
    pub text: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct ChunkPayload {
    message_id: String,
    delta: String,
}

/* ------------------------------------------------------------------ */
/* JSON-RPC 消息解析（纯函数，供单测覆盖）                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, PartialEq)]
pub(crate) enum RpcMessage {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<Value>,
    },
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

pub(crate) fn parse_rpc_line(line: &str) -> Option<RpcMessage> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let method = v.get("method").and_then(Value::as_str)?.to_string();
    let params = v.get("params").cloned().unwrap_or(Value::Null);
    match v.get("id") {
        Some(id) if !id.is_null() => Some(RpcMessage::Request { id: id.clone(), method, params }),
        _ => Some(RpcMessage::Notification { method, params }),
    }
}

/// 从 response 行提取 result（成功）或 error（失败）。
pub(crate) fn parse_rpc_response(line: &str) -> Option<Result<Value, String>> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let has_method = v.get("method").is_some();
    let id = v.get("id")?;
    if id.is_null() || has_method {
        return None;
    }
    if let Some(err) = v.get("error") {
        return Some(Err(match err.get("message") {
            Some(m) => format!("{}: {}", m.as_str().unwrap_or("unknown"), err.get("data").map(|d| d.to_string()).unwrap_or_default()),
            None => err.to_string(),
        }));
    }
    Some(Ok(v.get("result").cloned().unwrap_or(Value::Null)))
}

/// `session/update` 通知里的文本增量（agent_message_chunk）。
pub(crate) fn text_delta(params: &Value) -> Option<String> {
    let update = params.get("update")?;
    if update.get("sessionUpdate")?.as_str()? != "agent_message_chunk" {
        return None;
    }
    let content = update.get("content")?;
    if content.get("type")?.as_str()? != "text" {
        return None;
    }
    content.get("text").and_then(Value::as_str).map(String::from)
}

/* ------------------------------------------------------------------ */
/* 进程与路径定位                                                       */
/* ------------------------------------------------------------------ */

/// GUI 环境（从 Finder 拉起）的 PATH 拿不到 ~/.local/bin 等目录，
/// 依次探测常见安装位置，找不到再退化到 PATH 里的 `node`。
fn find_node() -> PathBuf {
    let mut candidates = vec![];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/bin/node"));
        candidates.push(PathBuf::from(home).join(".nvm/versions/node/current/bin/node"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
    candidates.push(PathBuf::from("/usr/local/bin/node"));
    candidates.into_iter().find(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("node"))
}

/// 适配器 dist/index.js 的绝对路径：dev 下从 src-tauri 向上找 node_modules，
/// 打包后从可执行文件位置向上找。
fn find_adapter_entry() -> Result<PathBuf, String> {
    let package_dir = PathBuf::from(ADAPTER_PACKAGE).join(ADAPTER_ENTRY);
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        roots.push(PathBuf::from(manifest).join(".."));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        for _ in 0..5 {
            match dir.take() {
                Some(d) => {
                    roots.push(d.clone());
                    dir = d.parent().map(Path::to_path_buf);
                }
                None => break,
            }
        }
    }
    roots
        .iter()
        .map(|r| r.join("node_modules").join(&package_dir))
        .find(|p| p.is_file())
        .ok_or_else(|| format!("未找到 {ADAPTER_PACKAGE} 适配器（找了 node_modules 下的 {ADAPTER_ENTRY}）。请先在 apps/desktop 里 pnpm install。"))
}

/* ------------------------------------------------------------------ */
/* ACP 会话                                                            */
/* ------------------------------------------------------------------ */

enum ReaderMsg {
    Line(String),
    Eof,
}

struct Conn {
    child: Child,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    rx: mpsc::Receiver<ReaderMsg>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    next_id: u64,
    /// 本连接收到的助手文本增量累计（正文以它为准，result 只有 stopReason）。
    accumulated: String,
}

impl Conn {
    async fn spawn(claude_cli: Option<&Path>) -> Result<Self, String> {
        let node = find_node();
        let entry = find_adapter_entry()?;
        // 指向用户真实的 claude CLI（见 claude_cli 模块），SDK 会把它用作
        // pathToClaudeCodeExecutable，让 CLI 用上用户的 Keychain 登录态。
        let mut cmd = Command::new(&node);
        cmd.arg(&entry);
        if let Some(cli) = claude_cli {
            cmd.env("CLAUDE_CODE_EXECUTABLE", cli);
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("启动适配器失败（node: {}，entry: {}）：{e}", node.display(), entry.display()))?;

        let stdin = child.stdin.take().ok_or("适配器 stdin 不可用")?;
        let stdout = child.stdout.take().ok_or("适配器 stdout 不可用")?;
        let stderr = child.stderr.take().ok_or("适配器 stderr 不可用")?;

        let (tx, rx) = mpsc::channel::<ReaderMsg>(128);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if tx.send(ReaderMsg::Line(line)).await.is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            let _ = tx.send(ReaderMsg::Eof).await;
        });

        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut buf = tail.lock().unwrap();
                if buf.len() == STDERR_TAIL_LINES {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
        });

        Ok(Self {
            child,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            rx,
            stderr_tail,
            next_id: 0,
            accumulated: String::new(),
        })
    }

    async fn send(&mut self, method: &str, params: Value) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let mut stdin = self.stdin.lock().await;
        let _ = stdin.write_all(msg.to_string().as_bytes()).await;
        let _ = stdin.write_all(b"\n").await;
        let _ = stdin.flush().await;
        id
    }

    /// 读消息流直到目标 id 的 response 到达；期间把文本增量 emit 给前端，
    /// 对 agent 发来的请求（如权限申请）回复 method-not-found（聊天场景下
    /// 等价于拒绝使用工具）。
    async fn wait_response(
        &mut self,
        app: &AppHandle,
        message_id: &str,
        target_id: u64,
    ) -> Result<Value, String> {
        loop {
            match self.rx.recv().await {
                Some(ReaderMsg::Line(line)) => {
                    if let Some(delta) = serde_json::from_str::<Value>(&line)
                        .ok()
                        .as_ref()
                        .and_then(text_delta)
                    {
                        self.accumulated.push_str(&delta);
                        let _ = app.emit(
                            EVENT_CHUNK,
                            ChunkPayload {
                                message_id: message_id.to_string(),
                                delta,
                            },
                        );
                        continue;
                    }
                    if let Some(resp) = parse_rpc_response(&line) {
                        let is_target = serde_json::from_str::<Value>(&line)
                            .ok()
                            .and_then(|v| v.get("id").cloned())
                            .map(|id| id == json!(target_id))
                            .unwrap_or(false);
                        if is_target {
                            return resp.map_err(|e| format!("适配器错误：{e}"));
                        }
                        continue;
                    }
                    if let Some(RpcMessage::Request { id, method, .. }) = parse_rpc_line(&line) {
                        let err = json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {"code": -32601, "message": format!("Deer 伴读面板不支持 agent 发起的请求：{method}")}
                        });
                        let mut stdin = self.stdin.lock().await;
                        let _ = stdin.write_all(err.to_string().as_bytes()).await;
                        let _ = stdin.write_all(b"\n").await;
                        let _ = stdin.flush().await;
                    }
                }
                Some(ReaderMsg::Eof) | None => {
                    return Err(format!(
                        "适配器进程意外退出。{}",
                        self.stderr_brief()
                    ));
                }
            }
        }
    }

    fn stderr_brief(&self) -> String {
        let buf = self.stderr_tail.lock().unwrap();
        if buf.is_empty() {
            return String::new();
        }
        let joined = buf
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" | ");
        format!("stderr 尾部：{joined}")
    }

    async fn shutdown(&mut self) {
        let _ = self.child.kill().await;
    }
}

/// 跑一轮完整对话。返回助手全文与 ACP session id。
async fn run_chat(
    app: &AppHandle,
    message_id: &str,
    prompt: &str,
    resume_session_id: Option<&str>,
) -> Result<ClaudeChatResult, String> {
    let cli = crate::claude_cli::resolve_claude().await?;
    crate::claude_cli::auth_precheck(&cli).await?;
    let mut conn = Conn::spawn(Some(cli.as_path())).await?;

    let init_id = conn
        .send("initialize", json!({"protocolVersion": 1, "clientCapabilities": {}}))
        .await;
    conn.wait_response(app, message_id, init_id).await?;

    let session_id = match resume_session_id {
        Some(resume) => {
            let load_id = conn
                .send(
                    "session/load",
                    json!({"sessionId": resume, "cwd": std::env::var("HOME").unwrap_or_default(), "mcpServers": []}),
                )
                .await;
            conn.wait_response(app, message_id, load_id).await?;
            resume.to_string()
        }
        None => {
            let new_id = conn
                .send(
                    "session/new",
                    json!({"cwd": std::env::var("HOME").unwrap_or_default(), "mcpServers": []}),
                )
                .await;
            let result = conn.wait_response(app, message_id, new_id).await?;
            result
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "适配器未返回 sessionId".to_string())?
                .to_string()
        }
    };

    let prompt_id = conn
        .send(
            "session/prompt",
            json!({"sessionId": session_id, "prompt": [{"type": "text", "text": prompt}]}),
        )
        .await;
    let result = tokio::time::timeout(
        PROMPT_TIMEOUT,
        conn.wait_response(app, message_id, prompt_id),
    )
    .await
    .map_err(|_| format!("等待模型回复超时（{} 秒）。", PROMPT_TIMEOUT.as_secs()))??;

    let text = std::mem::take(&mut conn.accumulated);
    conn.shutdown().await;

    if result
        .get("stopReason")
        .and_then(Value::as_str)
        .unwrap_or_default()
        == "refusal"
    {
        return Err("模型拒绝了这次请求。".to_string());
    }

    Ok(ClaudeChatResult { text, session_id })
}

/// Tauri command：发一条消息给本机 claude（经 ACP 适配器）。
/// 增量经 `claude://chunk` 事件实时推送（供流式渲染），返回的 text 是
/// 增量累计的完整正文（供落库兜底），并带回 ACP session id。
#[tauri::command]
pub async fn claude_chat(
    app: AppHandle,
    prompt: String,
    message_id: String,
    resume_session_id: Option<String>,
) -> Result<ClaudeChatResult, String> {
    if prompt.trim().is_empty() {
        return Err("消息不能为空".to_string());
    }
    run_chat(&app, &message_id, &prompt, resume_session_id.as_deref()).await
}

/* ------------------------------------------------------------------ */
/* 单测：用实测捕获的真实报文覆盖解析逻辑                                */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agent_message_chunk() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"收到"}}}}"#;
        let msg = parse_rpc_line(line).unwrap();
        match msg {
            RpcMessage::Notification { method, params } => {
                assert_eq!(method, "session/update");
                assert_eq!(text_delta(&params).as_deref(), Some("收到"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn ignores_non_text_updates() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking"}}}}"#;
        let msg = parse_rpc_line(line).unwrap();
        match msg {
            RpcMessage::Notification { params, .. } => assert!(text_delta(&params).is_none()),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_session_new_response() {
        let line = r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"1c7e1d53-3581-4380-825c-e00091e611ab"}}"#;
        let resp = parse_rpc_response(line).unwrap().unwrap();
        assert_eq!(resp["sessionId"], "1c7e1d53-3581-4380-825c-e00091e611ab");
    }

    #[test]
    fn parses_prompt_stop_reason() {
        let line = r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#;
        let resp = parse_rpc_response(line).unwrap().unwrap();
        assert_eq!(resp["stopReason"], "end_turn");
    }

    #[test]
    fn parses_error_response_with_message() {
        let line = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"Internal error","data":{"details":"Query closed before response received"}}}"#;
        let err = parse_rpc_response(line).unwrap().unwrap_err();
        assert!(err.contains("Internal error"));
        assert!(err.contains("Query closed"));
    }

    #[test]
    fn parse_rpc_response_skips_requests_and_notifications() {
        assert!(parse_rpc_response(r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#).is_none());
        assert!(parse_rpc_response(
            r#"{"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{}}"#
        )
        .is_none());
        assert!(parse_rpc_response("not json").is_none());
    }

    #[test]
    fn parses_agent_request_for_permission() {
        let line = r#"{"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{"sessionId":"abc"}}"#;
        match parse_rpc_line(line).unwrap() {
            RpcMessage::Request { id, method, .. } => {
                assert_eq!(id, json!(9));
                assert_eq!(method, "session/request_permission");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn ignores_garbage_lines() {
        assert!(parse_rpc_line("").is_none());
        assert!(parse_rpc_line("[stderr] something").is_none());
    }

    #[test]
    fn finds_adapter_entry_in_dev_tree() {
        // 在仓库 worktree 里跑测试时，CARGO_MANIFEST_DIR 指向 src-tauri。
        let entry = find_adapter_entry().expect("适配器应可定位");
        assert!(entry.ends_with("dist/index.js"));
    }
}
