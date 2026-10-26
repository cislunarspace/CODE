# 工具参考

左侧工具列表接通八个工具：轨道族生成、任务轨道设计、参数空间扫描（catalog_sweep）、轨道保持、轨道预报、转移轨道设计、时空坐标转换与分区边界（spatiography_boundaries）。轨道稳定性已随上游移除，界面不再提供。参数停靠由工具的 JSON Schema 自动生成，字段范围、默认值与说明来自 e2m2e 的 Pydantic 模型。表单按 `orbit_type` 裁剪，只显示当前族适用的字段。Optional 字段以勾选控制传不传值，勾选即传，不勾视为未设置。本页展开说明轨道族生成与转移设计，其余工具的参数见各 schema 与 {doc}`../dev/architecture`。

> 轨道族生成界面不暴露 RO（共振轨道）。族生产退出产品面（#489），需要 RO 族时走 AI 助手链路或 e2m2e CLI。单条 RO 轨道在设计工具里可选。

## 轨道族生成（orbit_family_generation）

在 CR3BP 中生成轨道族。周期族（Halo、NRHO、Axial、SPO、LPO、Horseshoe）为延拓，Lissajous 为拟周期轨迹的参数采样，DRO 为月心族，不绑定平动点。范围与默认值由 e2m2e `FamilyGenerationRequest` 的 `valid_ranges` 决定，GUI 不另维护一份。纯 CR3BP 计算，不需要 SPICE 内核。

| 参数 | 适用族 | 说明 |
|------|--------|------|
| `orbit_type` | 全部 | 族类型：HALO、NRHO、AXIAL、LISSAJOUS、SPO、LPO、HORSESHOE、DRO |
| `libration_point` | 除 DRO | 平动点。共线族为 L1、L2，Lissajous 加 L3，三角族为 L4、L5。缺省按族取默认 |
| `n_orbits` | 全部 | 族成员数上限，实际以延拓或采样结果为准 |
| `max_amplitude_km` | 全部 | 振幅上限。Halo 与 Axial 带符号区分南北族，SPO、LPO、Horseshoe 为距 L4 或 L5 的径向距离，DRO 为距月心距离 |
| `min_amplitude_km` | SPO、LPO、Horseshoe、DRO | 振幅下限（km） |
| `north_south` | NRHO | 北族或南族 |
| `perilune_height_max_km` | NRHO | 近月点高度上限（km） |
| `amplitude_in_km`、`amplitude_out_km` | Lissajous | 面内与面外振幅上限（km） |
| `phase_in`、`phase_out` | Lissajous | 面内与面外初始相位（0 到 1） |
| `continuation_direction` | SPO、LPO、Horseshoe、NRHO | 延拓方向（`decrease-x0` 或 `increase-x0`） |
| `match_tolerance_km` | SPO、LPO、Horseshoe | 振幅匹配容差（km） |

结果入轨道库，record id 显示在参数停靠下方，族成员轨迹逐条渲染到画布。

## 转移轨道设计（transfer_design）

生成地月转移轨迹，支持 HMN（Hohmann 式）、LGA（月球借力）、WSB（弱稳定边界）与 PCN（圆锥曲线拼接）四类。参数停靠按转移类型联动显隐。HMN 显示目标地心半径，默认 384400 km，为环月演示。LGA 与 WSB 需要先在项目树选中一条轨道记录，提交时自动取其 CR3BP 状态末行，换算到会合系物理单位后注入目标星历。未选中记录时拦截提交并提示。LGA 无显式搜索参数时默认注入加密相位网格（360 点）。

PCN 显示两个目标参数化，两者恰给其一。到达模式填 `bplane_target`，即月心 B 平面 JSON，给定近月点高度与 B·T、B·R。出发模式填 `departure_asymptote`，即出发双曲渐近线的赤经、赤纬与 C3 JSON。两者都空或都填，提交前即拦截并标红。

转移结果按 e2m2e ADR 0040 契约解析，坐标为会合系质心原点物理 km，时刻为 TLI 起算秒。位置除以 DU_KM 后上画布。机动事件取响应里的结构化 `maneuver_events`，包括出发与到达脉冲，LGA 与 WSB 另有近月点旗标，在时间轴上以 Δv 事件标记显示。PCN 结果的成功提示同时回显 B 平面摘要，包括近月点高度、B·T、B·R 与 v∞。出发模式回显渐近线赤经、赤纬与 C3。

## 分区边界（spatiography_boundaries）

返回地月空间分区参照几何，即 Rosengren et al. 2026 Primer 五省分区，包括 Laplace 半径、SOI 与 Hill 圆族、Battin 曲线、Chebotarev 圆与 L3 至 L5 平动点。几何经 km 到 DU 归一后作为画布参照图层显示，图表设置可开关。分区边界不是轨迹产物，不入轨道库。

## 其余工具

21 个工具的 schema 已全部导出到 `frontend/src/toolSchemas/`。其中 6 个是 catalog 操作，5 个是分区解析工具，6 个是核心计算工具，2 个是无参查询工具 `valid_ranges` 与 `catalog_terminology`，另有任务级工具 `low_thrust_preliminary` 与 `mission_architecture_search`。两个任务级工具不进 GUI 表单，留档供 AI 助手链路。

任务轨道设计、轨道保持、轨道预报与时空坐标转换的参数以 schema 为准。参数空间扫描在左侧工具列表直接可用。catalog 操作的界面分布是：查询与取用由轨道库标签与画布叠加承担，删除在项目树右键菜单，标注在记录详情面板，教学案例包导出在过滤栏。需要脚本化工作流时，经 [e2m2e CLI](https://cislunarspace.github.io/CODE-core/) 使用。
