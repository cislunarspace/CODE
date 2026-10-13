# 开发指南

## 文档规范

本项目的文档面向中文研究用户和维护者，所有新增 README、Sphinx 页面、GUI 描述、CLI help 与 docstring 均使用中文。Python docstring 采用 Google style，以便 `sphinx.ext.napoleon` 自动解析。

### 模块级 docstring

每个 `src/` 生产模块都必须包含模块级 docstring，并放在文件第一条语句。建议结构：

```python
"""FacadeBridge -- e2m2e 算法层直调的薄封装。

直接调用 algorithm 层而非 Facade 门面，因为 Facade 返回的 DesignOrbitResponse
剥离了轨道数据（只返回标量汇总），而 GUI 需要完整的 Orbit 对象用于可视化。
详见 docs/adr/0011-algorithm-layer-direct-call.md。
"""
```

不同模块类型的重点如下：

| 类型 | 必写内容 |
|------|----------|
| 数据层（`src/model/`） | 数据类的字段含义、与持久化（catalog / output）的对应关系 |
| 执行层（`src/engine/`） | 调用的 e2m2e 算法、返回 DTO 的字段、异常翻译、落盘布局 |
| 前端（`frontend/src/`） | 组件职责、props 语义、与 IPC/画布的交互 |
| Rust 壳（`src-tauri/src/`） | 命令语义、sidecar 进程与协议边界、状态生命周期 |
| 工具脚本（`scripts/`） | 用途、参数、输出 |

### 函数与类 docstring

公共函数、公共类和 dataclass 使用单行摘要 + `Args` / `Returns` / `Raises` 的 Google-style 格式。不要在 `Args` 中重复 type hint，只写含义、单位和约束。

```python
def load_orbit(path: Path) -> dict:
    """读取轨道 JSON 文件并返回原始载荷。

    Args:
        path: 轨道 JSON 文件路径。

    Returns:
        解析后的 JSON 字典，包含 `states`、`times` 和 `period` 等键。

    Raises:
        FileNotFoundError: 输入文件不存在。
        ValueError: JSON 内容缺少轨道状态字段。
    """
```

`main()` 和 `parse_args()` 也需要 docstring：`parse_args()` 说明返回解析后的命名空间；`main()` 说明执行完整脚本流程且通常不返回值。私有 helper 可以使用较短 docstring，但仍应说明单位、边界或失败条件。

### CLI help 文本（工具脚本）

`scripts/` 下的独立工具脚本（`download_kernels.py`、`smoke_mcp_serve.py`）
使用 `argparse`。help 文本必须回答三个问题：参数控制什么、默认值是什么、单位是什么。示例：

```python
parser.add_argument(
    "--position-tol",
    type=float,
    default=1e-3,
    help="多重打靶位置连续性容差，默认 1e-3 km。",
)
```

无量纲 CR3BP 参数应注明为无量纲；角度单位写 rad 或度；时间单位写 TU、天或秒。布尔开关说明开启后的行为。

### 国际化

界面 i18n 在前端 `frontend/src/i18n.ts`：中英两份字符串字典，`t(key)` 取用，
语言选择存 localStorage、重启保留。新增界面文本时同步向两个字典各加一条键值；
新增语种则追加一份字典。（PyQt 时代的 `tools/update_i18n.py` 与 `src/app/i18n/`
已随旧 UI 删除。）

### Sphinx 文档

Sphinx 源文件位于 `docs/source/`，叙事文档通过 MyST Markdown 接入。

```bash
uv run --extra docs python -m sphinx -b html docs/source docs/build/html
```

提交前应至少确认构建无 ERROR，并尽量清理 WARNING。若新增/删除叙事页面，请在 `docs/source/index.rst` 的对应 toctree 中增删条目。

### README

- `README.md` 为中文主文档（双语机制已撤销）。
- 代码块、命令、路径、模块名一律不翻译。

## 日志与打印

本项目使用 Python `logging` 模块而非 `print()` 进行输出。

### 日志级别

| 级别 | 数值 | 说明 |
|------|------|------|
| `DEBUG` | 10 | 详细调试信息 |
| `INFO` | 20 | 一般信息 |
| `WARNING` | 30 | 警告（默认级别） |
| `ERROR` | 40 | 错误 |
| `CRITICAL` | 50 | 严重错误 |

默认日志级别为 `WARNING`，只有更高级别的日志会输出。

### 使用规范

脚本入口模块应配置 logging：

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)
```

使用 `logger.info()`、`logger.debug()` 等代替 `print()`。这使得：
- 可通过调整日志级别控制输出详细程度
- 支持日志处理器（如写入文件）
- 输出带有时间戳、模块名等上下文信息

### 调试模式

运行脚本时设置环境变量可临时调整日志级别：

```bash
# 显示 INFO 及以上
set PYTHONLOGLEVEL=INFO

