# ADR 0033：发布名改为 CODE（显示名与系统名分层）

**状态**：已接受
**日期**：2026-10-03
**关联**：ADR 0017（Linux AppImage 与 deb 打包，产物名随本篇修订）；ADR 0018（自动更新，通道文件名随本篇断代）；ADR 0032（pi 会话运行时，会话目录随配置目录迁移）

## 背景

仓库自 4.8.5 起叙述上已叫 CODE（cislunar orbit designer），但发布产物仍用旧名 transfer-orbit-design：安装包文件名、应用 ID com.cislunarspace.transfer-orbit-design、`%APPDATA%/transfer-orbit-design` 配置目录、deb/rpm 包名、sidecar 与 Cargo/Python 包名。用户要求发布软件正式改名 CODE。

约束事实（tauri-bundler 源码核实）：

- tauri-bundler 把 productName 经 `heck::AsKebabCase` 压成 deb 的 `Package:` 与 rpm 的 `Name:`（tauri-utils config.rs 与 bundler debian.rs/rpm.rs）。裸 productName=CODE 会被压成 `code`——与 VS Code 的 deb 包名 `code` 直接冲突，apt 环境必炸。
- deb/rpm 的 desktop 显示名默认取 productName；`deb.desktopTemplate` / `rpm.desktopTemplate` 可换模板。AppImage 的 AppImageConfig 无 desktopTemplate 入口，desktop 名与文件名都钉在 productName 上。
- productName 同时决定安装包文件名与 AppImage 内的 desktop 显示名。

## 决策

1. **名字分层**：显示层（productName、窗口标题、快捷方式 desktop 显示名、Windows 安装包文件名、AppImage 文件名）用 CODE；Linux 系统层（deb/rpm 内部包名、`/usr/bin` 可执行名 `mainBinaryName`、数据目录、sidecar 可执行名、Cargo/Python 包名）用 cislunar-code。
2. **identifier 换 com.cislunarspace.code**：与显示名对齐；换 ID 即换安装身份，老版本与新版本可并行安装（升级指引要求先卸载旧版）。
3. **Linux 全量构建拆两次 tauri build**：第一次 productName=CODE 出 AppImage（`--bundles appimage`）；第二次叠加 `packaging/tauri.release.linux-pkg.conf.json`（productName=cislunar-code）出 deb/rpm，desktop 显示名经 `packaging/code.desktop` 模板（字段照 bundler 内置 main.desktop，仅 Name=CODE 静态化）钉回 CODE。产物：`cislunar-code_<版本>_<arch>.deb`、`cislunar-code-<版本>-1.<arch>.rpm`。
4. **数据目录首启迁移**：Rust 壳 setup 最前（任何 config_dir 消费前）执行 `migrate_legacy_config_dir`——旧目录存在且新目录不存在时 `fs::rename` 整体搬移（catalog/sessions/scenarios 同根一次带走）；双存保新不动旧；失败仅告警按空目录继续。Python 侧 `user_config_dir` 只换常量不做迁移（GUI 运行时链路不经过它）。
5. **更新通道断代 latest-code.json（限 updater 插件通道）**：更新清单文件名从 latest.json 换 latest-code.json。老 4.9.0 客户端的 updater 插件（Windows NSIS/MSI 与 AppImage）钉死读老 endpoint，`releases/latest/download/latest.json` 冻结在 4.9.0 永不再更新——该通道的旧版本不会自动安装出第二份应用；新版客户端读 latest-code.json。pubkey 不换（签名体系不变）。已知边界：deb/rpm 的应用内更新走 `update_check_latest`（ADR 0018 增补），直扫 latest release 的资产清单、不经 latest.json，文件名断代拦不住它——4.9.0 的 deb/rpm 安装在 5.0.0 发布后仍会弹出更新提示，且包名已换，提示内一键安装得到的是并行第二份应用而非升级；以升级指引（先卸载旧版）对冲，不做资产拆分（见否决项）。
6. **版本跳 5.0.0**：改名+换 ID+通道断代是破坏性变更，主版本断代标识。

## 考虑过的选项

- **productName 裸用 CODE（deb/rpm 也叫 code）**（否决）：kebab 化撞 VS Code 的 `code` 包名，apt/dnf 环境冲突必现。
- **productName=CODE 后对 deb/rpm 产物 dpkg-deb -R/-b 重打包改名**（否决）：发布流水线引入解包-重打包步骤，rpm 侧无先例工具链；两次 tauri build 用 overlay 是 bundler 原生能力，产物即终态。
- **保留旧通道 latest.json 兼容旧客户端**（否决）：旧客户端会收到 5.0.0 自动更新，但更新器只替换安装包不卸载旧应用——换 ID 后自动更新必然产出双份并存且数据目录分叉；断代让旧客户端停在 4.9.0，由发布说明引导手动迁移。
- **数据目录不迁移（新目录从零开始）**（否决）：轨道库 catalog 是用户核心资产，静默丢不可接受；rename 整体搬移成本最低且原子。
- **deb/rpm 资产拆到非 latest 标记的发布**（否决）：技术上可让老客户端扫描 latest release 找不到 .deb/.rpm 而安静，但发布页分裂（用户要从另一个 release 找 Linux 包）、收尾作业的资产汇总与 checksums 随之复杂化，且 latest 标记同时决定 latest-code.json 的下载地址，拆分与通道服务相互牵制；保留弹提示 + 指引先卸载是更诚实的现状。

## 后果

- 老用户升级路径：卸载 transfer-orbit-design → 安装 CODE → 首启自动迁移数据目录；Windows/AppImage 的 4.9.0 及以前不再收到应用内自动更新，deb/rpm 旧版仍会弹 5.0.0 提示（决策 5 已知边界，指引先卸载）。
- release 流水线 Linux 作业多一次 tauri build（约多一次 Rust 前端产物缓存命中后的打包时间）；产物校验（各 2 份 deb/rpm）不变。
- Windows：NSIS/MSI 文件名变 `CODE_<版本>_x64-setup.exe`，mainBinaryName=cislunar-code 决定安装目录内可执行名；slim 更新通道文件名同步 latest-code.json。
- Python 领域层（脚本与测试路径）与 Rust 壳的目录常量手工对偶（`src/commons/paths.py` ↔ `assistant/host_tools.rs`），沿用既有先例。
- MCP clientInfo、HTTP User-Agent 等进程自述名同步 cislunar-code。
