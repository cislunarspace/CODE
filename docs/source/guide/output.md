# 产物与轨道库

## catalog/ 目录

v4.0.0 起，界面计算产物统一持久化到 **e2m2e 轨道库**（catalog），不再按工具
分目录落 JSON/NPZ 文件。轨道库默认位于 sidecar 工作目录下的 `catalog/`：
开发期即仓库根 `catalog/`，安装版在安装目录下；可用环境变量
`$E2M2E_CATALOG_DIR` 改指。

产物**自动入库**：族生成成功后即成为库记录（多维分类：族类型、平动点、
Jacobi 区间、振幅区间；谱系指针记录上下游因果链）。重启后项目树经
`catalog_query` 恢复清单，单条记录经 `catalog_get` 懒加载轨迹。

## 库即数据格式

轨道库是 e2m2e catalog 格式（见
[e2m2e 文档](https://cislunarspace.github.io/CODE-core/)）：

- 记录按多维分类索引，支持组合过滤查询；
- 谱系指针（上游记录 id）使设计 → 保持等链式产物的因果关系重启不断；
- 库目录可整体拷贝、打包导出，亦可被 e2m2e CLI 或其他宿主直接打开。

## output/ 目录（遗留）

`output/` 仅保留两类内容：转移轨道遗留分区（`output/transfer/`，catalog
分类体系之外的过渡期产物）与脚本化工作流的直接输出。v3.2.3 及更早版本按
工具分目录 + JSON/NPZ 双文件管理的产物不迁移（ADR 0008），需要时重算。