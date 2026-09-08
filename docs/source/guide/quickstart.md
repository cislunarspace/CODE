# 快速上手

## 安装

### 桌面应用（Windows）

从 [GitHub Releases](https://github.com/cislunarspace/CODE/releases)
下载 `transfer-orbit-design_<版本>_x64-setup.exe`，双击安装（NSIS 安装器，
免管理员权限，安装到当前用户目录）。安装包自带 e2m2e 运行时与全套 SPICE
内核（含行星历），开箱即用。另有 Linux AppImage / deb 包与桌面端自动更新。

### 开发环境

要求 Python >= 3.13、Node.js >= 20、Rust 稳定版工具链：

```bash
uv sync                        # Python 依赖（e2m2e[mcp]>=5.9.0 等）
npm ci --prefix frontend       # 前端依赖
npx --prefix frontend tauri dev   # 开发模式启动（无需全局 cargo-tauri）
```

SPICE 内核经 Git LFS 随仓库分发，克隆后位于 `kernels/`；星历类工具开箱即用
（内核说明见 {doc}`kernels`）。

## 界面速览

三栏布局，右侧附可折叠的助手边栏：

- **左栏**：项目/轨道库页签 + 语言切换。项目页签列出当前会话与库中
  产物；轨道库页签打开即全库加载，附多维过滤栏。
- **中栏**：工具下拉 + 参数面板。八个工具接通：轨道族生成、任务
  轨道设计、参数空间扫描、轨道保持、轨道预报、转移轨道设计、时空
  坐标转换、分区边界（轨道稳定性因上游 placeholder 暂不接入）。
- **右栏**：Three.js 画布（详见 {doc}`visualization`），停靠在画布上方的
  工具栏提供投影/中心切换、适配与录制导出、图表设置，左下角状态行显示
  运行进度。
- **助手边栏**：配置模型服务后可对话式发起计算（详见 {doc}`gui` 的
  AI 助手一节）。

## 生成一族轨道

1. 中栏选族类型：Halo / NRHO / Axial / Lissajous / SPO / LPO / Horseshoe / DRO。
2. 面板按族裁剪参数（各族参数见 {doc}`tools`），改振幅上限、成员数等，点生成。
3. 计算在 sidecar 子进程进行，左下角状态行滚动显示进度；完成后族成员轨迹
   逐条出现在画布上，产物自动写入轨道库（{doc}`output`）。

## 浏览轨道库

切到左栏轨道库页签：

- 打开即查询全库；改过滤条件（族类型、平动点、Jacobi 与振幅区间、标签）后点查询。
- 点击任一记录，其轨迹钉入固定层与结果层同屏显示；多选可同屏叠加多条，
  便于与新生成的族对比。

## 下一步

其余计算工具（轨道设计、轨道保持、轨道预报、转移设计、时空坐标转换）的
界面已接通，参数与产物说明见 {doc}`tools`；AI 助手的配置与使用见
{doc}`gui`；需要脚本化工作流时可用
[e2m2e CLI](https://cislunarspace.github.io/CODE-core/)。