# 显示所有日志（包括 DEBUG）
set PYTHONLOGLEVEL=DEBUG
```

## 代码规范

- 语言。文档、注释、docstring 用中文，命令、路径、代码标识符不翻译，项目文档不使用「」这类直角引号。`src/` 的每个生产模块必须有模块级 docstring，函数与类的 docstring 用 Google style。脚本的输出走 `logging` 不走 `print`，CLI help 要回答参数控制什么、默认值、单位三问。
- 格式。行尾与缩进由 `.editorconfig` 给定（Python 4 空格，YAML/JSON/TOML 2 空格，LF）。ruff 行长 100，`tests/`、`docs/`、`scripts/`、`tools/` 不做行长检查。TypeScript 走 strict 模式（`tsc -b`）。前端没有 prettier 与 eslint，Rust 没有 rustfmt 与 clippy 配置，不要引入格式化重排制造噪音 diff。
- 命名。Python 模块与函数用 `snake_case`，类用 `PascalCase`，结果 DTO 带 `…ResultData` 后缀，常量用 `UPPER_SNAKE`。Rust 类型用 `PascalCase`，常量用 `SCREAMING_SNAKE`，文件头的 `//!` 重在讲为什么。TypeScript 组件是 `PascalCase.tsx`，逻辑模块是 `camelCase.ts`。
- 跨 IPC 的 struct 用 `#[serde(rename_all = "camelCase")]`，例外是 `EphemerisSegment`，它故意保持 snake_case，与 e2m2e 的 `EphemerisTable` 同形以便共用解析。发给 sidecar 的 `arguments` 保持 snake_case，用 e2m2e request 的字段原名。
- 错误处理。Python 统一用 `OrbitError(code, message, cause)`，`translate_exception` 把 e2m2e 异常翻成 `CORRECTION_DIVERGED`、`PROPAGATION_FAILED`、`BACKEND_UNAVAILABLE`、`KERNEL_NOT_FOUND`、`INVALID_PARAMS` 等错误码。Rust 内部用 `anyhow`，跨 IPC 返回 `Result<T, String>`。前端用 `formatToolError` 配合 antd toast 与表单内联标红。原则是不伪造成功，坏文件明确报错（`scenario.ts:parseScenario`），可选数据可以软失败降级（如 `moonTrackFromResponse` 返回 null）。
- 异步。Python 纯同步，不用 asyncio。Rust 用 tokio，配合 mpsc 与 oneshot，sidecar 单任务串行，MCP 按 id 多路复用并发，进程级配置经 `OnceLock` 在 app setup 注入。前端用 async/await，Tauri API 动态 import，在 effect 里处理竞态取消。
- 依赖注入与状态。Rust 用 Tauri managed state（`SidecarState`、`ProjectState`、`AssistantState`）加 `State<'_>`。Python 用构造器注入（`FacadeBridge(kernel_dir, catalog_dir)`、`CatalogService(bridge)`）。前端没有 store 库，`App.tsx` 用单组件 `useState` 集中管理状态，持久化走 `localStorage` 的 `tod-*` 键。

## 测试规范

- 三套栈并存：pytest（`tests/`）、cargo test（`src-tauri/tests/` 加源文件尾的 `#[cfg(test)]`）、vitest（`frontend/src/` 同目录的 `*.test.ts(x)`）。命令见 README 的测试与代码规范一节。
- marker 只有 `spice`（需要 SPICE 内核真算）与 `slow`。日常跑 `-m "not spice"`，真路径冒烟用 `uv run pytest tests/engine/test_facade_bridge_e2m2e_smoke.py -m spice`。
- CI 只跑 Python（`-m "not spice"`）。cargo test 与 npm test 不在任何 workflow 里，改 Rust 或前端必须本地跑对应测试。Rust 侧没有 Python 环境时用 `cargo test --manifest-path src-tauri/Cargo.toml -- --skip sidecar`。`assistant_pi_rpc` 用例依赖本仓 uv 环境（`uv run python` 拉起 fake 服务端，缺 uv 时自动跳过并打印原因，见 #502），必须串行跑。
- 命名与组织。Python 用 `test_<module>.py` 镜像 `src/` 的布局，方法名是 `test_<行为>_<期望>`。前端 `describe` 与 `it` 用中文并带 issue 号。Rust 集成测试一文件一主题，放在 `src-tauri/tests/`，golden 夹具在 `src-tauri/tests/fixtures/`。
- 断言。标量用 `pytest.approx`，数组用 `np.testing.assert_allclose`（atol 1e-6 量级），Rust 的 f32 容差取 1e-6。随机数不设种子，不断言随机值，只断言形状或由输入推导出的期望。
- 共享设施。`tests/conftest.py` 注入 `SPICE_KERNEL_DIR`、Agg 后端与隔离的 `CATALOG_DIR`，`tests/engine/conftest.py` 提供 fake e2m2e 结果族与 `mock_design_orbit`。打包冒烟 `scripts/smoke_mcp_serve.py`（release 发布闸）与 `scripts/smoke_pi_rpc.py`（pi RPC 链路）在手工或发布期跑，不进测试套件。
- 静态检查（CI 同款）：`uv run ruff check . && uv run ruff format --check . && uv run pyright`。三条都在 `ci.yml` 里跑，本地提交前跑同一条。
- 没有覆盖率门槛。修 bug 先复现，验证按编码准则的验证行为与按根因修复两条执行。

## 工具链约束

- Python 钉在 3.13（`>=3.13,<3.14`），因为 calcephpy 的预编译轮子只有 cp313，原因见 `pyproject.toml` 的注释。包管理只用 uv，`uv.lock` 入库，index 钉 `https://pypi.org/simple`，重锁用 `uv lock --upgrade-package calcephpy`。Windows 的 calcephpy 走 `[tool.uv.sources]` 的预编译 wheel，不要删。
- Node.js 需 20 以上，前端测试实际需要 22.13 以上（jsdom 30）。包管理用 npm，`package-lock.json` 入库，命令一律带 `--prefix frontend`。
- Rust 用稳定版工具链，edition 2021，Tauri 2，`Cargo.lock` 入库。
- 打包。PyInstaller onefile 产 sidecar（`packaging/cislunar_code_sidecar.spec`，datas 逐包收 e2m2e 与 R2S2 星历，漏收即坏包）。release 分 slim（无 kernels，供更新通道）与全量（含 kernels，供新装）。pi 钉版本随包分发，见 `release.yml` 的 env。
- 新增依赖前先看有没有现成依赖或标准库可用，确实要加时说明理由。