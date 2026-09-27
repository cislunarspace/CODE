// 参数面板：基于 Ant Design 6 与 paramOverlay 打造的高密度科学计算参数表单
// Params panel: a high-density scientific-computing parameter form built on Ant Design 6 and paramOverlay.

import { useMemo, useState, useEffect } from "react";
import {
  Form,
  Input,
  InputNumber,
  Select,
  Checkbox,
  Tooltip,
  DatePicker,
  Space,
  Typography,
} from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { type SchemaProperty, type ToolSchema } from "./schema";
import {
  branchSelection,
  switchBranch,
  UNIT_DEFINITIONS,
  toStandardValue,
  fromStandardValue,
  getActiveFields,
  ENUM_OPTIONS,
  BRANCH_TYPE_OPTIONS,
  FIELD_TOOLTIPS,
  formatRangePrompt,
  withParamDefaults,
} from "./paramOverlay";

const { Text } = Typography;

interface ParamsPanelProps {
  toolName: string;
  schema: ToolSchema;
  values: Record<string, unknown>;
  onChange: (vals: Record<string, unknown>) => void;
  /** 提交校验问题（字段名 → 人读原因），对应字段在表单内联标红 */
  /** Submission validation problems (field name → human-readable reason); matching fields get inline red flags. */
  fieldErrors?: Record<string, string>;
}

