/**
 * 参数覆写层 (paramOverlay)
 * 来源：docs-old-pyqt-gui-inventory.md B节规范
 */

import type { SchemaProperty, ToolSchema } from "../schema";

export interface UnitOption {
  label: string;
  toStandard: number; // 换算到标准单位的乘数：standardValue = displayValue * toStandard
  decimals: number;
  step: number;
}

/**
 * TU 秒值（paramOverlay 时间单位，BCR4BP 27.32 天周期口径）：≈ 375676.97 s。
 * 与 `cr3bp.ts` 的 TU_SECONDS（375190.26，CR3BP 特征时间口径）是两个不同
 * 坐标系约定，勿混用（见 cr3bp.ts 注释）。
 * 来源：Python 侧单一来源 `commons.units.TU_SECONDS`（由 templates.seed 导出，
 * 定义为 `CHAR_PERIOD_SEC / (2π)`）。前端无法直接复用 Python 侧常量，需手工
 * 同步——收敛到本常量的意义：改动时只改此处，而不是散落的 5 处字面量。
 */
/** TU in seconds for paramOverlay's time units (BCR4BP 27.32-day period
 *  convention): ≈ 375676.97 s. Distinct from `cr3bp.ts`'s TU_SECONDS
 *  (375190.26, the CR3BP characteristic-time convention) — the two are different
 *  frame conventions, do not mix (see cr3bp.ts).
 *  Single source on the Python side is `commons.units.TU_SECONDS` (exported by
 *  templates.seed as `CHAR_PERIOD_SEC / (2π)`); the frontend cannot import it and
 *  must be kept in sync by hand — hence this one named constant instead of five
 *  scattered literals. */
export const TU_SECONDS = 375676.97;

/** 可切换单位字段定义（首项为标准单位，toStandard 恒为 1.0） */
/** Switchable-unit field definitions (first entry is the standard unit; toStandard is always 1.0). */
export const UNIT_DEFINITIONS: Record<string, UnitOption[]> = {
  // 长度类（标准单位：km）
  // Length fields (standard unit: km).
  amplitude: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  perilune_height: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 50 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  amplitude_in: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  amplitude_out: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  semi_major_axis: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  max_amplitude_km: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 500 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  min_amplitude_km: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 500 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  perilune_height_max_km: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 500 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  amplitude_in_km: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  amplitude_out_km: [
    { label: "km", toStandard: 1.0, decimals: 1, step: 100 },
    { label: "m", toStandard: 1e-3, decimals: 0, step: 1000 },
    { label: "DU", toStandard: 384400, decimals: 6, step: 0.001 },
  ],
  match_tolerance_km: [
    { label: "km", toStandard: 1.0, decimals: 4, step: 0.01 },
    { label: "m", toStandard: 1e-3, decimals: 1, step: 10 },
    { label: "DU", toStandard: 384400, decimals: 8, step: 0.00001 },
  ],
  // 相位与角度类
  // Phase and angle fields.
  phase: [
    { label: "周期份额", toStandard: 1.0, decimals: 4, step: 0.05 },
    { label: "度", toStandard: 1 / 360, decimals: 1, step: 5 },
    { label: "弧度", toStandard: 1 / (2 * Math.PI), decimals: 3, step: 0.05 },
  ],
  phase_in: [
    { label: "周期份额", toStandard: 1.0, decimals: 4, step: 0.05 },
    { label: "度", toStandard: 1 / 360, decimals: 1, step: 5 },
    { label: "弧度", toStandard: 1 / (2 * Math.PI), decimals: 3, step: 0.05 },
  ],
  phase_out: [
    { label: "周期份额", toStandard: 1.0, decimals: 4, step: 0.05 },
    { label: "度", toStandard: 1 / 360, decimals: 1, step: 5 },
    { label: "弧度", toStandard: 1 / (2 * Math.PI), decimals: 3, step: 0.05 },
  ],
  inclination: [
    { label: "度", toStandard: 1.0, decimals: 2, step: 1 },
    { label: "rad", toStandard: 180 / Math.PI, decimals: 4, step: 0.01 },
  ],
  arg_of_pericenter: [
    { label: "度", toStandard: 1.0, decimals: 2, step: 1 },
    { label: "rad", toStandard: 180 / Math.PI, decimals: 4, step: 0.01 },
  ],
  // 时间类（标准单位 = API 提交单位：design/orbit_propagation 的 duration
  // 为秒，control_* 为天；schema 描述即契约）
  // Time fields (standard unit = the API submit unit: seconds for design/
  // orbit_propagation duration, days for control_*; the schema description is
  // the contract).
  duration: [
    { label: "秒", toStandard: 1.0, decimals: 0, step: 3600 },
    { label: "时", toStandard: 3600, decimals: 1, step: 24 },
    { label: "日", toStandard: 86400, decimals: 1, step: 1 },
    // 月 = 1/12 年（365.25 天口径），与“日→年 = 1/365.25”同一基准
    // Month = 1/12 year (365.25-day basis), same anchor as day→year = 1/365.25.
    { label: "月", toStandard: (365.25 * 86400) / 12, decimals: 2, step: 0.5 },
    { label: "年", toStandard: 365.25 * 86400, decimals: 4, step: 0.05 },
    { label: "TU", toStandard: TU_SECONDS, decimals: 4, step: 0.1 },
  ],
  output_step: [
    { label: "秒", toStandard: 1.0, decimals: 0, step: 60 },
    { label: "时", toStandard: 3600, decimals: 2, step: 0.5 },
    { label: "日", toStandard: 86400, decimals: 4, step: 0.1 },
    { label: "TU", toStandard: TU_SECONDS, decimals: 4, step: 0.01 },
  ],
  control_interval: [
    { label: "天", toStandard: 1.0, decimals: 3, step: 0.1 },
    { label: "秒", toStandard: 1 / 86400, decimals: 0, step: 3600 },
    { label: "TU", toStandard: TU_SECONDS / 86400, decimals: 4, step: 0.05 },
  ],
  feedback_arc: [
    { label: "天", toStandard: 1.0, decimals: 3, step: 0.1 },
    { label: "秒", toStandard: 1 / 86400, decimals: 0, step: 3600 },
    { label: "TU", toStandard: TU_SECONDS / 86400, decimals: 4, step: 0.05 },
  ],
  momentum_interval: [
    { label: "天", toStandard: 1.0, decimals: 3, step: 0.5 },
    { label: "秒", toStandard: 1 / 86400, decimals: 0, step: 3600 },
    { label: "TU", toStandard: TU_SECONDS / 86400, decimals: 4, step: 0.05 },
  ],
};

