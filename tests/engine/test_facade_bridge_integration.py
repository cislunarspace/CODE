"""tests for src.engine -- 端到端集成测试（mock e2m2e）。

    Tests for src.engine -- end-to-end
integration with mocked e2m2e."""

from __future__ import annotations

import numpy as np

from src.engine.facade_bridge import TOOL_REGISTRY, FacadeBridge, OrbitDesignResultData


class TestDesignOrbitE2EMocked:
    """mock 版端到端：FacadeBridge -> DTO，验证全链路。

        Mocked end-to-end: FacadeBridge ->
    DTO, verifying the full chain."""

    def test_full_pipeline(self, mock_design_orbit, fake_design_result):
        bridge = FacadeBridge(kernel_dir="/tmp/kernels")
        data = bridge.design_orbit(orbit_type="DRO", amplitude=40000.0)

        assert isinstance(data, OrbitDesignResultData)
        assert data.orbit_type == "DRO"
        assert data.correction_converged is True
        assert data.correction_iterations == 3
        assert isinstance(data.states, np.ndarray)
        assert isinstance(data.times, np.ndarray)
        assert data.states.ndim == 2
        assert data.states.shape[1] == 6

    def test_dto_no_e2m2e_object_leak(self, mock_design_orbit):
        """DTO 实例字段中不应出现 e2m2e Orbit 类型。

            No e2m2e Orbit type may appear among
        DTO instance fields."""
        bridge = FacadeBridge()
        data = bridge.design_orbit(orbit_type="DRO")
        # e2m2e Orbit 是纯 Python 类；确认 states/times 是 ndarray 而非 Orbit
        # The e2m2e Orbit is a pure-Python class; confirm states/times are ndarrays
        # rather than Orbits
        assert isinstance(data.states, np.ndarray)
        assert isinstance(data.times, np.ndarray)

    def test_tool_registry_design_orbit_points_to_real_method(self):
        """TOOL_REGISTRY['design_orbit'] 指向 FacadeBridge 上实际存在的方法。
        TOOL_REGISTRY['design_orbit'] points at a method that actually exists on
        FacadeBridge."""
        spec = TOOL_REGISTRY["design_orbit"]
        assert hasattr(FacadeBridge, spec.facade_method)
        assert callable(getattr(FacadeBridge, spec.facade_method))
