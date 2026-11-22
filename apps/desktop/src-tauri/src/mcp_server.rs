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
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfRecord {
    pub id: String,
    pub name: String,
    pub order: i64,
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
        PathBuf::from(home).join("Library/Application Support/com.catnuko.deer")
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

/* ------------------------------------------------------------------ */
/* AI 伴读工具（词典/翻译/百科，与云链路 deerTools.ts 语义对齐）          */
/* ------------------------------------------------------------------ */

/** 词典 senses 上限：控制上下文体积与卡片高度（与 deerTools.ts 同约定）。 */
pub(crate) const DICTIONARY_SENSE_LIMIT: usize = 6;
/** 翻译原文上限：超长截断并带 truncated 标记（与 deerTools.ts 同约定）。 */
pub(crate) const MAX_TRANSLATION_CHARS: usize = 2000;
/** 百科摘要上限：超出截断（与 deerTools.ts 同约定）。 */
pub(crate) const MAX_ENCYCLOPEDIA_EXTRACT_CHARS: usize = 1200;
/** lang 缺省或无法识别时回退的维基语言。 */
pub(crate) const DEFAULT_WIKIPEDIA_LANG: &str = "en";

/// HTTP 失败分类：Status = 请求到达但非 2xx（查无词条按 not_found 算），
/// Transport = 连接/解码失败（百科侧按 network_error 算）。
#[derive(Debug)]
pub(crate) enum HttpError {
    Status(u16),
    Transport(String),
}

/// 共享 HTTP 客户端（15 秒超时：外部免费 API 慢也不能拖死 MCP 工具调用）。
fn http_client() -> Result<reqwest::Client, HttpError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let c = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        // Wikipedia 与 dictionaryapi.dev（Cloudflare）都拒绝无描述性 UA 的请求，
        // 不带会被 403（实测默认 UA 全 miss）。
        .user_agent(concat!(
            "deer/",
            env!("CARGO_PKG_VERSION"),
            " (local reading companion; MCP lookup tools)"
        ))
        .build()
        .map_err(|e| HttpError::Transport(e.to_string()))?;
    let _ = CLIENT.set(c.clone());
    Ok(c)
}

/// GET 一个 JSON URL；非 2xx → Status，连接/解码失败 → Transport，都不 panic。
async fn http_get_json(client: &reqwest::Client, url: &str) -> Result<Value, HttpError> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| HttpError::Transport(e.to_string()))?;
    if !res.status().is_success() {
        return Err(HttpError::Status(res.status().as_u16()));
    }
    res.json::<Value>()
        .await
        .map_err(|e| HttpError::Transport(e.to_string()))
}

/// RFC 3986 unreserved 之外的字节全部百分号编码（encodeURIComponent 语义）。
pub(crate) fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn dictionary_url(word: &str) -> String {
    format!(
        "https://api.dictionaryapi.dev/api/v2/entries/en/{}",
        percent_encode(word)
    )
}

fn wikipedia_url(lang: &str, term: &str) -> String {
    format!(
        "https://{}.wikipedia.org/api/rest_v1/page/summary/{}",
        lang,
        percent_encode(term)
    )
}

/// 规范化维基语言代码：取主子标签（zh-CN → zh），空值或非字母代码回退英文维基。
pub(crate) fn normalize_wikipedia_lang(lang: &str) -> String {
    let primary = lang.trim().split('-').next().unwrap_or("").to_lowercase();
    let valid = (2..=8).contains(&primary.len()) && primary.chars().all(|c| c.is_ascii_lowercase());
    if valid {
        primary
    } else {
        DEFAULT_WIKIPEDIA_LANG.to_string()
    }
}

fn dictionary_miss(word: &str) -> Value {
    json!({ "deer": "dictionary", "found": false, "word": word })
}

