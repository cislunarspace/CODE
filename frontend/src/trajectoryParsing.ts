// sidecar 帧/成员数据 → 画布轨迹（number[][][]，每条为 xyz 点列）+ 同源时刻数组。
//
// 帧解析优先用协议自带的 shape 区分 (n,6) 状态与 (n,3) 位置；
// (1,6) 是周期轨道初态，需要 period 才能在前端传播出整条轨迹，
// 缺 period 时跳过该成员，而不是只画一个点造成空画布。
//
// 时刻来源（行数与轨迹点数严格一致）与基准（timeBasis，ADR 0021 修订）：
// et = J2000 起算真实历元秒（时间轴绝对基准）；relative = 相对时刻
// （period 合成 / 行序），仅当同屏无 et 产物时参与走查；none = 无时刻。
// sidecar frame/member data → canvas trajectories (number[][][], each an xyz point list) plus a matching
// time array.
//
// Frame parsing prefers the protocol-provided shape to tell (n,6) states from (n,3) positions; a (1,6)
// entry is a periodic-orbit initial state needing a period to propagate the full trajectory in the frontend;
// members without a period are skipped rather than drawn as a single point on an empty canvas.
//
// Time sources (row counts match trajectory point counts exactly) and their bases (timeBasis, ADR 0021
// revision): et = true epoch seconds since J2000 (the timeline's absolute basis); relative = relative time
// (period-synthesized / row order), walks only when no et product is on screen; none = no timing.

import { DU_KM, propagate } from "./cr3bp";
import { etFromEpoch, etFromJdTdb } from "./timeBasis";
import type { FamilyMember } from "./sidecarApi";

export interface TrajectoryFrame {
  dtype: string;
  shape: number[];
  data: number[];
}

/** 单条轨迹的时刻基准：et=真实历元秒；relative=相对时刻；none=无时刻 */
/** Per-trajectory time basis: et = true epoch seconds; relative = relative time; none = untimed. */
export type TimeBasis = "et" | "relative" | "none";

/** 单条轨迹的数据系标签（CONTEXT.md「数据系」枚举的画布子集；视图系是
 *  用户显示选择，不随数据走，故不在此列）。与 e2m2e state_frame 词表的
 *  对应：synodic_nd ≈ synodic_barycentric_nd、synodic_km ≈
 *  synodic_barycentric_km、inertial_km ≈ 地心惯性 km（GCRS）。
 *  A trajectory's data-frame tag (the canvas subset of CONTEXT.md's
 *  数据系 enum; the view frame is a display choice and never rides the
 *  data). Maps onto e2m2e's state_frame vocabulary as noted. */
export type DataFrameTag = "synodic_nd" | "synodic_km" | "inertial_km";

/** 单条轨迹的段角色（eph-fig）：双段并存的产物（CR3BP 参考段 + 星历段）
 *  逐条标注，供"绘制内容"切换按角色过滤；无双段语义的产物（转移弧、轨道
 *  预报、族成员）不标注——任何模式下都显示。 */
/** A trajectory's segment role (eph-fig): dual-segment products (the CR3BP
 *  reference segment + the ephemeris segment) are tagged row-by-row so the
 *  content switch filters by role; products without dual-segment semantics
 *  (transfer arcs, propagations, family members) stay untagged — shown in
 *  every mode. */
export type SegmentRole = "cr3bp" | "ephemeris";

/** 绘制内容切换（eph-fig）：all 双段同屏；cr3bp / ephemeris 只画对应段。
 *  未标注角色的轨迹视为"无段语义"，任何模式下都保留。 */
/** The content switch (eph-fig): all draws both segments; cr3bp / ephemeris
 *  draw the tagged one only. Untagged trajectories carry no segment
 *  semantics and survive every mode. */
export type ContentMode = "all" | "cr3bp" | "ephemeris";

