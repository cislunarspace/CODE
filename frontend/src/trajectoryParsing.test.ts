import { describe, expect, it } from "vitest";
import {
  framesToTrajectoryData,
  familyMembersToTrajectoryData,
  trajectoryTimeRange,
  transferTrajectoryToCanvasData,
  transferCandidateToArcData,
  propagationToCanvasData,
  designEphemerisToCanvasData,
  filterByRole,
  timelineMode,
  timesForMode,
  idealizedInertialGeometry,
  type TimeBasis,
  type DataFrameTag,
} from "./trajectoryParsing";
import { DU_KM } from "./cr3bp";
import { etFromEpoch, etFromJdTdb } from "./timeBasis";

const MU = 0.01215058560962404;

/** 平圆参考轨道一个整周期附近的初态 + 周期，保证传播能闭合。 */
/** An initial state plus period around one full period of a flat circular reference orbit, so propagation closes. */
const SEED = {
  orbitId: "t",
  mu: MU,
  period: 2.16,
  state: [
    0.5, 0.8660254037844386, 0.0,
    -0.8660254037844386, 0.5, 0.0,
  ] as [number, number, number, number, number, number],
};

describe("framesToTrajectoryData 轨迹解析（#412）", () => {
  it("(n,3) 纯位置帧按 shape 解析，不误判为状态序列", () => {
    // 6 个 xyz 点 = 18 个数，18 % 6 === 0，旧逻辑会当成 3 个状态点
    // Six xyz points = 18 numbers; 18 % 6 === 0, so the old logic would have treated it as 3 state points.
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) pts.push(i, i + 10, i + 20);
    const got = framesToTrajectoryData([{ dtype: "f32", shape: [6, 3], data: pts }], {}, MU);
    expect(got.trajectories).toHaveLength(1);
    expect(got.trajectories[0]).toHaveLength(6);
    expect(got.trajectories[0][0]).toEqual([0, 10, 20]);
  });

  it("CR3BP 帧产物逐条标注数据系 synodic_nd（#431）", () => {
    const got = framesToTrajectoryData(
      [
        { dtype: "f32", shape: [2, 3], data: [0, 1, 2, 3, 4, 5] },
        { dtype: "f32", shape: [2, 3], data: [6, 7, 8, 9, 10, 11] },
      ],
      {},
      MU,
    );
    expect(got.frames).toEqual(["synodic_nd", "synodic_nd"]);
  });

  it("(1,6) 初态帧有 period 时传播整条轨迹，时刻按 period 均匀合成", () => {
    const got = framesToTrajectoryData(
      [{ dtype: "f32", shape: [1, 6], data: [...SEED.state] }],
      { orbits: [{ period: SEED.period }], mu: MU },
      MU,
    );
    expect(got.trajectories).toHaveLength(1);
    expect(got.trajectories[0].length).toBeGreaterThan(100);
    const t = got.times[0];
    expect(t).toHaveLength(got.trajectories[0].length);
    expect(t[0]).toBeCloseTo(0, 10);
    expect(t[t.length - 1]).toBeCloseTo(SEED.period, 10);
  });

  it("(1,6) 初态帧缺 period 时跳过，不产生单点轨迹", () => {
    const got = framesToTrajectoryData([{ dtype: "f32", shape: [1, 6], data: [...SEED.state] }], {}, MU);
    expect(got.trajectories).toHaveLength(0);
    expect(got.times).toHaveLength(0);
  });

  it("(n,6) 状态帧按 shape 取 xyz，data.epochs 提供时刻", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const epochs = [100, 200, 300, 400];
    const got = framesToTrajectoryData(
      [{ dtype: "f32", shape: [4, 6], data: states }],
      { epochs },
      MU,
    );
    expect(got.trajectories[0]).toEqual([
      [0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5],
    ]);
    expect(got.times[0]).toEqual(epochs);
  });

  it("epochs 行数不匹配时回退行序时刻", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = framesToTrajectoryData(
      [{ dtype: "f32", shape: [4, 6], data: states }],
      { epochs: [1, 2] }, // 只有 2 个，行数不匹配
      MU,
    );
    expect(got.times[0]).toEqual([0, 1, 2, 3]);
  });

  it("无 epochs 的帧按行序合成相对时刻", () => {
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) pts.push(i, i, i);
    const got = framesToTrajectoryData([{ dtype: "f32", shape: [3, 3], data: pts }], {}, MU);
    expect(got.times[0]).toEqual([0, 1, 2]);
  });

  it("shape 缺失时回退长度启发式：恰 6 个数无 period 视为位置", () => {
    const got = framesToTrajectoryData([{ dtype: "f32", shape: [], data: [1, 2, 3, 4, 5, 6] }], {}, MU);
    expect(got.trajectories[0]).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});