/// 解析 dictionaryapi.dev 的词条数组 → 词典卡标记 payload。
/// 空释义直接丢弃、senses 截到上限；没有任何可用释义时 found:false。
pub(crate) fn parse_dictionary_entry(word: &str, payload: &Value) -> Value {
    let miss = dictionary_miss(word);
    let Some(entries) = payload.as_array() else {
        return miss;
    };
    let Some(entry) = entries
        .iter()
        .find(|e| e.get("meanings").and_then(Value::as_array).is_some())
    else {
        return miss;
    };

    let mut senses: Vec<Value> = Vec::new();
    for meaning in entry["meanings"].as_array().unwrap_or(&Vec::new()) {
        let part_of_speech = meaning
            .get("partOfSpeech")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(definitions) = meaning.get("definitions").and_then(Value::as_array) else {
            continue;
        };
        for item in definitions {
            let definition = item
                .get("definition")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if definition.is_empty() {
                continue;
            }
            let example = item
                .get("example")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let mut sense = serde_json::Map::new();
            if let Some(pos) = part_of_speech {
                sense.insert("partOfSpeech".into(), json!(pos));
            }
            sense.insert("definition".into(), json!(definition));
            if let Some(example) = example {
                sense.insert("example".into(), json!(example));
            }
            senses.push(Value::Object(sense));
            if senses.len() >= DICTIONARY_SENSE_LIMIT {
                break;
            }
        }
        if senses.len() >= DICTIONARY_SENSE_LIMIT {
            break;
        }
    }
    if senses.is_empty() {
        return miss;
    }

    let fallback_phonetic = entry
        .get("phonetics")
        .and_then(Value::as_array)
        .and_then(|list| {
            list.iter()
                .find_map(|p| p.get("text").and_then(Value::as_str))
                .map(str::trim)
                .filter(|s| !s.is_empty())
        });
    let phonetic = entry
        .get("phonetic")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(fallback_phonetic);

    let word_out = entry
        .get("word")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(word);
    let mut payload = json!({
        "deer": "dictionary",
        "found": true,
        "word": word_out,
        "senses": senses,
    });
    if let Some(phonetic) = phonetic {
        payload["phonetic"] = json!(phonetic);
    }
    payload
}

/// 词典工具结果：HTTP 命中走解析，非 2xx / 网络失败 / 空词一律结构化 miss。
pub(crate) fn dictionary_payload(word: &str, outcome: Result<Value, HttpError>) -> Value {
    let word = word.trim();
    if word.is_empty() {
        return dictionary_miss(word);
    }
    match outcome {
        Ok(payload) => parse_dictionary_entry(word, &payload),
        Err(e) => {
            let detail = match &e {
                HttpError::Status(code) => format!("HTTP {code}"),
                HttpError::Transport(msg) => msg.clone(),
            };
            log(
                "mcp",
                &format!("词典查询失败 word={word}：{detail}，返回结构化 miss"),
            );
            dictionary_miss(word)
        }
    }
}

/// translate_text 的结构化承载：翻译由模型完成，本工具只校验与截断。
/// 空原文/空译文返回 Err（模型据此向用户说明），命中返回翻译卡标记 payload。
pub(crate) fn normalize_translation(args: &Value) -> Result<Value, String> {
    let field = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let Some(text) = field("text") else {
        return Err("待翻译文本为空，请提供要翻译的内容。".into());
    };
    let Some(translated_text) = field("translatedText") else {
        return Err("译文为空，请先完成翻译再调用本工具。".into());
    };

    let truncated = text.chars().count() > MAX_TRANSLATION_CHARS;
    let source_text: String = text.chars().take(MAX_TRANSLATION_CHARS).collect();
    let mut payload = json!({
        "deer": "translation",
        "sourceText": source_text,
        "translatedText": translated_text,
    });
    if let Some(target_lang) = field("targetLang") {
        payload["targetLang"] = json!(target_lang);
    }
    if let Some(source_lang) = field("sourceLang") {
        payload["sourceLang"] = json!(source_lang);
    }
    if truncated {
        payload["truncated"] = json!(true);
    }
    Ok(payload)
}

