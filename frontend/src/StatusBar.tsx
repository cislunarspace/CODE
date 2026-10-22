// 底部状态栏：当前视图、任务状态、时间（本地 / UTC / ET）、系统性能（CPU 使用率
// 与内存占用）与软件版本。时钟每秒走，性能每 2 秒经 Rust 壳 system_stats
// 采样一次（sysinfo）。非 Tauri 环境（测试、浏览器预览）静默降级为占位。
// Status bar: the active view, the running-task state, time (local / UTC / ET),
// system performance (CPU usage and memory) and the app version. The clock ticks
// every second and the performance figures come from the Rust shell's
// system_stats (sysinfo) every 2s; outside Tauri (tests, browser preview) both
// degrade to placeholders silently.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "./i18n";
import { etFromEpoch, etToUtcLabel } from "./timeBasis";

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

// 状态栏没有 mode 参数：它读根容器注入的 --ldc-* 变量，颜色随明暗自动跟随，
// 单独渲染（组件测试）时回落到同一份亮色令牌
// The status bar takes no mode prop: it reads the --ldc-* variables the app root
// injects, so colours follow the theme switch on their own; rendered standalone
// (component tests) it falls back to the same light-mode tokens.
const ITEM_STYLE = {
  fontSize: 11,
  color: "var(--ldc-text-muted, #71717a)",
  whiteSpace: "nowrap",
} as const;

/** 弱化圆点分隔：比竖线安静，和 11px 的元数据文字同一档重量。
 *  A faint dot separator: quieter than a pipe and on the same weight as the
 *  11px metadata text. */
function Separator() {
  return (
    <span aria-hidden style={{ fontSize: 11, color: "var(--ldc-text-faint, #a1a1aa)" }}>
      ·
    </span>
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

  return (
    <div
      data-testid="status-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 26,
        padding: "0 12px",
        flexShrink: 0,
        borderTop: "1px solid var(--ldc-border, #e4e4e7)",
        background: "var(--ldc-panel-bg, #fafafa)",
        overflow: "hidden",
      }}
    >
      <span style={ITEM_STYLE} data-testid="status-view">
        {t("status.view")}：{view}
      </span>
      <Separator />
      <span style={ITEM_STYLE}>
        {t("status.task")}：{busy ? progress || t("run.executing") : t("status.task.idle")}
      </span>
      <Separator />
      <span style={ITEM_STYLE} className="ldc-num">
        {t("status.local")} {formatLocalTime(now)}
      </span>
      <span style={ITEM_STYLE} className="ldc-num">
        {t("status.utc")} {etToUtcLabel(et)}
      </span>
      <span style={ITEM_STYLE} className="ldc-num">
        {t("status.et")} {Math.round(et)} s
      </span>
      <Separator />
      <span style={ITEM_STYLE} className="ldc-num">
        {t("status.cpu")} {stats?.cpuPercent == null ? "—" : `${stats.cpuPercent.toFixed(1)}%`}
      </span>
      <span style={ITEM_STYLE} className="ldc-num">
        {t("status.memory")}{" "}
        {stats === null
          ? "—"
          : `${(stats.memUsedBytes / 1024 ** 3).toFixed(1)} GB / ${(
              stats.memTotalBytes / 1024 ** 3
            ).toFixed(1)} GB`}
      </span>
      <span style={{ ...ITEM_STYLE, marginLeft: "auto" }} className="ldc-num">
        {t("status.version")} {version === null ? "—" : `v${version}`}
      </span>
    </div>
  );
}
