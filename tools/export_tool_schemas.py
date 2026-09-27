"""把 e2m2e 工具的 input_schema 导出为前端静态 JSON。

用法：``uv run python tools/export_tool_schemas.py``
产物：``frontend/src/toolSchemas/<tool>.json``。升级 e2m2e 后重跑。

GUI 参数面板从 schema 自动生成表单。schema 是构建期资产而非运行期查询：
sidecar 协议没有 schema 元工具，且 schema 变化本就应当随版本评审，
不宜静默热取。

English: export e2m2e tools' input_schema as static frontend JSON.
Usage: ``uv run python tools/export_tool_schemas.py``; output goes to
``frontend/src/toolSchemas/<tool>.json`` — rerun after upgrading
e2m2e. The GUI parameter panel generates forms from the schemas.
Schemas are build-time assets rather than runtime queries: the sidecar
protocol has no schema meta-tool, and schema changes should be reviewed
with each version anyway, not silently hot-fetched.
"""

import json
from pathlib import Path

from e2m2e.api.facade import Facade
from e2m2e.api.mcp import tools


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "frontend" / "src" / "toolSchemas"
    out_dir.mkdir(parents=True, exist_ok=True)
    for spec in tools.tool_specs(Facade()):
        path = out_dir / f"{spec.name}.json"
        # newline="\n"：显式写 LF。Windows 上默认换行翻译会写出 CRLF，
        # 与 .editorconfig 的 LF 约定相悖，且使每次重导都产生纯换行噪音 diff。
        # newline="\n": write LF explicitly. The default newline translation on
        # Windows emits CRLF, contradicting the LF convention in .editorconfig
        # and turning every re-export into pure line-ending churn.
        path.write_text(
            json.dumps(spec.input_schema, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
        print(f"{spec.name}: {path.name}")


if __name__ == "__main__":
    main()