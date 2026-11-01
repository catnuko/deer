//! 本机安装位置探测与可选 OAuth 令牌读取（acpx 连接层的辅助模块）。
//!
//! GUI 应用（从 Finder 拉起）继承的 PATH 只有系统默认几条目录，拿不到
//! ~/.local/bin、homebrew、nvm 等用户安装位置。这里仿 OpenMausBot 的
//! harness 扫描：已知安装目录 + 登录 shell 探测，供 acpx（及 node、claude
//! CLI）定位用户真实安装的可执行文件。
//!
//! 历史说明：原直连 claude 链路的 CLI 定位（resolve_claude）、登录态预检
//! （auth_precheck）与钥匙串探测随 claude_chat 一并移除，聊天统一走
//! acpx 关联本机 claude CLI。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_PROBE_MARKER: &str = "__DEER_PATH__";

/* ------------------------------------------------------------------ */
/* 纯函数（供单测覆盖）                                                 */
/* ------------------------------------------------------------------ */

/// nvm 版本目录名（如 v24.20.0）按数值拆解；非版本目录（如 current）返回 None。
pub(crate) fn parse_node_version(dir_name: &str) -> Option<Vec<u64>> {
    let rest = dir_name.strip_prefix('v')?;
    let parts: Vec<u64> = rest
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    Some(parts)
}

/// nvm versions 目录下数值最新的版本 bin 目录。
pub(crate) fn nvm_latest_bin(versions_dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(versions_dir).ok()?;
    let mut best: Option<(Vec<u64>, PathBuf)> = None;
    for entry in entries.flatten() {
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if let Some(v) = parse_node_version(&name) {
            let bin = entry.path().join("bin");
            if best.as_ref().map_or(true, |(bv, _)| v > *bv) {
                best = Some((v, bin));
            }
        }
    }
    best.map(|(_, bin)| bin)
}

/// 已知安装目录（顺序即优先级：用户自装在前，系统目录兜底）。
pub(crate) fn known_bin_dirs(home: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin")); // claude / acpx 官方安装器常见位置
        dirs.push(home.join(".claude/local")); // claude 本地安装
        dirs.push(home.join(".npm-global/bin")); // npm 全局前缀
        if let Some(bin) = nvm_latest_bin(&home.join(".nvm/versions/node")) {
            dirs.push(bin);
        }
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
}

pub(crate) fn split_path_env(path_env: &str) -> Vec<PathBuf> {
    path_env
        .split(':')
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect()
}

