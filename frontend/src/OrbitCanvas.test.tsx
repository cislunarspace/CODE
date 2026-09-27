// OrbitCanvas 渲染层回归测试：轨道线必须在场景重建后仍然存在。
//
// 复现 #405 后续：App 每次重渲染都传新的 onReady 内联函数，若建场景
// effect 依赖 [onReady]，场景会被整体重建而轨迹 effect（依赖未变）
// 不会重跑，轨迹丢失——用户看到空画布。
// Reproduces the #405 follow-up: App passes a fresh inline onReady on every re-render; if the scene-building
// effect depended on [onReady], the scene would be rebuilt wholesale while the trajectory effect (unchanged deps)
// would not rerun, losing trajectories — the user sees an empty canvas.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Line, ArrowHelper } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OrbitCanvas, type CenterMode, type CanvasApi } from "./OrbitCanvas";
import { DEFAULT_CHART_SETTINGS } from "./chartSettings";
import type { RegionElement } from "./regionLayer";

// jsdom 无 WebGL：只替换 WebGLRenderer，其余 three 类保持真实实现。
// jsdom has no WebGL: only WebGLRenderer is replaced; all other three classes stay real.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    domElement: HTMLCanvasElement;
    lastScene: unknown = null;
    lastCamera: unknown = null;
    static instances: FakeRenderer[] = [];
    constructor() {
      this.domElement = document.createElement("canvas");
      FakeRenderer.instances.push(this);
    }
    setSize() {}
    render(scene: unknown, camera: unknown) {
      this.lastScene = scene;
      this.lastCamera = camera;
    }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    // target 记录 x/y/z：fitView 的 copy/sub 需要可读字段，
    // 测试靠它断言相机注视点是否跟随中心切换。
    // target records x/y/z: fitView's copy/sub need readable fields, and tests use it to assert whether the camera gaze follows center switching.
    static instances: unknown[] = [];
    target = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }, copy(v: { x: number; y: number; z: number }) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };
    enableDamping = false;
    rotateSpeed = 1.0;
    autoRotate = false;
    autoRotateSpeed = 0.3;
    // 画布按需渲染订阅 change 事件（真实类继承 EventDispatcher），
    // 测试用 fireChange 手动触发。
    // The canvas subscribes to change for on-demand rendering (the real class
    // extends EventDispatcher); tests trigger it via fireChange.
    listeners: Record<string, (() => void)[]> = {};
    constructor() { (this.constructor as unknown as { instances: unknown[] }).instances.push(this); }
    addEventListener(type: string, cb: () => void) { (this.listeners[type] ??= []).push(cb); }
    removeEventListener(type: string, cb: () => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb); }
    fireChange() { (this.listeners.change ?? []).forEach((cb) => cb()); }
    update() { return false; }
    dispose() {}
  },
}));;

const { WebGLRenderer } = await import("three");
type FakeRendererInstance = InstanceType<typeof WebGLRenderer> & {
  lastScene: unknown;
  static: unknown;
};

let rafQueue: FrameRequestCallback[] = [];

function flushFrames() {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((cb) => cb(0));
}

function sceneLines(scene: unknown): Line[] {
  // 只数轨道线：标注组里的网格/箭头/天体不算（视图适配与轨迹计数都只针对轨道）
  // Count only orbit lines: grid/arrows/bodies in the annotation group do not count (view fitting and trajectory counting are orbit-only).
  const orbits = (scene as import("three").Scene).getObjectByName("orbits");
  if (!orbits) return [];
  return orbits.children.filter((o) => (o as Line).isLine) as unknown as Line[];
}

function annotationsOf(scene: unknown): import("three").Group {
  const g = (scene as import("three").Scene).getObjectByName("annotations");
  expect(g).toBeDefined();
  return g as import("three").Group;
}

function regionsOf(scene: unknown): import("three").Group {
  const g = (scene as import("three").Scene).getObjectByName("regions");
  expect(g).toBeDefined();
  return g as import("three").Group;
}

const MU = 0.01215058560962404;
const TRAJECTORIES: number[][][] = [
  Array.from({ length: 50 }, (_, i) => [Math.cos((i / 50) * Math.PI * 2), Math.sin((i / 50) * Math.PI * 2), 0]),
];
const LIBRATION = [
  { label: "L1", x: 0.8369 },
  { label: "L2", x: 1.1557 },
];

// L2 附近的偏心轨迹（模拟 Halo/NRHO 族）：fitView 后 target 会在盒中心
// x≈1.16，而不是原点——用于复现“适配后切中心，target 不跟随”的偏移。
// An eccentric trajectory near L2 (mimicking a Halo/NRHO family): after fitView the target sits at the box
// center x≈1.16 instead of the origin — reproducing the "switch center after fitting but target does not follow" offset.
const L2_ORBIT: number[][][] = [
  Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    return [1.1557 + 0.05 * Math.cos(a), 0.05 * Math.sin(a), 0.02 * Math.sin(a)];
  }),
];

const noopReady = () => {};