export function convertValue(
  field: string,
  val: number,
  fromUnit: string,
  toUnit: string
): number {
  const units = UNIT_DEFINITIONS[field];
  if (!units) return val;
  const from = units.find((u) => u.label === fromUnit);
  const to = units.find((u) => u.label === toUnit);
  if (!from || !to) return val;
  const standardVal = val * from.toStandard;
  return standardVal / to.toStandard;
}

export function toStandardValue(field: string, displayVal: number, currentUnit: string): number {
  const units = UNIT_DEFINITIONS[field];
  if (!units) return displayVal;
  const cur = units.find((u) => u.label === currentUnit);
  if (!cur) return displayVal;
  return displayVal * cur.toStandard;
}

export function fromStandardValue(field: string, standardVal: number, targetUnit: string): number {
  const units = UNIT_DEFINITIONS[field];
  if (!units) return standardVal;
  const tgt = units.find((u) => u.label === targetUnit);
  if (!tgt) return standardVal;
  return standardVal / tgt.toStandard;
}

/** 15 种 design_orbit 轨道类型分支默认值 */
/** Branch defaults for the 15 design_orbit orbit types. */
export const DESIGN_ORBIT_BRANCH_DEFAULTS: Record<string, Record<string, unknown>> = {
  HALO: { amplitude: 30000, phase: 0.0, collinear_point: 2, north_south: 2 },
  DRO: { amplitude: 60000, phase: 0.5001 },
  DPO: { amplitude: 20000, phase: 0.5001 },
  NRHO: { perilune_height: 5000, north_south: 2, phase: 0.5, collinear_point: 2 },
  LISSAJOUS: { amplitude_in: 2500, amplitude_out: 7500, phase_in: 0.01, phase_out: 0.55, collinear_point: 2 },
  AXIAL: { amplitude: 5000, phase: 0.0, collinear_point: 2 },
  L4: { amplitude_in: 8000, amplitude_out: 6000, phase_in: 0.0, phase_out: 0.0 },
  L5: { amplitude_in: 8000, amplitude_out: 6000, phase_in: 0.0, phase_out: 0.0 },
  L4_SPO: { amplitude: 10000, phase: 0.0 },
  L5_SPO: { amplitude: 10000, phase: 0.0 },
  L4_LPO: { amplitude: 50000, phase: 0.0 },
  L5_LPO: { amplitude: 50000, phase: 0.0 },
  L4_HORSESHOE: { amplitude: 100000, phase: 0.0 },
  L5_HORSESHOE: { amplitude: 100000, phase: 0.0 },
  ELFO: { semi_major_axis: 6500, inclination: 75, arg_of_pericenter: 270, perilune_height: 200 },
  // LYAPUNOV 默认进 collinear_point/amplitude：上游按平动点分档振幅上限
  // （L1 ±26908 / L2 ±77000），默认 L2 + 12000 km 稳落可解域。
  // RO 默认只给共振比与相位、不给 amplitude（留空 = 取精确共振成员），
  // 并按上游 RO 星历冒烟的实测稳定画像取 4:1 + 300000 s 弧 + 36000 s 步长
  // （scripts/design_ro_ephemeris_smoke.py）。实测口径：4:1 该画像 78 s 收敛；
  // 3:1 同弧长/步长 418 s 后修正不收敛，3:1 加 1 h 步长亦然——共振比与
  // 修正代价强相关，默认必须落在能收敛的那一档。
  // LYAPUNOV defaults carry collinear_point/amplitude: upstream bounds the
  // amplitude per libration point (L1 ±26908 / L2 ±77000), so defaulting to
  // L2 + 12000 km lands inside the solvable domain. RO defaults give only the
  // resonance pair and phase, never amplitude (an empty amplitude selects the
  // exact resonance member) and follow the profile measured stable by upstream's
  // RO ephemeris smoke (scripts/design_ro_ephemeris_smoke.py): 4:1 with a
  // 300,000 s arc and a 36,000 s step. Measured: that profile converges in 78 s,
  // while 3:1 diverges after 418 s at the same arc/step (and also with a 1 h
  // step) — the resonance pair drives the correction cost, so the default must
  // sit on a pair that converges.
  LYAPUNOV: { amplitude: 12000, phase: 0.0, collinear_point: 2 },
  RO: { resonance_p: 4, resonance_q: 1, phase: 0.0, duration: 300000, output_step: 36000 },
};

