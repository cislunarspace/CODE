// Three.js 主画布
// The main Three.js canvas.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ChartSettings } from "./chartSettings";
import { EARTH_RADIUS_DU, MOON_RADIUS_DU } from "./chartSettings";
import { COOLWARM_STOPS } from "./jacobiColormap";
import { trajectoryColorsHex, desaturateHex, grayedFlags } from "./orbitListItems";
import { pickNearestTrajectory, pickThresholdFromSize, lineOpacity } from "./picking";
import type { RegionElement } from "./regionLayer";
import type { DataFrameTag } from "./trajectoryParsing";
import { moonPositionAt, type MoonTrack } from "./moonEphemeris";
import earthTextureUrl from "./assets/earth_2048.jpg";
import moonTextureUrl from "./assets/moon_1024.jpg";

export type ProjectionMode = "3d" | "xy" | "xz" | "yz";
/** 视图系（ADR 0013：synodic 会合默认 | inertial 地心惯性 GCRS）。视图
 *  系是用户的显示选择，不随数据走、不改任何数据数值与时刻语义；数据自
 *  带的坐标系叫数据系（DataFrameTag，CONTEXT.md 术语边界）。 */
/** The view frame (ADR 0013: synodic default | inertial geocentric GCRS).
 *  A view frame is the user's display choice — it never rides the data and
 *  changes no data value or time semantics; the frame riding the data is the
 *  data frame (DataFrameTag, per CONTEXT.md's term boundary). */
export type FrameMode = "synodic" | "inertial";
export type CenterMode = "barycenter" | "earth" | "moon" | "l1" | "l2";

/** 轨迹色循环缺省值（与渲染 effect、轨道清单共用同一循环口径） */
/** Default trajectory color cycle (shared verbatim by the render effect and the orbit list). */
export const DEFAULT_COLOR_CYCLE = ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3"];

/** 聚焦淡出线的不透明度（#452）：其余轨迹降到此值，被聚焦线保持 1 */
/** The dimmed opacity for unfocused lines (#452): the rest fade to this
 *  value while the focused line stays at 1. */
export const FOCUS_DIM_OPACITY = 0.15;

/** 拖拽判定位移阈值（px，#452）：pointerdown/up 间超过此距离视为拖拽 */
/** The drag-detection displacement threshold (px, #452): a pointerdown/up
 *  pair beyond it is a drag. */
const DRAG_THRESHOLD_PX = 5;

export interface OrbitCanvasProps {
  trajectories: number[][][];
  times?: number[][];
  currentEt?: number | null;
  mu: number;
  libration: { label: string; x: number }[];
  projection: ProjectionMode;
  center: CenterMode;
  settings?: ChartSettings;
  /** 画布背景色（hex）；缺省深色 */
  /** Canvas background color (hex); dark by default. */
  background?: string;
  /** 与 trajectories 逐条对齐的标签；缺省项不进左侧轨道清单（#469），
   *  拾取提示也只对有标签轨迹显示（#452） */
  /** Row-aligned trajectory labels; omitted entries stay out of the sidebar
   *  orbit list (#469), and the pick tooltip only shows for labeled ones (#452). */
  labels?: string[];
  /** 与 trajectories 逐条对齐的 Jacobi 常数；undefined 项 = 无值，该轨迹
   *  回退色环循环取色（#435）。归一化按有值轨迹的 min/max。 */
  /** Jacobi constant per trajectory (row-aligned); undefined entries fall back
   *  to the color cycle (#435). Normalization follows the min/max of valued ones. */
  jacobi?: (number | undefined)[];
  /** 地月空间分区图层（regionLayer 解析产物；不参与视图适配） */
  /** Cislunar partition region layer (parsed by regionLayer; excluded from view fitting). */
  regions?: RegionElement[];
  /** 视图系（#428 第一步）：synodic 下全部现有行为逐项不变；inertial 下
   *  地球居原点、月球沿 moonTrack 移动、会合系数据系产物灰显、平动点
   *  与分区图层隐藏、居中偏移收敛到原点。 */
  /** The view frame (#428 step 1): synodic keeps every existing behavior
   *  item-for-item; inertial puts Earth at the origin, moves the Moon along
   *  moonTrack, grays synodic data-frame products, hides libration points
   *  and the region layer, and collapses centering offsets to the origin. */
  frame?: FrameMode;
  /** 与 trajectories 逐条对齐的数据系标签：惯性视图下 synodic_* 产物灰显
   *  （inertial_km 正常呈现）；缺省按 synodic_nd 解释（画布既有轨迹全
   *  会合系）。 */
  /** Data-frame tags row-aligned with trajectories: synodic_* products gray
   *  out in the inertial view (inertial_km renders properly); omitted entries
   *  read as synodic_nd (every legacy canvas trajectory is synodic). */
  dataFrames?: DataFrameTag[];
  /** 惯性视图的月球轨迹（moonEphemeris 产物，DU 单位）；null = 上游不可
   *  用，月球隐藏（ADR 0013 离线降级先例）。仅 frame=inertial 时消费。 */
  /** The Moon's track for the inertial view (moonEphemeris output, DU);
   *  null = upstream unavailable, the Moon hides (the ADR 0013 offline
   *  degradation precedent). Consumed only when frame=inertial. */
  moonTrack?: MoonTrack | null;
  /** 与 trajectories 逐条对齐的惯性几何（DU 归一）：转移弧的 gcrs 段
   *  （#428 第二步）——同一物理弧的第二份数据，惯性视图下改用它绘制
   *  （线、标记、视图适配同源），灰显判定豁免；null/缺项 = 无惯性段
   *  （降级灰显）。会合视图不消费。 */
  /** Inertial geometry row-aligned with trajectories (DU-normalized): the
   *  transfer arc's gcrs segment (#428 step 2) — a second copy of the same
   *  physical arc, drawn from it in the inertial view (lines, markers, and
   *  view fitting all share it), exempt from graying; null / a missing entry
   *  = no inertial segment (degraded graying). Unused in the synodic view. */
  inertialGeometries?: (number[][] | null)[];
  /** 聚焦/预览态（#460，#469 起受控）：图注迁到左侧轨道清单后，状态由
   *  App 持有，清单交互与画布拾取（#452）写同一状态、双向一致。缺省回
   *  退组件内部 state（测试等无受控场景）。 */
  /** Focus/preview state (#460; controlled since #469): with the legend moved
   *  to the sidebar orbit list, App owns the state so list interactions and
   *  canvas picking (#452) write the same state and stay consistent both ways.
   *  Falls back to internal state when uncontrolled (tests etc.). */
  focusIndex?: number | null;
  previewIndex?: number | null;
  onFocusIndexChange?: (i: number | null) => void;
  onPreviewIndexChange?: (i: number | null) => void;
  onReady?: (api: CanvasApi) => void;
}

