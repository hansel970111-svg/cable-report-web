"""Shared type contracts for PDF editing."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping


TemplateKind = Literal["cat5e", "mpo", "lc"]
CableRecordPayload = Mapping[str, object]


@dataclass(frozen=True)
class PdfEditResult:
    output: Path
    pages: int
    records: int