function renderCanvas(props?: Partial<Parameters<typeof OrbitCanvas>[0]>) {
  return render(
    <OrbitCanvas
      trajectories={TRAJECTORIES}
      mu={MU}
      libration={LIBRATION}
      projection="3d"
      center="barycenter"
      onReady={noopReady}
      {...props}
    />,
  );
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  // jsdom 无 2D canvas：stub 给天体标注用的 getContext("2d")
  // jsdom has no 2D canvas: stub getContext("2d") used by body annotations.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ fillText: () => {} }) as unknown as CanvasRenderingContext2D,
  );
  (WebGLRenderer as unknown as { instances: unknown[] }).instances.length = 0;
  (OrbitControls as unknown as { instances: unknown[] }).instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OrbitCanvas 轨迹渲染", () => {
  it("渲染后场景中存在与 trajectories 等量的轨迹线", () => {
    renderCanvas();
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    expect(instances.length).toBeGreaterThanOrEqual(1);
    const lines = sceneLines(instances[instances.length - 1].lastScene);
    expect(lines.length).toBe(TRAJECTORIES.length);
  });

  it("无关重渲染（onReady 新引用）不清空已画轨迹", () => {
    const view = renderCanvas();
    flushFrames();

    // 模拟 App 任意状态变化（setBusy/setApi/...）：onReady 是内联函数，
    // 每次渲染都是新引用，其余 props 不变。
    // Simulates arbitrary App state changes (setBusy/setApi/...): onReady is an inline function whose reference
    // changes every render while other props stay equal.
    view.rerender(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />,
    );
    flushFrames();

    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const last = instances[instances.length - 1];
    const lines = sceneLines(last.lastScene);
    expect(lines.length).toBe(TRAJECTORIES.length);
  });

  it("天体按各自坐标摆放，不堆在原点、不移动整个场景", () => {
    renderCanvas();
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as { children: import("three").Group[] };

    // annotations 组的位置必须是居中偏移（barycenter → 原点），
    // 不能被天体坐标覆盖；天体按各自坐标摆放。
    // The annotations group's position must be the centering offset (barycenter → origin) and must not be
    // overwritten by body coordinates; bodies sit at their own coordinates.
    const annotations = annotationsOf(scene);
    expect(annotations.position.x).toBeCloseTo(0, 10);

    // 地球 mesh 应位于 (-mu, 0, 0)，带真实表面贴图与 Phong 光照
    // The Earth mesh must sit at (-mu, 0, 0) with a real surface texture and Phong lighting.
    const earth = annotations.getObjectByName("earth") as import("three").Mesh;
    expect(earth).toBeDefined();
    expect(earth.position.x).toBeCloseTo(-MU, 10);
    const material = earth.material as import("three").MeshPhongMaterial;
    expect(material.map).toBeDefined();
    expect(material.isMeshPhongMaterial).toBe(true);

    // 月球同样贴图化，半径取真实比例（约地球的 0.27）
    // The Moon is likewise textured, its radius at true scale (about 0.27 of Earth's).
    const moon = annotations.getObjectByName("moon") as import("three").Mesh;
    expect((moon.material as import("three").MeshPhongMaterial).map).toBeDefined();
    const rEarth = (earth.geometry as import("three").SphereGeometry).parameters.radius;
    const rMoon = (moon.geometry as import("three").SphereGeometry).parameters.radius;
    expect(rMoon / rEarth).toBeCloseTo(1737.4 / 6378.137, 4);
  });

  it("场景含太阳平行光与环境光（真实贴图需要光照）", () => {
    renderCanvas();
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    let dir = 0;
    let amb = 0;
    scene.traverse((o) => {
      if ((o as import("three").DirectionalLight).isDirectionalLight) dir++;
      if ((o as import("three").AmbientLight).isAmbientLight) amb++;
    });
    expect(dir).toBeGreaterThanOrEqual(1);
    expect(amb).toBeGreaterThanOrEqual(1);
  });

  it("旋转恢复 OrbitControls 默认方向：rotateSpeed 不再取负（2026-08-29 决策废弃旧反转手感）", () => {
    renderCanvas();
    flushFrames();
    const list = (OrbitControls as unknown as { instances: { rotateSpeed: number }[] }).instances;
    expect(list.length).toBeGreaterThan(0);
    expect(list[list.length - 1].rotateSpeed).toBeGreaterThanOrEqual(0);
  });
});

describe("时刻标记（每条轨迹一个）", () => {
  // 两条不同时刻区间的轨迹：marker 各自沿自己的 times 插值，区间外隐藏
  // Two trajectories with disjoint time spans: each marker interpolates over its own times, hidden outside.
  const MULTI_TRAJ: number[][][] = [
    Array.from({ length: 5 }, (_, i) => [i, 0, 0]),
    Array.from({ length: 5 }, (_, i) => [10 + i, 1, 0]),
  ];
  const MULTI_TIMES: number[][] = [
    [0, 1, 2, 3, 4],
    [10, 11, 12, 13, 14],
  ];

  function timeMarkers(scene: unknown): import("three").Mesh[] {
    const s = scene as import("three").Scene;
    return s.children.filter((o) => o.name === "time-marker") as unknown as import("three").Mesh[];
  }

  function lastScene() {
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    return instances[instances.length - 1].lastScene;
  }

  it("标记数与轨迹数同步；currentEt 无效时全部隐藏（新数据上画布不自动出现红点）", () => {
    renderCanvas({ trajectories: MULTI_TRAJ, times: MULTI_TIMES, currentEt: null });
    flushFrames();
    const markers = timeMarkers(lastScene());
    expect(markers).toHaveLength(2);
    // currentEt=null：数据已上画布，红点仍待用户拖动时间轴或播放后才出现
    // currentEt=null: data is on the canvas, yet the marker awaits a timeline drag or playback.
    markers.forEach((m) => expect(m.visible).toBe(false));
  });

  it("轨迹数变化时旧标记清理、新标记补齐", () => {
    const view = renderCanvas({ trajectories: MULTI_TRAJ, times: MULTI_TIMES, currentEt: null });
    flushFrames();
    const three = MULTI_TRAJ.concat([Array.from({ length: 5 }, (_, i) => [20 + i, 2, 0])]);
    view.rerender(
      <OrbitCanvas
        trajectories={three}
        times={MULTI_TIMES.concat([[20, 21, 22, 23, 24]])}
        currentEt={null}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />,
    );
    flushFrames();
    const markers = timeMarkers(lastScene());
    expect(markers).toHaveLength(3);
  });

  it("各标记沿自己的 times 插值：currentEt 落在谁的区间谁可见，区间外隐藏", () => {
    const view = renderCanvas({ trajectories: MULTI_TRAJ, times: MULTI_TIMES, currentEt: 2.5 });
    flushFrames();
    let markers = timeMarkers(lastScene());
    expect(markers[0].visible).toBe(true);
    expect(markers[0].position.x).toBeCloseTo(2.5, 6);
    expect(markers[1].visible).toBe(false);

    view.rerender(
      <OrbitCanvas
        trajectories={MULTI_TRAJ}
        times={MULTI_TIMES}
        currentEt={12}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />,
    );
    flushFrames();
    markers = timeMarkers(lastScene());
    expect(markers[0].visible).toBe(false);
    expect(markers[1].visible).toBe(true);
    expect(markers[1].position.x).toBeCloseTo(12, 6);
    expect(markers[1].position.y).toBeCloseTo(1, 6);
  });

  it("递减时刻列（direction=backward）插值不越界，端点时刻仍算区间内", () => {
    // 反向预报的时刻序列自 epoch 递减（orbit_propagation direction=backward，
    // 5.9.7），位置随时刻回退。旧实现按递增假设：区间判断取 tList[0]/tList[last]，
    // 插值分母 Math.max(1e-6, t1 - t0) 在负 span 下把 alpha 放大百万倍。
    // A backward-propagation series descends from the epoch (orbit_propagation
    // direction=backward, 5.9.7) and its position retreats with time. The old
    // implementation assumed ascending order: the range check used tList[0]/tList[last]
    // and the interpolation denominator Math.max(1e-6, t1 - t0) inflated alpha a
    // millionfold on a negative span.
    const descTraj: number[][][] = [Array.from({ length: 5 }, (_, i) => [4 - i, 0, 0])];
    const descTimes: number[][] = [[4, 3, 2, 1, 0]];
    const render = (currentEt: number) => (
      <OrbitCanvas
        trajectories={descTraj}
        times={descTimes}
        currentEt={currentEt}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />
    );

    const view = renderCanvas({ trajectories: descTraj, times: descTimes, currentEt: 2.5 });
    flushFrames();
    let markers = timeMarkers(lastScene());
    expect(markers[0].visible).toBe(true);
    expect(markers[0].position.x).toBeCloseTo(2.5, 6);

    // 序列首元素（最大时刻）在区间内，不是越界
    // The first element (the largest moment) is inside the range, not outside it.
    view.rerender(render(4));
    flushFrames();
    markers = timeMarkers(lastScene());
    expect(markers[0].visible).toBe(true);
    expect(markers[0].position.x).toBeCloseTo(4, 6);

    // 区间外仍隐藏
    // Still hidden outside the range.
    view.rerender(render(5));
    flushFrames();
    markers = timeMarkers(lastScene());
    expect(markers[0].visible).toBe(false);
  });
});

