//! 数据备份与恢复：把 appDataDir 下的书库、注解、聊天、概念图与应用设置
//! 打包成单个 `.deer-backup` 归档（zip），并支持合并式恢复。
//!
//! 核心逻辑不依赖 Tauri AppHandle，直接对目录路径操作，方便 `cargo test`
//! 做导出→清空→导入的真实往返用例；Tauri command 只负责解析数据目录、
//! 转发进度事件。

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use zip::ZipArchive;
use zip::result::ZipError;
use zip::write::SimpleFileOptions;

/// 备份格式版本；不兼容的格式变更时递增，导入侧据此拒绝。
pub const BACKUP_FORMAT_VERSION: u32 = 1;

const MANIFEST_NAME: &str = "manifest.json";
const SETTINGS_NAME: &str = "settings.json";
const LIBRARY_NAME: &str = "library.json";
const ANNOTATIONS_NAME: &str = "annotations.json";
const CHAT_NAME: &str = "chat.json";
const CONCEPTMAPS_NAME: &str = "conceptmaps.json";
const BOOKS_DIR: &str = "books";
const COVERS_DIR: &str = "covers";

/// 导出归档内的 store JSON 文件（存在才打包）。
const STORE_FILES: [&str; 4] = [LIBRARY_NAME, ANNOTATIONS_NAME, CHAT_NAME, CONCEPTMAPS_NAME];

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupManifest {
    pub format_version: u32,
    pub app_version: String,
    /// 导出时间，epoch ms。
    pub created_at: i64,
    pub books: u32,
    pub covers: u32,
    pub annotations: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub books_added: u32,
    pub books_skipped: u32,
    pub covers_added: u32,
    pub folders_added: u32,
    pub annotations_added: u32,
    pub manifest: BackupManifest,
    /// 归档里带出的 localStorage 设置（zustand persist 原文），由前端写回。
    pub settings: BTreeMap<String, String>,
}

/// 进度事件负载；phase 为 scan/copy/merge/done。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub phase: &'static str,
    pub done: u64,
    pub total: u64,
}

pub type ProgressCallback<'a> = &'a (dyn Fn(BackupProgress) + Send + Sync);

/// library.json 里的一本书；未知字段经 `extra` 原样保留，不丢数据。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BookRecord {
    pub id: String,
    pub title: String,
    pub author: String,
    pub format: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    pub size_bytes: u64,
    pub added_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<i64>,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_location_cfi: Option<String>,
    /// 单书架+文件夹模型的书归属；旧多书架数据在 extra 里原样保留。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderRecord {
    pub id: String,
    pub name: String,
    pub order: i64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 注解记录；去重只依赖 cfi / 摘录 / 笔记 / 创建时间，其余原样保留。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AnnotationRecord {
    pub id: String,
    pub cfi: Option<String>,
    pub excerpt: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("解析 {} 失败：{}", path.display(), e))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| format!("写入 {} 失败：{}", path.display(), e))
}

/// 收集目录下的普通文件（跳过子目录与隐藏文件），返回文件名列表。
fn list_regular_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                None
            } else {
                Some(name)
            }
        })
        .collect();
    names.sort();
    names
}

/// 统计 annotations.json 里的注解总数（文件缺失按 0）。
fn count_annotations(data_dir: &Path) -> u32 {
    read_json(&data_dir.join(ANNOTATIONS_NAME))
        .ok()
        .flatten()
        .and_then(|value| {
            value
                .get("annotations")
                .and_then(Value::as_object)
                .map(|map| {
                    map.values()
                        .filter_map(Value::as_array)
                        .map(|list| list.len() as u32)
                        .sum::<u32>()
                })
        })
        .unwrap_or(0)
}

fn write_text_entry(
    zip: &mut zip::ZipWriter<File>,
    options: &SimpleFileOptions,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    zip.start_file(name, *options)
        .and_then(|()| zip.write_all(bytes).map_err(ZipError::from))
        .map_err(|e| format!("写入归档条目 {} 失败：{}", name, e))
}

