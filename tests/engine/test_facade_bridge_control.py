"""tests for FacadeBridge.control_orbit + OrbitDesignResultData.ephemeris (issue #348/#375)。
Tests for FacadeBridge.control_orbit plus OrbitDesignResultData.ephemeris
(issues #348/#375).

桩打在算法层 ``e2m2e.algorithm.station_keeping.control_orbit`` 上：请求校验、
响应翻译、产物自动入库与谱系写入仍走真 Facade（e2m2e 5.8.0）。
The stub sits on the algorithm layer
(``e2m2e.algorithm.station_keeping.control_orbit``): request validation,
response translation, product auto-ingestion and lineage writing still run
the real Facade (e2m2e 5.8.0).
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
from e2m2e.data.templates.seed import EARTH_MOON_MU

from src.engine.facade_bridge import ControlResultData, FacadeBridge
from tests.engine.conftest import (
    _FakeControlResult,
    _FakeDesignResult,
    make_ephemeris_table,
)

# ---------------------------------------------------------------------------
# design_orbit ephemeris 提取
# design_orbit ephemeris extraction
# ---------------------------------------------------------------------------


class TestDesignOrbitEphemerisExtraction:
    @pytest.mark.spice
    def test_design_orbit_result_carries_ephemeris_fields(self, monkeypatch, catalog_bridge):
        """design_orbit 应将 result.ephemeris 提取到 DTO.ephemeris dict。
        design_orbit must extract result.ephemeris into the DTO's ephemeris dict.

        P0 起 ephemeris dict 还含 times_et（UTC 拆分用 str2et 重建的 ET 秒），
        故此测试需要闰秒内核 → spice marker。

        design_orbit must extract result.ephemeris into the DTO's
        ephemeris dict. Since P0 the ephemeris dict also carries times_et
        (ET seconds rebuilt from the UTC split via str2et), so this test
        needs the leap-second kernel (the spice marker).
        """
        result = _FakeDesignResult(ephemeris=make_ephemeris_table(10))

        monkeypatch.setattr(
            "e2m2e.algorithm.design.design_orbit",
            lambda request, *, spice=None, kernel_dir=None, verbose=False: result,
            raising=False,
        )
        data = catalog_bridge.design_orbit(orbit_type="DRO")
        assert data.ephemeris is not None
        for key in (
            "year",
            "month",
            "day",
            "hour",
            "minute",
            "second",
            "position_km",
            "velocity_mps",
            "synodic_position",
            "times_et",
        ):
            assert key in data.ephemeris
            assert isinstance(data.ephemeris[key], np.ndarray)
        # times_jd_tdb 设计链路不填：Facade dict 里为 None，桥接层过滤后键缺省
        # times_jd_tdb is unset in the design chain: None inside the Facade dict, so
        # the key is absent after the bridge filters it
        assert not data.ephemeris.get("times_jd_tdb")

    def test_design_orbit_ephemeris_none_when_absent(self, monkeypatch, catalog_bridge):
        """result 无 ephemeris 时，DTO.ephemeris 为 None。
        When result has no ephemeris, DTO.ephemeris is None.
        """
        result = _FakeDesignResult()

        monkeypatch.setattr(
            "e2m2e.algorithm.design.design_orbit",
            lambda request, *, spice=None, kernel_dir=None, verbose=False: result,
            raising=False,
        )
        data = catalog_bridge.design_orbit(orbit_type="DRO")
        assert data.ephemeris is None


# ---------------------------------------------------------------------------
# control_orbit
# ---------------------------------------------------------------------------


def _make_ephemeris_data(n: int = 10, with_none_tjd: bool = True) -> dict:
    """构造 control_orbit 所需的 ephemeris_data dict。
    Build the ephemeris_data dict that control_orbit needs.

    times_jd_tdb 当前版本 EphemerisTable 无此字段，始终设 None（与生产提取一致）。
    with_none_tjd 参数保留用于验证 None 值被正确跳过。

    Build the ephemeris_data dict control_orbit needs.
    EphemerisTable currently has no times_jd_tdb field, so it is always
    None here (matching the production extraction); the with_none_tjd
    parameter stays to verify that None values are skipped correctly.
    """
    data = {
        "year": np.full(n, 2024),
        "month": np.ones(n, dtype=int),
        "day": np.ones(n, dtype=int),
        "hour": np.zeros(n, dtype=int),
        "minute": np.zeros(n, dtype=int),
        "second": np.zeros(n, dtype=float),
        "position_km": np.random.randn(n, 3),
        "velocity_mps": np.random.randn(n, 3),
        "synodic_position": np.random.randn(n, 3),
        "times_jd_tdb": None if with_none_tjd else np.linspace(60000, 60365, n),
    }
    return data


def _patch_control(monkeypatch, fake_result, received: dict | None = None):
    """把算法层 control_orbit 换成返回 fake_result 的桩（Facade 内部延迟 import 同模块）。
    Stub the algorithm-layer control_orbit with one returning fake_result
    (the Facade lazily imports the same module).
    """

    def _fake_control(eph, **kw):
        if received is not None:
            received.update(kw)
            received["_eph"] = eph
        return fake_result

    monkeypatch.setattr(
        "e2m2e.algorithm.station_keeping.control_orbit",
        _fake_control,
        raising=False,
    )


class TestControlOrbit:
    @pytest.mark.spice
    def test_control_orbit_returns_control_result_dto(self, monkeypatch, catalog_bridge):
        """control_orbit 应返回 ControlResultData，controlled_states 形状 (n,6)。

        controlled_states[:, :3] 应为质心归一 synodic（= synodic_position − source_mu），
        position_km 等于 fake 的 GCRS km，times_et 等于 SPICE str2et 重建的真物理时间。

        control_orbit must return a ControlResultData with controlled_states
        shaped (n,6). controlled_states[:, :3] must be barycenter-normalized
        synodic (= synodic_position − source_mu), position_km equal to the
        fake's GCRS km, and times_et the true physical time rebuilt via
        SPICE str2et.
        """
        import spiceypy as spice

        n = 50
        source_mu = EARTH_MOON_MU
        synodic = np.random.randn(n, 3)
        fake_result = _FakeControlResult(synodic_position=synodic)
        times_meta = [(2024, 1, 1, 0, 0, float(k)) for k in range(n)]
        fake_result.controlled_ephemeris.second = np.arange(n, dtype=float)
        _patch_control(monkeypatch, fake_result)

        data = catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(n),
            source_mu=source_mu,
            control_mode=1,
            num_monte_carlo=2,
        )
        assert isinstance(data, ControlResultData)
        assert data.num_failed == 0
        assert data.controlled_states is not None
        assert data.controlled_states.shape == (n, 6)
        # 质心归一：synodic − source_mu（地心归一 → 质心归一，月球在 1−μ）
        # Barycenter normalization: synodic - source_mu (Earth-centered ->
        # barycenter-normalized, Moon at 1-mu)
        np.testing.assert_array_equal(
            data.controlled_states[:, :3], synodic - source_mu
        )
        # 速度列补零
        # Velocity columns filled with zeros
        np.testing.assert_array_equal(data.controlled_states[:, 3:], np.zeros((n, 3)))
        assert data.controlled_times is not None
        assert len(data.controlled_times) == n
        assert data.mu == pytest.approx(source_mu)

        # position_km 直接透传
        # position_km passed through as-is
        assert data.position_km is not None
        np.testing.assert_array_equal(
            data.position_km, fake_result.controlled_ephemeris.position_km
        )

        # times_et 由 UTC 拆分用 str2et 重建，应与逐点独立 str2et 一致
        # times_et is rebuilt from UTC splits via str2et and must match pointwise
        # independent str2et calls
        assert data.times_et is not None
        expected_et = np.array(
            [
                spice.str2et(
                    f"{y:04d}-{mo:02d}-{d:02d}T{h:02d}:{mi:02d}:{s:06.3f}"
                )
                for (y, mo, d, h, mi, s) in times_meta
            ]
        )
        # 显式阈值：同串 str2et 应逐位一致；assert_allclose 默认 atol 为 0（纯相对比较），此处显式给 rtol 1e-7、atol 1e-8，防近零元素误报，仍严于标准的 atol 1e-6
        np.testing.assert_allclose(data.times_et, expected_et, rtol=1e-7, atol=1e-8)
        # controlled_times 现在就是真物理时间（不再是 np.arange）
        # controlled_times now holds true physical time (no longer np.arange)
        np.testing.assert_array_equal(data.controlled_times, data.times_et)

    def test_control_orbit_none_states_when_no_ephemeris(self, monkeypatch, catalog_bridge):
        """所有样本失败（controlled_ephemeris=None）时，controlled_states/times 为 None。
        When every sample fails (controlled_ephemeris=None), controlled_states/times
        are None.
        """
        _patch_control(monkeypatch, _FakeControlResult())

        data = catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(10),
            source_mu=None,
            control_mode=1,
        )
        assert data.controlled_states is None
        assert data.controlled_times is None
        assert data.position_km is None
        assert data.times_et is None
        assert data.mu is None

    def test_control_orbit_translates_exceptions(self, monkeypatch, catalog_bridge):
        """算法层抛 ValueError 应翻译为 OrbitError(INVALID_PARAMS)。
        An algorithm-layer ValueError must translate into OrbitError(INVALID_PARAMS).
        """
        from src.engine.exceptions import OrbitError

        def _fail(eph, **kw):
            raise ValueError("bad params")

        monkeypatch.setattr(
            "e2m2e.algorithm.station_keeping.control_orbit",
            _fail,
            raising=False,
        )
        with pytest.raises(OrbitError) as exc_info:
            catalog_bridge.control_orbit(
                ephemeris_data=_make_ephemeris_data(10),
                source_mu=None,
            )
        assert exc_info.value.code == "INVALID_PARAMS"

    def test_control_orbit_mu_transported_via_request(self, monkeypatch, catalog_bridge):
        """source_mu 经 request.mu 透传到响应（算法层不消费，画地月标注用）。

        面板收集的 mu 是响应透传字段，Facade 构造 request 时合法接收；
        算法层调用参数表里没有 mu（5.8.0 Facade 逐字段转发）。

        source_mu passes through to the response via request.mu (not
        consumed by the algorithm layer; used to draw Earth-Moon
        annotations). The mu collected by the panel is a passthrough
        response field that the Facade legally accepts when building the
        request; the algorithm-layer call arguments have no mu (since
        5.8.0 the Facade forwards field by field).
        """
        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        data = catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5),
            source_mu=0.0123,
            mu=None,  # 面板收集的字段（隐藏，防御性传入）
            control_mode=1,
        )
        assert "mu" not in received
        assert data.mu == pytest.approx(0.0123)

    def test_control_orbit_drops_engine_layout_when_mode_lt_4(self, monkeypatch, catalog_bridge):
        """control_mode < 4 时 engine_layout 无意义，不应透传（字符串会炸）。

        回归：面板把 engine_layout 建成 JSON 文本框，用户随手填 "4"，e2m2e
        对非 None 值无条件 validate（访问 .E_r），字符串直接 AttributeError
        （GUI 报 UNKNOWN_ERROR）。

        With control_mode < 4 engine_layout is meaningless and must not
        pass through (arbitrary strings would blow up). Regression: the
        panel builds engine_layout as a JSON text box; a user typing
        "4" trips e2m2e's unconditional validate of non-None values
        (accessing .E_r), raising a raw AttributeError (surfacing in the
        GUI as UNKNOWN_ERROR).
        """
        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5),
            source_mu=None,
            control_mode=1,
            engine_layout="4",  # 面板 JSON 文本误填
        )
        assert received.get("engine_layout") is None

    def test_control_orbit_coerces_engine_layout_dict(self, monkeypatch, catalog_bridge):
        """control_mode >= 4 时 dict 布局应构造为 EngineLayout 实例再透传。"""
        from e2m2e.algorithm.station_keeping import EngineLayout

        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        positions = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0],
                     [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]]
        directions = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0],
                      [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]]
        catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5),
            source_mu=None,
            control_mode=4,
            engine_layout={"positions_m": positions, "directions": directions},
        )
        layout = received.get("engine_layout")
        assert isinstance(layout, EngineLayout)
        assert layout.num_engines == 6

    def test_control_orbit_coerces_engine_layout_json_text(self, monkeypatch, catalog_bridge):
        """control_mode >= 4 时面板 JSON 文本应解析为 EngineLayout 实例。"""
        import json

        from e2m2e.algorithm.station_keeping import EngineLayout

        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        positions = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0],
                     [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]]
        directions = [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0],
                      [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]]
        layout_text = json.dumps({"positions_m": positions, "directions": directions})

        catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5),
            source_mu=None,
            control_mode=4,
            engine_layout=layout_text,
        )

        assert isinstance(received.get("engine_layout"), EngineLayout)

    def test_control_orbit_rejects_invalid_engine_layout(self, monkeypatch, catalog_bridge):
        """control_mode >= 4 时非布局 JSON（如 "4"）应报清晰错误而非裸崩。"""
        from src.engine.exceptions import OrbitError

        _patch_control(monkeypatch, _FakeControlResult(synodic_position=np.random.randn(5, 3)))
        with pytest.raises(OrbitError) as exc_info:
            catalog_bridge.control_orbit(
                ephemeris_data=_make_ephemeris_data(5),
                source_mu=None,
                control_mode=4,
                engine_layout="4",
            )
        assert exc_info.value.code == "INVALID_PARAMS"
        assert "engine_layout" in exc_info.value.message

    def test_control_orbit_rejects_invalid_engine_layout_json(self, monkeypatch, catalog_bridge):
        """control_mode >= 4 时非法 JSON 文本应报 JSON 解析错误。"""
        from src.engine.exceptions import OrbitError

        _patch_control(monkeypatch, _FakeControlResult(synodic_position=np.random.randn(5, 3)))
        with pytest.raises(OrbitError) as exc_info:
            catalog_bridge.control_orbit(
                ephemeris_data=_make_ephemeris_data(5),
                source_mu=None,
                control_mode=4,
                engine_layout="{invalid",
            )
        assert exc_info.value.code == "INVALID_PARAMS"
        assert "JSON" in exc_info.value.message

    @pytest.mark.spice
    def test_ephemeris_table_reconstruction_skips_none_times(self, monkeypatch, catalog_bridge):
        """times_jd_tdb=None 时 EphemerisTable 重建不崩（走 dataclass 默认）。

        EphemerisTable rebuilding must not crash with times_jd_tdb=None
        (the dataclass default applies). Since P0 control_orbit rebuilds
        times_et (spice.str2et), needing the leap-second kernel (the
        spice marker).
        """
        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        catalog_bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5, with_none_tjd=True),
            source_mu=None,
        )
        # EphemerisTable 成功构造（算法层被调用即证明）
        # EphemerisTable built successfully (proven by the algorithm layer being called)
        eph = received.get("_eph")
        assert eph is not None
        assert eph.synodic_position is not None

    @pytest.mark.spice
    def test_control_orbit_kernel_dir_forwarded(self, monkeypatch, tmp_path):
        """kernel_dir 经 Config 注入 Facade，转发到算法层调用。

        kernel_dir is injected into the Facade via Config and forwarded
        to the algorithm-layer call. Since P0 control_orbit rebuilds
        times_et (spice.str2et), needing the leap-second kernel (the
        spice marker).
        """
        received: dict = {}

        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        bridge = FacadeBridge(kernel_dir="/tmp/kernels", catalog_dir=str(tmp_path / "c"))
        bridge.control_orbit(
            ephemeris_data=_make_ephemeris_data(5),
            source_mu=None,
        )
        assert received.get("kernel_dir") == "/tmp/kernels"


class TestControlOrbitCatalog:
    """issue #375 US8/US9：站保产物自动入库 + input_record_id 直连与谱系。"""

    @pytest.mark.spice
    def test_control_result_ingested_with_lineage(self, monkeypatch, catalog_bridge):
        """以 input_record_id 输入时：产物入库且 source_record_id 指向源记录。

        准备一条真库记录（design 路径入库），再以 input_record_id 站保，
        谱系由 Facade 写入（重启后经 catalog_query 重建仍成立）。
        """
        # 入库一条源记录（星历段必须有：build_design_record 需要产物）
        # Insert one source record (the ephemeris segment is required:
        # build_design_record needs a product)
        design_result = _FakeDesignResult(ephemeris=make_ephemeris_table(10))
        monkeypatch.setattr(
            "e2m2e.algorithm.design.design_orbit",
            lambda request, *, spice=None, kernel_dir=None, verbose=False: design_result,
            raising=False,
        )
        design_dto = catalog_bridge.design_orbit(orbit_type="DRO")
        assert design_dto.record_id is not None

        received: dict = {}
        _patch_control(
            monkeypatch,
            _FakeControlResult(synodic_position=np.random.randn(5, 3)),
            received,
        )
        data = catalog_bridge.control_orbit(
            ephemeris_data=None,
            source_mu=EARTH_MOON_MU,
            input_record_id=design_dto.record_id,
            control_mode=1,
        )
        # Facade 从记录解析星历段注入算法层（ephemeris_data 未使用）
        # The Facade resolves the ephemeris segment from the record and injects it
        # into the algorithm layer (e2m2e)phemeris_data unused)
        assert received.get("_eph") is not None
        assert data.record_id is not None
        record = catalog_bridge.catalog_get(data.record_id)
        assert record.source_record_id == design_dto.record_id
        assert record.has_ephemeris is True
        assert record.has_cr3bp is False

    def test_control_without_input_raises(self, catalog_bridge):
        """既无 input_record_id 也无星历数据时报 INVALID_PARAMS（接缝防御）。"""
        from src.engine.exceptions import OrbitError

        with pytest.raises(OrbitError) as exc_info:
            catalog_bridge.control_orbit(ephemeris_data=None, source_mu=None)
        assert exc_info.value.code == "INVALID_PARAMS"