/** 族生成分支默认值 */
/** Family-generation branch defaults. */
export const FAMILY_BRANCH_DEFAULTS: Record<string, Record<string, unknown>> = {
  HALO: { libration_point: 2, max_amplitude_km: 30000 },
  NRHO: { libration_point: 2, north_south: 2, perilune_height_max_km: 5000 },
  AXIAL: { libration_point: 2, max_amplitude_km: 5000 },
  LISSAJOUS: { libration_point: 2, amplitude_in_km: 2500, amplitude_out_km: 7500, phase_in: 0.01, phase_out: 0.55 },
  SPO: { libration_point: 4, min_amplitude_km: 1737, max_amplitude_km: 75000, continuation_direction: "decrease-x0", match_tolerance_km: 0.01 },
  LPO: { libration_point: 4, min_amplitude_km: 1000, max_amplitude_km: 110000, continuation_direction: "decrease-x0", match_tolerance_km: 0.01 },
  HORSESHOE: { libration_point: 4, min_amplitude_km: 50000, max_amplitude_km: 110000, continuation_direction: "decrease-x0", match_tolerance_km: 0.01 },
  DRO: { min_amplitude_km: 1737, max_amplitude_km: 110000 },
};

/** 转移设计分支默认值（键 = transfer_type）。
 *  HMN 默认地心目标半径取地月平均距离（环月演示），transfer_type 自身
 *  进默认值使表单挂载即有合法分支。
 *  PCN 默认给 tof_range（上游 PcnSearchParams.tof_range_days 的搜索网格，
 *  天）；bplane_target / departure_asymptote 必须用户二选一，不给默认——
 *  默认任一侧都会把另一侧变成静默不可达的错支。 */
/** Transfer-design branch defaults (keyed by transfer_type).
 *  HMN's default geocentric target radius is the mean Earth-Moon distance
 *  (a lunar demo); transfer_type itself rides the defaults so the form has
 *  a valid branch right after mount.
 *  PCN defaults carry tof_range (the search grid of the upstream
 *  PcnSearchParams.tof_range_days, in days); bplane_target /
 *  departure_asymptote must be picked by the user and get no default —
 *  defaulting either one silently makes the other the wrong branch. */
export const TRANSFER_BRANCH_DEFAULTS: Record<string, Record<string, unknown>> = {
  HMN: { transfer_type: "HMN", target_orbit_radius_km: 384400 },
  LGA: { transfer_type: "LGA" },
  WSB: { transfer_type: "WSB" },
  low_thrust: { transfer_type: "low_thrust" },
  PCN: { transfer_type: "PCN", tof_range: [3, 6] },
};

export const BRANCH_DEFAULTS: Record<string, Record<string, Record<string, unknown>>> = {
  design_orbit: DESIGN_ORBIT_BRANCH_DEFAULTS,
  orbit_family_generation: FAMILY_BRANCH_DEFAULTS,
  transfer_design: TRANSFER_BRANCH_DEFAULTS,
};

export function getBranchDefaults(toolName: string, branchType: string): Record<string, unknown> {
  return BRANCH_DEFAULTS[toolName]?.[branchType] ?? {};
}

/** 工具的分支键字段与当前分支类型（transfer_design 用 transfer_type，缺省 HMN；
 *  其余轨道工具用 orbit_type，缺省 HALO）：表单渲染、默认值填充与提交校验同源。
 *  提交校验曾只认 orbit_type，导致 transfer_design 的 HMN/LGA/WSB/PCN 专属字段
 *  从不参与校验——分支解析必须只有这一处。 */
/** A tool's branch-key field and current branch type (transfer_design uses
 *  transfer_type, defaulting to HMN; other orbit tools use orbit_type,
 *  defaulting to HALO): one source for form rendering, default filling, and
 *  submission validation. Validation used to look at orbit_type alone, so the
 *  HMN/LGA/WSB/PCN-only fields of transfer_design never got validated —
 *  branch resolution must live here only. */
export function branchSelection(
  toolName: string,
  values: Record<string, unknown>,
): { key: string; type: string } {
  const key = toolName === "transfer_design" ? "transfer_type" : "orbit_type";
  return { key, type: (values[key] as string) || (key === "transfer_type" ? "HMN" : "HALO") };
}

/** 切分支类型（orbit_type / transfer_type）时的参数迁移：只带走真正属于用户输入的值，
 *  新分支的默认值接管其余字段。
 *
 *  "真正属于用户输入" = 既不是模型默认值、也不是上一分支的默认值。前两者都是自动
 *  填进去的，用户没动过它们；把它们当已填值沿用会有两种实际后果：
 *  1. 新分支更具体的默认永远落不了地——design_orbit 的 HALO→RO 会让 output_step
 *     停在模型默认 3600，而 RO 的实测收敛画像要 36000；
 *  2. 旧分支的残留值把新分支卡死——HALO 的 amplitude=30000 跟着切到 RO，而 RO 的
 *     值域是 145000~340000，提交校验当场拦停，承诺的"振幅留空取精确共振成员"
 *     画像根本到不了用户手里。
 *  用户真正改过的值（与两个默认值都不同）原样保留。
 *  Migrates parameters when the branch type switches: only values that are genuinely
 *  user input carry over, and the new branch's defaults take over the rest. "Genuinely
 *  user input" means neither the model default nor the previous branch's default —
 *  both were filled in automatically. Treating them as user input has two real
 *  consequences: (1) the new branch's more specific default can never land
 *  (design_orbit's HALO→RO leaves output_step at the model default 3600 while RO's
 *  measured profile needs 36000); (2) the old branch's leftover value blocks the new
 *  one (HALO's amplitude=30000 follows into RO, whose domain is 145000~340000, so
 *  submission validation stops it and the promised "empty amplitude selects the exact
 *  member" profile never reaches the user). Values the user really changed (differing
 *  from both defaults) are kept as-is. */
