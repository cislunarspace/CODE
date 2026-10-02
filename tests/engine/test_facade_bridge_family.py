"""tests for FacadeBridge.generate_family（轨道族生成）。

mock 测试验证 DTO 装配与参数透传；末尾真路径测试用真实 e2m2e（纯 CR3BP，
不需要 SPICE 内核），验证族生成可正常运行。5.7.1 起族生成走七族统一入口；
5.9.3 接口类分家（e2m2e ADR 0043）后入口在 ``Facade().catalog``（Catalog
类），mock 桩打在 Catalog 方法上。稳定性分析随 e2m2e 5.9.8 删除
``e2m2e.algorithm.stability`` 一并移除。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from e2m2e.data.templates.seed import EARTH_MOON_MU
from pydantic import ValidationError

from src.engine.facade_bridge import (
    FacadeBridge,
    FamilyGenerationRequest,
    FamilyResultData,
)

# ---------------------------------------------------------------------------
# FamilyGenerationRequest 模型
# ---------------------------------------------------------------------------


class TestFamilyGenerationRequest:
    def test_halo_defaults(self):
        req = FamilyGenerationRequest(orbit_type="HALO")
        assert req.libration_point == 2
        assert req.max_amplitude_km == 30000.0
        assert req.n_orbits == 50

    def test_constraints(self):
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", libration_point=3)
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", max_amplitude_km=0.0)
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", max_amplitude_km=60000.0)
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", n_orbits=0)

    def test_extra_forbidden(self):
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", unexpected=True)

    def test_seven_families_accepted(self):
        """5.7.1 起七族均为合法 orbit_type（按族填平动点与参数默认）。"""
        for orbit_type in ("HALO", "NRHO", "AXIAL", "LISSAJOUS", "SPO", "LPO", "HORSESHOE"):
            req = FamilyGenerationRequest(orbit_type=orbit_type)
            assert req.libration_point is not None

    def test_cross_family_fields_rejected(self):
        """5.7.1 起按 model_fields_set 拒绝跨族字段（None 也算已设置）。"""
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", north_south=2)
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="HALO", amplitude_in_km=None)
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="SPO", max_amplitude_km=60000.0, amplitude_in_km=1.0)

    def test_dro_family_defaults(self):
        """5.8.2 起 DRO（月心族）为合法 orbit_type：不绑定平动点，振幅区间默认 2000-60000 km。"""
        req = FamilyGenerationRequest(orbit_type="DRO")
        assert req.libration_point is None
        assert req.min_amplitude_km == 2000.0
        assert req.max_amplitude_km == 60000.0
        with pytest.raises(ValidationError):
            FamilyGenerationRequest(orbit_type="DRO", libration_point=2)

    def test_per_family_defaults(self):
        nrho = FamilyGenerationRequest(orbit_type="NRHO")
        assert nrho.north_south == 2
        assert nrho.perilune_height_max_km == 20000.0
        assert nrho.continuation_direction == "toward-moon"
        spo = FamilyGenerationRequest(orbit_type="SPO")
        assert spo.libration_point == 4
        assert spo.min_amplitude_km == 2000.0
        assert spo.max_amplitude_km == 60000.0
        assert spo.match_tolerance_km == 20.0


# ---------------------------------------------------------------------------
# generate_family mock 测试（桩在 Catalog.orbit_family_generation 上）
# ---------------------------------------------------------------------------


class _FakeSystem:
    """Fake CR3BP_System。"""

    mu = EARTH_MOON_MU


class _FakeDynamics:
    """Fake CR3BP_Dynamics：propagate 返回初态平铺的等长轨迹。"""

    def __init__(self, system: object) -> None:
        self.system = system

    def propagate(self, state0: Any, t_span: tuple, t_eval: Any = None) -> dict:
        return {"states": np.tile(np.asarray(state0), (len(t_eval), 1)), "time": t_eval}


def _fake_response(
    params: dict,
    *,
    n: int,
    states_shape: tuple = (100, 6),
    member_parameters: dict | None = None,
) -> SimpleNamespace:
    """构造 FamilyGenerationResponse 形状的假响应（默认携带完整轨迹的成员）。"""
    from e2m2e.status import ConvergenceState, FailureCause

    if member_parameters is None:
        member_parameters = {"libration_point": params.get("libration_point", 2)}
    return SimpleNamespace(
        status=ConvergenceState.CONVERGED,
        cause=FailureCause.NONE,
        message="轨道族生成完成",
        orbits=[
            SimpleNamespace(
                states=np.full(states_shape, float(index)),
                times=np.linspace(0, 1, states_shape[0]),
                period=None,
                parameters=dict(member_parameters),
            )
            for index in range(n)
        ],
        family_type=str(params.get("orbit_type", "HALO")).lower(),
        system=_FakeSystem(),
        metadata={"periodicity": "periodic"},
        requested_members=n,
        generated_members=n,
        family_id=None,
    )


@pytest.fixture()
def mock_family_facade(monkeypatch):
    """桩掉 Catalog.orbit_family_generation（Facade().catalog），记录桥接层传参。"""
    calls: dict[str, object] = {}

    def _orbit_family_generation(self: object, **params: object) -> SimpleNamespace:
        calls.update(params)
        return _fake_response(calls, n=int(params.get("n_orbits", 50)))

    monkeypatch.setattr(
        "e2m2e.api.catalog.Catalog.orbit_family_generation", _orbit_family_generation
    )
    return calls


class TestGenerateFamily:
    def test_returns_dto_and_delegates_to_upstream(self, mock_family_facade):
        data = FacadeBridge().generate_family(
            libration_point=2, max_amplitude_km=20000.0, n_orbits=5
        )
        assert isinstance(data, FamilyResultData)
        assert data.orbit_type == "Halo"
        assert data.family_type == "halo"
        assert data.n_orbits == 5
        assert data.states.shape == (5, 100, 6)
        assert data.times.shape == (5, 100)
        assert data.z0s.shape == (5,)
        assert data.mu == pytest.approx(EARTH_MOON_MU)
        assert data.family_id is None  # 假响应未入库（5.9.3 起回执是 family_id）
        assert mock_family_facade == {
            "libration_point": 2,
            "max_amplitude_km": 20000.0,
            "n_orbits": 5,
            "orbit_type": "HALO",
        }

    def test_defaults_to_halo(self, mock_family_facade):
        FacadeBridge().generate_family(libration_point=1, max_amplitude_km=10000.0, n_orbits=3)
        assert mock_family_facade["orbit_type"] == "HALO"
        assert mock_family_facade["libration_point"] == 1

    def test_none_params_stripped(self, mock_family_facade):
        """None（未勾选的 Optional）在进入 Catalog 前剔除，避免跨族字段拒绝。"""
        FacadeBridge().generate_family(
            libration_point=2, max_amplitude_km=20000.0, n_orbits=5, north_south=None
        )
        assert "north_south" not in mock_family_facade

    def test_periodic_members_resampled(self, monkeypatch):
        """周期族成员只携带初态与周期时，桥接层按周期重采样整条轨迹。"""
        from e2m2e.status import ConvergenceState, FailureCause

        response = SimpleNamespace(
            status=ConvergenceState.CONVERGED,
            cause=FailureCause.NONE,
            message="轨道族生成完成",
            orbits=[
                SimpleNamespace(
                    states=np.array([[1.0, 0.0, 0.01 * i, 0.0, 0.3, 0.0]]),
                    times=np.array([0.0]),
                    period=3.0 + i,
                    parameters={"libration_point": 2},
                )
                for i in range(3)
            ],
            family_type="nrho",
            system=_FakeSystem(),
            metadata={"periodicity": "periodic"},
            requested_members=3,
            generated_members=3,
            family_id=None,
        )
        monkeypatch.setattr(
            "e2m2e.api.catalog.Catalog.orbit_family_generation", lambda self, **p: response
        )
        monkeypatch.setattr("e2m2e.algorithm.dynamics.CR3BP_Dynamics", _FakeDynamics)
        data = FacadeBridge().generate_family(orbit_type="NRHO", libration_point=2)
        assert data.states.shape == (3, 200, 6)
        assert data.times.shape == (3, 200)
        # 重采样时间轴覆盖 [0, period]
        assert data.times[0][-1] == pytest.approx(3.0)
        assert data.times[1][-1] == pytest.approx(4.0)
        # 非 Halo 族无 z0s
        assert data.z0s is None

    def test_empty_family_raises(self, monkeypatch):
        """响应无成员时抛 OrbitError(FAMILY_FAILED)，附上游消息。"""
        from e2m2e.status import ConvergenceState, FailureCause

        from src.engine.exceptions import OrbitError

        response = SimpleNamespace(
            status=ConvergenceState.FAILED,
            cause=FailureCause.BACKEND_FAILURE,
            message="延拓未命中任何成员",
            orbits=[],
            family_type="spo",
            system=_FakeSystem(),
            metadata={"periodicity": "periodic"},
            requested_members=5,
            generated_members=0,
            family_id=None,
        )
        monkeypatch.setattr(
            "e2m2e.api.catalog.Catalog.orbit_family_generation", lambda self, **p: response
        )
        with pytest.raises(OrbitError) as exc_info:
            FacadeBridge().generate_family(orbit_type="SPO", libration_point=4)
        assert exc_info.value.code == "FAMILY_FAILED"
        assert "延拓未命中任何成员" in exc_info.value.message

    def test_dro_family_libration_point_none(self, monkeypatch):
        """DRO 月心族成员参数无 libration_point：DTO 该字段为 None，显示名照常映射。"""
        response = _fake_response(
            {"orbit_type": "DRO"}, n=2, member_parameters={"amplitude_km": 20000.0}
        )
        monkeypatch.setattr(
            "e2m2e.api.catalog.Catalog.orbit_family_generation", lambda self, **p: response
        )
        data = FacadeBridge().generate_family(
            orbit_type="DRO", min_amplitude_km=2000.0, max_amplitude_km=60000.0, n_orbits=2
        )
        assert data.orbit_type == "DRO"
        assert data.family_type == "dro"
        assert data.libration_point is None
        assert data.member_parameters == [{"amplitude_km": 20000.0}] * 2

    def test_invalid_params_translated(self):
        """非法参数经真 Catalog 的 FamilyGenerationRequest 校验 → OrbitError(INVALID_PARAMS)。"""
        from src.engine.exceptions import OrbitError

        with pytest.raises(OrbitError) as exc_info:
            FacadeBridge().generate_family(libration_point=9, max_amplitude_km=20000.0, n_orbits=5)
        assert exc_info.value.code == "INVALID_PARAMS"

    def test_cross_family_params_translated(self):
        """跨族字段（Halo 传 north_south）被 5.7.1 模型拒绝 → INVALID_PARAMS。"""
        from src.engine.exceptions import OrbitError

        with pytest.raises(OrbitError) as exc_info:
            FacadeBridge().generate_family(orbit_type="HALO", north_south=2)
        assert exc_info.value.code == "INVALID_PARAMS"


# ---------------------------------------------------------------------------
# 真路径（纯 CR3BP，无需 SPICE）
# ---------------------------------------------------------------------------


def test_generate_family_real_pipeline(tmp_path):
    """真 e2m2e：小 Halo 族应返回等长三维 states（周期族成员由桥接层按周期重采样）。

    5.9.3 起族产物逐成员自动入库（一轨一记录，ADR 0045）；family_id 是
    生成批次回执，整族经它查询。
    """
    from src.engine.facade_bridge import FacadeBridge

    bridge = FacadeBridge(catalog_dir=str(tmp_path / "catalog"))
    data = bridge.generate_family(libration_point=2, max_amplitude_km=5000.0, n_orbits=3)
    assert data.orbit_type == "Halo"
    assert data.n_orbits >= 2
    assert data.states.ndim == 3
    assert data.states.shape[0] == data.n_orbits
    # 北族 z 振幅单调递增（从种子往大振幅延拓）
    assert data.z0s[0] < data.z0s[-1]
    # 产物入库：逐成员一条记录，family_id 是整族查询句柄（issue #375 US3/US8）
    assert data.family_id is not None
    records = bridge.catalog_query(family_id=data.family_id)
    assert len(records) == data.n_orbits
    assert {r.source_tool for r in records} == {"orbit_family_generation"}
    assert sorted(r.member_index for r in records) == list(range(data.n_orbits))
    record = bridge.catalog_get(records[0].record_id)
    assert record.arrays["cr3bp/states"].ndim == 2


def test_generate_nrho_family_real_pipeline():
    """真 e2m2e：NRHO 族（5.7.1 新增分派）应返回带近月点高度的成员。"""
    data = FacadeBridge().generate_family(
        orbit_type="NRHO", libration_point=2, north_south=2, n_orbits=3
    )
    assert data.orbit_type == "NRHO"
    assert data.family_type == "nrho"
    assert data.n_orbits >= 1
    assert data.states.shape == (data.n_orbits, 200, 6)
    assert data.z0s is None
    perilunes = [p["perilune_height_km"] for p in data.member_parameters]
    assert all(0.0 < h <= 20000.0 for h in perilunes)


def test_generate_lissajous_family_real_pipeline():
    """真 e2m2e：Lissajous 族为拟周期参数采样，成员自带等长完整轨迹。"""
    data = FacadeBridge().generate_family(
        orbit_type="LISSAJOUS",
        libration_point=2,
        amplitude_in_km=2000.0,
        amplitude_out_km=6000.0,
        n_orbits=3,
    )
    assert data.orbit_type == "Lissajous"
    assert data.periodicity == "quasi-periodic"
    assert data.n_orbits == 3
    assert data.states.ndim == 3 and data.states.shape[2] == 6
    # 采样分数 1/3、2/3、1：面外振幅上限线性递增
    amps = [p["amplitude_out_km"] for p in data.member_parameters]
    assert amps == sorted(amps) and amps[-1] == pytest.approx(6000.0)


def test_generate_dro_family_real_pipeline(tmp_path):
    """真 e2m2e：DRO 族（5.8.2，#502）为月心族，无平动点，成员参数为 amplitude_km。"""
    bridge = FacadeBridge(catalog_dir=str(tmp_path / "catalog"))
    data = bridge.generate_family(
        orbit_type="DRO", min_amplitude_km=2000.0, max_amplitude_km=20000.0, n_orbits=3
    )
    assert data.orbit_type == "DRO"
    assert data.family_type == "dro"
    assert data.libration_point is None
    assert data.n_orbits >= 1
    assert data.z0s is None
    assert data.states.ndim == 3 and data.states.shape[2] == 6
    amps = [p["amplitude_km"] for p in data.member_parameters]
    assert all(2000.0 <= a <= 20000.0 for a in amps)
    # 逐成员入库（5.9.3 一轨一记录）：family_id 查询命中全部成员
    assert data.family_id is not None
    records = bridge.catalog_query(family_id=data.family_id)
    assert len(records) == data.n_orbits
