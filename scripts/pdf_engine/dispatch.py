"""Detect a report template and dispatch to its one explicit editor."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Sequence

import fitz

from .editors.cat5e import edit_cat5e_pdf
from .editors.lc import edit_lc_pdf
from .editors.mpo import edit_mpo_pdf
from .types import CableRecordPayload, PdfEditResult, TemplateKind


_ReportEditor = Callable[
    [Path, Path, Sequence[CableRecordPayload], str | None],
    PdfEditResult,
]


def detect_template_kind(document: fitz.Document) -> TemplateKind:
    """Return the exact report kind from stable first-page header positions."""
    if len(document) == 0:
        return "cat5e"

    spans = []
    for block in document[0].get_text("dict").get("blocks", []):
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append({
                        "text": text,
                        "x": span["bbox"][0],
                    })

    factory_xs = [span["x"] for span in spans if span["text"] == "Factory"]
    if any(250 <= x <= 320 for x in factory_xs):
        return "lc"

    if any(
        "GBASE" in span["text"] and span["x"] < 170
        for span in spans
    ):
        return "mpo"

    limit_xs = [span["x"] for span in spans if span["text"] == "Limit"]
    if any(x < 150 for x in limit_xs) and not factory_xs:
        return "mpo"

    return "cat5e"


_EDITORS: dict[TemplateKind, _ReportEditor] = {
    "cat5e": edit_cat5e_pdf,
    "mpo": edit_mpo_pdf,
    "lc": edit_lc_pdf,
}


def edit_report(
    input_path: Path,
    output_path: Path,
    records: Sequence[CableRecordPayload],
    site: str | None,
) -> PdfEditResult:
    """Detect the template once, close it, then invoke exactly one editor."""
    input_path = Path(input_path)
    output_path = Path(output_path)
    with fitz.open(input_path) as document:
        template_kind = detect_template_kind(document)

    editor = _EDITORS[template_kind]
    return editor(input_path, output_path, records, site)
