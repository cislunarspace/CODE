"""tests for src.commons.kernels（SPICE 内核下载与可用性判断）。"""

from pathlib import Path

import pytest

from src.commons import kernels


class TestUserKernelDir:
    def test_xdg_data_home(self, monkeypatch, tmp_path):
        monkeypatch.setattr(kernels, "_IS_WINDOWS", False)
        monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
        assert kernels.user_kernel_dir() == tmp_path / "cislunar-code" / "kernels"

    def test_windows_localappdata(self, monkeypatch, tmp_path):
        monkeypatch.setattr(kernels, "_IS_WINDOWS", True)
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
        assert kernels.user_kernel_dir() == tmp_path / "cislunar-code" / "kernels"


class TestKernelDirUsable:
    def test_missing_dir(self, tmp_path):
        assert not kernels.kernel_dir_usable(tmp_path / "nope")

    def test_empty_dir(self, tmp_path):
        assert not kernels.kernel_dir_usable(tmp_path)

    def test_tls_only_not_enough(self, tmp_path):
        (tmp_path / "naif0012.tls").write_text("x")
        assert not kernels.kernel_dir_usable(tmp_path)

    def test_ephemeris_only_not_enough(self, tmp_path):
        (tmp_path / "de440s.bsp").write_text("x")
        assert not kernels.kernel_dir_usable(tmp_path)

    @pytest.mark.parametrize(
        "name", ["de440.bsp", "de440s.bsp", "de435.bsp", "de438.bsp", "de430.bsp"]
    )
    def test_ephemeris_plus_tls_usable(self, tmp_path, name):
        (tmp_path / name).write_text("x")
        (tmp_path / "naif0012.tls").write_text("x")
        assert kernels.kernel_dir_usable(tmp_path)


class TestDownloadKernels:
    @pytest.fixture(autouse=True)
    def _fake_release(self, monkeypatch, tmp_path):
        """假 release 资产 + 假网络下载（写一个占位文件）。

            Fake release assets plus a fake network
        download (writes a placeholder file)."""
        self._assets = [
            {"name": "de440s.bsp", "browser_download_url": "https://example/de440s.bsp"},
            {"name": "naif0012.tls", "browser_download_url": "https://example/naif0012.tls"},
        ]
        monkeypatch.setattr(kernels, "list_release_assets", lambda: self._assets)

        def fake_download(url, dest):
            Path(dest).write_text("fake", encoding="utf-8")

        monkeypatch.setattr(kernels, "_download", fake_download)

    def test_downloads_missing_files(self, tmp_path):
        fetched, skipped = kernels.download_kernels(tmp_path)
        assert (fetched, skipped) == (2, 0)
        assert (tmp_path / "de440s.bsp").is_file()
        assert (tmp_path / "naif0012.tls").is_file()

    def test_idempotent_skips_existing(self, tmp_path):
        (tmp_path / "de440s.bsp").write_text("old", encoding="utf-8")
        fetched, skipped = kernels.download_kernels(tmp_path)
        assert (fetched, skipped) == (1, 1)
        assert (tmp_path / "de440s.bsp").read_text(encoding="utf-8") == "old"

    def test_progress_callback(self, tmp_path):
        calls = []
        kernels.download_kernels(tmp_path, progress=lambda d, t, n: calls.append((d, t, n)))
        assert calls == [(1, 2, "de440s.bsp"), (2, 2, "naif0012.tls")]

    def test_creates_target_dir(self, tmp_path):
        target = tmp_path / "nested" / "kernels"
        kernels.download_kernels(target)
        assert (target / "de440s.bsp").is_file()

    def test_no_assets_raises(self, tmp_path):
        self._assets = []
        with pytest.raises(RuntimeError, match="未找到内核资产"):
            kernels.download_kernels(tmp_path)

    def test_ignores_non_kernel_assets(self, tmp_path):
        self._assets.append({"name": "README.txt", "browser_download_url": "https://example/r"})
        fetched, skipped = kernels.download_kernels(tmp_path)
        assert (fetched, skipped) == (2, 0)
        assert not (tmp_path / "README.txt").exists()