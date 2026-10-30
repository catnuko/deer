//! 定位本机用户真实安装的 claude CLI，并做登录态预检。
//!
//! GUI 应用（从 Finder 拉起）继承的 PATH 只有系统默认几条目录，拿不到
//! ~/.local/bin、homebrew、nvm 等用户安装位置；而适配器捆绑的 agent-sdk
//! CLI 没有用户登录态（表现为聊天一用就报授权失败）。这里仿 OpenMausBot
//! 的 harness 扫描：已知安装目录 + 登录 shell 探测合成候选路径，找到用户
//! 真实的 claude 后经 CLAUDE_CODE_EXECUTABLE 交给适配器（SDK 的
//! pathToClaudeCodeExecutable，支持 native binary），让 CLI 用上用户的
//! Keychain 登录态。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;

const AUTH_TIMEOUT: Duration = Duration::from_secs(8);
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_PROBE_MARKER: &str = "__DEER_PATH__";

const CLI_NOT_FOUND: &str = "未找到本机 claude CLI（已探测 ~/.local/bin、~/.claude/local、~/.npm-global/bin、nvm、homebrew 与 PATH）。请在终端安装 claude（curl -fsSL https://claude.ai/install.sh | bash）后重启应用。";

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
        dirs.push(home.join(".local/bin")); // claude 官方安装器默认位置
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

/// 候选顺序：已知安装目录 → 登录 shell PATH → 继承的 PATH（用户自装优先）。
pub(crate) fn claude_candidates(
    known: &[PathBuf],
    shell_dirs: &[PathBuf],
    path_dirs: &[PathBuf],
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in known.iter().chain(shell_dirs).chain(path_dirs) {
        let candidate = dir.join("claude");
        if seen.insert(candidate.to_string_lossy().into_owned()) {
            out.push(candidate);
        }
    }
    out
}

/// 返回第一个真实存在的候选；都不存在则给出安装指引文案。
pub(crate) fn resolve_from_candidates(candidates: &[PathBuf]) -> Result<PathBuf, String> {
    candidates
        .iter()
        .find(|p| p.is_file())
        .cloned()
        .ok_or_else(|| CLI_NOT_FOUND.to_string())
}

/* ------------------------------------------------------------------ */
/* I/O：登录 shell 探测、解析入口、登录态预检                            */
/* ------------------------------------------------------------------ */

/// 登录 shell 里 PATH 通常才带上 nvm、用户自定义目录；用 marker 把 PATH 从
/// rc 文件输出噪音里隔出来。超时或失败只影响候选覆盖面，不报错。
async fn probe_shell_path() -> Option<Vec<PathBuf>> {
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

/// 真实调用入口：从环境变量取 HOME/PATH，合成候选并定位 claude。
pub async fn resolve_claude() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").ok();
    let known = known_bin_dirs(home.as_deref());
    let shell_dirs = probe_shell_path().await.unwrap_or_default();
    let path_dirs = std::env::var("PATH")
        .ok()
        .as_deref()
        .map(split_path_env)
        .unwrap_or_default();
    resolve_from_candidates(&claude_candidates(&known, &shell_dirs, &path_dirs))
}

/// 登录态预检：跑 `claude auth status --json`。
/// 只有明确解析出 loggedIn=false 才判为未登录；命令失败（如旧版 CLI 没有
/// auth 子命令）、输出无法解析或超时（Keychain 弹窗会挂住 stdout）都不
/// 武断下结论，交给后续真实对话流程去暴露真实错误。
pub async fn auth_precheck(cli: &Path) -> Result<(), String> {
    let output = tokio::time::timeout(
        AUTH_TIMEOUT,
        tokio::process::Command::new(cli)
            .args(["auth", "status", "--json"])
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    let Ok(Ok(output)) = output else {
        return Ok(());
    };
    if !output.status.success() {
        return Ok(());
    }
    let parsed: Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    if parsed.get("loggedIn") == Some(&Value::Bool(false)) {
        return Err("claude CLI 未登录。请在终端执行 `claude login` 完成登录后重试。".to_string());
    }
    Ok(())
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
    fn candidates_are_ordered_and_deduped() {
        let known = vec![PathBuf::from("/k1"), PathBuf::from("/k2")];
        let shell = vec![PathBuf::from("/k2"), PathBuf::from("/s1")];
        let path = vec![PathBuf::from("/s1"), PathBuf::from("/p1")];
        let candidates = claude_candidates(&known, &shell, &path);
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/k1/claude"),
                PathBuf::from("/k2/claude"),
                PathBuf::from("/s1/claude"),
                PathBuf::from("/p1/claude"),
            ]
        );
    }

    #[test]
    fn resolves_first_existing_candidate() {
        let root = tmp_root("resolve");
        let dir = root.join("bin");
        std::fs::create_dir_all(&dir).unwrap();
        let cli = dir.join("claude");
        std::fs::write(&cli, b"#!/bin/sh\n").unwrap();

        let missing = vec![PathBuf::from("/nonexistent/claude")];
        let present = vec![PathBuf::from("/nonexistent/claude"), cli.clone()];
        assert_eq!(resolve_from_candidates(&present).unwrap(), cli);
        assert!(resolve_from_candidates(&missing).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
