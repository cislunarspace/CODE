//! AI 助手命令：前端经 IPC 调用（omp ACP 适配层）。
//!
//! 命令面（计划条目 6）：保留 get_state / send / confirm_tool / cancel /
//! new_session / switch_session / clear_history / set_thinking_level（omp
//! 握手声明 thinking 配置能力）；删除 set_config / test_config / rename /
//! delete（omp ACP 无对应标准能力，不留空实现）。模型服务、API key、
//! provider、原生 thinking 配置由 omp 原生配置管理——设置分区只展示入口
//! 状态并提供打开 omp 原生命令的按钮（assistant_open_omp_setup）。

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::assistant::AssistantState;
use crate::assistant::omp;

/// 助手总状态（边栏与设置分区的数据源）。凭据类信息永不返回前端。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantInfo {
    /// omp 可执行文件是否可解析（false = 空态：未安装/不可执行）。
    pub omp_configured: bool,
    /// ACP 进程是否存活（懒启动：未用过时为 false，不代表故障）。
    pub connected: bool,
    /// 当前会话 id（null = 尚未建立会话）。
    pub session_id: Option<String>,
    /// 会话索引（本应用 cwd 过滤，最近活动倒序由 omp 保证）。
    pub sessions: Vec<Value>,
    /// 当前生效的思考等级（用户三档）。
    pub thinking_level: String,
    /// 是否有回复进行中或未决审批。
    pub running: bool,
    /// omp 可执行路径（设置分区展示；无则 null）。
    pub omp_path: Option<String>,
    /// 检测到旧版模型服务配置残留（assistant.json/assistant.key）：
    /// 只提示迁移（模型与 key 请在 omp 重新配置），不读取不复制。
    pub legacy_config: bool,
}

#[tauri::command]
pub async fn assistant_get_state(
    state: State<'_, AssistantState>,
) -> Result<AssistantInfo, String> {
    Ok(AssistantInfo {
        omp_configured: state.omp_configured(),
        connected: state.connected().await,
        session_id: state.current_session(),
        sessions: state.sessions(),
        thinking_level: state.thinking_level(),
        running: state.busy(),
        omp_path: omp::OmpState::configured_command().map(|c| c[0].clone()),
        legacy_config: crate::assistant::host_tools::config_dir()
            .map(|d| d.join("assistant.json").is_file() || d.join("assistant.key").is_file())
            .unwrap_or(false),
    })
}

/// 发送一条用户消息。整轮 agent loop 在此期间经 `assistant-event` 流式
/// 推送；命令在本轮结束时返回（仅早期错误经返回值上抛，运行期错误走
/// error 事件）。
#[tauri::command]
pub async fn assistant_send(
    state: State<'_, AssistantState>,
    message: String,
    selection: Option<Value>,
) -> Result<(), String> {
    state
        .send(&message, selection)
        .await
        .map_err(|e| e.to_string())
}

/// 用户确认/拒绝一次工具审批（callId = 审批键）。返回 false 表示该键
/// 已无挂起等待（已取消/重复点击）。
#[tauri::command]
pub async fn assistant_confirm_tool(
    state: State<'_, AssistantState>,
    call_id: String,
    approved: bool,
) -> Result<bool, String> {
    Ok(state.resolve_confirm(&call_id, approved))
}

/// 请求中断当前轮（幂等）：后端发 ACP session/cancel，cancelled stop
/// reason 到达后 UI 由 interrupted 事件停止生成。返回是否有轮次在跑。
#[tauri::command]
pub async fn assistant_cancel(state: State<'_, AssistantState>) -> Result<bool, String> {
    Ok(state.request_cancel().await)
}

/// 清空当前会话：omp ACP 无 reset 能力，落位为新建会话（旧会话留作历史）。
#[tauri::command]
pub async fn assistant_clear_history(state: State<'_, AssistantState>) -> Result<(), String> {
    state.clear_history().await.map_err(|e| e.to_string())
}

/// 新建会话并切换过去（受门禁）。返回新会话 id。
#[tauri::command]
pub async fn assistant_new_session(state: State<'_, AssistantState>) -> Result<String, String> {
    state.new_session().await.map_err(|e| e.to_string())
}

