//! Deer 书架 MCP server（stdio 传输，newline-delimited JSON-RPC）。
//!
//! 同一个桌面二进制以 `--mcp-server` 参数启动时跳过 GUI，只跑这个
//! server：stdin/stdout 走 MCP 协议，进程退出即连接结束。两个入口共用：
//! - 外置 harness：`claude mcp add deer -- <desktop 二进制> --mcp-server`
//! - 内置聊天框：acpx 以 `--mcp-config` 挂载同一个命令（见 acpx.rs）
//!
//! 数据源是前端书架的持久化文件 `library.json`（tauri-plugin-store 落在
//! appDataDir，纯 JSON），Rust 侧只读，不与 GUI 抢写。
//!
//! 工具结果统一带 `{"deer":"books","books":[...]}` 标记：acpx 链路据此把
//! 书单抽成书卡事件推给前端渲染（见 acpx.rs 的 books_from_update）。

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::deer_log::log;

/// library.json 里的书籍记录（camelCase，与前端 Book 类型对应；字段缺省容忍）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookRecord {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub progress: f64,
    pub cover_path: Option<String>,
    pub last_opened_at: Option<u64>,
    pub last_location_cfi: Option<String>,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    pub added_at: u64,
}

impl Default for BookRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            author: String::new(),
            format: String::new(),
            progress: 0.0,
            cover_path: None,
            last_opened_at: None,
            last_location_cfi: None,
            tags: Vec::new(),
            size_bytes: 0,
            added_at: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfRecord {
    pub id: String,
    pub name: String,
    pub order: i64,
}

impl Default for ShelfRecord {
    fn default() -> Self {
        Self { id: String::new(), name: String::new(), order: 0 }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Library {
    pub books: Vec<BookRecord>,
    pub shelves: Vec<ShelfRecord>,
}

/// 工具结果里的书卡（前端渲染书卡所需的最小集合）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookCard {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
}

impl From<&BookRecord> for BookCard {
    fn from(book: &BookRecord) -> Self {
        Self {
            id: book.id.clone(),
            title: book.title.clone(),
            author: book.author.clone(),
            format: book.format.clone(),
            progress: book.progress,
            cover_path: book.cover_path.clone(),
        }
    }
}

/// appDataDir（与 Tauri 的 appDataDir 同规则）。DEER_DATA_DIR 可覆盖（测试用）。
pub fn default_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("DEER_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        PathBuf::from(home)
            .join("Library/Application Support/com.catnuko.deer")
    }
    #[cfg(not(target_os = "macos"))]
    {
        PathBuf::from(home).join(".local/share/com.catnuko.deer")
    }
}

fn library_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("library.json")
}

/// 读书架：文件缺失或损坏按空书架处理（外置 harness 场景下应用可能还没建库）。
pub fn load_library(data_dir: &std::path::Path) -> Library {
    let path = library_path(data_dir);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Library::default();
    };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        log("mcp", &format!("library.json 解析失败，按空书架处理：{e}"));
        Library::default()
    })
}

/* ------------------------------------------------------------------ */
/* 工具实现（纯函数，供单测覆盖）                                        */
/* ------------------------------------------------------------------ */

pub(crate) fn books_marker(books: Vec<BookCard>) -> Value {
    json!({ "deer": "books", "books": books })
}

pub(crate) fn search_books(library: &Library, query: &str) -> Value {
    let query = query.trim().to_lowercase();
    let matched: Vec<BookCard> = library
        .books
        .iter()
        .filter(|book| {
            query.is_empty()
                || book.title.to_lowercase().contains(&query)
                || book.author.to_lowercase().contains(&query)
                || book.tags.iter().any(|t| t.to_lowercase().contains(&query))
        })
        .map(BookCard::from)
        .collect();
    books_marker(matched)
}

/// 最近在读：按 lastOpenedAt 倒序，最多 10 本；current 是最近一本。
pub(crate) fn reading_state(library: &Library) -> Value {
    let mut recent: Vec<&BookRecord> = library
        .books
        .iter()
        .filter(|book| book.last_opened_at.is_some())
        .collect();
    recent.sort_by_key(|book| std::cmp::Reverse(book.last_opened_at));
    recent.truncate(10);
    let cards: Vec<BookCard> = recent.iter().map(|b| BookCard::from(*b)).collect();
    let current = cards.first().cloned();
    json!({
        "deer": "books",
        "books": cards,
        "current": current,
        "summary": if cards.is_empty() {
            "书架上还没有阅读记录".to_string()
        } else {
            format!("最近读过 {} 本（按最后打开时间倒序）", cards.len())
        },
    })
}

