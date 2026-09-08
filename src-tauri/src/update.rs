//! deb/rpm 安装的应用内更新链路(ADR 0018 增补)。
//!
//! updater 插件的更新清单平台键(linux-{arch})无安装格式维度,发布链路的
//! Linux 更新产物只有 AppImage,插件在 deb/rpm 运行时按自身格式验型必败。
//! 本模块绕开插件,直接面向 GitHub Releases 实现 deb/rpm 的检查 → 应用内
//! 下载 → pkexec 拉起系统包管理器安装。载荷不经过 updater 的 Ed25519
//! 验签,完整性由 HTTPS 传输保证(与浏览器手动下载同等信任级别)。

use serde::Serialize;
use tauri::Emitter;

/// 与 tauri.conf.json plugins.updater.endpoints 同源的 GitHub 仓库。
const GITHUB_REPO: &str = "cislunarspace/CODE";
/// 下载进度事件名(Started/Progress/Finished,前端映射为统一 DownloadEvent)。
const DOWNLOAD_EVENT: &str = "update-download-progress";
/// 进度事件节流阈值:每累计 256KB 发一次,避免高频 IPC。
const PROGRESS_EMIT_BYTES: u64 = 256 * 1024;

/// 手动更新通道的最新发布信息(仅含与当前安装格式/架构匹配的资产)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub asset_url: String,
    pub asset_name: String,
    pub asset_size: Option<u64>,
}

fn latest_release_api_url() -> String {
    format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest")
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("transfer-orbit-design/", env!("CARGO_PKG_VERSION")))
        // 连接/读超时：防流挂死时更新弹窗永久锁死（总超时会掐断大文件下载，不用）
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构造 HTTP 客户端失败: {e}"))
}

/// 手动通道资产的唯一合法下载源前缀。update_download 凭此白名单拒绝
/// 任意 URL：CSP 为 null 的前提下，这两条命令是「任意 URL → 提权安装」
/// 链的最后一环，必须在此斩断。
fn releases_download_prefix() -> String {
    format!("https://github.com/{GITHUB_REPO}/releases/download/")
}

fn is_allowed_download_url(url: &str) -> bool {
    url.starts_with(&releases_download_prefix())
}

/// 解析 vX.Y.Z / X.Y.Z 为三段数字;畸形返回 None(调用方保守视为无更新)。
fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let t = s.trim().trim_start_matches('v');
    let mut parts = t.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// 资产名是否匹配当前安装格式与架构(deb 用 amd64/aarch64,rpm 用原生 arch)。
fn asset_matches(name: &str, is_deb: bool, arch: &str) -> bool {
    if is_deb {
        let arch_tag = match arch {
            "x86_64" => "amd64",
            "aarch64" => "aarch64",
            _ => return false,
        };
        name.ends_with(".deb") && name.contains(arch_tag)
    } else {
        name.ends_with(".rpm") && name.contains(arch)
    }
}

