from __future__ import annotations

import ast
import importlib
import inspect
import sys
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))


EXPECTED = {
    "pdf_engine.resources": ["resource_path", "first_existing_path"],
    "pdf_engine.cid": [
        "site_text_to_cid",
        "text_to_cid_hex",
        "time_to_cid_hex",
        "date_to_cid_hex",
        "text_to_limit_cid",
        "cable_label_to_cid",
    ],
    "pdf_engine.layout": [
        "save_pdf_compact",
        "insert_text_with_font",
        "get_field_positions",
        "clear_row_images",
    ],
    "pdf_engine.summary": [
        "draw_lc_summary_boxes",
        "draw_non_lc_summary_boxes",
        "draw_final_footer",
    ],
}

EMPTY = inspect.Signature.empty
POSITIONAL = inspect.Parameter.POSITIONAL_OR_KEYWORD
VAR_POSITIONAL = inspect.Parameter.VAR_POSITIONAL


def _parameter(name, kind=POSITIONAL, default=EMPTY, annotation=EMPTY):
    return inspect.Parameter(
        name,
        kind,
        default=default,
        annotation=annotation,
    )


def _signature(*parameters, return_annotation=EMPTY):
    return inspect.Signature(parameters, return_annotation=return_annotation)


EXPECTED_SIGNATURES = {
    "pdf_engine.resources": {
        "resource_path": _signature(_parameter("parts", VAR_POSITIONAL)),
        "first_existing_path": _signature(_parameter("paths", VAR_POSITIONAL)),
    },
    "pdf_engine.cid": {
        "site_text_to_cid": _signature(_parameter("text")),
        "text_to_cid_hex": _signature(_parameter("text")),
        "time_to_cid_hex": _signature(_parameter("text")),
        "date_to_cid_hex": _signature(_parameter("date_str")),
        "text_to_limit_cid": _signature(
            _parameter("text"),
            _parameter("template_type", default="mpo"),
        ),
        "cable_label_to_cid": _signature(_parameter("text")),
    },
    "pdf_engine.layout": {
        "save_pdf_compact": _signature(
            _parameter("doc"),
            _parameter("output_path"),
        ),
        "insert_text_with_font": _signature(
            _parameter("page"),
            _parameter("point"),
            _parameter("text"),
            _parameter("fontname", default="helv"),
            _parameter("fontsize", default=8.0),
            _parameter("color", default=(0, 0, 0)),
            _parameter("clip", default=None),
        ),
        "get_field_positions": _signature(_parameter("page")),
        "clear_row_images": _signature(
            _parameter("page"),
            _parameter("start_row"),
            _parameter("end_row"),
            _parameter("is_mpo_template", default=False),
        ),
    },
    "pdf_engine.summary": {
        "draw_lc_summary_boxes": _signature(
            _parameter("page"),
            _parameter("top_y"),
            _parameter("site"),
            _parameter("pass_count"),
            _parameter("fail_count"),
            _parameter("total_length_str"),
        ),
        "draw_non_lc_summary_boxes": _signature(
            _parameter("page"),
            _parameter("top_y"),
            _parameter("site"),
            _parameter("pass_count"),
            _parameter("fail_count"),
            _parameter("total_length_str"),
            _parameter("is_mpo_template"),
        ),
        "draw_final_footer": _signature(
            _parameter("page"),
            _parameter("footer_template_page"),
        ),
    },
}

ALLOWED_PDF_ENGINE_IMPORTS = {
    "pdf_engine.resources": set(),
    "pdf_engine.cid": {"pdf_engine.resources"},
    "pdf_engine.layout": {"pdf_engine.cid", "pdf_engine.resources"},
    "pdf_engine.summary": {
        "pdf_engine.cid",
        "pdf_engine.layout",
        "pdf_engine.resources",
    },
}

FORBIDDEN_IMPORTS = {
    "pdf_engine.editors",
    "pdf_engine.dispatch",
    "pdf_editor",
    "next",
    "electron",
}


def _assert_signature_contract(function, expected_signature):
    actual_signature = inspect.signature(function)
    actual_parameters = tuple(actual_signature.parameters.values())
    expected_parameters = tuple(expected_signature.parameters.values())

    assert len(actual_parameters) == len(expected_parameters)
    for actual, expected in zip(actual_parameters, expected_parameters):
        assert actual.name == expected.name
        assert actual.kind == expected.kind
        assert actual.default == expected.default
        assert actual.annotation == expected.annotation
    assert actual_signature.return_annotation == expected_signature.return_annotation


def _resolved_imports(tree, module_name):
    package = module_name.rpartition(".")[0]
    imported_modules = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_modules.update(alias.name.lower() for alias in node.names)
            continue
        if not isinstance(node, ast.ImportFrom):
            continue

        if node.level:
            relative_name = "." * node.level + (node.module or "")
            try:
                imported_from = importlib.util.resolve_name(relative_name, package)
            except ImportError:
                imported_modules.add("invalid-relative-import")
                continue
        else:
            imported_from = node.module or ""

        imported_from = imported_from.lower()
        if imported_from == "pdf_engine":
            imported_names = {
                f"pdf_engine.{alias.name.lower()}"
                for alias in node.names
                if alias.name != "*"
            }
            imported_modules.update(imported_names or {"pdf_engine"})
        elif imported_from:
            imported_modules.add(imported_from)

    return imported_modules


def _pdf_engine_imports(tree, module_name):
    return {
        imported
        for imported in _resolved_imports(tree, module_name)
        if imported == "pdf_engine" or imported.startswith("pdf_engine.")
    }


