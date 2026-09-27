"""测试 fixtures -- mock e2m2e 算法层调用。

design_orbit / control_orbit 经 Facade 门面（issue #375），桩打在算法层模块
函数上：请求校验、响应翻译、产物自动入库仍走真 Facade，fake 只需提供翻译
所需的完整结果形状（status/cause/message/force_config/drift 等）。

English: test fixtures -- mocked e2m2e algorithm-layer calls. design_orbit /
control_orbit go through the Facade facade (issue #375); stubs are
placed on the algorithm-layer module functions, so request validation,
response translation and auto-ingestion still run the real Facade —
the fakes only need to supply the complete result shape that
translation needs (status/cause/message/force_config/drift etc.).
"""

from __future__ import annotations

import numpy as np
import pytest
from e2m2e.data.templates import ConvergenceState, FailureCause
from e2m2e.data.types import EphemerisTable


class _FakeCorrection:
    """Fake EphemerisCorrectionResult（只保留 status/iterations）。

    e2m2e 5.6.6 起收敛判定走统一结果契约 status（#351），不再有 converged。

    Fake EphemerisCorrectionResult (only status/iterations kept). Since
    e2m2e 5.6.6 convergence is judged by the unified result-contract
    status (#351); there is no converged field anymore.
    """

    def __init__(self, converged: bool = True, iterations: int = 3) -> None:
        self.status = (
            ConvergenceState.CONVERGED if converged else ConvergenceState.DIVERGED
        )
        self.iterations = iterations


class _FakeOrbit:
    """Fake Orbit（e2m2e.data.types.orbit.Orbit）。

    A fake Orbit (e2m2e.data.types.orbit.Orbit).
    """

    def __init__(
        self,
        states: np.ndarray,
        times: np.ndarray,
        system: object | None = None,
    ) -> None:
        self.states = states
        self.times = times
        # design_orbit.py 构造 Orbit 时绑定 CR3BP_System，其 .mu 是普通属性。
        # design_orbit.py binds a CR3BP_System when constructing an Orbit; its .mu
        # is a plain attribute.
        # 测试可注入带 .mu 的 fake system 以覆盖 mu 提取路径。
        # Tests can inject a fake system with .mu to cover the mu-extraction path.
        self.system = system


class _FakeDesignResult:
    """Fake OrbitDesignResult（e2m2e.algorithm.design.design_orbit）。

    字段须覆盖 Facade 响应翻译（_design_result_to_response）与产物入库
    （catalog_ingest.build_design_record）访问的全部属性。

    Fake OrbitDesignResult (from e2m2e.algorithm.design.design_orbit).
    Its fields must cover every attribute accessed by Facade response
    translation (_design_result_to_response) and product ingestion
    (catalog_ingest.build_design_record).
    """

    def __init__(
        self,
        orbit_type: str = "DRO",
        epoch_utc: str = "2024-01-01T00:00:00",
        duration_day: float = 365.25,
        initial_state: np.ndarray | None = None,
        cr3bp_jacobi: float = 3.0058,
        states: np.ndarray | None = None,
        times: np.ndarray | None = None,
        converged: bool = True,
        iterations: int = 3,
        correction_method: str = "segmented",
        system: object | None = None,
        ephemeris: EphemerisTable | None = None,
    ) -> None:
        n = 8761 if states is None else states.shape[0]
        self.status = ConvergenceState.CONVERGED if converged else ConvergenceState.DIVERGED
        self.cause = FailureCause.NONE
        self.message = "设计完成"
        self.orbit_type = orbit_type
        self.epoch_utc = epoch_utc
        self.duration_day = duration_day
        self.output_step_sec = 86400.0
        self.initial_state = (
            initial_state if initial_state is not None else np.zeros(6)
        )
        self.cr3bp_jacobi = cr3bp_jacobi
        self.force_config: dict = {}
        self.drift_e = None
        self.drift_aop_deg = None
        self.drift_rp_km = None
        self.secular_aop_rate_deg_per_year = None
        self.cr3bp_orbit = _FakeOrbit(
            states=states if states is not None else np.random.randn(n, 6),
            times=times if times is not None else np.linspace(0, 1, n),
            system=system,
        )
        self.correction = _FakeCorrection(converged=converged, iterations=iterations)
        # e2m2e 5.8.2 起 #492：修正方法按族分派上提，设计结果记录实际方法
        # Since e2m2e 5.8.2 (#492): correction-method dispatch per family moved up;
        # design results record the actual method
        self.correction_method = correction_method
        self.ephemeris = ephemeris