export interface CanvasApi {
  fitView: () => void;
  canvasElement: () => HTMLCanvasElement | null;
  setAutoRotate: (on: boolean, speed?: number) => void;
}


export function OrbitCanvas({
  trajectories,
  times,
  currentEt,
  mu,
  libration,
  projection,
  center,
  settings,
  background,
  labels,
  jacobi,
  regions,
  frame,
  dataFrames,
  moonTrack,
  inertialGeometries,
  focusIndex,
  previewIndex,
  onFocusIndexChange,
  onPreviewIndexChange,
  onReady,
}: OrbitCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const annotationsRef = useRef<THREE.Group | null>(null);
  const regionsRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const markersRef = useRef<THREE.Mesh[]>([]);
  // 拾取与聚焦（#452）：orbitLinesRef 是可拾取的轨迹线集合（绘制顺序与
  // labels 对齐），pickThresholdRef 由轨迹包围盒尺寸推导（逐次重建更新），
  // focusIdxRef 同步聚焦态供绘制 effect 与事件闭包读取。
  // Picking & focus (#452): orbitLinesRef is the pickable line set (draw order
  // aligned with labels), pickThresholdRef derives from the trajectory bounding
  // box per rebuild, focusIdxRef mirrors the focus state for the draw effect
  // and the event closures.
  const orbitLinesRef = useRef<THREE.Line[]>([]);
  const pickThresholdRef = useRef(0.02);
  const focusIdxRef = useRef<number | null>(null);
  const downPointRef = useRef<{ x: number; y: number } | null>(null);
  const pickPendingRef = useRef(false);
  // 受控/非受控混合（#469）：App 传受控 props 时状态由 App 持有（轨道清
  // 单与画布拾取写同一状态），否则回退内部 state。
  // Controlled/uncontrolled hybrid (#469): when App passes the controlled
  // props the state lives in App (the orbit list and canvas picking write the
  // same state); otherwise fall back to internal state.
  const [innerFocusIdx, setInnerFocusIdx] = useState<number | null>(null);
  const focusIdx = focusIndex ?? innerFocusIdx;
  const setFocusIdx = onFocusIndexChange ?? setInnerFocusIdx;
  const [hoverTip, setHoverTip] = useState<{ index: number; x: number; y: number } | null>(null);
  // 轨道清单联动（#460）：悬停清单项的预览态，与聚焦正交（预览不改写聚焦）
  // Orbit-list linking (#460): the hover-preview state of list items,
  // orthogonal to focus (previewing never rewrites focus).
  const [innerPreviewIdx, setInnerPreviewIdx] = useState<number | null>(null);
  const previewIdx = previewIndex ?? innerPreviewIdx;
  const setPreviewIdx = onPreviewIndexChange ?? setInnerPreviewIdx;
  const previewIdxRef = useRef<number | null>(null);
  // onReady 走 ref：建场景 effect 依赖 []，调用方传内联函数（如
  // App 的 onReady={(a) => setApi(a)}）不会触发场景重建导致轨迹丢失。
  // onReady goes through a ref: the scene-building effect depends on [], so an inline callback from the caller (e.g.
  // App's onReady={(a) => setApi(a)}) never triggers a scene rebuild that would lose trajectories.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // 按需渲染的排帧器（建场景 effect 内赋值）：各绘制/标记 effect 改动
  // 场景后调用它请求一帧；相机变化由 OrbitControls change 事件驱动。
  // The on-demand frame scheduler (assigned in the scene effect): draw/marker
  // effects call it after mutating the scene; camera changes ride the
  // OrbitControls change event.
  const invalidateRef = useRef<() => void>(() => {});

  // labels 同步走 ref：拾取事件闭包只建一次（建场景 effect），读取的
  // 始终是最新标签（与 onReadyRef 同一模式）。
  // labels ride a ref: the pick event closures are built once with the scene
  // effect and always read the latest labels (same pattern as onReadyRef).
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  focusIdxRef.current = focusIdx;
  previewIdxRef.current = previewIdx;

  /** 显示态 → 逐线不透明度（#460）：预览优先于聚焦，透明度变更不重建几何。 */
  /** Display state → per-line opacity (#460): preview wins over focus; opacity
   *  changes never rebuild geometry. */
  const applyDisplayOpacity = () => {
    orbitLinesRef.current.forEach((line, i) => {
      const m = line.material as THREE.LineBasicMaterial;
      m.transparent = true;
      m.opacity = lineOpacity(i, focusIdxRef.current, previewIdxRef.current, FOCUS_DIM_OPACITY);
    });
  };
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    // 缺省深色；白底等主题由 background prop 驱动（见下方 effect）
    // Dark by default; themes like white background are driven by the background prop (see the effect below).
    scene.background = new THREE.Color(background ?? "#121212");

    // 光照：太阳平行光（晨昏线）+ 环境光（夜面可辨），照亮真实贴图天体
    // Lighting: a directional sun light (terminator line) plus ambient light (night side stays visible), illuminating the textured bodies.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
    sun.position.set(3, 2, 4);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 1e-4, 100);
    camera.position.set(1.5, -1.5, 1);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // 旋转手感用 OrbitControls 默认方向（拖拽移动相机）；旧版反转手感（rotateSpeed 取负）
    // 已于 2026-08-29 决策废弃，仅平移/缩放行为不变。
    // Rotation keeps the OrbitControls default direction (dragging moves the camera); the legacy inverted
    // feel (negative rotateSpeed) was dropped by decision on 2026-08-29; panning/zooming are unchanged.
    controlsRef.current = controls;

    const content = new THREE.Group();
    content.name = "orbits"; // 仅供测试定位：fitView 只按轨道范围适配
    contentRef.current = content;
    scene.add(content);

    // 标注组（天体/平动点/坐标轴/网格）：与 content 同偏移，但不参与视图适配
    // Annotation group (bodies/libration points/axes/grid): same offset as content, but excluded from view fitting.
    const annotations = new THREE.Group();
    annotations.name = "annotations";
    annotationsRef.current = annotations;
    scene.add(annotations);

    // 分区组（地月空间分区边界）：与 annotations 同偏移、同样不参与视图适配
    // Region group (cislunar partition boundaries): same offset as annotations, also excluded from view fitting.
    const regionsGroup = new THREE.Group();
    regionsGroup.name = "regions";
    regionsRef.current = regionsGroup;
    scene.add(regionsGroup);

    const resize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      invalidateRef.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // 按需渲染：不空转。相机变化由 OrbitControls 的 change 事件排帧——
    // 拖拽/缩放/阻尼/自转期间 update() 持续改动相机、事件持续触发，静止
    // 即停；场景变化由各绘制/标记 effect 经 invalidateRef 显式排帧。
    // WebView（WebKitGTK）每帧有固定管线开销，空闲重绘纯属浪费算力。
    // On-demand rendering: no idle spinning. Camera changes schedule frames
    // via OrbitControls' change event — update() keeps moving the camera
    // while dragging/zooming/damping/spinning and stops when still; scene
    // changes schedule explicitly via invalidateRef from the draw/marker
    // effects. WebViews (WebKitGTK) pay a fixed per-frame pipeline cost, so
    // idle redraws are pure waste.
    let frameId = 0;
    let renderPending = false;
    const invalidate = () => {
      if (renderPending) return;
      renderPending = true;
      frameId = requestAnimationFrame(() => {
        renderPending = false;
        controls.update();
        renderer.render(scene, camera);
      });
    };
    invalidateRef.current = invalidate;
    const onControlsChange = () => invalidate();
    controls.addEventListener("change", onControlsChange);
    invalidate();

    // —— 轨迹拾取（#452）：监听器只建一次，读取 ref；Raycaster 阈值
    // 由绘制 effect 按包围盒尺寸更新 ——
    // —— Trajectory picking (#452): listeners are built once and read refs;
    // the Raycaster threshold is updated by the draw effect from the
    // bounding-box size ——
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const pickAt = (e: MouseEvent): number | null => {
      const lines = orbitLinesRef.current;
      if (!camera || lines.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      raycaster.params.Line = { threshold: pickThresholdRef.current };
      const hits = raycaster.intersectObjects(lines, false);
      return pickNearestTrajectory(
        hits.map((h) => ({
          index: lines.indexOf(h.object as THREE.Line),
          distance: h.distance,
        })),
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      // 指针移动节流：一帧至多一次拾取判定，不拖慢渲染帧率
      // Throttle pointer moves: at most one pick per frame.
      if (pickPendingRef.current) return;
      pickPendingRef.current = true;
      requestAnimationFrame(() => {
        pickPendingRef.current = false;
        const idx = pickAt(e);
        // 无标签轨迹不提示（规格故事 2）：聚焦仍可用于任何轨迹
        // Unlabeled trajectories never show a tip (story 2); focus still
        // applies to any trajectory.
        setHoverTip(
          idx !== null && labelsRef.current?.[idx]
            ? { index: idx, x: e.offsetX, y: e.offsetY }
            : null,
        );
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      // 非主键（右键平移/中键）不参与拾取聚焦
      // Non-primary buttons (right-drag pan / middle) never pick or focus.
      if (e.button !== 0) return;
      downPointRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const down = downPointRef.current;
      downPointRef.current = null;
      // 拖拽（位移超阈值）不触发聚焦：视角旋转/缩放不受干扰
      // A drag beyond the threshold never focuses: view orbiting/zooming stays undisturbed.
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD_PX) return;
      const idx = pickAt(e);
      // 受控态（#469）下 setter 是 App 的回调，没有 updater 形参——prev 从
      // ref 读（每次渲染同步，见 focusIdxRef 赋值处）。
      // Under the controlled state (#469) the setter is App's callback with no
      // updater form — read prev from the ref (synced every render).
      setFocusIdx(idx !== null && focusIdxRef.current !== idx ? idx : null);
    };

    const onPointerLeave = () => setHoverTip(null);

    const el = renderer.domElement;
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);

    const fitView = () => {
      const box = new THREE.Box3().setFromObject(content);
      if (box.isEmpty()) return;
      box.expandByScalar(box.getSize(new THREE.Vector3()).length() * 0.05);
      const bCenter = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(bCenter);
      camera.position.copy(bCenter.clone().add(dir.multiplyScalar(dist)));
      camera.near = dist / 100;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
    };

    onReadyRef.current?.({
      canvasElement: () => renderer.domElement,
      setAutoRotate: (on, speed = 0.3) => {
        controls.autoRotate = on;
        controls.autoRotateSpeed = speed;
        // 开启自转后 update() 才会推相机，需排一帧让 change 事件接续成帧
        // Spinning only moves the camera inside update(), so schedule the
        // first frame for the change events to keep streaming.
        if (on) invalidate();
      },
      fitView: () => {
        fitView();
        invalidate();
      },
    });

    return () => {
      cancelAnimationFrame(frameId);
      controls.removeEventListener("change", onControlsChange);
      observer.disconnect();
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (projection === "xy") {
      camera.position.set(0, 0, 3);
      camera.up.set(0, 1, 0);
      controls.target.set(0, 0, 0);
    } else if (projection === "xz") {
      camera.position.set(0, -3, 0);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 0);
    } else if (projection === "yz") {
      camera.position.set(3, 0, 0);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 0);
    } else {
      camera.position.set(1.5, -1.5, 1);
      camera.up.set(0, 0, 1);
    }
    camera.updateProjectionMatrix();
    controls.update();
    invalidateRef.current();
  }, [projection]);

  // 背景色热切换（跟随主题/手动选择）
  // Hot-swap of the background color (theme-driven or manually picked).
  useEffect(() => {
    if (sceneRef.current && background) {
      sceneRef.current.background = new THREE.Color(background);
    }
    invalidateRef.current();
  }, [background]);

  const getCenterOffset = (): [number, number, number] => {
    // 惯性视图：地球在原点，质心与地球重合（差 mu·DU，画面上无感）；
    // 月心/L1/L2 是会合系概念（工具栏已禁用），防御性收敛到原点。
    // Inertial view: Earth sits at the origin and the barycenter coincides
    // with it (mu·DU apart — invisible on screen); moon/L1/L2 are synodic
    // concepts (toolbar disables them), defensively collapsed to the origin.
    if (frame === "inertial") return [0, 0, 0];
    // 会合系原点是地月质心：地球在 -mu、月球在 1-mu。居中偏移 = -(天体 x)。
    // The rotating frame's origin is the Earth-Moon barycenter: Earth at -mu, Moon at 1-mu; centering offset = -(body x).
    if (center === "earth") return [mu, 0, 0];
    if (center === "moon") return [-(1 - mu), 0, 0];
    if (center === "l1") {
      const l1 = libration.find((l) => l.label === "L1");
      return [-(l1?.x ?? (1 - mu - 0.15)), 0, 0];
    }
    if (center === "l2") {
      const l2 = libration.find((l) => l.label === "L2");
      return [-(l2?.x ?? (1 - mu + 0.15)), 0, 0];
    }
    return [0, 0, 0];
  };

  useEffect(() => {
    const content = contentRef.current;
    const annotations = annotationsRef.current;
    const regionsGroup = regionsRef.current;
    if (!content || !annotations || !regionsGroup) return;
    while (content.children.length) {
      content.remove(content.children[0]);
    }
    while (annotations.children.length) {
      annotations.remove(annotations.children[0]);
    }
    while (regionsGroup.children.length) {
      regionsGroup.remove(regionsGroup.children[0]);
    }

    const [ox, oy, oz] = getCenterOffset();
    content.position.set(ox, oy, oz);
    annotations.position.set(ox, oy, oz);
    regionsGroup.position.set(ox, oy, oz);

    const lpColorNum = parseInt((settings?.lpColor ?? "#d4b106").slice(1), 16);
    const inertial = frame === "inertial";
    // 绘制几何（#428 第二步）：惯性视图下携带 gcrs 惯性段的轨迹改用它
    // 绘制（会合视图不消费）；灰显判定同步豁免——弧在两个视图系下都以
    // 各自的几何如实呈现。
    // Drawn geometry (#428 step 2): in the inertial view a trajectory carrying
    // a gcrs inertial segment draws from it instead (the synodic view never
    // consumes it); graying is exempted in step — the arc renders honestly in
    // both frames with its own geometry.
    const drawn = inertial
      ? trajectories.map((pts, i) => inertialGeometries?.[i] ?? pts)
      : trajectories;
    // 灰显判定（#428）：惯性视图下会合系数据系产物去饱和；缺省标签按
    // synodic_nd 解释（与 TrajectoryData.frames 的缺省口径一致）；携带
    // 惯性段（gcrs_km）者豁免。判定与颜色条/轨道清单共用（orbitListItems
    // 的 grayedFlags，#469）。
    // Graying decision (#428): synodic data-frame products desaturate in the
    // inertial view; an omitted tag reads as synodic_nd (same default as
    // TrajectoryData.frames); an inertial (gcrs) segment exempts. Shared with
    // the colorbar and the orbit list (grayedFlags in orbitListItems, #469).
    const grayed = grayedFlags({ count: trajectories.length, frame, dataFrames, inertialGeometries });
    const colors = trajectoryColorsHex(
      trajectories.length,
      jacobi,
      settings?.colorCycle ?? DEFAULT_COLOR_CYCLE,
    ).colors.map((c, i) => (grayed[i] ? desaturateHex(c) : c)).map((c) => parseInt(c.slice(1), 16));

    // 背景亮度决定网格与标注颜色（白底黑线，深底浅线）
    // Background brightness decides grid and annotation colors (black lines on light backgrounds, pale lines on dark).
    const isLightBg = (() => {
      const hex = (background ?? "#121212").slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    })();
    const labelColor = isLightBg ? "#333333" : "#c9d3dd";
    const gridMajor = isLightBg ? 0xbdbdbd : 0x33415c;
    const gridMinor = isLightBg ? 0xe0e0e0 : 0x1d2634;

    // 轨道线独占 content 组：视图适配只按可见轨道范围（标注不参与）。
    // 线几何取 drawn（惯性视图下 gcrs 段接管，#428 第二步）。
    // 集合同时进 orbitLinesRef（拾取范围，#452），绘制顺序与 labels 对齐。
    // Orbit lines live exclusively in the content group: view fitting considers only visible orbit extents
    // (annotations excluded). Line geometry uses `drawn` (the gcrs segment takes over in the inertial view,
    // #428 step 2). The same set feeds orbitLinesRef (the pick scope, #452), draw order aligned with labels.
    const builtLines: THREE.Line[] = [];
    drawn.forEach((pts, i) => {
      const positions = new Float32Array(pts.length * 3);
      pts.forEach((p, j) => {
        positions[j * 3] = p[0];
        positions[j * 3 + 1] = p[1];
        positions[j * 3 + 2] = p[2] * (settings?.zRatio ?? 1.0);
      });
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: colors[i % colors.length], linewidth: settings?.orbitLinewidth ?? 1.0, transparent: true })
      );
      content.add(line);
      builtLines.push(line);
    });
    orbitLinesRef.current = builtLines;

    // 拾取阈值随本次重建的包围盒尺寸更新（#452）；聚焦态（若有）重应用到新线
    // The pick threshold tracks this rebuild's bounding-box size (#452); any
    // focus state re-applies onto the fresh lines.
    const pickBox = new THREE.Box3().setFromObject(content);
    pickThresholdRef.current = pickBox.isEmpty()
      ? pickThresholdFromSize(NaN)
      : pickThresholdFromSize(pickBox.getSize(new THREE.Vector3()).length());
    applyDisplayOpacity();

    // 文本标注 sprite（天体名/平动点/轴名共用，颜色随背景亮度）
    // Text-label sprites (shared by body names/libration points/axis names; color follows background brightness).
    const makeLabelSprite = (text: string, color = labelColor): THREE.Sprite => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.font = "600 30px system-ui";
      ctx.fillText(text, 4, 42);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
      );
      sprite.scale.set(0.08, 0.02, 1);
      return sprite;
    };

    // 刻度数字 sprite（量程标尺，比轴名小一档）
    // Tick-number sprites (the range ruler, one size step below axis names).
    const makeTickSprite = (text: string): THREE.Sprite => {
      const sprite = makeLabelSprite(text, isLightBg ? "#666666" : "#8fa0b3");
      sprite.scale.set(0.05, 0.0125, 1);
      return sprite;
    };

    const addSphere = (x: number, y: number, z: number, color: number, radius: number, label: string) => {
      // 注意：Object3D.add() 返回的是父 group，mesh 的位置必须显式设置，
      // 否则天体堆在原点、group 位置被覆盖，整个场景（含轨道线）被平移。
      // otherwise bodies pile up at the origin, the group position gets overwritten, and the whole scene (orbit lines included) shifts.
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        new THREE.MeshBasicMaterial({ color })
      );
      body.position.set(x, y, z);
      annotations.add(body);

      const sprite = makeLabelSprite(label);
      sprite.position.set(x + radius * 2, y + radius, z);
      annotations.add(sprite);
    };

    const s = settings;
    // 地月：NASA 公有领域贴图（Blue Marble / LROC）+ Phong 光照，
    // 半径默认按真实比例 ×3 夸张显示（chartSettings，#469）。位置随视图系：会合系下地月在
    // x 轴固定（-mu / 1-mu）；惯性系下地球居原点，月球沿 moonTrack 的
    // 当前时刻位置（下方月轨块摆放，无轨迹则隐藏——ADR 0013 离线降级）。
    // Earth and Moon: NASA public-domain textures (Blue Marble / LROC) with
    // Phong lighting, radii at true proportions ×3 by default (chartSettings, #469).
    // Placement follows the view frame: fixed on the x axis (-mu / 1-mu) in
    // the synodic frame; Earth at the origin in the inertial frame, with the
    // Moon at its current-moment position along moonTrack (placed by the
    // moon-track block below; hidden without a track — the ADR 0013 offline
    // degradation).
    const texLoader = new THREE.TextureLoader();
    const addTexturedBody = (
      name: string, label: string, position: [number, number, number], radius: number, textureUrl: string,
      specular: number, shininess: number,
    ) => {
      const tex = texLoader.load(textureUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 24),
        new THREE.MeshPhongMaterial({
          map: tex,
          specular: new THREE.Color(specular),
          shininess,
        }),
      );
      body.name = name;
      body.position.set(position[0], position[1], position[2]);
      annotations.add(body);

      const sprite = makeLabelSprite(label);
      sprite.position.set(position[0] + radius * 2, position[1] + radius, position[2]);
      annotations.add(sprite);
    };
    if (inertial) {
      addTexturedBody("earth", "地球", [0, 0, 0], s?.earthSize ?? EARTH_RADIUS_DU, earthTextureUrl, 0x2a2a2a, 14);
    } else {
      addTexturedBody("earth", "地球", [-mu, 0, 0], s?.earthSize ?? EARTH_RADIUS_DU, earthTextureUrl, 0x2a2a2a, 14);
      addTexturedBody("moon", "月球", [1 - mu, 0, 0], s?.moonSize ?? MOON_RADIUS_DU, moonTextureUrl, 0x111111, 4);
    }

    // 惯性视图的月球（#428，ADR 0013 决策 4）：整条 SPICE 真实轨迹（灰白
    // 细线，天体参照物语义进标注组、不参与视图适配）+ 贴图天体摆到当前
    // 时刻的插值位置（无时刻取跨度中点；时刻更新在 marker effect 里，拖
    // 时间轴不重建几何）。
    // The inertial-view Moon (#428, ADR 0013 decision 4): the full real SPICE
    // track (a pale thin line; a body reference joining the annotation group,
    // excluded from view fitting) plus the textured body placed at the
    // interpolated current-moment position (span midpoint without a moment;
    // moment updates live in the marker effect so scrubbing never rebuilds
    // geometry).
    const zr = settings?.zRatio ?? 1.0;
    if (inertial && moonTrack && moonTrack.points.length > 1) {
      const moonTrackColor = isLightBg ? 0x75808c : 0x8a93a0;
      const moonPositions = new Float32Array(moonTrack.points.length * 3);
      moonTrack.points.forEach((p, j) => {
        moonPositions[j * 3] = p[0];
        moonPositions[j * 3 + 1] = p[1];
        moonPositions[j * 3 + 2] = p[2] * zr;
      });
      const moonGeom = new THREE.BufferGeometry();
      moonGeom.setAttribute("position", new THREE.BufferAttribute(moonPositions, 3));
      const moonLine = new THREE.Line(
        moonGeom,
        new THREE.LineBasicMaterial({
          color: moonTrackColor,
          linewidth: settings?.orbitLinewidth ?? 1.0,
          transparent: true,
          opacity: 0.7,
        }),
      );
      moonLine.name = "moon-track";
      annotations.add(moonLine);
      // 初始位置取跨度中点（无时刻口径）；currentEt 更新由 marker effect
      // 驱动，拖动时间轴不重建几何。
      // Initial position takes the span midpoint (the no-moment convention);
      // currentEt updates are driven by the marker effect so scrubbing never
      // rebuilds geometry.
      const p = moonPositionAt(moonTrack, null);
      // 理想化圆月（#477）：relative 钟下的 θ=t 约定圆轨道，标注带「理想化」
      // 与 SPICE 真月轨迹区分
      // The idealized circular Moon (#477): the θ=t-convention circle under
      // the relative clock, labeled "idealized" to distinguish the SPICE real track
      addTexturedBody(
        "moon",
        moonTrack.idealized ? "月球（理想化）" : "月球",
        [p[0], p[1], p[2] * zr],
        s?.moonSize ?? MOON_RADIUS_DU,
        moonTextureUrl,
        0x111111,
        4,
      );
    }

    // 平动点是会合系概念（ADR 0013 决策 3）：惯性视图不画。
    // Libration points are synodic concepts (ADR 0013 decision 3): not drawn
    // in the inertial view.
    if (!inertial) libration.forEach((lp) => addSphere(lp.x, 0, 0, lpColorNum, s?.lpSize ?? 0.003, lp.label));

    // 坐标轴图层（matplotlib 式三轴 + 轨道面网格 + 量程刻度），随中心偏移，可开关
    // Axes layer (matplotlib-style three axes + orbit-plane grid + range ticks), offset with the center, toggleable.
    if (settings?.axesVisible ?? true) {
      const axes = new THREE.Group();
      axes.name = "axes";
      // 量程（DU）：网格半宽，默认 1.3 覆盖地月系；刻度每 0.5 DU
      // Range (DU): grid half-width, defaulting to 1.3 to cover the Earth-Moon system; a tick every 0.5 DU.
      const range = settings?.gridRange ?? 1.3;
      const LEN = Math.max(0.45, range * 0.35);
      const tips: [THREE.Vector3, number, string][] = [
        [new THREE.Vector3(1, 0, 0), 0xe57373, "X"],
        [new THREE.Vector3(0, 1, 0), 0x81c784, "Y"],
        [new THREE.Vector3(0, 0, 1), 0x4fc3f7, "Z"],
      ];
      for (const [dir, color, label] of tips) {
        axes.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), LEN, color, 0.06, 0.035));
        const sprite = makeLabelSprite(label, `#${color.toString(16).padStart(6, "0")}`);
        sprite.position.copy(dir.clone().multiplyScalar(LEN + 0.07));
        axes.add(sprite);
      }
      // 原点标注（#469）：会合系原点在地月质心（CR3BP 约定，质心在地球体
      // 内）——小圆环 + "地月质心"文字，消除"原点即地球"的误读。深度测试
      // 关闭，标记不被放大的地球球体遮住。惯性视图原点即地心，不标注。
      // Origin annotation (#469): the synodic origin sits at the Earth-Moon
      // barycenter (CR3BP convention, inside the Earth body) — a small ring
      // plus a "地月质心" label to dispel the "origin = Earth" misreading.
      // Depth test off so the enlarged Earth sphere never occludes the marker.
      // The inertial view's origin IS the Earth's center — no annotation there.
      if (!inertial) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.008, 0.011, 32),
          new THREE.MeshBasicMaterial({ color: parseInt(labelColor.slice(1), 16), depthTest: false, side: THREE.DoubleSide, transparent: true })
        );
        ring.renderOrder = 10;
        axes.add(ring);
        const originLabel = makeLabelSprite("地月质心");
        originLabel.position.set(0.045, 0.045, 0);
        axes.add(originLabel);
      }
      // 网格默认在 XZ 面，转到 XY 轨道面；间距 0.1 DU，范围随量程
      // The grid defaults to the XZ plane and is rotated onto the XY orbital plane; 0.1 DU spacing, extent follows the range.
      const divisions = Math.max(2, Math.round(range / 0.05));
      const grid = new THREE.GridHelper(range * 2, divisions, gridMajor, gridMinor);
      grid.rotation.x = Math.PI / 2;
      axes.add(grid);

      // 量程刻度：X/Y 轴每 0.5 DU 一个数字（matplotlib 标尺感）
      // Range ticks: one number every 0.5 DU along X/Y (a matplotlib-ruler feel).
      for (let v = 0.5; v <= range + 1e-9; v += 0.5) {
        for (const pos of [v, -v]) {
          const tx = makeTickSprite(pos.toFixed(1));
          tx.position.set(pos, -0.015, 0);
          axes.add(tx);
          const ty = makeTickSprite(pos.toFixed(1));
          ty.position.set(0.015, pos, 0);
          axes.add(ty);
        }
      }
      annotations.add(axes);
    }

    // 地月空间分区图层（Primer 分区边界：圆族 / Battin 非对称曲线 / 平动点）：
    // 与 content 同偏移、不参与视图适配（数据已由 regionLayer 归一到 DU，
    // z=0 平面），随 settings.regionsVisible 开关；配色按中心天体——地心系
    // 蓝、月心系琥珀、点标记沿用平动点金。
    // Region layer (Primer partition boundaries: circles / Battin asymmetric curve / libration
    // points): same offset as content, excluded from view fitting (data is DU-normalized by
    // regionLayer, z=0 plane); toggled by settings.regionsVisible. Colors by central body —
    // Earth-centered blue, Moon-centered amber, point markers reuse the libration gold.
    if ((settings?.regionsVisible ?? true) && !inertial && regions && regions.length > 0) {
      const regionColor = (el: RegionElement): number => {
        const hex =
          el.kind === "point"
            ? (settings?.lpColor ?? "#d4b106")
            : el.centerDU[0] > 0.5
              ? "#e8a24c"
              : "#4c9be8";
        return parseInt(hex.slice(1), 16);
      };
      regions.forEach((el) => {
        const color = regionColor(el);
        if (el.kind === "point") {
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(s?.lpSize ?? 0.003, 16, 16),
            new THREE.MeshBasicMaterial({ color })
          );
          marker.name = "region-marker";
          marker.position.set(el.centerDU[0], el.centerDU[1], el.centerDU[2]);
          regionsGroup.add(marker);
          const sprite = makeLabelSprite(el.label);
          sprite.position.set(el.centerDU[0] + 0.02, el.centerDU[1], el.centerDU[2]);
          regionsGroup.add(sprite);
          return;
        }
        if (!el.pointsDU || el.pointsDU.length < 2) return;
        const positions = new Float32Array(el.pointsDU.length * 3);
        el.pointsDU.forEach((p, j) => {
          positions[j * 3] = p[0];
          positions[j * 3 + 1] = p[1];
          positions[j * 3 + 2] = p[2];
        });
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        regionsGroup.add(
          new THREE.Line(
            geom,
            new THREE.LineBasicMaterial({ color, linewidth: settings?.orbitLinewidth ?? 1.0 })
          )
        );
      });
    }

    // 场景重建完成，排一帧呈现（按需渲染口径，见建场景 effect）
    // Scene rebuilt — schedule a frame (on-demand rendering, see the scene effect).
    invalidateRef.current();
  }, [trajectories, mu, libration, center, settings, background, jacobi, regions, frame, moonTrack, dataFrames, inertialGeometries]);

  // 每条轨迹一个时刻标记：随轨迹数组同步创建/清理（挂 scene 根，不参与视图适配）
  // One time marker per trajectory: created/cleaned in sync with the trajectory array
  // (attached to the scene root, excluded from view fitting).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const markers = trajectories.map(() => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff0055 })
      );
      m.name = "time-marker";
      m.visible = false;
      scene.add(m);
      return m;
    });
    markersRef.current = markers;
    return () => {
      markers.forEach((m) => scene.remove(m));
      markersRef.current = [];
    };
  }, [trajectories]);

  // 轨迹数据整体替换：聚焦态、预览与悬停提示清除（#452/#460），避免残留失效引用
  // A wholesale trajectory replacement clears focus, preview and the hover tip
  // (#452/#460), so no stale reference lingers.
  useEffect(() => {
    setFocusIdx(null);
    setPreviewIdx(null);
    setHoverTip(null);
  }, [trajectories]);

  // 聚焦/预览变化 → 重应用逐线不透明度（#452/#460）；重建后的重应用在绘制 effect 末尾。
  // 依赖仅两态：applyDisplayOpacity 只读 ref 与模块常量。
  // Focus/preview changes re-apply per-line opacity (#452/#460); post-rebuild
  // re-application happens at the end of the draw effect. Only the two states
  // are dependencies: applyDisplayOpacity reads refs and module constants only.
  useEffect(() => {
    applyDisplayOpacity();
    invalidateRef.current();
  }, [focusIdx, previewIdx]);

  // 中心切换：所选中心点已移到世界原点，相机注视点同步移到原点（“居中”
  // 语义），保持注视方向与距离（视图保持）。不能改为按轨道盒重新适配：
  // 那样会把画面中心钉回轨道所在区域（如 L2 的 Halo 族），中心切换在
  // 画面上成为无操作，用户无法把质心/月心调到画面中心。
  // Center switching: the selected center's body/libration point already moved to the world origin, so the camera
  // target moves to the origin too (the "centering" semantic), keeping gaze direction and distance (view preservation).
  // Do NOT refit on the orbit box instead: that would pin the view center back to where the orbits live (e.g. the L2
  // Halo family), making center switching a no-op and leaving users unable to bring the barycenter/Moon into view.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const delta = new THREE.Vector3().sub(controls.target);
    camera.position.add(delta);
    controls.target.set(0, 0, 0);
    controls.update();
    invalidateRef.current();
  }, [center]);

  // 各标记沿自己的轨迹/时刻插值：currentEt 超出该轨迹范围或无效时该标记隐藏。
  // 惯性视图下月球贴图同步沿 moonTrack 走到当前时刻（#428）：月球是天体
  // 参照物，不随时刻越界隐藏（越界取就近端点，moonPositionAt 口径）。
  // Each marker interpolates along its own trajectory/times: hidden when currentEt falls outside
  // that trajectory's range or is invalid. In the inertial view the textured Moon
  // likewise walks along moonTrack to the current moment (#428): a body reference,
  // it never hides on out-of-range moments (clamped to the nearer endpoint, per
  // moonPositionAt).
  useEffect(() => {
    const markers = markersRef.current;
    const [ox, oy, oz] = getCenterOffset();
    markers.forEach((marker, i) => {
      // 惯性视图下带 gcrs 段的轨迹标记沿惯性几何走（与所画弧同源，
      // #428 第二步）；时刻数组仍是共享的 trajectory_times。
      // In the inertial view a marker on a gcrs-carrying trajectory walks the
      // inertial geometry (same source as the drawn arc, #428 step 2); the
      // times stay the shared trajectory_times.
      const pts =
        frame === "inertial" ? inertialGeometries?.[i] ?? trajectories[i] : trajectories[i];
      const tList = times?.[i];
      const et = currentEt;
      if (!pts || pts.length === 0 || !tList || tList.length === 0 || et === null || et === undefined) {
        marker.visible = false;
        return;
      }
      // 时刻列可能递减：orbit_propagation 的 direction=backward（5.9.7）自 epoch
      // 反向回溯，积分次序即时间倒序。整列在存储上仍单调，据此定方向——越界判断
      // 用 [tMin, tMax]，查找谓词随方向翻转，插值仍是相邻两点间的线性。
      // The time column may descend: orbit_propagation's direction=backward (5.9.7)
      // integrates backwards from the epoch, so integration order is reverse time
      // order. The column is still monotonic in storage; pick the direction from it:
      // bounds use [tMin, tMax], the lookup predicate flips with it, and the
      // interpolation stays linear between adjacent points.
      const ascending = tList[tList.length - 1] >= tList[0];
      const tMin = ascending ? tList[0] : tList[tList.length - 1];
      const tMax = ascending ? tList[tList.length - 1] : tList[0];
      if (et < tMin || et > tMax) {
        marker.visible = false;
        return;
      }

      let idx = ascending ? tList.findIndex((t) => t >= et) : tList.findIndex((t) => t <= et);
      if (idx <= 0) idx = 1;
      if (idx >= tList.length) idx = tList.length - 1;

      const t0 = tList[idx - 1];
      const t1 = tList[idx];
      // span 在递减序下为负，符号折进分母：alpha 仍在 [0, 1]。旧式
      // Math.max(1e-6, span) 会把负 span 抬成 1e-6，把 alpha 放大六个数量级。
      // span is negative in descending order; folding its sign into the denominator
      // keeps alpha inside [0, 1]. The old Math.max(1e-6, span) clamped a negative
      // span up to 1e-6 and blew alpha up by six orders of magnitude.
      const span = t1 - t0;
      const alpha = Math.abs(span) < 1e-6 ? 0 : (et - t0) / span;
      const p0 = pts[idx - 1] || pts[0];
      const p1 = pts[idx] || pts[0];

      marker.position.set(
        (p0[0] + (p1[0] - p0[0]) * alpha) + ox,
        (p0[1] + (p1[1] - p0[1]) * alpha) + oy,
        (p0[2] + (p1[2] - p0[2]) * alpha) * (settings?.zRatio ?? 1.0) + oz
      );
      marker.visible = true;
    });

    if (frame === "inertial" && moonTrack) {
      const moon = annotationsRef.current?.getObjectByName("moon") as THREE.Mesh | undefined;
      if (moon) {
        const p = moonPositionAt(moonTrack, currentEt ?? null);
        moon.position.set(p[0], p[1], p[2] * (settings?.zRatio ?? 1.0));
      }
    }
    // 标记/月球位置已变，排一帧呈现（时间轴播放时随帧流持续成帧）
    // Markers/the Moon moved — schedule a frame (frames stream per playback tick).
    invalidateRef.current();
  }, [currentEt, trajectories, times, center, settings, frame, moonTrack, mu, libration, inertialGeometries]);

  // 图例：带标签的轨迹按各自实际渲染色显示（固定层记录与结果层命名轨迹），
  // 各轨迹附数据系标注（#431：数据系 vs 视图系措辞沿 CONTEXT.md）；惯性
  // 视图下灰显项附“会合系几何不可画”注记（#428）。图例项可交互（#460）：
  // 惯性视图灰显判定与渲染色（#428/#435）：供 Jacobi 颜色条使用；轨道清
  // 单（原画布图注）已迁到左侧边栏（#469），色样装配见 orbitListItems。
  // Inertial-view graying and render colors (#428/#435), feeding the Jacobi
  // colorbar; the orbit list (formerly the in-canvas legend) moved to the
  // left sidebar (#469) — swatch assembly lives in orbitListItems.
  const grayed = grayedFlags({ count: trajectories.length, frame, dataFrames, inertialGeometries });
  const renderColors = trajectoryColorsHex(
    trajectories.length,
    jacobi,
    settings?.colorCycle ?? DEFAULT_COLOR_CYCLE,
  );

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* 拾取提示（#452）：直角小标签跟随光标，无标签轨迹不显示；
          平面化风格遵循 ADR 0020 */}
      {/* The pick tooltip (#452): a square compact label trailing the cursor,
          hidden for unlabeled trajectories; flat style per ADR 0020. */}
      {hoverTip !== null && labels?.[hoverTip.index] && (
        <div
          data-testid="pick-tooltip"
          style={{
            position: "absolute",
            left: (hoverTip.x ?? 0) + 12,
            top: (hoverTip.y ?? 0) + 12,
            pointerEvents: "none",
            fontSize: 11,
            background: "rgba(20, 24, 30, 0.85)",
            color: "#e8eef4",
            border: "1px solid rgba(201, 211, 221, 0.35)",
            borderRadius: 2,
            padding: "2px 6px",
            whiteSpace: "nowrap",
            zIndex: 5,
          }}
        >
          {labels[hoverTip.index]}
        </div>
      )}
      {/* Jacobi 颜色条（#435）：存在有值轨迹时叠加，标注归一化范围的
          实际值区间（上端 jmax、下端 jmin），渐变按 coolwarm 采样表。
          惯性视图下会合系产物已灰显（#428），颜色条只对应未灰显的有值
          轨迹——全部灰显时隐藏，不做与线色脱钩的展示。 */}
      {/* Jacobi colorbar (#435): shown whenever a valued trajectory exists,
          labeling the real value interval of the normalization range
          (jmax on top, jmin below); gradient follows the coolwarm stops.
          In the inertial view synodic products are grayed out (#428), so the
          bar tracks only un-grayed valued trajectories — hidden when all are
          grayed, never shown decoupled from the line colors. */}
      {renderColors.range && jacobi?.some((v, i) => v !== undefined && !grayed[i]) && (
        <div
          data-testid="jacobi-colorbar"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            alignItems: "stretch",
            gap: 6,
            pointerEvents: "none",
            fontSize: 11,
            color: "#c9d3dd",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <span>{renderColors.range.jmax.toFixed(3)}</span>
            <span style={{ opacity: 0.75 }}>Jacobi</span>
            <span>{renderColors.range.jmin.toFixed(3)}</span>
          </div>
          <div
            style={{
              width: 10,
              minHeight: 96,
              borderRadius: 2,
              background: `linear-gradient(to top, ${COOLWARM_STOPS.join(", ")})`,
            }}
          />
        </div>
      )}
    </div>
  );
}
