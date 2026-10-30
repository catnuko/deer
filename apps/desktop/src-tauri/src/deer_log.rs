//! ACP 链路诊断日志。
//!
//! 聊天面板在 GUI 里卡住时，前端只能看到一个不动的「正在输入…」；这个模块
//! 把 CLI 定位、登录预检、钥匙串探测、ACP 各阶段收发和 stderr 落到同一个
//! 文件，方便事后定位是哪一步挂住。日志是旁路：写失败一律静默，不能反过来
//! 影响聊天本身。
//!
//! 位置：`~/Library/Logs/deer/claude-acp.log`，超过 2 MB 轮转为 `.1`。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// 单条日志消息的上限（按字符），防止把整个报文/长 stderr 灌进日志。
const MAX_MSG_CHARS: usize = 2000;

static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TZ_OFFSET_SECS: OnceLock<i32> = OnceLock::new();
static WRITE_COUNT: AtomicU64 = AtomicU64::new(0);

fn lock() -> &'static Mutex<()> {
    WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

/// 日志文件路径。给用户看的错误文案里也要提到它。
pub fn log_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Logs/deer/claude-acp.log"))
}

/// 错误文案里展示的日志位置（相对 HOME，方便用户照着找）。
pub const LOG_HINT: &str = "~/Library/Logs/deer/claude-acp.log";

/// 追加一行日志。写失败静默忽略。
pub fn log(tag: &str, msg: &str) {
    let Some(path) = log_path() else { return };
    let line = format_line(now_millis(), tz_offset_secs(), tag, msg);
    let _guard = lock().lock();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    maybe_rotate(&path);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 缓存本地时区偏移（秒）。只在第一次写日志时跑一次 `date +%z`。
fn tz_offset_secs() -> i32 {
    *TZ_OFFSET_SECS.get_or_init(|| {
        std::process::Command::new("/bin/date")
            .arg("+%z")
            .output()
            .ok()
            .and_then(|o| parse_tz_offset(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or(0)
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 每 ~200 次写入检查一次大小，超限就滚动到 `.1`。
fn maybe_rotate(path: &std::path::Path) {
    let n = WRITE_COUNT.fetch_add(1, Ordering::Relaxed);
    if !n.is_multiple_of(200) {
        return;
    }
    let over = fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    if over {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
}

/* ------------------------------------------------------------------ */
/* 纯函数（供单测覆盖）                                                 */
/* ------------------------------------------------------------------ */

/// 解析 `date +%z` 的输出（如 "+0800"）为秒偏移；无法解析按 0（UTC）处理。
pub(crate) fn parse_tz_offset(raw: &str) -> Option<i32> {
    let s = raw.trim();
    if s.is_empty() || s == "Z" || s == "UTC" {
        return Some(0);
    }
    let sign = match s.as_bytes()[0] {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let digits: String = s[1..].chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() != 4 {
        return None;
    }
    let hours: i32 = digits[0..2].parse().ok()?;
    let minutes: i32 = digits[2..4].parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(sign * (hours * 3600 + minutes * 60))
}

/// 公历日期（Howard Hinnant 的 civil_from_days）：从 1970-01-01 起的天数。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// "YYYY-MM-DD HH:MM:SS.mmm"（本地时间）。
pub(crate) fn format_local(epoch_millis: u64, offset_secs: i32) -> String {
    let local = epoch_millis as i64 + offset_secs as i64 * 1000;
    let secs = local.div_euclid(1000);
    let ms = local.rem_euclid(1000);
    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);
    let (y, mo, d) = civil_from_days(days);
    format!(
        "{y:04}-{mo:02}-{d:02} {:02}:{:02}:{:02}.{ms:03}",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// 一条日志：`时间 [阶段] 内容`。
pub(crate) fn format_line(epoch_millis: u64, offset_secs: i32, tag: &str, msg: &str) -> String {
    format!(
        "{} [{tag}] {}\n",
        format_local(epoch_millis, offset_secs),
        truncate_chars(msg, MAX_MSG_CHARS)
    )
}

/// 按字符截断（不切断 UTF-8），超长时以 … 结尾。
pub(crate) fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push('…');
    out
}

/* ------------------------------------------------------------------ */
/* 单测                                                                */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_timezone_offsets() {
        assert_eq!(parse_tz_offset("+0800"), Some(8 * 3600));
        assert_eq!(parse_tz_offset("-0700"), Some(-7 * 3600));
        assert_eq!(parse_tz_offset("+0000"), Some(0));
        assert_eq!(parse_tz_offset("Z"), Some(0));
        assert_eq!(parse_tz_offset(""), Some(0));
        assert_eq!(parse_tz_offset("garbage"), None);
        assert_eq!(parse_tz_offset("+8"), None);
        assert_eq!(parse_tz_offset("+2500"), None);
    }

    #[test]
    fn formats_epoch_in_local_time() {
        assert_eq!(format_local(0, 0), "1970-01-01 00:00:00.000");
        assert_eq!(format_local(0, 8 * 3600), "1970-01-01 08:00:00.000");
        // 2024-02-29 00:00:00 UTC（闰日）
        assert_eq!(format_local(1_709_164_800_000, 0), "2024-02-29 00:00:00.000");
        // 毫秒保留（1,000,000 秒 = 11 天 13:46:40）
        assert_eq!(format_local(1_000_000_123, 0), "1970-01-12 13:46:40.123");
        assert_eq!(format_local(1_000_000, 0), "1970-01-01 00:16:40.000");
        // 东八区跨日
        assert_eq!(format_local(1_709_164_800_000, 8 * 3600), "2024-02-29 08:00:00.000");
    }

    #[test]
    fn formats_line_with_tag() {
        let line = format_line(0, 0, "spawn", "node=/x node");
        assert_eq!(line, "1970-01-01 00:00:00.000 [spawn] node=/x node\n");
    }

    #[test]
    fn truncates_by_chars_without_breaking_utf8() {
        assert_eq!(truncate_chars("你好", 10), "你好");
        assert_eq!(truncate_chars("你好世界", 2), "你好…");
        assert_eq!(truncate_chars("", 3), "");
    }
}
