#!/usr/bin/env python3
"""Shared PDF worker entry point for packaged desktop builds."""
import os
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from pdf_engine.cli import run_editor_cli
from pdf_engine.protocol import emit_result


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

    if mode in {"pdf_editor", "editor"}:
        try:
            import pdf_editor
        except Exception:
            emit_result(
                {"ok": False, "code": "PDF_RENDER_FAILED", "message": "报告生成失败"},
                sys.stdout,
            )
            return 3

        return run_editor_cli(
            worker_args,
            pdf_editor.modify_pdf_precise,
            stdout=sys.stdout,
            stderr=sys.stderr,
        )

    if mode in {"pdf_processor", "processor"}:
        import pdf_processor

        sys.argv = [sys.argv[0], *worker_args]
        result = pdf_processor.main()
        return result if isinstance(result, int) else 0

    emit_result(
        {"ok": False, "code": "PDF_WORKER_MODE_INVALID", "message": "工作模式无效"},
        sys.stdout,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
