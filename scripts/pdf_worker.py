#!/usr/bin/env python3
"""Shared PDF worker entry point for packaged desktop builds."""
import json
import os
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No worker mode specified"}))
        sys.exit(1)

    mode = sys.argv[1]
    worker_args = sys.argv[2:]
    sys.argv = [sys.argv[0], *worker_args]

    if mode in {"pdf_editor", "editor"}:
        import pdf_editor

        pdf_editor.main()
        return

    if mode in {"pdf_processor", "processor"}:
        import pdf_processor

        pdf_processor.main()
        return

    print(json.dumps({"error": f"Unknown worker mode: {mode}"}))
    sys.exit(1)


if __name__ == "__main__":
    main()
