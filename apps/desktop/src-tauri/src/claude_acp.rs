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
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

use crate::claude_cli::read_oauth_token;
use crate::deer_log::{log, LOG_HINT};

pub(crate) const EVENT_CHUNK: &str = "claude://chunk";
pub(crate) const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
/// 第一个文本增量到达前的静默上限：正常一轮几秒内就有输出，超时基本意味着
/// claude 启动时被系统弹窗（钥匙串等）或网络问题挂住。
pub(crate) const IDLE_BEFORE_FIRST_CHUNK: Duration = Duration::from_secs(20);
/// 已经流式输出后两段之间的静默上限：长回答中途偶尔停顿，给更宽的余量。
pub(crate) const IDLE_BETWEEN_CHUNKS: Duration = Duration::from_secs(120);
const ADAPTER_PACKAGE: &str = "@zed-industries/claude-code-acp";
const ADAPTER_ENTRY: &str = "dist/index.js";
const STDERR_TAIL_LINES: usize = 20;
/// 聊天请求的排队等待上限：在途时后来的请求最多等这么久拿门闩，超时拒绝。
/// （CHAT_GATE 是单门闩，实际最多 1 个在排队 + 1 个在跑。）
const CHAT_QUEUE_WAIT: Duration = Duration::from_secs(120);