describe("familyMembersToTrajectoryData 轨迹解析（#412）", () => {
  it("完整状态序列取 xyz，成员 times 提供时刻", () => {
    const states: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < 4; i++) {
      states.push(i, i + 1, i + 2, 0, 0, 0);
      times.push(i * 10);
    }
    const got = familyMembersToTrajectoryData([{ states, times, period: null }], MU);
    expect(got.trajectories[0]).toEqual([
      [0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5],
    ]);
    expect(got.times[0]).toEqual(times);
  });

  it("(1,6) 初态 + period 传播整条轨迹，时刻按 period 合成", () => {
    const got = familyMembersToTrajectoryData(
      [{ states: [...SEED.state], times: [], period: SEED.period }],
      MU,
    );
    expect(got.trajectories).toHaveLength(1);
    expect(got.trajectories[0].length).toBeGreaterThan(100);
    const t = got.times[0];
    expect(t).toHaveLength(got.trajectories[0].length);
    expect(t[t.length - 1]).toBeCloseTo(SEED.period, 10);
  });

  it("(1,6) 初态缺 period 时跳过，不产生单点轨迹", () => {
    const got = familyMembersToTrajectoryData([{ states: [...SEED.state], times: [], period: null }], MU);
    expect(got.trajectories).toHaveLength(0);
  });

  it("成员 times 行数不匹配时回退行序时刻", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData([{ states, times: [1], period: null }], MU);
    expect(got.times[0]).toEqual([0, 1, 2, 3]);
  });
});

describe("Jacobi 常数透传（#435）", () => {
  it("族成员 jacobi 透传进 TrajectoryData", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData(
      [
        { states: [...states], times: [], period: null, jacobi: 3.1 },
        { states: [...states], times: [], period: null, jacobi: 2.9 },
      ],
      MU,
    );
    expect(got.jacobi).toEqual([3.1, 2.9]);
  });

  it("无 jacobi 的成员对应 undefined（与轨迹逐条对齐）", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData(
      [
        { states: [...states], times: [], period: null, jacobi: 3.1 },
        { states: [...states], times: [], period: null },
      ],
      MU,
    );
    expect(got.jacobi).toEqual([3.1, undefined]);
  });

  it("被跳过的成员（缺 period 的初态）不占 jacobi 槽位", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData(
      [
        { states: [...SEED.state], times: [], period: null, jacobi: 9.9 }, // 跳过
        { states: [...states], times: [], period: null, jacobi: 3.1 },
      ],
      MU,
    );
    expect(got.trajectories).toHaveLength(1);
    expect(got.jacobi).toEqual([3.1]);
  });

  it("成员 jacobi 缺失时回退记录级 recordJacobi（设计轨道单条通道）", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData(
      [{ states: [...states], times: [], period: null }],
      MU,
      3.006,
    );
    expect(got.jacobi).toEqual([3.006]);
  });

  it("成员自带 jacobi 优先于记录级 recordJacobi", () => {
    const states: number[] = [];
    for (let i = 0; i < 4; i++) states.push(i, i + 1, i + 2, 0, 0, 0);
    const got = familyMembersToTrajectoryData(
      [{ states: [...states], times: [], period: null, jacobi: 3.1 }],
      MU,
      3.006,
    );
    expect(got.jacobi).toEqual([3.1]);
  });

  it("framesToTrajectoryData：orbits[i].jacobi 逐帧透传", () => {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) pts.push(i, i + 10, i + 20);
    const got = framesToTrajectoryData(
      [{ dtype: "f32", shape: [6, 3], data: pts }],
      { orbits: [{ jacobi: 3.05 }] },
      MU,
    );
    expect(got.jacobi).toEqual([3.05]);
  });

  it("framesToTrajectoryData：顶层 cr3bp_jacobi 只兜底单条轨迹", () => {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) pts.push(i, i + 10, i + 20);
    const single = framesToTrajectoryData(
      [{ dtype: "f32", shape: [6, 3], data: pts }],
      { cr3bp_jacobi: 3.006 },
      MU,
    );
    expect(single.jacobi).toEqual([3.006]);

    const multi = framesToTrajectoryData(
      [
        { dtype: "f32", shape: [3, 3], data: pts.slice(0, 9) },
        { dtype: "f32", shape: [3, 3], data: pts.slice(9) },
      ],
      { cr3bp_jacobi: 3.006 },
      MU,
    );
    expect(multi.jacobi).toEqual([undefined, undefined]);
  });
});