@pytest.fixture()
def fake_design_result() -> _FakeDesignResult:
    """默认 _FakeDesignResult（DRO, 8761 点）。

        The default _FakeDesignResult (DRO, 8761 points).
    """
    return _FakeDesignResult()


@pytest.fixture()
def mock_design_orbit(monkeypatch, fake_design_result):
    """Monkeypatch e2m2e.algorithm.design.design_orbit，返回 fake_design_result。

    桩在算法层（Facade 内部延迟 import 同一模块属性），Facade 的请求校验 /
    响应翻译 / 自动入库仍走真路径。duration 单位换算等接缝由真 request 承载。

    Monkeypatch e2m2e.algorithm.design.design_orbit to return
    fake_design_result. The stub sits at the algorithm layer (the Facade
    lazily imports the same module attribute), so Facade request
    validation / response translation / auto-ingestion still run the
    real path; seams such as duration unit conversion ride on the real
    request.
    """

    def _fake_design_orbit(request, *, spice=None, kernel_dir=None, verbose=False):
        return fake_design_result

    monkeypatch.setattr(
        "e2m2e.algorithm.design.design_orbit",
        _fake_design_orbit,
        raising=False,
    )
    return _fake_design_orbit


def make_ephemeris_table(n: int = 10, *, start_second: float = 0.0) -> EphemerisTable:
    """构造真 EphemerisTable（dataclass，供 Facade 翻译与入库访问全字段）。

        Build a real
    EphemerisTable (dataclass) with all fields accessible to Facade translation and
    ingestion."""
    return EphemerisTable(
        year=np.full(n, 2024, dtype=int),
        month=np.ones(n, dtype=int),
        day=np.ones(n, dtype=int),
        hour=np.zeros(n, dtype=int),
        minute=np.zeros(n, dtype=int),
        second=np.arange(n, dtype=float) + start_second,
        position_km=np.random.randn(n, 3),
        velocity_mps=np.random.randn(n, 3),
        synodic_position=np.random.randn(n, 3),
    )


class _FakeSKStatistic:
    def __init__(self) -> None:
        self.rows = np.array([[1.0, 2.0, 3.0]])
        self.num_failed = 0


class _FakeManeuverTable:
    def __init__(self) -> None:
        self.mjd_tdb = np.array([60000.0, 60030.0])
        self.delta_v_mps = np.array([0.5, 0.3])


class _FakeControlResult:
    """Fake ControlOrbitResult（字段覆盖 Facade 翻译与入库访问）。

        Fake ControlOrbitResult (fields
    cover Facade translation and ingestion access)."""

    def __init__(
        self,
        synodic_position: np.ndarray | None = None,
        ephemeris: EphemerisTable | None = None,
    ) -> None:
        self.status = ConvergenceState.CONVERGED
        self.cause = FailureCause.NONE
        self.message = "轨道保持完成"
        self.num_failed = 0
        self.sk_statistic = _FakeSKStatistic()
        self.maneuvers = _FakeManeuverTable()
        if ephemeris is not None:
            self.controlled_ephemeris = ephemeris
        elif synodic_position is not None:
            n = synodic_position.shape[0]
            self.controlled_ephemeris = EphemerisTable(
                year=np.full(n, 2024, dtype=int),
                month=np.ones(n, dtype=int),
                day=np.ones(n, dtype=int),
                hour=np.zeros(n, dtype=int),
                minute=np.zeros(n, dtype=int),
                second=np.arange(n, dtype=float),
                position_km=np.random.randn(n, 3),
                velocity_mps=np.random.randn(n, 3),
                synodic_position=synodic_position,
            )
        else:
            self.controlled_ephemeris = None


@pytest.fixture()
def catalog_bridge(tmp_path, monkeypatch):
    """指向 tmp 库目录的 FacadeBridge（产物自动入库不污染真实库）。

    5.9.5 起基线数据集移出 wheel，开库不再自动导入任何记录（ADR 0047），
    无需再关基线导入开关——空库起点由 e2m2e 自身语义保证。

        A FacadeBridge pointed at a tmp catalog (auto-ingestion never
    touches the real catalog). Since e2m2e 5.9.5 the baseline dataset ships
    outside the wheel, so opening a catalog imports nothing (ADR 0047): the
    old E2M2E_CATALOG_BASELINE_IMPORT kill switch is gone and the empty
    catalog assumption holds by construction."""
    from src.engine.facade_bridge import FacadeBridge

    return FacadeBridge(catalog_dir=str(tmp_path / "catalog"))
