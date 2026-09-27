import { describe, it, expect } from "vitest";
import { validateToolParams, type ParamIssue } from "./index";
import type { ToolSchema, SchemaProperty } from "../schema";
// 条件校验的分档值域来自真实 schema（amplitude 全局包络 vs 按轨道类型收窄）
// The conditional domains come from the real schemas (the global amplitude envelope vs the per-orbit-type narrowing).
import designOrbitSchemaJson from "../toolSchemas/design_orbit.json";
import transferSchemaJson from "../toolSchemas/transfer_design.json";

const designOrbitSchema = designOrbitSchemaJson as unknown as ToolSchema;
const transferSchema = transferSchemaJson as unknown as ToolSchema;

// 最小 schema：必填枚举 + 可空数值（anyOf 分支携带范围，与真实 schema 同构）
// + 整数独占上界 + 仅独占下界的普通数值字段
// Minimal schema: required enum + nullable number (anyOf branch carries the range, isomorphic to the real
// schema) + an integer with an exclusive upper bound + a plain number with only an exclusive lower bound.
const schema: ToolSchema = {
  required: ["orbit_type", "amplitude"],
  properties: {
    orbit_type: { type: "string", title: "Orbit Type", enum: ["HALO", "NRHO"] },
    amplitude: {
      title: "Amplitude",
      anyOf: [
        { type: "number", minimum: -110000, maximum: 200000 } as SchemaProperty,
        { type: "null" },
      ],
    },
    n_revs: { type: "integer", title: "N Revs", minimum: 1, exclusiveMaximum: 10 },
    phase: { type: "number", title: "Phase", exclusiveMinimum: 0 },
  },
};

const OK_VALUES = { orbit_type: "HALO", amplitude: 5000, n_revs: 5, phase: 0.1 };

function reasons(toolName: string, values: Record<string, unknown>): string[] {
  return validateToolParams(toolName, schema, values).map((i: ParamIssue) => i.reason);
}

describe("validateToolParams", () => {
  it("必填字段缺失或空串报必填，可空字段缺省不报", () => {
    const rs = reasons("generic_tool", { amplitude: 1000 });
    expect(rs.some((r) => r.includes("必填"))).toBe(true);
    // phase 非必填、未填 → 不报
    // phase is optional and unfilled → no error.
    expect(rs.every((r) => !r.includes("Phase"))).toBe(true);
    expect(reasons("generic_tool", { ...OK_VALUES, orbit_type: "" }).some((r) => r.includes("必填"))).toBe(true);
  });

  it("anyOf 分支的 minimum/maximum 参与越界校验，恰在边界通过", () => {
    expect(reasons("generic_tool", { ...OK_VALUES, amplitude: 250000 })[0]).toContain("超出可填范围");
    expect(reasons("generic_tool", { ...OK_VALUES, amplitude: -120000 })[0]).toContain("超出可填范围");
    expect(validateToolParams("generic_tool", schema, { ...OK_VALUES, amplitude: 200000 })).toEqual([]);
    expect(validateToolParams("generic_tool", schema, { ...OK_VALUES, amplitude: -110000 })).toEqual([]);
  });

  it("独占边界：等于边界值报错，紧邻边界通过", () => {
    expect(reasons("generic_tool", { ...OK_VALUES, n_revs: 10 })[0]).toContain("超出可填范围");
    expect(reasons("generic_tool", { ...OK_VALUES, phase: 0 })[0]).toContain("超出可填范围");
    expect(validateToolParams("generic_tool", schema, { ...OK_VALUES, n_revs: 9 })).toEqual([]);
    expect(validateToolParams("generic_tool", schema, { ...OK_VALUES, phase: 0.001 })).toEqual([]);
  });

  it("全部合法返回空列表", () => {
    expect(validateToolParams("generic_tool", schema, OK_VALUES)).toEqual([]);
  });

  it("问题条目携带字段名与人读标签", () => {
    const issues = validateToolParams("generic_tool", schema, { amplitude: 999999 });
    expect(issues[0].field).toBe("orbit_type");
    expect(issues[0].label).toBe("Orbit Type");
    expect(issues.some((i) => i.field === "amplitude" && i.label === "Amplitude")).toBe(true);
  });
});