describe("trajectoryTimeRange（#412）", () => {
  it("多条时刻取全局端点", () => {
    expect(trajectoryTimeRange([[0, 1, 2], [5, 10]])).toEqual([0, 10]);
  });

  it("递减时刻序列（direction=backward）仍给出 [min, max]，不倒置", () => {
    // orbit_propagation 的 direction=backward（5.9.7）按积分次序输出递减时刻；
    // 旧实现取 t[0]/t[last]，会得到 [4, 0] 这样的倒置区间，把 timelineMode 与
    // 动画导出打成空区间（TimelineBar 判 timeRange[0] >= timeRange[1] 即禁用）。
    // orbit_propagation's direction=backward (5.9.7) emits descending times in
    // integration order; reading t[0]/t[last] produced an inverted interval like
    // [4, 0], collapsing timelineMode and the animation export (TimelineBar
    // disables itself on timeRange[0] >= timeRange[1]).
    expect(trajectoryTimeRange([[4, 3, 2, 1, 0]])).toEqual([0, 4]);
    expect(trajectoryTimeRange([[10, 5], [2, 1, 0]])).toEqual([0, 10]);
    // 正反向混合（多产物同屏）同样按 min/max 取
    // Mixed directions (several products on screen) still resolve by min/max.
    expect(trajectoryTimeRange([[0, 1, 2], [10, 5]])).toEqual([0, 10]);
  });

  it("空列表返回 null（时间轴禁用）", () => {
    expect(trajectoryTimeRange([])).toBeNull();
  });

  it("全空时刻列返回 null", () => {
    expect(trajectoryTimeRange([[], []])).toBeNull();
  });
});

