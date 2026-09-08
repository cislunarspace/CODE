# SPICE 内核

星历动力学（轨道设计的星历修正、轨道保持、轨道预报、时空坐标转换等）需要
NASA SPICE 内核文件；必需内核包括行星历（`.bsp`，如 `de440s.bsp`）与闰秒
（`.tls`，如 `naif0012.tls`）。轨道族生成等纯 CR3BP 工具不读内核。

**内核已随包分发，开箱即用**：内核全套（含行星历 `.bsp`）经 Git LFS 随仓库
提交，安装包也把它们打进了安装目录的 `resources/kernels/`。桌面用户无需任何
准备步骤；需要另行准备的只剩以下场景。

## 内核从哪里来

- **Git LFS / 安装包**：克隆仓库后 `kernels/` 即已就位（安装版在安装目录），
  应用启动时自动钉到 `$SPICE_KERNEL_DIR`；
- **自动下载**：精简环境（如未拉取 LFS 的 CI）可运行
  `uv run python scripts/download_kernels.py`，幂等地拉取全部内核到 `kernels/`；
- **手动下载**：从 e2m2e 的
  [`kernels-v1` release](https://github.com/cislunarspace/CODE-core/releases)
  下载解压到 sidecar 工作目录下的 `kernels/`（开发期即仓库根 `kernels/`，
  安装版即安装目录）；
- **自备数据**：将 `$SPICE_KERNEL_DIR` 指向已有内核目录（优先级最高，sidecar
  进程继承该环境变量）。

官方来源：[NASA NAIF](https://naif.jpl.nasa.gov/naif/data.html)（备用）。

## 常见问题

- **报 "SPICE(NOLEAPSECONDS)"**：闰秒内核未加载。确保内核目录含
  `naif0012.tls`，或设置 `$SPICE_KERNEL_DIR` 后重启应用。
- **v3.2.3 及更早版本的 GUI 内核自动引导弹窗已随 PyQt UI 移除**；当前界面
  不再提供引导交互，需按上节手动准备内核。