//! WebDAV 传输通道：前端同步内核把「操作日志块 JSON」「书籍文件」「封面」
//! 同步到用户的 WebDAV 网盘（坚果云 / Nextcloud 等）。webview 的 fetch 发不了
//! PROPFIND 且受 CORS 限制，所以这类请求统一落在 Rust 侧用 reqwest 走
//! Basic Auth（坚果云应用密码 / Nextcloud 都是它）。
//!
//! 关键设计：
//! - 纯 HTTP 部分拆成普通 async fn（request_text / upload / download），
//!   Tauri command 只做薄封装与进度事件。
//! - PROPFIND 的 207 Multi-Status XML 不在 Rust 解析，原样作为 body 返回，
//!   前端自己解析；body 只在响应是文本且不太大时才取（≤ MAX_TEXT_BODY）。
//! - 不做失败重试，结果如实返回（4xx/5xx 也以 status 形式返回，404 不是
//!   错误）；重试策略由前端负责。
//! - 进度经 sync-file-progress 事件推送：上传按已读字节、下载按已写字节，
//!   total 取文件长度（上传）或 Content-Length（下载），未知为 0。

use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::deer_log::log;

/// 通用文本请求的响应（404 也正常返回 status=404，不算 Err）。
#[derive(Debug, Serialize)]
pub struct DavResponse {
    pub status: u16,
    pub etag: Option<String>,
    pub body: Option<String>,
}

/// 连接超时：网盘偶尔慢，给宽裕值。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 整体超时：大书上传/下载要走完整个 body，给 10 分钟。
const TOTAL_TIMEOUT: Duration = Duration::from_secs(600);
/// 文本响应体上限：超过就不取 body（书文件类二进制本来也不该走这里）。
const MAX_TEXT_BODY: usize = 16 * 1024 * 1024;
/// 上传分块大小：兼顾进度事件频率与单次内存占用。
const UPLOAD_CHUNK: usize = 256 * 1024;
/// 同步文件进度事件名（前端监听）。
const PROGRESS_EVENT: &str = "sync-file-progress";

/// 共享 HTTP 客户端：超时只在这里配，进程内只构建一次。
fn client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let c = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;
    let _ = CLIENT.set(c.clone());
    Ok(c)
}

/// 只允许 http/https：防 file:// 之类的 scheme 被前端传进来。
fn check_url(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| format!("无效的 URL：{url}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(format!(
            "不支持的 URL 协议「{other}」，只允许 http/https。"
        )),
    }
}

/* ------------------------------------------------------------------ */
/* 纯 HTTP 部分（普通 async fn，command 薄封装）                        */
/* ------------------------------------------------------------------ */

/// 通用文本请求：PROPFIND / GET / PUT / MKCOL / DELETE 都走它。
/// 返回 status + etag + body；body 只在响应是文本且不太大时返回
/// （PROPFIND 的 207 XML 原样返回，Rust 不解析）。
async fn request_text(
    method: &str,
    url: &str,
    username: &str,
    password: &str,
    body: Option<Vec<u8>>,
    content_type: Option<&str>,
    depth: Option<&str>,
) -> Result<DavResponse, String> {
    check_url(url)?;
    let client = client()?;
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("无效的 HTTP 方法「{method}」。"))?;
    let mut req = client.request(m, url).basic_auth(username, Some(password));
    if let Some(d) = depth {
        // PROPFIND 需要 Depth: 1 或 infinity
        req = req.header("Depth", d);
    }
    if let Some(bytes) = &body {
        req = req
            .header(
                CONTENT_TYPE,
                content_type.unwrap_or("application/octet-stream"),
            )
            .body(bytes.clone());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求 WebDAV 失败（{url}）：{e}"))?;

    let status = resp.status().as_u16();
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    // 响应是否文本类（PROPFIND 的 207 XML、目录列表等）
    let is_text = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map_or(false, |ct| {
            ct.contains("text") || ct.contains("xml") || ct.contains("json")
        });
    // Content-Length 已经超限的直接不取；chunked 的边读边限
    let over_limit = resp.content_length().map_or(false, |n| n > MAX_TEXT_BODY as u64);
    let resp_body = if is_text && !over_limit {
        let mut buf: Vec<u8> = Vec::new();
        let mut overflow = false;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| format!("读取响应失败（{url}）：{e}"))?;
            if buf.len() + chunk.len() > MAX_TEXT_BODY {
                overflow = true;
                break;
            }
            buf.extend_from_slice(&chunk);
        }
        (!overflow).then(|| String::from_utf8_lossy(&buf).into_owned())
    } else {
        None
    };
    log("webdav", &format!("{method} {url} -> {status}"));
    Ok(DavResponse {
        status,
        etag,
        body: resp_body,
    })
}

