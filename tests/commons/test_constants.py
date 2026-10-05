"""constants 模块的常量一致性测试（#531）。

硬编码常量不依赖 e2m2e 即可用；CR3BP 派生常量惰性计算，其 DU / TU 必须与
units.py 的模板常量对齐（同源不漂移，AGENTS.md 硬契约 2 的两条口径互证）。

English: consistency tests for src.commons.constants (#531). Hardcoded
constants are available without e2m2e; the lazily computed CR3BP-derived
DU / TU must stay aligned with the template-derived constants in
units.py (the two calibers of AGENTS.md hard contract 2 cross-check).
"""

import pytest

from src.commons import constants, units


class TestHardcodedConstants:
    def test_hardcoded_constants_available_without_e2m2e(self):
        """M_SUN / OMEGA_SUN / RHO 与模块内声明值一致（导入即可用）。"""
        assert constants.M_SUN == pytest.approx(3.28900541e5)
        assert constants.OMEGA_SUN == pytest.approx(9.25195985e-1)
        assert constants.RHO == pytest.approx(3.88811143e2)


class TestCr3bpDerivedConstants:
    def test_du_aligns_with_units_module(self):
        """惰性 CR3BP 常量 DU 与 units.py 模板常量同源。"""
        assert constants.DU == pytest.approx(units.DU_KM)

    def test_tu_in_days_aligns_with_units_module_in_seconds(self):
        """CR3BP_System 的 TU 以天计，乘 86400 后与 units.py 的 TU_SECONDS 同源。"""
        assert constants.TU * 86400.0 == pytest.approx(units.TU_SECONDS, rel=1e-9)
