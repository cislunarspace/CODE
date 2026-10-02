"""tests for FacadeBridge.orbit_propagation（issue #389）。
Tests for FacadeBridge.orbit_propagation (issue #389).

桩打在算法层 ``e2m2e.algorithm.propagation.propagate_orbit`` 上：请求校验与
响应翻译仍走真 Facade。会合系转换（gcrs_to_synodic）与 times_et 重建需要
SPICE 内核 → spice marker。
The stub sits on the algorithm layer
(``e2m2e.algorithm.propagation.propagate_orbit``): request validation and
response translation still run the real Facade. The rotating-frame
conversion (gcrs_to_synodic) and times_et rebuilding need SPICE kernels,
hence the spice marker.
"""

from __future__ import annotations

import numpy as np
import pytest
from e2m2e.status import ConvergenceState, FailureCause

from src.commons.paths import detect_kernel_dir
from src.engine.exceptions import OrbitError
from src.engine.facade_bridge import (
    FacadeBridge,
    PropagationResultData,
    _epoch_list_to_iso,
    gcrs_to_synodic,
)
from tests.engine.conftest import make_ephemeris_table

#: 2024-01-01T00:00:00 TDB 的近似儒略日（测试基准，精确值不影响断言）。
#: : approximate Julian date of 2024-01-01T00:00:00 TDB (test reference; exact
#: value does not affect assertions).
_JD0 = 2460310.5


class _FakePropagationResult:
    """Fake PropagationResult（字段覆盖 Facade 翻译访问）。

        Fake PropagationResult (fields cover
    Facade translation access)."""

    def __init__(self, n: int = 5, converged: bool = True) -> None:
        ephemeris = make_ephemeris_table(n)
        ephemeris.times_jd_tdb = _JD0 + np.arange(n) / 24.0  # 每小时一点
        self.ephemeris = ephemeris
        self.status = ConvergenceState.CONVERGED if converged else ConvergenceState.DIVERGED
        self.cause = FailureCause.NONE if converged else FailureCause.DIVERGENCE_DETECTED
        self.message = "预报完成"


@pytest.fixture()
def capture_propagate(monkeypatch):
    """桩掉算法层传播，捕获收到的 kwargs，返回 (captured, result_holder)。

        Stub out the algorithm-
    layer propagation, capture received kwargs; returns (captured, result_holder)."""
    captured: dict = {}
    holder: dict = {"result": _FakePropagationResult()}

    def _fake(initial_state, epoch, duration, force_config=None, output_step=3600.0, **kw):
        captured.update(
            initial_state=initial_state,
            epoch=epoch,
            duration=duration,
            force_config=force_config,
            output_step=output_step,
        )
        return holder["result"]

    monkeypatch.setattr(
        "e2m2e.algorithm.propagation.propagate_orbit",
        _fake,
        raising=False,
    )
    return captured, holder


class TestEpochListToIso:
    def test_six_elements(self):
        assert _epoch_list_to_iso([2026, 1, 2, 3, 4, 5.0]) == "2026-01-02T03:04:05.000"

    def test_invalid_returns_none(self):
        assert _epoch_list_to_iso("2026-01-01") is None
        assert _epoch_list_to_iso([2026, 1, 2]) is None


