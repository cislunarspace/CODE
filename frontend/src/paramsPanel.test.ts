import { describe, it, expect } from "vitest";
import { getFieldApplicability } from "./paramOverlay";

describe("ParamsPanel 与 Schema 适用性（#401）", () => {
  it("design_orbit 在 HALO 下适用字段包含 10 个公共参数 + 4 个 HALO 特有参数", () => {
    const fields = getFieldApplicability("design_orbit", "HALO");
    expect(fields).toContain("orbit_type");
    expect(fields).toContain("amplitude");
    expect(fields).toContain("phase");
    expect(fields).toContain("collinear_point");
    expect(fields).toContain("north_south");
    expect(fields).toContain("duration");
    expect(fields).toContain("output_step");
    expect(fields).toContain("correction_method");
    expect(fields.length).toBeGreaterThanOrEqual(14);
  });

  it("design_orbit 在 ELFO 下适用字段包含半长轴、倾角、近月点幅角", () => {
    const fields = getFieldApplicability("design_orbit", "ELFO");
    expect(fields).toContain("semi_major_axis");
    expect(fields).toContain("inclination");
    expect(fields).toContain("arg_of_pericenter");
  });
});