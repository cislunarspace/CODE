import { describe, it, expect } from "vitest";
import {
  UNIT_DEFINITIONS,
  convertValue,
  toStandardValue,
  getBranchDefaults,
  ENUM_OPTIONS,
  BRANCH_TYPE_OPTIONS,
  DESIGN_ORBIT_BRANCH_DEFAULTS,
  FAMILY_BRANCH_DEFAULTS,
  formatRangePrompt,
  getFieldApplicability,
  withParamDefaults,
  TU_SECONDS,
} from "./index";
import type { ToolSchema } from "../schema";

describe("参数覆写层 (paramOverlay)", () => {
  it("17 个单位字段正确注册且首项为标准单位 (toStandard = 1.0)", () => {
    const fields = Object.keys(UNIT_DEFINITIONS);
    expect(fields.length).toBeGreaterThanOrEqual(17);
    for (const field of fields) {
      const units = UNIT_DEFINITIONS[field];
      expect(units.length).toBeGreaterThanOrEqual(2);
      expect(units[0].toStandard).toBe(1.0);
    }
  });

  it("单位换算正确：km <-> m <-> DU", () => {
    // amplitude: km 为标准单位
    // amplitude: km is the standard unit.
    expect(convertValue("amplitude", 384400, "km", "DU")).toBeCloseTo(1.0, 6);
    expect(convertValue("amplitude", 1.0, "DU", "km")).toBeCloseTo(384400, 4);
    expect(convertValue("amplitude", 50, "km", "m")).toBe(50000);
    expect(convertValue("amplitude", 50000, "m", "km")).toBe(50);
  });

  it("时间单位换算正确：年 <-> 月 <-> 日 <-> 秒 <-> TU", () => {
    // 相对换算（任意两单位互转）不受标准单位选择影响
    // Relative conversions between any two units stay independent of the standard choice.
    expect(convertValue("duration", 1.0, "年", "月")).toBeCloseTo(12.0, 4);
    expect(convertValue("duration", 1.0, "月", "年")).toBeCloseTo(1 / 12, 6);
    expect(convertValue("duration", 365.25, "日", "年")).toBeCloseTo(1.0, 4);
  });

  it("duration 提交值单位为秒（API 契约，修 #478 手测发现的 1 点星历段）", () => {
    // design_orbit/orbit_propagation 的 duration 契约是秒
    // （schema：“传播时长（秒）”）。GUI 以年/月输入，提交时必须换算为秒。
    // The design_orbit/orbit_propagation duration contract is seconds (schema:
    // “传播时长（秒）”). GUI years/months must convert to seconds on submit.
    expect(toStandardValue("duration", 1.0, "月")).toBeCloseTo(2629800, 0); // 365.25/12 天
    expect(toStandardValue("duration", 30, "日")).toBeCloseTo(2592000, 0);
    expect(toStandardValue("duration", 1.0, "年")).toBeCloseTo(365.25 * 86400, 0);
    expect(toStandardValue("duration", 1.0, "时")).toBeCloseTo(3600, 6);
    expect(toStandardValue("duration", 1.0, "TU")).toBeCloseTo(TU_SECONDS, 6);
  });

  it("TU 换算锚定 TU_SECONDS 常量（#438）：output_step 1 TU = TU_SECONDS 秒", () => {
    // TU 秒值收敛为单一常量 TU_SECONDS（对齐 commons.units.TU_SECONDS）；
    // output_step 标准单位为秒，1 TU 应换算为该常量秒数。
    // The TU-in-seconds value lives in the single constant TU_SECONDS (aligned with
    // commons.units.TU_SECONDS); output_step's standard unit is seconds, so 1 TU must
    // convert to exactly that many seconds.
    expect(convertValue("output_step", 1.0, "TU", "秒")).toBeCloseTo(TU_SECONDS, 6);
    expect(convertValue("output_step", TU_SECONDS, "秒", "TU")).toBeCloseTo(1.0, 6);
    // control_interval 标准单位为天，1 TU = TU_SECONDS / 86400 天
    // control_interval's standard unit is days: 1 TU = TU_SECONDS / 86400 days.
    expect(convertValue("control_interval", 1.0, "TU", "天")).toBeCloseTo(TU_SECONDS / 86400, 8);
  });

  it("相位单位换算正确：周期份额 <-> 度 <-> 弧度", () => {
    // phase: 周期份额 (1.0)
    // phase: fraction of the period (1.0).
    expect(convertValue("phase", 0.5, "周期份额", "度")).toBeCloseTo(180, 4);
    expect(convertValue("phase", 180, "度", "周期份额")).toBeCloseTo(0.5, 4);
    expect(convertValue("phase", Math.PI, "弧度", "周期份额")).toBeCloseTo(0.5, 4);
  });

  it("17 种 design_orbit 轨道类型分支默认值齐备", () => {
    const expectedTypes = [
      "HALO", "DRO", "DPO", "NRHO", "LISSAJOUS", "AXIAL",
      "L4", "L5", "L4_SPO", "L5_SPO", "L4_LPO", "L5_LPO",
      "L4_HORSESHOE", "L5_HORSESHOE", "ELFO", "LYAPUNOV", "RO"
    ];
    for (const t of expectedTypes) {
      const defs = getBranchDefaults("design_orbit", t);
      expect(defs).toBeDefined();
      expect(typeof defs).toBe("object");
    }
    // 特征值检查
    // Eigenvalue checks.
    expect(getBranchDefaults("design_orbit", "DRO").amplitude).toBe(60000);
    expect(getBranchDefaults("design_orbit", "HALO").amplitude).toBe(30000);
    expect(getBranchDefaults("design_orbit", "NRHO").perilune_height).toBe(5000);
    expect(getBranchDefaults("design_orbit", "ELFO").semi_major_axis).toBe(6500);
  });

  it("整数枚举映射正确 (collinear_point, north_south, control_mode 等)", () => {
    expect(ENUM_OPTIONS["collinear_point"]).toBeDefined();
    expect(ENUM_OPTIONS["collinear_point"].find((o) => o.value === 2)?.label).toContain("L2");

    expect(ENUM_OPTIONS["north_south"]).toBeDefined();
    expect(ENUM_OPTIONS["north_south"].find((o) => o.value === 1)?.label).toContain("北族");
    expect(ENUM_OPTIONS["north_south"].find((o) => o.value === 2)?.label).toContain("南族");

    expect(ENUM_OPTIONS["control_mode"].length).toBe(6);
  });

  it("范围提示文案格式化正确", () => {
    expect(formatRangePrompt(0, 100, "km")).toBe("可填范围: 0 ~ 100 km");
    expect(formatRangePrompt(0, undefined, "km")).toBe("可填范围: ≥ 0 km");
    expect(formatRangePrompt(undefined, 100, "km")).toBe("可填范围: ≤ 100 km");
    expect(formatRangePrompt(undefined, undefined, "km")).toBe("无范围约束");
  });

  it("design_orbit 字段适用性过滤正确暴露各族核心字段", () => {
    const haloFields = getFieldApplicability("design_orbit", "HALO");
    expect(haloFields).toContain("orbit_type");
    expect(haloFields).toContain("amplitude");
    expect(haloFields).toContain("phase");
    expect(haloFields).toContain("collinear_point");
    expect(haloFields).toContain("north_south");
    expect(haloFields).toContain("epoch");
    expect(haloFields).toContain("duration");
    expect(haloFields).toContain("output_step");
    expect(haloFields).toContain("correction_method");

    const nrhoFields = getFieldApplicability("design_orbit", "NRHO");
    expect(nrhoFields).toContain("perilune_height");
    expect(nrhoFields).toContain("north_south");

    const elfoFields = getFieldApplicability("design_orbit", "ELFO");
    expect(elfoFields).toContain("semi_major_axis");
    expect(elfoFields).toContain("inclination");
    expect(elfoFields).toContain("arg_of_pericenter");
  });

  it("分支键类型预置下拉与分支默认值一一对应：design_orbit 17 项、轨道族生成 8 项", () => {
    // 顺序是展示顺序，不与默认值表键序绑定；只约束覆盖一致
    // Dropdown order is presentation-only; assert coverage, not order.
    expect([...BRANCH_TYPE_OPTIONS["design_orbit"]].map((o) => o.value).sort()).toEqual(
      Object.keys(DESIGN_ORBIT_BRANCH_DEFAULTS).sort()
    );
    expect([...BRANCH_TYPE_OPTIONS["orbit_family_generation"]].map((o) => o.value).sort()).toEqual(
      Object.keys(FAMILY_BRANCH_DEFAULTS).sort()
    );
    // transfer_design 不在列：transfer_type 已有 ENUM_OPTIONS 下拉
    // transfer_design is not listed: its transfer_type already has an ENUM_OPTIONS dropdown.
    expect(BRANCH_TYPE_OPTIONS["transfer_design"]).toBeUndefined();
  });

  it("withParamDefaults 填模型默认值与分支默认值，不覆盖已填值", () => {
    const schema = {
      properties: {
        orbit_type: { type: "string" },
        epoch: { default: [2024, 1, 1, 0, 0, 0.0] },
        output_step: { default: 3600.0 },
        duration: { default: null },
        amplitude: { type: "number" },
      },
      required: ["orbit_type"],
    } as unknown as ToolSchema;

    const filled = withParamDefaults("design_orbit", schema, {}, "orbit_type", "HALO")!;
    expect(filled.orbit_type).toBe("HALO");
    // 模型默认值（schema default）
    // Model defaults (schema `default`).
    expect(filled.epoch).toEqual([2024, 1, 1, 0, 0, 0.0]);
    expect(filled.output_step).toBe(3600.0);
    // 分支默认值
    // Branch defaults.
    expect(filled.amplitude).toBe(30000);
    expect(filled.phase).toBe(0.0);
    // null 默认不填，留给上游按轨道类型补
    // A null default is not filled; upstream fills it per orbit type.
    expect("duration" in filled).toBe(false);

    // 已填值不被覆盖
    // Entered values are never overwritten.
    const kept = withParamDefaults("design_orbit", schema, { amplitude: 12345 }, "orbit_type", "HALO")!;
    expect(kept.amplitude).toBe(12345);

    // 无可填项时返回 null
    // Returns null when nothing changed.
    expect(withParamDefaults("design_orbit", schema, filled, "orbit_type", "HALO")).toBeNull();
  });

  it("withParamDefaults 不给无 orbit_type 的工具塞分支键，但仍填模型默认值", () => {
    const schema = {
      properties: { num_monte_carlo: { default: 5 } },
    } as unknown as ToolSchema;
    const filled = withParamDefaults("control_orbit", schema, {}, "orbit_type", "HALO")!;
    expect(filled).toEqual({ num_monte_carlo: 5 });
  });
});
describe("转移设计类型联动 (transfer_design)", () => {
  it("四种 transfer_type 的适用字段：HMN 显目标半径，LGA/WSB 显搜索参数且都不显 target_ephemeris（由 GUI 注入）", () => {
    const hmn = getFieldApplicability("transfer_design", "HMN");
    expect(hmn).toContain("target_orbit_radius_km");
    expect(hmn).not.toContain("lga_search_params");

    const lga = getFieldApplicability("transfer_design", "LGA");
    expect(lga).toContain("lga_search_params");
    expect(lga).not.toContain("target_orbit_radius_km");
    expect(lga).not.toContain("target_ephemeris");

    const wsb = getFieldApplicability("transfer_design", "WSB");
    expect(wsb).toContain("wsb_search_params");
    expect(wsb).not.toContain("target_ephemeris");

    for (const fields of [hmn, lga, wsb]) {
      for (const common of ["transfer_type", "tli_epoch", "parking_alt_km", "incl_deg", "flight_path_deg", "tof_range"]) {
        expect(fields).toContain(common);
      }
    }
  });

  it("HMN 分支默认值：transfer_type 自身 + 地心目标半径取地月平均距离", () => {
    expect(getBranchDefaults("transfer_design", "HMN")).toEqual({
      transfer_type: "HMN",
      target_orbit_radius_km: 384400,
    });
  });

  it("ENUM_OPTIONS.transfer_type 提供五项中文标签（5.9.7 起含 PCN）", () => {
    expect(ENUM_OPTIONS.transfer_type.map((o) => o.value)).toEqual([
      "HMN",
      "LGA",
      "WSB",
      "low_thrust",
      "PCN",
    ]);
  });

  it("PCN 分支默认值：transfer_type 自身 + 搜索用 tof_range；目标参数化不给默认", () => {
    // bplane_target / departure_asymptote 互斥，默认任一侧都会让另一侧
    // 变成静默不可达的错支，必须由用户选。
    // bplane_target / departure_asymptote are mutually exclusive; defaulting
    // either one silently makes the other the wrong branch, so the user picks.
    expect(getBranchDefaults("transfer_design", "PCN")).toEqual({
      transfer_type: "PCN",
      tof_range: [3, 6],
    });
  });

  it("PCN 适用字段：两个目标参数化都渲染，公共字段照旧，不显 target_ephemeris", () => {
    const pcn = getFieldApplicability("transfer_design", "PCN");
    expect(pcn).toContain("bplane_target");
    expect(pcn).toContain("departure_asymptote");
    expect(pcn).not.toContain("target_orbit_radius_km");
    expect(pcn).not.toContain("lga_search_params");
    expect(pcn).not.toContain("target_ephemeris");
    for (const common of ["transfer_type", "tli_epoch", "parking_alt_km", "incl_deg", "flight_path_deg", "tof_range"]) {
      expect(pcn).toContain(common);
    }
  });
});