/// 从登录 shell 探测输出里提取 marker 之后的 PATH（rc 文件噪音全部丢弃）。
pub(crate) fn extract_probe_path(output: &str) -> Option<String> {
    let idx = output.find(SHELL_PROBE_MARKER)? + SHELL_PROBE_MARKER.len();
    let rest = &output[idx..];
    let end = rest.find('\n').unwrap_or(rest.len());
    let path = rest[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/* ------------------------------------------------------------------ */
/* I/O：登录 shell 探测                                                 */
/* ------------------------------------------------------------------ */

/// 登录 shell 里 PATH 通常才带上 nvm、用户自定义目录；用 marker 把 PATH 从
/// rc 文件输出噪音里隔出来。超时或失败只影响候选覆盖面，不报错。
pub(crate) async fn probe_shell_path() -> Option<Vec<PathBuf>> {
    let shell = std::env::var("SHELL").ok()?;
    let output = tokio::process::Command::new(&shell)
        .args([
            "-l",
            "-i",
            "-c",
            &format!("printf '{}%s' \"$PATH\"", SHELL_PROBE_MARKER),
        ])
        .stdin(Stdio::null())
        .output();
    let output = tokio::time::timeout(SHELL_PROBE_TIMEOUT, output).await.ok()?.ok()?;
    let path = extract_probe_path(&String::from_utf8_lossy(&output.stdout))?;
    Some(split_path_env(&path))
}

/* ------------------------------------------------------------------ */
/* OAuth 令牌（官方绕开钥匙串的途径）                                     */
/* ------------------------------------------------------------------ */

/// 可选的 OAuth 令牌文件：用户在终端跑 `claude setup-token`（需订阅），
/// 把输出存进来。存在且非空时，spawn 会把它注入 `CLAUDE_CODE_OAUTH_TOKEN`，
/// CLI 用它直接向服务端鉴权，不再读钥匙串——GUI 拉起的进程读钥匙串会被
/// securityd 拦住，这是 CLI 官方支持的环境变量途径。文件由用户自己管理，
/// 我们只在内存里传递，不落日志。
pub fn oauth_token_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/deer/claude-oauth-token"))
}

/// 去首尾空白后非空才算有效令牌。
pub(crate) fn token_from_content(raw: &str) -> Option<String> {
    let t = raw.trim();
    (!t.is_empty()).then(|| t.to_string())
}

pub(crate) fn read_oauth_token() -> Option<String> {
    read_token_at(&oauth_token_path()?)
}

fn read_token_at(path: &Path) -> Option<String> {
    token_from_content(&std::fs::read_to_string(path).ok()?)
}

/* ------------------------------------------------------------------ */
/* 单测                                                                */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "deer-claude-cli-test-{}-{}",
            std::process::id(),
            tag
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_node_versions_numerically() {
        assert_eq!(parse_node_version("v24.20.0"), Some(vec![24, 20, 0]));
        assert_eq!(parse_node_version("v9.11.2"), Some(vec![9, 11, 2]));
        assert_eq!(parse_node_version("current"), None);
        assert_eq!(parse_node_version("v"), None);
        // v9 与 v24 的数值序必须和字符串序相反地被正确比较
        assert!(vec![9, 11, 2] < vec![24, 20, 0]);
    }

    #[test]
    fn picks_latest_nvm_version() {
        let root = tmp_root("nvm");
        for v in ["v9.11.2", "v24.20.0", "current"] {
            std::fs::create_dir_all(root.join(v).join("bin")).unwrap();
        }
        let bin = nvm_latest_bin(&root).unwrap();
        assert!(bin.ends_with("v24.20.0/bin"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn nvm_missing_dir_returns_none() {
        assert!(nvm_latest_bin(Path::new("/nonexistent/deer-test")).is_none());
    }

    #[test]
    fn known_dirs_put_user_installs_first() {
        let dirs = known_bin_dirs(Some("/home/x"));
        assert_eq!(dirs[0], PathBuf::from("/home/x/.local/bin"));
        assert!(dirs.contains(&PathBuf::from("/home/x/.claude/local")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert_eq!(dirs.last(), Some(&PathBuf::from("/usr/local/bin")));
        assert!(known_bin_dirs(None).contains(&PathBuf::from("/opt/homebrew/bin")));
    }

    #[test]
    fn splits_path_and_skips_empty_entries() {
        assert_eq!(
            split_path_env("/a:/b::/c"),
            vec![PathBuf::from("/a"), PathBuf::from("/b"), PathBuf::from("/c")]
        );
        assert!(split_path_env("").is_empty());
    }

    #[test]
    fn extracts_probe_path_from_noisy_output() {
        let noisy = "zsh: some rc noise\nlast login info\n__DEER_PATH__/usr/bin:/opt/homebrew/bin\n";
        assert_eq!(
            extract_probe_path(noisy).as_deref(),
            Some("/usr/bin:/opt/homebrew/bin")
        );
        // marker 后紧跟换行视为空
        assert_eq!(extract_probe_path("__DEER_PATH__\nrest"), None);
        // 无 marker
        assert_eq!(extract_probe_path("no marker here"), None);
    }

    #[test]
    fn token_needs_nonblank_content() {
        assert_eq!(token_from_content("  sk-ant-oat01-x\n"), Some("sk-ant-oat01-x".to_string()));
        assert_eq!(token_from_content("   \n\t"), None);
        assert_eq!(token_from_content(""), None);
    }

    #[test]
    fn reads_token_from_file_and_treats_missing_as_none() {
        let root = tmp_root("token");
        let path = root.join("t.txt");
        assert_eq!(read_token_at(&path), None);
        std::fs::write(&path, "  tok-1 \n").unwrap();
        assert_eq!(read_token_at(&path), Some("tok-1".to_string()));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