export interface TrajectoryData {
  trajectories: number[][][];
  /** 与 trajectories 逐条对齐的时刻数组（秒；无时刻为空数组） */
  /** Time array aligned row-by-row with trajectories (seconds; empty when untimed). */
  times: number[][];
  /** 与 trajectories 逐条对齐的时刻基准；缺省按 relative 解释（兼容旧调用） */
  /** Time basis aligned row-by-row; defaults to relative for legacy callers. */
  timeBasis?: TimeBasis[];
  /** 与 trajectories 逐条对齐的数据系标签；缺省按 synodic_nd 解释
   *  （画布既有轨迹全部是会合系无量纲，惯性系轨迹自带标签） */
  /** Data-frame tag aligned row-by-row; defaults to synodic_nd (every legacy
   *  canvas trajectory is synodic dimensionless; inertial ones self-tag). */
  frames?: DataFrameTag[];
  /** 与 trajectories 逐条对齐的图例标签；缺省不进图例 */
  /** Legend label per trajectory; omitted entries stay out of the legend. */
  labels?: string[];
  /** 与 trajectories 逐条对齐的 Jacobi 常数；undefined 项 = 该轨迹无
   *  Jacobi 值（转移弧等），渲染时回退色环（#435）。 */
  /** Jacobi constant aligned row-by-row; undefined entries = no Jacobi
   *  value (transfer arcs etc.), falling back to the color cycle (#435). */
  jacobi?: (number | undefined)[];
  /** 与 trajectories 逐条对齐的惯性几何（DU 归一）：转移弧的 gcrs 段
   *  （#428 第二步，e2m2e 5.9.1 trajectory_gcrs_km）——同一物理弧的第二
   *  份数据，惯性视图下改用它绘制；缺位（null / 无字段）按无惯性段处理
   *  （降级灰显）。视图系是显示选择，不随数据走，故不占 frames 槽位。 */
  /** Inertial geometry row-aligned with trajectories (DU-normalized): the
   *  transfer arc's gcrs segment (#428 step 2, e2m2e 5.9.1
   *  trajectory_gcrs_km) — a second copy of the same physical arc, drawn in
   *  the inertial view; a missing entry (null / absent field) counts as no
   *  inertial segment (degraded graying). The view frame is a display choice
   *  and never rides the data, hence no frames slot. */
  inertialGeometries?: (number[][] | null)[];
  /** 与 inertialGeometries 逐条对齐的来源标记（#477）：true = 理想化相位
   *  旋转（θ=ωt、θ₀=0，转移 gcrs 段与族轨道前端旋转都属此类），false =
   *  真星历 position_km（设计/预报/受控星历）。清单/图例据此区分两种
   *  「地心惯性 km」。缺省全按真星历。 */
  /** Source flag aligned with inertialGeometries (#477): true = idealized-phase
   *  rotation (θ=ωt, θ₀=0 — transfer gcrs segments and the frontend family
   *  rotation both qualify), false = real-ephemeris position_km (design /
   *  propagation / controlled). The list/legend distinguishes the two
   *  "geocentric inertial km" sources by it. Defaults to real-ephemeris. */
  inertialIdealized?: boolean[];
  /** 与 trajectories 逐条对齐的段角色（eph-fig）；缺省项 = 无段语义 */
  /** Segment roles row-aligned with trajectories (eph-fig); omitted entries
   *  = no segment semantics. */
  roles?: (SegmentRole | undefined)[];
}

/** 传播步数：与轨迹点数联动（点数 = 步数 + 1），时刻按 period/步数均匀合成 */
/** Propagation steps: linked to the trajectory point count (points = steps + 1); times synthesize uniformly over period/steps. */
const PROPAGATION_STEPS = 800;

function chunksOf(data: number[], size: number, take: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + size <= data.length; i += size) {
    pts.push(data.slice(i, i + take));
  }
  return pts;
}

function linspaceByPeriod(period: number, points: number): number[] {
  return Array.from({ length: points }, (_, i) => (i * period) / (points - 1));
}

function rowIndexTimes(points: number): number[] {
  return Array.from({ length: points }, (_, i) => i);
}

/** 有限数值才收：NaN/Infinity/非 number 一律视为无 Jacobi 值。 */
/** Accept only finite numbers: NaN/Infinity/non-numbers all count as no Jacobi value. */
function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 理想化会合系→地心惯性位置旋转（#477）：θ = t（timesTu 为 TU 无量纲
 *  时刻，CR3BP ω=1，θ₀=0 于弧起点），Rz(+θ)·(p_syn + (μ,0,0))——与
 *  e2m2e _synodic_to_gcrs（transfer gcrs 段约定）及后端 viz_adapter.
 *  synodic_to_gcrs_km 完全同口径。时刻行数不齐或含非有限值 → null，
 *  调用方按灰显口径回退。 */
/** Idealized synodic→geocentric-inertial position rotation (#477): θ = t
 *  (timesTu are TU dimensionless times, CR3BP ω=1, θ₀=0 at arc start),
 *  Rz(+θ)·(p_syn + (μ,0,0)) — exactly the convention of e2m2e's
 *  _synodic_to_gcrs (the transfer gcrs segment) and the backend
 *  viz_adapter.synodic_to_gcrs_km. Misaligned or non-finite times → null;
 *  callers fall back to the graying convention. */
export function idealizedInertialGeometry(
  pts: number[][],
  timesTu: number[],
  mu: number,
): number[][] | null {
  if (timesTu.length !== pts.length) return null;
  if (timesTu.some((t) => !Number.isFinite(t))) return null;
  return pts.map((p, i) => {
    const c = Math.cos(timesTu[i]);
    const s = Math.sin(timesTu[i]);
    const x = p[0] + mu;
    const y = p[1];
    return [c * x - s * y, s * x + c * y, p[2]];
  });
}

