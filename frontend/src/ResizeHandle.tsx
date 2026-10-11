// 共享面板拖宽手柄（#454）：mousedown 记录起点，mousemove 实时上报钳制
// 后的宽度，mouseup 上报一次终值。持久化时机与存储键由调用方决定
// （onResizeEnd），组件自身不碰 localStorage。助手边栏、侧边栏、参数停靠三处
// 复用同一手柄，交互手感一致（实时跟手、松手持久化、无动画，ADR 0020）。
// Shared panel resize handle (#454): mousedown records the origin, mousemove
// reports the clamped width live, mouseup reports the final width once.
// Persistence timing and the storage key belong to the caller (onResizeEnd) —
// the component never touches localStorage. Shared by the assistant sidebar,
// the left pane, and the middle pane; one consistent feel (live tracking,
// persist on release, no animation, per ADR 0020).

import { useRef } from "react";

export interface ResizeHandleProps {
  /** 手柄贴面板的哪条边：右缘向右拖增宽，左缘向左拖增宽 */
  /** Which panel edge the handle sits on: the right edge widens dragging
   *  right, the left edge widens dragging left. */
  edge: "left" | "right";
  /** 当前宽度（受控，调用方持有） */
  /** Current width (controlled, owned by the caller). */
  width: number;
  min: number;
  max: number;
  /** 拖拽过程中实时上报（已钳制） */
  /** Reports live during the drag (already clamped). */
  onResize: (width: number) => void;
  /** 松手时上报一次终值（调用方据此持久化） */
  /** Reports the final width once on release (the caller persists it). */
  onResizeEnd?: (width: number) => void;
}

export function ResizeHandle({ edge, width, min, max, onResize, onResizeEnd }: ResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastWidthRef = useRef(width);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    lastWidthRef.current = width;
    const clamp = (w: number) => Math.min(max, Math.max(min, w));
    const onMove = (ev: MouseEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const delta = edge === "left" ? start.startX - ev.clientX : ev.clientX - start.startX;
      const next = clamp(start.startWidth + delta);
      lastWidthRef.current = next;
      onResize(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      onResizeEnd?.(lastWidthRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={onDragStart}
      style={{
        position: "absolute",
        [edge]: -3,
        top: 0,
        bottom: 0,
        width: 6,
        cursor: "col-resize",
        zIndex: 10,
      }}
    />
  );
}

/** 面板宽度恢复：越界或缺失回落默认宽（#454）。 */
/** Panel-width restore: out-of-range or missing values fall back to the
 *  default (#454). */
export function loadPanelWidth(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

/** 折叠态恢复：仅 "1" 视为折叠，缺失/其他值回落展开（#462）。 */
/** Collapsed-state restore: only "1" counts as collapsed; missing or other
 *  values fall back to expanded (#462). */
export function loadPanelCollapsed(key: string): boolean {
  return localStorage.getItem(key) === "1";
}
