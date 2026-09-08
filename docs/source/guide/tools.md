# 工具参考

中栏工具面板接通八个工具：轨道族生成、任务轨道设计、参数空间扫描
（catalog_sweep）、轨道保持、轨道预报、转移轨道设计、时空坐标转换与
分区边界（spatiography_boundaries）；轨道稳定性因上游 placeholder
（空参 schema）暂不接入。参数面板由工具的 JSON Schema 自动生成：字段范围、
默认值与说明来自 e2m2e 的 Pydantic 模型；按 `orbit_type` 裁剪，只显示当前族
适用的字段；Optional 字段以勾选控制传不传值（勾选即传、不勾视为未设置）。
本页展开说明轨道族生成与转移设计，其余工具的参数见各 schema 与
{doc}`../dev/architecture`。

## 轨道族生成（orbit_family_generation）

在 CR3BP 中生成轨道族：周期族（Halo / NRHO / Axial / SPO / LPO / Horseshoe）
为延拓，Lissajous 为拟周期轨迹的参数采样，DRO 为月心族（不绑定平动点）。
范围与默认值由 e2m2e `FamilyGenerationRequest` 的 `valid_ranges` 决定，GUI
不另维护一份。纯 CR3BP 计算，不需要 SPICE 内核。

| 参数 | 适用族 | 说明 |
|------|--------|------|
| `orbit_type` | 全部 | 族类型：HALO / NRHO / AXIAL / LISSAJOUS / SPO / LPO / HORSESHOE / DRO |
| `libration_point` | 除 DRO | 平动点（共线族 L1/L2，Lissajous 加 L3，三角族 L4/L5）；缺省按族取默认 |
| `n_orbits` | 全部 | 族成员数上限（实际以延拓/采样结果为准） |
| `max_amplitude_km` | 全部 | 振幅上限（km）：Halo/Axial 带符号区分北/南（上/下）族；SPO/LPO/Horseshoe 为距 L4/L5 径向距离；DRO 为距月心距离 |
| `min_amplitude_km` | SPO / LPO / Horseshoe / DRO | 振幅下限（km） |
| `north_south` | NRHO | 北族 / 南族 |
| `perilune_height_max_km` | NRHO | 近月点高度上限（km） |
| `amplitude_in_km` / `amplitude_out_km` | Lissajous | 面内 / 面外振幅上限（km） |
| `phase_in` / `phase_out` | Lissajous | 面内 / 面外初始相位（0~1） |
| `continuation_direction` | SPO / LPO / Horseshoe / NRHO | 延拓方向（`decrease-x0` / `increase-x0`） |
| `match_tolerance_km` | SPO / LPO / Horseshoe | 振幅匹配容差（km） |

结果入轨道库（record id 显示在面板下方），族成员轨迹逐条渲染到画布。

## 转移轨道设计（transfer_design）

生成地月转移轨迹，支持 HMN（Hohmann 式）、LGA（月球借力）与 WSB（弱稳定
边界）三类。参数面板按转移类型联动显隐：HMN 显示目标地心半径（默认
384400 km，环月演示）；LGA/WSB 需要先在项目树选中一个轨道工件——提交时
自动取其 CR3BP 状态末行换算到会合系物理单位注入目标星历，未选中时拦截
提交并提示；LGA 无显式搜索参数时默认注入加密相位网格（360 点）。

转移结果按 e2m2e ADR 0040 契约解析（会合系质心原点物理 km/km/s、TLI 起算
秒），位置归一后上画布，出发/到达脉冲在时间轴上以 Δv 事件 chip 标注。

## 分区边界（spatiography_boundaries）

返回地月空间分区参照几何（Rosengren et al. 2026 Primer 五省分区：Laplace
半径、SOI/Hill 圆族、Battin 曲线、Chebotarev 圆、L3–L5 平动点），经 km→DU
归一后作为画布参照图层显示（图表设置可开关）。非轨迹产物、不入轨道库。

## 其余工具

17 个工具的 schema 已全部导出（`frontend/src/toolSchemas/`，含 7 个 catalog
操作与 3 个分区解析工具）。任务轨道设计、轨道保持、轨道预报与时空坐标转换的
参数以 schema 为准；轨道稳定性 schema 已导出，待上游放开后接入；
参数空间扫描（catalog_sweep）在工具面板直接可用。
catalog 管理操作的
界面分布：查询/取用由目录浏览与画布叠加承担，删除在项目树右键菜单，标注
与族成员提升在记录详情面板，教学案例包导出在过滤栏。需要脚本化工作流时
经 [e2m2e CLI](https://cislunarspace.github.io/CODE-core/) 使用。