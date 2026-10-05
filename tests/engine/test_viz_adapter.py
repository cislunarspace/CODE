"""tests for src.engine.viz_adapter -- e2m2e 可视化适配层。

    Tests for src.engine.viz_adapter
-- the e2m2e visualization adapter.

验证 view 与 e2m2e OrbitVisualizer 之间的桥接点：CR3BP_System 构造、
地月 / L1-L5 标注绘制、以及 e2m2e 延迟 import 保证 view 层不泄漏。
Verifies the bridge between the view and e2m2e's OrbitVisualizer:
CR3BP_System construction, Earth-Moon / L1-L5 annotation drawing, and
the lazy e2m2e import that keeps the view layer from leaking.
"""

from __future__ import annotations

import matplotlib
import numpy as np
import pytest
from e2m2e.data.templates.seed import EARTH_MOON_MU

matplotlib.use("Agg")


@pytest.fixture()
def qapp():
    """确保 QApplication 存在（与现有 view 测试一致的兜底）。

    Ensure a QApplication exists (same fallback as the existing view tests).
    """
    try:
        from PyQt6.QtWidgets import QApplication

        app = QApplication.instance()
        if app is None:
            app = QApplication([])
        return app
    except Exception:
        pytest.skip("QApplication 不可用（无 GUI 环境）")


_MU = EARTH_MOON_MU  # 地月质量比（e2m2e DE421 基准）


class TestBuildCr3bpSystem:
    def test_build_cr3bp_system_with_mu(self):
        """build_cr3bp_system(mu) 返回 e2m2e CR3BP_System 且 mu 正确。

        build_cr3bp_system(mu) returns an e2m2e CR3BP_System with the correct mu.
        """
        from src.engine.viz_adapter import build_cr3bp_system

        system = build_cr3bp_system(_MU)
        assert system.mu == pytest.approx(_MU)
        assert system.primary_body == "Earth"
        assert system.secondary_body == "Moon"

    def test_rejects_invalid_mu(self):
        """mu 超出 (0, 0.5) 时应报错（e2m2e 校验）。

            An error must be raised when mu is outside
        (0, 0.5) (the e2m2e validation)."""
        from src.engine.viz_adapter import build_cr3bp_system

        with pytest.raises(ValueError):
            build_cr3bp_system(0.9)


class TestDrawPrimaryBodies:
    def test_draw_primary_bodies_3d_adds_artists(self):
        """3D ax 上绘制地月标注后 artist 数量增加。

            The artist count grows after drawing
        Earth-Moon annotations on a 3D ax."""
        from matplotlib.figure import Figure

        from src.engine.viz_adapter import draw_primary_bodies

        fig = Figure()
        ax = fig.add_subplot(111, projection="3d")
        before = len(ax.get_children())
        draw_primary_bodies(ax, _MU, is_3d=True)
        assert len(ax.get_children()) > before

    def test_draw_primary_bodies_2d_adds_artists(self):
        """2D ax 上绘制地月标注后 artist 数量增加。

            The artist count grows after drawing
        Earth-Moon annotations on a 2D ax."""
        from matplotlib.figure import Figure

        from src.engine.viz_adapter import draw_primary_bodies

        fig = Figure()
        ax = fig.add_subplot(111)
        before = len(ax.get_children())
        draw_primary_bodies(ax, _MU, is_3d=False)
        assert len(ax.get_children()) > before


class TestDrawLibrationPoints:
    def test_draw_libration_points_3d_adds_artists(self):
        """3D ax 上绘制 L1-L5 后 artist 数量增加。

            The artist count grows after drawing L1-L5
        on a 3D ax."""
        from matplotlib.figure import Figure

        from src.engine.viz_adapter import draw_libration_points

        fig = Figure()
        ax = fig.add_subplot(111, projection="3d")
        before = len(ax.get_children())
        draw_libration_points(ax, _MU, is_3d=True)
        assert len(ax.get_children()) > before

    def test_draw_libration_points_2d_adds_artists(self):
        """2D ax 上绘制 L1-L5 后 artist 数量增加。

            The artist count grows after drawing L1-L5
        on a 2D ax."""
        from matplotlib.figure import Figure

        from src.engine.viz_adapter import draw_libration_points

        fig = Figure()
        ax = fig.add_subplot(111)
        before = len(ax.get_children())
        draw_libration_points(ax, _MU, is_3d=False)
        assert len(ax.get_children()) > before

    def test_draw_libration_points_2d_xz_projects_z_not_y(self):
        """XZ 投影：L1-L5 都在 z=0 平面，纵轴应≈0，而非 e2m2e 默认的 Y≈±0.866。

        回归 guard：e2m2e plot_libration_points(is_3d=False) 无视投影平面、
        恒用 (x,y)，把 L4/L5 的 Y 撑进纵轴；viz_adapter 的 plane 分支按
        投影平面取坐标修正此问题。

        XZ projection: L1-L5 all lie in the z=0 plane, so the vertical
        axis must be ≈0 — not e2m2e's default Y≈±0.866. Regression guard:
        e2m2e's plot_libration_points(is_3d=False) ignores the projection
        plane and always uses (x,y), pushing L4/L5's Y onto the vertical
        axis; viz_adapter's plane branch picks coordinates per the plane,
        fixing this.
        """
        from matplotlib.collections import PathCollection
        from matplotlib.figure import Figure

        from src.engine.viz_adapter import draw_libration_points

        fig = Figure()
        ax = fig.add_subplot(111)
        draw_libration_points(ax, _MU, is_3d=False, plane=(0, 2))
        ys = [
            float(off[1])
            for child in ax.get_children()
            if isinstance(child, PathCollection)
            for off in child.get_offsets()
        ]
        # CR3BP 五平动点 z≈0：纵轴应全部≈0；e2m2e bug 下 L4/L5 会是 ±0.866
        # CR3BP's five libration points have z~0: the vertical axis should be ~0 everywhere;
        # with the e2m2e bug L4/L5 would read +/-0.866
        assert ys, "未画出平动点 scatter"
        assert max(abs(y) for y in ys) < 0.1, f"XZ 纵轴应是 z≈0，但有 {ys}"


