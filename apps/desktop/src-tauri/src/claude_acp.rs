//! ACP 公共解析层：acpx 连接层（acpx.rs）复用的解析纯函数、事件常量、
//! 超时参数与全局聊天门闩。
//!
//! 历史说明：这里曾有内置直连 claude 的完整链路（claude_chat 直 spawn
//! @zed-industries/claude-code-acp 适配器），2026-11 起移除，聊天统一走
//! acpx 关联本机 claude CLI。

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// 流式增量事件名：直连与 acpx 同名同构，前端渲染无差别。
pub(crate) const EVENT_CHUNK: &str = "claude://chunk";
pub(crate) const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
/// 第一个文本增量到达前的静默上限：正常一轮几秒内就有输出，超时基本意味着
/// 启动时被系统弹窗（钥匙串等）或网络问题挂住。
pub(crate) const IDLE_BEFORE_FIRST_CHUNK: Duration = Duration::from_secs(20);
/// 已经流式输出后两段之间的静默上限：长回答中途偶尔停顿，给更宽的余量。
pub(crate) const IDLE_BETWEEN_CHUNKS: Duration = Duration::from_secs(120);

/// 全局聊天串行化门闩：同一 app 进程内同一时刻只跑一个 ACP 会话。
pub(crate) static CHAT_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Serialize)]
pub struct ClaudeChatResult {
    pub text: String,
    pub session_id: String,
}

/* ------------------------------------------------------------------ */
/* JSON-RPC 消息解析（纯函数，供单测覆盖）                              */
/* ------------------------------------------------------------------ */

/// 从适配器的一整行 JSON-RPC 报文里提取文本增量。
/// 这层解包曾经漏掉（直接在顶层找 `update`，而它在 `params` 里），
/// 导致所有增量被静默丢弃、正文恒为空。
pub(crate) fn delta_from_line(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    text_delta(v.get("params")?)
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

/// `session/update` 通知 params 里的正文增量（agent_message_chunk）。
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

/* ------------------------------------------------------------------ */
/* 单测：用实测捕获的真实报文覆盖解析逻辑                                */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn update_params(update: &str, text: &str) -> Value {
        json!({"sessionId": "abc", "update": {"sessionUpdate": update, "content": {"type": "text", "text": text}}})
    }

    #[test]
    fn text_delta_extracts_only_message_chunks() {
        assert_eq!(
            text_delta(&update_params("agent_message_chunk", "收到")).as_deref(),
            Some("收到")
        );
        // 思考块不算正文，不得混进正文
        assert_eq!(text_delta(&update_params("agent_thought_chunk", "先想想")), None);
        // 非文本内容不产出增量
        let image: Value = serde_json::from_str(
            r#"{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"image","data":"..."}}}"#,
        )
        .unwrap();
        assert_eq!(text_delta(&image), None);
    }

    #[test]
    fn thought_delta_extracts_thought_chunks() {
        assert_eq!(
            thought_delta(&update_params("agent_thought_chunk", "先想想")).as_deref(),
            Some("先想想")
        );
        assert_eq!(thought_delta(&update_params("agent_message_chunk", "收到")), None);
    }

    #[test]
    fn extracts_delta_from_full_jsonrpc_line() {
        // 回归：真实报文里 update 在 params 下，整行直接丢给 text_delta
        // 曾永远返回 None（空气泡根因）。这里按线上形状断言。
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"收到"}}}}"#;
        assert_eq!(delta_from_line(line).as_deref(), Some("收到"));

        // 思考块不算正文；响应/坏行都不产出增量
        assert_eq!(
            delta_from_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hmm"}}}}"#),
            None
        );
        assert_eq!(delta_from_line(r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#), None);
        assert_eq!(delta_from_line("not json"), None);
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
}
