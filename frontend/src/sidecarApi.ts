// sidecar 前端封装：Tauri command 调用 + 类型。
// Frontend wrappers for the sidecar: Tauri command calls plus types.

export interface FamilyMember {
  states: number[]; // n×6 状态（初态帧时 n=1）
  times: number[];
  period: number | null;
  /** 该成员的 Jacobi 常数（族记录通道，#435）；无值为 null */
  /** The member's Jacobi constant (family-record channel, #435); null when absent. */
  jacobi?: number | null;
}

/** 记录的星历段（eph/ 前缀数组）：会合系无量纲位置 (n,3) 平铺 + UTC 分量；
 *  position_km 是 GCRS 惯性位置 (n,3) 平铺（eph-fig，旧记录缺位为 null）。
 *  键名与 e2m2e EphemerisTable 一致（snake_case，与设计响应 ephemeris 同形），
 *  解析走 trajectoryParsing.designEphemerisToCanvasData。 */
export interface EphemerisSegment {
  synodic_position: number[];
  /** GCRS 惯性位置 (n,3) 平铺（eph-fig）；旧记录缺键/行数不齐为 null */
  /** GCRS inertial positions (n,3) flattened (eph-fig); null for legacy
   * records missing the key or misaligned. */
  position_km?: number[] | null;
  year: number[];
  month: number[];
  day: number[];
  hour: number[];
  minute: number[];
  second: number[];
}

export interface ArtifactData {
  recordId: string;
  orbitFamily: string;
  memberCount: number;
  mu?: number | null;
  familyMembers?: FamilyMember[];
  members: number[][]; // 每成员 n×3 xyz
  /** 记录级 Jacobi 常数（设计轨道记录通道，#435）：设计记录是该轨道唯一值；
   *  族记录为包络下限（成员值优先、缺值时回退本值）；无 CR3BP 段为 null */
  /** Record-level Jacobi constant (design-orbit record channel, #435): the orbit's
   *  only value for design records; the envelope floor for family records (a member's
   *  own value wins, this fills in when missing); null without a CR3BP segment. */
  jacobi?: number | null;
  ephemeris?: EphemerisSegment | null;
  /** 转移段（#428 第二步）：states/times 会合系物理 km/km/s 与 TLI 起算秒，
   *  gcrsStates 惯性段（旧记录缺位为 null）；非转移记录为 null */
  /** The transfer segment (#428 step 2): states/times in rotating-frame physical
   *  km/km/s and seconds since TLI, plus gcrsStates (the inertial segment, null
   *  for legacy records); null for non-transfer records. */
  transfer?: TransferSegment | null;
  error: { code: string; message: string } | null;
}

export interface TransferSegment {
  states: number[][]; // (n,6) 行
  times: number[]; // TLI 起算秒（秒，seconds since TLI）
  gcrsStates?: number[][] | null;
  tliEpoch?: string | number | null; // UTC 字符串或 JD_TDB 浮点，原样透传（UTC string or JD_TDB float, passed through as-is）
  transferType?: string | null;
  deltaVKmS?: number | null;
}

/** 转移机动的结构化事件（e2m2e #575 契约，5.9.7 起进响应）。
 *  kind 为开放枚举：departure（出发脉冲）/ perilune（近月点旗标）/
 *  arrival（到达脉冲）…；t_sec 为 TLI 起算秒（t=0 即出发脉冲，与
 *  trajectory_times 同基准）；非脉冲事件（perilune）的 dv_km_s 为 0。 */
/** Structured maneuver events of a transfer (e2m2e #575 contract, in the response
 *  since 5.9.7). kind is an open enum: departure / perilune (a flag, not a pulse) /
 *  arrival / …; t_sec is TLI-based (t=0 is the departure pulse, the same basis as
 *  trajectory_times); a non-pulse event carries dv_km_s = 0. */
export interface ManeuverEvent {
  kind: string;
  t_sec: number;
  dv_km_s: number;
  note?: string | null;
}

/** 达成的月心 B 平面参数（#635；仅 PCN 路径填充，其余为 null）。
 *  perilune_alt_km = 近月点半径 − 月球平均半径：交会解为月面以上正值，
 *  撞月解为负值。 */
/** The achieved lunar B-plane parameters (#635; PCN only, null otherwise).
 *  perilune_alt_km = perilune radius − mean lunar radius: positive above the
 *  surface for a rendezvous solution, negative for a lunar-impact one. */
export interface BplaneInfo {
  v_inf_km_s: number;
  c3_km2_s2: number;
  rha_deg: number;
  dha_deg: number;
  bdot_r_km: number;
  bdot_t_km: number;
  b_mag_km: number;
  theta_deg: number;
  perilune_alt_km: number;
}

/** 实际使用的出发双曲渐近线（#635；仅 PCN 填充，与请求同 schema 回显实际值） */
/** The departure hyperbolic asymptote actually used (#635; PCN only, same schema
 *  as the request, echoing the realised values). */
export interface DepartureAsymptoteInfo {
  rha_deg: number;
  dha_deg: number;
  c3_km2_s2: number;
}

export async function getArtifact(recordId: string): Promise<ArtifactData> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("get_artifact", { recordId });
}

export interface ToolFrame { dtype: "f32" | "f64"; shape: number[]; data: number[]; }
export interface ToolResponse { data: Record<string, unknown>; frames: ToolFrame[]; error: { code: string; message: string } | null; }

/** sidecar 错误 → 用户可读文案（#450）：优先 message，缺失回退 code，
 *  再缺失才整体序列化。null/undefined 返回空串，由调用方拼前缀。
 * Sidecar error → user-readable text (#450): prefer the message, fall back
 * to the code, then whole-object serialization. null/undefined yields "" —
 * callers append their own prefix. */
export function formatToolError(
  error: { code: string; message: string } | null | undefined,
): string {
  if (!error) return "";
  if (typeof error.message === "string" && error.message.trim()) return error.message;
  if (typeof error.code === "string" && error.code.trim()) return error.code;
  return JSON.stringify(error);
}

export async function runTool(
  tool: string, arguments_: Record<string, unknown>, binaryDtype?: "f32" | "f64", artifact?: { artifactType: string; label: string; orbitType?: string },
): Promise<ToolResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("run_tool", { tool, arguments: arguments_, binaryDtype, artifact });
}

/** 星历内核配置状态（自动配置：随 git/安装包分发，正常永远就绪）。 */
/** Ephemeris kernel config status (auto-configured: ships with git/the installer, normally always ready). */
export interface EphemerisStatus {
  kernelDir: string | null;
  files: string[];
  ephemerisReady: boolean;
  leapsecondReady: boolean;
  usable: boolean;
}

export async function ephemerisStatus(): Promise<EphemerisStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("ephemeris_status");
}
