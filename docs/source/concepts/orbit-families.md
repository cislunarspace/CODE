# 轨道族

本软件在地月 **CR3BP**（圆型限制性三体问题）中生成周期轨道。CR3BP 把地球
和月球视为按匀速圆轨道相互绕转的两个质点，在这类简化模型中存在丰富的周期
轨道族，是地月空间任务设计的数学基础。

软件遵循 e2m2e 的轨道族术语，共 12 族。按物理特征分四类：

## 平动点附近的三维周期轨道（L1/L2）

| 族名 | 相关平动点 | 物理特征 |
|------|-----------|----------|
| Lyapunov | L1, L2, L3 | 平面周期轨道，沿共线平动点主轴振荡 |
| Halo | L1, L2 | 三维周期轨道，分北族（Class I，z 轴正方向）和南族（Class II，z 轴负方向）；稳定性指数接近 1 的高振幅区域通常称为近直线晕轨道（NRHO）；L3 处无经典 Halo 族 |
| Vertical | L1-L5 | 垂直方向振荡的周期轨道 |
| Axial | L1-L5 | 沿平动点轴向的周期轨道 |
| Butterfly | L1-L2 | 连接两个共线平动点的对称轨道 |

**Halo 与 NRHO**：NRHO（Near-Rectilinear Halo Orbit）是 Halo 族高振幅
区域的成员，轨道近月点很低、远离月球一侧很远，稳定性指数接近 1，是
Gateway 等长期任务的候选轨道。软件中 NRHO 是独立轨道类型（形状参数与
Halo 不同：近月点高度 + 南北族），但生成算法同源。

## 绕月轨道（secondary）

| 族名 | 物理特征 |
|------|----------|
| DRO（Distant Retrograde Orbit） | 围绕月球的远程**逆行**轨道，稳定性指数接近 1，临界稳定 |
| DPO（Direct Prograde Orbit） | 围绕月球的**顺行**轨道 |

DRO 在任务设计中很常用：大幅 DRO 在真实星历中可维持数月至数年有界，保持
代价低（见 {doc}`station-keeping`）。

## 三角平动点轨道（L4/L5）

| 族名 | 物理特征 |
|------|----------|
| SPO（Short Period Orbit） | L4/L5 附近的短周期轨道 |
| LPO（Long Period Orbit） | L4/L5 附近的长周期轨道 |
| Tadpole | 围绕单个三角平动点的蝌蚪形轨道 |
| Horseshoe | 跨越两个三角平动点的马蹄形轨道 |

## 共振轨道

| 族名 | 物理特征 |
|------|----------|
| RO（Resonant Orbit） | 满足 m:n 共振比例的周期轨道，如 3:1（周期是月球周期的 3 倍）、3:2（1.5 倍），用共振比 `--ratio` 区分 |

## 本软件支持哪些

GUI 的**轨道设计**工具支持 **DRO / DPO / Halo / NRHO / Lissajous /
L4 / L5 / Axial / ELFO** 等类型（ELFO 是月心冻结轨道，不属于上述周期
轨道族，见下）。其余周期轨道族（Lyapunov、Vertical、Butterfly、
Tadpole、RO 等）由 e2m2e 算法库支持，需要脚本化工作流时使用
[e2m2e CLI](https://github.com/cislunarspace/CODE-core)。

**Lissajous**：三维拟周期轨道（两个方向的振荡频率不同），不是严格周期
轨道，不闭合。软件支持 L1/L2/L3 附近的 Lissajous。

**ELFO**：月心冻结轨道（Elliptical Lunar Frozen Orbit），绕月球的大椭圆
轨道，通过倾角与近月点幅角组合使拱线不旋转。不依赖平动点，属于月球轨道
而非 CR3BP 周期轨道族。

**轨道族生成**工具支持 Halo、NRHO、Axial、Lissajous、SPO、LPO、
Horseshoe、DRO 八族的延拓生成：从小振幅种子出发逐步修正，直到目标
振幅或折叠点等终止条件自动停止。