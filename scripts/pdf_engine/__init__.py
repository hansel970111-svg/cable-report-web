"""Shared PDF worker protocol and command-line helpers."""

from .cli import EditorCallable, run_editor_cli
from .protocol import PdfWorkerFailure, PdfWorkerResult, PdfWorkerSuccess, emit_result

__all__ = [
    "EditorCallable",
    "PdfWorkerFailure",
    "PdfWorkerResult",
    "PdfWorkerSuccess",
    "emit_result",
    "run_editor_cli",
]
