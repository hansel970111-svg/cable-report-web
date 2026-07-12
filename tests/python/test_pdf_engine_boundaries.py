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

EXPECTED_PARAMETERS = {
    "pdf_engine.resources": {
        "resource_path": ("parts",),
        "first_existing_path": ("paths",),
    },
    "pdf_engine.cid": {
        "site_text_to_cid": ("text",),
        "text_to_cid_hex": ("text",),
        "time_to_cid_hex": ("text",),
        "date_to_cid_hex": ("date_str",),
        "text_to_limit_cid": ("text", "template_type"),
        "cable_label_to_cid": ("text",),
    },
    "pdf_engine.layout": {
        "save_pdf_compact": ("doc", "output_path"),
        "insert_text_with_font": (
            "page",
            "point",
            "text",
            "fontname",
            "fontsize",
            "color",
            "clip",
        ),
        "get_field_positions": ("page",),
        "clear_row_images": (
            "page",
            "start_row",
            "end_row",
            "is_mpo_template",
        ),
    },
    "pdf_engine.summary": {
        "draw_lc_summary_boxes": (
            "page",
            "top_y",
            "site",
            "pass_count",
            "fail_count",
            "total_length_str",
        ),
        "draw_non_lc_summary_boxes": (
            "page",
            "top_y",
            "site",
            "pass_count",
            "fail_count",
            "total_length_str",
            "is_mpo_template",
        ),
        "draw_final_footer": ("page", "footer_template_page"),
    },
}

FORBIDDEN_IMPORTS = {
    "pdf_engine.editors",
    "pdf_engine.dispatch",
    "pdf_editor",
    "next",
    "electron",
}


@pytest.mark.parametrize(("module_name", "function_names"), EXPECTED.items())
def test_public_functions_have_stable_signatures(module_name, function_names):
    module = importlib.import_module(module_name)

    for function_name in function_names:
        function = getattr(module, function_name)
        assert callable(function)
        assert tuple(inspect.signature(function).parameters) == EXPECTED_PARAMETERS[
            module_name
        ][function_name]


@pytest.mark.parametrize("module_name", EXPECTED)
def test_shared_modules_only_import_inward(module_name):
    module = importlib.import_module(module_name)
    module_path = Path(inspect.getfile(module))
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    imported_modules = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_modules.update(alias.name.lower() for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_modules.add(node.module.lower())

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