def _assert_allowed_pdf_engine_imports(tree, module_name):
    resolved = _resolved_imports(tree, module_name)
    assert "invalid-relative-import" not in resolved
    actual = _pdf_engine_imports(tree, module_name)
    disallowed = actual - ALLOWED_PDF_ENGINE_IMPORTS[module_name]
    assert disallowed == set()


@pytest.mark.parametrize(("module_name", "function_names"), EXPECTED.items())
def test_public_functions_have_stable_signatures(module_name, function_names):
    module = importlib.import_module(module_name)

    for function_name in function_names:
        function = getattr(module, function_name)
        assert callable(function)
        _assert_signature_contract(
            function,
            EXPECTED_SIGNATURES[module_name][function_name],
        )


@pytest.mark.parametrize("module_name", EXPECTED)
def test_shared_modules_only_import_inward(module_name):
    module = importlib.import_module(module_name)
    module_path = Path(inspect.getfile(module))
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    imported_modules = _resolved_imports(tree, module_name)

    _assert_allowed_pdf_engine_imports(tree, module_name)

    forbidden = {
        imported
        for imported in imported_modules
        if any(
            imported == name or imported.startswith(f"{name}.")
            for name in FORBIDDEN_IMPORTS
        )
    }
    assert forbidden == set()


def test_shared_types_expose_immutable_edit_result():
    module = importlib.import_module("pdf_engine.types")
    output = Path("report.pdf")
    result = module.PdfEditResult(output=output, pages=2, records=48)

    assert result.output == output
    assert result.pages == 2
    assert result.records == 48
    with pytest.raises(FrozenInstanceError):
        result.pages = 3


def test_shared_types_keep_template_and_payload_contracts():
    module = importlib.import_module("pdf_engine.types")

    assert set(module.TemplateKind.__args__) == {"cat5e", "mpo", "lc"}
    assert module.CableRecordPayload.__origin__.__name__ == "Mapping"


def test_signature_guard_rejects_parameter_kind_mutation():
    def resource_path(parts):
        return parts

    assert tuple(inspect.signature(resource_path).parameters) == ("parts",)
    with pytest.raises(AssertionError):
        _assert_signature_contract(
            resource_path,
            EXPECTED_SIGNATURES["pdf_engine.resources"]["resource_path"],
        )


def test_signature_guard_rejects_default_mutation():
    def text_to_limit_cid(text, template_type="cat5e"):
        return text, template_type

    assert tuple(inspect.signature(text_to_limit_cid).parameters) == (
        "text",
        "template_type",
    )
    with pytest.raises(AssertionError):
        _assert_signature_contract(
            text_to_limit_cid,
            EXPECTED_SIGNATURES["pdf_engine.cid"]["text_to_limit_cid"],
        )


def test_signature_guard_rejects_parameter_annotation_mutation():
    def cable_label_to_cid(text: str):
        return text

    assert tuple(inspect.signature(cable_label_to_cid).parameters) == ("text",)
    with pytest.raises(AssertionError):
        _assert_signature_contract(
            cable_label_to_cid,
            EXPECTED_SIGNATURES["pdf_engine.cid"]["cable_label_to_cid"],
        )


def test_signature_guard_rejects_return_annotation_mutation():
    def cable_label_to_cid(text) -> str:
        return text

    actual = inspect.signature(cable_label_to_cid)
    expected = EXPECTED_SIGNATURES["pdf_engine.cid"]["cable_label_to_cid"]
    assert tuple(actual.parameters.values()) == tuple(expected.parameters.values())
    with pytest.raises(AssertionError):
        _assert_signature_contract(cable_label_to_cid, expected)


@pytest.mark.parametrize(
    ("module_name", "source", "illegal_dependency"),
    [
        ("pdf_engine.resources", "from . import cid", "pdf_engine.cid"),
        ("pdf_engine.cid", "from . import layout", "pdf_engine.layout"),
        ("pdf_engine.layout", "from . import summary", "pdf_engine.summary"),
        ("pdf_engine.summary", "from . import editors", "pdf_engine.editors"),
    ],
)
def test_import_guard_resolves_and_rejects_relative_outward_edges(
    module_name,
    source,
    illegal_dependency,
):
    tree = ast.parse(source)

    assert _pdf_engine_imports(tree, module_name) == {illegal_dependency}
    with pytest.raises(AssertionError):
        _assert_allowed_pdf_engine_imports(tree, module_name)


def test_import_guard_rejects_relative_import_beyond_pdf_engine_package():
    tree = ast.parse("from .. import layout")

    with pytest.raises(AssertionError):
        _assert_allowed_pdf_engine_imports(tree, "pdf_engine.resources")


@pytest.mark.parametrize("source", ["import pdf_engine", "from pdf_engine import *"])
def test_import_guard_rejects_root_or_unknown_pdf_engine_dependency(source):
    tree = ast.parse(source)

    assert _pdf_engine_imports(tree, "pdf_engine.resources") == {"pdf_engine"}
    with pytest.raises(AssertionError):
        _assert_allowed_pdf_engine_imports(tree, "pdf_engine.resources")


@pytest.mark.parametrize(
    "source",
    [
        "from pdf_engine.layout import insert_text_with_font",
        "from .layout import insert_text_with_font",
    ],
)
def test_import_guard_keeps_legal_absolute_and_relative_inward_edges(source):
    tree = ast.parse(source)

    assert _pdf_engine_imports(tree, "pdf_engine.summary") == {
        "pdf_engine.layout"
    }
    _assert_allowed_pdf_engine_imports(tree, "pdf_engine.summary")