/** 通用工具响应帧 → 轨迹 + 时刻。data 提供 mu / orbits[i].period / period / epochs。 */
/** Generic tool response frame → trajectories + times. data provides mu / orbits[i].period / period / epochs. */
export function framesToTrajectoryData(
  frames: TrajectoryFrame[],
  data: Record<string, unknown>,
  defaultMu: number,
): TrajectoryData {
  const d = data as {
    mu?: unknown;
    orbits?: unknown[];
    period?: unknown;
    epochs?: unknown;
    cr3bp_jacobi?: unknown;
  };
  const mu = typeof d.mu === "number" ? d.mu : defaultMu;
  const orbits = Array.isArray(d.orbits) ? d.orbits : [];
  const epochs = Array.isArray(d.epochs) ? (d.epochs as unknown[]).map(Number) : null;
  const trajectories: number[][][] = [];
  const times: number[][] = [];
  const timeBasis: TimeBasis[] = [];
  const frameTags: DataFrameTag[] = [];
  const jacobi: (number | undefined)[] = [];
  // 理想化惯性几何（#477）：逐条与轨迹对齐；无可旋转时刻的行为 null
  // （惯性视图灰显回退）。
  // Idealized inertial geometries (#477): row-aligned with trajectories;
  // rows without rotatable times are null (the inertial-view gray fallback).
  const inertialGeometries: (number[][] | null)[] = [];
  const inertialIdealized: boolean[] = [];

  frames.forEach((frame, i) => {
    const f = frame.data as number[];
    const rows = frame.shape[0] ?? 0;
    const cols = frame.shape[1] ?? 0;
    const orbit = orbits[i] as { period?: unknown; jacobi?: unknown; times?: unknown } | undefined;
    const period =
      Number(orbit?.period) ||
      (typeof d.period === "number" ? d.period : null);
    const orbitJacobi = finiteOrUndefined(orbit?.jacobi);
    // 成员自带无量纲时刻（TU，#477）：行对齐才是真时刻源
    // The member's own dimensionless times (TU, #477): row-aligned counts as genuine
    const orbitTimes = Array.isArray(orbit?.times) ? (orbit!.times as unknown[]).map(Number) : null;

    let pts: number[][] | null = null;
    // period 路径的合成时刻（TU，linspaceByPeriod），非空即真时刻源
    // The period path's synthesized times (TU, linspaceByPeriod); non-null = genuine
    let synthTimes: number[] | null = null;
    if (rows === 1 && f.length === 6) {
      // 周期轨道初态：有 period 才能传播；缺则跳过
      // Periodic-orbit initial state: propagatable only with a period; skipped when absent.
      if (period) {
        pts = propagate(
          mu,
          { orbitId: `orbit-${i}`, mu, period, state: f.slice(0, 6) as [number, number, number, number, number, number] },
          PROPAGATION_STEPS,
        );
        synthTimes = linspaceByPeriod(period, pts.length);
      }
    } else if (cols === 6 || cols === 3) {
      pts = chunksOf(f, cols, 3);
    } else if (frame.shape.length === 0 && f.length > 6 && f.length % 6 === 0) {
      pts = chunksOf(f, 6, 3);
    } else if (frame.shape.length === 0 && f.length % 3 === 0) {
      pts = chunksOf(f, 3, 3);
    }
    if (!pts) return;

    // 时刻源优先级（#477）：period 合成 / 成员自带 TU 时刻 > epochs/行序
    // 回退。回退时刻不是物理相位，不可作旋转角。
    // Time-source precedence (#477): period-synthesized / member TU times
    // over the epochs/row-index fallbacks. Fallback times are not physical
    // phases and cannot serve as rotation angles.
    const genuine = orbitTimes && orbitTimes.length === pts.length ? orbitTimes : null;
    const t = synthTimes ?? genuine ?? matchingTimes(epochs, pts.length);
    trajectories.push(pts);
    times.push(t);
    timeBasis.push("relative");
    frameTags.push("synodic_nd");
    jacobi.push(orbitJacobi);
    const geo = synthTimes || genuine ? idealizedInertialGeometry(pts, t, mu) : null;
    inertialGeometries.push(geo);
    inertialIdealized.push(geo !== null);
  });
  // 设计直出（DesignOrbitResponse）的顶层 cr3bp_jacobi 是单条轨道的值，
  // 只有本次恰产出一条轨迹时才能归属，多条时归属不明则不填。
  // A design response's top-level cr3bp_jacobi (DesignOrbitResponse) belongs to a
  // single orbit: it applies only when exactly one trajectory came out this round.
  const topJacobi = finiteOrUndefined(d.cr3bp_jacobi);
  if (topJacobi !== undefined && jacobi.length === 1 && jacobi[0] === undefined) {
    jacobi[0] = topJacobi;
  }
  return { trajectories, times, timeBasis, frames: frameTags, jacobi, inertialGeometries, inertialIdealized };
}