// 条件校验（5.9.7 接入的上游分档值域）：静态 schema 只有全局包络
// （amplitude 全类 [-110000, 350000]），按分支收窄的约束在此覆盖。
// Conditional checks (the per-branch upstream domains wired in 5.9.7): the static
// schema only carries the global envelope (amplitude spans [-110000, 350000] over
// every type), so the per-branch narrowing is covered here.
function designIssues(values: Record<string, unknown>): ParamIssue[] {
  return validateToolParams("design_orbit", designOrbitSchema, values);
}

function issueFor(issues: ParamIssue[], field: string): ParamIssue | undefined {
  return issues.find((i) => i.field === field);
}

describe("validateToolParams 条件校验：design_orbit 振幅分档", () => {
  it("HALO 振幅上限按平动点分档：L1 ±26908，L2 ±77000", () => {
    // 30000 落在全局包络内、却是 L1 越界：只有分档校验能拦下
    // 30000 sits inside the global envelope yet is out of range for L1: only the
    // per-branch check catches it.
    expect(issueFor(designIssues({ orbit_type: "HALO", collinear_point: 1, amplitude: 30000 }), "amplitude")?.reason).toContain(
      "L1 HALO 振幅范围"
    );
    expect(designIssues({ orbit_type: "HALO", collinear_point: 1, amplitude: 26908 })).toEqual([]);
    expect(designIssues({ orbit_type: "HALO", collinear_point: 1, amplitude: -26908 })).toEqual([]);
    expect(designIssues({ orbit_type: "HALO", collinear_point: 2, amplitude: 30000 })).toEqual([]);
    expect(issueFor(designIssues({ orbit_type: "HALO", collinear_point: 2, amplitude: 80000 }), "amplitude")?.reason).toContain(
      "L2 HALO 振幅范围"
    );
    // 缺省平动点按 L2（上游默认）
    // A missing libration point defaults to L2 (upstream default).
    expect(designIssues({ orbit_type: "HALO", amplitude: 70000 })).toEqual([]);
  });

  it("HALO / NRHO / LYAPUNOV 的共线平动点只接受 1 或 2", () => {
    // 表单下拉含 3 (L3)，上游会以 ValueError 拒收，这里前置拦下
    // The form dropdown offers 3 (L3); upstream rejects it with a ValueError, so
    // catch it before submit.
    const halo = issueFor(designIssues({ orbit_type: "HALO", collinear_point: 3 }), "collinear_point");
    expect(halo?.reason).toContain("只支持 1 (L1) 或 2 (L2)");
    expect(issueFor(designIssues({ orbit_type: "NRHO", collinear_point: 3 }), "collinear_point")?.reason).toContain("NRHO");
    expect(issueFor(designIssues({ orbit_type: "LYAPUNOV", collinear_point: 3 }), "collinear_point")?.reason).toContain(
      "LYAPUNOV"
    );
  });

  it("LYAPUNOV 振幅 5000~60000", () => {
    expect(issueFor(designIssues({ orbit_type: "LYAPUNOV", collinear_point: 2, amplitude: 4000 }), "amplitude")?.reason).toContain(
      "LYAPUNOV 振幅范围"
    );
    expect(designIssues({ orbit_type: "LYAPUNOV", collinear_point: 1, amplitude: 5000 })).toEqual([]);
    expect(designIssues({ orbit_type: "LYAPUNOV", collinear_point: 2, amplitude: 60000 })).toEqual([]);
    expect(issueFor(designIssues({ orbit_type: "LYAPUNOV", amplitude: 61000 }), "amplitude")).toBeDefined();
  });

  it("RO 共振比只接受 2:1 / 3:1 / 3:2 / 4:1 / 4:3，振幅 145000~340000", () => {
    for (const [p, q] of [[2, 1], [3, 1], [3, 2], [4, 1], [4, 3]]) {
      expect(designIssues({ orbit_type: "RO", resonance_p: p, resonance_q: q })).toEqual([]);
    }
    const bad = issueFor(designIssues({ orbit_type: "RO", resonance_p: 4, resonance_q: 2 }), "resonance_p");
    expect(bad?.reason).toContain("不支持的共振比 4:2");
    expect(bad?.reason).toContain("3:1");
    // 振幅留空 = 精确共振成员，不校验
    // An empty amplitude selects the exact member and is not range-checked.
    expect(issueFor(designIssues({ orbit_type: "RO", resonance_p: 3, resonance_q: 1, amplitude: 100000 }), "amplitude")?.reason).toContain(
      "RO 振幅范围"
    );
    expect(designIssues({ orbit_type: "RO", resonance_p: 3, resonance_q: 1, amplitude: 145000 })).toEqual([]);
    expect(designIssues({ orbit_type: "RO", resonance_p: 3, resonance_q: 1, amplitude: 340000 })).toEqual([]);
  });

  it("分档只作用于对应轨道类型：DRO 沿用全局包络，RO 的共振校验不误伤", () => {
    expect(designIssues({ orbit_type: "DRO", amplitude: 30000 })).toEqual([]);
    expect(designIssues({ orbit_type: "AXIAL", amplitude: -60000 })).toEqual([]);
    // 非 design_orbit 工具不受影响
    // Other tools are unaffected.
    expect(validateToolParams("generic_tool", schema, OK_VALUES)).toEqual([]);
  });
});

