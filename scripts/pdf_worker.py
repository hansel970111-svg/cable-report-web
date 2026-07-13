#!/usr/bin/env python3
"""Shared PDF worker entry point for packaged desktop builds."""
import os
import sys
import time


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from pdf_engine.cli import main as run_editor
from pdf_engine.protocol import emit_result


_E2E_HANG_MODE = "__cable_report_e2e_hang__"


def _hang_until_terminated():
    while True:
        time.sleep(60)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        emit_result(
            {"ok": False, "code": "PDF_WORKER_MODE_REQUIRED", "message": "工作模式不能为空"},
            sys.stdout,
        )
        return 2

    mode = args[0]
    worker_args = args[1:]

    if (
        mode == _E2E_HANG_MODE
        and os.environ.get("CABLE_DESKTOP_E2E") == "1"
        and os.environ.get("CABLE_DESKTOP_E2E_HANG_WORKER") == "1"
    ):
        _hang_until_terminated()
        return 0

    if mode in {"pdf_editor", "editor"}:
        return run_editor(worker_args)

    emit_result(
        {"ok": False, "code": "PDF_WORKER_MODE_INVALID", "message": "工作模式无效"},
        sys.stdout,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