class TestOrbitPropagation:
    @pytest.fixture()
    def bridge(self, catalog_bridge):
        """带内核目录的 bridge（会合系转换需要行星历内核）。

            A bridge with a kernel directory (the
        rotating-frame conversion needs planetary ephemeris kernels)."""
        return FacadeBridge(
            kernel_dir=str(detect_kernel_dir()), catalog_dir=catalog_bridge._catalog_dir
        )

    @pytest.mark.spice
    def test_duration_years_converted_to_seconds(self, capture_propagate, bridge):
        """GUI duration 标准单位年，e2m2e 契约为秒。

            The GUI's canonical duration unit is years; the
        e2m2e contract is seconds."""
        captured, _ = capture_propagate
        bridge.orbit_propagation(
            initial_state=[6793.0] * 6,
            epoch=[2026, 1, 1, 0, 0, 0],
            duration=1.0 / 365.25,  # 1 天
        )
        assert captured["duration"] == pytest.approx(86400.0)

    @pytest.mark.spice
    def test_force_config_none_omitted(self, capture_propagate, bridge):
        captured, _ = capture_propagate
        bridge.orbit_propagation(
            initial_state=[0.0] * 6,
            epoch=[2026, 1, 1, 0, 0, 0],
            duration=1.0,
            force_config=None,
        )
        assert captured["force_config"] is None

    @pytest.mark.spice
    def test_returns_dto_with_adr0013_slots(self, capture_propagate, bridge):
        data = bridge.orbit_propagation(
            initial_state=[6793.0, 0, 0, 0, 7.5, 3.0],
            epoch=[2026, 1, 1, 0, 0, 0],
            duration=1.0 / 365.25,
        )
        assert isinstance(data, PropagationResultData)
        assert data.epoch_utc == "2026-01-01T00:00:00.000"
        assert data.n_points == 5
        assert data.position_km.shape == (5, 3)
        assert data.velocity_km_s.shape == (5, 3)
        assert data.synodic_position.shape == (5, 3)
        assert data.final_state.shape == (6,)
        assert np.isfinite(data.synodic_position).all()
        # times_et 由 times_jd_tdb − J2000 JD 重建（SPICE ET 定义）
        # times_et rebuilt from times_jd_tdb - J2000 JD (SPICE ET definition)
        expected = (np.asarray(data.times_et) - (_JD0 - 2451545.0) * 86400.0) / 3600.0
        np.testing.assert_allclose(expected, np.arange(5), atol=1e-6)

    def test_diverged_raises(self, capture_propagate, bridge):
        _, holder = capture_propagate
        holder["result"] = _FakePropagationResult(converged=False)
        with pytest.raises(OrbitError) as exc_info:
            bridge.orbit_propagation(
                initial_state=[0.0] * 6,
                epoch=[2026, 1, 1, 0, 0, 0],
                duration=1.0,
            )
        assert exc_info.value.code == "PROPAGATION_FAILED", exc_info.value.message


class TestGcrsToSynodic:
    @pytest.mark.spice
    def test_moon_maps_to_one_minus_mu(self):
        """锚定坐标约定：月球自身 GCRS 位置应映到 (1−μ, 0, 0)（ADR 0013 质心归一）。

        若上游输出实为地心归一（月球在 +1），会得到 ~0.988+μ 的错位
        （~4690 km，ADR 0013 初版修过的同类问题）。

        Anchoring convention: the Moon's own GCRS position must map to
        (1−μ, 0, 0) (ADR 0013 barycenter normalization). If the upstream
        output were Earth-centered (Moon at +1), we would see a wrong
        offset of ~0.988+μ (~4690 km) — the same class of issue fixed in
        the first ADR 0013 revision.
        """
        from e2m2e.data.kernels.manager import SPICEManager

        kernel_dir = detect_kernel_dir()
        spice = SPICEManager()
        moon = spice.get_body_state("MOON", 0.0, "J2000", "EARTH")
        syn = gcrs_to_synodic(
            np.asarray(moon[:3])[None, :],
            np.asarray(moon[3:])[None, :],
            np.array([0.0]),
            kernel_dir=kernel_dir,
        )
        np.testing.assert_allclose(syn[0], [1.0 - 0.012150585, 0.0, 0.0], atol=1e-9)

    @pytest.mark.spice
    def test_output_shape_and_scale(self):
        """静止在地球附近的点在归一会合系里应为 ~r/38万 km 量级。

            A point at rest near Earth should
        sit at a magnitude of ~r/384400 in the normalized rotating frame."""
        n = 3
        position_km = np.tile([6793.0, 0.0, 0.0], (n, 1))
        velocity_km_s = np.zeros((n, 3))
        times_et = np.arange(n) * 3600.0
        syn = gcrs_to_synodic(position_km, velocity_km_s, times_et, kernel_dir=detect_kernel_dir())
        assert syn.shape == (n, 3)
        assert np.isfinite(syn).all()
        assert np.all(np.abs(syn) < 0.1)
