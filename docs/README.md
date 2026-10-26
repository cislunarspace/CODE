# 文档维护

本目录记录项目文档维护约定。项目使用 Sphinx 构建文档，文档以中文撰写。

## 安装文档依赖

文档构建依赖位于 `docs` optional dependencies。首次维护文档前先同步依赖：

```bash
uv sync --extra docs
```

后续文档命令均通过 `uv run` 执行。

## 构建 HTML 文档

构建中文文档：

```bash
uv run sphinx-build -b html -D language=zh docs/source docs/build/html
```

构建完成后打开 `docs/build/html/index.html`。`docs/build/` 和 `.mo` 文件均为构建产物，不提交到仓库。