describe("中心点居中几何", () => {
  // 选定中心后，该天体/平动点的世界坐标应为原点（相机 target 默认 0,0,0）
  // After a center is selected, that body/libration point's world coordinate should be the origin (camera target defaults to 0,0,0).
  const CASES: { name: string; center: CenterMode; bodyLocalX: number }[] = [
    { name: "地心居中", center: "earth", bodyLocalX: -MU },
    { name: "月心居中", center: "moon", bodyLocalX: 1 - MU },
    { name: "L1 居中", center: "l1", bodyLocalX: LIBRATION[0].x },
    { name: "L2 居中", center: "l2", bodyLocalX: LIBRATION[1].x },
  ];

  it.each(CASES)("$name：中心天体世界坐标在原点", async ({ center, bodyLocalX }) => {
    const { Vector3 } = await import("three");
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center={center}
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    scene.updateMatrixWorld(true);
    const annotations = annotationsOf(scene);
    const meshes = annotations.children.filter(
      (c) => (c as unknown as { isMesh?: boolean }).isMesh,
    ) as unknown as import("three").Mesh[];
    const target = meshes.find((m) => Math.abs(m.position.x - bodyLocalX) < 1e-9);
    expect(target, `未找到 local x=${bodyLocalX} 的天体`).toBeDefined();
    const world = new Vector3();
    target!.getWorldPosition(world);
    expect(world.x).toBeCloseTo(0, 6);
  });
});

describe("中心切换的相机注视点", () => {
  // 用户场景：L2 轨道族 + 适配（注视点在轨道盒中心）→ 手动切“质心居中”，
 // 期望质心（世界原点）成为画面中心，而不是重新适配又盯回轨道盒。
  // User scenario: an L2 orbit family + fit (gaze at the orbit-box center), then manually switching to
  // "barycenter-centered": the barycenter (world origin) should become the view center rather than refitting back onto the orbit box.
  const stateOf = () => {
    const r = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const last = r[r.length - 1] as unknown as { lastCamera: { position: { x: number; y: number; z: number } } };
    const list = (OrbitControls as unknown as { instances: { target: { x: number; y: number; z: number } }[] }).instances;
    return { camera: last.lastCamera, target: list[list.length - 1].target };
  };

  it("切换到质心居中：注视点移到原点，视角与距离保持", () => {
    let api!: { fitView: () => void };
    const view = render(
      <OrbitCanvas
        trajectories={L2_ORBIT}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="l2"
        onReady={(a) => (api = a)}
      />,
    );
    flushFrames();
    api.fitView();
    const before = stateOf();
    // L2 居中 + 适配后，注视点在轨道盒中心（原点附近）
    // After L2 centering + fitting, the gaze sits at the orbit-box center (near the origin).
    expect(before.target.x).toBeCloseTo(0, 2);
    const offsetBefore = {
      x: before.camera.position.x - before.target.x,
      y: before.camera.position.y - before.target.y,
      z: before.camera.position.z - before.target.z,
    };

    view.rerender(
      <OrbitCanvas
        trajectories={L2_ORBIT}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={(a) => (api = a)}
      />,
    );
    flushFrames();

    const after = stateOf();
    // center 状态确实传到了画布：质心居中时 annotations 偏移归零（区分假设 2）
    // The center state really reached the canvas: the annotations offset zeroes out under barycenter centering (distinguishes hypothesis 2).
    const scene = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const s = scene[scene.length - 1].lastScene as import("three").Scene;
    expect(annotationsOf(s).position.x).toBeCloseTo(0, 10);
    // 质心居中：注视点应为世界原点，而不是轨道盒中心（当前实现变红处）
    // Barycenter-centered: the gaze should be the world origin, not the orbit-box center (where the current implementation goes red).
    expect(after.target.x).toBeCloseTo(0, 6);
    expect(after.target.y).toBeCloseTo(0, 6);
    // 视图保持：相机相对注视点的方向与距离不变
    // View preservation: the camera's direction and distance relative to the gaze stay unchanged.
    expect(after.camera.position.x - after.target.x).toBeCloseTo(offsetBefore.x, 6);
    expect(after.camera.position.y - after.target.y).toBeCloseTo(offsetBefore.y, 6);
    expect(after.camera.position.z - after.target.z).toBeCloseTo(offsetBefore.z, 6);
  });
});