/// 全局聊天串行化门闩：同一 app 进程内同一时刻只跑一个 ACP 会话。
/// acpx 后端（acpx.rs）与直连链路共用这一把门闩，跨后端也串行。
pub(crate) static CHAT_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Serialize)]
pub struct ClaudeChatResult {
    pub text: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct ChunkPayload {
    message_id: String,
    /// "message" = 正文增量，"thought" = 深度思考增量。
    kind: &'static str,
    delta: String,
}

const KIND_MESSAGE: &str = "message";
const KIND_THOUGHT: &str = "thought";

/* ------------------------------------------------------------------ */
/* JSON-RPC 消息解析（纯函数，供单测覆盖）                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, PartialEq)]
pub(crate) enum RpcMessage {
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

/// 空闲超时的定向错误文案。GUI 里卡住时没有 stderr 可看，文案必须点名
/// 「正在等的是哪一步」以及最可能的外部原因（系统弹窗），并指出日志位置。
pub(crate) fn idle_timeout_error(stage: &str, idle: Duration, stderr_tail: &str) -> String {
    let secs = idle.as_secs();
    let base = match stage {
        "initialize" => format!(
            "ACP 适配器在 {secs} 秒内没有响应（initialize）。请确认 node 与 @zed-industries/claude-code-acp 安装完好后重试。"
        ),
        "session" => format!(
            "claude 会话在 {secs} 秒内没有建立：claude 可能在启动时被系统弹窗（如 macOS 钥匙串授权）拦住，或启动即失败。请检查屏幕上是否有系统弹窗并允许后重试。"
        ),
        _ => format!(
            "发出消息后 {secs} 秒内没有收到模型的任何输出：常见原因是 macOS 钥匙串/安全弹窗在等待你确认，或网络不通。请检查屏幕上是否有系统弹窗并允许后重试。"
        ),
    };
    let tail = if stderr_tail.is_empty() {
        String::new()
    } else {
        format!("（{stderr_tail}）")
    };
    format!("{base}{tail}诊断日志：{LOG_HINT}")
}

/// 从适配器的一整行 JSON-RPC 报文里提取文本增量。
/// 这层解包曾经漏掉（直接在顶层找 `update`，而它在 `params` 里），
/// 导致所有增量被静默丢弃、正文恒为空。
pub(crate) fn delta_from_line(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    text_delta(v.get("params")?)
}

/// 整行若是 session/update 通知，返回其 params（正文/思考增量的公共入口）。
fn session_update_params(line: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("method")?.as_str()? != "session/update" {
        return None;
    }
    v.get("params").cloned()
}

/// `session/update` 通知里的文本增量（agent_message_chunk）。
pub(crate) fn text_delta(params: &Value) -> Option<String> {
    chunk_text(params, "agent_message_chunk")
}

/// 深度思考增量（agent_thought_chunk）。思考块不算正文，
/// 单独解析后以 kind=thought 推给前端折叠展示。
pub(crate) fn thought_delta(params: &Value) -> Option<String> {
    chunk_text(params, "agent_thought_chunk")
}

fn chunk_text(params: &Value, session_update: &str) -> Option<String> {
    let update = params.get("update")?;
    if update.get("sessionUpdate")?.as_str()? != session_update {
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
pub(crate) fn find_node() -> PathBuf {
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
    /// 本连接是否已收到任何输出（正文或思考）：思考块不算正文，但同样
    /// 证明链路活着，空闲计时应从「首个增量前」放宽到「段间」。
    saw_output: bool,
}

impl Conn {
    async fn spawn(claude_cli: Option<&Path>, deep_thinking: bool) -> Result<Self, String> {
        let node = find_node();
        let entry = find_adapter_entry()?;
        // 指向用户真实的 claude CLI（见 claude_cli 模块），SDK 会把它用作
        // pathToClaudeCodeExecutable，让 CLI 用上用户的 Keychain 登录态。
        let mut cmd = Command::new(&node);
        cmd.arg(&entry);
        if let Some(cli) = claude_cli {
            cmd.env("CLAUDE_CODE_EXECUTABLE", cli);
        }
        // 深度思考：适配器在每次 session/prompt 时读 MAX_THINKING_TOKENS
        // 传给 SDK 的 maxThinkingTokens，CLI 产出的 thinking 内容再以
        // agent_thought_chunk 流回。每轮对话 spawn 新进程，所以按轮注入即可。
        if deep_thinking {
            cmd.env("MAX_THINKING_TOKENS", "10000");
            log("chat", "深度思考已开启（MAX_THINKING_TOKENS=10000）");
        }
        // 官方绕开钥匙串的途径：CLAUDE_CODE_OAUTH_TOKEN 优先于钥匙串读取
        // （CLI 2.x 二进制内证）。令牌来自 `claude setup-token` 的输出，用户
        // 手动放进 ~/.config/deer/claude-oauth-token（我们不代管凭据文件）。
        if let Some(token) = read_oauth_token() {
            cmd.env("CLAUDE_CODE_OAUTH_TOKEN", token);
            log("auth", "已从 ~/.config/deer/claude-oauth-token 注入 CLAUDE_CODE_OAUTH_TOKEN（绕开钥匙串）");
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                let msg = format!("启动适配器失败（node: {}，entry: {}）：{e}", node.display(), entry.display());
                log("spawn", &msg);
                msg
            })?;
        log(
            "spawn",
            &format!(
                "pid={:?} node={} entry={} claude={:?}",
                child.id(),
                node.display(),
                entry.display(),
                claude_cli.map(|p| p.display().to_string())
            ),
        );

        let stdin = child.stdin.take().ok_or("适配器 stdin 不可用")?;
        let stdout = child.stdout.take().ok_or("适配器 stdout 不可用")?;
        let stderr = child.stderr.take().ok_or("适配器 stderr 不可用")?;

        let (tx, rx) = mpsc::channel::<ReaderMsg>(128);
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
            log("eof", "适配器 stdout 关闭");
            let _ = tx.send(ReaderMsg::Eof).await;
        });

        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log("stderr", &line);
                let mut buf = tail.lock().unwrap();
                if buf.len() == STDERR_TAIL_LINES {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
            log("eof", "适配器 stderr 关闭");
        });

        Ok(Self {
            child,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            rx,
            stderr_tail,
            next_id: 0,
            accumulated: String::new(),
            saw_output: false,
        })
    }

    async fn send(&mut self, method: &str, params: Value) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        log("send", &format!("{method} id={id}"));
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
    ///
    /// `stage` 用于空闲超时的报错文案。静默上限：第一个文本增量前 20 秒
    /// （正常一轮几秒内就有输出），流式输出开始后放宽到 120 秒。
    async fn wait_response<F: FnMut(&str, &'static str, String) + Send>(
        &mut self,
        message_id: &str,
        target_id: u64,
        stage: &str,
        on_chunk: &mut F,
    ) -> Result<Value, String> {
        loop {
            let idle = if !self.saw_output {
                IDLE_BEFORE_FIRST_CHUNK
            } else {
                IDLE_BETWEEN_CHUNKS
            };
            let msg = match tokio::time::timeout(idle, self.rx.recv()).await {
                Ok(msg) => msg,
                Err(_) => {
                    let err = idle_timeout_error(stage, idle, &self.stderr_brief());
                    log("timeout", &format!("{stage} 静默 {} 秒", idle.as_secs()));
                    return Err(err);
                }
            };
            match msg {
                Some(ReaderMsg::Line(line)) => {
                    if let Some(params) = session_update_params(&line) {
                        self.saw_output = true;
                        if let Some(delta) = text_delta(&params) {
                            self.accumulated.push_str(&delta);
                            on_chunk(message_id, KIND_MESSAGE, delta);
                        } else if let Some(delta) = thought_delta(&params) {
                            on_chunk(message_id, KIND_THOUGHT, delta);
                        }
                        continue;
                    }
                    if let Some(resp) = parse_rpc_response(&line) {
                        let is_target = serde_json::from_str::<Value>(&line)
                            .ok()
                            .and_then(|v| v.get("id").cloned())
                            .map(|id| id == json!(target_id))
                            .unwrap_or(false);
                        if is_target {
                            return resp.map_err(|e| {
                                log("error", &format!("{stage} 返回错误：{e}"));
                                format!("适配器错误：{e}")
                            });
                        }
                        continue;
                    }
                    if let Some(RpcMessage::Request { id, method, .. }) = parse_rpc_line(&line) {
                        log("rpc", &format!("拒绝 agent 发起的请求：{method} id={id}"));
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
                    let err = format!("适配器进程意外退出。{}", self.stderr_brief());
                    log("eof", &err);
                    return Err(err);
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
        match self.child.kill().await {
            Ok(()) => log("exit", "适配器进程已终止"),
            Err(e) => log("exit", &format!("终止适配器进程失败：{e}")),
        }
    }
}

/// 跑一轮完整对话。返回助手全文与 ACP session id。
/// `on_chunk` 收到每个文本增量（生产路径用它向前端 emit 事件），
/// kind 区分正文（message）与深度思考（thought）。
async fn run_chat<F: FnMut(&str, &'static str, String) + Send>(
    on_chunk: &mut F,
    message_id: &str,
    prompt: &str,
    resume_session_id: Option<&str>,
    deep_thinking: bool,
) -> Result<ClaudeChatResult, String> {
    let t0 = Instant::now();
    log(
        "start",
        &format!(
            "message_id={message_id} resume={} thinking={} prompt_chars={}",
            resume_session_id.is_some(),
            deep_thinking,
            prompt.chars().count()
        ),
    );

    let cli = match crate::claude_cli::resolve_claude().await {
        Ok(cli) => {
            log(
                "cli",
                &format!("定位到 {}（耗时 {} ms）", cli.display(), t0.elapsed().as_millis()),
            );
            cli
        }
        Err(e) => {
            log("cli", &format!("定位失败：{e}"));
            return Err(e);
        }
    };
    match crate::claude_cli::auth_precheck(&cli).await {
        Ok(()) => log("auth", "预检通过"),
        Err(e) => {
            log("auth", &format!("预检失败：{e}"));
            return Err(e);
        }
    }
    let keychain = crate::claude_cli::keychain_probe().await;
    log("keychain", &keychain);

    let mut conn = Conn::spawn(Some(cli.as_path()), deep_thinking).await?;

    let init_id = conn
        .send("initialize", json!({"protocolVersion": 1, "clientCapabilities": {}}))
        .await;
    conn.wait_response(message_id, init_id, "initialize", on_chunk).await?;
    log("stage", "initialize 完成");

    let session_id = match resume_session_id {
        Some(resume) => {
            let load_id = conn
                .send(
                    "session/load",
                    json!({"sessionId": resume, "cwd": std::env::var("HOME").unwrap_or_default(), "mcpServers": []}),
                )
                .await;
            conn.wait_response(message_id, load_id, "session", on_chunk).await?;
            log("stage", "session/load 完成");
            resume.to_string()
        }
        None => {
            let new_id = conn
                .send(
                    "session/new",
                    json!({"cwd": std::env::var("HOME").unwrap_or_default(), "mcpServers": []}),
                )
                .await;
            let result = conn.wait_response(message_id, new_id, "session", on_chunk).await?;
            let sid = result
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "适配器未返回 sessionId".to_string())?
                .to_string();
            log("stage", &format!("session/new 完成：{sid}"));
            sid
        }
    };

    let prompt_id = conn
        .send(
            "session/prompt",
            json!({"sessionId": session_id, "prompt": [{"type": "text", "text": prompt}]}),
        )
        .await;
    log("stage", "session/prompt 已发出，等待首个输出");
    let result = tokio::time::timeout(
        PROMPT_TIMEOUT,
        conn.wait_response(message_id, prompt_id, "prompt", on_chunk),
    )
    .await
    .map_err(|_| {
        let err = format!(
            "等待模型回复超时（{} 秒）。诊断日志：{LOG_HINT}",
            PROMPT_TIMEOUT.as_secs()
        );
        log("timeout", &err);
        err
    })??;

    let text = std::mem::take(&mut conn.accumulated);
    log(
        "done",
        &format!(
            "stopReason={:?} text_chars={} 总耗时 {} ms",
            result.get("stopReason"),
            text.chars().count(),
            t0.elapsed().as_millis()
        ),
    );
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
///
/// 全局串行：同一时刻只允许一个 ACP 会话在跑（见 CHAT_GATE）。在途时收到
/// 的请求最多排队 CHAT_QUEUE_CAP-1 个，超了直接报错——排队者等一轮回复
/// 结束后依次执行，而不是并发 spawn 互相踩会话状态。
#[tauri::command]
pub async fn claude_chat(
    app: AppHandle,
    prompt: String,
    message_id: String,
    resume_session_id: Option<String>,
    deep_thinking: Option<bool>,
) -> Result<ClaudeChatResult, String> {
    if prompt.trim().is_empty() {
        return Err("消息不能为空".to_string());
    }

    // try_lock 先探队列满没满；满了立刻报错，不让用户干等。
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
            ChunkPayload {
                message_id: mid.to_string(),
                kind,
                delta,
            },
        );
    };
    run_chat(
        &mut emit_chunk,
        &message_id,
        &prompt,
        resume_session_id.as_deref(),
        deep_thinking.unwrap_or(false),
    )
    .await
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
    fn extracts_delta_from_full_jsonrpc_line() {
        // 回归：真实报文里 update 在 params 下，整行直接丢给 text_delta
        // 曾永远返回 None（空气泡根因）。这里按线上形状断言。
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"收到"}}}}"#;
        assert_eq!(delta_from_line(line).as_deref(), Some("收到"));

        // 思考块不算正文；响应/通知/坏行都不产出增量
        assert_eq!(
            delta_from_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hmm"}}}}"#),
            None
        );
        assert_eq!(delta_from_line(r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#), None);
        assert_eq!(delta_from_line("not json"), None);
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
    fn parses_thought_chunk_as_thought_not_message() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"先想想"}}}}"#;
        let params = session_update_params(line).unwrap();
        assert_eq!(thought_delta(&params).as_deref(), Some("先想想"));
        assert_eq!(text_delta(&params), None, "思考块不得混进正文");

        // 非 session/update 的行不产出思考增量
        assert!(session_update_params(r#"{"jsonrpc":"2.0","id":3,"result":{}}"#).is_none());
        assert!(session_update_params("not json").is_none());
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
    fn idle_timeout_error_names_the_stage_and_log_file() {
        let d = Duration::from_secs(20);
        let prompt = idle_timeout_error("prompt", d, "");
        assert!(prompt.contains("20 秒"));
        assert!(prompt.contains("钥匙串"));
        assert!(prompt.contains(crate::deer_log::LOG_HINT));

        let session = idle_timeout_error("session", d, "");
        assert!(session.contains("会话"));

        let init = idle_timeout_error("initialize", d, "");
        assert!(init.contains("适配器"));

        // stderr 尾部会拼进文案，方便用户直接看到线索
        let with_tail = idle_timeout_error("prompt", d, "stderr 尾部：boom");
        assert!(with_tail.contains("boom"));
    }

    #[test]
    fn finds_adapter_entry_in_dev_tree() {
        // 在仓库 worktree 里跑测试时，CARGO_MANIFEST_DIR 指向 src-tauri。
        let entry = find_adapter_entry().expect("适配器应可定位");
        assert!(entry.ends_with("dist/index.js"));
    }

    /// 真实 ACP 会话（终端里手工跑）：`cargo test -- --ignored real_acp_chat`
    /// 走完整管线：resolve → 预检 → 钥匙串探针 → spawn → initialize →
    /// session/new → prompt，并把日志隔离到临时 HOME，验证日志真的写得出来。
    /// 依赖本机已登录的 claude CLI，CI / 无环境时用 `cargo test`（不含它）。
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "依赖本机已登录的 claude CLI 与网络，手工跑"]
    async fn real_acp_chat_round_trip_and_log_file() {
        let fake_home = std::env::temp_dir().join(format!(
            "deer-real-acp-home-{}",
            std::process::id()
        ));
        let logs = fake_home.join("Library/Logs/deer");
        let _ = std::fs::remove_dir_all(&fake_home);
        std::fs::create_dir_all(&logs).unwrap();
        // HOME 决定日志路径（deer_log 用 $HOME/Library/Logs/deer）；已有日志
        // 文件的话先挪走，避免读到旧文件误判。
        let saved_home = std::env::var("HOME").unwrap();
        let real_log = PathBuf::from(&saved_home).join("Library/Logs/deer/claude-acp.log");
        let backup = if real_log.exists() {
            let b = std::env::temp_dir().join(format!("deer-log-backup-{}", std::process::id()));
            std::fs::rename(&real_log, &b).unwrap();
            Some(b)
        } else {
            None
        };
        // HOME 决定日志路径（deer_log 用 $HOME/Library/Logs/deer）；测试进程
        // 内单线程改环境变量是安全的（本测试是 --ignore 手工跑，与其余测试
        // 串行执行由调用方保证）。
        unsafe { std::env::set_var("HOME", &fake_home) };

        let chunks = std::sync::Mutex::new(Vec::<String>::new());
        let result = run_chat(
            &mut |_, _, delta: String| chunks.lock().unwrap().push(delta),
            "test-msg-1",
            "回复两个字：收到",
            None,
            false,
        )
        .await;

        let result = result.expect("真实会话应成功");
        let text = result.text;
        assert!(!result.session_id.is_empty(), "应返回 ACP session id");
        assert!(text.contains("收到"), "正文应包含模型回复，实际：{text}");
        assert!(!chunks.lock().unwrap().is_empty(), "增量应至少有一条");
        assert_eq!(chunks.lock().unwrap().join(""), text, "增量累计应等于正文");

        // 日志文件真实写出且不含凭据
        let log_file = logs.join("claude-acp.log");
        assert!(log_file.exists(), "日志文件应被创建：{}", log_file.display());
        let content = std::fs::read_to_string(&log_file).unwrap();
        // --nocapture 时打印全文，方便人工核对各阶段日志
        eprintln!("---- claude-acp.log ----\n{content}----");
        assert!(content.contains("[start]"), "应有 start 阶段");
        assert!(content.contains("[done]"), "应有 done 阶段");
        assert!(!content.contains("sk-ant-"), "日志不得包含 token");

        unsafe { std::env::set_var("HOME", &saved_home) };
        if let Some(b) = backup {
            std::fs::rename(&b, &real_log).unwrap();
        }
        let _ = std::fs::remove_dir_all(&fake_home);
    }
}