describe("transferTrajectoryToCanvasData 转移轨迹解析（#420）", () => {
  // 会合系物理 km（e2m2e ADR 0040）：地月质心原点
  // Rotating-frame physical km (e2m2e ADR 0040): barycenter origin.
  const TRAJ = [
    [-4670.9, 6578.0, 0.0, 0.0, 7.8, 0.0],
    [100000.0, 0.0, 5000.0, 1.0, 0.0, 0.0],
    [380000.0, 0.0, 0.0, 0.0, 0.5, 0.0],
  ];

  it("位置 ÷DU_KM 归一（384400 km → 1 DU），速度列丢弃", () => {
    const got = transferTrajectoryToCanvasData(TRAJ, null);
    expect(got.trajectories).toHaveLength(1);
    expect(got.trajectories[0][0][0]).toBeCloseTo(-4670.9 / 384400, 12);
    expect(got.trajectories[0][2][0]).toBeCloseTo(380000 / 384400, 12);
    expect(got.trajectories[0][0]).toHaveLength(3);
  });

  it("trajectory_times 行数一致时透传（接时间轴）", () => {
    const got = transferTrajectoryToCanvasData(TRAJ, [0, 100, 200]);
    expect(got.times).toHaveLength(1);
    expect(got.times[0]).toEqual([0, 100, 200]);
  });

  it("times 缺失或行数不一致时丢弃（时间轴禁用）", () => {
    expect(transferTrajectoryToCanvasData(TRAJ, undefined).times).toEqual([]);
    expect(transferTrajectoryToCanvasData(TRAJ, [0, 1]).times).toEqual([]);
  });

  it("空轨迹返回空画布数据", () => {
    const got = transferTrajectoryToCanvasData([], []);
    expect(got.trajectories).toEqual([[]]);
    expect(got.times).toEqual([[]]);
  });

  it("给 tli_epoch（JD_TDB 数）时时刻平移到 et 绝对基准", () => {
    const jd = 2460800.5;
    const got = transferTrajectoryToCanvasData(TRAJ, [0, 100, 200], jd);
    expect(got.timeBasis).toEqual(["et"]);
    expect(got.times[0][0]).toBeCloseTo(etFromEpoch(jd), 6);
    expect(got.times[0][2]).toBeCloseTo(etFromEpoch(jd) + 200, 6);
  });

  it("给 tli_epoch（ISO UTC 字符串）时同样得到 et 基准", () => {
    const got = transferTrajectoryToCanvasData(TRAJ, [0, 100, 200], "2025-06-21T11:00:00");
    expect(got.timeBasis).toEqual(["et"]);
    expect(got.times[0][0]).toBeCloseTo(etFromEpoch("2025-06-21T11:00:00"), 6);
  });

  it("tli_epoch 缺失时保持 TLI 起算相对秒", () => {
    const got = transferTrajectoryToCanvasData(TRAJ, [0, 100, 200]);
    expect(got.timeBasis).toEqual(["relative"]);
    expect(got.times[0]).toEqual([0, 100, 200]);
  });

  it("图例标签可定制（缺省「转移弧」）", () => {
    expect(transferTrajectoryToCanvasData(TRAJ, null).labels).toEqual(["转移弧"]);
    expect(transferTrajectoryToCanvasData(TRAJ, null, undefined, "arc").labels).toEqual(["arc"]);
  });

  it("转移弧标注数据系 synodic_km（会合系物理 km，ADR 0040 契约）", () => {
    expect(transferTrajectoryToCanvasData(TRAJ, null).frames).toEqual(["synodic_km"]);
  });

  // —— 双几何段（#428 第二步，e2m2e 5.9.1 trajectory_gcrs_km）——
  // Dual-geometry segment (#428 step 2, e2m2e 5.9.1 trajectory_gcrs_km).
  const GCRS: number[][] = [
    [7000.0, 0.0, 100.0, 0.0, 7.0, 1.0],
    [0.0, 200000.0, 0.0, -1.0, 3.0, 0.0],
    [-384400.0, 0.0, 0.0, 0.0, 1.0, 0.0],
  ];

  it("gcrs 段同行对齐时携带惯性几何（位置 ÷DU_KM），主几何与时刻不变", () => {
    const got = transferTrajectoryToCanvasData(TRAJ, [0, 100, 200], undefined, "转移弧", GCRS);
    expect(got.inertialGeometries).toHaveLength(1);
    expect(got.inertialGeometries![0]![0]).toEqual([7000.0 / 384400, 0, 100.0 / 384400]);
    expect(got.inertialGeometries![0]![2]).toEqual([-1, 0, 0]);
    // 主几何仍是会合系段（会合视图逐项不变）；时刻共享 trajectory_times
    // The primary geometry stays the synodic segment (synodic view unchanged item
    // for item); times are shared with trajectory_times.
    expect(got.trajectories[0][2][0]).toBeCloseTo(380000 / 384400, 12);
    expect(got.times[0]).toEqual([0, 100, 200]);
    expect(got.frames).toEqual(["synodic_km"]);
  });

  it("gcrs 段行数不齐或缺位时惯性几何为 null/缺省（降级灰显口径）", () => {
    const misaligned = transferTrajectoryToCanvasData(TRAJ, null, undefined, "转移弧", GCRS.slice(0, 2));
    expect(misaligned.inertialGeometries![0]).toBeNull();
    // 未传参（low_thrust/旧响应）不带 inertialGeometries 字段
    // No param (low_thrust / legacy responses) leaves inertialGeometries absent.
    expect(transferTrajectoryToCanvasData(TRAJ, null).inertialGeometries).toBeUndefined();
  });
});