describe("坐标轴图层", () => {
  it("默认显示：三轴箭头 + X/Y/Z 标注 + 轨道面网格", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    const axes = annotationsOf(scene).getObjectByName("axes");
    expect(axes).toBeDefined();
    // 3 轴箭头 + 3 轴名 sprite + 1 网格 + 量程刻度（默认 ±0.5/±1.0 两档 × X/Y 双轴）
    // Three axis arrows + three axis-name sprites + one grid + range ticks (default ±0.5/±1.0 settings x X/Y axes).
    const arrows = axes!.children.filter((c) => c instanceof ArrowHelper);
    expect(arrows.length).toBe(3);
    const grid = axes!.children.find((c) => (c as unknown as { isLineSegments?: boolean }).isLineSegments);
    expect(grid).toBeDefined(); // GridHelper 继承 LineSegments
    const sprites = axes!.children.filter((c) => (c as unknown as { isSprite?: boolean }).isSprite);
    expect(sprites.length).toBeGreaterThanOrEqual(3 + 4); // 轴名 + 刻度数字
  });

  it("axesVisible=false 时不渲染坐标轴", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        settings={{ ...DEFAULT_CHART_SETTINGS, axesVisible: false }}
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    expect(annotationsOf(scene).getObjectByName("axes")).toBeUndefined();
  });

  it("背景色 prop 驱动 scene.background（白底可切）", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        background="#ffffff"
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    const bg = scene.background as import("three").Color;
    expect(bg).toBeDefined();
    expect(bg.getHexString()).toBe("ffffff");
  });

  it("量程驱动网格尺寸：gridRange=2 时网格边长 4", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        settings={{ ...DEFAULT_CHART_SETTINGS, gridRange: 2 }}
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    const axes = annotationsOf(scene).getObjectByName("axes");
    const grid = axes!.children.find(
      (c) => (c as unknown as { isLineSegments?: boolean }).isLineSegments,
    ) as unknown as import("three").LineSegments;
    const geom = grid.geometry as import("three").BufferGeometry;
    // GridHelper 顶点覆盖 [-size/2, size/2]；取 x 极值验边长
    // GridHelper vertices span [-size/2, size/2]; take the x extremes to verify the side length.
    const pos = geom.getAttribute("position");
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
    }
    expect(maxX - minX).toBeCloseTo(4, 3);
  });
});

// —— 分区图层（regionLayer 产物 → regions 组）——
// Region layer (regionLayer output → the regions group).

const REGIONS: RegionElement[] = [
  {
    kind: "circle",
    label: "Moon Hill sphere rho_H",
    centerDU: [1 - MU, 0, 0],
    radiusDU: 0.16,
    pointsDU: Array.from({ length: 37 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2;
      return [1 - MU + 0.16 * Math.cos(a), 0.16 * Math.sin(a), 0] as [number, number, number];
    }),
  },
  { kind: "point", label: "L3", centerDU: [-1.198, 0, 0] },
];

describe("OrbitCanvas regions layer", () => {
  it("传入 regions 时渲染 regions 组：圆族折线 + 点标记 + 标注 sprite", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        regions={REGIONS}
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    const regions = regionsOf(scene);
    // 圆折线 1 条 + 点球 1 个 + 标注 sprite 1 个
    // One circle polyline + one point sphere + one label sprite.
    const lines = regions.children.filter((c) => (c as Line).isLine);
    expect(lines).toHaveLength(1);
    expect(regions.children.filter((c) => (c as import("three").Mesh).isMesh)).toHaveLength(1);
    expect(
      regions.children.filter((c) => (c as unknown as { isSprite?: boolean }).isSprite),
    ).toHaveLength(1);
    // 分区折线不算轨道线（sceneLines 只数 orbits 组）
    // Region polylines are not orbit lines (sceneLines counts the orbits group only).
    expect(sceneLines(scene)).toHaveLength(1);
  });

  it("regionsVisible=false 时 regions 组为空", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        regions={REGIONS}
        settings={{ ...DEFAULT_CHART_SETTINGS, regionsVisible: false }}
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    expect(regionsOf(scene).children).toHaveLength(0);
  });

  it("未传 regions 时 regions 组存在但为空", () => {
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        onReady={() => {}}
      />,
    );
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const scene = instances[instances.length - 1].lastScene as import("three").Scene;
    expect(regionsOf(scene).children).toHaveLength(0);
  });

  it("大半径分区圆不参与视图适配：fitView 仍按小轨迹取景", () => {
    let api: CanvasApi | null = null;
    render(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        regions={[
          {
            kind: "circle",
            label: "Earth Hill sphere r_H",
            centerDU: [0, 0, 0],
            radiusDU: 3.9,
            pointsDU: Array.from({ length: 37 }, (_, i) => {
              const a = (i / 36) * Math.PI * 2;
              return [3.9 * Math.cos(a), 3.9 * Math.sin(a), 0] as [number, number, number];
            }),
          },
        ]}
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    flushFrames();
    expect(api).not.toBeNull();
    api!.fitView();
    // 轨迹是单位圆：适配后相机距离应在个位数 DU；若 3.9 DU 的大圆参与
    // 适配，距离会数倍于该值。
    // The trajectory is a unit circle: after fitting, the camera distance is a few DU; a 3.9-DU
    // circle participating in fitting would multiply it several times over.
    const controls = OrbitControls as unknown as {
      instances: { target: import("three").Vector3 }[];
    };
    const target = controls.instances[controls.instances.length - 1].target;
    const instances = (WebGLRenderer as unknown as {
      instances: (FakeRendererInstance & { lastCamera: unknown })[];
    }).instances;
    const cam = instances[instances.length - 1].lastCamera as import("three").PerspectiveCamera;
    const dist = cam.position.distanceTo(target);
    expect(dist).toBeLessThan(6);
  });
});

