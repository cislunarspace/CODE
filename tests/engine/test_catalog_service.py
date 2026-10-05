"""tests for src.engine.catalog_service -- 轨道库 ↔ Artifact 模型接缝（issue #375）。

用桩 bridge（duck-typed FacadeBridge 的 catalog 方法）测 GUI 语义：清单映射、
懒加载填充、标注 / 导出 / 删除转发。catalog 自身行为由 e2m2e #475 测试覆盖，
此处不重测上游。e2m2e 5.9.3 起一轨一记录（ADR 0045）：族成员逐条入库，
摘要携带 family_id / member_index（member_count 已移除），提升动作随
catalog_promote 一并移除。
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from src.engine.catalog_service import CatalogService, record_to_artifact


def _summary(
    record_id: str = "rec-1",
    source_tool: str = "design_orbit",
    source_record_id: str | None = None,
    orbit_family: str | None = "halo",
    libration_point: int | None = 2,
    jacobi: list | None = None,
    amplitude: list | None = None,
    has_cr3bp: bool = True,
    has_ephemeris: bool = True,
    family_id: str | None = None,
    member_index: int | None = None,
    tags: list | None = None,
    note: str = "",
) -> SimpleNamespace:
    from e2m2e.status import ConvergenceState, FailureCause

    return SimpleNamespace(
        record_id=record_id,
        created_at="2026-08-19T10:00:00+00:00",
        source_tool=source_tool,
        source_record_id=source_record_id,
        orbit_family=orbit_family,
        libration_point=libration_point,
        jacobi=jacobi,
        amplitude=amplitude,
        has_cr3bp=has_cr3bp,
        has_ephemeris=has_ephemeris,
        status=ConvergenceState.CONVERGED,
        cause=FailureCause.NONE,
        message="",
        family_id=family_id,
        member_index=member_index,
        tags=tags or [],
        note=note,
    )


class _StubBridge:
    """FacadeBridge.catalog_* 方法的桩：记录调用、返回预置响应。"""

    def __init__(self, summaries=None, records=None) -> None:
        self.summaries = summaries or []
        self.records = records or {}
        self.calls: dict[str, dict] = {}

    def catalog_query(self, **params):
        self.calls["query"] = params
        return self.summaries

    def catalog_get(self, record_id):
        self.calls["get"] = {"record_id": record_id}
        if record_id not in self.records:
            from src.engine.exceptions import OrbitError

            raise OrbitError("RECORD_NOT_FOUND", f"记录不存在: {record_id}")
        return self.records[record_id]

    def catalog_tag(self, record_id, tags, note=None):
        self.calls["tag"] = {"record_id": record_id, "tags": tags, "note": note}

    def catalog_delete(self, record_id):
        self.calls["delete"] = {"record_id": record_id}

    def catalog_export(self, dest, **filters):
        self.calls["export"] = {"dest": dest, **filters}
        return 3


class TestRecordToArtifact:
    def test_design_summary_maps_to_orbit_artifact(self):
        art = record_to_artifact(
            _summary(jacobi=[3.05, 3.05], amplitude=[8000.0, 8000.0])
        )
        assert art.artifact_type == "orbit"
        assert art.artifact_id == "rec-1"  # record_id 即唯一标识
        assert art.record_id == "rec-1"
        assert art.orbit_type == "Halo"
        assert "C_J=3.0500" in art.label
        assert art.source_tool == "design_orbit"
        assert art.state_data is None  # 摘要不含数组段（懒加载）
        assert art.extra["has_ephemeris"] is True
        assert art.extra["tags"] == []
        assert art.created_at.year == 2026

    def test_family_member_summary_maps_to_orbit_artifact(self):
        """5.9.3 一轨一记录：族成员记录是单条轨道，族维度进 extra。"""
        art = record_to_artifact(
            _summary(
                record_id="rec-m7",
                source_tool="orbit_family_generation",
                orbit_family="nrho",
                libration_point=2,
                jacobi=[3.10, 3.10],
                family_id="fam-a1",
                member_index=7,
            )
        )
        assert art.artifact_type == "orbit"
        assert "NRHO" in art.label
        assert art.extra["family_id"] == "fam-a1"
        assert art.extra["member_index"] == 7

    def test_control_summary_maps_to_ephemeris_artifact(self):
        art = record_to_artifact(
            _summary(
                record_id="rec-e",
                source_tool="control_orbit",
                source_record_id="rec-1",
                orbit_family="halo",
                has_cr3bp=False,
                has_ephemeris=True,
            )
        )
        assert art.artifact_type == "ephemeris"
        assert art.extra["source_record_id"] == "rec-1"


class TestQueryArtifacts:
    def test_query_passes_filters_and_maps(self):
        bridge = _StubBridge(summaries=[_summary()])
        service = CatalogService(bridge)
        artifacts = service.query_artifacts({"orbit_family": "halo", "libration_point": 2})
        assert bridge.calls["query"] == {"orbit_family": "halo", "libration_point": 2}
        assert [a.record_id for a in artifacts] == ["rec-1"]

    def test_query_by_family_id_forwards(self):
        """family_id（生成批次）是整族查询句柄，原样透传。"""
        bridge = _StubBridge()
        CatalogService(bridge).query_artifacts({"family_id": "fam-a1"})
        assert bridge.calls["query"] == {"family_id": "fam-a1"}

    def test_query_none_filters_means_empty(self):
        bridge = _StubBridge()
        CatalogService(bridge).query_artifacts()
        assert bridge.calls["query"] == {}


class TestLoadArrays:
    def _design_record(self) -> SimpleNamespace:
        n = 5
        arrays = {
            "cr3bp/states": np.random.randn(n, 6),
            "cr3bp/times": np.linspace(0, 1, n),
        }
        scalars = {"mu": 0.01215, "epoch_utc": "2024-01-01T00:00:00"}
        return SimpleNamespace(
            source_tool="design_orbit",
            arrays=arrays,
            scalars=scalars,
            jacobi=[3.1, 3.1],
        )

    def test_design_record_fills_states(self):
        bridge = _StubBridge(records={"rec-1": self._design_record()})
        artifact = record_to_artifact(_summary())
        assert CatalogService(bridge).load_arrays(artifact) is True
        assert artifact.state_data.shape == (5, 6)
        assert artifact.extra["mu"] == pytest.approx(0.01215)

    @pytest.mark.spice
    def test_design_record_ephemeris_rebuilds_times_et(self):
        """星历段懒加载重建四槽位数据源（含 times_et，需闰秒内核）。"""
        from tests.engine.conftest import make_ephemeris_table

        n = 5
        eph = make_ephemeris_table(n)
        record = self._design_record()
        record.arrays.update(
            {f"eph/{k}": v for k, v in (
                ("year", eph.year), ("month", eph.month), ("day", eph.day),
                ("hour", eph.hour), ("minute", eph.minute), ("second", eph.second),
                ("position_km", eph.position_km), ("velocity_mps", eph.velocity_mps),
                ("synodic_position", eph.synodic_position),
            ) if v is not None}
        )
        bridge = _StubBridge(records={"rec-1": record})
        artifact = record_to_artifact(_summary())
        CatalogService(bridge).load_arrays(artifact)
        eph_loaded = artifact.extra["ephemeris"]
        assert eph_loaded is not None
        assert "times_et" in eph_loaded
        assert len(eph_loaded["times_et"]) == n

    @pytest.mark.spice
    def test_control_record_subtracts_mu(self):
        """站保记录的会合系位置减 μ 对齐画布质心归一（ADR 0013）。"""
        from tests.engine.conftest import make_ephemeris_table

        n = 4
        mu = 0.01215
        eph = make_ephemeris_table(n)
        syn = np.random.randn(n, 3)
        eph.synodic_position = syn
        record = SimpleNamespace(
            source_tool="control_orbit",
            arrays={
                "eph/year": eph.year,
                "eph/month": eph.month,
                "eph/day": eph.day,
                "eph/hour": eph.hour,
                "eph/minute": eph.minute,
                "eph/second": eph.second,
                "eph/position_km": eph.position_km,
                "eph/velocity_mps": eph.velocity_mps,
                "eph/synodic_position": syn,
            },
            scalars={"mu": mu},
        )
        bridge = _StubBridge(records={"rec-e": record})
        artifact = record_to_artifact(
            _summary(record_id="rec-e", source_tool="control_orbit", has_cr3bp=False)
        )
        assert CatalogService(bridge).load_arrays(artifact) is True
        np.testing.assert_array_equal(artifact.state_data[:, :3], syn - mu)
        np.testing.assert_array_equal(artifact.state_data[:, 3:], np.zeros((n, 3)))

    def test_family_member_record_fills_states(self):
        """族成员记录（一轨一记录）：顶层 cr3bp/states 即该成员轨迹 (n, 6)。"""
        n = 7
        record = SimpleNamespace(
            source_tool="orbit_family_generation",
            arrays={
                "cr3bp/states": np.full((n, 6), 0.5),
                "cr3bp/times": np.linspace(0, 1, n),
            },
            scalars={"mu": 0.01215, "period": None, "periodicity": "periodic"},
        )
        bridge = _StubBridge(records={"rec-f": record})
        artifact = record_to_artifact(
            _summary(record_id="rec-f", source_tool="orbit_family_generation", family_id="fam-a1")
        )
        assert CatalogService(bridge).load_arrays(artifact) is True
        assert artifact.state_data.shape == (n, 6)
        assert artifact.extra["family_type"] == "halo"

    def test_family_periodic_member_resampled(self, monkeypatch):
        """周期成员记录只携带初态与 scalars.period 时按周期重采样（画布渲染契约）。"""
        record = SimpleNamespace(
            source_tool="orbit_family_generation",
            arrays={
                "cr3bp/states": np.array([[1.0, 0.0, 0.01, 0.0, 0.3, 0.0]]),
                "cr3bp/times": np.array([0.0]),
            },
            scalars={"mu": 0.01215, "period": 3.0, "periodicity": "periodic"},
        )
        monkeypatch.setattr(
            "e2m2e.algorithm.dynamics.CR3BP_Dynamics",
            lambda system: SimpleNamespace(
                propagate=lambda s0, t_span, t_eval=None: {
                    "states": np.tile(s0, (len(t_eval), 1))
                }
            ),
            raising=False,
        )
        bridge = _StubBridge(records={"rec-f": record})
        artifact = record_to_artifact(
            _summary(record_id="rec-f", source_tool="orbit_family_generation", family_id="fam-a1")
        )
        assert CatalogService(bridge).load_arrays(artifact) is True
        assert artifact.state_data.shape == (200, 6)
        assert artifact.times[-1] == pytest.approx(3.0)

    def test_missing_record_returns_false(self):
        bridge = _StubBridge()  # catalog_get 抛 RECORD_NOT_FOUND
        artifact = record_to_artifact(_summary())
        assert CatalogService(bridge).load_arrays(artifact) is False

    def test_no_record_id_returns_false(self):
        from src.model.artifact import Artifact

        artifact = Artifact(artifact_type="orbit")
        assert CatalogService(_StubBridge()).load_arrays(artifact) is False


class TestMutators:
    def test_tag_forwards(self):
        bridge = _StubBridge()
        CatalogService(bridge).tag("rec-1", ["课程A"], "备注")
        assert bridge.calls["tag"] == {"record_id": "rec-1", "tags": ["课程A"], "note": "备注"}

    def test_delete_forwards(self):
        bridge = _StubBridge()
        CatalogService(bridge).delete("rec-1")
        assert bridge.calls["delete"] == {"record_id": "rec-1"}

    def test_export_passes_filters_and_returns_count(self):
        bridge = _StubBridge()
        count = CatalogService(bridge).export({"orbit_family": "halo"}, "/tmp/x.zip")
        assert count == 3
        assert bridge.calls["export"] == {"dest": "/tmp/x.zip", "orbit_family": "halo"}
