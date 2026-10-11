// SOP 判定与运行前硬校验（ADR 0034）：阶段完成情况、当前阶段、阻断项与补救动作。
// SOP derivation and the pre-run gate (ADR 0034): stage completion, the current
// stage, blockers and their remedies.

import { describe, it, expect } from "vitest";
import { deriveSop, isEpochField, needsEpoch, runBlockers, type SopInputs } from "./sop";

/** 默认输入：一个无历元依赖、参数齐备、尚无结果的工具 */
/** Baseline input: a tool without an epoch dependency, complete parameters, no result yet. */
const base = (over: Partial<SopInputs> = {}): SopInputs => ({
  schemaFields: ["orbit_type"],
  requiredFields: ["orbit_type"],
  values: { orbit_type: "HALO" },
  paramIssues: [],
  currentEt: null,
  needsUpstreamRecord: false,
  hasResult: false,
  inCatalog: false,
  pinnedCount: 0,
  ...over,
});

describe("SOP 阶段判定", () => {
  it("无历元依赖的工具：基准阶段自动完成，当前阶段落在求解", () => {
    const sop = deriveSop(base());
    const byKey = Object.fromEntries(sop.stages.map((s) => [s.key, s]));
    expect(byKey.basis.done).toBe(true);
    expect(byKey.task.done).toBe(true);
    expect(byKey.params.done).toBe(true);
    expect(byKey.run.done).toBe(false);
    expect(sop.current).toBe("run");
  });

  it("有历元依赖但时间轴未选时刻：基准未完成，当前阶段是基准", () => {
    const sop = deriveSop(
      base({ schemaFields: ["tli_epoch"], requiredFields: ["tli_epoch"], values: {} }),
    );
    expect(sop.stages[0].key).toBe("basis");
    expect(sop.stages[0].done).toBe(false);
    expect(sop.current).toBe("basis");
  });

  it("参数里写死历元：基准视为完成（不强制走时间轴）", () => {
    const sop = deriveSop(
      base({
        schemaFields: ["epoch"],
        requiredFields: ["epoch"],
        values: { epoch: "2026-01-01T00:00:00Z" },
      }),
    );
    expect(sop.stages[0].done).toBe(true);
  });

  it("结果入库与固定层推进阶段：校核/入库/情景依次完成", () => {
    const sop = deriveSop(base({ hasResult: true, inCatalog: true, pinnedCount: 2 }));
    const byKey = Object.fromEntries(sop.stages.map((s) => [s.key, s]));
    expect(byKey.run.done).toBe(true);
    expect(byKey.review.done).toBe(true);
    expect(byKey.catalog.done).toBe(true);
    expect(byKey.scenario.done).toBe(true);
    expect(sop.current).toBe("scenario");
  });
});

describe("SOP 运行前硬校验", () => {
  it("必备历元未填且时间轴未选时刻：报历元阻断，且不重复报参数阻断", () => {
    const blockers = runBlockers(
      base({
        schemaFields: ["tli_epoch", "transfer_type"],
        requiredFields: ["tli_epoch", "transfer_type"],
        values: { transfer_type: "HMN" },
        paramIssues: [{ field: "tli_epoch", label: "TLI 历元", reason: "必填" }],
      }),
    );
    expect(blockers.map((b) => b.key)).toEqual(["epoch"]);
    expect(blockers[0].fix).toBe("pick-epoch");
    expect(blockers[0].detail).toBe("tli_epoch");
  });

  it("非历元参数缺项：报参数阻断并带字段文案", () => {
    const blockers = runBlockers(
      base({
        paramIssues: [{ field: "n_orbits", label: "轨道圈数", reason: "必填" }],
      }),
    );
    expect(blockers.map((b) => b.key)).toEqual(["params"]);
    expect(blockers[0].detail).toContain("轨道圈数");
    expect(blockers[0].fix).toBe("fill-params");
  });

  it("LGA/WSB 缺上游记录：报上游阻断，给去选记录的动作", () => {
    const blockers = runBlockers(base({ needsUpstreamRecord: true }));
    expect(blockers.map((b) => b.key)).toEqual(["upstream"]);
    expect(blockers[0].fix).toBe("pick-record");
  });

  it("三项同时缺：顺序固定（历元 → 参数 → 上游）", () => {
    const blockers = runBlockers(
      base({
        schemaFields: ["epoch", "n_orbits"],
        requiredFields: ["epoch"],
        values: {},
        paramIssues: [{ field: "n_orbits", label: "轨道圈数", reason: "必填" }],
        needsUpstreamRecord: true,
      }),
    );
    expect(blockers.map((b) => b.key)).toEqual(["epoch", "params", "upstream"]);
  });

  it("时间轴已选时刻：历元阻断解除（参数里不填也算够）", () => {
    const blockers = runBlockers(
      base({
        schemaFields: ["epoch"],
        requiredFields: ["epoch"],
        values: {},
        currentEt: 1234,
      }),
    );
    expect(blockers).toEqual([]);
  });

  it("参数齐备且无上游依赖：无阻断", () => {
    expect(runBlockers(base())).toEqual([]);
  });
});

describe("历元字段识别", () => {
  it("含 epoch 的名字与 JD 口径的 et0_jd 都算历元类", () => {
    expect(isEpochField("tli_epoch")).toBe(true);
    expect(isEpochField("epoch")).toBe(true);
    expect(isEpochField("et0_jd")).toBe(true);
    expect(isEpochField("n_orbits")).toBe(false);
    expect(needsEpoch(["n_orbits"])).toBe(false);
    expect(needsEpoch(["epoch"])).toBe(true);
  });
});