describe("transferCandidateToArcData top-N 候选弧（#430）", () => {
  const CAND = {
    trajectory: [
      [-4670.9, 6578.0, 0.0, 0.0, 7.8, 0.0],
      [380000.0, 0.0, 0.0, 0.0, 0.5, 0.0],
    ],
    trajectory_times: [0, 200],
    tli_epoch: "2026-09-01T00:00:00",
  };

  it("自带 tli_epoch 可解析：时刻平移到 et 基准并给出 chip 时刻", () => {
    const got = transferCandidateToArcData(CAND, "候选 2");
    expect(got).not.toBeNull();
    expect(got!.data.timeBasis).toEqual(["et"]);
    expect(got!.data.times[0][0]).toBeCloseTo(etFromEpoch("2026-09-01T00:00:00"), 6);
    expect(got!.tliEt).toBeCloseTo(etFromEpoch("2026-09-01T00:00:00"), 6);
    expect(got!.data.labels).toEqual(["候选 2"]);
    // 候选无 gcrs 惯性段：惯性视图走灰显口径
    // Candidates carry no gcrs segment: the inertial view grays them.
    expect(got!.data.inertialGeometries).toBeUndefined();
  });

  it("tli_epoch 缺失：相对时刻、chip 为 null，弧照画", () => {
    const got = transferCandidateToArcData(
      { trajectory: CAND.trajectory, trajectory_times: CAND.trajectory_times },
      "候选 3",
    );
    expect(got!.data.timeBasis).toEqual(["relative"]);
    expect(got!.tliEt).toBeNull();
  });

  it("无轨迹快照（降级传播失败）返回 null", () => {
    expect(transferCandidateToArcData({ tli_epoch: "2026-09-01T00:00:00" }, "候选 4")).toBeNull();
    expect(transferCandidateToArcData({ trajectory: [] }, "候选 4")).toBeNull();
  });
});

describe("propagationToCanvasData 轨道预报解析（#421）", () => {
  it("position_km（GCRS km）÷DU_KM 缩放，times_jd_tdb → et 基准", () => {
    const got = propagationToCanvasData(
      [[384400.0, 0.0, 0.0], [0.0, 384400.0, 0.0]],
      [2460800.5, 2460801.5],
      "prop"
    );
    expect(got).not.toBeNull();
    expect(got!.trajectories[0][0]).toEqual([1, 0, 0]);
    expect(got!.timeBasis).toEqual(["et"]);
    expect(got!.times[0][0]).toBeCloseTo(etFromJdTdb(2460800.5), 6);
    expect(got!.labels).toEqual(["prop"]);
    expect(got!.frames).toEqual(["inertial_km"]);
  });

  it("输入非法时返回 null（回退通用分支）", () => {
    expect(propagationToCanvasData(null, null)).toBeNull();
    expect(propagationToCanvasData([], [])).toBeNull();
    expect(propagationToCanvasData([384400.0], [2460800.5])).toBeNull();
  });
});