export function ParamsPanel({ toolName, schema, values, onChange, fieldErrors }: ParamsPanelProps) {
  // 分支键字段与当前分支类型（与提交校验、默认值填充同源）
  // Branch-key field and current branch type (same source as submission validation and default filling).
  const { key: branchKey, type: branchType } = branchSelection(toolName, values);

  // 记录每个字段当前选中的显示单位
  // Tracks each field's currently selected display unit.
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>({});

  // 获取适用字段列表（与提交校验同源）
  // Get the applicable field list (same source as submission validation).
  const activeFields = useMemo(() => {
    return getActiveFields(toolName, schema, branchType);
  }, [toolName, schema, branchType]);

  // 当工具或分支类型改变时，填入模型默认值（schema default）与分支默认值
  // Fill model defaults (schema `default`) plus branch defaults when the tool or branch type changes.
  useEffect(() => {
    const next = withParamDefaults(toolName, schema, values, branchKey, branchType);
    if (next) onChange(next);
  }, [toolName, branchType]);

  // 处理单个字段值变更
  // Handle a single field-value change.
  const handleFieldChange = (fieldName: string, displayVal: unknown, currentUnit?: string) => {
    const next = { ...values };
    if (displayVal === undefined || displayVal === null || displayVal === "") {
      delete next[fieldName];
    } else if (typeof displayVal === "number" && currentUnit) {
      next[fieldName] = toStandardValue(fieldName, displayVal, currentUnit);
    } else {
      next[fieldName] = displayVal;
    }

    // 切分支类型（orbit_type / transfer_type）时联动
    // Linked updates when the branch type (orbit_type / transfer_type) switches.
    if (fieldName === branchKey && typeof displayVal === "string") {
      onChange(switchBranch(toolName, schema, next, branchKey, displayVal, branchType));
      return;
    }

    onChange(next);
  };

  const renderFieldControl = (fieldName: string, prop: SchemaProperty) => {
    const isOptional = prop.anyOf?.some((v) => v.type === "null") ?? false;
    const inner: SchemaProperty = isOptional
      ? prop.anyOf!.find((v) => v.type !== "null") || prop
      : prop;

    const rawStandardVal = values[fieldName];
    const availableUnits = UNIT_DEFINITIONS[fieldName];
    const currentUnit = selectedUnits[fieldName] || (availableUnits ? availableUnits[0].label : undefined);

    const displayVal = typeof rawStandardVal === "number" && currentUnit
      ? fromStandardValue(fieldName, rawStandardVal, currentUnit)
      : rawStandardVal;

    // 分支键类型（orbit_type 等）优先用预置下拉；transfer_type 走 ENUM_OPTIONS
    // Branch-key types (orbit_type etc.) use the preset dropdown first; transfer_type goes through ENUM_OPTIONS.
    if (fieldName === branchKey && BRANCH_TYPE_OPTIONS[toolName]) {
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={rawStandardVal as string}
          options={BRANCH_TYPE_OPTIONS[toolName]}
          onChange={(v) => handleFieldChange(fieldName, v)}
        />
      );
    }

    if (ENUM_OPTIONS[fieldName]) {
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={rawStandardVal as string | number}
          options={ENUM_OPTIONS[fieldName]}
          onChange={(v) => handleFieldChange(fieldName, v)}
        />
      );
    }

    if (inner.enum) {
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={rawStandardVal as string | number}
          options={inner.enum.map((e) => ({ label: String(e), value: e }))}
          onChange={(v) => handleFieldChange(fieldName, v)}
        />
      );
    }

    if (inner.type === "number" || inner.type === "integer") {
      const unitAddon = availableUnits ? (
        <Select
          size="small"
          value={currentUnit}
          style={{ width: 75 }}
          options={availableUnits.map((u) => ({ label: u.label, value: u.label }))}
          onChange={(newUnit) => {
            setSelectedUnits((prev) => ({ ...prev, [fieldName]: newUnit }));
          }}
        />
      ) : undefined;

      const minVal = inner.minimum !== undefined && currentUnit
        ? fromStandardValue(fieldName, inner.minimum, currentUnit)
        : inner.minimum;
      const maxVal = inner.maximum !== undefined && currentUnit
        ? fromStandardValue(fieldName, inner.maximum, currentUnit)
        : inner.maximum;

      const unitConfig = availableUnits?.find((u) => u.label === currentUnit);
      const step = unitConfig ? unitConfig.step : (inner.type === "integer" ? 1 : 0.1);
      const precision = unitConfig ? unitConfig.decimals : (inner.type === "integer" ? 0 : 4);

      return (
        <InputNumber
          size="small"
          style={{ width: "100%" }}
          value={typeof displayVal === "number" ? displayVal : null}
          min={minVal}
          max={maxVal}
          step={step}
          precision={precision}
          addonAfter={unitAddon}
          placeholder={formatRangePrompt(minVal, maxVal, currentUnit || "")}
          onChange={(val) => handleFieldChange(fieldName, val, currentUnit)}
        />
      );
    }

    if (inner.type === "boolean") {
      return (
        <Checkbox
          checked={Boolean(rawStandardVal)}
          onChange={(e) => handleFieldChange(fieldName, e.target.checked)}
        >
          {inner.title || fieldName}
        </Checkbox>
      );
    }

    if (fieldName.includes("epoch")) {
      const dateVal = Array.isArray(rawStandardVal)
        ? dayjs(new Date(rawStandardVal[0], rawStandardVal[1] - 1, rawStandardVal[2], rawStandardVal[3] || 0, rawStandardVal[4] || 0, rawStandardVal[5] || 0))
        : typeof rawStandardVal === "string"
        ? dayjs(rawStandardVal)
        : null;

      return (
        <DatePicker
          showTime
          size="small"
          style={{ width: "100%" }}
          value={dateVal}
          onChange={(d) => {
            if (!d) {
              handleFieldChange(fieldName, undefined);
            } else {
              handleFieldChange(fieldName, [
                d.year(),
                d.month() + 1,
                d.date(),
                d.hour(),
                d.minute(),
                d.second(),
              ]);
            }
          }}
        />
      );
    }

    const isJson = inner.type === "array" || inner.type === "object" || !inner.type;
    const stringVal = rawStandardVal === undefined || rawStandardVal === null
      ? ""
      : isJson
      ? (typeof rawStandardVal === "string" ? rawStandardVal : JSON.stringify(rawStandardVal))
      : String(rawStandardVal);

    return (
      <Input
        size="small"
        value={stringVal}
        placeholder={isJson ? "JSON (留空表示默认)" : undefined}
        onChange={(e) => {
          const text = e.target.value;
          if (!text) {
            handleFieldChange(fieldName, undefined);
            return;
          }
          if (isJson) {
            try {
              handleFieldChange(fieldName, JSON.parse(text));
            } catch {
              handleFieldChange(fieldName, text);
            }
          } else {
            handleFieldChange(fieldName, text);
          }
        }}
      />
    );
  };

  return (
    <Form layout="vertical" size="small" style={{ marginTop: 8 }}>
      {activeFields.map((f) => {
        const prop = schema.properties[f];
        if (!prop) return null;

        const isRequired = schema.required?.includes(f);
        const tooltipText = FIELD_TOOLTIPS[f] || prop.description;
        const labelTitle = prop.title || f;

        return (
          <Form.Item
            key={f}
            style={{ marginBottom: 8 }}
            validateStatus={fieldErrors?.[f] ? "error" : undefined}
            help={fieldErrors?.[f] || undefined}
            label={
              <Space orientation="horizontal" size={4}>
                <Text style={{ fontSize: 12, fontWeight: isRequired ? 600 : 400 }}>
                  {labelTitle}
                  {isRequired && <span style={{ color: "#ff4d4f", marginLeft: 2 }}>*</span>}
                </Text>
                {tooltipText && (
                  <Tooltip title={tooltipText} placement="right">
                    <InfoCircleOutlined style={{ color: "#8c8c8c", fontSize: 11, cursor: "help" }} />
                  </Tooltip>
                )}
              </Space>
            }
          >
            {renderFieldControl(f, prop)}
          </Form.Item>
        );
      })}
    </Form>
  );
}