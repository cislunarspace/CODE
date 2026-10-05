"""units 模块的换算与上游常量一致性测试（#531）。

units.py 是 AGENTS.md 硬契约 2 的唯一单位换算来源，本模块钉住两件事：
常量取自 e2m2e 模板（不另立一套）、换算函数往返闭合。

English: tests for src.commons.units (#531). units.py is the single
source of unit conversion (AGENTS.md hard contract 2); these tests pin
that its constants derive from the e2m2e templates (no second set of
conversions) and that the converters round-trip.
"""

import math

import pytest
from e2m2e.data.templates import CHAR_LENGTH_KM, CHAR_PERIOD_SEC

from src.commons import units


class TestUnitsConstants:
    def test_du_km_derives_from_template_char_length(self):
        """DU_KM 取自 e2m2e CHAR_LENGTH_KM（384400 km），不另立常量。"""
        assert units.DU_KM == pytest.approx(CHAR_LENGTH_KM)
        assert units.DU_KM == pytest.approx(384400.0)

    def test_tu_seconds_derives_from_template_period_over_two_pi(self):
        """TU_SECONDS = CHAR_PERIOD_SEC / (2π)，约 375190.26 s。

        钉住字面值防口径漂移：本值与 frontend/src/cr3bp.ts 同口径；
        frontend/src/paramOverlay 的 375676.97 是另一种口径，勿混用。
        """
        expected = CHAR_PERIOD_SEC / (2.0 * math.pi)
        assert units.TU_SECONDS == pytest.approx(expected)
        assert units.TU_SECONDS == pytest.approx(375190.26, rel=1e-5)


class TestUnitsConversions:
    def test_km_du_roundtrip(self):
        """km 与 DU 换算往返闭合；1 DU 即 384400 km。"""
        assert units.km_to_du(units.du_to_km(2.5)) == pytest.approx(2.5)
        assert units.km_to_du(384400.0) == pytest.approx(1.0)
        assert units.du_to_km(1.0) == pytest.approx(384400.0)

    def test_seconds_tu_roundtrip(self):
        """秒与 TU 换算往返闭合。"""
        assert units.seconds_to_tu(units.tu_to_seconds(3.0)) == pytest.approx(3.0)
        assert units.tu_to_seconds(1.0) == pytest.approx(units.TU_SECONDS)

    def test_years_tu_roundtrip(self):
        """年与 TU 换算往返闭合；换算基数是 SECONDS_PER_YEAR = 365.25 天。"""
        assert units.years_to_tu(units.tu_to_years(1.5)) == pytest.approx(1.5)
        assert units.SECONDS_PER_YEAR == pytest.approx(365.25 * 86400.0)
