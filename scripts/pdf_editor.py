#!/usr/bin/env python3
"""Compatibility entry point for the modular PDF engine."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

from pdf_engine.cli import run_editor_cli
from pdf_engine.dispatch import edit_report
from pdf_engine.editors.lc import edit_lc_pdf
from pdf_engine.layout import get_field_positions
from pdf_engine.resources import EMBED_INSERT_FONTS


def modify_pdf_precise(input_path: str, output_path: str, modifications: dict) -> dict:
    """Adapt the legacy request dictionary to the stable dispatch interface."""
    records = modifications.get("records", [])
    site = modifications.get("site")

    print(f"[PYTHON]  {len(records)} ", file=sys.stderr)
    if not records:
        return {"error": "No records provided"}

    try:
        result = edit_report(
            Path(input_path),
            Path(output_path),
            records,
            site,
        )
    except Exception:
        print("[ERROR] PDF rendering failed", file=sys.stderr)
        return {"error": "PDF rendering failed"}

    return {
        "success": True,
        "method": "template_dispatch",
        "records_processed": result.records,
        "pages_used": result.pages,
        "output_path": str(result.output),
    }


def main(argv=None):
    """Run the compatibility script through the dispatch-backed CLI."""
    editor_args = sys.argv[1:] if argv is None else argv
    return run_editor_cli(
        editor_args,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


if __name__ == "__main__":
    raise SystemExit(main())
