"""领域资产：单条计算产物（Artifact）数据类。

Artifact 收拢一次工具运行的最小产物描述：类型与标签、轨道类型、来源
工具、轨道库记录 id（record_id）与两个可懒填充的大数组（state_data、
times）。catalog 记录的数组在入清单时不落内存，由
``engine.catalog_service.load_arrays`` 按需回填，需要快照的调用方先
``copy.deepcopy``。本模块属 Python 领域层，只服务脚本与测试，GUI
运行时链路经 sidecar 协议与 catalog API 取数，不经过这里的对象。

English: domain asset — the Artifact dataclass describing one computed
product: type and label, orbit type, source tool, the orbit-library
record id, and two lazily filled arrays (state_data, times). Arrays
behind catalog records are not materialized at listing time; they are
filled on demand by ``engine.catalog_service.load_arrays``, and callers
needing a snapshot should ``copy.deepcopy`` first. This module belongs
to the Python domain layer serving scripts and tests only; the GUI
runtime fetches data through the sidecar protocol and catalog APIs and
never touches these objects.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from numpy import ndarray


@dataclass
class Artifact:
    """Represents a computed orbital artifact (orbit, family, transfer, ephemeris).
    表示一个计算产物（轨道 / 轨道族 / 转移 / 星历）。

    ``state_data`` / ``times`` 允许构造后原地填充（catalog 记录懒加载，
    见 ``engine.catalog_service.load_arrays``）；需要快照的调用方请先
    ``copy.deepcopy``。
    """

    artifact_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    artifact_type: str = ""  # "orbit" | "family" | "transfer" | "ephemeris"
    label: str = ""
    orbit_type: str = ""  # DRO / Halo / NRHO / ...
    source_tool: str = ""
    # 轨道库记录 id（e2m2e catalog，issue #375）：catalog 产物的主键，
    # 此时 artifact_id 与之相同；非 catalog 产物（transfer 遗留分区）为 None。
    # Orbit-library record id (e2m2e catalog, issue #375): primary key for catalog products,
    # where artifact_id equals it; None for non-catalog products (legacy transfer partition).
    record_id: str | None = None
    state_data: ndarray | None = None  # (n, 6) state matrix
    times: ndarray | None = None  # (n,) time vector
    output_path: Path | None = None
    extra: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_summary(self) -> dict:
        """Return a summary dict excluding large array fields (state_data, times).
        返回排除大数组字段（state_data、times）的摘要 dict。"""
        return {
            "artifact_id": self.artifact_id,
            "artifact_type": self.artifact_type,
            "label": self.label,
            "orbit_type": self.orbit_type,
            "source_tool": self.source_tool,
            "record_id": self.record_id,
            "output_path": str(self.output_path) if self.output_path else None,
            "extra": self.extra,
            "created_at": self.created_at.isoformat(),
        }