describe("e2m2e 5.9.7 新能力接入", () => {
  it("design_orbit 新增 LYAPUNOV / RO 分支：下拉、默认值与适用字段齐备", () => {
    const values = BRANCH_TYPE_OPTIONS["design_orbit"].map((o) => o.value);
    expect(values).toContain("LYAPUNOV");
    expect(values).toContain("RO");

    // LYAPUNOV 供平动点与振幅；RO 只给共振比、相位与实测可收敛的短弧画像
    //（amplitude 留空 = 精确共振成员，上游 RO 星历冒烟同口径）
    // LYAPUNOV carries the libration point and amplitude; RO gives only the
    // resonance pair, phase, and the short-arc profile measured to converge (an
    // empty amplitude selects the exact member, as in upstream's RO ephemeris smoke).
    expect(getBranchDefaults("design_orbit", "LYAPUNOV")).toEqual({
      amplitude: 12000,
      phase: 0.0,
      collinear_point: 2,
    });
    expect(getBranchDefaults("design_orbit", "RO")).toEqual({
      resonance_p: 4,
      resonance_q: 1,
      phase: 0.0,
      duration: 300000,
      output_step: 36000,
    });
    expect("amplitude" in getBranchDefaults("design_orbit", "RO")).toBe(false);

    expect(getFieldApplicability("design_orbit", "LYAPUNOV")).toContain("amplitude");
    expect(getFieldApplicability("design_orbit", "LYAPUNOV")).toContain("collinear_point");
    const ro = getFieldApplicability("design_orbit", "RO");
    expect(ro).toContain("resonance_p");
    expect(ro).toContain("resonance_q");
    expect(ro).toContain("amplitude");
  });

  it("ENUM_OPTIONS.transform_type 覆盖六个变换对（含 EPPR）", () => {
    expect(ENUM_OPTIONS.transform_type.map((o) => o.value)).toEqual([
      "synodic_to_j2000",
      "j2000_to_synodic",
      "j2000_to_eppr",
      "eppr_to_j2000",
      "gcrs_to_ebcrs",
      "ebcrs_to_gcrs",
    ]);
  });
});
