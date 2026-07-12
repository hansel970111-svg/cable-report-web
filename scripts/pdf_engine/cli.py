"""Strict PDF editor CLI boundary."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import re
from typing import Any, TextIO, TypeAlias

import fitz

from .dispatch import edit_report
from .protocol import PdfWorkerFailure, PdfWorkerSuccess, emit_result
from .types import PdfEditResult


EditorCallable: TypeAlias = Callable[[str, str, dict[str, Any]], Mapping[str, Any] | None]

_PDF_BASENAME = re.compile(r"^[^/\\]+\.pdf$", re.IGNORECASE)
_DATE_TIME = re.compile(
    r"\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}"
    r"(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?)?\b",
    re.IGNORECASE,
)
_TIME = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b", re.IGNORECASE)
_WINDOWS_ABSOLUTE_PATH = re.compile(r"(?<!\w)[A-Za-z]:[\\/][^\s'\"]+")
_POSIX_ABSOLUTE_PATH = re.compile(r"(?<![\w.])/(?:[^\s'\"]+/?)+")
_SENSITIVE_LOG_FIELD = re.compile(
    r"\b(?:site|records?|cable(?:_label|_number)?|date(?:_time)?|time)\b",
    re.IGNORECASE,
)


def _collect_sensitive_values(value: object, target: set[str]) -> None:
    if isinstance(value, str):
        if value:
            target.add(value)
        return
    if isinstance(value, Mapping):
        for nested in value.values():
            _collect_sensitive_values(nested, target)
        return
    if isinstance(value, (list, tuple)):
        for nested in value:
            _collect_sensitive_values(nested, target)


class _SanitizedLogStream(io.TextIOBase):
    """Line-buffered proxy that keeps diagnostics off stdout and removes payload data."""

    def __init__(self, target: TextIO, sensitive_values: set[str]):
        super().__init__()
        reconfigure = getattr(target, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(
                    encoding="utf-8",
                    errors="backslashreplace",
                    newline="\n",
                )
            except (AttributeError, LookupError, TypeError, ValueError):
                pass
        self._target = target
        self._buffer = ""
        self._sensitive_values = sorted(sensitive_values, key=len, reverse=True)

    @property
    def encoding(self) -> str | None:
        return getattr(self._target, "encoding", None)

    def writable(self) -> bool:
        return True

    def write(self, value: str) -> int:
        if not isinstance(value, str):
            raise TypeError("log output must be text")
        self._buffer += value
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._target.write(self._sanitize(line) + "\n")
        return len(value)

    def flush(self) -> None:
        if self._buffer:
            self._target.write(self._sanitize(self._buffer))
            self._buffer = ""
        self._target.flush()

    def _sanitize(self, line: str) -> str:
        sanitized = line
        for sensitive in self._sensitive_values:
            sanitized = sanitized.replace(sensitive, "[REDACTED]")
        sanitized = _WINDOWS_ABSOLUTE_PATH.sub("[PATH]", sanitized)
        sanitized = _POSIX_ABSOLUTE_PATH.sub("[PATH]", sanitized)
        sanitized = _DATE_TIME.sub("[DATE_TIME]", sanitized)
        sanitized = _TIME.sub("[TIME]", sanitized)
        if _SENSITIVE_LOG_FIELD.search(sanitized):
            return "[PDF] 诊断信息已脱敏"
        return sanitized


def _load_request(argument: str) -> object:
    try:
        return json.loads(argument)
    except json.JSONDecodeError:
        try:
            return json.loads(Path(argument).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            raise ValueError("invalid request") from None


def _output_basename(output_path: str) -> str | None:
    normalized = output_path.replace("\\", "/")
    basename = normalized.rsplit("/", 1)[-1]
    if _PDF_BASENAME.fullmatch(basename) is None:
        return None
    return basename


def _emit_failure(
    stdout: TextIO,
    *,
    code: str,
    message: str,
    exit_code: int,
) -> int:
    result: PdfWorkerFailure = {"ok": False, "code": code, "message": message}
    emit_result(result, stdout)
    return exit_code


def run_editor_cli(
    argv: Sequence[str],
    editor: EditorCallable | None = None,
    *,
    stdout: TextIO,
    stderr: TextIO,
) -> int:
    """Validate one editor request, invoke it, and emit one terminal result line."""
    if len(argv) != 3:
        return _emit_failure(
            stdout,
            code="PDF_ARGUMENTS_INVALID",
            message="参数数量无效",
            exit_code=2,
        )

    input_path, output_path, request_argument = argv
    output_name = _output_basename(output_path)
    if output_name is None:
        return _emit_failure(
            stdout,
            code="PDF_OUTPUT_NAME_INVALID",
            message="输出文件名无效",
            exit_code=2,
        )

    try:
        request = _load_request(request_argument)
    except ValueError:
        return _emit_failure(
            stdout,
            code="PDF_REQUEST_INVALID",
            message="请求数据无效",
            exit_code=2,
        )

    if not isinstance(request, dict):
        return _emit_failure(
            stdout,
            code="PDF_REQUEST_INVALID",
            message="请求数据无效",
            exit_code=2,
        )

    records = request.get("records")
    if not isinstance(records, list) or not records:
        return _emit_failure(
            stdout,
            code="PDF_RECORDS_REQUIRED",
            message="测试记录不能为空",
            exit_code=2,
        )

    sensitive_values = {input_path, output_path, request_argument}
    _collect_sensitive_values(request, sensitive_values)
    sanitized_logs = _SanitizedLogStream(stderr, sensitive_values)

    try:
        with redirect_stdout(sanitized_logs), redirect_stderr(sanitized_logs):
            if editor is None:
                editor_result = edit_report(
                    Path(input_path),
                    Path(output_path),
                    records,
                    request.get("site"),
                )
            else:
                editor_result = editor(input_path, output_path, request)
    except Exception:
        editor_result = None
    finally:
        sanitized_logs.flush()

    edit_succeeded = isinstance(editor_result, PdfEditResult) or (
        isinstance(editor_result, Mapping)
        and editor_result.get("success") is True
    )
    if not edit_succeeded:
        return _emit_failure(
            stdout,
            code="PDF_RENDER_FAILED",
            message="报告生成失败",
            exit_code=3,
        )

    if not os.path.isfile(output_path):
        return _emit_failure(
            stdout,
            code="PDF_OUTPUT_MISSING",
            message="报告文件未生成",
            exit_code=4,
        )

    try:
        with redirect_stdout(sanitized_logs), redirect_stderr(sanitized_logs):
            with fitz.open(output_path) as document:
                pages = document.page_count
                if pages <= 0:
                    raise ValueError("empty PDF")
    except Exception:
        return _emit_failure(
            stdout,
            code="PDF_OUTPUT_INVALID",
            message="报告文件无效",
            exit_code=5,
        )
    finally:
        sanitized_logs.flush()

    result: PdfWorkerSuccess = {
        "ok": True,
        "output": output_name,
        "pages": pages,
        "records": len(records),
    }
    emit_result(result, stdout)
    return 0
