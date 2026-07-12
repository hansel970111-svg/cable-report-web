from pathlib import Path
import sys

import fitz
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.dispatch import edit_report  # noqa: E402
from pdf_engine.resources import EMBED_INSERT_FONTS  # noqa: E402
from pdf_golden import (  # noqa: E402
    assert_pdf_matches_golden,
    build_records,
    load_cases,
)


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case.name)
def test_pdf_matches_approved_golden(case, tmp_path):
    assert EMBED_INSERT_FONTS is False
    output = tmp_path / f"{case.name}.pdf"
    records = build_records(case)
    result = edit_report(
        ROOT / case.template,
        output,
        records,
        case.site,
    )

    assert result.output == output
    assert result.pages == case.expected_pages
    assert result.records == len(records)
    with fitz.open(output) as document:
        assert document.page_count == case.expected_pages
        assert document.is_repaired is False
    with fitz.open(output) as reopened:
        assert reopened.page_count == case.expected_pages
        assert reopened.is_repaired is False
    assert_pdf_matches_golden(output, ROOT / "tests/python/golden" / case.name)