/** epochs 行数匹配则用之，否则回退行序时刻；period 路径已单独合成。 */
/** Uses epochs when the row count matches, else falls back to row-order times; the period path synthesizes its own. */
function matchingTimes(times: number[] | null, points: number): number[] {
  if (times && times.length === points) return times;
  return rowIndexTimes(points);
}

/** 转移设计响应的 trajectory（(n,6) 会合系物理 km/km/s，e2m2e ADR 0040 契约）
 *  → 画布轨迹：位置 ÷DU_KM 归一到会合无量纲。trajectory_times（TLI 起算秒）
 *  与行数一致则作同源时刻接时间轴，否则丢弃（时间轴禁用）。给出 tli_epoch
 *  时时刻平移到 et 绝对基准（ADR 0021 修订：et 是时间轴唯一绝对基准），
 *  否则保持 TLI 起算相对秒。 */
/** transfer_design trajectory ((n,6) rotating-frame physical km/km/s, the
 *  e2m2e ADR 0040 contract) → canvas data: positions normalized by DU_KM.
 *  trajectory_times (seconds since TLI) pass through as matching times when
 *  row-aligned, else dropped (timeline stays disabled). With tli_epoch given,
 *  times shift onto the et absolute basis (ADR 0021 revision: et is the
 *  timeline's only absolute basis); otherwise they stay TLI-relative. */
export function transferTrajectoryToCanvasData(
  trajectory: number[][],
  times: unknown,
  tliEpoch?: string | number,
  label = "转移弧",
  gcrsTrajectory?: number[][] | null,
): TrajectoryData {
  const pts = trajectory.map((row) => [
    Number(row[0]) / DU_KM,
    Number(row[1]) / DU_KM,
    Number(row[2]) / DU_KM,
  ]);
  // 惯性段（#428 第二步）：与主几何逐行对齐才携带（时刻共享
  // trajectory_times，不双份）；行数不齐或缺位为 null——降级灰显口径。
  // The inertial segment (#428 step 2): carried only when row-aligned with the
  // primary geometry (times are shared with trajectory_times, never
  // duplicated); misaligned or absent is null — the degraded-graying case.
  const gcrsPts =
    gcrsTrajectory && gcrsTrajectory.length === trajectory.length
      ? gcrsTrajectory.map((row) => [
          Number(row[0]) / DU_KM,
          Number(row[1]) / DU_KM,
          Number(row[2]) / DU_KM,
        ])
      : null;
  const aligned =
    Array.isArray(times) && times.length === trajectory.length
      ? (times as unknown[]).map(Number)
      : null;
  const tliEt = tliEpoch !== undefined ? etFromEpoch(tliEpoch) : NaN;
  const etTimes =
    aligned && Number.isFinite(tliEt) ? aligned.map((t) => t + tliEt) : null;
  return {
    trajectories: [pts],
    times: etTimes ? [etTimes] : aligned ? [aligned] : [],
    timeBasis: [etTimes ? "et" : aligned ? "relative" : "none"],
    frames: ["synodic_km"],
    labels: [label],
    // 未传 gcrs 段（low_thrust/旧响应）不携带字段；传了但行数不齐为 null
    // No gcrs param (low_thrust / legacy responses) leaves the field absent;
    // a provided-but-misaligned one is null.
    ...(gcrsTrajectory !== undefined && gcrsTrajectory !== null
      ? {
          inertialGeometries: [gcrsPts] as (number[][] | null)[],
          // 转移 gcrs 段是理想化相位约定（θ=ωt、θ₀=0@TLI，e2m2e
          // _synodic_to_gcrs），来源标记随几何有无（行数不齐为 false）
          // The transfer gcrs segment follows the idealized-phase convention
          // (θ=ωt, θ₀=0@TLI, e2m2e _synodic_to_gcrs); the source flag rides
          // on geometry presence (misaligned rows → false)
          inertialIdealized: [gcrsPts !== null],
        }
      : {}),
  };
}

/** top-N 可行解候选（非选中）的输入形状（e2m2e 5.9.1 TransferCandidate
 *  的画布相关子集；tli_epoch 可为 UTC 字符串、JD_TDB 浮点或 null）。 */
/** The input shape of a (non-selected) top-N feasible-solution candidate
 *  (the canvas-relevant subset of e2m2e 5.9.1's TransferCandidate; tli_epoch
 *  may be a UTC string, a JD_TDB float, or null). */
export interface TransferCandidateInput {
  trajectory?: unknown;
  trajectory_times?: unknown;
  tli_epoch?: unknown;
  /** 候选弧 gcrs 惯性段（#477 前端接线）：e2m2e 侧补字段前缺省——
   *  候选弧在惯性视图保持灰显回退；到位后与主弧同一透传路径。 */
  /** The candidate arc's gcrs inertial segment (#477 frontend wiring):
   *  absent until the e2m2e side ships the field — candidate arcs keep the
   *  inertial-view gray fallback; once present they ride the same passthrough
   *  as the main arc. */
  trajectory_gcrs_km?: unknown;
}