describe("designEphemerisToCanvasData 星历段解析（#434）", () => {
  // EphemerisTable 形状的星历段：会合无量纲位置 + UTC 分量
  const EPH = {
    synodic_position: [[1.1, 0.2, -0.3], [1.2, 0.3, -0.4]],
    year: [2024, 2024],
    month: [1, 1],
    day: [1, 1],
    hour: [0, 1],
    minute: [0, 0],
    second: [0, 0],
  };

  it("会合系无量纲直画（不缩放），UTC 分量 → et 基准", () => {
    const got = designEphemerisToCanvasData(EPH, "eph");
    expect(got).not.toBeNull();
    expect(got!.trajectories[0]).toEqual([[1.1, 0.2, -0.3], [1.2, 0.3, -0.4]]);
    expect(got!.timeBasis).toEqual(["et"]);
    expect(got!.times[0]).toHaveLength(2);
    // 相邻行差 1 小时（3600 s）
    expect(got!.times[0][1] - got!.times[0][0]).toBeCloseTo(3600, 3);
    expect(got!.labels).toEqual(["eph"]);
  });

  it("UTC 分量缺失/行数不齐 → 无时刻基准（轨迹仍上画布）", () => {
    const missing = { synodic_position: [[0, 0, 0]] };
    expect(designEphemerisToCanvasData(missing)).toEqual({
      trajectories: [[[0, 0, 0]]],
      times: [[]],
      timeBasis: ["none"],
      frames: ["synodic_nd"],
      labels: ["星历段"],
      roles: ["ephemeris"],
    });
    const misaligned = { ...EPH, year: [2024] };
    expect(designEphemerisToCanvasData(misaligned)!.timeBasis).toEqual(["none"]);
  });

  it("synodic_position 非法时返回 null", () => {
    expect(designEphemerisToCanvasData(null)).toBeNull();
    expect(designEphemerisToCanvasData({})).toBeNull();
    expect(designEphemerisToCanvasData({ synodic_position: [] })).toBeNull();
    expect(designEphemerisToCanvasData({ synodic_position: [1, 2, 3] })).toBeNull();
  });

  it("库记录通道的 (3n,) 平铺 synodic_position 同样收（get_artifact Vec<f32>）；行数与分量不齐不上", () => {
    // 平铺 + 分量齐整：记录通道真实形状（曾因只认嵌套被静默丢弃，
    // 修"星历轨道画不出来"——2026-09-01）
    const flat = designEphemerisToCanvasData({
      ...EPH,
      synodic_position: [1.1, 0.2, -0.3, 1.2, 0.3, -0.4],
    });
    expect(flat).not.toBeNull();
    expect(flat!.trajectories[0]).toEqual([[1.1, 0.2, -0.3], [1.2, 0.3, -0.4]]);
    expect(flat!.roles).toEqual(["ephemeris"]);
    // 平铺但分量缺失：半截数据不上（与 Rust 七键齐全才携带同口径）
    expect(designEphemerisToCanvasData({ synodic_position: [1.1, 0.2, -0.3] })).toBeNull();
    // 行数互不齐整：整段不上
    const ragged = { ...EPH, synodic_position: [1.1, 0.2, -0.3, 1.2] };
    expect(designEphemerisToCanvasData(ragged)).toBeNull();
  });

  it("星历段标注数据系 synodic_nd（会合系无量纲直画）", () => {
    expect(designEphemerisToCanvasData(EPH)!.frames).toEqual(["synodic_nd"]);
  });

  it("GCRS position_km 作惯性几何随行携带（÷DU_KM，eph-fig）", () => {
    // 设计响应 EphemerisTable 形状：(n,3) 嵌套
    const got = designEphemerisToCanvasData({
      ...EPH,
      position_km: [[DU_KM, 0, 0], [2 * DU_KM, 0, -DU_KM]],
    });
    expect(got!.inertialGeometries).toEqual([[[1, 0, 0], [2, 0, -1]]]);
  });

  it("记录通道 (3n,) 平铺 position_km 同样归一携带", () => {
    const got = designEphemerisToCanvasData({
      ...EPH,
      position_km: [DU_KM, 0, 0, 2 * DU_KM, 0, -DU_KM],
    });
    expect(got!.inertialGeometries).toEqual([[[1, 0, 0], [2, 0, -1]]]);
  });

  it("position_km 缺位/行数不齐 → 不携带惯性几何（惯性视图灰显口径）", () => {
    expect(designEphemerisToCanvasData(EPH)!.inertialGeometries).toBeUndefined();
    const misaligned = { ...EPH, position_km: [[DU_KM, 0, 0]] };
    expect(designEphemerisToCanvasData(misaligned)!.inertialGeometries).toBeUndefined();
    const flatMismatch = { ...EPH, position_km: [DU_KM, 0, 0] };
    expect(designEphemerisToCanvasData(flatMismatch)!.inertialGeometries).toBeUndefined();
  });

  it("星历段标注段角色 ephemeris（eph-fig）", () => {
    expect(designEphemerisToCanvasData(EPH)!.roles).toEqual(["ephemeris"]);
  });
});

