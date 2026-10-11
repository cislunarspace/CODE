// SOP（标准操作流程）判定与运行前硬校验（ADR 0034）。界面围绕一条固定流程组织：
// 定基准、定任务、填参数、求解、校核、入库、情景，再从入库/情景回到定任务
// 开始下一轮（复用）。
//
// 本模块只做纯计算，步骤带与运行按钮共用同一份依据：两处结论必须一致，否则会
// 出现「按钮可点但被拒」或「按钮禁用却说不出原因」。阻断项不吞信息，每条都带
// 可执行的补救动作（去选历元 / 去补参数 / 去选上游记录）。
//
// SOP (standard operating procedure) derivation and the pre-run hard gate (ADR
// 0034). The UI follows one fixed flow — basis, task, parameters, solve, review,
// catalog, scenario — and loops from catalog/scenario back into the task step
// (reuse). This module is pure: the step bar and the run button share one
// derivation, so they can never disagree; every blocker carries a concrete fix.

/** 流程阶段键 */
/** SOP stage keys. */
export type SopStageKey =
  | "basis"
  | "task"
  | "params"
  | "run"
  | "review"
  | "catalog"
  | "scenario";

/** 阶段正典顺序 */
/** Canonical stage order. */
export const SOP_STAGES: SopStageKey[] = [
  "basis",
  "task",
  "params",
  "run",
  "review",
  "catalog",
  "scenario",
];

/** 阻断项的补救动作：界面据它决定「去补」按钮做什么 */
/** A blocker's remedy: the UI turns it into a concrete "go fix it" action. */
export type SopFix = "pick-epoch" | "fill-params" | "pick-record";

/** 运行前阻断项（空数组 = 可运行） */
/** A pre-run blocker (an empty list means the run may proceed). */
export interface SopBlocker {
  /** 稳定键，供回落与去重 */
  key: "epoch" | "params" | "upstream";
  /** 词典键，说明缺什么 */
  labelKey: string;
  fix: SopFix;
  /** 具体缺项（字段名或记录要求），拼进提示文案 */
  detail: string;
}

export interface SopInputs {
  /** 当前工具 schema 的属性名（判历元依赖） */
  schemaFields: string[];
  /** 当前工具 schema 的必填字段名 */
  requiredFields: string[];
  /** 已填参数（空串/null/undefined 视为未填） */
  values: Record<string, unknown>;
  /** 参数校验问题（validateToolParams 的结果，由调用方算好传入） */
  paramIssues: { field: string; label: string; reason: string }[];
  /** 时间轴当前时刻，null = 尚未选时刻 */
  currentEt: number | null;
  /** LGA/WSB 转移缺少上游目标轨道（需要先在轨道库选中一条记录） */
  needsUpstreamRecord: boolean;
  /** 结果层是否已有轨迹 */
  hasResult: boolean;
  /** 最近产物是否已入库（轨道库里有对应记录） */
  inCatalog: boolean;
  /** 固定层记录数（情景保存的前提） */
  pinnedCount: number;
}

export interface SopStageState {
  key: SopStageKey;
  done: boolean;
  /** 当前所在阶段（第一个未完成项） */
  current: boolean;
}

export interface SopState {
  stages: SopStageState[];
  current: SopStageKey;
  blockers: SopBlocker[];
}

/** 历元类字段：名字含 epoch，或 JD 口径的 et0_jd */
/** Epoch-like fields: the name contains "epoch", or the JD-based et0_jd. */
export function isEpochField(name: string): boolean {
  return name.includes("epoch") || name === "et0_jd";
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/** 该工具是否带历元概念（决定「定基准」阶段是否参与判定） */
/** Whether the tool has an epoch notion at all (gates the basis stage). */
export function needsEpoch(schemaFields: string[]): boolean {
  return schemaFields.some(isEpochField);
}

/** 参数里已给出历元（任一历元类字段有值） */
function hasEpochValue(input: SopInputs): boolean {
  return input.schemaFields.filter(isEpochField).some((field) => isFilled(input.values[field]));
}

/** 运行前硬校验：逐条列出阻断项，顺序固定（历元、参数、上游记录） */
/** The pre-run gate: blockers in a fixed order (epoch, parameters, upstream record). */
export function runBlockers(input: SopInputs): SopBlocker[] {
  const blockers: SopBlocker[] = [];

  // 历元：必填的历元字段没填，且时间轴上也没选时刻（两者取其一即可）
  const requiredEpoch = input.requiredFields.filter(isEpochField);
  if (requiredEpoch.length > 0 && input.currentEt === null && !hasEpochValue(input)) {
    blockers.push({
      key: "epoch",
      labelKey: "sop.block.epoch",
      fix: "pick-epoch",
      detail: requiredEpoch.join("、"),
    });
  }

  // 参数：历元类问题已在上一项报过，此处只报其余必填与越界
  const otherIssues = input.paramIssues.filter((issue) => !isEpochField(issue.field));
  if (otherIssues.length > 0) {
    blockers.push({
      key: "params",
      labelKey: "sop.block.params",
      fix: "fill-params",
      detail: otherIssues.map((issue) => `${issue.label}: ${issue.reason}`).join("；"),
    });
  }

  // 上游产物：LGA/WSB 需要先在轨道库选中目标轨道
  if (input.needsUpstreamRecord) {
    blockers.push({
      key: "upstream",
      labelKey: "sop.block.upstream",
      fix: "pick-record",
      detail: "",
    });
  }

  return blockers;
}

/** 流程状态：阶段完成情况、当前阶段与阻断项 */
/** The SOP state: per-stage completion, the current stage and the blockers. */
export function deriveSop(input: SopInputs): SopState {
  const epochDependency = needsEpoch(input.schemaFields);
  const basisDone = !epochDependency || input.currentEt !== null || hasEpochValue(input);
  // 参数阶段：无阻断即完成（历元问题算在基准阶段，不重复计）
  const paramsDone = input.paramIssues.length === 0;
  const upstreamDone = !input.needsUpstreamRecord;

  const done: Record<SopStageKey, boolean> = {
    basis: basisDone,
    task: input.schemaFields.length > 0,
    params: paramsDone && upstreamDone,
    run: input.hasResult,
    review: input.hasResult,
    catalog: input.inCatalog,
    scenario: input.pinnedCount > 0,
  };

  const current = SOP_STAGES.find((key) => !done[key]) ?? "scenario";
  return {
    stages: SOP_STAGES.map((key) => ({ key, done: done[key], current: key === current })),
    current,
    blockers: runBlockers(input),
  };
}