describe("Jacobi 常数着色（#435）", () => {
  /** 取末次渲染场景里第 i 条轨道线的颜色（hex 小写）。 */
  /** The color of the i-th orbit line in the last rendered scene (lowercase hex). */
  function lineColorAt(i: number): string {
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const lines = sceneLines(instances[instances.length - 1].lastScene);
    const line = lines[i] as unknown as { material: { color: { getHexString(): string } } };
    return line.material.color.getHexString();
  }

  const TWO_TRAJECTORIES: number[][][] = [
    Array.from({ length: 20 }, (_, i) => [Math.cos((i / 20) * Math.PI * 2), Math.sin((i / 20) * Math.PI * 2), 0]),
    Array.from({ length: 20 }, (_, i) => [0.5 * Math.cos((i / 20) * Math.PI * 2), 0.5 * Math.sin((i / 20) * Math.PI * 2), 0]),
  ];

  it("有 Jacobi 值的轨迹按归一化 colormap 着色，两端分别是 coolwarm 蓝/红端", () => {
    renderCanvas({ trajectories: TWO_TRAJECTORIES, jacobi: [2.9, 3.1] });
    flushFrames();
    expect(lineColorAt(0)).toBe("3b4cc0"); // jacobi 最小 → 蓝端
    expect(lineColorAt(1)).toBe("b40426"); // jacobi 最大 → 红端
  });

  it("无 Jacobi 值的轨迹回退色环循环取色；混合时归一化只按有值轨迹", () => {
    renderCanvas({ trajectories: TWO_TRAJECTORIES, jacobi: [undefined, 3.1] });
    flushFrames();
    // 第 0 条无值 → 色环第一色；第 1 条唯一有值 → 归一化固定色（蓝端）
    // Trajectory 0 has no value → first color-cycle color; trajectory 1 is the only valued one → fixed color (blue end).
    expect(lineColorAt(0)).toBe(DEFAULT_CHART_SETTINGS.colorCycle[0].slice(1));
    expect(lineColorAt(1)).toBe("3b4cc0");
  });

  it("全部无 Jacobi 值时仍按色环循环（不出现颜色条）", () => {
    const view = renderCanvas({ trajectories: TWO_TRAJECTORIES });
    flushFrames();
    expect(lineColorAt(0)).toBe(DEFAULT_CHART_SETTINGS.colorCycle[0].slice(1));
    expect(lineColorAt(1)).toBe(DEFAULT_CHART_SETTINGS.colorCycle[1].slice(1));
    expect(view.container.querySelector("[data-testid='jacobi-colorbar']")).toBeNull();
  });

  it("Jacobi 全相等时渲染不崩溃且按固定色（蓝端）处理", () => {
    renderCanvas({ trajectories: TWO_TRAJECTORIES, jacobi: [3.0, 3.0] });
    flushFrames();
    expect(lineColorAt(0)).toBe("3b4cc0");
    expect(lineColorAt(1)).toBe("3b4cc0");
  });

  it("存在有值轨迹时出现颜色条，标注实际值区间", () => {
    const view = renderCanvas({ trajectories: TWO_TRAJECTORIES, jacobi: [2.9, 3.1] });
    flushFrames();
    const bar = view.container.querySelector("[data-testid='jacobi-colorbar']");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain("2.9");
    expect(bar!.textContent).toContain("3.1");
  });

  it("jacobi 更新后颜色条随画布内容更新（钉入/移除）", () => {
    const view = renderCanvas({ trajectories: TWO_TRAJECTORIES, jacobi: [2.9, 3.1] });
    flushFrames();
    view.rerender(
      <OrbitCanvas
        trajectories={TWO_TRAJECTORIES}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        jacobi={[3.05, 3.07]}
        onReady={noopReady}
      />,
    );
    flushFrames();
    const bar = view.container.querySelector("[data-testid='jacobi-colorbar']");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain("3.05");
    expect(bar!.textContent).toContain("3.07");
  });
});

// —— 惯性视图（#428 第一步）：视图系贯通——灰显、月球 SPICE 轨迹、
// 会合系参照隐藏、et 正交 ——
// Inertial view (#428 step 1): the view frame threads through — graying,
// the Moon's SPICE track, synodic-reference hiding, et orthogonality.

import { Color as ThreeColor } from "three";
import type { MoonTrack } from "./moonEphemeris";

/** 与 OrbitCanvas 的灰显算法对拍：保留 18% 饱和度、亮度不变。 */
/** Mirrors OrbitCanvas's graying: keeps 18% saturation, brightness unchanged. */
function desaturate(hex: string): string {
  const c = new ThreeColor(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.18, hsl.l);
  return `#${c.getHexString()}`;
}

/** 半圆月轨（跨度 [0, 100]，间距 1）：位置 = (et/100·π, sin) 归一幅度。 */
/** A semicircular Moon track (span [0, 100], spacing 1): position = (et/100·π, sin) normalized. */
const MOON_TRACK: MoonTrack = {
  points: Array.from({ length: 101 }, (_, i) => [
    Math.cos((i / 100) * Math.PI),
    Math.sin((i / 100) * Math.PI),
    0,
  ]),
  etRange: [0, 100],
};

function sceneOf(): import("three").Scene {
  const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
  return instances[instances.length - 1].lastScene as import("three").Scene;
}

