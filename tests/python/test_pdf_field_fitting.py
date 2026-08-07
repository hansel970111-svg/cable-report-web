from pathlib import Path
import re
import sys

import fitz
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.dispatch import edit_report  # noqa: E402


BOUNDARY_LABEL = "#" + "W" * 12
BOUNDARY_SITE = "W" * 18
MIN_READABLE_SIZE = 4.5


def _text_spans(page):
    return [
        span
        for block in page.get_text("dict").get("blocks", [])
        for line in block.get("lines", [])
        for span in line.get("spans", [])
        if str(span.get("text", "")).strip()
    ]


@pytest.mark.parametrize(
    ("kind", "template", "limit", "label_right", "limit_right"),
    [
        ("cat5e", "assets/M138-DE46-OOB-Cat5e.pdf", "TIA - Cat 5e Channel", 190.0, 270.0),
        ("mpo", "assets/M138-DE46-P-A-MPO.pdf", "200GBASE-SR10", 92.0, 170.0),
        ("lc", "assets/M138-DE46-D-P-cross-LC.pdf", "Link Validation", 84.0, 155.0),
    ],
)
def test_boundary_fields_fit_their_real_columns_and_remove_template_payload(
    kind,
    template,
    limit,
    label_right,
    limit_right,
    tmp_path,
):
    output = tmp_path / f"{kind}-field-boundary.pdf"
    record = {
        "id": "boundary-1",
        "cable_label": BOUNDARY_LABEL,
        "cable_number": BOUNDARY_LABEL.removeprefix("#"),
        "limit": limit,
        "result": "PASS",
        "length": 99999.9,
        "next_margin": -99.9,
        "date_time": "15-05-2026 09:00:00 AM",
    }

    result = edit_report(ROOT / template, output, [record], BOUNDARY_SITE)
    assert result.pages == 1
    assert result.records == 1

    with fitz.open(output) as document:
        assert document.page_count == 1
        assert document.is_repaired is False
        page = document[0]
        spans = _text_spans(page)
        text = page.get_text("text")

        label_spans = [span for span in spans if span["text"] == BOUNDARY_LABEL]
        assert len(label_spans) == 1
        assert label_spans[0]["bbox"][2] <= label_right + 0.25
        assert MIN_READABLE_SIZE <= label_spans[0]["size"] <= 8.0

        limit_spans = [span for span in spans if span["text"] == limit]
        assert len(limit_spans) == 1
        assert limit_spans[0]["bbox"][2] <= limit_right + 0.25
        assert MIN_READABLE_SIZE <= limit_spans[0]["size"] <= 8.0

        site_header = [
            span for span in spans
            if span["text"] == f"Site: {BOUNDARY_SITE}"
        ]
        assert len(site_header) == 1
        assert site_header[0]["bbox"][2] <= 210.0
        assert MIN_READABLE_SIZE <= site_header[0]["size"] <= 8.0

        site_summary = [
            span for span in spans
            if span["text"] == f"Total for Site: {BOUNDARY_SITE}"
        ]
        assert len(site_summary) == 1
        assert site_summary[0]["bbox"][2] <= 210.0
        assert MIN_READABLE_SIZE <= site_summary[0]["size"] <= 8.0

        # A new Site must replace the template Site in both header and summary.
        assert "M138-DE46" not in text
        assert text.count("Total for Site:") == 1
        assert text.count("Total for Selected Reports") == 1
        assert text.count("Signature:______________________") == 1
        assert len(re.findall(r"Printed: \d{4}/\d{1,2}/\d{1,2} \d{2}:\d{2}:\d{2}", text)) == 1

        # Rendering the extreme page is part of the regression: geometry-only
        # success must not hide a damaged or blank PDF page.
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csRGB, alpha=False)
        assert (pixmap.width, pixmap.height, pixmap.n) == (1190, 1684, 3)
        assert min(pixmap.samples) < 64
