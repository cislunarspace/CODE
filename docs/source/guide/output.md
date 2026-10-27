# 产物与轨道库

## 轨道库目录

轨道族生成、任务轨道设计、参数空间扫描、轨道保持、转移轨道设计的结果持久化到 e2m2e 轨道库（catalog），不按工具分目录落 JSON 或 NPZ 文件。轨道预报与时空坐标转换只进结果层，重启不保留。桌面端的库目录固定在用户配置目录下的 `catalog/`。Windows 为 `%APPDATA%/cislunar-code/catalog`，Linux 为 `$XDG_CONFIG_HOME`（通常 `~/.config`）下的 `cislunar-code/catalog`，与情景文件、助手会话同级。目录由 Rust 壳启动时显式注入，不随工作目录漂移。用户在环境里预设 `E2M2E_CATALOG_DIR` 时以预设为准。

## 自动入库与谱系

支持入库的工具计算成功后，产物自动入库。一条记录带多维分类，包括族类型、平动点、Jacobi、振幅区间，也带谱系指针、标签、备注。重启后项目树经 `catalog_query` 恢复清单，单条记录经 `catalog_get` 懒加载轨迹。下游记录用 `source_record_id` 指向上游，谱系跨重启保持。上游记录被删时谱系断链，产物本身仍可用。

## 基线数据集

e2m2e 5.9.5 起，基线 CR3BP 族不再随 Python 包分发，改为 GitHub Release 资产显式导入。CODE 的安装包随带一份基线 zip，包含 13 个族。应用首次启动时，在轨道库已配置的前提下自动解压导入，导入条数写入应用日志。

导入是幂等的，按族对位基线版本。库中已有同版本基线族时跳过，用户对基线成员的增删得到尊重。基线版本变化时整族替换为新的基线成员。升级安装包只会把基线族换到新版本，不会覆盖或重复用户自己的记录。

开发与脚本链路没有这一步，需要手动导入同一份 zip：

```bash
# 从 Release 下载默认基线包并导入，库目录取 $E2M2E_CATALOG_DIR，
# 未设置时用用户配置目录下的 catalog/
uv run python scripts/import_baseline.py --download

# 或导入本地已有的 zip
uv run python scripts/import_baseline.py --zip packaging/baseline/baseline-cr3bp-5.9.0.zip
```

导入失败不会阻断应用启动。zip 损坏或数据集残缺时只记警告并跳过，用户自己的记录与库的可用性不受影响。

## 库即数据格式

轨道库是 e2m2e catalog 格式，详见 [e2m2e 文档](https://cislunarspace.github.io/CODE-core/)。

- 记录按多维分类索引，支持组合过滤查询。
- 谱系指针记录上游记录 id，使设计到保持等链式产物的因果关系重启不断。
- 库目录可整体拷贝、打包导出，也可被 e2m2e CLI 或其他宿主直接打开。

## output/ 目录（遗留）

`output/` 仅保留两类内容：转移轨道遗留分区（`output/transfer/`，catalog 分类体系之外的过渡期产物）与脚本化工作流的直接输出。v3.2.3 及更早版本按工具分目录、以 JSON 与 NPZ 双文件管理的产物不迁移（ADR 0008），需要时重算。