fn encyclopedia_miss(term: &str, lang: &str, reason: &str) -> Value {
    json!({
        "deer": "encyclopedia",
        "found": false,
        "term": term,
        "lang": lang,
        "reason": reason,
    })
}

/// 解析 Wikipedia REST page/summary → 百科标记 payload。消歧义页与空摘要
/// 视为查无；content_urls 缺省时用标题拼词条链接兜底；摘要超长截断。
pub(crate) fn parse_wikipedia_summary(term: &str, lang: &str, payload: &Value) -> Value {
    if payload.get("type").and_then(Value::as_str) == Some("disambiguation") {
        return encyclopedia_miss(term, lang, "disambiguation");
    }
    let extract = payload
        .get("extract")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if extract.is_empty() {
        return encyclopedia_miss(term, lang, "not_found");
    }

    let title = payload
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(term);
    let url = payload
        .get("content_urls")
        .and_then(|c| c.get("desktop"))
        .and_then(|d| d.get("page"))
        .and_then(Value::as_str)
        .filter(|u| u.starts_with("https://"))
        .map(String::from)
        .unwrap_or_else(|| {
            format!(
                "https://{lang}.wikipedia.org/wiki/{}",
                percent_encode(&title.replace(' ', "_"))
            )
        });
    let extract: String = if extract.chars().count() > MAX_ENCYCLOPEDIA_EXTRACT_CHARS {
        extract
            .chars()
            .take(MAX_ENCYCLOPEDIA_EXTRACT_CHARS)
            .collect()
    } else {
        extract.to_string()
    };
    json!({
        "deer": "encyclopedia",
        "found": true,
        "term": term,
        "lang": lang,
        "title": title,
        "extract": extract,
        "url": url,
    })
}

/// 百科工具结果：非 2xx → not_found，网络/解码失败 → network_error，
/// 命中走解析；结构化 miss，不 panic（模型按自身知识作答并说明未经核实）。
pub(crate) fn encyclopedia_payload(
    term: &str,
    lang_param: &str,
    outcome: Result<Value, HttpError>,
) -> Value {
    let term = term.trim();
    let lang = normalize_wikipedia_lang(lang_param);
    if term.is_empty() {
        return encyclopedia_miss(term, &lang, "not_found");
    }
    match outcome {
        Ok(payload) => parse_wikipedia_summary(term, &lang, &payload),
        Err(e) => {
            let (reason, detail) = match &e {
                HttpError::Status(code) => ("not_found", format!("HTTP {code}")),
                HttpError::Transport(msg) => ("network_error", msg.clone()),
            };
            log(
                "mcp",
                &format!("百科查询失败 term={term} lang={lang}（{detail}），reason={reason}"),
            );
            encyclopedia_miss(term, &lang, reason)
        }
    }
}

