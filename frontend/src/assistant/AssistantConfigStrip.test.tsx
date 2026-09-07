// AssistantConfigStrip 测试：选项与当前值完全来自 omp configOptions，
// 变更上报 (configId, value)；未知配置项不渲染；模式选项中文标签。
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantConfigStrip } from "./AssistantConfigStrip";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});


const configOptions = [
  {
    id: "model",
    name: "Model",
    currentValue: "a/b",
    options: [
      { value: "a/b", name: "Model B" },
      { value: "a/c", name: "Model C" },
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    currentValue: "medium",
    options: [
      { value: "off", name: "off" },
      { value: "medium", name: "medium" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  },
  {
    id: "unknown-x",
    name: "X",
    currentValue: "1",
    options: [{ value: "1", name: "1" }],
  },
];

describe("AssistantConfigStrip", () => {
  it("渲染模型/思考/模式三个控件，未知配置项不渲染", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("模型")).toBeDefined();
    expect(screen.getByLabelText("思考")).toBeDefined();
    expect(screen.getByLabelText("模式")).toBeDefined();
    expect(screen.queryByLabelText("X")).toBeNull();
  });

  it("选择新模型上报 (model, value)", () => {
    const onChange = vi.fn();
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled={false} onChange={onChange} />,
    );
    fireEvent.mouseDown(screen.getByLabelText("模型"));
    fireEvent.click(screen.getByText("Model C"));
    expect(onChange).toHaveBeenCalledWith("model", "a/c");
  });

  it("模式选项显示中文标签（默认/规划）", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled={false} onChange={vi.fn()} />,
    );
    fireEvent.mouseDown(screen.getByLabelText("模式"));
    expect(screen.getAllByText("默认").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("规划").length).toBeGreaterThanOrEqual(1);
  });

  it("禁用态下三个控件全部禁用", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled onChange={vi.fn()} />,
    );
    for (const name of ["模型", "思考", "模式"]) {
      expect(
        screen.getByLabelText(name).closest(".ant-select")?.classList.contains("ant-select-disabled"),
      ).toBe(true);
    }
  });

  it("空配置面不渲染任何控件", () => {
    const { container } = render(
      <AssistantConfigStrip configOptions={[]} disabled={false} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