describe("惯性视图（#428）", () => {
  it("地球居原点；月轨线进标注组；月球贴图摆到跨度中点", () => {
    renderCanvas({ frame: "inertial", moonTrack: MOON_TRACK });
    flushFrames();
    const scene = sceneOf();
    const annotations = annotationsOf(scene);

    const earth = annotations.getObjectByName("earth") as import("three").Mesh;
    expect(earth.position.x).toBeCloseTo(0, 10);
    expect(earth.position.y).toBeCloseTo(0, 10);

    // 月轨线在标注组（天体参照物语义，不参与视图适配），不混进轨道组
    // The Moon track lives in the annotation group (body-reference semantics,
    // excluded from view fitting), never among the orbit lines.
    expect(annotations.getObjectByName("moon-track")).toBeDefined();
    expect(sceneLines(scene)).toHaveLength(TRAJECTORIES.length);

    const moon = annotations.getObjectByName("moon") as import("three").Mesh;
    expect(moon).toBeDefined();
    // 无 currentEt：月球在跨度中点（et=50 → 半圆顶点 (0, 1, 0)）
    // No currentEt: the Moon sits at the span midpoint (et=50 → semicircle apex (0, 1, 0)).
    expect(moon.position.x).toBeCloseTo(0, 6);
    expect(moon.position.y).toBeCloseTo(1, 6);
  });

  it("月球贴图随 currentEt 沿月轨插值移动（与 spacetime_transform 输出的缩放对拍）", () => {
    const view = renderCanvas({
      frame: "inertial",
      moonTrack: MOON_TRACK,
      times: [[0, 100]],
      currentEt: 25,
    });
    flushFrames();
    let moon = annotationsOf(sceneOf()).getObjectByName("moon") as import("three").Mesh;
    expect(moon.position.x).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    expect(moon.position.y).toBeCloseTo(Math.sin(Math.PI / 4), 6);

    view.rerender(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        times={[[0, 100]]}
        currentEt={75}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        frame="inertial"
        moonTrack={MOON_TRACK}
        onReady={noopReady}
      />,
    );
    flushFrames();
    moon = annotationsOf(sceneOf()).getObjectByName("moon") as import("three").Mesh;
    expect(moon.position.x).toBeCloseTo(Math.cos((3 * Math.PI) / 4), 6);
    expect(moon.position.y).toBeCloseTo(Math.sin((3 * Math.PI) / 4), 6);
  });

  it("moonTrack 缺失时月球隐藏（ADR 0013 离线降级）", () => {
    renderCanvas({ frame: "inertial", moonTrack: null });
    flushFrames();
    const annotations = annotationsOf(sceneOf());
    expect(annotations.getObjectByName("moon")).toBeUndefined();
    expect(annotations.getObjectByName("moon-track")).toBeUndefined();
  });

  it("会合视图不消费 moonTrack（零行为变化）", () => {
    renderCanvas({ frame: "synodic", moonTrack: MOON_TRACK });
    flushFrames();
    const annotations = annotationsOf(sceneOf());
    expect(annotations.getObjectByName("moon-track")).toBeUndefined();
    const moon = annotations.getObjectByName("moon") as import("three").Mesh;
    expect(moon.position.x).toBeCloseTo(1 - MU, 10);
  });

  it("synodic 数据系轨迹灰显（去饱和），inertial_km 轨迹原色", () => {
    renderCanvas({
      frame: "inertial",
      trajectories: [TRAJECTORIES[0], TRAJECTORIES[0]],
      dataFrames: ["synodic_nd", "inertial_km"],
    });
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const lines = sceneLines(instances[instances.length - 1].lastScene);
    const hexOf = (l: Line) =>
      (l.material as unknown as { color: { getHexString(): string } }).color.getHexString();
    // 第 0 条（synodic_nd）→ 灰显色；第 1 条（inertial_km）→ 原色环第二色
    // Row 0 (synodic_nd) → grayed; row 1 (inertial_km) → the untouched second cycle color.
    expect(hexOf(lines[0])).toBe(desaturate(DEFAULT_CHART_SETTINGS.colorCycle[0]).slice(1));
    expect(hexOf(lines[1])).toBe(DEFAULT_CHART_SETTINGS.colorCycle[1].slice(1));
  });

  it("dataFrames 缺省按 synodic_nd 解释：惯性视图下灰显", () => {
    renderCanvas({ frame: "inertial" });
    flushFrames();
    const instances = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances;
    const lines = sceneLines(instances[instances.length - 1].lastScene);
    const hex = (lines[0].material as unknown as { color: { getHexString(): string } }).color.getHexString();
    expect(hex).toBe(desaturate(DEFAULT_CHART_SETTINGS.colorCycle[0]).slice(1));
  });

  it("平动点与分区图层隐藏（会合系参照）", () => {
    renderCanvas({ frame: "inertial", regions: REGIONS });
    flushFrames();
    const scene = sceneOf();
    // L1/L2 是 SphereGeometry 标注球：惯性下不画（只剩地球/月球贴图）
    // L1/L2 are sphere annotation markers: not drawn in the inertial view
    // (only the textured Earth/Moon remain).
    const annotations = annotationsOf(scene);
    const spheres = annotations.children.filter(
      (c) => (c as unknown as { isMesh?: boolean }).isMesh,
    );
    expect(spheres.length).toBe(1); // 仅地球
    expect(regionsOf(scene).children).toHaveLength(0);
  });

  it("视图系正交：切 frame 不动 time-marker（currentEt 语义与视图系无关）", () => {
    const view = renderCanvas({
      times: [[0, 100]],
      currentEt: 60,
    });
    flushFrames();
    const markerBefore = () => {
      const s = sceneOf();
      return s.children.find((o) => o.name === "time-marker") as import("three").Mesh;
    };
    const before = { ...markerBefore().position };

    view.rerender(
      <OrbitCanvas
        trajectories={TRAJECTORIES}
        times={[[0, 100]]}
        currentEt={60}
        mu={MU}
        libration={LIBRATION}
        projection="3d"
        center="barycenter"
        frame="inertial"
        moonTrack={MOON_TRACK}
        onReady={noopReady}
      />,
    );
    flushFrames();
    const after = markerBefore().position;
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    expect(after.z).toBeCloseTo(before.z, 10);
  });

  it("惯性视图下 Jacobi 颜色条隐藏（有值轨迹全灰显，颜色条与线色脱钩不展示）", () => {
    const view = renderCanvas({
      frame: "inertial",
      trajectories: [TRAJECTORIES[0], TRAJECTORIES[0]],
      jacobi: [2.9, 3.1],
      labels: ["轨道A", "轨道B"],
    });
    flushFrames();
    expect(view.container.querySelector("[data-testid='jacobi-colorbar']")).toBeNull();
    // 灰显线的颜色本身（去饱和）由下方惯性视图用例覆盖；清单注记迁到
    // CanvasOrbitList.test（#469）。
    // The grayed line color itself (desaturated) is covered by the inertial-view
    // cases below; the list note moved to CanvasOrbitList.test (#469).
  });
});

