from __future__ import annotations

import importlib
import importlib.metadata
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_REQUIREMENTS = [
    "PyMuPDF==1.26.7",
    "pyinstaller==6.21.0",
    "Pillow==12.2.0",
]
DEV_REQUIREMENTS = ["-r requirements.txt", "pytest==9.0.3"]
INSTALLED_VERSIONS = {
    "PyMuPDF": "1.26.7",
    "pyinstaller": "6.21.0",
    "Pillow": "12.2.0",
    "pytest": "9.0.3",
}


def _meaningful_lines(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def _requirement_blocks(lock_text: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for line in lock_text.splitlines():
        if line and not line.startswith((" ", "#", "--")):
            if current:
                blocks.append("\n".join(current))
            current = [line]
        elif current and (line.startswith(" ") or line.startswith("#")):
            current.append(line)
    if current:
        blocks.append("\n".join(current))
    return blocks


def test_python_dependency_inputs_are_exact_and_approved() -> None:
    assert sys.version_info[:2] == (3, 12)
    assert _meaningful_lines(ROOT / "requirements.txt") == RUNTIME_REQUIREMENTS
    assert _meaningful_lines(ROOT / "requirements-dev.txt") == DEV_REQUIREMENTS

    for requirement in [*RUNTIME_REQUIREMENTS, DEV_REQUIREMENTS[-1]]:
        assert re.fullmatch(r"[A-Za-z0-9_.-]+==[^=<>!~*]+", requirement)


def test_universal_hash_locks_cover_all_release_platforms() -> None:
    runtime_lock = (ROOT / "requirements.lock").read_text(encoding="utf-8")
    dev_lock = (ROOT / "requirements-dev.lock").read_text(encoding="utf-8")

    for lock_text in (runtime_lock, dev_lock):
        assert "uv pip compile" in lock_text
        assert "--universal" in lock_text
        assert "--python-version 3.12" in lock_text
        assert "--only-binary :all:" in lock_text
        assert "macholib==" in lock_text and "sys_platform == 'darwin'" in lock_text
        assert "pefile==" in lock_text and "sys_platform == 'win32'" in lock_text
        assert "pywin32-ctypes==" in lock_text
        blocks = _requirement_blocks(lock_text)
        assert blocks
        assert all("==" in block.splitlines()[0] for block in blocks)
        assert all("--hash=sha256:" in block for block in blocks)

    assert "pytest==9.0.3" not in runtime_lock
    assert "pytest==9.0.3" in dev_lock
    assert "colorama==" in dev_lock and "sys_platform == 'win32'" in dev_lock


def test_installed_direct_versions_match_approved_inputs() -> None:
    assert {
        distribution: importlib.metadata.version(distribution)
        for distribution in INSTALLED_VERSIONS
    } == INSTALLED_VERSIONS


def test_runtime_modules_import() -> None:
    for module in ("fitz", "PyInstaller", "PIL", "pytest"):
        assert importlib.import_module(module) is not None


def test_installed_environment_has_no_dependency_conflicts() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "pip", "check"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