/** top-N 候选（非选中）→ 画布弧 + TLI 时刻（#430）：会合系段照常归一上画；
 *  候选自带 trajectory_gcrs_km（#477 接线，e2m2e 侧补字段后）时惯性段随行
 *  携带，缺省保持惯性视图灰显口径；自带 tli_epoch 可解析时时刻平移到
 *  et 绝对基准并给出 chip 时刻，否则相对时刻、chip 为 null。
 *  无轨迹快照（降级传播失败）返回 null，调用方计数提示、面板仍列参数。 */
/** A (non-selected) top-N candidate → a canvas arc + its TLI moment (#430):
 * the synodic segment is normalized onto the canvas as usual; a candidate's
 * own trajectory_gcrs_km (the #477 wiring, once the e2m2e side ships it)
 * rides along as the inertial segment, absent staying the inertial-view gray
 * convention; a parseable tli_epoch shifts times onto the et absolute basis
 * and yields the chip moment, otherwise times stay relative and the chip is
 * null. No trajectory snapshot (a failed degraded propagation) returns null —
 * the caller counts it for the hint while the panel still lists parameters. */
export function transferCandidateToArcData(
  candidate: TransferCandidateInput,
  label: string,
): { data: TrajectoryData; tliEt: number | null } | null {
  const trajectory = candidate.trajectory;
  if (!Array.isArray(trajectory) || trajectory.length === 0) return null;
  // 候选自带历元原样透传（字符串＝UTC、数＝JD_TDB，与 live 路径同口径），
  // chip 时刻在此单独换算到 et 秒。
  // The candidate's own epoch passes through as-is (string = UTC, number =
  // JD_TDB — the same convention as the live path); the chip moment converts
  // to et seconds separately here.
  const rawEpoch =
    typeof candidate.tli_epoch === "string" || typeof candidate.tli_epoch === "number"
      ? candidate.tli_epoch
      : undefined;
  const tliEt = rawEpoch !== undefined ? etFromEpoch(rawEpoch) : NaN;
  const data = transferTrajectoryToCanvasData(
    trajectory as number[][],
    candidate.trajectory_times,
    rawEpoch,
    label,
    Array.isArray(candidate.trajectory_gcrs_km)
      ? (candidate.trajectory_gcrs_km as number[][])
      : undefined,
  );
  return { data, tliEt: Number.isFinite(tliEt) ? tliEt : null };
}

/** 轨道预报响应 → 画布轨迹（#421 修复，#428 更新）。position_km 是
 *  GCRS 惯性 km，÷DU_KM 缩放后按惯性系几何如实绘制；times_jd_tdb →
 *  et 绝对基准。数据系标签 inertial_km 驱动视图系分流（#431/#428）：
 *  惯性视图下正常呈现，会合视图下保持既有混画（图例数据系标注已区分）。
 *  stateFrame（e2m2e ADR 0040 词表）可解析时按标签映射数据系，缺省/未知
 *  回退 inertial_km 硬编码（#477 前端接线，等 e2m2e 扩展该字段）。 */
/** Orbit-propagation response → canvas data (#421 fix, updated by #428).
 *  position_km is GCRS inertial km: after ÷DU_KM scaling it draws honestly
 *  as inertial-frame geometry; times_jd_tdb → the et absolute basis. The
 *  inertial_km data-frame tag drives view-frame routing (#431/#428): proper
 *  rendering in the inertial view, legacy co-drawing in the synodic view
 *  (the data-frame legend note already distinguishes them). A parseable
 *  stateFrame (the e2m2e ADR 0040 vocabulary) maps the frame tag; absent or
 *  unknown falls back to the inertial_km hardcode (#477 frontend wiring,
 *  pending the e2m2e-side field). */
export function propagationToCanvasData(
  positionKm: unknown,
  timesJdTdb: unknown,
  label = "轨道预报",
  stateFrame?: unknown,
): TrajectoryData | null {
  if (!Array.isArray(positionKm) || positionKm.length === 0 || !Array.isArray(positionKm[0])) {
    return null;
  }
  const pts = (positionKm as number[][]).map((p) => [
    Number(p[0]) / DU_KM,
    Number(p[1]) / DU_KM,
    Number(p[2]) / DU_KM,
  ]);
  const jds = Array.isArray(timesJdTdb) ? (timesJdTdb as unknown[]).map(Number) : null;
  const etTimes =
    jds && jds.length === pts.length && jds.every((v) => Number.isFinite(v))
      ? jds.map((jd) => etFromJdTdb(jd))
      : null;
  return {
    trajectories: [pts],
    times: etTimes ? [etTimes] : [],
    timeBasis: [etTimes ? "et" : "none"],
    frames: [stateFrameToDataFrameTag(stateFrame) ?? "inertial_km"],
    labels: [label],
  };
}