/// 导出 appDataDir 到 dest 归档。settings 为前端收集的 localStorage 设置原文。
pub fn export_backup_to_dir(
    data_dir: &Path,
    dest: &Path,
    app_version: &str,
    settings: &BTreeMap<String, String>,
    on_progress: Option<ProgressCallback<'_>>,
) -> Result<BackupManifest, String> {
    let book_files = list_regular_files(&data_dir.join(BOOKS_DIR));
    let cover_files = list_regular_files(&data_dir.join(COVERS_DIR));

    let manifest = BackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        app_version: app_version.to_string(),
        created_at: now_ms(),
        books: book_files.len() as u32,
        covers: cover_files.len() as u32,
        annotations: count_annotations(data_dir),
    };

    let total = (STORE_FILES.len()
        + usize::from(!settings.is_empty())
        + book_files.len()
        + cover_files.len()) as u64;
    let mut done: u64 = 0;
    let report = |phase: &'static str, done: u64, total: u64| {
        if let Some(callback) = on_progress {
            callback(BackupProgress { phase, done, total });
        }
    };
    report("scan", done, total);

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(dest).map_err(|e| format!("创建 {} 失败：{}", dest.display(), e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    write_text_entry(
        &mut zip,
        &options,
        MANIFEST_NAME,
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;
    done += 1;
    report("scan", done, total);

    if !settings.is_empty() {
        write_text_entry(
            &mut zip,
            &options,
            SETTINGS_NAME,
            &serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?,
        )?;
        done += 1;
        report("scan", done, total);
    }

    for name in STORE_FILES {
        let bytes = match fs::read(data_dir.join(name)) {
            Ok(bytes) => bytes,
            Err(_) => continue, // 没用到的 store 文件不打包
        };
        write_text_entry(&mut zip, &options, name, &bytes)?;
        done += 1;
        report("scan", done, total);
    }

    for (sub_dir, files) in [(BOOKS_DIR, &book_files), (COVERS_DIR, &cover_files)] {
        for name in files {
            let source = data_dir.join(sub_dir).join(name);
            let mut input = File::open(&source)
                .map_err(|e| format!("打开 {} 失败：{}", source.display(), e))?;
            zip.start_file(format!("{}/{}", sub_dir, name), options)
                .map_err(|e| format!("打包 {} 失败：{}", source.display(), e))?;
            std::io::copy(&mut input, &mut zip)
                .map_err(|e| format!("打包 {} 失败：{}", source.display(), e))?;
            done += 1;
            report("copy", done, total);
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    report("done", done, total);
    Ok(manifest)
}

fn read_manifest(archive: &mut ZipArchive<BufReader<File>>) -> Result<BackupManifest, String> {
    let mut manifest_file = archive
        .by_name(MANIFEST_NAME)
        .map_err(|_| "不是有效的 Deer 备份文件：缺少 manifest.json".to_string())?;
    let manifest: BackupManifest = serde_json::from_reader(&mut manifest_file)
        .map_err(|_| "备份文件损坏：manifest.json 无法解析".to_string())?;
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(format!(
            "备份格式版本不兼容：需要 {}，归档是 {}（导出自 Deer {}）",
            BACKUP_FORMAT_VERSION, manifest.format_version, manifest.app_version
        ));
    }
    Ok(manifest)
}

type LocalLibrary = Result<(Map<String, Value>, Vec<BookRecord>, Vec<FolderRecord>), String>;

/// 读取本地 library.json（plugin-store 的 JSON map），抽出 books 与 folders。
fn read_local_library(data_dir: &Path) -> LocalLibrary {
    let raw = read_json(&data_dir.join(LIBRARY_NAME))?.unwrap_or_else(|| Value::Object(Map::new()));
    let map = raw
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} 不是合法的存储文件", LIBRARY_NAME))?;
    let books = map
        .get("books")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| serde_json::from_value::<BookRecord>(entry.clone()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let folders = map
        .get("folders")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| serde_json::from_value::<FolderRecord>(entry.clone()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok((map, books, folders))
}

/// 注解去重键：有 CFI 按 CFI（同位置同一条），没有 CFI 的按摘录+笔记+时间。
fn annotation_key(annotation: &AnnotationRecord) -> String {
    match &annotation.cfi {
        Some(cfi) => format!("cfi:{}", cfi),
        None => format!(
            "plain:{}:{}:{}",
            annotation.excerpt.clone().unwrap_or_default(),
            annotation.note.clone().unwrap_or_default(),
            annotation.created_at
        ),
    }
}

/// 合并注解：按去重键合并（本地优先），新条目换新 id，挂到恢复后的本地 bookId。
fn merge_annotations(
    local: &mut Map<String, Value>,
    final_book_id: &str,
    archived_list: &[Value],
) -> u32 {
    let mut existing_keys = HashSet::new();
    if let Some(list) = local.get(final_book_id).and_then(Value::as_array) {
        for entry in list {
            if let Ok(record) = serde_json::from_value::<AnnotationRecord>(entry.clone()) {
                existing_keys.insert(annotation_key(&record));
            }
        }
    }

    let mut incoming = Vec::new();
    for entry in archived_list {
        let Ok(record) = serde_json::from_value::<AnnotationRecord>(entry.clone()) else {
            continue;
        };
        let key = annotation_key(&record);
        if existing_keys.contains(&key) {
            continue;
        }
        existing_keys.insert(key);
        let mut next = record;
        next.id = format!("anno_{}", Uuid::new_v4());
        incoming.push(serde_json::to_value(next).unwrap_or(Value::Null));
    }
    if incoming.is_empty() {
        return 0;
    }

    let added = incoming.len() as u32;
    let mut list = local
        .get(final_book_id)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    list.extend(incoming);
    local.insert(final_book_id.to_string(), Value::Array(list));
    added
}

/// 对 store JSON（chat / conceptmaps）做保守合并：
/// 本地缺的键补上；两边都是对象则递归补缺；都是数组则按 `id` 字段去重拼接；其余本地优先。
fn merge_store_json(local: &mut Map<String, Value>, archived: &Map<String, Value>) {
    for (key, incoming) in archived {
        match (local.get_mut(key), incoming) {
            (None, _) => {
                local.insert(key.clone(), incoming.clone());
            }
            (Some(Value::Object(local_map)), Value::Object(incoming_map)) => {
                merge_store_json(local_map, incoming_map);
            }
            (Some(Value::Array(local_list)), Value::Array(incoming_list)) => {
                let seen: HashSet<String> = local_list
                    .iter()
                    .filter_map(|entry| entry.get("id").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect();
                for entry in incoming_list {
                    match entry.get("id").and_then(Value::as_str) {
                        Some(id) if seen.contains(id) => continue,
                        _ => local_list.push(entry.clone()),
                    }
                }
            }
            _ => {} // 类型不一致或标量：本地优先
        }
    }
}

/// 导入归档到 data_dir（合并式恢复）。先校验 zip 魔数与 manifest，
/// 书按内容哈希跳过重复，注解按 CFI 合并，文件夹按 id 合并（同名加后缀）。
pub fn import_backup_from_dir(
    data_dir: &Path,
    src: &Path,
    on_progress: Option<ProgressCallback<'_>>,
) -> Result<ImportReport, String> {
    // zip 魔数：前两字节必须是 "PK"
    let mut magic = [0u8; 2];
    let mut source = File::open(src).map_err(|_| "备份文件不存在或无法打开".to_string())?;
    source
        .read_exact(&mut magic)
        .map_err(|_| "不是有效的 Deer 备份文件".to_string())?;
    if &magic != b"PK" {
        return Err("不是有效的 Deer 备份文件：格式不符".to_string());
    }

    let reader = BufReader::new(File::open(src).map_err(|e| e.to_string())?);
    let mut archive =
        ZipArchive::new(reader).map_err(|_| "不是有效的 Deer 备份文件".to_string())?;
    let manifest = read_manifest(&mut archive)?;

    let settings: BTreeMap<String, String> = match archive.by_name(SETTINGS_NAME) {
        Ok(file) => serde_json::from_reader(file)
            .map_err(|_| "备份文件损坏：settings.json 无法解析".to_string())?,
        Err(_) => BTreeMap::new(),
    };

    let (mut library_map, mut books, mut folders) = read_local_library(data_dir)?;

    // 归档 library.json：filePath → 归档书记录
    let mut archived_books: Map<String, Value> = Map::new();
    let mut archived_folders: Vec<FolderRecord> = Vec::new();
    if let Ok(mut file) = archive.by_name(LIBRARY_NAME) {
        let value: Value = serde_json::from_reader(&mut file).unwrap_or(Value::Null);
        if let Some(list) = value.get("books").and_then(Value::as_array) {
            for entry in list {
                let path = entry
                    .get("filePath")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !path.is_empty() {
                    archived_books.insert(path, entry.clone());
                }
            }
        }
        archived_folders = value
            .get("folders")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|entry| serde_json::from_value::<FolderRecord>(entry.clone()).ok())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
    }

    let books_dir = data_dir.join(BOOKS_DIR);
    let covers_dir = data_dir.join(COVERS_DIR);
    fs::create_dir_all(&books_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    // 本地每本书的内容哈希（按文件算，文件缺失的书不参与去重）
    let mut local_hash_to_id: Map<String, Value> = Map::new();
    for book in &books {
        if let Ok(hash) = file_sha256(&data_dir.join(book.file_path.as_str())) {
            local_hash_to_id.insert(hash, Value::String(book.id.clone()));
        }
    }

    let total_entries = (0..archive.len())
        .filter_map(|index| archive.name_for_index(index))
        .filter(|name| name.starts_with(&format!("{}/", BOOKS_DIR)) && !name.ends_with('/'))
        .count() as u64;
    let report = |phase: &'static str, done: u64, total: u64| {
        if let Some(callback) = on_progress {
            callback(BackupProgress { phase, done, total });
        }
    };

    let mut books_added = 0u32;
    let mut books_skipped = 0u32;
    let mut covers_added = 0u32;
    let mut used_ids: HashSet<String> = books.iter().map(|book| book.id.clone()).collect();
    // 归档 bookId → 本地最终 bookId（哈希命中已有书时指向本地那条）
    let mut book_id_map: Map<String, Value> = Map::new();
    // 归档 bookId → 归档书原始记录（新书的归属要在文件夹合并后映射）
    let mut archived_record_by_id: Map<String, Value> = Map::new();

    let mut done: u64 = 0;
    for index in 0..archive.len() {
        let name = archive
            .name_for_index(index)
            .unwrap_or_default()
            .to_string();
        if !name.starts_with(&format!("{}/", BOOKS_DIR)) || name.ends_with('/') {
            continue;
        }
        let hash = {
            let mut entry = archive
                .by_name(&name)
                .map_err(|e| format!("读取归档条目 {} 失败：{}", name, e))?;
            let mut hasher = Sha256::new();
            std::io::copy(&mut entry, &mut hasher).map_err(|e| e.to_string())?;
            format!("{:x}", hasher.finalize())
        };

        // 归档里有文件但没有（或损坏的）记录：按文件名与内容哈希恢复成孤儿书，
        // id 用哈希前缀保证重复导入时幂等。
        let file_name = name.rsplit('/').next().unwrap_or(&name).to_string();
        let (record, record_value) = match archived_books.get(&name) {
            Some(value) => match serde_json::from_value::<BookRecord>(value.clone()) {
                Ok(record) => (record, value.clone()),
                Err(_) => (orphan_record(&file_name, &hash), Value::Null),
            },
            None => (orphan_record(&file_name, &hash), Value::Null),
        };

        // 内容与本地已有书重复：跳过文件，只做注解/归属映射
        if let Some(local_id) = local_hash_to_id.get(&hash).and_then(Value::as_str) {
            book_id_map.insert(record.id.clone(), Value::String(local_id.to_string()));
            books_skipped += 1;
            done += 1;
            report("merge", done, total_entries);
            continue;
        }

        // 书 id 冲突（不同内容同 id，跨机极小概率）：换新 id
        let final_id = if used_ids.contains(&record.id) {
            Uuid::new_v4().to_string()
        } else {
            record.id.clone()
        };
        used_ids.insert(final_id.clone());

        let extension = file_name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_string())
            .unwrap_or_else(|| record.format.clone());
        let dest_file = books_dir.join(format!("{}.{}", final_id, extension));
        {
            let mut entry = archive
                .by_name(&name)
                .map_err(|e| format!("读取归档条目 {} 失败：{}", name, e))?;
            let mut output = File::create(&dest_file)
                .map_err(|e| format!("写入 {} 失败：{}", dest_file.display(), e))?;
            std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
        }

        // 封面：归档记录里的 coverPath（covers/<名>），存在才恢复
        let mut final_cover_path: Option<String> = None;
        if let Some(archived_cover) = &record.cover_path {
            let cover_name = archived_cover.rsplit('/').next().unwrap_or_default();
            let cover_entry_name = format!("{}/{}", COVERS_DIR, cover_name);
            if !cover_name.is_empty() && archive.by_name(&cover_entry_name).is_ok() {
                let cover_dest =
                    covers_dir.join(format!("{}.{}", final_id, file_extension_of(cover_name)));
                if !cover_dest.exists() {
                    let mut entry = archive
                        .by_name(&cover_entry_name)
                        .map_err(|e| e.to_string())?;
                    let mut output = File::create(&cover_dest).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
                    covers_added += 1;
                }
                final_cover_path = Some(cover_dest.to_string_lossy().into_owned());
            }
        }

        let size_bytes = fs::metadata(&dest_file).map(|meta| meta.len()).unwrap_or(0);
        let mut imported = record.clone();
        imported.id = final_id.clone();
        imported.file_path = dest_file.to_string_lossy().into_owned();
        imported.cover_path = final_cover_path;
        imported.folder_id = None; // 归属在文件夹合并后统一映射
        imported.size_bytes = size_bytes;
        books.push(imported);
        book_id_map.insert(record.id.clone(), Value::String(final_id));
        archived_record_by_id.insert(record.id.clone(), record_value.clone());
        books_added += 1;
        done += 1;
        report("merge", done, total_entries);
    }

    // 文件夹合并：按 id 去重（同 id 保持本地名字）；新 id 但重名 → 加「（备份）」后缀
    let mut folders_added = 0u32;
    let mut folder_id_map: Map<String, Value> = Map::new();
    let local_folder_names: HashSet<String> =
        folders.iter().map(|folder| folder.name.clone()).collect();
    let mut next_order = folders.iter().map(|folder| folder.order).max().unwrap_or(0);
    for archived in &archived_folders {
        if folders.iter().any(|folder| folder.id == archived.id) {
            folder_id_map.insert(archived.id.clone(), Value::String(archived.id.clone()));
            continue;
        }
        let mut name = archived.name.clone();
        if local_folder_names.contains(&name) {
            name = format!("{}（备份）", name);
        }
        next_order += 1;
        folder_id_map.insert(archived.id.clone(), Value::String(archived.id.clone()));
        folders.push(FolderRecord {
            id: archived.id.clone(),
            name,
            order: next_order,
            extra: archived.extra.clone(),
        });
        folders_added += 1;
    }

    // 新书的归属映射：归档 folderId → 合并后的 folderId
    for book in books.iter_mut() {
        if book.folder_id.is_some() {
            continue;
        }
        let archived_book_id = book_id_map
            .iter()
            .find(|(_, mapped)| mapped.as_str() == Some(book.id.as_str()))
            .map(|(archived, _)| archived.clone());
        let Some(archived_book_id) = archived_book_id else {
            continue;
        };
        let Ok(original) = serde_json::from_value::<BookRecord>(
            archived_record_by_id
                .get(&archived_book_id)
                .cloned()
                .unwrap_or(Value::Null),
        ) else {
            continue;
        };
        if let Some(mapped) = original
            .folder_id
            .and_then(|folder| folder_id_map.get(&folder))
            .and_then(Value::as_str)
        {
            book.folder_id = Some(mapped.to_string());
        }
    }

    // 写回 library.json（保留其余键）
    library_map.insert(
        "books".to_string(),
        serde_json::to_value(&books).map_err(|e| e.to_string())?,
    );
    library_map.insert(
        "folders".to_string(),
        serde_json::to_value(&folders).map_err(|e| e.to_string())?,
    );
    if !library_map.contains_key("libraryVersion") {
        library_map.insert("libraryVersion".to_string(), Value::from(2));
    }
    write_json(&data_dir.join(LIBRARY_NAME), &Value::Object(library_map))?;

    // 注解合并：归档 bookId → 本地最终 bookId
    let mut annotations_added = 0u32;
    let archived_annotations: Option<Map<String, Value>> = {
        let mut file = archive
            .by_name(ANNOTATIONS_NAME)
            .map_err(|_| "归档缺少 annotations.json".to_string())?;
        let value: Value = serde_json::from_reader(&mut file).unwrap_or(Value::Null);
        value.get("annotations").and_then(Value::as_object).cloned()
    };
    if let Some(map) = archived_annotations {
        let mut local_annotations = read_json(&data_dir.join(ANNOTATIONS_NAME))?
            .and_then(|value| value.get("annotations").and_then(Value::as_object).cloned())
            .unwrap_or_default();
        for (archived_book_id, list) in &map {
            let Some(list) = list.as_array() else {
                continue;
            };
            let Some(final_id) = book_id_map.get(archived_book_id).and_then(Value::as_str) else {
                continue; // 这本书没恢复（记录缺失等），注解无处挂靠
            };
            annotations_added += merge_annotations(&mut local_annotations, final_id, list);
        }
        let mut annotations_file = Map::new();
        annotations_file.insert("annotations".to_string(), Value::Object(local_annotations));
        annotations_file.insert("ready".to_string(), Value::Bool(true));
        write_json(
            &data_dir.join(ANNOTATIONS_NAME),
            &Value::Object(annotations_file),
        )?;
    }

    // 聊天与概念图：保守合并
    for store_name in [CHAT_NAME, CONCEPTMAPS_NAME] {
        let archived_value = match archive.by_name(store_name) {
            Ok(mut file) => {
                let value: Value = serde_json::from_reader(&mut file).unwrap_or(Value::Null);
                value.as_object().cloned()
            }
            Err(_) => None,
        };
        let Some(archived_map) = archived_value else {
            continue;
        };
        let mut local_map = read_json(&data_dir.join(store_name))?
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        merge_store_json(&mut local_map, &archived_map);
        write_json(&data_dir.join(store_name), &Value::Object(local_map))?;
    }

    report("done", total_entries, total_entries);
    Ok(ImportReport {
        books_added,
        books_skipped,
        covers_added,
        folders_added,
        annotations_added,
        manifest,
        settings,
    })
}

fn file_extension_of(name: &str) -> &str {
    name.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("")
}

/// 归档里缺记录的孤立书文件：标题取文件名，id 用内容哈希前缀保持幂等。
fn orphan_record(file_name: &str, hash: &str) -> BookRecord {
    let title = file_extension_of(file_name);
    BookRecord {
        id: format!("bk-{}", &hash[..12.min(hash.len())]),
        title: file_name
            .strip_suffix(&format!(".{}", title))
            .unwrap_or(file_name)
            .to_string(),
        author: "未知作者".to_string(),
        format: title.to_string(),
        added_at: now_ms(),
        ..Default::default()
    }
}

/// Tauri command：导出备份。settings 为前端收集的 localStorage 设置原文。
#[tauri::command]
pub async fn export_backup(
    app: tauri::AppHandle,
    dest_path: String,
    settings: BTreeMap<String, String>,
) -> Result<BackupManifest, String> {
    use tauri::{Emitter, Manager};

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位数据目录失败：{}", e))?;
    let app_version = app.package_info().version.to_string();
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = move |progress: BackupProgress| {
            let _ = handle.emit("backup://progress", progress);
        };
        export_backup_to_dir(
            &data_dir,
            Path::new(&dest_path),
            &app_version,
            &settings,
            Some(&emit),
        )
    })
    .await
    .map_err(|e| format!("导出任务失败：{}", e))?
}

/// Tauri command：导入恢复（合并式）。返回报告与归档带出的设置，前端写回。
#[tauri::command]
pub async fn import_backup(
    app: tauri::AppHandle,
    src_path: String,
) -> Result<ImportReport, String> {
    use tauri::{Emitter, Manager};

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位数据目录失败：{}", e))?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = move |progress: BackupProgress| {
            let _ = handle.emit("backup://progress", progress);
        };
        import_backup_from_dir(&data_dir, Path::new(&src_path), Some(&emit))
    })
    .await
    .map_err(|e| format!("导入任务失败：{}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "deer-backup-test-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_bytes(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn book_json(id: &str, title: &str, folder_id: Option<&str>, cfi: Option<&str>) -> Value {
        serde_json::json!({
            "id": id,
            "title": title,
            "author": "作者",
            "format": "epub",
            "filePath": format!("books/{}.epub", id),
            "sizeBytes": 3,
            "addedAt": 1,
            "progress": 0.5,
            "lastLocationCfi": cfi,
            "tags": [],
            "folderId": folder_id,
        })
    }

    fn annotation_value(cfi: &str) -> Value {
        serde_json::json!({
            "id": format!("anno_{}", Uuid::new_v4()),
            "cfi": cfi,
            "color": "#FFD52F",
            "createdAt": 42,
        })
    }

    #[test]
    fn round_trip_export_wipe_import_restores_everything() {
        let dir = temp_dir("roundtrip");
        let archive_path = dir.parent().unwrap().join(format!(
            "deer-backup-roundtrip-{}.deer-backup",
            std::process::id()
        ));

        write_bytes(&dir.join("books/b1.epub"), b"abc");
        write_bytes(&dir.join("books/b2.epub"), b"def");
        write_bytes(&dir.join("covers/b1.jpg"), b"cover");
        write_bytes(
            &dir.join(LIBRARY_NAME),
            serde_json::to_vec(&serde_json::json!({
                "books": [
                    { "id": "b1", "title": "书一", "author": "作者", "format": "epub",
                      "filePath": "books/b1.epub", "coverPath": "covers/b1.jpg",
                      "sizeBytes": 3, "addedAt": 1, "progress": 0.5,
                      "lastLocationCfi": "epub.cf/1", "tags": [] },
                ],
                "folders": [],
                "libraryVersion": 2,
                "migrationNotice": Value::Null,
            }))
            .unwrap()
            .as_slice(),
        );
        write_bytes(
            &dir.join(ANNOTATIONS_NAME),
            serde_json::to_vec(&serde_json::json!({
                "annotations": { "b1": [annotation_value("epub.cf/1")] },
                "ready": true,
            }))
            .unwrap()
            .as_slice(),
        );

        let mut settings = BTreeMap::new();
        settings.insert(
            "deer-app-settings".to_string(),
            "{\"state\":{}}".to_string(),
        );

        let manifest = export_backup_to_dir(&dir, &archive_path, "0.2.0", &settings, None).unwrap();
        assert_eq!(manifest.format_version, BACKUP_FORMAT_VERSION);
        assert_eq!(manifest.books, 2);
        assert_eq!(manifest.covers, 1);
        assert_eq!(manifest.annotations, 1);

        // 清空后从空目录恢复
        let restored = temp_dir("restored");
        let report = import_backup_from_dir(&restored, &archive_path, None).unwrap();
        assert_eq!(report.books_added, 2);
        assert_eq!(report.covers_added, 1);
        assert_eq!(report.annotations_added, 1);

        let library: Value =
            serde_json::from_str(&fs::read_to_string(restored.join(LIBRARY_NAME)).unwrap())
                .unwrap();
        assert_eq!(library["books"].as_array().unwrap().len(), 2);
        assert_eq!(library["libraryVersion"], 2);

        let annotations: Value =
            serde_json::from_str(&fs::read_to_string(restored.join(ANNOTATIONS_NAME)).unwrap())
                .unwrap();
        let book_id = library["books"][0]["id"].as_str().unwrap();
        assert_eq!(
            annotations["annotations"][book_id]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            report.settings.get("deer-app-settings").map(String::as_str),
            Some("{\"state\":{}}")
        );

        // 书文件内容与封面恢复一致
        let restored_book = restored.join(library["books"][0]["filePath"].as_str().unwrap());
        assert_eq!(fs::read(restored_book).unwrap(), b"abc");

        fs::remove_dir_all(&dir).ok();
        fs::remove_file(&archive_path).ok();
        fs::remove_dir_all(&restored).ok();
    }

    #[test]
    fn import_merges_by_hash_and_annotations_by_cfi() {
        let dir_a = temp_dir("merge-a");
        let dir_b = temp_dir("merge-b");
        let archive_path = dir_a.parent().unwrap().join(format!(
            "deer-backup-merge-{}.deer-backup",
            std::process::id()
        ));

        // A：两本书，b1 与 B 的重复
        write_bytes(&dir_a.join("books/b1.epub"), b"same-content");
        write_bytes(&dir_a.join("books/b2.epub"), b"only-in-a");
        write_bytes(
            &dir_a.join(LIBRARY_NAME),
            serde_json::to_vec(&serde_json::json!({
                "books": [
                    { "id": "b1", "title": "重复书", "author": "作者", "format": "epub",
                      "filePath": "books/b1.epub", "sizeBytes": 12, "addedAt": 1,
                      "progress": 0.5, "tags": [], "folderId": "f1" },
                    book_json("b2", "仅A的书", Some("f1"), None),
                ],
                "folders": [{ "id": "f1", "name": "小说", "order": 1 }],
                "libraryVersion": 2,
            }))
            .unwrap()
            .as_slice(),
        );
        write_bytes(
            &dir_a.join(ANNOTATIONS_NAME),
            serde_json::to_vec(&serde_json::json!({
                "annotations": {
                    "b1": [annotation_value("epub.cf/dup")],
                    "b2": [annotation_value("epub.cf/new")],
                },
                "ready": true,
            }))
            .unwrap()
            .as_slice(),
        );

        // B：已有同内容书（不同 id）+ 同名文件夹（不同 id）+ 一条同 CFI 注解
        write_bytes(&dir_b.join("books/local1.epub"), b"same-content");
        write_bytes(
            &dir_b.join(LIBRARY_NAME),
            serde_json::to_vec(&serde_json::json!({
                "books": [book_json("local1", "重复书", Some("f2"), None)],
                "folders": [{ "id": "f2", "name": "小说", "order": 1 }],
                "libraryVersion": 2,
            }))
            .unwrap()
            .as_slice(),
        );
        write_bytes(
            &dir_b.join(ANNOTATIONS_NAME),
            serde_json::to_vec(&serde_json::json!({
                "annotations": { "local1": [annotation_value("epub.cf/dup")] },
                "ready": true,
            }))
            .unwrap()
            .as_slice(),
        );

        export_backup_to_dir(&dir_a, &archive_path, "0.2.0", &BTreeMap::new(), None).unwrap();
        let report = import_backup_from_dir(&dir_b, &archive_path, None).unwrap();

        // 内容重复的书被跳过，仅 A 的书被加进来
        assert_eq!(report.books_added, 1);
        assert_eq!(report.books_skipped, 1);

        let library: Value =
            serde_json::from_str(&fs::read_to_string(dir_b.join(LIBRARY_NAME)).unwrap()).unwrap();
        let folders = library["folders"].as_array().unwrap();
        assert_eq!(folders.len(), 2);
        assert!(folders.iter().any(|f| f["name"] == "小说"));
        assert!(
            folders.iter().any(|f| f["name"] == "小说（备份）"),
            "归档同名文件夹应加后缀，got: {:?}",
            folders
        );

        // 导入的书归属映射到恢复出的「小说（备份）」
        let imported = library["books"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["title"] == "仅A的书")
            .expect("仅A的书应被导入");
        let folder_id = imported["folderId"].as_str().expect("应有归属");
        assert!(
            folders
                .iter()
                .any(|f| f["id"] == folder_id && f["name"] == "小说（备份）"),
            "导入书的 folderId 应指向恢复出的文件夹"
        );

        // 注解按 CFI 合并：重复的跳过，新的进来
        let annotations: Value =
            serde_json::from_str(&fs::read_to_string(dir_b.join(ANNOTATIONS_NAME)).unwrap())
                .unwrap();
        assert_eq!(report.annotations_added, 1);
        let local_list = annotations["annotations"]["local1"].as_array().unwrap();
        assert_eq!(local_list.len(), 1, "同 CFI 注解不应重复");
        let imported_list = annotations["annotations"]["b2"].as_array().unwrap();
        assert_eq!(imported_list.len(), 1);

        fs::remove_dir_all(&dir_a).ok();
        fs::remove_dir_all(&dir_b).ok();
        fs::remove_file(&archive_path).ok();
    }

    #[test]
    fn rejects_bad_magic_and_incompatible_version() {
        let dir = temp_dir("reject");
        let bad = dir.join("bad.deer-backup");
        write_bytes(&bad, b"not a zip at all");
        let error = import_backup_from_dir(&dir, &bad, None).unwrap_err();
        assert!(error.contains("不是有效的 Deer 备份文件"), "got: {}", error);

        // 版本不兼容：改写 manifest 的 formatVersion 为 999
        let data = temp_dir("reject-data");
        write_bytes(&data.join("books/b.epub"), b"xyz");
        write_bytes(
            &data.join(LIBRARY_NAME),
            serde_json::to_vec(&serde_json::json!({
                "books": [book_json("b", "书", None, None)],
                "folders": [],
                "libraryVersion": 2,
            }))
            .unwrap()
            .as_slice(),
        );
        let archive_path = dir.join("future.deer-backup");
        export_backup_to_dir(&data, &archive_path, "9.9.9", &BTreeMap::new(), None).unwrap();

        let patched = dir.join("future2.deer-backup");
        {
            let reader = BufReader::new(File::open(&archive_path).unwrap());
            let mut archive = ZipArchive::new(reader).unwrap();
            let out = File::create(&patched).unwrap();
            let mut writer = zip::ZipWriter::new(out);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for index in 0..archive.len() {
                let name = archive.name_for_index(index).unwrap().to_string();
                writer
                    .start_file(name.clone(), options)
                    .and_then(|()| {
                        let mut entry = archive.by_name(&name).unwrap();
                        if name == MANIFEST_NAME {
                            let mut manifest: Value = serde_json::from_reader(&mut entry).unwrap();
                            manifest["formatVersion"] = Value::from(999);
                            writer
                                .write_all(serde_json::to_vec(&manifest).unwrap().as_slice())
                                .map_err(ZipError::from)
                        } else {
                            std::io::copy(&mut entry, &mut writer)
                                .map(|_| ())
                                .map_err(ZipError::from)
                        }
                    })
                    .unwrap();
            }
            writer.finish().unwrap();
        }
        let error = import_backup_from_dir(&dir, &patched, None).unwrap_err();
        assert!(error.contains("版本不兼容"), "got: {}", error);

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&data).ok();
    }
}
