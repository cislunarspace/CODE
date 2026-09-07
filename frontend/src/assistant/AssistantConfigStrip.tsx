// 会话配置条：输入区上方的模型/思考/模式切换。选项与当前值全部来自 omp
// 的 configOptions（后端原样透传），本组件只渲染 select 并上报变更——
// omp 里新增的 provider/模型/档位自动出现，无需改代码。模式选项的英文
// value 映射中文标签（UI 固定简体中文），模型与思考档沿用 omp 的名字。

import { Select, Tooltip } from "antd";
import type { AssistantConfigOption } from "./api";
import { useTranslation } from "../i18n";

/** 配置条呈现的配置项 id 顺序（omp 其余项不显示）。 */
const SHOWN_IDS = ["model", "thinking", "mode"];
const MODE_LABELS: Record<string, string> = {
  default: "assistant.config.mode.default",
  plan: "assistant.config.mode.plan",
};

export function AssistantConfigStrip({
  configOptions,
  disabled,
  onChange,
}: {
  /** omp configOptions（model/thinking/mode…） */
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
    id === "model"
      ? "assistant.config.model"
      : id === "thinking"
        ? "assistant.config.thinking"
        : "assistant.config.mode";

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
              label: MODE_LABELS[x.value] ? t(MODE_LABELS[x.value]) : x.name || x.value,
            }))}
            popupMatchSelectWidth={false}
          />
        </Tooltip>
      ))}
    </div>
  );
}
