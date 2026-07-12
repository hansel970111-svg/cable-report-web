"""MPO template PDF editor."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from .non_lc import edit_non_lc_pdf
from ..types import CableRecordPayload, PdfEditResult


def edit_mpo_pdf(
    input_path: Path,
    output_path: Path,
    records: Sequence[CableRecordPayload],
    site: str | None,
) -> PdfEditResult:
    """Fill an MPO template and return the stable engine result contract."""
    return edit_non_lc_pdf(
        input_path,
        output_path,
        records,
        site,
        template_kind="mpo",
    )