/// 切换会话（session/load 回放重建 UI；失败保持原会话）。
#[tauri::command]
pub async fn assistant_switch_session(
    state: State<'_, AssistantState>,
    session_id: String,
) -> Result<(), String> {
    state
        .switch_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 设当前会话的思考等级（三档；适配层映射 omp 原生值 off/medium/high）。
#[tauri::command]
pub async fn assistant_set_thinking_level(
    state: State<'_, AssistantState>,
    level: String,
) -> Result<(), String> {
    state
        .set_thinking_level(&level)
        .await
        .map_err(|e| e.to_string())
}

/// 打开 omp 原生配置流程（终端运行 `omp setup`）。返回实际执行的命令
/// 描述；失败返回 stderr/退出原因（禁止伪造成功）。
#[tauri::command]
pub async fn assistant_open_omp_setup() -> Result<String, String> {
    let Some(cmd) = omp::OmpState::configured_command() else {
        return Err("未找到 omp 可执行文件（未安装或不在 PATH）".into());
    };
    let omp_path = cmd[0].clone();
    spawn_terminal_running(&omp_path, "setup")
}

/// 在一个终端模拟器里运行 `<omp> <args...>`；全部候选失败时报具体原因。
/// 命令串形态（终端自解析 shell 命令行：-e/--、osascript）必须给路径加
/// 引号，安装路径含空格才不裂；argv 形态（kitty/foot/wezterm、Windows
/// Command 的逐参数传递）无需引号。
fn spawn_terminal_running(omp_path: &str, args: &str) -> Result<String, String> {
    let full = format!("\"{omp_path}\" {args}");
    #[cfg(target_os = "linux")]
    {
        let mut candidates: Vec<(String, Vec<String>)> = Vec::new();
        if let Some(term) = std::env::var_os("TERMINAL") {
            let term = term.to_string_lossy().into_owned();
            candidates.push((term.clone(), vec!["-e".into(), full.clone()]));
        }
        for term in [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "kitty",
            "xfce4-terminal",
            "alacritty",
            "wezterm",
            "foot",
        ] {
            let flag = match term {
                "gnome-terminal" => "--",
                "kitty" | "foot" | "wezterm" => "",
                _ => "-e",
            };
            let mut argv = vec![term.to_string()];
            if !flag.is_empty() {
                argv.push(flag.into());
            }
            // x-terminal-emulator -e 接受整条命令串；gnome-terminal -- 同理
            argv.push(if flag.is_empty() { omp_path.into() } else { full.clone() });
            if flag.is_empty() {
                argv.push(args.into());
            }
            candidates.push((term.into(), argv));
        }
        for (name, argv) in candidates {
            match std::process::Command::new(&argv[0])
                .args(&argv[1..])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .spawn()
            {
                Ok(_) => return Ok(format!("已在 {name} 中启动：{full}")),
                Err(e) => eprintln!("[assistant] 终端 {name} 启动失败：{e}"),
            }
        }
        Err(format!(
            "未找到可用终端模拟器（已尝试 TERMINAL 与常见终端）。请手动在终端运行：{full}"
        ))
    }
    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", omp_path, args])
            .stdin(std::process::Stdio::null())
            .output();
        match status {
            Ok(out) if out.status.success() => Ok(format!("已在新终端启动：{full}")),
            Ok(out) => Err(format!(
                "启动失败（exit {:?}）：{}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr)
            )),
            Err(e) => Err(format!("启动失败：{e}；请手动运行 {full}")),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            full.replace('\\', "\\\\").replace('"', "\\\"")
        );
        match std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .stdin(std::process::Stdio::null())
            .output()
        {
            Ok(out) if out.status.success() => Ok(format!("已在 Terminal 中启动：{full}")),
            Ok(out) => Err(format!(
                "启动失败（exit {:?}）：{}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr)
            )),
            Err(e) => Err(format!("启动失败：{e}；请手动运行 {full}")),
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = omp_path;
        Err(format!("该平台不支持自动打开终端，请手动运行：{full}"))
    }
}
