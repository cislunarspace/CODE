// Jacobi 常数 → colormap 颜色的归一化与采样测试（#435）。
// Normalization and sampling tests for Jacobi-constant → colormap color (#435).

import { describe, expect, it } from "vitest";
import { COOLWARM_STOPS, jacobiColor, jacobiNorm } from "./jacobiColormap";

describe("jacobiNorm 归一化范围（matplotlib _get_jacobi_norm 口径，#435）", () => {
  it("空列表 → (0, 1, 1)", () => {
    expect(jacobiNorm([])).toEqual([0, 1, 1]);
  });

  it("多条取 min/max", () => {
    const [jmin, jmax, jrange] = jacobiNorm([3.1, 2.9, 3.0]);
    expect(jmin).toBe(2.9);
    expect(jmax).toBe(3.1);
    expect(jrange).toBeCloseTo(0.2);
  });

  it("单条 → 防除零（range 取 1.0）", () => {
    expect(jacobiNorm([3.0])).toEqual([3.0, 3.0, 1.0]);
  });

  it("全相等 → 防除零（range 取 1.0）", () => {
    expect(jacobiNorm([3.0, 3.0, 3.0])).toEqual([3.0, 3.0, 1.0]);
  });

  it("undefined 项不参与归一化", () => {
    const [jmin, jmax, jrange] = jacobiNorm([undefined, 3.1, undefined, 2.9]);
    expect(jmin).toBe(2.9);
    expect(jmax).toBe(3.1);
    expect(jrange).toBeCloseTo(0.2);
  });

  it("全 undefined → (0, 1, 1)", () => {
    expect(jacobiNorm([undefined, undefined])).toEqual([0, 1, 1]);
  });
});

describe("jacobiColor coolwarm 采样插值（#435）", () => {
  it("采样表是 coolwarm 蓝端到红端的 9 档", () => {
    expect(COOLWARM_STOPS).toHaveLength(9);
    expect(COOLWARM_STOPS[0]).toBe("#3b4cc0");
    expect(COOLWARM_STOPS[8]).toBe("#b40426");
  });

  it("下端 → 蓝端色，上端 → 红端色", () => {
    expect(jacobiColor(2.9, 2.9, 0.2)).toBe("#3b4cc0");
    expect(jacobiColor(3.1, 2.9, 0.2)).toBe("#b40426");
  });

  it("中点落在中间档附近（浅灰）", () => {
    expect(jacobiColor(3.0, 2.9, 0.2)).toBe(COOLWARM_STOPS[4]);
  });

  it("非档点按相邻两档线性插值", () => {
    // norm=0.15 → pos=1.2：stops[1] (#6282ea) 与 stops[2] (#8db0fe) 八二开混合
    expect(jacobiColor(2.93, 2.9, 0.2)).toBe("#6b8bee");
  });

  it("防除零（jrange=1.0）：全相等时归一化值恒为 0 → 固定蓝端色", () => {
    expect(jacobiColor(3.0, 3.0, 1.0)).toBe("#3b4cc0");
  });
});