/// 把本地文件转成带进度的上传字节流：每读一块（UPLOAD_CHUNK）发一次进度。
fn file_stream(
    file: tokio::fs::File,
    app: AppHandle,
    url: String,
    total: u64,
) -> impl futures_util::Stream<Item = Result<Vec<u8>, std::io::Error>> {
    futures_util::stream::unfold(
        (file, 0u64, app, url),
        move |(mut file, done, app, url)| async move {
            let mut buf = vec![0u8; UPLOAD_CHUNK];
            match file.read(&mut buf).await {
                Ok(0) => None,
                Ok(n) => {
                    buf.truncate(n);
                    let done = done + n as u64;
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        json!({ "url": &url, "transferred": done, "total": total }),
                    );
                    Some((Ok(buf), (file, done, app, url)))
                }
                Err(e) => Some((Err(e), (file, done, app, url))),
            }
        },
    )
}

/// 流式上传本地文件到 WebDAV（PUT），返回 HTTP status（失败也如实返回）。
async fn upload(
    app: &AppHandle,
    url: &str,
    username: &str,
    password: &str,
    local_path: &str,
) -> Result<u16, String> {
    check_url(url)?;
    let file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("打开本地文件失败（{local_path}）：{e}"))?;
    let total = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let stream = file_stream(file, app.clone(), url.to_string(), total);
    let resp = client()?
        .put(url)
        .basic_auth(username, Some(password))
        .header(CONTENT_TYPE, "application/octet-stream")
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("上传失败（{url}）：{e}"))?;
    let status = resp.status().as_u16();
    log(
        "webdav",
        &format!("upload {local_path} ({total} B) -> {url} {status}"),
    );
    Ok(status)
}

/// 流式下载 WebDAV 文件到本地（GET），自动创建父目录，返回 HTTP status。
async fn download(
    app: &AppHandle,
    url: &str,
    username: &str,
    password: &str,
    local_path: &str,
) -> Result<u16, String> {
    check_url(url)?;
    let resp = client()?
        .get(url)
        .basic_auth(username, Some(password))
        .send()
        .await
        .map_err(|e| format!("下载失败（{url}）：{e}"))?;
    let status = resp.status().as_u16();
    log("webdav", &format!("download {url} -> {status}"));
    // 非成功状态（404 等）如实返回状态码，不落本地文件，前端决定重试/报错
    if !resp.status().is_success() {
        return Ok(status);
    }
    let total = resp.content_length().unwrap_or(0);
    if let Some(parent) = std::path::Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败（{}）：{e}", parent.display()))?;
    }
    let mut file = tokio::fs::File::create(local_path)
        .await
        .map_err(|e| format!("创建本地文件失败（{local_path}）：{e}"))?;
    let mut transferred: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| format!("下载失败（接收数据时出错，{url}）：{e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入本地文件失败（{local_path}）：{e}"))?;
        transferred += chunk.len() as u64;
        let _ = app.emit(
            PROGRESS_EVENT,
            json!({ "url": url, "transferred": transferred, "total": total }),
        );
    }
    file.flush()
        .await
        .map_err(|e| format!("写入本地文件失败（{local_path}）：{e}"))?;
    Ok(status)
}

/* ------------------------------------------------------------------ */
/* Tauri commands                                                      */
/* ------------------------------------------------------------------ */

/// Tauri command：通用 WebDAV 文本请求（PROPFIND / GET / PUT / MKCOL / DELETE）。
#[tauri::command]
pub async fn webdav_request(
    method: String,
    url: String,
    username: String,
    password: String,
    body: Option<Vec<u8>>,
    content_type: Option<String>,
    depth: Option<String>,
) -> Result<DavResponse, String> {
    request_text(
        &method,
        &url,
        &username,
        &password,
        body,
        content_type.as_deref(),
        depth.as_deref(),
    )
    .await
}

/// Tauri command：书籍文件上传（流式读本地文件 -> PUT，发 sync-file-progress）。
#[tauri::command]
pub async fn webdav_upload_file(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    local_path: String,
) -> Result<u16, String> {
    upload(&app, &url, &username, &password, &local_path).await
}

/// Tauri command：书籍文件下载（GET -> 流式写本地文件，发 sync-file-progress）。
#[tauri::command]
pub async fn webdav_download_file(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
    local_path: String,
) -> Result<u16, String> {
    download(&app, &url, &username, &password, &local_path).await
}
