// JSON Schema → 表单与工具注册。
// schema 来源：frontend/src/toolSchemas/*.json
// JSON Schema → forms and tool registration.
// Schemas come from frontend/src/toolSchemas/*.json

import familySchema from "./toolSchemas/orbit_family_generation.json";
import designOrbitSchema from "./toolSchemas/design_orbit.json";
import controlOrbitSchema from "./toolSchemas/control_orbit.json";
import propagationSchema from "./toolSchemas/orbit_propagation.json";
import transferSchema from "./toolSchemas/transfer_design.json";
import transformSchema from "./toolSchemas/spacetime_transform.json";
import sweepSchema from "./toolSchemas/catalog_sweep.json";
import spatiographyBoundariesSchema from "./toolSchemas/spatiography_boundaries.json";

export interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: (string | number)[];
  anyOf?: { type?: string; enum?: (string | number)[] }[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  items?: SchemaProperty;
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
}

export interface ToolSchema {
  properties: Record<string, SchemaProperty>;
  type?: string;
  title?: string;
  description?: string;
  required?: string[];
}

export interface ToolEntry {
  name: string;
  title: string;
  schema: ToolSchema;
  binaryDtype?: "f32" | "f64";
  artifactType?: string;
  hasTrajectory?: boolean;
}

export const TOOL_REGISTRY: ToolEntry[] = [
  { name: "orbit_family_generation", title: "轨道族生成", schema: familySchema as ToolSchema, binaryDtype: "f32", artifactType: "family", hasTrajectory: true },
  { name: "design_orbit", title: "任务轨道设计", schema: designOrbitSchema as ToolSchema, artifactType: "orbit", hasTrajectory: true },
  { name: "catalog_sweep", title: "参数空间扫描 (Sweep)", schema: sweepSchema as ToolSchema, artifactType: "family", hasTrajectory: false },
  { name: "control_orbit", title: "轨道保持", schema: controlOrbitSchema as ToolSchema, artifactType: "ephemeris", hasTrajectory: true },
  { name: "orbit_propagation", title: "轨道预报", schema: propagationSchema as ToolSchema, artifactType: "ephemeris", hasTrajectory: true },
  { name: "transfer_design", title: "转移轨道设计", schema: transferSchema as ToolSchema, artifactType: "transfer", hasTrajectory: true },
  // orbit_stability 已随上游移除（e2m2e 5.9.3 的工具清单不再暴露它，空参
  // schema 的 placeholder 一并消失），toolSchemas/orbit_stability.json 同步
  // 删除；能力本体亦随 e2m2e 5.9.8 删除（e2m2e.algorithm.stability 整体移除，
  // Python API 不复存在）。English: the capability itself is gone with
  // e2m2e 5.9.8 (module e2m2e.algorithm.stability removed entirely).
  { name: "spacetime_transform", title: "时空坐标转换", schema: transformSchema as ToolSchema, artifactType: "orbit", hasTrajectory: true },
  // 分区边界：产出进区域图层（regionLayer），非轨迹、不入库
  // Spatiography boundaries: feeds the region layer (regionLayer) — not trajectories, not cataloged.
  { name: "spatiography_boundaries", title: "分区边界", schema: spatiographyBoundariesSchema as ToolSchema, hasTrajectory: false },
];

export function toolEntry(name: string): ToolEntry {
  const entry = TOOL_REGISTRY.find((item) => item.name === name);
  if (!entry) throw new Error(`未知工具: ${name}`);
  return entry;
}
