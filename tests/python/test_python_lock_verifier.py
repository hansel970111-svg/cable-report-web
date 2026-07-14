from __future__ import annotations

from pathlib import Path
import re
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from verify_python_locks import verify_python_locks  # noqa: E402


def _inputs() -> tuple[str, str, str]:
    return (
        (ROOT / "requirements.lock").read_text(encoding="utf-8"),
        (ROOT / "requirements-dev.lock").read_text(encoding="utf-8"),
        (ROOT / "requirements-lock-tools.txt").read_text(encoding="utf-8"),
    )


def _remove_block(text: str, package: str) -> str:
    pattern = re.compile(
        rf"(?ms)^{re.escape(package)}==.*?(?=^[a-zA-Z0-9_.-]+(?:==|[<>=!~])|\Z)"
    )
    updated, count = pattern.subn("", text, count=1)
    assert count == 1
    return updated


def _remove_block_hashes(text: str, package: str) -> str:
    pattern = re.compile(
        rf"(?ms)^(?P<block>{re.escape(package)}==.*?)(?=^[a-zA-Z0-9_.-]+(?:==|[<>=!~])|\Z)"
    )
    match = pattern.search(text)
    assert match
    block = re.sub(r"(?m)^\s+--hash=sha256:[0-9a-f]{64}(?: \\)?\n", "", match.group("block"))
    return text[: match.start()] + block + text[match.end() :]


def _remove_one_block_hash(text: str, package: str) -> str:
    pattern = re.compile(
        rf"(?ms)^(?P<block>{re.escape(package)}==.*?)(?=^[a-zA-Z0-9_.-]+(?:==|[<>=!~])|\Z)"
    )
    match = pattern.search(text)
    assert match
    block, count = re.subn(
        r"(?m)^\s+--hash=sha256:[0-9a-f]{64}(?: \\)?\n",
        "",
        match.group("block"),
        count=1,
    )
    assert count == 1
    assert "--hash=sha256:" in block
    return text[: match.start()] + block + text[match.end() :]


def test_verifier_accepts_the_committed_universal_hash_locks() -> None:
    verify_python_locks(*_inputs())


def test_verifier_rejects_a_requirement_without_hashes() -> None:
    runtime, dev, tools = _inputs()
    tampered = _remove_block_hashes(runtime, "pymupdf")
    with pytest.raises(ValueError, match="pymupdf.*hash"):
        verify_python_locks(tampered, dev, tools)


def test_verifier_rejects_a_missing_windows_dependency() -> None:
    runtime, dev, tools = _inputs()
    tampered = _remove_block(runtime, "pefile")
    with pytest.raises(ValueError, match="pefile"):
        verify_python_locks(tampered, dev, tools)


def test_verifier_rejects_an_unpinned_requirement() -> None:
    runtime, dev, tools = _inputs()
    tampered = runtime.replace("pymupdf==1.26.7", "pymupdf>=1.26.7", 1)
    assert tampered != runtime
    with pytest.raises(ValueError, match="pymupdf.*exact"):
        verify_python_locks(tampered, dev, tools)


def test_verifier_rejects_runtime_dev_version_drift() -> None:
    runtime, dev, tools = _inputs()
    tampered = dev.replace("pillow==12.2.0", "pillow==12.2.1", 1)
    assert tampered != dev
    with pytest.raises(ValueError, match="pillow.*drift"):
        verify_python_locks(runtime, tampered, tools)


def test_verifier_rejects_an_unapproved_lock_builder() -> None:
    runtime, dev, _ = _inputs()
    with pytest.raises(ValueError, match="uv"):
        verify_python_locks(runtime, dev, "uv==0.11.29\n")


@pytest.mark.parametrize(
    "directive",
    [
        "--no-binary :all:",
        "--index-url https://packages.invalid/simple",
    ],
)
def test_verifier_rejects_unsafe_requirements_directives(directive: str) -> None:
    runtime, dev, tools = _inputs()
    tampered = f"{directive}\n{runtime}"
    with pytest.raises(ValueError, match="unsupported.*directive"):
        verify_python_locks(tampered, dev, tools)


def test_verifier_rejects_runtime_dev_hash_set_drift() -> None:
    runtime, dev, tools = _inputs()
    tampered = _remove_one_block_hash(dev, "altgraph")
    with pytest.raises(ValueError, match="altgraph.*drift"):
        verify_python_locks(runtime, tampered, tools)