describe("filterByRole 绘制内容过滤（eph-fig）", () => {
  // 双段产物（CR3BP 参考段 + 星历段）+ 一条无段语义轨迹（转移弧等）
  const dual = {
    trajectories: [[[0, 0, 0]], [[1, 1, 1]], [[2, 2, 2]]],
    times: [[10, 20], [30, 40], []],
    timeBasis: ["et", "et", "none"] as TimeBasis[],
    frames: ["synodic_nd", "synodic_nd", "inertial_km"] as DataFrameTag[],
    labels: ["CR3BP 参考", "星历段", "转移弧"],
    jacobi: [3.0, 3.0, undefined],
    inertialGeometries: [null, [[0.5, 0.5, 0.5]], [[9, 9, 9]]],
    roles: ["cr3bp", "ephemeris", undefined] as ("cr3bp" | "ephemeris" | undefined)[],
  };

  it("all 模式原样返回（同一引用）", () => {
    expect(filterByRole(dual, "all")).toBe(dual);
  });

  it("cr3bp 模式保留 CR3BP 段与无段语义轨迹，行对齐数组同步裁剪", () => {
    const got = filterByRole(dual, "cr3bp");
    expect(got.trajectories).toEqual([[[0, 0, 0]], [[2, 2, 2]]]);
    expect(got.times).toEqual([[10, 20], []]);
    expect(got.timeBasis).toEqual(["et", "none"]);
    expect(got.frames).toEqual(["synodic_nd", "inertial_km"]);
    expect(got.labels).toEqual(["CR3BP 参考", "转移弧"]);
    expect(got.jacobi).toEqual([3.0, undefined]);
    expect(got.inertialGeometries).toEqual([null, [[9, 9, 9]]]);
    expect(got.roles).toEqual(["cr3bp", undefined]);
  });

  it("ephemeris 模式保留星历段与无段语义轨迹", () => {
    const got = filterByRole(dual, "ephemeris");
    expect(got.trajectories).toEqual([[[1, 1, 1]], [[2, 2, 2]]]);
    expect(got.labels).toEqual(["星历段", "转移弧"]);
    expect(got.roles).toEqual(["ephemeris", undefined]);
  });

  it("无 roles 时按全未标注解释（任何模式都保留）", () => {
    const untagged = { trajectories: [[[0, 0, 0]]], times: [[]] };
    expect(filterByRole(untagged, "cr3bp").trajectories).toEqual([[[0, 0, 0]]]);
    expect(filterByRole(untagged, "ephemeris").trajectories).toEqual([[[0, 0, 0]]]);
  });
});

describe("timelineMode / timesForMode 两级时刻基准（ADR 0021 修订，#421）", () => {
  const etData = {
    trajectories: [[[0, 0, 0]], [[1, 1, 1]]],
    times: [[100, 200], [0, 1]],
    timeBasis: ["et", "relative"] as TimeBasis[],
  };

  it("任一 et 产物在屏 → 全局 et 模式", () => {
    expect(timelineMode(etData)).toBe("et");
  });

  it("全部无 et 但有相对时刻 → 相对模式", () => {
    expect(timelineMode({ trajectories: [[], []], times: [[], [0, 1]], timeBasis: ["none", "relative"] })).toBe("relative");
  });

  it("全部无时刻 → null（时间轴禁用）", () => {
    expect(timelineMode({ trajectories: [[], []], times: [[], []], timeBasis: ["none", "none"] })).toBeNull();
  });

  it("et 模式下相对轨迹时刻置空（marker 隐藏），et 轨迹保留", () => {
    expect(timesForMode(etData, "et")).toEqual([[100, 200], []]);
  });

  it("相对模式保留全部时刻（旧行为）", () => {
    expect(timesForMode(etData, "relative")).toEqual(etData.times);
  });

  it("timeBasis 缺省按 relative 解释（兼容旧数据；et 模式下置空）", () => {
    const legacy = { trajectories: [[[0, 0, 0]]], times: [[0, 1]] };
    expect(timelineMode(legacy)).toBe("relative");
    expect(timesForMode(legacy, "relative")).toEqual([[0, 1]]);
    expect(timesForMode(legacy, "et")).toEqual([[]]);
  });
});