const TOOL_NAMES: [&str; 6] = [
    "search_books",
    "get_reading_state",
    "get_library",
    "lookup_dictionary",
    "translate_text",
    "encyclopedia_lookup",
];

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
            },
            {
                "name": "lookup_dictionary",
                "description": "查英文单词释义（数据源 dictionaryapi.dev）：返回结构化词条（音标/词性/英文释义/例句）。用户问某个词是什么意思、要词典解释时用它。found:false 表示词典源没收录或网络失败，此时改用自身知识解释，并向用户说明词典源没有查到。targetLang 仅提示用户偏好的解释语言，词典源释义固定为英文，需要其他语言时由你自行翻译。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "word": {
                            "type": "string",
                            "description": "要查的英文单词（单个词或短语）"
                        },
                        "targetLang": {
                            "type": "string",
                            "description": "期望的解释语言（如 zh-CN）；词典源释义固定为英文，由模型自行翻译"
                        }
                    },
                    "required": ["word"]
                }
            },
            {
                "name": "translate_text",
                "description": "翻译任意语言的文本（由你直接完成翻译，不调外部翻译 API）：先自行翻译，再把原文、译文与语言方向通过本工具提交，前端会渲染成原文/译文对照卡。用户要翻译划选内容、句子或段落时用它；纯闲聊不需要翻译时不要调用。text 超 2000 字符时只取前 2000 字符。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "要翻译的原文" },
                        "targetLang": { "type": "string", "description": "目标语言（如 zh-CN、日文、English）" },
                        "translatedText": { "type": "string", "description": "你完成的译文（原文本身已是目标语言时，做润色或改写说明）" },
                        "sourceLang": { "type": "string", "description": "检测出的原文语言（如 en、zh-CN），无法判断时省略" }
                    },
                    "required": ["text", "translatedText"]
                }
            },
            {
                "name": "encyclopedia_lookup",
                "description": "查询人物、术语、历史/背景概念的百科摘要（数据源 Wikipedia REST API）：返回摘要、词条标题与来源链接。用户问「某某是什么背景/什么概念」等需要权威背景知识时用它。拿到结果后把摘要以你自己的话转述进回答正文，并附上来源链接，不要原样堆砌摘要。found:false 表示维基查无此词条（not_found）、只有消歧义页（disambiguation）或网络失败（network_error），此时改用自身知识作答，并明确向用户说明该部分内容「未经百科核实」，不要编造来源链接。",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "term": { "type": "string", "description": "要查询的词条（人物/事件/术语名）" },
                        "lang": { "type": "string", "description": "维基语言代码（如 en、zh、ja）；缺省查英文维基" }
                    },
                    "required": ["term"]
                }
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
/// 词典/百科工具要发外部 HTTP，因此是 async（调用方在 runtime 里驱动）。
pub(crate) async fn handle_request(
    library: &Library,
    method: &str,
    params: &Value,
) -> Option<Result<Value, (i64, String)>> {
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
                    let query = arguments.get("query").and_then(Value::as_str).unwrap_or("");
                    search_books(library, query)
                }
                "get_reading_state" => reading_state(library),
                "get_library" => get_library(library),
                "lookup_dictionary" => {
                    let word = arguments.get("word").and_then(Value::as_str).unwrap_or("");
                    let outcome = match http_client() {
                        Ok(client) => http_get_json(&client, &dictionary_url(word.trim())).await,
                        Err(e) => Err(e),
                    };
                    dictionary_payload(word, outcome)
                }
                "translate_text" => {
                    return Some(match normalize_translation(&arguments) {
                        Ok(payload) => Ok(text_result(&payload)),
                        Err(message) => Ok(tool_error(&message)),
                    });
                }
                _ => {
                    let term = arguments.get("term").and_then(Value::as_str).unwrap_or("");
                    let lang = arguments.get("lang").and_then(Value::as_str).unwrap_or("");
                    let outcome = match http_client() {
                        Ok(client) => {
                            let url = wikipedia_url(&normalize_wikipedia_lang(lang), term.trim());
                            http_get_json(&client, &url).await
                        }
                        Err(e) => Err(e),
                    };
                    encyclopedia_payload(term, lang, outcome)
                }
            };
            Some(Ok(text_result(&payload)))
        }
        // MCP 生命周期通知与其它通知都静默接受
        "notifications/initialized" | "notifications/cancelled" => None,
        _ => Some(Err((-32601, format!("method not found: {method}")))),
    }
}