/** e2m2e state_frame 标签（ADR 0040 词表）→ 数据系标签映射；未知值/缺省
 *  返回 null（调用方回退硬编码）。#477 前端接线：e2m2e 侧把 state_frame
 *  扩展到 orbit_propagation 响应前，propagation 数据系仍是硬编码。 */
/** An e2m2e state_frame label (the ADR 0040 vocabulary) → a data-frame tag;
 *  unknown/absent returns null (callers fall back to the hardcode). The #477
 *  frontend wiring: until e2m2e extends state_frame to orbit_propagation
 *  responses, the propagation frame stays hardcoded. */
function stateFrameToDataFrameTag(stateFrame: unknown): DataFrameTag | null {
  if (typeof stateFrame !== "string") return null;
  if (stateFrame === "gcrs_km" || stateFrame === "force_model_state") return "inertial_km";
  if (stateFrame === "synodic_barycentric_km") return "synodic_km";
  return null;
}

/** EphemerisTable 的 UTC 分量（year..second 各 (n,)）→ et 秒数组；分量缺失、
 *  行数与 n 不齐或含非有限值 → null（该轨迹保持无时刻基准）。导出供
 *  catalogApi 复用（catalog_get 记录的 eph/ 段与 EphemerisTable 同形）。 */
/** EphemerisTable's UTC components (year..second, each (n,)) → et seconds;
 *  null when components are missing, misaligned with n, or non-finite.
 *  Exported for catalogApi (the catalog_get record's eph/ segment shares
 *  EphemerisTable's shape). */
export function ephemerisUtcToEt(ephemeris: Record<string, unknown>, n: number): number[] | null {
  const parts = ["year", "month", "day", "hour", "minute", "second"].map(
    (k) => ephemeris[k],
  ) as unknown[][];
  if (parts.some((p) => !Array.isArray(p) || p.length !== n)) return null;
  const p2 = (v: unknown) => String(Math.trunc(Number(v))).padStart(2, "0");
  const out = (parts[0] as unknown[]).map((_, i) =>
    etFromEpoch(
      `${p2(parts[0][i])}-${p2(parts[1][i])}-${p2(parts[2][i])}T` +
        `${p2(parts[3][i])}:${p2(parts[4][i])}:${p2(parts[5][i])}`,
    ),
  );
  return out.every(Number.isFinite) ? out : null;
}

/** (n,3) 嵌套或 (3n,) 平铺 → (n,3) 行；行数不对齐返回 null。不做任何
 *  缩放——synodic_position 已是画布原生无量纲，position_km 的 ÷DU_KM 在
 *  调用侧补。 */
/** (n,3) nested or (3n,) flattened → (n,3) rows; misaligned row count is
 *  null. No scaling here — synodic_position is already the canvas-native
 *  dimensionless; position_km's ÷DU_KM happens at the call site. */
function rows3(raw: unknown, n: number): number[][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0])) {
    return raw.length === n
      ? raw.map((p) => [Number((p as number[])[0]), Number((p as number[])[1]), Number((p as number[])[2])])
      : null;
  }
  if (raw.length === 3 * n) {
    return Array.from({ length: n }, (_, i) => [
      Number(raw[3 * i]),
      Number(raw[3 * i + 1]),
      Number(raw[3 * i + 2]),
    ]);
  }
  return null;
}

/** 星历段的 GCRS 惯性位置 → DU 归一点列（eph-fig）。兼容两种来源形状：
 *  设计响应 EphemerisTable 的 (n,3) 嵌套与记录通道的 (3n,) 平铺；行数与
 *  会合系轨迹对齐才返回，缺位/不对齐返回 null（惯性视图降级灰显口径，
 *  与 transfer gcrs 段一致）。 */
/** An ephemeris segment's GCRS inertial positions → DU-normalized points
 *  (eph-fig). Accepts both source shapes — the design response's (n,3)
 *  nested EphemerisTable and the record channel's flattened (3n,) — and
 *  returns only when row-aligned with the synodic trajectory; a missing or
 *  misaligned segment is null (the inertial view's degraded graying, same
 *  convention as the transfer gcrs segment). */
function positionKmToDu(raw: unknown, n: number): number[][] | null {
  const rows = rows3(raw, n);
  return rows ? rows.map((p) => [p[0] / DU_KM, p[1] / DU_KM, p[2] / DU_KM]) : null;
}

/** 设计响应 / 库记录的星历段 → 画布轨迹（修"画布只见周期曲线"）。
 *  synodic_position 是地月会合系无量纲——画布原生系，直画不缩放；形状兼容
 *  设计响应 EphemerisTable 的 (n,3) 嵌套与库记录通道（get_artifact
 *  Vec<f32>）的 (3n,) 平铺，行数不齐整段不上（与 position_km 同口径）。
 *  UTC 分量行数对齐则逐行合成 et 绝对基准（ADR 0021）。GCRS position_km
 *  作惯性几何随行携带（eph-fig）：惯性视图下改用它绘制并豁免灰显
 *  （#428 inertialGeometries 通道），会合视图不消费。
 *  入参与 e2m2e EphemerisTable 字段同名（设计响应 ephemeris dict 与库记录
 *  eph/ 段同形）。 */