describe("validateToolParams 条件校验：transfer_design PCN", () => {
  // tli_epoch 是 schema 必填，是唯一与条件校验无关的噪音项
  // tli_epoch is required by the schema: the only noise unrelated to the conditional checks.
  const PCN = { transfer_type: "PCN", tli_epoch: [2026, 1, 1, 0, 0, 0], tof_range: [3, 6] };

  it("分支解析认 transfer_type（旧实现只认 orbit_type，PCN 专属校验从不触发）", () => {
    // 都空时唯一的问题必须来自 PCN 异或校验——若分支仍被解析成 HMN，
    // 这里会是空列表。
    // With neither target given the only issue must come from the PCN XOR check; if
    // the branch were still resolved as HMN this would be an empty list.
    const issues = validateToolParams("transfer_design", transferSchema, PCN);
    expect(issues.map((i) => i.field)).toEqual(["bplane_target"]);
    expect(issues[0].reason).toContain("须恰给 bplane_target");
  });

  it("bplane_target 与 departure_asymptote 互斥：同填报错挂在 departure_asymptote", () => {
    const issues = validateToolParams("transfer_design", transferSchema, {
      ...PCN,
      bplane_target: { perilune_alt_km: 100, bdot_t_km: 5000 },
      departure_asymptote: { rha_deg: 20, dha_deg: 10, c3_km2_s2: 2.0 },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("departure_asymptote");
    expect(issues[0].reason).toContain("互斥");
  });

  it("恰给一个即通过：对象与 JSON 文本两种形态都认", () => {
    expect(
      validateToolParams("transfer_design", transferSchema, {
        ...PCN,
        bplane_target: { perilune_alt_km: 100, bdot_t_km: 5000, bdot_r_km: 0 },
      })
    ).toEqual([]);
    expect(
      validateToolParams("transfer_design", transferSchema, {
        ...PCN,
        departure_asymptote: '{"rha_deg": 20, "dha_deg": 10, "c3_km2_s2": 2.0}',
      })
    ).toEqual([]);
  });

  it("JSON 文本不可解析或不是对象时报错", () => {
    // ParamsPanel 解析失败时把原文当字符串留下，这里必须拦住
    // ParamsPanel keeps the raw text as a string when parsing fails; catch it here.
    expect(
      validateToolParams("transfer_design", transferSchema, { ...PCN, bplane_target: "not json" })[0].reason
    ).toContain("不是合法 JSON");
    expect(
      validateToolParams("transfer_design", transferSchema, { ...PCN, bplane_target: [1, 2] })[0].reason
    ).toContain("须是 JSON 对象");
    expect(
      validateToolParams("transfer_design", transferSchema, { ...PCN, departure_asymptote: "123" })[0].reason
    ).toContain("须是 JSON 对象");
  });

  it("空对象算填了（上游按必填字段拒绝），这里不重复判字段级必填", () => {
    // bplane_target 的 required 在 $defs 里，前端只判「给了哪一个」
    // bplane_target's required lives in $defs; the form only decides which side was given.
    expect(validateToolParams("transfer_design", transferSchema, { ...PCN, bplane_target: "{}" })).toEqual([]);
  });

  it("非 PCN 分支不校验这两个字段", () => {
    expect(
      validateToolParams("transfer_design", transferSchema, {
        transfer_type: "HMN",
        tli_epoch: [2026, 1, 1, 0, 0, 0],
        target_orbit_radius_km: 384400,
      })
    ).toEqual([]);
    expect(
      validateToolParams("transfer_design", transferSchema, {
        transfer_type: "HMN",
        tli_epoch: [2026, 1, 1, 0, 0, 0],
      }).every((i) => i.field !== "bplane_target")
    ).toBe(true);
  });
});
