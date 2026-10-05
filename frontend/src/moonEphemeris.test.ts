// moonEphemeris 单测（#428 第一步）：请求构造对拍上游 spacetime_convert
// 的输入契约（质心归一固定点 / t_syn 无量纲时间 / et0_jd 参考历元），
// 响应解析的 km→DU 缩放与降级路径，插值边界。
// moonEphemeris tests (#428 step 1): the request payload mirrors the
// upstream spacetime_convert input contract (barycentric normalized fixed
// point / dimensionless t_syn / et0_jd reference epoch); response parsing
// covers the km→DU scaling and degradation paths plus interpolation bounds.

import { describe, it, expect } from "vitest";
import {
  E2M2E_MU,
  moonSampleCount,
  moonTrackRequest,
  moonTrackFromResponse,
  moonPositionAt,
  idealizedMoonTrack,
} from "./moonEphemeris";
import { DU_KM, TU_SECONDS } from "./cr3bp";
import { JD_J2000, SECONDS_PER_DAY } from "./timeBasis";

describe("moonSampleCount（#428）", () => {
  it("每 0.02 TU 一点，含端点", () => {
    // 2 TU 跨度 → 101 点
    expect(moonSampleCount([0, 2 * TU_SECONDS])).toBe(101);
  });

  it("短跨度取下限 64，长跨度封顶 400", () => {
    expect(moonSampleCount([0, 100])).toBe(64);
    expect(moonSampleCount([0, 1000 * 86400])).toBe(400);
  });
});

describe("moonTrackRequest（#428）", () => {
  it("states 是月球会合系固定点（质心归一，速度恒零）", () => {
    const req = moonTrackRequest([0, TU_SECONDS]);
    expect(req.states.length).toBeGreaterThan(0);
    req.states.forEach((s) => {
      expect(s).toEqual([1 - E2M2E_MU, 0, 0, 0, 0, 0]);
    });
    // 上游质量比与画布 mu 同量级（差 ~8e-8，仅自洽性检查）
    expect(E2M2E_MU).toBeCloseTo(0.01215058560962404, 6);
  });

  it("times 是 t_syn（0 = 跨度中点，端点对称），et0_jd 是中点 JD", () => {
    const midEt = 800_000_000;
    const span = 30 * SECONDS_PER_DAY;
    const req = moonTrackRequest([midEt - span / 2, midEt + span / 2]);
    const n = req.times.length;
    expect(req.times[0]).toBeCloseTo(-span / 2 / TU_SECONDS, 9);
    expect(req.times[n - 1]).toBeCloseTo(span / 2 / TU_SECONDS, 9);
    // 中点 t_syn = 0（奇数采样点正中）；et0_jd 与中点 et 互逆
    expect(req.times[Math.floor(n / 2)]).toBeCloseTo(0, 9);
    // JD 是 ~2.4e6 量级的 double，往返 et 的浮点误差 ~2e-4 s；对拍精度
    // 1e-3 s 足够（远低于 SPICE 换算口径）。
    // A JD is a ~2.4e6-magnitude double; the et round-trip floats at ~2e-4 s.
    // 1e-3 s comparison precision suffices (well under SPICE conventions).
    expect((req.et0_jd - JD_J2000) * SECONDS_PER_DAY).toBeCloseTo(midEt, 3);
    expect(req.transform_type).toBe("synodic_to_j2000");
  });

  it("times 与 states 逐点对齐（上游强校验 states/times 等长）", () => {
    const req = moonTrackRequest([0, TU_SECONDS]);
    expect(req.times).toHaveLength(req.states.length);
  });
});

describe("moonTrackFromResponse（#428）", () => {
  it("J2000 地心 km 状态序列 → DU 点列（只取位置）", () => {
    const data = {
      states: [
        [384400, 0, 0, 1, 0, 0],
        [0, -384400, 100, 0, -1, 0],
      ],
      times: [0, 1],
    };
    const track = moonTrackFromResponse(data, [0, 1]);
    expect(track).not.toBeNull();
    expect(track!.points).toEqual([
      [1, 0, 0],
      [0, -1, 100 / DU_KM],
    ]);
    expect(track!.etRange).toEqual([0, 1]);
  });

  it("结构缺失 / 行残缺 / 非有限值 → null（调用方降级为无月球）", () => {
    expect(moonTrackFromResponse(null, [0, 1])).toBeNull();
    expect(moonTrackFromResponse({}, [0, 1])).toBeNull();
    expect(moonTrackFromResponse({ states: [] }, [0, 1])).toBeNull();
    expect(moonTrackFromResponse({ states: [[1, 2]] }, [0, 1])).toBeNull();
    expect(moonTrackFromResponse({ states: [[1, 2, NaN]] }, [0, 1])).toBeNull();
  });
});

describe("moonPositionAt（#428）", () => {
  const track = {
    points: [
      [0, 0, 0],
      [1, 2, 4],
      [2, 4, 8],
    ],
    etRange: [100, 200] as [number, number],
  };

  it("区间内线性插值；采样点正中命中", () => {
    expect(moonPositionAt(track, 100)).toEqual([0, 0, 0]);
    expect(moonPositionAt(track, 150)).toEqual([1, 2, 4]);
    expect(moonPositionAt(track, 200)).toEqual([2, 4, 8]);
    expect(moonPositionAt(track, 125)).toEqual([0.5, 1, 2]);
  });

  it("越界取就近端点（月球是天体参照，不隐藏）；无时刻取中点", () => {
    expect(moonPositionAt(track, 0)).toEqual([0, 0, 0]);
    expect(moonPositionAt(track, 999)).toEqual([2, 4, 8]);
    expect(moonPositionAt(track, null)).toEqual([1, 2, 4]);
  });
});

// 理想化圆月（#477）：relative 钟惯性视图的月球参照——地心 1 DU 圆轨道，
// θ=t（时间轴数值即 TU），θ₀=0 与同屏理想化惯性段严格同约定。
// The idealized circular Moon (#477): the lunar reference for the inertial
// view under the relative clock — a 1 DU geocentric circle with θ=t (the
// timeline values ARE TU), θ₀=0 exactly matching the idealized segments.
describe("idealizedMoonTrack（#477）", () => {
  it("θ=t 圆月：端点 (1,0,0)→(−1,0,0)，跨度即 etRange，带理想化标记", () => {
    const track = idealizedMoonTrack([0, Math.PI])!;
    expect(track.idealized).toBe(true);
    expect(track.etRange).toEqual([0, Math.PI]);
    expect(track.points[0][0]).toBeCloseTo(1, 12);
    expect(track.points[0][1]).toBeCloseTo(0, 12);
    expect(track.points[track.points.length - 1][0]).toBeCloseTo(-1, 12);
    expect(track.points[track.points.length - 1][1]).toBeCloseTo(0, 12);
    expect(track.points.every((p) => Math.abs(Math.hypot(p[0], p[1]) - 1) < 1e-9 && p[2] === 0)).toBe(true);
  });

  it("退化跨度 → null；整周采样点数足够", () => {
    expect(idealizedMoonTrack([2, 2])).toBeNull();
    const full = idealizedMoonTrack([0, 2 * Math.PI])!;
    expect(full.points.length).toBeGreaterThanOrEqual(64);
  });
});