/** A design response / catalog record's ephemeris segment → canvas data
 *  (fixes "canvas shows only the periodic curve"). synodic_position is the
 *  Earth-Moon synodic-frame dimensionless — the canvas' native frame, drawn
 *  as-is without scaling; shapes accepted: the design response's (n,3)
 *  nested EphemerisTable and the record channel's flattened (3n,) (get_artifact's
 *  Vec<f32>), misaligned rows drop the whole segment (same convention as
 *  position_km). Row-aligned UTC components compose the et absolute basis
 *  (ADR 0021). The GCRS position_km rides along as the inertial geometry
 *  (eph-fig): the inertial view draws from it and exempts graying (the #428
 *  inertialGeometries channel); the synodic view never consumes it. Field
 *  names match e2m2e's EphemerisTable (the design response ephemeris dict and
 *  the record eph/ segment share the shape). */
export function designEphemerisToCanvasData(
  ephemeris: Record<string, unknown> | null | undefined,
  label = "星历段",
): TrajectoryData | null {
  const rawRows = ephemeris?.synodic_position;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;
  // 行数：UTC 分量齐且等长时以分量为准（时间与位置同源，缺一行都是半截
  // 数据）；嵌套形状回退行数（设计响应通道旧行为：无分量的段仍可画，只是
  // 无时刻基准）。平铺形状必须伴随齐整分量——记录通道的 (3n,) 半截数据
  // 宁可不上（与 Rust 七键齐全才携带、ephemerisSpanDays 同口径）。
  // Row count: the aligned UTC components win when complete (times and
  // positions share one source; half-segments stay off); nested shapes fall
  // back to their row count (the design channel's old behavior: a segment
  // without components still draws, just untimed). Flattened shapes require
  // aligned components — a truncated (3n,) record-channel payload stays off
  // (same convention as Rust shipping all seven keys, and ephemerisSpanDays).
  const utc = ["year", "month", "day", "hour", "minute", "second"].map(
    (k) => ephemeris?.[k],
  );
  const byComponents =
    utc.every((p) => Array.isArray(p)) &&
    new Set(utc.map((p) => (p as unknown[]).length)).size === 1
      ? (utc[0] as unknown[]).length
      : null;
  const nested = Array.isArray(rawRows[0]);
  const n = byComponents ?? (nested ? rawRows.length : 0);
  if (!n) return null;
  const pts = rows3(rawRows, n);
  if (!pts) return null;
  const etTimes = ephemerisUtcToEt(ephemeris as Record<string, unknown>, n);
  const inertialPts = positionKmToDu(ephemeris?.position_km, n);
  return {
    trajectories: [pts],
    times: [etTimes ?? []],
    timeBasis: [etTimes ? "et" : "none"],
    frames: ["synodic_nd"],
    labels: [label],
    ...(inertialPts ? { inertialGeometries: [inertialPts] } : {}),
    roles: ["ephemeris"],
  };
}

/** 绘制内容过滤的保留掩码（eph-fig）：all 全保留；其余模式保留无段语义
 *  或匹配角色的行。filterByRole 与画布装配处的并行数组（来源标注等，
 *  #476）共用同一掩码，防口径漂移。 */
/** The keep-mask behind content filtering (eph-fig): all keeps every row;
 *  other modes keep untagged rows and rows with the matching role. Shared by
 *  filterByRole and the parallel arrays assembled canvas-side (source tags
 *  etc., #476) so the rule cannot drift. */
export function roleKeepMask(data: TrajectoryData, mode: ContentMode): boolean[] {
  if (mode === "all") return data.trajectories.map(() => true);
  return (data.roles ?? data.trajectories.map(() => undefined)).map(
    (r) => r === undefined || r === mode,
  );
}

/** 绘制内容过滤（eph-fig）：cr3bp / ephemeris 模式下保留对应角色与未标注
 *  轨迹，all 原样返回。所有行对齐数组同步裁剪，保持逐条对齐关系。 */
/** Content filtering (eph-fig): cr3bp / ephemeris modes keep the matching
 *  roles plus untagged trajectories; all returns the data untouched. Every
 *  row-aligned array is trimmed in step so alignment survives. */
export function filterByRole(data: TrajectoryData, mode: ContentMode): TrajectoryData {
  if (mode === "all") return data;
  const keep = roleKeepMask(data, mode);
  const pick = <T,>(arr: T[] | undefined): T[] | undefined =>
    arr ? arr.filter((_, i) => keep[i]) : undefined;
  return {
    ...data,
    trajectories: data.trajectories.filter((_, i) => keep[i]),
    times: data.times.filter((_, i) => keep[i]),
    timeBasis: pick(data.timeBasis),
    frames: pick(data.frames),
    labels: pick(data.labels),
    jacobi: pick(data.jacobi),
    inertialGeometries: pick(data.inertialGeometries),
    roles: pick(data.roles),
  };
}

