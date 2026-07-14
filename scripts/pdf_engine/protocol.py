"""Typed, single-line result protocol shared by PDF worker entry points."""

from __future__ import annotations

import json
from typing import Literal, TextIO, TypedDict, TypeAlias


class PdfWorkerSuccess(TypedDict):
    ok: Literal[True]
    output: str
    pages: int
    records: int


class PdfWorkerFailure(TypedDict):
    ok: Literal[False]
    code: str
    message: str


PdfWorkerResult: TypeAlias = PdfWorkerSuccess | PdfWorkerFailure


def emit_result(result: PdfWorkerResult, stream: TextIO) -> None:
    """Write exactly one compact UTF-8 JSON object followed by one LF."""
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(
                encoding="utf-8",
                errors="backslashreplace",
                newline="\n",
            )
        except (AttributeError, LookupError, TypeError, ValueError):
            pass

    stream.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()
