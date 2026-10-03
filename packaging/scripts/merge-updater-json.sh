#!/usr/bin/env bash
# 由各平台瘦身安装包及其 updater 签名（.sig）合成更新元清单 latest-code.json。
# 背景：tauri build 只产出安装包与 .sig，不生成更新清单（那是 tauri-action 的职责），
# 本脚本在 release 流程中承担这一职责。
# 输入参数：
#   $1 - 搜索目录（如 release-assets）
#   $2 - 输出文件路径（如 release-assets/latest-code.json）
#   $3 - 版本号（如 4.8.0）
#   $4 - 发布说明文件路径（可选，如 release_notes.md）
# 环境变量：GITHUB_REPOSITORY（形如 owner/repo），用于拼产物下载 URL。

set -euo pipefail

SEARCH_DIR="${1:?缺少搜索目录}"
OUTPUT_FILE="${2:?缺少输出文件路径}"
VERSION="${3:?缺少版本号}"
NOTES_FILE="${4:-}"
REPO="${GITHUB_REPOSITORY:?缺少 GITHUB_REPOSITORY 环境变量（形如 owner/repo）}"

node -e '
const fs = require("fs");
const path = require("path");

const [searchDir, outputFile, version, notesFile, repo] = process.argv.slice(1);
const tag = `v${version.replace(/^v/, "")}`;

let notes;
if (notesFile && fs.existsSync(notesFile)) {
  notes = fs.readFileSync(notesFile, "utf8");
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) results.push(...walk(path.join(dir, entry.name)));
    else results.push(path.join(dir, entry.name));
  }
  return results;
}

// 安装包文件名后缀 → updater 平台键（{os}-{arch}，见 tauri-plugin-updater）。
// 本仓 bundle.createUpdaterArtifacts 为 true（v2 模式）：安装包本体即 updater
// 产物，签名贴在同名 .sig，无 v1Compatible 的 zip 包裹。
// 更新通道取瘦身包（不含 kernels/，约省 170MB）；全量包仅供新装用户手装。
// Windows 仅有 x64：sidecar 的原生依赖（e2m2e/spiceypy/calcephpy）均无
// win_arm64 轮子，arm64 包无从构建。
const RULES = [
  [/_x64-setup-slim\.exe$/, "windows-x86_64"],
  [/_amd64-slim\.AppImage$/, "linux-x86_64"],
  [/_aarch64-slim\.AppImage$/, "linux-aarch64"],
];

const files = walk(searchDir);
const platforms = {};
for (const [pattern, platform] of RULES) {
  const bundle = files.find((f) => pattern.test(f));
  if (!bundle) {
    console.error(`错误：未找到 ${platform} 的瘦身安装包（匹配 ${pattern}）`);
    process.exit(1);
  }
  const sigFile = `${bundle}.sig`;
  if (!fs.existsSync(sigFile)) {
    console.error(`错误：缺少签名文件 ${sigFile}`);
    process.exit(1);
  }
  const signature = fs.readFileSync(sigFile, "utf8").trim();
  if (!signature) {
    console.error(`错误：签名文件 ${sigFile} 为空，更新验签必败`);
    process.exit(1);
  }
  platforms[platform] = {
    signature,
    url: `https://github.com/${repo}/releases/download/${tag}/${path.basename(bundle)}`,
  };
}

const manifest = {
  version: tag,
  notes: notes || undefined,
  pub_date: new Date().toISOString(),
  platforms,
};
fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2), "utf8");
console.log(`已生成 ${outputFile}，包含平台: ${Object.keys(platforms).join(", ")}`);
' "${SEARCH_DIR}" "${OUTPUT_FILE}" "${VERSION}" "${NOTES_FILE}" "${REPO}"
