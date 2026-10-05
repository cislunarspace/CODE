import { describe, expect, it } from "vitest";
import { deriv, librationPoint, propagate } from "./cr3bp";

const MU = 0.01215058560962404;
// halo.csv earth-moon_halo_L1_N:000001 的初值与周期
// Initial state and period from halo.csv earth-moon_halo_L1_N:000001.
const SEED = {
  orbitId: "t",
  mu: MU,
  period: 2.1764730139006754,
  state: [
    0.8760656451170601, 1.0491502986863478e-26, 0.191813535688546,
    -3.928226786817226e-14, 0.2305575388925067, 1.0601974505638561e-13,
  ] as [number, number, number, number, number, number],
};

describe("deriv（#397）", () => {
  it("在初值处与 e2m2e equations_of_motion 一致（含科里奥利项）", () => {
    // e2m2e CR3BP_Dynamics.equations_of_motion(0, SEED) 的参考输出
    // Reference output of e2m2e CR3BP_Dynamics.equations_of_motion(0, SEED).
    const expectRef = [
      -3.92822679e-14, 2.30557539e-01, 1.06019745e-13,
      2.91915690e-01, 7.85645357e-14, -4.65526703e-01,
    ];
    const got = deriv(MU, [...SEED.state]);
    got.forEach((v, i) => expect(v).toBeCloseTo(expectRef[i], 8));
  });
});

describe("propagate（#397）", () => {
  it("传播一个周期后回到起点（闭合误差 < 1e-8）", () => {
    const pts = propagate(MU, SEED, 4000);
    const s = pts[pts.length - 1];
    const err = Math.hypot(s[0] - SEED.state[0], s[1] - SEED.state[1], s[2] - SEED.state[2]);
    expect(err).toBeLessThan(1e-8);
  });
});

describe("librationPoint（#397）", () => {
  it("地月 L1/L2 与已知值一致", () => {
    expect(librationPoint(MU, 1)).toBeCloseTo(0.836915, 5);
    expect(librationPoint(MU, 2)).toBeCloseTo(1.155682, 5);
  });
});