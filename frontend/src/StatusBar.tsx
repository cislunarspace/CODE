// 底部状态栏：当前视图、任务状态、时间（本地 / UTC / ET）、系统性能（CPU 使用率
// 与内存占用）与软件版本。时钟每秒走，性能每 2 秒经 Rust 壳 system_stats
// 采样一次（sysinfo）。非 Tauri 环境（测试、浏览器预览）静默降级为占位。
// Status bar: the active view, the running-task state, time (local / UTC / ET),
// system performance (CPU usage and memory) and the app version. The clock ticks
// every second and the performance figures come from the Rust shell's
// system_stats (sysinfo) every 2s; outside Tauri (tests, browser preview) both
// degrade to placeholders silently.

import { useEffect, useState } from "react";
import { Typography } from "antd";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "./i18n";
import { etFromEpoch, etToUtcLabel } from "./timeBasis";

const { Text } = Typography;

/** Rust stats::SystemStats 的前端对偶（IPC 字段 camelCase） */
export interface SystemStats {
  cpuPercent: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
}

/** 时钟刷新间隔（毫秒） */
export const CLOCK_TICK_MS = 1000;
/** 性能采样间隔（毫秒），慢于时钟一档，减少无谓 IPC */
export const STATS_TICK_MS = 2000;

/** 本地时间转 "YYYY-MM-DD HH:MM:SS"（24 小时制，不依赖区域格式设置） */
export function formatLocalTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

export function StatusBar({
  busy,
  progress,
  view,
}: {
  busy: boolean;
  progress: string;
  /** 当前视图名（主页面激活的文档标签） */
  view: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await invoke<SystemStats>("system_stats");
        if (!cancelled) setStats(s);
      } catch {
        // 非 Tauri 环境没有采样通道：保持占位
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), STATS_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  // 当前 ET（J2000 TDB 秒）：UT 时钟经 timeBasis 换算，展示口径与画布一致
  const et = etFromEpoch(now.toISOString());
  const itemStyle = { fontSize: 12 } as const;
  const sep = (
    <Text type="secondary" style={{ fontSize: 12, opacity: 0.35 }}>
      |
    </Text>
  );

  return (
    <div
      data-testid="status-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 26,
        padding: "0 12px",
        flexShrink: 0,
        borderTop: "1px solid var(--tod-border, #e8e8e8)",
        background: "var(--tod-panel-bg, transparent)",
      }}
    >
      <Text type="secondary" style={itemStyle} data-testid="status-view">
        {t("status.view")}：{view}
      </Text>
      {sep}
      <Text type="secondary" style={itemStyle}>
        {t("status.task")}：{busy ? progress || t("run.executing") : t("status.task.idle")}
      </Text>
      {sep}
      <Text type="secondary" style={itemStyle}>
        {t("status.local")} {formatLocalTime(now)}
      </Text>
      <Text type="secondary" style={itemStyle}>
        {t("status.utc")} {etToUtcLabel(et)}
      </Text>
      <Text type="secondary" style={itemStyle}>
        {t("status.et")} {Math.round(et)} s
      </Text>
      {sep}
      <Text type="secondary" style={itemStyle}>
        {t("status.cpu")}{" "}
        {stats?.cpuPercent == null ? "—" : `${stats.cpuPercent.toFixed(1)}%`}
      </Text>
      <Text type="secondary" style={itemStyle}>
        {t("status.memory")}{" "}
        {stats === null
          ? "—"
          : `${(stats.memUsedBytes / 1024 ** 3).toFixed(1)} GB / ${(
              stats.memTotalBytes / 1024 ** 3
            ).toFixed(1)} GB`}
      </Text>
      <Text type="secondary" style={{ ...itemStyle, marginLeft: "auto" }}>
        {t("status.version")} {version === null ? "—" : `v${version}`}
      </Text>
    </div>
  );
}
