from __future__ import annotations

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine import cli  # noqa: E402


def test_pdf_editor_is_a_thin_cli_facade() -> None:
    source = (ROOT / "scripts/pdf_editor.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    locally_defined = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }

    assert locally_defined == set()
    assert len(source.splitlines()) <= 8


def test_pdf_engine_cli_main_adapts_explicit_argv_and_process_streams(monkeypatch) -> None:
    calls = []

    def fake_run_editor_cli(argv, editor=None, *, stdout, stderr):
        calls.append((argv, editor, stdout, stderr))
        return 17

    monkeypatch.setattr(cli, "run_editor_cli", fake_run_editor_cli)

    assert cli.main(["input.pdf", "output.pdf", "request.json"]) == 17
    assert calls == [
        (["input.pdf", "output.pdf", "request.json"], None, sys.stdout, sys.stderr),
    ]


def test_pdf_engine_cli_main_defaults_to_process_argv(monkeypatch) -> None:
    received = []
    monkeypatch.setattr(sys, "argv", ["pdf_editor.py", "in.pdf", "out.pdf", "request.json"])
    monkeypatch.setattr(
        cli,
        "run_editor_cli",
        lambda argv, editor=None, *, stdout, stderr: received.append(list(argv)) or 0,
    )

    assert cli.main() == 0
    assert received == [["in.pdf", "out.pdf", "request.json"]]
