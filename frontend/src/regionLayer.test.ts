// regionLayer 解析测试：km → DU 归一、圆心吸附、(a,e) 元素过滤。
// regionLayer parsing tests: km → DU normalization, center snapping, (a,e) filtering.

import { describe, expect, it } from "vitest";
import { boundariesResponseToRegionLayer } from "./regionLayer";
import { DU_KM } from "./cr3bp";

const MU = 0.01215058560962404;
const MOON_X_KM = (1 - 0.012150585350562453) * 383397.7725; // 后端 Primer 口径月心

describe("boundariesResponseToRegionLayer（#432）", () => {
  it("圆元素：km→DU 归一并把月心圆吸附到画布月球位置", () => {
    const radiusKm = 61364.0;
    const region = boundariesResponseToRegionLayer(
      {
        elements: [
          {
            kind: "circle",
            label: "Moon Hill sphere rho_H",
            formula_id: "Eq.110",
            center_km: [MOON_X_KM, 0, 0],
            radius_km: radiusKm,
            points_km: [
              [MOON_X_KM + radiusKm, 0, 0],
              [MOON_X_KM, radiusKm, 0],
              [MOON_X_KM - radiusKm, 0, 0],
              [MOON_X_KM, -radiusKm, 0],
              [MOON_X_KM + radiusKm, 0, 0],
            ],
          },
        ],
      },
      MU,
    );
    expect(region).toHaveLength(1);
    expect(region[0].kind).toBe("circle");
    expect(region[0].centerDU[0]).toBeCloseTo(1 - MU, 12); // 吸附到画布月球
    expect(region[0].radiusDU).toBeCloseTo(radiusKm / DU_KM, 12);
    // 点列随圆心平移：首点 = 吸附圆心 + 半径（+x 方向）
    expect(region[0].pointsDU![0][0]).toBeCloseTo(1 - MU + radiusKm / DU_KM, 12);
    expect(region[0].formulaId).toBe("Eq.110");
  });

  it("地心圆吸附到原点", () => {
    const region = boundariesResponseToRegionLayer(
      {
        elements: [
          {
            kind: "circle",
            label: "Laplace radius r_L (geolunar)",
            center_km: [-0.012150585350562453 * 383397.7725, 0, 0],
            radius_km: 48812.4,
            points_km: [
              [0, 48812.4, 0],
              [48812.4, 0, 0],
              [0, -48812.4, 0],
            ],
          },
        ],
      },
      MU,
    );
    expect(region[0].centerDU).toEqual([0, 0, 0]);
  });

  it("Battin 非对称闭合曲线按 polyline 平移", () => {
    const region = boundariesResponseToRegionLayer(
      {
        elements: [
          {
            kind: "polyline",
            label: "Moon Battin SOI rho_B(psi)",
            center_km: [MOON_X_KM, 0, 0],
            radius_km: 66010.4,
            points_km: [
              [MOON_X_KM + 64201.3, 0, 0],
              [MOON_X_KM, 66010.4, 0],
              [MOON_X_KM - 52008.7, 0, 0],
              [MOON_X_KM + 64201.3, 0, 0],
            ],
          },
        ],
      },
      MU,
    );
    expect(region[0].kind).toBe("polyline");
    // 背地最远点平移后仍距画布月球最远
    const first = region[0].pointsDU![0];
    expect(first[0] - (1 - MU)).toBeCloseTo(64201.3 / DU_KM, 12);
  });

  it("点标记（平动点）保持绝对位置不吸附", () => {
    const l3x = -1.198 * DU_KM;
    const region = boundariesResponseToRegionLayer(
      {
        elements: [
          { kind: "point", label: "L3", center_km: [l3x, 0, 0] },
          { kind: "point", label: "L4", center_km: [MOON_X_KM / 2, 0, 0] },
        ],
      },
      MU,
    );
    expect(region).toHaveLength(2);
    expect(region[0].centerDU[0]).toBeCloseTo(-1.198, 12); // 不吸附到任何天体
    expect(region[1].centerDU[0]).toBeCloseTo(MOON_X_KM / 2 / DU_KM, 12);
  });

  it("(a,e) 根数空间元素与缺圆心的元素被跳过", () => {
    const region = boundariesResponseToRegionLayer(
      {
        elements: [
          { kind: "curve_ae", label: "Earth grazing", points_ae: [[100000, 0.5]] },
          { kind: "vertical_ae", label: "5:1☾", a_km: 131122 },
          { kind: "circle", label: "broken", radius_km: 1 },
        ],
      },
      MU,
    );
    expect(region).toHaveLength(0);
  });

  it("空响应返回空图层", () => {
    expect(boundariesResponseToRegionLayer({}, MU)).toEqual([]);
  });
});
