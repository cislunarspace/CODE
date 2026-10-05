// ProjectTree 交互测试：勾选多选（绘制所选）、星标切换、备注 Tooltip 与编辑。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectTree } from "./ProjectTree";
import { catalogTag, catalogQuery } from "./catalogApi";
import type { ArtifactSummary } from "./projectApi";

vi.mock("./catalogApi", () => ({
  catalogDelete: vi.fn(),
  catalogQuery: vi.fn(),
  catalogTag: vi.fn().mockResolvedValue(true),
  STAR_TAG: "★",
}));

// 三条 orbit 叶子：a1 行数据带 tags/note；a2 缺 tags（走详情查询分支）
const ITEMS: ArtifactSummary[] = [
  { artifactId: "a1", artifactType: "orbit", label: "Halo A", orbitType: "HALO", sourceTool: "", recordId: "r1", createdAt: "", tags: ["demo"], note: "N".repeat(100) },
  { artifactId: "a2", artifactType: "orbit", label: "NRHO B", orbitType: "NRHO", sourceTool: "", recordId: "r2", createdAt: "" },
  { artifactId: "a3", artifactType: "orbit", label: "DRO C", orbitType: "DRO", sourceTool: "", recordId: "r3", createdAt: "" },
];

function setup(artifacts: ArtifactSummary[] = ITEMS) {
  const props = {
    artifacts,
    selectedId: null,
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onPlotSelected: vi.fn(),
    onMetaChange: vi.fn(),
  };
  const view = render(<ProjectTree {...props} />);
  return { props, view };
}

// 行定位：按叶子标签找到树行，再取行内勾选框
// Row lookup: find the tree row by leaf label, then grab its checkbox.
function checkboxOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".ant-tree-treenode");
  expect(row).not.toBeNull();
  const box = row!.querySelector(".ant-tree-checkbox") as HTMLElement | null;
  expect(box).not.toBeNull();
  return box!;
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 无 ResizeObserver（antd Tree 虚拟列表依赖）：stub 空实现
  // jsdom lacks ResizeObserver (antd Tree's virtual list needs it): stub an empty impl.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.mocked(catalogQuery).mockResolvedValue({
    records: [{ record_id: "r2", orbit_family: "", tags: ["t2"] }],
    message: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectTree 勾选多选（#419）", () => {
  it("勾选 ≥2 叶子出现“绘制所选”，点击回传勾选集合", async () => {
    const { props } = setup();
    // 只勾 1 条不出现入口
    fireEvent.click(checkboxOf("Halo A"));
    expect(screen.queryByRole("button", { name: /绘制所选/ })).toBeNull();

    fireEvent.click(checkboxOf("NRHO B"));
    const btn = screen.getByRole("button", { name: /绘制所选/ });
    expect(btn.textContent).toContain("2");
    fireEvent.click(btn);
    await waitFor(() => expect(props.onPlotSelected).toHaveBeenCalledTimes(1));
    expect(props.onPlotSelected.mock.calls[0][0].map((a: ArtifactSummary) => a.artifactId)).toEqual(["a1", "a2"]);
  });

  it("勾选不触发单击选中；单击叶子仍走 onSelect", () => {
    const { props } = setup();
    fireEvent.click(checkboxOf("Halo A"));
    expect(props.onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("DRO C"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect.mock.calls[0][0].artifactId).toBe("a3");
  });
});

describe("ProjectTree 星标切换（#419）", () => {
  it("行缺 tags 时先查详情再追加 ★（catalog_tag 整体替换，note 不动）", async () => {
    const { props } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "星标" })[1]); // NRHO B
    await waitFor(() => expect(catalogQuery).toHaveBeenCalledWith({ record_id: "r2" }));
    await waitFor(() => expect(catalogTag).toHaveBeenCalledWith("r2", ["t2", "★"]));
    await waitFor(() => expect(props.onMetaChange).toHaveBeenCalledWith("r2", ["t2", "★"]));
  });

  it("已星标行再点移除 ★，直接用行内 tags 不重查", async () => {
    const starred = ITEMS.map((a: ArtifactSummary) =>
      a.artifactId === "a1" ? { ...a, tags: ["★", "demo"] } : a,
    );
    const { props } = setup(starred);
    fireEvent.click(screen.getAllByRole("button", { name: "星标" })[0]); // Halo A
    await waitFor(() => expect(catalogTag).toHaveBeenCalledWith("r1", ["demo"]));
    expect(catalogQuery).not.toHaveBeenCalled();
    await waitFor(() => expect(props.onMetaChange).toHaveBeenCalledWith("r1", ["demo"]));
  });
});

