// 会话配置条：输入区上方的模型/思考切换。选项与当前值由 Rust 侧从 pi
// 原生配置（get_available_models / get_available_thinking_levels）构造，
// 本组件只渲染 select 并上报变更——pi 里新增的 provider/模型/档位自动
// 出现，无需改代码。pi 无 omp 的“模式”概念，配置条只有两项。

import { Select, Tooltip } from "antd";
import type { AssistantConfigOption } from "./api";
import { useTranslation } from "../i18n";

/** 配置条呈现的配置项 id 顺序（后端只产出这两项）。 */
const SHOWN_IDS = ["model", "thinking"];

export function AssistantConfigStrip({
  configOptions,
  disabled,
  onChange,
}: {
  /** 配置面（model/thinking） */
  configOptions: AssistantConfigOption[];
  /** 有回复进行中或未决审批时禁用 */
  disabled: boolean;
  /** 切换上报；父组件负责乐观更新与失败回滚 */
  onChange: (configId: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const shown = SHOWN_IDS.map((id) => configOptions.find((o) => o.id === id)).filter(
    (o): o is AssistantConfigOption => !!o && (o.options?.length ?? 0) > 0,
  );
  if (shown.length === 0) return null;

  const labelKey = (id: string) =>
    id === "model" ? "assistant.config.model" : "assistant.config.thinking";

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {shown.map((opt) => (
        <Tooltip key={opt.id} title={t(labelKey(opt.id))}>
          <Select
            size="small"
            aria-label={t(labelKey(opt.id))}
            style={{
              minWidth: opt.id === "model" ? 150 : 96,
              maxWidth: opt.id === "model" ? 220 : undefined,
            }}
            value={opt.currentValue ?? undefined}
            disabled={disabled}
            showSearch={opt.id === "model"}
            optionFilterProp="label"
            onChange={(v) => onChange(opt.id, v)}
            options={(opt.options ?? []).map((x) => ({
              value: x.value,
              label: x.name || x.value,
            }))}
            popupMatchSelectWidth={false}
          />
        </Tooltip>
      ))}
    </div>
  );
}