class TestNoImportE2m2eAtModuleImport:
    def test_importing_module_does_not_import_e2m2e(self):
        """import src.engine.viz_adapter 不触发 e2m2e 加载（延迟 import）。

        保证 src/view/ 层（经由 adapter 桥接）不泄漏 e2m2e 到 import 期。
        用 subprocess 在干净解释器里验证：既真正测试全新导入的属性，
        又不会像 del sys.modules 那样污染当前测试进程、连累后续测试。

        Importing src.engine.viz_adapter must not trigger the e2m2e load
        (lazy import). Guarantees the src/view/ layer (bridged via the
        adapter) does not leak e2m2e at import time. Verified in a clean
        interpreter via subprocess: both genuinely tests a fresh import
        and avoids polluting the current test process the way del
        sys.modules would, dragging along later tests.
        """
        import subprocess
        import sys
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[2]
        script = (
            "import sys; import src.engine.viz_adapter; "
            "leaked = [m for m in sys.modules "
            "if m == 'e2m2e' or m.startswith('e2m2e.')]; "
            "print('LEAKED:' + ','.join(leaked) if leaked else 'CLEAN')"
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.returncode == 0, (
            f"子进程导入失败 (rc={result.returncode}):\n{result.stderr}"
        )
        assert result.stdout.strip() == "CLEAN", (
            f"viz_adapter 模块级 import 触发了 e2m2e 加载: {result.stdout.strip()}"
        )


class TestSynodicToGcrs:
    def test_synodic_to_gcrs_km_matches_frontend_idealized_geometry(self):
        """换算与前端 idealizedInertialGeometry 同口径：先平移后旋转（#521）。

        frontend/src/trajectoryParsing.ts 的 idealizedInertialGeometry 按
        Rz(θ)·(p + (μ,0,0)) 实现；本测试按同一公式复现期望值逐点对照，
        守住 AGENTS.md 硬契约 4（#477）的多实现同口径。
        """
        from src.commons.units import DU_KM

        from src.engine.viz_adapter import synodic_to_gcrs_km

        pos = np.array([[0.1, -0.2, 0.3], [-1.5, 0.8, -0.1], [0.0, 0.0, 0.0]])
        theta = np.array([0.0, 0.7, 2.4])
        got = synodic_to_gcrs_km(pos, theta, _MU)
        c, s = np.cos(theta), np.sin(theta)
        x = pos[:, 0] + _MU
        y = pos[:, 1]
        expected = np.column_stack(
            [(c * x - s * y) * DU_KM, (s * x + c * y) * DU_KM, pos[:, 2] * DU_KM]
        )
        np.testing.assert_allclose(got, expected, atol=1e-6)

    def test_synodic_to_gcrs_km_moon_point_falls_on_approx_moon_orbit(self):
        """会合系月球点 (1-μ,0,0) 换算后落在 approx_moon_gcrs_km 正圆轨道上（#521）。

        月球特例的一致性同时锁定两个函数的口径：先平移口径下
        R(θ)·((1-μ)+μ,0,0) 化为 R(θ)·(1,0,0)，与 approx_moon_gcrs_km 重合。
        """
        from src.engine.viz_adapter import approx_moon_gcrs_km, synodic_to_gcrs_km

        theta = np.array([0.0, 1.3, 4.1])
        moon_synodic = np.tile([1.0 - _MU, 0.0, 0.0], (3, 1))
        got = synodic_to_gcrs_km(moon_synodic, theta, _MU)
        np.testing.assert_allclose(got, approx_moon_gcrs_km(theta), atol=1e-6)

    def test_synodic_to_gcrs_km_accepts_scalar_theta(self):
        """theta 为标量时按同口径广播到全部点（#521）。"""
        from src.commons.units import DU_KM

        from src.engine.viz_adapter import synodic_to_gcrs_km

        pos = np.array([[0.5, 0.25, -0.75], [1.0, -1.0, 0.0]])
        got = synodic_to_gcrs_km(pos, 1.1, _MU)
        c, s = np.cos(1.1), np.sin(1.1)
        x = pos[:, 0] + _MU
        y = pos[:, 1]
        expected = np.column_stack(
            [(c * x - s * y) * DU_KM, (s * x + c * y) * DU_KM, pos[:, 2] * DU_KM]
        )
        np.testing.assert_allclose(got, expected, atol=1e-6)
