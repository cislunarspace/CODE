//! Tauri 应用入口。
//!
//! 在 Linux (WebKitGTK 2.40+) 上，DMABuf 硬件加速渲染器在许多显卡驱动（特别是 NVIDIA、
//! 混合显卡及部分 Wayland/Mesa 环境）下会引发严重掉帧与全局卡顿（1-5 FPS）。
//! 在初始化 GTK / WebKit 之前设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 能彻底解决此问题。
//!
//! `--assistant-mcp-bridge`：本二进制作为 omp ACP 的 MCP 桥接子进程运行
//! （见 assistant/bridge.rs），不开窗口、不进 Tauri，stdin/stdout 即协议。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // 若用户未显式指定，默认禁用 WebKitGTK DMABuf 渲染器以避免驱动冲突与卡顿
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    if std::env::args().any(|a| a == transfer_orbit_design_lib::assistant::bridge::BRIDGE_ARG) {
        transfer_orbit_design_lib::assistant::bridge::run_bridge_process();
        return;
    }

    transfer_orbit_design_lib::run();
}