/// 把一行请求处理成一行响应（None = 通知，不需要响应）。
async fn handle_line(library: &Library, line: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let method = value.get("method")?.as_str()?.to_string();
    let id = value.get("id").cloned();
    // 无 id 或 id 为 null 的是通知
    let id = id?;
    if id.is_null() {
        return None;
    }
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let response = match handle_request(library, &method, &params).await {
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
/// 阻塞读 stdin 是可以的：这个进程只为 MCP 服务，等待输入期间没有别的事要做。
pub async fn run_stdio<R: BufRead, W: Write>(library: &Library, input: R, output: &mut W) {
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
        if let Some(response) = handle_line(library, &line).await {
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

    /// handle_request 现在是 async（词典/百科工具发 HTTP），测试用
    /// current-thread runtime 驱动；不带 HTTP 的分支零开销。
    fn call(
        library: &Library,
        method: &str,
        params: &Value,
    ) -> Option<Result<Value, (i64, String)>> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(handle_request(library, method, params))
    }

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
            shelves: vec![ShelfRecord {
                id: "s1".into(),
                name: "科幻".into(),
                order: 1,
            }],
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
        assert_eq!(
            search_books(&library, "")["books"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
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
        let init = call(
            &library,
            "initialize",
            &json!({ "protocolVersion": "2025-03-26", "clientCapabilities": {} }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(init["protocolVersion"], "2025-03-26");
        assert_eq!(init["serverInfo"]["name"], "deer");

        let tools = call(&library, "tools/list", &Value::Null).unwrap().unwrap();
        let names: Vec<&str> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, TOOL_NAMES.to_vec());

        let result = call(
            &library,
            "tools/call",
            &json!({ "name": "search_books", "arguments": { "query": "三体" } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(result["isError"], false);
        let text = result["content"][0]["text"].as_str().unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();
        assert_eq!(payload["deer"], "books");
        assert_eq!(payload["books"].as_array().unwrap().len(), 1);
        assert_eq!(payload["books"][0]["id"], "b1");
    }

    #[test]
    fn unknown_tool_is_tool_error_and_unknown_method_is_rpc_error() {
        let library = fixture_library();
        let result = call(
            &library,
            "tools/call",
            &json!({ "name": "nope", "arguments": {} }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(result["isError"], true);

        let err = call(&library, "resources/list", &Value::Null)
            .unwrap()
            .unwrap_err();
        assert_eq!(err.0, -32601);
    }

    #[test]
    fn notifications_get_no_response() {
        let library = fixture_library();
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(async {
                assert!(
                    handle_line(
                        &library,
                        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
                    )
                    .await
                    .is_none()
                );
                assert!(handle_line(&library, "not json").await.is_none());
                assert!(handle_line(&library, "").await.is_none());
            });
    }

    #[test]
    fn stdio_round_trip_answers_each_request_line() {
        let library = fixture_library();
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#,
            "\n",
            "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_reading_state","arguments":{}}}"#,
            "\n",
        );
        let mut output: Vec<u8> = Vec::new();
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(run_stdio(
                &library,
                BufReader::new(input.as_bytes()),
                &mut output,
            ));
        let lines: Vec<&str> = std::str::from_utf8(&output).unwrap().lines().collect();
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
    fn dictionary_payload_covers_hit_miss_and_network_failure() {
        // 命中：取第一个带 meanings 的词条，senses 截上限，音标回退
        let payload = json!([
            {
                "word": "ephemeral",
                "phonetic": "",
                "phonetics": [{ "text": "/ɪˈfem.ər.əl/" }],
                "meanings": [
                    {
                        "partOfSpeech": "adjective",
                        "definitions": [
                            { "definition": "lasting for a very short time", "example": "fashions are ephemeral" },
                            { "definition": "第二个释义" }
                        ]
                    },
                    { "partOfSpeech": "noun", "definitions": [{ "definition": "短命的生物" }] }
                ]
            }
        ]);
        let hit = parse_dictionary_entry("ephemeral", &payload);
        assert_eq!(hit["deer"], "dictionary");
        assert_eq!(hit["found"], true);
        assert_eq!(hit["word"], "ephemeral");
        assert_eq!(
            hit["phonetic"], "/ɪˈfem.ər.əl/",
            "phonetic 空串回退 phonetics.text"
        );
        let senses = hit["senses"].as_array().unwrap();
        assert_eq!(senses.len(), 3, "senses 跨 meanings 累计");
        assert_eq!(senses[0]["partOfSpeech"], "adjective");
        assert_eq!(senses[0]["example"], "fashions are ephemeral");
        assert!(
            senses[1].get("example").is_none(),
            "缺省字段不应序列化成 null"
        );

        // senses 截到上限
        let many: Vec<Value> = (0..10)
            .map(|i| json!({ "partOfSpeech": "noun", "definitions": [{ "definition": format!("释义{i}") }] }))
            .collect();
        let truncated = parse_dictionary_entry("w", &json!([{ "word": "w", "meanings": many }]));
        assert_eq!(
            truncated["senses"].as_array().unwrap().len(),
            DICTIONARY_SENSE_LIMIT
        );

        // 查无：非数组 / 无 meanings / 无可用释义 → 结构化 miss
        for bad in [
            json!({ "title": "No definitions found" }),
            json!([{ "word": "w" }]),
            json!([{ "word": "w", "meanings": [{ "definitions": [{ "definition": "" }] }] }]),
        ] {
            let miss = parse_dictionary_entry("w", &bad);
            assert_eq!(miss["deer"], "dictionary");
            assert_eq!(miss["found"], false);
            assert_eq!(miss["word"], "w");
        }

        // 网络失败与非 2xx：同样结构化 miss，不 panic
        for outcome in [
            Err(HttpError::Transport("connection refused".into())),
            Err(HttpError::Status(404)),
        ] {
            let miss = dictionary_payload("serendipity", outcome);
            assert_eq!(miss["found"], false);
            assert_eq!(miss["word"], "serendipity");
        }
        // 空词直接 miss，不发 HTTP
        assert_eq!(dictionary_payload("  ", Ok(json!([])))["found"], false);
    }

    #[test]
    fn normalize_translation_covers_hit_empty_and_truncation() {
        // 命中：四元组 + deer 标记
        let hit = normalize_translation(&json!({
            "text": "hello world",
            "translatedText": "你好世界",
            "sourceLang": "en",
            "targetLang": "zh-CN",
        }))
        .unwrap();
        assert_eq!(hit["deer"], "translation");
        assert_eq!(hit["sourceText"], "hello world");
        assert_eq!(hit["translatedText"], "你好世界");
        assert_eq!(hit["sourceLang"], "en");
        assert_eq!(hit["targetLang"], "zh-CN");
        assert!(hit.get("truncated").is_none());

        // 语言字段缺省不序列化成 null
        let minimal =
            normalize_translation(&json!({ "text": "a", "translatedText": "b" })).unwrap();
        assert!(minimal.get("sourceLang").is_none());
        assert!(minimal.get("targetLang").is_none());

        // 空原文 / 空译文 → 可读错误（模型据此向用户说明）
        assert!(normalize_translation(&json!({ "translatedText": "b" })).is_err());
        assert!(normalize_translation(&json!({ "text": "a" })).is_err());
        assert!(normalize_translation(&json!({ "text": "  ", "translatedText": " " })).is_err());

        // 超长截断 + truncated 标记（截的是原文，译文不动）
        let long_text = "字".repeat(MAX_TRANSLATION_CHARS + 5);
        let truncated =
            normalize_translation(&json!({ "text": long_text, "translatedText": "译文" })).unwrap();
        assert_eq!(truncated["truncated"], true);
        assert_eq!(
            truncated["sourceText"].as_str().unwrap().chars().count(),
            MAX_TRANSLATION_CHARS
        );
        assert_eq!(truncated["translatedText"], "译文");
    }

    #[test]
    fn encyclopedia_payload_covers_hit_miss_and_network_failure() {
        // 命中：标题/摘要/来源链接
        let hit = parse_wikipedia_summary(
            "Grace Hopper",
            "en",
            &json!({
                "type": "standard",
                "title": "Grace Hopper",
                "extract": "American computer scientist...",
                "content_urls": { "desktop": { "page": "https://en.wikipedia.org/wiki/Grace_Hopper" } }
            }),
        );
        assert_eq!(hit["deer"], "encyclopedia");
        assert_eq!(hit["found"], true);
        assert_eq!(hit["title"], "Grace Hopper");
        assert_eq!(hit["url"], "https://en.wikipedia.org/wiki/Grace_Hopper");

        // content_urls 缺省 → 标题拼链接兜底；摘要超长截断
        let fallback = parse_wikipedia_summary(
            "临时",
            "zh",
            &json!({
                "title": "Ephemeral things",
                "extract": "x".repeat(MAX_ENCYCLOPEDIA_EXTRACT_CHARS + 10),
            }),
        );
        assert_eq!(
            fallback["url"],
            "https://zh.wikipedia.org/wiki/Ephemeral_things"
        );
        assert_eq!(
            fallback["extract"].as_str().unwrap().chars().count(),
            MAX_ENCYCLOPEDIA_EXTRACT_CHARS
        );

        // 查无：空摘要、消歧义页 → 结构化 miss 带原因
        assert_eq!(
            parse_wikipedia_summary("w", "en", &json!({ "type": "standard", "extract": "" }))["reason"],
            "not_found"
        );
        assert_eq!(
            parse_wikipedia_summary("Mercury", "en", &json!({ "type": "disambiguation" }))["reason"],
            "disambiguation"
        );

        // 非 2xx → not_found；网络失败 → network_error；lang 回退英文维基
        let status_miss = encyclopedia_payload("w", "zh-CN", Err(HttpError::Status(404)));
        assert_eq!(status_miss["reason"], "not_found");
        assert_eq!(status_miss["lang"], "zh");
        let net_miss = encyclopedia_payload("w", "en", Err(HttpError::Transport("timeout".into())));
        assert_eq!(net_miss["reason"], "network_error");
        assert_eq!(
            encyclopedia_payload(" ", "", Ok(json!(null)))["lang"],
            DEFAULT_WIKIPEDIA_LANG
        );
    }

    #[test]
    fn normalize_wikipedia_lang_takes_primary_subtag() {
        assert_eq!(normalize_wikipedia_lang("zh-CN"), "zh");
        assert_eq!(normalize_wikipedia_lang("EN"), "en");
        assert_eq!(normalize_wikipedia_lang("ja"), "ja");
        assert_eq!(normalize_wikipedia_lang(""), DEFAULT_WIKIPEDIA_LANG);
        assert_eq!(normalize_wikipedia_lang("zh"), "zh");
        assert_eq!(normalize_wikipedia_lang("123"), DEFAULT_WIKIPEDIA_LANG);
    }

    #[test]
    fn dispatches_new_tools_with_markers_and_translation_error() {
        let library = fixture_library();

        // tools/list 出全部 6 个工具（含三个新工具）
        let tools = call(&library, "tools/list", &Value::Null).unwrap().unwrap();
        let names: Vec<&str> = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"lookup_dictionary"));
        assert!(names.contains(&"translate_text"));
        assert!(names.contains(&"encyclopedia_lookup"));

        // translate_text：结构化承载走 text_result，不带 isError
        let ok = call(
            &library,
            "tools/call",
            &json!({ "name": "translate_text", "arguments": { "text": "hi", "translatedText": "你好" } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(ok["isError"], false);
        let payload: Value =
            serde_json::from_str(ok["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["deer"], "translation");

        // translate_text：空译文 → tool_error，模型据此向用户说明
        let err = call(
            &library,
            "tools/call",
            &json!({ "name": "translate_text", "arguments": { "text": "hi" } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(err["isError"], true);

        // 空词的词典调用：不发 HTTP 也返回结构化 miss（网络不可用时不 panic）
        let miss = call(
            &library,
            "tools/call",
            &json!({ "name": "lookup_dictionary", "arguments": { "word": "" } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(miss["isError"], false);
        let payload: Value =
            serde_json::from_str(miss["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["deer"], "dictionary");
        assert_eq!(payload["found"], false);
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
