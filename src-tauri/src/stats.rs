//! 状态栏系统性能采样：全系统 CPU 使用率与内存占用。
//!
//! sysinfo 的 CPU 使用率是两次刷新之间的增量，两次采样间隔必须不小于
//! MINIMUM_CPU_UPDATE_INTERVAL（200 ms）才有意义，因此采样器在进程内常驻：
//! 距上次刷新不足间隔时返回上次的值，首个采样点还没有基线，CPU 返回 None，
//! 由前端显示占位。采样不另起线程，由前端定时调用 system_stats 驱动。

use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::System;

/// 状态栏展示用的系统性能快照（字节单位，换算与格式化在前端）。
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// 全系统 CPU 使用率（%）；首个采样点没有基线时为 None。
    pub cpu_percent: Option<f32>,
    /// 已用内存（字节）。
    pub mem_used_bytes: u64,
    /// 物理内存总量（字节）。
    pub mem_total_bytes: u64,
}

struct Sampler {
    system: System,
    last_cpu_refresh: Instant,
    cpu_percent: Option<f32>,
}

static SAMPLER: Mutex<Option<Sampler>> = Mutex::new(None);

fn sample() -> SystemStats {
    // 采样器状态没有跨线程不变式，锁中毒时沿用内部值即可
    let mut guard = SAMPLER.lock().unwrap_or_else(|e| e.into_inner());
    let sampler = guard.get_or_insert_with(|| {
        let mut system = System::new();
        system.refresh_memory();
        system.refresh_cpu_usage();
        Sampler { system, last_cpu_refresh: Instant::now(), cpu_percent: None }
    });

    sampler.system.refresh_memory();
    if sampler.last_cpu_refresh.elapsed() >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL {
        sampler.system.refresh_cpu_usage();
        sampler.cpu_percent = Some(sampler.system.global_cpu_usage());
        sampler.last_cpu_refresh = Instant::now();
    }

    SystemStats {
        cpu_percent: sampler.cpu_percent,
        mem_used_bytes: sampler.system.used_memory(),
        mem_total_bytes: sampler.system.total_memory(),
    }
}

/// 状态栏系统性能采样（前端每 2 秒调用一次）。
#[tauri::command]
pub fn system_stats() -> SystemStats {
    sample()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 采样器是进程级单例，本用例是该二进制里唯一的 sample() 消费者：
    // 首个采样点无基线的断言依赖这一点（新增用例不要先调 sample）。
    #[test]
    fn sampler_reports_memory_and_cpu_after_baseline() {
        let first = sample();
        assert!(first.mem_total_bytes > 0);
        assert!(first.mem_used_bytes > 0 && first.mem_used_bytes <= first.mem_total_bytes);
        assert!(first.cpu_percent.is_none(), "首个采样点没有基线");

        std::thread::sleep(
            sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + std::time::Duration::from_millis(50),
        );
        let second = sample();
        let cpu = second.cpu_percent.expect("间隔足够后应有 CPU 值");
        assert!((0.0..=100.0).contains(&cpu), "CPU 使用率应在 0-100 之间，实际 {cpu}");
    }
}
