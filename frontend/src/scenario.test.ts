// scenario 单测（#429）：格式往返、版本拒绝、历元二表示、记录解析的
// 跳过/截断软失败路径。
// scenario tests (#429): format round-trip, version refusal, the two epoch
// spellings, and the skip/truncate soft-failure paths of record resolution.

import { describe, it, expect } from "vitest";
import {
  SCENARIO_FORMAT,
  SCENARIO_VERSION,
  DEFAULT_PLAYBACK,
  serializeScenario,
  parseScenario,
  resolveScenarioRecords,
  type ScenarioContent,
} from "./scenario";

const SAMPLE_ET = 800_000_123.5;
const SAMPLE: ScenarioContent = {
  records: ["rec-1", "rec-2"],
  referenceEpoch: { et: SAMPLE_ET },
  playback: { rate: 86400, loop: false, startOffsetEt: 0 },
};

describe("serializeScenario / parseScenario 往返（#429）", () => {
  it("保存→打开逐字段复原（固定层记录集、参考历元、播放配置）", () => {
    const text = serializeScenario(SAMPLE);
    const parsed = parseScenario(text);
    expect("error" in parsed && parsed.error).toBeFalsy();
    if ("scenario" in parsed) {
      expect(parsed.scenario.records).toEqual(SAMPLE.records);
      expect(parsed.scenario.referenceEt).toBe(SAMPLE_ET);
      expect(parsed.scenario.playback).toEqual(SAMPLE.playback);
    }
  });

  it("顶层带格式标识与版本", () => {
    const obj = JSON.parse(serializeScenario(SAMPLE));
    expect(obj.format).toBe(SCENARIO_FORMAT);
    expect(obj.version).toBe(SCENARIO_VERSION);
  });

  it("参考历元的 UTC 表示可打开（解析到同一 et 基准）", () => {
    const text = serializeScenario({
      records: ["rec-1"],
      referenceEpoch: { utc: "2026-09-01T12:00:00" },
      playback: DEFAULT_PLAYBACK,
    });
    const parsed = parseScenario(text);
    expect("scenario" in parsed).toBe(true);
    if ("scenario" in parsed) {
      // 与前端 etFromEpoch 同一换算（UTC 显示口径，忽略 ~69s 时标偏差）
      // The same conversion as the frontend etFromEpoch (UTC display
      // convention, the ~69 s timescale offset ignored).
      expect(parsed.scenario.referenceEt).toBe(Date.parse("2026-09-01T12:00:00Z") / 1000 - 946728000);
    }
  });
});

describe("parseScenario 拒绝路径（#429）", () => {
  it("未知版本号拒绝加载并给出升级提示", () => {
    const text = serializeScenario(SAMPLE).replace('"version": 1', '"version": 99');
    const parsed = parseScenario(text);
    expect("error" in parsed).toBe(true);
    if ("error" in parsed) expect(parsed.error).toContain("未知情景版本 99");
  });

  it("非情景文件（format 标识不符）拒绝", () => {
    const parsed = parseScenario(JSON.stringify({ format: "other", version: 1 }));
    expect("error" in parsed).toBe(true);
  });

  it("坏 JSON、缺三块之一、历元两表示皆缺、字段类型错都明确报错", () => {
    expect("error" in parseScenario("not json")).toBe(true);
    // 缺块用结构操作（parse→delete→stringify），不依赖序列化空格细节
    // Missing blocks use structural edits (parse→delete→stringify), not
    // whitespace-sensitive text surgery.
    const dropBlock = (key: string) => {
      const obj = JSON.parse(serializeScenario(SAMPLE));
      delete obj[key];
      return JSON.stringify(obj);
    };
    expect("error" in parseScenario(dropBlock("records"))).toBe(true);
    expect("error" in parseScenario(dropBlock("referenceEpoch"))).toBe(true);
    expect("error" in parseScenario(dropBlock("playback"))).toBe(true);

    const badEpoch = serializeScenario({ ...SAMPLE, referenceEpoch: {} as never });
    expect("error" in parseScenario(badEpoch)).toBe(true);
    const badRate = serializeScenario({
      ...SAMPLE,
      playback: { ...SAMPLE.playback, rate: -1 },
    });
    expect("error" in parseScenario(badRate)).toBe(true);
  });

  it("playback 字段缺省取默认值（rate=86400/loop=true/offset=0）", () => {
    const obj = JSON.parse(serializeScenario(SAMPLE));
    obj.playback = {};
    const parsed = parseScenario(JSON.stringify(obj));
    expect("scenario" in parsed).toBe(true);
    if ("scenario" in parsed) expect(parsed.scenario.playback).toEqual(DEFAULT_PLAYBACK);
  });
});

describe("resolveScenarioRecords 软失败（#429）", () => {
  const mk = (id: string) => ({ recordId: id, label: id, data: { trajectories: [], times: [] } });

  it("全部可解析：顺序保留", async () => {
    const r = await resolveScenarioRecords(["a", "b"], 5, async (id) => mk(id));
    expect(r.resolved.map((x) => x.recordId)).toEqual(["a", "b"]);
    expect(r.missing).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("缺失记录（返回 null 或抛错）跳过并列出，其余照常加载", async () => {
    const r = await resolveScenarioRecords(["a", "gone", "b"], 5, async (id) => {
      if (id === "gone") return null;
      return mk(id);
    });
    expect(r.resolved.map((x) => x.recordId)).toEqual(["a", "b"]);
    expect(r.missing).toEqual(["gone"]);

    const r2 = await resolveScenarioRecords(["a", "boom"], 5, async (id) => {
      if (id === "boom") throw new Error("record deleted");
      return mk(id);
    });
    expect(r2.missing).toEqual(["boom"]);
    expect(r2.resolved.map((x) => x.recordId)).toEqual(["a"]);
  });

  it("超过固定层上限截断到上限，未尝试的 id 不进 missing", async () => {
    const r = await resolveScenarioRecords(["a", "b", "c"], 2, async (id) => mk(id));
    expect(r.resolved.map((x) => x.recordId)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("缺失不占上限名额（截断按实际解析数计）", async () => {
    const r = await resolveScenarioRecords(["gone", "a", "b"], 2, async (id) =>
      id === "gone" ? null : mk(id),
    );
    expect(r.resolved.map((x) => x.recordId)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(false);
    expect(r.missing).toEqual(["gone"]);
  });
});