/** 库记录的 familyMembers（(1,6) 初态或 (n,6) 状态）→ 轨迹 + 时刻。
 *  recordJacobi 是记录级 Jacobi（设计轨道等单条记录），成员未自带
 *  jacobi 时兜底；成员值优先（族记录逐成员各异，CONTEXT.md 族记录）。 */
/** A catalog record's familyMembers ((1,6) initial states or (n,6) states) →
 *  trajectories + times. recordJacobi is the record-level Jacobi (single-orbit
 *  design records), falling back only when a member carries none; a member's
 *  own value wins (family records differ member-by-member). */
export function familyMembersToTrajectoryData(
  members: FamilyMember[],
  mu: number,
  recordJacobi?: number | null,
): TrajectoryData {
  const trajectories: number[][][] = [];
  const times: number[][] = [];
  const timeBasis: TimeBasis[] = [];
  const frameTags: DataFrameTag[] = [];
  const jacobi: (number | undefined)[] = [];
  const fallback = finiteOrUndefined(recordJacobi);
  for (const [i, m] of members.entries()) {
    const memberJacobi = finiteOrUndefined(m.jacobi) ?? fallback;
    if (m.states.length === 6) {
      if (m.period) {
        const pts = propagate(
          mu,
          { orbitId: `member-${i}`, mu, period: m.period, state: m.states.slice(0, 6) as [number, number, number, number, number, number] },
          PROPAGATION_STEPS,
        );
        trajectories.push(pts);
        times.push(linspaceByPeriod(m.period, pts.length));
        timeBasis.push("relative");
        frameTags.push("synodic_nd");
        jacobi.push(memberJacobi);
      }
    } else if (m.states.length > 6 && m.states.length % 6 === 0) {
      const pts = chunksOf(m.states, 6, 3);
      trajectories.push(pts);
      times.push(matchingTimes(m.times.map(Number), pts.length));
      timeBasis.push("relative");
      frameTags.push("synodic_nd");
      jacobi.push(memberJacobi);
    } else if (m.states.length % 3 === 0) {
      const pts = chunksOf(m.states, 3, 3);
      trajectories.push(pts);
      times.push(matchingTimes(m.times.map(Number), pts.length));
      timeBasis.push("relative");
      frameTags.push("synodic_nd");
      jacobi.push(memberJacobi);
    }
  }
  return { trajectories, times, timeBasis, frames: frameTags, jacobi };
}

/** 全局时刻范围（多条轨迹取端点）；空则 null，时间轴保持禁用。
 *  端点按每条轨迹的全量 min/max 取，不假设数组按时间递增：orbit_propagation
 *  的 direction=backward（5.9.7）给出递减时刻序列，取 t[0]/t[last] 会得到
 *  倒置区间，把时间轴与动画导出打成空区间。 */
/** Global time range (endpoints across trajectories); null when empty, keeping
 *  the timeline disabled. Endpoints come from each trajectory's full min/max and
 *  never assume ascending times: orbit_propagation's direction=backward (5.9.7)
 *  yields descending time series, where reading t[0]/t[last] produces an inverted
 *  interval and collapses the timeline and animation export. */
export function trajectoryTimeRange(times: number[][]): [number, number] | null {
  if (times.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const t of times) {
    for (const value of t) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

/** 时间轴的全局时刻模式（ADR 0021 修订）：任一 et 产物在屏 → 全局 et 钟；
 *  全部无 et 但存在相对时刻 → 相对模式；否则 null（时间轴禁用）。
 *  相对与绝对不混排：et 模式下相对/无基准轨迹不参与时刻走查。 */
/** The timeline's global time mode (ADR 0021 revision): any et product on
 *  screen → global et clock; relative times with no et → relative mode;
 *  otherwise null (timeline disabled). Relative and absolute never mix: in
 *  et mode, relative/untimed trajectories stay out of the time walkthrough. */
export function timelineMode(data: TrajectoryData): "et" | "relative" | null {
  const basis = data.timeBasis ?? data.trajectories.map(() => "relative" as TimeBasis);
  if (basis.includes("et")) return "et";
  const hasRelative = data.times.some((t) => t.length > 0);
  return hasRelative ? "relative" : null;
}

/** et 模式下的画布时刻数据：et 轨迹保留时刻，其余置空（marker 隐藏）。 */
/** Canvas time data in et mode: keep et trajectories' times, blank the rest (markers hide). */
export function timesForMode(data: TrajectoryData, mode: "et" | "relative" | null): number[][] {
  if (mode === null) return data.times.map(() => []);
  const basis = data.timeBasis ?? data.trajectories.map(() => "relative" as TimeBasis);
  return data.times.map((t, i) => (mode === "et" && basis[i] !== "et" ? [] : t));
}