// 理想化惯性几何（#477）：θ=ωt（TU 时刻即 θ，ω=1）、θ₀=0 于弧起点、
// Rz(+θ)·(p_syn+(μ,0,0))——与 e2m2e _synodic_to_gcrs 及后端 viz_adapter
// 同约定。覆盖：旋转函数本身、族轨道 times 读取接线、候选 gcrs 透传、
// state_frame 映射。旧版 e2m2e（字段缺位）一律回退灰显，不报错。
// Idealized inertial geometry (#477): θ=ωt (a TU time IS θ, ω=1), θ₀=0 at
// arc start, Rz(+θ)·(p_syn+(μ,0,0)) — the same convention as e2m2e's
// _synodic_to_gcrs and the backend viz_adapter. Covers the rotation itself,
// the family-times wiring, candidate gcrs passthrough, and state_frame
// mapping. Legacy e2m2e (fields absent) always falls back to graying.
describe("理想化惯性几何（#477）", () => {
  const MU = 0.01215058560962404;

  it("idealizedInertialGeometry：θ=0 只 +μ 平移；θ=π/2 绕 z 正旋", () => {
    const pts = [[0, 0, 0.1]];
    expect(idealizedInertialGeometry(pts, [0], MU)).toEqual([[MU, 0, 0.1]]);
    // θ=π/2：x'=−y, y'=x+μ → 原点 (0,0) → (0, μ)
    // θ=π/2: x'=−y, y'=x+μ → the origin (0,0) maps to (0, μ)
    const r = idealizedInertialGeometry(pts, [Math.PI / 2], MU)![0];
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(MU, 12);
    expect(r[2]).toBeCloseTo(0.1, 12);
  });

  it("时刻行数不齐或非有限 → null（调用方回退灰显）", () => {
    expect(idealizedInertialGeometry([[0, 0, 0]], [], MU)).toBeNull();
    expect(idealizedInertialGeometry([[0, 0, 0]], [0, 1], MU)).toBeNull();
    expect(idealizedInertialGeometry([[0, 0, 0]], [Number.NaN], MU)).toBeNull();
  });

  it("framesToTrajectoryData 读 orbits[i].times：行对齐作时刻源并产理想化几何与标记", () => {
    const frames = [
      { dtype: "f8", shape: [], data: [0.8, 0, 0.05, 0.85, 0.01, 0.05] },
    ];
    const td = framesToTrajectoryData(frames, { mu: MU, orbits: [{ times: [0, 1.5] }] }, MU);
    // 行对齐的 TU 时刻优先于行序回退
    // Row-aligned TU times win over the row-index fallback
    expect(td.times).toEqual([[0, 1.5]]);
    expect(td.inertialGeometries).toHaveLength(1);
    expect(td.inertialGeometries![0]).toHaveLength(2);
    expect(td.inertialIdealized).toEqual([true]);
    // 首点 θ=0：几何 = 位置 + μ 平移
    // First point at θ=0: geometry = position shifted by +μ
    expect(td.inertialGeometries![0]![0]).toEqual([0.8 + MU, 0, 0.05]);
  });

  it("orbits[i].times 缺席 → 旧行为（行序时刻）且无惯性几何（灰显回退）", () => {
    const frames = [
      { dtype: "f8", shape: [], data: [0.8, 0, 0.05, 0.85, 0.01, 0.05] },
    ];
    const td = framesToTrajectoryData(frames, { mu: MU }, MU);
    expect(td.times).toEqual([[0, 1]]);
    expect(td.inertialGeometries![0]).toBeNull();
    expect(td.inertialIdealized).toEqual([false]);
  });

  it("候选弧 gcrs 透传：有 trajectory_gcrs_km → 惯性段 + 理想化标记；缺省无字段", () => {
    const withGcrs = transferCandidateToArcData(
      {
        trajectory: [[384400, 0, 0], [400000, 10000, 0]],
        trajectory_times: [0, 3600],
        tli_epoch: "2024-01-01T00:00:00Z",
        trajectory_gcrs_km: [[7000, 0, 0], [8000, 1000, 0]],
      },
      "#1",
    )!;
    expect(withGcrs.data.inertialGeometries![0]).toHaveLength(2);
    expect(withGcrs.data.inertialIdealized).toEqual([true]);
    const without = transferCandidateToArcData(
      { trajectory: [[384400, 0, 0]], trajectory_times: [0] },
      "#2",
    )!;
    expect(without.data.inertialGeometries).toBeUndefined();
  });

  it("propagationToCanvasData：state_frame 有则映射（gcrs_km→inertial_km），缺省回退硬编码", () => {
    const km = [[7000, 0, 0], [8000, 1000, 0]];
    const jd = [2460310.5, 2460310.5001];
    expect(propagationToCanvasData(km, jd, "预报", "gcrs_km")!.frames).toEqual(["inertial_km"]);
    expect(propagationToCanvasData(km, jd, "预报", "synodic_barycentric_km")!.frames).toEqual(["synodic_km"]);
    expect(propagationToCanvasData(km, jd, "预报")!.frames).toEqual(["inertial_km"]);
  });
});
