from __future__ import annotations

import ast
import importlib
import importlib.util
import inspect
from pathlib import Path
import sys
from typing import Sequence, get_type_hints

import fitz


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.types import CableRecordPayload, PdfEditResult  # noqa: E402
from pdf_golden import build_records, load_cases  # noqa: E402


def _lc_module():
    return importlib.import_module("pdf_engine.editors.lc")


def _resolved_imports(tree: ast.AST) -> set[str]:
    imported_modules: set[str] = set()
    package = "pdf_engine.editors"

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                relative_name = "." * node.level + (node.module or "")
                imported_modules.add(importlib.util.resolve_name(relative_name, package))
            elif node.module:
                imported_modules.add(node.module)

    return imported_modules


def test_lc_editor_has_stable_public_entry_point():
    module = _lc_module()
    function = module.edit_lc_pdf

    assert tuple(inspect.signature(function).parameters) == (
        "input_path",
        "output_path",
        "records",
        "site",
    )
    assert get_type_hints(function) == {
        "input_path": Path,
        "output_path": Path,
        "records": Sequence[CableRecordPayload],
        "site": str | None,
        "return": PdfEditResult,
    }
    assert importlib.import_module("pdf_engine.editors").edit_lc_pdf is function


def test_lc_editor_only_imports_shared_engine_modules_stdlib_and_fitz():
    module = _lc_module()
    module_path = Path(inspect.getfile(module))
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    imported_modules = _resolved_imports(tree)

    allowed_imports = {
        "__future__",
        "datetime",
        "pathlib",
        "sys",
        "typing",
        "fitz",
        "pdf_engine.cid",
        "pdf_engine.layout",
        "pdf_engine.summary",
        "pdf_engine.types",
    }
    assert imported_modules <= allowed_imports
    assert "pdf_editor" not in imported_modules


def test_lc_editor_real_minimal_fixture_returns_pdf_edit_result(tmp_path: Path):
    module = _lc_module()
    case = next(case for case in load_cases() if case.name == "lc-minimal")
    records = build_records(case)
    output = tmp_path / "lc-minimal.pdf"

    result = module.edit_lc_pdf(
        str(ROOT / case.template),
        str(output),
        records,
        case.site,
    )

    assert result == PdfEditResult(
        output=output,
        pages=case.expected_pages,
        records=len(records),
    )
    assert result.output.is_file()
    with fitz.open(result.output) as document:
        assert document.page_count == result.pages