describe("ProjectTree 备注（#419）", () => {
  it("悬停显示备注摘要（超长截断到 80 字符）", async () => {
    setup();
    fireEvent.mouseEnter(screen.getByText("Halo A"));
    await waitFor(() => {
      expect(screen.getByText(`${"N".repeat(80)}…`)).toBeDefined();
    });
  });

  it("右键“编辑备注”保存走 catalog_tag（行内 tags 整体替换 + 新 note）", async () => {
    const { props } = setup();
    fireEvent.contextMenu(screen.getByText("Halo A"));
    fireEvent.click(await screen.findByText("编辑备注..."));

    const area = await screen.findByPlaceholderText("备注内容...");
    fireEvent.change(area, { target: { value: "新备注" } });
    // antd 两字中文按钮自动插入空格（“保 存”），用正则匹配
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(catalogTag).toHaveBeenCalledWith("r1", ["demo"], "新备注"));
    await waitFor(() => expect(props.onMetaChange).toHaveBeenCalledWith("r1", ["demo"], "新备注"));
  });
});

describe("ProjectTree 分组头与结构化摘要（#468）", () => {
  it("分组头为文字 + 计数徽标，无 emoji；空组徽标置灰", () => {
    setup();
    // 四个分组按固定顺序渲染，emoji 全部消失
    expect(screen.getByText("轨道")).toBeDefined();
    expect(screen.queryByText(/🪐|🌀|🚀|📡/)).toBeNull();

    const badges = Array.from(document.querySelectorAll(".ant-badge-count")) as HTMLElement[];
    expect(badges.length).toBe(4);
    // 组序 orbit/family/transfer/ephemeris：orbit 3 条蓝徽标，family 0 条灰徽标
    expect(badges[0].textContent).toBe("3");
    expect(badges[0].style.backgroundColor).not.toBe("");
    expect(badges[1].textContent).toBe("0");
    expect(badges[1].style.backgroundColor).not.toBe(badges[0].style.backgroundColor);
  });

  it("叶子第二行挂结构化摘要：成员序号 / L 点 / Jacobi；缺字段不渲染第二行", () => {
    const items: ArtifactSummary[] = [
      {
        artifactId: "a1", artifactType: "family", label: "HALO 家族", orbitType: "HALO",
        sourceTool: "", recordId: "r1", createdAt: "",
        memberIndex: 12, librationPoint: 2, jacobi: 3.1536,
      },
      ...ITEMS.slice(0, 1),
    ];
    setup(items);
    expect(screen.getByText("成员 12 · L2 · C 3.154")).toBeDefined();
    // 无富化字段的行（Halo A）不渲染第二行：全文只此一处成员摘要
    expect(screen.getAllByText(/成员/).length).toBe(1);
  });

  it("受控展开：初始全展开，点分组头折叠后子行消失", () => {
    // Tree 本体已按 ADR 0020 传 motion={false}，jsdom 里无收起动画卡滞
    // The Tree itself passes motion={false} per ADR 0020, so jsdom has no
    // stuck collapse motion.
    const props = {
      artifacts: ITEMS,
      selectedId: null,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      onPlotSelected: vi.fn(),
      onMetaChange: vi.fn(),
    };
    render(<ProjectTree {...props} />);
    expect(screen.getByText("Halo A")).toBeDefined();

    const groupState = () =>
      screen.getByText("轨道").closest(".ant-tree-treenode") as HTMLElement;
    const switcherOf = () =>
      groupState().querySelector(".ant-tree-switcher") as HTMLElement;

    expect(groupState().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(switcherOf());
    expect(groupState().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(switcherOf());
    expect(groupState().getAttribute("aria-expanded")).toBe("true");
  });

  it("容器量得高度后 Tree 启用虚拟滚动（height 传入）", () => {
    // RO stub：observe 即给元素定高，模拟真实浏览器量高回调路径
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(el: Element) {
          Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 });
        }
        disconnect() {}
        unobserve() {}
      },
    );
    const { view } = setup();
    const holder = view.container.querySelector(".ant-tree-list-holder") as HTMLElement | null;
    expect(holder).not.toBeNull();
    expect(holder!.getAttribute("style")).toContain("400px");
  });
});