export function switchBranch(
  toolName: string,
  schema: ToolSchema,
  values: Record<string, unknown>,
  branchKey: string,
  branchType: string,
  previousBranch?: string,
): Record<string, unknown> {
  const pruned: Record<string, unknown> = { [branchKey]: branchType };
  const previousDefaults = previousBranch ? getBranchDefaults(toolName, previousBranch) : {};
  for (const field of getFieldApplicability(toolName, branchType)) {
    if (field === branchKey) continue;
    const val = values[field];
    if (val === undefined) continue;
    const modelDefault = schema.properties[field]?.default;
    const isModelDefault = modelDefault !== undefined && val === modelDefault;
    const isPreviousBranchDefault = field in previousDefaults && val === previousDefaults[field];
    if (!isModelDefault && !isPreviousBranchDefault) {
      pruned[field] = val;
    }
  }
  for (const [field, defVal] of Object.entries(getBranchDefaults(toolName, branchType))) {
    const modelDefault = schema.properties[field]?.default;
    const carried = pruned[field];
    if (carried === undefined || (modelDefault !== undefined && carried === modelDefault)) {
      pruned[field] = defVal;
    }
  }
  return pruned;
}

/** 分支键类型预置下拉（键 = 工具名，字段为 orbit_type）；transfer_design 的
 *  transfer_type 走 ENUM_OPTIONS，不在此列。 */
/** Branch-key type preset dropdowns (keyed by tool name, field orbit_type);
 *  transfer_design's transfer_type goes through ENUM_OPTIONS and is not listed here. */
export const BRANCH_TYPE_OPTIONS: Record<string, { label: string; value: string }[]> = {
  design_orbit: [
    { label: "HALO 晕轨道", value: "HALO" },
    { label: "NRHO 近直线晕轨道", value: "NRHO" },
    { label: "DRO 远程逆行轨道", value: "DRO" },
    { label: "DPO 直接顺行轨道", value: "DPO" },
    { label: "LISSAJOUS 利萨如轨道", value: "LISSAJOUS" },
    { label: "AXIAL 轴向轨道", value: "AXIAL" },
    { label: "L4 三角平动点轨道 (L4)", value: "L4" },
    { label: "L5 三角平动点轨道 (L5)", value: "L5" },
    { label: "L4_SPO 短周期轨道 (L4)", value: "L4_SPO" },
    { label: "L5_SPO 短周期轨道 (L5)", value: "L5_SPO" },
    { label: "L4_LPO 长周期轨道 (L4)", value: "L4_LPO" },
    { label: "L5_LPO 长周期轨道 (L5)", value: "L5_LPO" },
    { label: "L4_HORSESHOE 马蹄形轨道 (L4)", value: "L4_HORSESHOE" },
    { label: "L5_HORSESHOE 马蹄形轨道 (L5)", value: "L5_HORSESHOE" },
    { label: "ELFO 冻结轨道", value: "ELFO" },
    { label: "LYAPUNOV 平动点轨道", value: "LYAPUNOV" },
    { label: "RO 共振轨道", value: "RO" },
  ],
  orbit_family_generation: [
    { label: "HALO 晕轨道族", value: "HALO" },
    { label: "NRHO 近直线晕轨道族", value: "NRHO" },
    { label: "AXIAL 轴向轨道族", value: "AXIAL" },
    { label: "LISSAJOUS 利萨如轨道族", value: "LISSAJOUS" },
    { label: "SPO 短周期轨道族", value: "SPO" },
    { label: "LPO 长周期轨道族", value: "LPO" },
    { label: "HORSESHOE 马蹄形轨道族", value: "HORSESHOE" },
    { label: "DRO 远程逆行轨道族", value: "DRO" },
  ],
};

/** 模型默认值（schema `default`）+ 分支默认值合并进当前参数：只填空位，不覆盖
 *  已填值；无可填项时返回 null，调用方据此跳过 setState。分支键仅当它是活动
 *  字段时才注入——control_orbit 等工具没有 orbit_type 且 additionalProperties:
 *  false，误塞会被上游拒收。 */
/** Merges model defaults (schema `default`) plus branch defaults into the current
 *  params: fills empty slots only, never overwrites entered values; returns null
 *  when nothing changed so callers can skip the setState. The branch key is
 *  injected only when it is an active field — tools without orbit_type
 *  (additionalProperties: false) must not receive a stray value. */
export function withParamDefaults(
  toolName: string,
  schema: ToolSchema,
  values: Record<string, unknown>,
  branchKey: string,
  branchType: string,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...values };
  let changed = false;
  const fill = (field: string, defVal: unknown) => {
    if (defVal === undefined || defVal === null) return;
    const cur = next[field];
    if (cur === undefined || cur === null) {
      next[field] = defVal;
      changed = true;
    }
  };

  const active = getActiveFields(toolName, schema, branchType);
  if (active.includes(branchKey) && next[branchKey] === undefined) {
    next[branchKey] = branchType;
    changed = true;
  }
  // 分支默认值先于模型默认值填入：两者都覆盖同一字段时，更具体的分支值优先。
  // fill 只填空位，故这个顺序就决定用户没填时谁生效——RO 的 output_step 是
  // 现存的唯一冲突（schema 默认 3600 会压掉 RO 实测画像的 36000，界面上看不
  // 出差别，但提交的弧长分辨率完全变了）。
  // Branch defaults are filled before model defaults: when both cover a field,
  // the more specific branch value wins. fill only touches empty slots, so this
  // order decides what applies when the user typed nothing — RO's output_step is
  // the one existing collision (the schema default 3600 would shadow the 36000 of
  // RO's measured profile: invisible in the form, but it changes the submitted
  // arc resolution wholesale).
  for (const [field, defVal] of Object.entries(getBranchDefaults(toolName, branchType))) {
    fill(field, defVal);
  }
  for (const field of active) {
    fill(field, schema.properties[field]?.default);
  }
  return changed ? next : null;
}

