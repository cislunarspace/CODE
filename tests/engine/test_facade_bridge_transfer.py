"""tests for FacadeBridge.transfer_design.

桩打在算法层 ``e2m2e.algorithm.transfer.transfer_orbit`` 上：请求校验与
响应翻译仍走真 Facade。
The stub sits on the algorithm layer
(``e2m2e.algorithm.transfer.transfer_orbit``): request validation and
response translation still run the real Facade.
"""

from __future__ import annotations

import numpy as np
import pytest
from e2m2e.status import ConvergenceState, FailureCause

from src.commons.units import DU_KM, TU_SECONDS
from src.engine.facade_bridge import FacadeBridge, TransferDesignResultData


class _FakeTransferResult:
    """Fake TransferDesignResult（transfer_orbit 返回形状）。

        Fake TransferDesignResult (the
    shape transfer_orbit returns)."""

    def __init__(
        self,
        transfer_type: str = "HMN",
        delta_v: float = 3.9,
        trajectory: np.ndarray | None = None,
        trajectory_times: np.ndarray | None = None,
        converged: bool = True,
    ) -> None:
        self.transfer_type = transfer_type
        self.delta_v = delta_v
        self.trajectory = trajectory
        # e2m2e 5.8.9 起 Facade 无条件读取该字段（ADR 0040 轨迹契约）
        # The Facade reads this unconditionally since e2m2e 5.8.9 (ADR 0040 contract).
        self.trajectory_times = trajectory_times
        # e2m2e 5.9.0 起 Facade 无条件读取 state_frame 与 maneuver_events
        # （ADR 0040 增补：数据系标注契约 / 机动事件契约）
        # The Facade reads state_frame and maneuver_events unconditionally
        # since e2m2e 5.9.0 (ADR 0040 amendments: state-frame / maneuver-event contracts).
        self.state_frame = "synodic_barycentric_km"
        self.maneuver_events = []
        self.details = {"tof_sec": 345600.0}
        self.status = (
            ConvergenceState.CONVERGED if converged else ConvergenceState.INFEASIBLE
        )
        self.cause = FailureCause.NONE if converged else FailureCause.CONSTRAINT_VIOLATION
        self.message = "完成" if converged else "无可行候选"


@pytest.fixture
def bridge() -> FacadeBridge:
    return FacadeBridge()


def _patch_transfer_orbit(monkeypatch, result: _FakeTransferResult) -> dict:
    """打桩 transfer_orbit，返回捕获到的调用 kwargs。

        Stub transfer_orbit and return the captured
    call kwargs."""
    captured: dict = {}

    def fake(transfer_type, **kwargs):
        captured["transfer_type"] = transfer_type
        captured["kwargs"] = kwargs
        return result

    monkeypatch.setattr(
        "e2m2e.algorithm.transfer.transfer_orbit", fake, raising=False
    )
    return captured


class TestTransferDesign:
    def test_returns_dto(self, monkeypatch, bridge):
        traj = np.array([[6800.0, 0, 0, 0, 7.7, 0], [380000.0, 0, 0, 0, 1.0, 0]])
        captured = _patch_transfer_orbit(monkeypatch, _FakeTransferResult(trajectory=traj))
        data = bridge.transfer_design(
            transfer_type="HMN", tli_epoch="2025-06-01T00:00:00"
        )
        assert isinstance(data, TransferDesignResultData)
        assert data.converged is True
        assert np.array_equal(data.trajectory, traj)
        assert captured["transfer_type"] == "HMN"

    def test_target_states_converted_to_synodic_physical(self, monkeypatch, bridge):
        """选中工件的 CR3BP 无量纲状态末行应换算为会合系物理态 (1, 6)。

            The selected artifact's
        last CR3BP dimensionless state row must be converted into a rotating-frame
        physical state (1, 6)."""
        captured = _patch_transfer_orbit(monkeypatch, _FakeTransferResult("LGA"))
        states = np.array([[1.0, 0.0, 0.0, 0.0, 0.5, 0.0], [1.1, 0.1, 0.0, -0.1, 0.4, 0.0]])
        bridge.transfer_design(
            transfer_type="LGA",
            tli_epoch="2025-06-01T00:00:00",
            target_states=states,
        )
        eph = captured["kwargs"]["target_ephemeris"]
        assert eph.shape == (1, 6)
        # 显式阈值：乘 DU_KM/TU 的量级换算；assert_allclose 默认 atol 为 0（纯相对比较），此处显式给 rtol 1e-7、atol 1e-8，防近零元素误报，仍严于标准的 atol 1e-6
        np.testing.assert_allclose(
            eph[0],
            np.r_[states[-1][:3] * DU_KM, states[-1][3:] * (DU_KM / TU_SECONDS)],
            rtol=1e-7,
            atol=1e-8,
        )

    def test_tli_epoch_list_to_iso(self, monkeypatch, bridge):
        """epoch 控件产出的 [年,月,日,时,分,秒] 应转 ISO 字符串透传。

            The
        [year,month,day,hour,minute,second] from the epoch control must be converted to an
        ISO string and passed through."""
        captured = _patch_transfer_orbit(monkeypatch, _FakeTransferResult())
        bridge.transfer_design(
            transfer_type="HMN", tli_epoch=[2025, 6, 1, 12, 30, 5.0]
        )
        tli = captured["kwargs"]["tli_params"]
        assert tli.epoch == "2025-06-01T12:30:05"

    def test_lga_default_grid_injected(self, monkeypatch, bridge):
        """LGA 未显式给搜索参数时，桥接层注入加密相位网格（360 点）。

            When no search parameters are
        given for LGA, the bridge injects a denser phase grid (360 points)."""
        captured = _patch_transfer_orbit(monkeypatch, _FakeTransferResult("LGA"))
        bridge.transfer_design(
            transfer_type="LGA", tli_epoch="2025-06-01T00:00:00"
        )
        sp = captured["kwargs"].get("lga_search_params")
        assert sp is not None and sp.n_departure_phase == 360

    def test_infeasible_maps_to_not_converged(self, monkeypatch, bridge):
        _patch_transfer_orbit(monkeypatch, _FakeTransferResult(converged=False))
        data = bridge.transfer_design(
            transfer_type="HMN", tli_epoch="2025-06-01T00:00:00"
        )
        assert data.converged is False
        assert data.trajectory is None