describe("惯性视图转移弧 gcrs 段（#428 第二步）", () => {
  // 双几何：主几何（会合系）与 gcrs 段（惯性）显著不同，断言可分辨
  // Dual geometry: the primary (synodic) and gcrs (inertial) segments differ
  // visibly so assertions can tell them apart.
  const SYNODIC_ARC: number[][] = [
    [0.1, 0, 0],
    [0.2, 0, 0],
    [0.3, 0, 0],
  ];
  const GCRS_ARC: number[][] = [
    [0, 0.1, 0],
    [0, 0.2, 0],
    [0, 0.3, 0],
  ];

  function arcLines(): Line[] {
    const lines = sceneLines(sceneOf());
    expect(lines).toHaveLength(1);
    return lines;
  }

  function firstPointOf(line: Line): number[] {
    const attr = line.geometry.getAttribute("position") as import("three").BufferAttribute;
    return [attr.getX(0), attr.getY(0), attr.getZ(0)];
  }

  it("惯性视图：带 gcrs 段的转移弧改用惯性几何绘制，不灰显", () => {
    renderCanvas({
      frame: "inertial",
      trajectories: [SYNODIC_ARC],
      dataFrames: ["synodic_km"],
      inertialGeometries: [GCRS_ARC],
      labels: ["转移弧"],
    });
    flushFrames();
    const [line] = arcLines();
    expect(firstPointOf(line)[0]).toBeCloseTo(0, 10); // gcrs 几何，非会合段
    expect(firstPointOf(line)[1]).toBeCloseTo(0.1, 6);
    const hex = (line.material as unknown as { color: { getHexString(): string } }).color.getHexString();
    expect(hex).toBe(DEFAULT_CHART_SETTINGS.colorCycle[0].slice(1)); // 原色，未去饱和
  });

  it("会合视图：不消费 gcrs 段，逐项不变", () => {
    renderCanvas({
      frame: "synodic",
      trajectories: [SYNODIC_ARC],
      dataFrames: ["synodic_km"],
      inertialGeometries: [GCRS_ARC],
    });
    flushFrames();
    const p = firstPointOf(arcLines()[0]);
    expect(p[0]).toBeCloseTo(0.1, 6);
    expect(p[1]).toBeCloseTo(0, 10);
    expect(p[2]).toBeCloseTo(0, 10);
  });

  it("惯性视图下时刻标记沿 gcrs 几何插值（与所画弧同源）", () => {
    renderCanvas({
      frame: "inertial",
      trajectories: [SYNODIC_ARC],
      inertialGeometries: [GCRS_ARC],
      times: [[0, 100, 200]],
      currentEt: 100,
    });
    flushFrames();
    const marker = sceneOf().children.find((o) => o.name === "time-marker") as import("three").Mesh;
    expect(marker.visible).toBe(true);
    // et=100 → gcrs 几何中点 (0, 0.2, 0)；若误用会合段则是 (0.2, 0, 0)
    // et=100 → the gcrs midpoint (0, 0.2, 0); the synodic segment would give (0.2, 0, 0).
    expect(marker.position.x).toBeCloseTo(0, 10);
    expect(marker.position.y).toBeCloseTo(0.2, 10);
  });

  it("gcrs 段为 null（旧记录/low_thrust）时降级：仍画会合段并灰显", () => {
    renderCanvas({
      frame: "inertial",
      trajectories: [SYNODIC_ARC],
      dataFrames: ["synodic_km"],
      inertialGeometries: [null],
      labels: ["转移弧"],
    });
    flushFrames();
    const [line] = arcLines();
    expect(firstPointOf(line)[0]).toBeCloseTo(0.1, 6); // 会合段照画（灰显口径）
    const hex = (line.material as unknown as { color: { getHexString(): string } }).color.getHexString();
    expect(hex).toBe(desaturate(DEFAULT_CHART_SETTINGS.colorCycle[0]).slice(1));
  });
});

// —— 轨迹拾取与聚焦（#452）——
// Trajectory picking & focus (#452).

import { Raycaster } from "three";
import type { Intersection } from "three";
import { Vector3 } from "three";
import { act, screen } from "@testing-library/react";

const TWO_TRAJECTORIES: number[][][] = [
  Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2) * 0.5, Math.sin((i / 40) * Math.PI * 2) * 0.5, 0]),
  Array.from({ length: 40 }, (_, i) => [1 + Math.cos((i / 40) * Math.PI * 2) * 0.3, Math.sin((i / 40) * Math.PI * 2) * 0.3, 0]),
];
const TWO_LABELS = ["弧 A", "弧 B"];