/** 整数枚举中文/英文标签映射 */
/** Chinese/English label maps for integer enums. */
export const ENUM_OPTIONS: Record<string, { label: string; value: number | string }[]> = {
  collinear_point: [
    { label: "1 (L1)", value: 1 },
    { label: "2 (L2)", value: 2 },
    { label: "3 (L3)", value: 3 },
  ],
  libration_point: [
    { label: "1 (L1)", value: 1 },
    { label: "2 (L2)", value: 2 },
    { label: "3 (L3)", value: 3 },
    { label: "4 (L4)", value: 4 },
    { label: "5 (L5)", value: 5 },
  ],
  north_south: [
    { label: "1 (北族 Class I)", value: 1 },
    { label: "2 (南族 Class II)", value: 2 },
  ],
  is_nrho: [
    { label: "0 (否)", value: 0 },
    { label: "1 (是)", value: 1 },
  ],
  special_mode: [
    { label: "1 (Lissajous ẋ=0)", value: 1 },
    { label: "2 (Halo/NRHO ẋ=0, ż=0)", value: 2 },
  ],
  control_mode: [
    { label: "1 目标点控制（宽松）", value: 1 },
    { label: "2 目标点控制（严格）", value: 2 },
    { label: "3 特征点控制", value: 3 },
    { label: "4 目标点控制 + 角动量管理", value: 4 },
    { label: "5 目标点严格控制 + 角动量管理", value: 5 },
    { label: "6 特征点控制 + 角动量管理", value: 6 },
  ],
  continuation_direction: [
    { label: "decrease-x0", value: "decrease-x0" },
    { label: "increase-x0", value: "increase-x0" },
  ],
  correction_method: [
    { label: "two_level (双层打靶)", value: "two_level" },
  ],
  transfer_type: [
    { label: "HMN 霍曼直接转移", value: "HMN" },
    { label: "LGA 月球引力辅助", value: "LGA" },
    { label: "WSB 太阳引力辅助（弱稳定边界）", value: "WSB" },
    { label: "low_thrust 小推力", value: "low_thrust" },
    { label: "PCN 圆锥曲线拼接", value: "PCN" },
  ],
  // 时空坐标转换的 transform_type 在 schema 里是自由字符串（无 enum），
  // 这里钉成下拉：六个变换对就是上游全部可达值，手打出错只会换来上游
  // ValueError。
  // spacetime_transform's transform_type is a free-form string in the schema
  // (no enum); pinned to a dropdown here: the six pairs are exactly the
  // upstream reachable set, and typos only earn an upstream ValueError.
  transform_type: [
    { label: "synodic_to_j2000 会合系→地心惯性", value: "synodic_to_j2000" },
    { label: "j2000_to_synodic 地心惯性→会合系", value: "j2000_to_synodic" },
    { label: "j2000_to_eppr 地心惯性→EPPR", value: "j2000_to_eppr" },
    { label: "eppr_to_j2000 EPPR→地心惯性", value: "eppr_to_j2000" },
    { label: "gcrs_to_ebcrs GCRS→EBCRS", value: "gcrs_to_ebcrs" },
    { label: "ebcrs_to_gcrs EBCRS→GCRS", value: "ebcrs_to_gcrs" },
  ],
};

