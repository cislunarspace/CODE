# SPICE 内核

星历动力学需要 NASA SPICE 内核文件，包括行星历（`.bsp`，例如 `de440s.bsp`）与闰秒（`.tls`，例如 `naif0012.tls`）。轨道族生成等纯 CR3BP 工具不读内核。

内核已随包分发，开箱即用。全套内核（含行星历）经 Git LFS 随仓库提交，安装包也把它们放进安装目录的 `resources/kernels/`。桌面用户无需准备步骤。需要另行准备的只有精简环境、自备数据等场景。

## 内核从哪里来

- Git LFS 与安装包：克隆仓库后 `kernels/` 即已就位，安装版在安装目录。应用启动时自动把目录写入 `SPICE_KERNEL_DIR`。
- 自动下载：精简环境（例如未拉取 LFS 的 CI）可运行 `uv run python scripts/download_kernels.py`，幂等拉取全部内核到 `kernels/`。
- 手动下载：从 e2m2e 的 [`kernels-v1` release](https://github.com/cislunarspace/CODE-core/releases) 下载并解压到 sidecar 工作目录下的 `kernels/`。开发期即仓库根目录，安装版即安装目录。
- 自备数据：把 `SPICE_KERNEL_DIR` 指向已有内核目录，优先级最高，sidecar 进程继承该环境变量。

内核官方来源为 [NASA NAIF](https://naif.jpl.nasa.gov/naif/data.html)。

## 常见问题

报 `SPICE(NOLEAPSECONDS)` 表示闰秒内核未加载。确认内核目录含 `naif0012.tls`，或设置 `SPICE_KERNEL_DIR` 后重启应用。当前界面不提供内核引导弹窗，内核缺失时按上一节手动准备。
