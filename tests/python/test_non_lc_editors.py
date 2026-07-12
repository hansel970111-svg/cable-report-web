from __future__ import annotations

import ast
import importlib
import importlib.util
import inspect
import io
import json
from pathlib import Path
import sys
from typing import Literal, Sequence, get_type_hints

import fitz
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.types import (  # noqa: E402
    CableRecordPayload,
    PdfEditResult,
    TemplateKind,
)
from pdf_golden import load_cases  # noqa: E402


def _resolved_imports(module_name: str) -> set[str]:
    module = importlib.import_module(module_name)
    module_path = Path(inspect.getfile(module))
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    package = module_name.rpartition(".")[0]
    imports: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                relative_name = "." * node.level + (node.module or "")
                imports.add(importlib.util.resolve_name(relative_name, package))
            elif node.module:
                imports.add(node.module)

    return imports


@pytest.mark.parametrize(
    ("module_name", "function_name"),
    [
        ("pdf_engine.editors.cat5e", "edit_cat5e_pdf"),
        ("pdf_engine.editors.mpo", "edit_mpo_pdf"),
    ],
)
def test_non_lc_editor_has_stable_public_entry_point(module_name, function_name):
    module = importlib.import_module(module_name)
    function = getattr(module, function_name)

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


def test_non_lc_shared_helper_has_stable_internal_entry_point():
    module = importlib.import_module("pdf_engine.editors.non_lc")
    function = module.edit_non_lc_pdf

    assert tuple(inspect.signature(function).parameters) == (
        "input_path",
        "output_path",
        "records",
        "site",
        "template_kind",
    )
    assert get_type_hints(function) == {
        "input_path": Path,
        "output_path": Path,
        "records": Sequence[CableRecordPayload],
        "site": str | None,
        "template_kind": Literal["cat5e", "mpo"],
        "return": PdfEditResult,
    }


@pytest.mark.parametrize(
    "module_name",
    ["pdf_engine.editors.cat5e", "pdf_engine.editors.mpo"],
)
def test_thin_non_lc_editors_only_import_shared_non_lc_and_types(module_name):
    imports = _resolved_imports(module_name)
    pdf_engine_imports = {
        name for name in imports if name == "pdf_engine" or name.startswith("pdf_engine.")
    }

    assert pdf_engine_imports <= {
        "pdf_engine.editors.non_lc",
        "pdf_engine.types",
    }
    assert "pdf_engine.editors.cat5e" not in imports - {module_name}
    assert "pdf_engine.editors.mpo" not in imports - {module_name}
    assert "pdf_editor" not in imports


def test_dispatch_has_stable_public_entry_points():
    module = importlib.import_module("pdf_engine.dispatch")

    assert tuple(inspect.signature(module.detect_template_kind).parameters) == (
        "document",
    )
    assert get_type_hints(module.detect_template_kind) == {
        "document": fitz.Document,
        "return": TemplateKind,
    }
    assert tuple(inspect.signature(module.edit_report).parameters) == (
        "input_path",
        "output_path",
        "records",
        "site",
    )
    assert get_type_hints(module.edit_report) == {
        "input_path": Path,
        "output_path": Path,
        "records": Sequence[CableRecordPayload],
        "site": str | None,
        "return": PdfEditResult,
    }


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case.name)
def test_detect_template_kind_identifies_all_committed_templates(case):
    detect_template_kind = importlib.import_module(
        "pdf_engine.dispatch"
    ).detect_template_kind

    with fitz.open(ROOT / case.template) as document:
        detected = detect_template_kind(document)

    assert detected == case.kind
    assert detected in {"cat5e", "mpo", "lc"}


def test_cli_uses_dispatch_when_no_test_editor_is_injected(monkeypatch, tmp_path):
    cli = importlib.import_module("pdf_engine.cli")
    case = next(case for case in load_cases() if case.name == "cat5e-minimal")
    output = tmp_path / "report.pdf"
    calls = []

    def fake_edit_report(input_path, output_path, records, site):
        calls.append((input_path, output_path, records, site))
        document = fitz.open()
        document.new_page()
        document.save(output_path)
        document.close()
        return PdfEditResult(
            output=output_path,
            pages=1,
            records=len(records),
        )

    monkeypatch.setattr(cli, "edit_report", fake_edit_report, raising=False)
    stdout = io.StringIO()
    stderr = io.StringIO()
    request = {"site": case.site, "records": [{"cable_label": "A-001"}]}

    exit_code = cli.run_editor_cli(
        [str(ROOT / case.template), str(output), json.dumps(request)],
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 0
    assert len(calls) == 1
    assert calls[0] == (
        ROOT / case.template,
        output,
        request["records"],
        case.site,
    )


def test_legacy_compatibility_module_has_no_secondary_editor_or_switch_body():
    module_path = ROOT / "scripts/pdf_editor.py"
    tree = ast.parse(
        module_path.read_text(encoding="utf-8"),
        filename=str(module_path),
    )
    function_names = {
        node.name for node in tree.body if isinstance(node, ast.FunctionDef)
    }

    assert function_names == {"modify_pdf_precise", "main"}


def test_legacy_compatibility_module_reexports_field_position_helper():
    compatibility = importlib.import_module("pdf_editor")
    layout = importlib.import_module("pdf_engine.layout")

    assert compatibility.get_field_positions is layout.get_field_positions


@pytest.mark.parametrize("template_kind", ["cat5e", "mpo", "lc"])
def test_dispatch_closes_detection_document_then_calls_exactly_one_editor(
    monkeypatch,
    tmp_path,
    template_kind,
):
    dispatch = importlib.import_module("pdf_engine.dispatch")
    case = next(case for case in load_cases() if case.kind == template_kind)
    detection_documents = []
    editor_calls = []

    def fake_detect(document):
        detection_documents.append(document)
        return template_kind

    def fake_editor(input_path, output_path, records, site):
        assert detection_documents[0].is_closed
        editor_calls.append((input_path, output_path, records, site))
        return PdfEditResult(
            output=output_path,
            pages=1,
            records=len(records),
        )

    monkeypatch.setattr(dispatch, "detect_template_kind", fake_detect)
    for kind in ("cat5e", "mpo", "lc"):
        monkeypatch.setitem(
            dispatch._EDITORS,
            kind,
            fake_editor if kind == template_kind else pytest.fail,
        )

    records = [{"cable_label": "A-001"}]
    output = tmp_path / f"{template_kind}.pdf"
    result = dispatch.edit_report(
        ROOT / case.template,
        output,
        records,
        case.site,
    )

    assert result == PdfEditResult(output=output, pages=1, records=1)
    assert len(detection_documents) == 1
    assert len(editor_calls) == 1