/** 字段多行 Tooltip 提示表 */
/** Multi-line tooltip hints per field. */
export const FIELD_TOOLTIPS: Record<string, string> = {
  orbit_type: "轨道族或轨道类型。不同轨道类型将激活对应参数集与默认初猜值。",
  amplitude:
    "轨道主振幅（km）。Halo 为 z 向振幅；DRO/DPO/Axial 为 x/y 向振幅；北族取正、南族取负。按轨道类型分档：DRO/DPO 1737~110000，HALO 按平动点 L1 ±26908 / L2 ±77000，LYAPUNOV 5000~60000，AXIAL ±60000，RO 145000~340000（留空取精确共振成员）。",
  phase: "轨道初始相位（0~1 周期份额）。DRO/DPO 默认 0.5001；NRHO 默认 0.5；Halo 默认 0.0。",
  collinear_point: "共线平动点编号：1=L1, 2=L2, 3=L3。LYAPUNOV 用 1 或 2。",
  north_south: "Halo / NRHO 轨道的南北族分类：1=北族 (Class I, z>0), 2=南族 (Class II, z<0)。",
  perilune_height: "近月点高度（km）。NRHO 100~40000 km（默认 5000）；ELFO 默认 200 km。",
  resonance_p:
    "共振比卫星侧整数（p:q = 卫星:月球）。仅 RO 用，须与 resonance_q 组成支持档位之一：2:1 / 3:1 / 3:2 / 4:1 / 4:3。星历修正对共振比敏感：4:1（默认画像）收敛，3:1 实测不收敛（上游待跟进），其余档位未验证；换档位时同时调整弧长与步长再试。",
  resonance_q: "共振比月球侧整数，仅 RO 用，与 resonance_p 成对。",
  direction:
    "传播方向：forward 自 epoch 正向预报；backward 自 epoch 反向回溯（duration 恒为正的时长幅值，不是负时长）。",
  semi_major_axis: "半长轴（km）。ELFO 轨道必填，默认 6500 km。",
  inclination: "轨道倾角（度）。0~180 度，ELFO 默认 75 度。",
  arg_of_pericenter: "近月点幅角（度）。0~360 度，ELFO 默认 270 度。",
  duration: "传播/积分时长。GUI 默认以年/月输入，提交时换算为秒。",
  output_step: "轨迹输出步长（秒）。默认 3600 秒（1小时）。",
  correction_method: "星历修正方法：two_level（Rust 多重打靶 + 速度加权，稳定轨道默认）；不稳定轨道由算法自动切换分段打靶拼接 (segmented)。",
  perturbation: "天体摄动力开关字典 JSON，例如 {\"sun_body\": 1, \"planets\": 1}（留空表示默认全开）。",
  dyb: "9 分量光压面质比与摄动系数数组，dyb[0] 为等效面质比 m²/kg（留空表示默认）。",
  n_orbits: "生成的族成员轨道数量上限（1~100，默认 50）。",
  num_controls: "站保控制次数上限（1~10000，默认 120）。",
  num_monte_carlo: "蒙特卡洛仿真样本数（1~1000，默认 5；生产通常设 100）。",
  tight_tolerance_km: "严格位置控制容差（km），默认 0.1 km。",
  control_interval: "站保控制评估间隔（天），默认 0.25 天（短弧）。",
  feedback_arc: "站保反馈弧段时长（天），默认 0.125 天。",
  transfer_type:
    "转移类型。LGA/WSB 需先在项目树选中目标轨道工件，提交时自动注入其末态为 target_ephemeris（会合系物理 km，e2m2e#516）；HMN 用 target_orbit_radius_km；PCN 须恰给 bplane_target 或 departure_asymptote 之一。",
  tli_epoch: "出发（TLI）历元。HMN 几何搜索中仅作记录，不参与几何解算。",
  parking_alt_km: "地球停泊轨道高度 (km)，默认 200 km。",
  incl_deg: "停泊轨道倾角（度），默认 28.5°。",
  flight_path_deg: "航迹角（度）。当前仅支持 0（圆停泊轨道）。",
  target_orbit_radius_km:
    "目标轨道半径 (km)。地心距——从地心量起的圆轨道半径，非月心高度；环月演示取 ≈384400（默认值）。",
  tof_range:
    "飞行时间范围 [min, max]（天，须为有限数对且 min < max）。HMN 提供时走 Lambert 批量扫描选最优 tof，缺省用霍曼公式；LGA/WSB 各自搜索网格有自己的默认；PCN 作到达与出发两种模式共用的 tof 搜索网格。",
  lga_search_params:
    "LGA 搜索参数 JSON（留空表示 GUI 默认注入 360 相位点加密网格）。",
  wsb_search_params: "WSB 搜索参数 JSON（留空表示搜索默认网格）。",
  bplane_target:
    'PCN 到达模式目标：月心 B 平面 JSON，例如 {"perilune_alt_km": 100, "bdot_t_km": 5000, "bdot_r_km": 0}。给定期望近月点高度与 B·T/B·R，打靶求解出发渐近线使其命中；与 departure_asymptote 二选一。',
  departure_asymptote:
    'PCN 出发模式渐近线 JSON，例如 {"rha_deg": 20, "dha_deg": 10, "c3_km2_s2": 2.0}。给定地球出发双曲渐近线（赤经/赤纬/C3），无迭代解算月心 B 平面与 LOI 脉冲；与 bplane_target 二选一。',
  transform_type:
    "变换对：synodic 为会合旋转系；EPPR 为星历脉动旋转系（x̂ 沿瞬时地月连线）；GCRS/EBCRS 走星历文件（需 ephemeris_path）。",
};

/** 格式化范围占位提示 */
/** Formats range placeholder hints. */
export function formatRangePrompt(
  min: number | undefined,
  max: number | undefined,
  unitLabel: string
): string {
  if (min !== undefined && max !== undefined) {
    return `可填范围: ${min} ~ ${max} ${unitLabel}`;
  }
  if (min !== undefined) {
    return `可填范围: ≥ ${min} ${unitLabel}`;
  }
  if (max !== undefined) {
    return `可填范围: ≤ ${max} ${unitLabel}`;
  }
  return "无范围约束";
}