/// 检查 deb/rpm 的最新发布；无更新、其他安装格式或开发态一律返回 None。
/// tag 与当前版本任一解析失败时保守视为无更新（避免畸形 tag 触发误更新）。
#[tauri::command]
pub async fn update_check_latest() -> Result<Option<LatestRelease>, String> {
    // bundle_type 的枚举在 tauri 里未公开 re-export，经 Display 字符串匹配；
    // 仅 deb/rpm 走本链路，其余（含开发态 null）一律视为无手动更新
    let bundle = tauri::utils::platform::bundle_type().map(|b| b.to_string());
    let (is_deb, arch) = match bundle.as_deref() {
        Some("deb") => (true, std::env::consts::ARCH),
        Some("rpm") => (false, std::env::consts::ARCH),
        _ => return Ok(None),
    };

    let client = http_client()?;
    let resp: serde_json::Value = client
        .get(latest_release_api_url())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("查询 GitHub Releases 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("查询 GitHub Releases 失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析发布信息失败: {e}"))?;

    let tag = resp["tag_name"].as_str().unwrap_or_default().to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    match (parse_version(&tag), parse_version(&current)) {
        (Some(t), Some(c)) if t > c => {}
        _ => return Ok(None),
    }

    let assets = resp["assets"].as_array();
    let asset = assets
        .and_then(|list| {
            list.iter()
                .find(|a| a["name"].as_str().is_some_and(|n| asset_matches(n, is_deb, arch)))
        })
        .ok_or_else(|| {
            format!(
                "发布资产中找不到当前架构({arch})的 {} 安装包",
                if is_deb { "deb" } else { "rpm" }
            )
        })?;

    Ok(Some(LatestRelease {
        version: tag.trim_start_matches('v').to_string(),
        current_version: current,
        notes: resp["body"].as_str().map(str::to_string),
        asset_url: asset["browser_download_url"]
            .as_str()
            .ok_or("发布资产缺少下载地址")?
            .to_string(),
        asset_name: asset["name"].as_str().unwrap_or_default().to_string(),
        asset_size: asset["size"].as_u64(),
    }))
}

/// 流式下载安装包到系统临时目录,进度经 DOWNLOAD_EVENT 事件回报,
/// 返回落盘路径(下载期间写 .part,完成后改名,防止半截文件被安装)。
#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<String, String> {
    if !is_allowed_download_url(&url) {
        return Err(format!("拒绝下载非发布源地址: {url}"));
    }
    let client = http_client()?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载更新失败: {e}"))?;
    let total = resp.content_length();
    let _ = app.emit(
        DOWNLOAD_EVENT,
        serde_json::json!({ "event": "Started", "contentLength": total }),
    );

    // 资产名来自自家 Release,仍只取文件名段,防御目录穿越
    let file_name = std::path::Path::new(&name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("update-package")
        .to_string();
    let final_path = std::env::temp_dir().join(&file_name);
    let mut part_path = final_path.clone().into_os_string();
    part_path.push(".part");
    let part_path: std::path::PathBuf = part_path.into();

    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;
    use tokio::io::AsyncWriteExt;
    let mut downloaded: u64 = 0;
    let mut since_emit: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("下载中断: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写盘失败: {e}"))?;
        downloaded += chunk.len() as u64;        since_emit += chunk.len() as u64;
        if since_emit >= PROGRESS_EMIT_BYTES {
            let _ = app.emit(
                DOWNLOAD_EVENT,
                serde_json::json!({
                    "event": "Progress",
                    "chunkLength": since_emit,
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
            since_emit = 0;
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("写盘失败: {e}"))?;
    drop(file);
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("落盘失败: {e}"))?;

    let _ = app.emit(DOWNLOAD_EVENT, serde_json::json!({ "event": "Finished" }));
    Ok(final_path.to_string_lossy().into_owned())
}

/// 拉起系统包管理器安装下载好的安装包：pkexec 弹图形提权框输入管理员
/// 密码。安装成功后磁盘上的应用二进制已替换，重启应用即加载新版本
/// （运行中进程持有旧 inode 不受影响，relaunch 即可）。
#[tauri::command]
pub async fn update_install(path: String) -> Result<(), String> {
    // 只安装系统临时目录内的包（canonicalize 解析 ../ 与符号链接后再比较，
    // 防组件级前缀绕过）；配合 URL 白名单，路径只能由 update_download 产出
    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("安装包不存在: {e}"))?;
    if !canonical.starts_with(std::env::temp_dir()) {
        return Err("拒绝安装临时目录之外的安装包".into());
    }
    let bundle = tauri::utils::platform::bundle_type().map(|b| b.to_string());
    let (tool, args): (&str, Vec<String>) = match bundle.as_deref() {
        Some("deb") => ("dpkg", vec!["-i".into(), canonical.to_string_lossy().into_owned()]),
        Some("rpm") => ("rpm", vec!["-U".into(), canonical.to_string_lossy().into_owned()]),
        _ => return Err("当前安装格式不支持应用内安装".into()),
    };
    let status = tokio::process::Command::new("pkexec")
        .arg(tool)
        .args(&args)
        .status()
        .await
        .map_err(|e| format!("拉起安装器失败(系统缺 pkexec?): {e}"))?;
    if !status.success() {
        return Err("安装失败或已取消，可从版本发布页手动下载安装".into());
    }
    // 安装完成清理临时包（失败不阻断，残留由系统 tmp 清理机制兑底）
    let _ = tokio::fs::remove_file(&canonical).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_accepts_v_prefix_and_plain() {
        assert_eq!(parse_version("v4.8.2"), Some((4, 8, 2)));
        assert_eq!(parse_version("4.8.2"), Some((4, 8, 2)));
        assert_eq!(parse_version(" 4.8.2 "), Some((4, 8, 2)));
    }

    #[test]
    fn parse_version_rejects_malformed() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("v4.8"), None);
        assert_eq!(parse_version("v4.8.2.1"), None);
        assert_eq!(parse_version("v4.8.x"), None);
        assert_eq!(parse_version("main"), None);
    }

    #[test]
    fn asset_matches_deb_by_deb_arch_tag() {
        assert!(asset_matches("transfer-orbit-design_4.8.2_amd64.deb", true, "x86_64"));
        assert!(asset_matches("transfer-orbit-design_4.8.2_aarch64.deb", true, "aarch64"));
        assert!(!asset_matches("transfer-orbit-design_4.8.2_aarch64.deb", true, "x86_64"));
        assert!(!asset_matches("transfer-orbit-design_4.8.2_amd64.AppImage", true, "x86_64"));
    }

    #[test]
    fn asset_matches_rpm_by_native_arch() {
        assert!(asset_matches("transfer-orbit-design-4.8.2.x86_64.rpm", false, "x86_64"));
        assert!(asset_matches("transfer-orbit-design-4.8.2.aarch64.rpm", false, "aarch64"));
        assert!(!asset_matches("transfer-orbit-design-4.8.2.aarch64.rpm", false, "x86_64"));
        assert!(!asset_matches("transfer-orbit-design-4.8.2_amd64.deb", false, "x86_64"));
    }

    #[test]
    fn download_url_whitelist_only_allows_own_releases() {
        let ok = format!("https://github.com/{GITHUB_REPO}/releases/download/v4.8.2/app.deb");
        assert!(is_allowed_download_url(&ok));
        assert!(!is_allowed_download_url("https://api.github.com/repos/other/releases"));
        assert!(!is_allowed_download_url(
            "http://github.com/cislunarspace/CODE/releases/download/v4.8.2/app.deb"
        ));
        assert!(!is_allowed_download_url(
            "https://github.com/cislunarspace/other-repo/releases/download/v4.8.2/app.deb"
        ));
        assert!(!is_allowed_download_url("file:///tmp/evil.deb"));
    }
}
