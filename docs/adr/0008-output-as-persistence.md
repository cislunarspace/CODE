# ADR 0008：output/ 目录作为数据持久化源

**状态**：已接受
**日期**：2026-08-04
**关联**：`docs/architecture/architecture.md`（第1层 数据层）

## 背景

GUI 需要持久化计算结果，使用户关闭并重新打开应用后不丢失工作成果。

方案选项：
- A. 自定义项目文件格式（.todproj JSON/binary）
- B. 以 output/ 目录为事实来源，GUI 启动时扫描重建
- C. SQLite 数据库

## 决策

**以 `output/` 目录为事实来源**（方案 B）。每次计算结果自动写入 `output/` 对应子目录，GUI 启动时扫描并重建 Project。

文件命名约定保持与现有 output/ 结构兼容：

```
output/
├── dro/              dro_<timestamp>.json
├── halo/             halo_<type>_<params>_<ts>.json
├── dpo/              dpo_<params>_<ts>.json
├── ro/               ro_<params>_<ts>.json
├── ephemeris/        orbit_ephemeris_<ts>.json
└── transfer/         search_*_<ts>.json, optimization_*_<ts>.json
```

## 理由

1. **零额外持久化层**：e2m2e 算法层已有 `write_ephemeris()` / `save_to_file()` 方法，结果本来就要落盘。不需要再发明格式。
2. **CLI 用户友好**：用户也可以直接用 e2m2e CLI 生成 output/ 文件，GUI 能自动发现。
3. **无锁定**：数据以标准 JSON 格式存储，不依赖 tod 的专有格式。
4. **现有 output/ 兼容**：用户已有的 output/ 文件自动出现在新 GUI 中。

## 后果

### 正面

- 不需要实现项目文件读写
- e2m2e CLI 和 GUI 共享同一数据目录
- 用户可手动管理 output/（复制、备份、分享）

### 负面

- 内存中未落盘的 Artifact（正在计算中的中间结果）关窗即丢失
- 文件命名冲突需要处理（时间戳方案已足够）
- 没有撤销能力（删除是永久的）

## 修订（2026-08-19，issue #375，关联 e2m2e ADR 0031）

e2m2e 5.8.0 落地轨道库 catalog（上游 #475 / ADR 0031）后，产物持久化的职责上收：记录格式、存储引擎与查询接口归 e2m2e 数据层与接口层，本篇决策的适用面相应收窄。

- **决策变更**：orbit / family / ephemeris 产物的清单与持久化改经 e2m2e Facade 的 catalog（`catalog_query` 供数、`catalog_get` 懒加载），design_orbit / orbit_family_generation / control_orbit 的产物由 Facade 自动入库；本仓 persistence.py 的手写 JSON+NPZ 落盘与 discovery.py 的子目录名 + 文件名正则分类退役。文件命名不再承载分类语义：多维分类（族、平动点、Jacobi、振幅、段存在性）与 `source_record_id` 由上游在生成时写入记录，不再依赖 GUI 内存与文件名推断；上文文件命名约定表移交 e2m2e ADR 0031 维护。
- **文件是事实来源不变**：catalog 的记录文件（JSON + NPZ）是唯一持久化，SQLite 索引是派生物，删除后可扫描记录文件全量重建。当年未选的方案 C 指以数据库为持久化层；派生索引不构成格式锁定，与理由 3（无锁定）不冲突。
- **库目录**：默认钉在仓库根 `catalog/`（与 output/ 平级，GUI 场景 cwd 不稳定，不能依赖上游的相对默认），可在 GUI 设置中改指其他目录（QSettings 持久化）。
- **谱系**：站保产物的 `source_record_id` 由 Facade 写入（`input_record_id` 输入），重启后经 catalog_query 重建因果链；上游记录被删时项目树显示断链降级标记，不阻止产物使用。
- **过渡**：transfer（转移轨道）等 catalog 分类体系之外的产物沿用 output/ 目录扫描（仅限这些目录），待上游对相应产物入库立项后退役。
- **旧产物**：output/ 旧格式不迁移（上游 ADR 0031 决策 9），需要时重算，理由 4现有 output/ 兼容随之失效。

其余部分（Project 不做持久化、删除无撤销）不变。

## 修订（2026-09-26，issue #491，关联 e2m2e ADR 0047）

上游 e2m2e ADR 0047（随 v5.9.5）把 `catalog_enabled` 默认翻转为关、`catalog_dir` 默认 None：未指定目录时库操作报 `CATALOG_NOT_CONFIGURED`，未开入库开关时 record_id 静默为 None。上一节的库目录落点随之更新：库目录不再钉仓库根 `catalog/`，改由本仓在 Rust 壳 app setup 显式注入 `E2M2E_CATALOG_ENABLED=1` 与 `E2M2E_CATALOG_DIR=<用户配置目录>/catalog`（Windows `%APPDATA%/transfer-orbit-design/catalog`，Linux 为 XDG 配置目录下的同名路径，与情景、助手会话同级），不随工作目录漂移；改指方式为预设 `E2M2E_CATALOG_DIR`，用户预设优先。仓库根 `catalog/` 余下供脚本与测试（Python 领域层默认）使用；旧库不迁移（见上一修订的旧产物条）。