/** 动态计算字段适用性（支持 design_orbit 全部 15 种类型） */
/** Computes field applicability dynamically (covers all 15 design_orbit types). */
export function getFieldApplicability(toolName: string, orbitType: string): string[] {
  if (toolName === "orbit_family_generation") {
    const common = ["orbit_type", "libration_point", "n_orbits"];
    const specific: Record<string, string[]> = {
      HALO: ["max_amplitude_km"],
      NRHO: ["north_south", "perilune_height_max_km", "continuation_direction"],
      AXIAL: ["max_amplitude_km"],
      LISSAJOUS: ["amplitude_in_km", "amplitude_out_km", "phase_in", "phase_out"],
      SPO: ["max_amplitude_km", "min_amplitude_km", "continuation_direction", "match_tolerance_km"],
      LPO: ["max_amplitude_km", "min_amplitude_km", "continuation_direction", "match_tolerance_km"],
      HORSESHOE: ["max_amplitude_km", "min_amplitude_km", "continuation_direction", "match_tolerance_km"],
      DRO: ["max_amplitude_km", "min_amplitude_km"],
    };
    const fields = [...common, ...(specific[orbitType] ?? [])];
    if (orbitType === "DRO") {
      return fields.filter((f) => f !== "libration_point");
    }
    return fields;
  }

  if (toolName === "transfer_design") {
    // 转移类型公共字段；target_ephemeris 不进表单——LGA/WSB 由 GUI 从
    // 项目树选中工件注入（App.tsx handleRunTool），手填 JSON 无意义。
    // Fields common to all transfer types; target_ephemeris stays out of
    // the form — for LGA/WSB the GUI injects it from the selected project
    // artifact (App.tsx handleRunTool); hand-typed JSON adds nothing.
    const common = [
      "transfer_type",
      "tli_epoch",
      "parking_alt_km",
      "incl_deg",
      "flight_path_deg",
      "tof_range",
    ];
    const specific: Record<string, string[]> = {
      HMN: ["target_orbit_radius_km"],
      LGA: ["lga_search_params"],
      WSB: ["wsb_search_params"],
      low_thrust: [],
      // PCN 的两个目标参数化二选一（XOR 由 validateToolParams 强制）：
      // 都渲染出来让用户看得见选项，靠校验拦住空给与同填。
      // PCN's two target parameterizations are mutually exclusive (the XOR is
      // enforced by validateToolParams): both render so the user sees the
      // options, and validation catches neither-given and both-given.
      PCN: ["bplane_target", "departure_asymptote"],
    };
    return [...common, ...(specific[orbitType] ?? [])];
  }

  if (toolName === "design_orbit") {
    // design_orbit 公共字段
    // Fields common to all design_orbit types.
    const common = [
      "orbit_type",
      "epoch",
      "duration",
      "output_step",
      "perturbation",
      "dyb",
      "earth_degree",
      "moon_degree",
      "correction_method",
      "correction_revolutions",
    ];

    const specific: Record<string, string[]> = {
      HALO: ["amplitude", "phase", "collinear_point", "north_south"],
      DRO: ["amplitude", "phase"],
      DPO: ["amplitude", "phase"],
      NRHO: ["perilune_height", "north_south", "phase", "collinear_point"],
      LISSAJOUS: ["amplitude_in", "amplitude_out", "phase_in", "phase_out", "collinear_point"],
      AXIAL: ["amplitude", "phase", "collinear_point"],
      L4: ["amplitude_in", "amplitude_out", "phase_in", "phase_out"],
      L5: ["amplitude_in", "amplitude_out", "phase_in", "phase_out"],
      L4_SPO: ["amplitude", "phase"],
      L5_SPO: ["amplitude", "phase"],
      L4_LPO: ["amplitude", "phase"],
      L5_LPO: ["amplitude", "phase"],
      L4_HORSESHOE: ["amplitude", "phase"],
      L5_HORSESHOE: ["amplitude", "phase"],
      ELFO: ["semi_major_axis", "inclination", "arg_of_pericenter", "perilune_height"],
      LYAPUNOV: ["amplitude", "phase", "collinear_point"],
      RO: ["resonance_p", "resonance_q", "amplitude", "phase"],
    };

    return [...(specific[orbitType] ?? ["amplitude", "phase"]), ...common];
  }

  return [];
}

/** 当前工具+轨道类型下可见（参与表单渲染与校验）的字段列表，表单与提交校验同源 */
/** Fields visible under the current tool + orbit type (driving both rendering and validation); form and submit checks share this source. */
export function getActiveFields(toolName: string, schema: ToolSchema, orbitType: string): string[] {
  const applicability = getFieldApplicability(toolName, orbitType);
  if (applicability.length > 0) {
    return applicability.filter((f) => schema.properties[f]);
  }
  return Object.keys(schema.properties);
}

export interface ParamIssue {
  field: string;
  label: string;
  reason: string;
}

/** 上游按分支裁决的合法 RO 共振对（e2m2e `RO_SUPPORTED_RESONANCES`，顺行内共振） */
/** Upstream's per-branch legal RO resonance pairs (e2m2e `RO_SUPPORTED_RESONANCES`, prograde inner resonances). */
const RO_SUPPORTED_RESONANCES: readonly [number, number][] = [[2, 1], [3, 1], [3, 2], [4, 1], [4, 3]];

/** HALO 振幅上限按平动点分档（上游 `_HALO_FOLD_KM`，km） */
/** HALO amplitude limits per libration point (upstream `_HALO_FOLD_KM`, km). */
const HALO_AMPLITUDE_LIMITS_KM: Record<number, number> = { 1: 26908, 2: 77000 };

/** 按分支裁决的振幅范围（上游 `_ORBIT_TYPE_RANGES`，km） */
/** Amplitude domains decided per branch (upstream `_ORBIT_TYPE_RANGES`, km). */
const BRANCH_AMPLITUDE_KM: Record<string, { min: number; max: number; scope: string }> = {
  LYAPUNOV: { min: 5000, max: 60000, scope: "LYAPUNOV 振幅" },
  RO: { min: 145000, max: 340000, scope: "RO 振幅" },
};

/** 判断 JSON 文本字段是否是可用的 JSON 对象；返回 null 表示通过，否则为原因 */
/** Checks whether a JSON text field holds a usable JSON object; null means it passes, otherwise the reason. */
function jsonObjectReason(raw: unknown): string | null {
  // ParamsPanel 已先试 JSON.parse：成功即对象/数组/原始值，失败则原样留字符串。
  // ParamsPanel attempts JSON.parse first: success yields object/array/primitive,
  // failure keeps the raw string.
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? null
        : "须是 JSON 对象，如示例所示";
    } catch {
      return "不是合法 JSON";
    }
  }
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? null
    : "须是 JSON 对象，如示例所示";
}

/** 分支相关的条件校验：静态 schema 只能表达全局包络（amplitude 为全类
 *  [-110000, 350000]），按 orbit_type / transfer_type 收窄后的值域与互斥
 *  在此补齐，与上游 e2m2e 请求模型的 model_validator 同口径。
 *  issue 一律挂在实际可见的字段上。 */
/** Branch-dependent conditional checks: the static schema can only express the
 *  global envelope (amplitude spans [-110000, 350000] over every type), so the
 *  per-orbit_type / per-transfer_type domains and exclusions are completed here,
 *  matching the model validator of the upstream e2m2e request models. Issues are
 *  always attached to a field that is actually visible. */