function pickCanvas() {
  const view = renderCanvas({ trajectories: TWO_TRAJECTORIES, labels: TWO_LABELS });
  // 首帧也走 rAF（按需渲染），主动 pump 一帧让场景就绪
  // The first frame also rides rAF (on-demand rendering); pump once so the scene is ready.
  flushFrames();
  const scene = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances[
    (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances.length - 1
  ].lastScene;
  const canvas = document.querySelector("canvas")!;
  const lines = sceneLines(scene);
  return { view, scene, canvas, lines };
}

function pointer(canvas: Element, type: string, x = 0, y = 0) {
  act(() => {
    canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });
}

function opacities(scene: unknown): number[] {
  return sceneLines(scene).map((l) => (l.material as { opacity: number }).opacity);
}

/** 拦截 Raycaster：让 lines 中的第 hitIndex 条线成为最近命中；null = 未命中。 */
function stubRaycast(lines: Line[], hitIndex: number | null) {
  vi.spyOn(Raycaster.prototype, "intersectObjects").mockImplementation(() =>
    hitIndex === null
      ? []
      : [
          // Intersection 类型要求 point 字段，拾取判定不读它，给原点即可
          // Intersection requires a point; the pick logic never reads it.
          { object: lines[hitIndex], distance: 1, point: new Vector3() },
          { object: lines[(hitIndex + 1) % lines.length], distance: 5, point: new Vector3() },
        ] as unknown as Intersection[],
  );
}

describe("OrbitCanvas 拾取与聚焦（#452）", () => {
  it("悬停命中轨迹：提示显示该线名称（最近者）", () => {
    const { canvas, lines } = pickCanvas();
    stubRaycast(lines, 1);
    pointer(canvas, "pointermove", 30, 30);
    act(() => flushFrames());
    expect(screen.getByTestId("pick-tooltip").textContent).toBe("弧 B");
  });

  it("指针离开画布：提示消失", () => {
    const { canvas } = pickCanvas();
    stubRaycast(pickCanvasLines(), 0);
    pointer(canvas, "pointermove", 10, 10);
    act(() => flushFrames());
    pointer(canvas, "pointerleave");
    expect(screen.queryByTestId("pick-tooltip")).toBeNull();
  });

  it("点击命中轨迹聚焦：被点线不透明度 1，其余淡出；再点同线恢复", () => {
    const { canvas, lines, scene } = pickCanvas();
    stubRaycast(lines, 1);
    pointer(canvas, "pointerdown", 30, 30);
    pointer(canvas, "pointerup", 30, 30);
    let ops = opacities(scene);
    expect(ops[1]).toBe(1);
    expect(ops[0]).toBeLessThan(1);
    pointer(canvas, "pointerdown", 30, 30);
    pointer(canvas, "pointerup", 30, 30);
    ops = opacities(scene);
    expect(ops[0]).toBe(1);
    expect(ops[1]).toBe(1);
  });

  it("点击空白退出聚焦", () => {
    const { canvas, lines, scene } = pickCanvas();
    stubRaycast(lines, 1);
    pointer(canvas, "pointerdown", 30, 30);
    pointer(canvas, "pointerup", 30, 30);
    stubRaycast(lines, null);
    pointer(canvas, "pointerdown", 60, 60);
    pointer(canvas, "pointerup", 60, 60);
    expect(opacities(scene)).toEqual([1, 1]);
  });

  it("拖拽（位移超阈值）不触发聚焦", () => {
    const { canvas, lines, scene } = pickCanvas();
    stubRaycast(lines, 1);
    pointer(canvas, "pointerdown", 10, 10);
    pointer(canvas, "pointerup", 60, 60);
    expect(opacities(scene)).toEqual([1, 1]);
  });

  it("轨迹数据整体替换：聚焦与提示清除", () => {
    const { view, canvas, lines, scene } = pickCanvas();
    stubRaycast(lines, 1);
    pointer(canvas, "pointermove", 30, 30);
    act(() => flushFrames());
    pointer(canvas, "pointerdown", 30, 30);
    pointer(canvas, "pointerup", 30, 30);
    expect(screen.queryByTestId("pick-tooltip")).not.toBeNull();

    const other: number[][][] = [
      Array.from({ length: 30 }, (_, i) => [Math.cos((i / 30) * Math.PI), 0, Math.sin((i / 30) * Math.PI)]),
    ];
    stubRaycast(lines, null);
    act(() => {
      view.rerender(
        <OrbitCanvas
          trajectories={other}
          labels={["弧 C"]}
          mu={MU}
          libration={LIBRATION}
          projection="3d"
          center="barycenter"
          onReady={noopReady}
        />,
      );
    });
    expect(screen.queryByTestId("pick-tooltip")).toBeNull();
    expect(opacities(scene)).toEqual([1]);
  });
});

/** 拾取用例的便捷二次取线（指针离开用例里避免重复解构）。 */
function pickCanvasLines(): Line[] {
  const scene = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances[
    (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances.length - 1
  ].lastScene;
  return sceneLines(scene);
}

// —— 聚焦/预览受控态（#460/#469）：图注迁到左侧轨道清单后，画布态由
// App 经 props 驱动；清单交互用例在 CanvasOrbitList.test ——
// Controlled focus/preview state (#460/#469): with the legend moved into the
// sidebar orbit list, the canvas state is driven by App through props; the
// list-interaction cases live in CanvasOrbitList.test.

describe("OrbitCanvas 聚焦/预览受控态（#460/#469）", () => {
  function controlledCanvas(
    onFocus: (i: number | null) => void = () => {},
    onPreview: (i: number | null) => void = () => {},
  ) {
    const view = renderCanvas({
      trajectories: TWO_TRAJECTORIES,
      labels: TWO_LABELS,
      focusIndex: null,
      previewIndex: null,
      onFocusIndexChange: onFocus,
      onPreviewIndexChange: onPreview,
    });
    flushFrames();
    const scene = (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances[
      (WebGLRenderer as unknown as { instances: FakeRendererInstance[] }).instances.length - 1
    ].lastScene;
    const ops = () => opacities(scene);
    const lines = sceneLines(scene);
    return { view, scene, lines, ops };
  }

  // 受控重渲染：与 App 同源地组装 props（聚焦/预览 + 必填项）；传同一
  // trajectories 引用，几何不重建，只有不透明度变化。
  // Controlled rerender: assembles props from the same source as App
  // (focus/preview plus the required ones); the same trajectories reference
  // keeps the geometry intact — only opacity changes.
  function controlledRerender(
    view: ReturnType<typeof renderCanvas>,
    focus: number | null,
    preview: number | null,
    onFocus: (i: number | null) => void = () => {},
    trajectories: number[][][] = TWO_TRAJECTORIES,
    labels: string[] = TWO_LABELS,
    onPreview: (i: number | null) => void = () => {},
  ) {
    act(() => {
      view.rerender(
        <OrbitCanvas
          trajectories={trajectories}
          labels={labels}
          mu={MU}
          libration={LIBRATION}
          projection="3d"
          center="barycenter"
          onReady={noopReady}
          focusIndex={focus}
          previewIndex={preview}
          onFocusIndexChange={onFocus}
          onPreviewIndexChange={onPreview}
        />,
      );
    });
    flushFrames();
  }

  it("聚焦态（受控）：聚焦线原色、其余淡出；解除恢复", () => {
    const { view, ops } = controlledCanvas();
    expect(ops()).toEqual([1, 1]);
    controlledRerender(view, 1, null);
    expect(ops()).toEqual([0.15, 1]);
    controlledRerender(view, null, null);
    expect(ops()).toEqual([1, 1]);
  });

  it("预览态（受控）：预览线原色、其余淡出；离开恢复", () => {
    const { view, ops } = controlledCanvas();
    controlledRerender(view, null, 0);
    expect(ops()).toEqual([1, 0.15]);
    controlledRerender(view, null, null);
    expect(ops()).toEqual([1, 1]);
  });

  it("预览叠加于聚焦：离开预览恢复聚焦视图", () => {
    const { view, ops } = controlledCanvas();
    controlledRerender(view, 1, null); // 聚焦 B
    expect(ops()).toEqual([0.15, 1]);
    controlledRerender(view, 1, 0); // 预览 A：A 原色、B 淡出
    expect(ops()).toEqual([1, 0.15]);
    controlledRerender(view, 1, null); // 回到聚焦 B
    expect(ops()).toEqual([0.15, 1]);
  });

  it("画布点击聚焦经 onFocusIndexChange 上报，清单状态同源（双向一致）", () => {
    const onFocus = vi.fn();
    const { view, lines, ops } = controlledCanvas(onFocus);
    onFocus.mockClear(); // 挂载时的替换重置也会回调一次
    stubRaycast(lines, 1);
    const canvas = document.querySelector("canvas")!;
    pointer(canvas, "pointerdown", 30, 30);
    pointer(canvas, "pointerup", 30, 30);
    expect(onFocus).toHaveBeenCalledWith(1);
    // App 收到回调后回写受控态，画布淡出其余线
    // App writes the controlled state back upon the callback; the canvas
    // dims the other lines.
    controlledRerender(view, 1, null, onFocus);
    expect(ops()).toEqual([0.15, 1]);
  });

  it("轨迹数据整体替换：聚焦/预览经回调清零（#452/#460）", () => {
    const onFocus = vi.fn();
    const onPreview = vi.fn();
    const { view, ops } = controlledCanvas(onFocus, onPreview);
    controlledRerender(view, 1, null, onFocus, TWO_TRAJECTORIES, TWO_LABELS, onPreview);
    expect(ops()).toEqual([0.15, 1]);
    onFocus.mockClear();
    onPreview.mockClear();
    const other: number[][][] = [
      Array.from({ length: 30 }, (_, i) => [Math.cos((i / 30) * Math.PI), 0, Math.sin((i / 30) * Math.PI)]),
    ];
    controlledRerender(view, 1, null, onFocus, other, ["弧 C"], onPreview);
    expect(onFocus).toHaveBeenCalledWith(null);
    expect(onPreview).toHaveBeenCalledWith(null);
  });
});
