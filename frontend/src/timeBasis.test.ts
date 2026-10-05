// 时间基准换算测试（et 秒 ↔ 历元/JD/UTC 标签）。
// Time-basis conversion tests (et seconds ↔ epoch/JD/UTC labels).

import { describe, expect, it } from "vitest";
import { etFromEpoch, etFromJdTdb, etToJd, etToUtcLabel, JD_J2000 } from "./timeBasis";

describe("timeBasis 时间基准换算（#421）", () => {
  it("J2000（JD_TDB 2451545.0）→ et 0", () => {
    expect(etFromEpoch(2451545.0)).toBe(0);
    expect(etFromJdTdb(JD_J2000)).toBe(0);
  });

  it("JD_TDB 数 → et 秒线性换算", () => {
    // 一天 = 86400 秒
    // One day = 86400 seconds.
    expect(etFromJdTdb(2451546.0)).toBeCloseTo(86400, 6);
    expect(etToJd(86400)).toBeCloseTo(2451546.0, 9);
  });

  it("ISO UTC 字符串 → et，且 etToUtcLabel 往返一致", () => {
    const et = etFromEpoch("2025-06-21T11:00:00");
    expect(Number.isFinite(et)).toBe(true);
    expect(etToUtcLabel(et)).toBe("2025-06-21 11:00:00");
  });

  it("非法输入返回 NaN", () => {
    expect(Number.isNaN(etFromEpoch("not-a-date"))).toBe(true);
    expect(Number.isNaN(etFromEpoch(NaN))).toBe(true);
    expect(etToUtcLabel(NaN)).toBe("—");
  });
});