function conditionalIssues(
  toolName: string,
  schema: ToolSchema,
  values: Record<string, unknown>,
  branchType: string,
): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const label = (field: string) => schema.properties[field]?.title || field;
  const num = (field: string) => (typeof values[field] === "number" ? (values[field] as number) : null);

  if (toolName === "design_orbit") {
    // HALO / NRHO / LYAPUNOV 的共线平动点只支持 L1 / L2（上游 model_validator）
    // HALO / NRHO / LYAPUNOV support only L1 / L2 as collinear point (upstream model validator).
    if (["HALO", "NRHO", "LYAPUNOV"].includes(branchType)) {
      const point = num("collinear_point") ?? 2;
      if (point !== 1 && point !== 2) {
        issues.push({
          field: "collinear_point",
          label: label("collinear_point"),
          reason: `${branchType} 只支持 1 (L1) 或 2 (L2)，当前 ${point}`,
        });
      }
    }

    const amplitude = num("amplitude");
    if (branchType === "HALO" && amplitude !== null) {
      const point = num("collinear_point") ?? 2;
      const limit = HALO_AMPLITUDE_LIMITS_KM[point] ?? HALO_AMPLITUDE_LIMITS_KM[2];
      if (Math.abs(amplitude) > limit) {
        issues.push({
          field: "amplitude",
          label: label("amplitude"),
          reason: `${amplitude} 超出 ${point === 1 ? "L1" : "L2"} HALO 振幅范围: -${limit} ~ ${limit} km`,
        });
      }
    }

    if (branchType === "RO") {
      const p = num("resonance_p") ?? 3;
      const q = num("resonance_q") ?? 1;
      if (!RO_SUPPORTED_RESONANCES.some(([rp, rq]) => rp === p && rq === q)) {
        issues.push({
          field: "resonance_p",
          label: label("resonance_p"),
          reason: `不支持的共振比 ${p}:${q}；支持 ${RO_SUPPORTED_RESONANCES.map(([rp, rq]) => `${rp}:${rq}`).join(" / ")}（p:q = 卫星:月球）`,
        });
      }
    }

    const amplitudeDomain = BRANCH_AMPLITUDE_KM[branchType];
    if (amplitudeDomain && amplitude !== null) {
      if (amplitude < amplitudeDomain.min || amplitude > amplitudeDomain.max) {
        issues.push({
          field: "amplitude",
          label: label("amplitude"),
          reason: `${amplitude} 超出${amplitudeDomain.scope}范围: ${amplitudeDomain.min} ~ ${amplitudeDomain.max} km`,
        });
      }
    }
  }

  if (toolName === "transfer_design" && branchType === "PCN") {
    // PCN 的到达/出发两种参数化互斥：上游拒绝都空与同填，这里同口径拦下
    // PCN's arrival/departure parameterizations are mutually exclusive: upstream
    // rejects both missing and both given; catch it at the same level here.
    const bplane = values["bplane_target"];
    const hasBplane = bplane !== null && bplane !== undefined && String(bplane).trim() !== "";
    const asymptote = values["departure_asymptote"];
    const hasAsymptote = asymptote !== null && asymptote !== undefined && String(asymptote).trim() !== "";

    if (!hasBplane && !hasAsymptote) {
      issues.push({
        field: "bplane_target",
        label: label("bplane_target"),
        reason: "PCN 须恰给 bplane_target（到达模式）或 departure_asymptote（出发模式）之一",
      });
    } else if (hasBplane && hasAsymptote) {
      issues.push({
        field: "departure_asymptote",
        label: label("departure_asymptote"),
        reason: "bplane_target 与 departure_asymptote 互斥，只能给其中一个",
      });
    } else {
      const field = hasBplane ? "bplane_target" : "departure_asymptote";
      const reason = jsonObjectReason(hasBplane ? bplane : asymptote);
      if (reason) {
        issues.push({ field, label: label(field), reason });
      }
    }
  }

  return issues;
}

/** 提交前防呆校验：必填缺失与数值越界（值为标准物理单位，直接对照 schema 范围） */
/** Preflight validation before submit: missing required fields and out-of-range values (values are in standard physical units, checked directly against schema ranges). */
export function validateToolParams(
  toolName: string,
  schema: ToolSchema,
  values: Record<string, unknown>,
): ParamIssue[] {
  const { type: branchType } = branchSelection(toolName, values);
  const issues: ParamIssue[] = [];

  for (const field of getActiveFields(toolName, schema, branchType)) {
    const prop = schema.properties[field];
    // 与 ParamsPanel 相同的 anyOf 展开：可空字段的约束在非 null 分支
    // Same anyOf expansion as ParamsPanel: nullable-field constraints live in the non-null branch.
    const isOptional = prop.anyOf?.some((v) => v.type === "null") ?? false;
    const inner: SchemaProperty = isOptional
      ? prop.anyOf!.find((v) => v.type !== "null") || prop
      : prop;
    const label = prop.title || field;
    const value = values[field];

    if (value === null || value === undefined || value === "") {
      if (schema.required?.includes(field)) {
        issues.push({ field, label, reason: "必填，当前为空" });
      }
      continue;
    }

    if (typeof value === "number" && !Number.isNaN(value)) {
      const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = inner;
      const bounds: string[] = [];
      if (minimum !== undefined && value < minimum) bounds.push(`≥ ${minimum}`);
      if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) bounds.push(`> ${exclusiveMinimum}`);
      if (maximum !== undefined && value > maximum) bounds.push(`≤ ${maximum}`);
      if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) bounds.push(`< ${exclusiveMaximum}`);
      if (bounds.length > 0) {
        issues.push({ field, label, reason: `${value} 超出可填范围: ${bounds.join(" 且 ")}` });
      }
    }
  }
  return [...issues, ...conditionalIssues(toolName, schema, values, branchType)];
}