pub(crate) fn get_library(library: &Library) -> Value {
    let cards: Vec<BookCard> = library.books.iter().map(BookCard::from).collect();
    json!({
        "deer": "books",
        "books": cards,
        "shelves": library.shelves,
        "total": cards.len(),
    })
}

const TOOL_NAMES: [&str; 3] = ["search_books", "get_reading_state", "get_library"];

fn tool_definitions() -> Value {
    json!({
        "tools": [
            {
                "name": "search_books",
                "description": "按书名、作者或标签搜索用户的电子书书架（大小写不敏感）。返回匹配书籍的书卡列表（id/书名/作者/格式/进度/封面路径）。空关键词返回全书架。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词（书名/作者/标签的一部分）"
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "get_reading_state",
                "description": "获取用户最近在读的书与阅读进度（按最后打开时间倒序，最多 10 本）。用于了解用户阅读喜好、续读推荐。",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "get_library",
                "description": "获取用户完整书架清单（全部书籍的书卡与书架分组）。推荐书籍前用它挑选书架里已有的书。",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}

fn text_result(payload: &Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": payload.to_string() }],
        "isError": false,
    })
}

fn tool_error(message: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}

/// 处理一条 JSON-RPC 请求（有 id 的）；通知（无 id）返回 None。
pub(crate) fn handle_request(library: &Library, method: &str, params: &Value) -> Option<Result<Value, (i64, String)>> {
    match method {
        "initialize" => {
            // 协议版本回显客户端请求的版本；缺省用 2025-06-18。
            let version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18")
                .to_string();
            Some(Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "deer", "version": env!("CARGO_PKG_VERSION") },
            })))
        }
        "tools/list" => Some(Ok(tool_definitions())),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            if !TOOL_NAMES.contains(&name) {
                return Some(Ok(tool_error(&format!("未知工具：{name}"))));
            }
            let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
            let payload = match name {
                "search_books" => {
                    let query = arguments
                        .get("query")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    search_books(library, query)
                }
                "get_reading_state" => reading_state(library),
                _ => get_library(library),
            };
            Some(Ok(text_result(&payload)))
        }
        // MCP 生命周期通知与其它通知都静默接受
        "notifications/initialized" | "notifications/cancelled" => None,
        _ => Some(Err((
            -32601,
            format!("method not found: {method}"),
        ))),
    }
}

/// 把一行请求处理成一行响应（None = 通知，不需要响应）。
fn handle_line(library: &Library, line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let method = value.get("method")?.as_str()?.to_string();
    let id = value.get("id").cloned();
    // 无 id 或 id 为 null 的是通知
    let id = id?;
    if id.is_null() {
        return None;
    }
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let response = match handle_request(library, &method, &params) {
        Some(Ok(result)) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Some(Err((code, message))) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
        None => return None,
    };
    Some(response.to_string())
}

/// stdio 主循环：逐行读请求、写响应，stdin EOF 即退出。
/// 库快照由调用方在启动时读一次（main.rs 用 default_data_dir，测试可注入）。
pub fn run_stdio<R: BufRead, W: Write>(library: &Library, input: R, output: &mut W) {
    log(
        "mcp",
        &format!("MCP server 启动：书架 {} 本", library.books.len()),
    );
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        log("mcp", &format!("req {line}"));
        if let Some(response) = handle_line(&library, &line) {
            log("mcp", &format!("resp {response}"));
            if writeln!(output, "{response}").is_err() || output.flush().is_err() {
                break;
            }
        }
    }
    log("mcp", "MCP server 退出（stdin 关闭）");
}

