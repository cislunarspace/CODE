// AssistantConfigStrip 测试：选项与当前值来自 Rust 构造的 pi 配置面
//（model/thinking 两项），变更上报 (configId, value)；未知配置项不渲染。
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
    id: "unknown-x",
    name: "X",
    currentValue: "1",
    options: [{ value: "1", name: "1" }],
  },
];

describe("AssistantConfigStrip 配置面（#493）", () => {
  it("渲染模型/思考两个控件，未知配置项不渲染（pi 切换后无模式项）", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("模型")).toBeDefined();
    expect(screen.getByLabelText("思考")).toBeDefined();
    expect(screen.queryByLabelText("模式")).toBeNull();
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

  it("思考档沿用 pi 原生值域文案", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled={false} onChange={vi.fn()} />,
    );
    fireEvent.mouseDown(screen.getByLabelText("思考"));
    expect(screen.getAllByText("medium").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("off").length).toBeGreaterThanOrEqual(1);
  });

  it("禁用态下两个控件全部禁用", () => {
    render(
      <AssistantConfigStrip configOptions={configOptions} disabled onChange={vi.fn()} />,
    );
    for (const name of ["模型", "思考"]) {
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
