// 画布轨道清单（#469）：常驻左侧边栏，替代画布内图注——逐条列出当前画布
// 上的轨道（颜色样 + 名称 + 数据系标注），交互与原图例联动拾取（#460）
// 同口径：悬停预览、点击聚焦。聚焦/预览态由 App 持有，画布拾取与清单
// 交互双向一致。
// Canvas orbit list (#469): persistent in the left sidebar, replacing the
// in-canvas legend — one row per orbit on the canvas (swatch + name +
// data-frame tag), with the old legend-pick interactions (#460): hover
// previews, click focuses. Focus/preview state lives in App, so canvas
// picking and list interactions stay consistent both ways.

import { useTranslation } from "./i18n";
import type { OrbitListItem } from "./orbitListItems";

export interface CanvasOrbitListProps {
  items: OrbitListItem[];
  /** 当前聚焦轨迹（画布拾取或清单点击设置），取值为 trajIndex（#476 起
   *  聚焦索引统一为 TrajectoryData 行号，清单过滤无标签行后仍对齐）；
   *  null = 无聚焦 */
  /** The focused trajectory (set by canvas picking or a list click), as a
   *  trajIndex (since #476 the focus index is the TrajectoryData row number,
   *  staying aligned after unlabeled rows are filtered out); null = none. */
  focusIndex: number | null;
  /** 惯性视图灰显项的注记（已本地化整句，如"会合系几何，惯性视图下不可画"） */
  /** The note for grayed items in the inertial view (a pre-localized sentence). */
  unavailableNote?: string;
  onFocusChange: (i: number | null) => void;
  onPreviewChange: (i: number | null) => void;
}

export function CanvasOrbitList({
  items,
  focusIndex,
  unavailableNote,
  onFocusChange,
  onPreviewChange,
}: CanvasOrbitListProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div data-testid="canvas-orbit-list" style={{ padding: "2px 0" }}>
      <span className="ldc-section-label">{t("canvas.orbit_list")}</span>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
        {items.map((item, i) => {
          const focused = item.trajIndex === focusIndex;
          return (
            <div
              key={`${item.label}-${i}`}
              data-orbit-item=""
              data-focused={focused ? "true" : "false"}
              // 悬停底由 .ldc-hover-row 提供；选中行的底写在内联样式里（优先级
              // 高于类规则），两者不会同时生效
              // The hover fill comes from .ldc-hover-row; the selected row's fill
              // is inline (higher priority than the class rule), so the two never
              // fight over the same row.
              className="ldc-hover-row"
              onMouseEnter={() => onPreviewChange(item.trajIndex)}
              onMouseLeave={() => onPreviewChange(null)}
              onClick={() => onFocusChange(item.trajIndex === focusIndex ? null : item.trajIndex)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                // 行高 24 与面板里的图标按钮同高，清单读起来是参数区的一节
                // 24px rows match the panel's icon buttons, so the list reads as
                // one section of the parameter area.
                height: 24,
                padding: "0 6px",
                borderRadius: 6,
                overflow: "hidden",
                cursor: "pointer",
                fontSize: 12,
                // 选中行用中性 activeBg + activeText，不用彩色文字：彩色留给状态
                // Selected rows take the neutral active fill and text; colour stays
                // reserved for status.
                ...(focused
                  ? { background: "var(--ldc-active-bg)", color: "var(--ldc-active-text)" }
                  : { color: item.grayed ? "var(--ldc-text-muted)" : "var(--ldc-text)" }),
              }}
            >
              <span
                data-testid="orbit-swatch"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: item.color,
                  display: "inline-block",
                  flexShrink: 0,
                  // 聚焦标记（#460，ADR 0037）：色样外沿加 1px 同色描边圈，
                  // 色相仍是数据色，标记不引入第二种颜色
                  // Focus marker (#460, ADR 0037): a 1px ring in the current text
                  // colour around the swatch. The swatch keeps its data colour, so
                  // the marker adds no second hue.
                  ...(focused ? { outline: "1px solid currentColor", outlineOffset: 1 } : {}),
                }}
              />
              <span
                className="ldc-num"
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
              {item.frame && (
                <span className="ldc-chip" style={{ flexShrink: 0 }}>{item.frame}</span>
              )}
              {item.grayed && unavailableNote && (
                <span
                  data-testid="orbit-unavailable"
                  style={{
                    marginLeft: "auto",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    color: "var(--ldc-text-faint)",
                  }}
                >
                  {unavailableNote}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