/* ------------------------------------------------------------------ */
/* 单测                                                                 */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;

    fn fixture_library() -> Library {
        Library {
            books: vec![
                BookRecord {
                    id: "b1".into(),
                    title: "三体".into(),
                    author: "刘慈欣".into(),
                    format: "epub".into(),
                    progress: 0.4,
                    cover_path: Some("/covers/b1.png".into()),
                    last_opened_at: Some(100),
                    ..Default::default()
                },
                BookRecord {
                    id: "b2".into(),
                    title: "The Three-Body Problem".into(),
                    author: "Cixin Liu".into(),
                    format: "mobi".into(),
                    progress: 0.0,
                    cover_path: None,
                    last_opened_at: Some(200),
                    ..Default::default()
                },
                BookRecord {
                    id: "b3".into(),
                    title: "球状闪电".into(),
                    author: "刘慈欣".into(),
                    format: "epub".into(),
                    progress: 1.0,
                    cover_path: None,
                    last_opened_at: None,
                    ..Default::default()
                },
            ],
            shelves: vec![ShelfRecord { id: "s1".into(), name: "科幻".into(), order: 1 }],
        }
    }

    #[test]
    fn search_matches_title_author_tags_case_insensitive() {
        let library = fixture_library();
        let result = search_books(&library, "三体");
        let books = result["books"].as_array().unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0]["id"], "b1");
        assert_eq!(books[0]["coverPath"], "/covers/b1.png");
        assert_eq!(books[0]["progress"], 0.4);

        let by_author = search_books(&library, "cixin LIU");
        assert_eq!(by_author["books"].as_array().unwrap().len(), 1);
        assert_eq!(by_author["books"][0]["id"], "b2");

        // 空关键词 = 全书架
        assert_eq!(search_books(&library, "")["books"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn reading_state_orders_by_last_opened_and_excludes_never_opened() {
        let result = reading_state(&fixture_library());
        let books = result["books"].as_array().unwrap();
        assert_eq!(books.len(), 2, "从未打开过的书不算阅读记录");
        assert_eq!(books[0]["id"], "b2", "按最后打开时间倒序");
        assert_eq!(result["current"]["id"], "b2");
        assert!(result["summary"].as_str().unwrap().contains("2"));
    }

    #[test]
    fn get_library_returns_books_and_shelves() {
        let result = get_library(&fixture_library());
        assert_eq!(result["total"], 3);
        assert_eq!(result["shelves"][0]["name"], "科幻");
        assert_eq!(result["books"][2]["title"], "球状闪电");
    }

    #[test]
    fn handles_initialize_tools_list_and_call() {
        let library = fixture_library();
        let init = handle_request(
            &library,
            "initialize",
            &json!({ "protocolVersion": "2025-03-26", "clientCapabilities": {} }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(init["protocolVersion"], "2025-03-26");
        assert_eq!(init["serverInfo"]["name"], "deer");

        let tools = handle_request(&library, "tools/list", &Value::Null)
            .unwrap()
            .unwrap();
        let names: Vec<&str> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, TOOL_NAMES.to_vec());

        let call = handle_request(
            &library,
            "tools/call",
            &json!({ "name": "search_books", "arguments": { "query": "三体" } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(call["isError"], false);
        let text = call["content"][0]["text"].as_str().unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();
        assert_eq!(payload["deer"], "books");
        assert_eq!(payload["books"].as_array().unwrap().len(), 1);
        assert_eq!(payload["books"][0]["id"], "b1");
    }

    #[test]
    fn unknown_tool_is_tool_error_and_unknown_method_is_rpc_error() {
        let library = fixture_library();
        let call = handle_request(
            &library,
            "tools/call",
            &json!({ "name": "nope", "arguments": {} }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(call["isError"], true);

        let err = handle_request(&library, "resources/list", &Value::Null)
            .unwrap()
            .unwrap_err();
        assert_eq!(err.0, -32601);
    }

    #[test]
    fn notifications_get_no_response() {
        let library = fixture_library();
        assert!(handle_line(&library, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
        assert!(handle_line(&library, "not json").is_none());
        assert!(handle_line(&library, "").is_none());
    }

    #[test]
    fn stdio_round_trip_answers_each_request_line() {
        let library = fixture_library();
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#, "\n",
            "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_reading_state","arguments":{}}}"#, "\n",
        );
        let mut output: Vec<u8> = Vec::new();
        run_stdio(&library, BufReader::new(input.as_bytes()), &mut output);
        let lines: Vec<&str> = std::str::from_utf8(&output)
            .unwrap()
            .lines()
            .collect();
        assert_eq!(lines.len(), 2, "通知与空行不应有响应");

        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["id"], 1);
        assert_eq!(first["result"]["protocolVersion"], "2025-06-18");

        let second: Value = serde_json::from_str(lines[1]).unwrap();
        let text = second["result"]["content"][0]["text"].as_str().unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();
        assert_eq!(payload["current"]["id"], "b2");
    }

    #[test]
    fn load_library_tolerates_missing_and_broken_files() {
        let dir = std::env::temp_dir().join(format!("deer-mcp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(load_library(&dir).books.is_empty(), "文件缺失 = 空书架");

        std::fs::write(dir.join("library.json"), "not json").unwrap();
        assert!(load_library(&dir).books.is_empty(), "坏文件 = 空书架");

        std::fs::write(
            dir.join("library.json"),
            r#"{"shelves":[],"books":[{"id":"x","title":"书","author":"a","format":"epub","progress":0.5,"tags":[],"sizeBytes":1,"addedAt":1}]}"#,
        )
        .unwrap();
        let library = load_library(&dir);
        assert_eq!(library.books.len(), 1);
        assert_eq!(library.books[0].progress, 0.5);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
