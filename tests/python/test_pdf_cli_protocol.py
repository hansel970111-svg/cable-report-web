from __future__ import annotations

from io import BytesIO, StringIO, TextIOWrapper
import json
from pathlib import Path
import subprocess
import sys
from typing import Any

import fitz
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.cli import run_editor_cli  # noqa: E402
from pdf_engine.protocol import emit_result  # noqa: E402


def _write_pdf(path: Path, pages: int = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    for _ in range(pages):
        document.new_page()
    document.save(path)
    document.close()


def _decode_single_result(raw: str) -> dict[str, Any]:
    assert raw.endswith("\n")
    assert "\r" not in raw
    assert raw.count("\n") == 1
    value = json.loads(raw)
    assert isinstance(value, dict)
    return value


def _run_cli(argv, editor):
    stdout = StringIO()
    stderr = StringIO()
    exit_code = run_editor_cli(argv, editor, stdout=stdout, stderr=stderr)
    return exit_code, _decode_single_result(stdout.getvalue()), stderr.getvalue()


def test_emit_result_writes_one_compact_utf8_json_line():
    stream = StringIO()

    emit_result(
        {"ok": False, "code": "PDF_RENDER_FAILED", "message": "报告生成失败"},
        stream,
    )

    assert stream.getvalue() == (
        '{"ok":false,"code":"PDF_RENDER_FAILED","message":"报告生成失败"}\n'
    )


def test_emit_result_forces_lf_on_reconfigurable_platform_streams():
    class ReconfigurableStream(StringIO):
        def __init__(self):
            super().__init__()
            self.reconfigure_calls = []

        def reconfigure(self, **options):
            self.reconfigure_calls.append(options)

    stream = ReconfigurableStream()

    emit_result(
        {"ok": False, "code": "PDF_RENDER_FAILED", "message": "报告生成失败"},
        stream,
    )

    assert stream.reconfigure_calls == [
        {"encoding": "utf-8", "errors": "backslashreplace", "newline": "\n"}
    ]
    assert stream.getvalue().endswith("\n")
    assert "\r" not in stream.getvalue()


def test_emit_result_reconfigures_a_non_utf8_platform_stream_to_utf8_and_lf():
    buffer = BytesIO()
    stream = TextIOWrapper(buffer, encoding="ascii", newline="\r\n")

    emit_result(
        {"ok": False, "code": "PDF_RENDER_FAILED", "message": "报告生成失败"},
        stream,
    )

    assert buffer.getvalue() == (
        '{"ok":false,"code":"PDF_RENDER_FAILED","message":"报告生成失败"}\n'
    ).encode("utf-8")


def test_run_editor_cli_reconfigures_sanitized_stderr_for_safe_unicode(tmp_path):
    output_path = tmp_path / "report.pdf"
    stderr_buffer = BytesIO()
    stderr = TextIOWrapper(stderr_buffer, encoding="ascii", newline="\r\n")
    stdout = StringIO()

    def editor(_input_path, actual_output_path, _modifications):
        print("site=SECRET-SITE", file=sys.stderr)
        _write_pdf(Path(actual_output_path))
        return {"success": True}

    exit_code = run_editor_cli(
        ["template.pdf", str(output_path), '{"site":"SECRET-SITE","records":[{}]}'],
        editor,
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 0
    assert _decode_single_result(stdout.getvalue())["ok"] is True
    assert stderr_buffer.getvalue().decode("utf-8") == "[PDF] 诊断信息已脱敏\n"


def test_run_editor_cli_emits_safe_basename_counts_pages_and_sanitizes_logs(tmp_path):
    output_path = tmp_path / "private-output" / "report.pdf"
    request = {
        "site": "SECRET-SITE",
        "records": [
            {
                "cable_label": "SECRET-CABLE",
                "date_time": "15-05-2026 09:00:00 AM",
            },
            {"cable_label": "SECOND-SECRET-CABLE"},
        ],
    }

    def editor(input_path, actual_output_path, modifications):
        print("legacy debug moved to stderr")
        print(
            f"input={input_path} output={actual_output_path} record={modifications['records'][0]}",
            file=sys.stderr,
        )
        _write_pdf(Path(actual_output_path), pages=2)
        return {"success": True, "output_path": "../must-not-be-exposed.pdf"}

    exit_code, result, stderr = _run_cli(
        [str(tmp_path / "template.pdf"), str(output_path), json.dumps(request)],
        editor,
    )

    assert exit_code == 0
    assert result == {
        "ok": True,
        "output": "report.pdf",
        "pages": 2,
        "records": 2,
    }
    assert "legacy debug moved to stderr" in stderr
    assert "SECRET-SITE" not in stderr
    assert "SECRET-CABLE" not in stderr
    assert "SECOND-SECRET-CABLE" not in stderr
    assert "15-05-2026 09:00:00 AM" not in stderr
    assert str(tmp_path) not in stderr


@pytest.mark.parametrize("argv", [[], ["in.pdf"], ["in.pdf", "out.pdf"], ["a", "b", "c", "d"]])
def test_run_editor_cli_rejects_any_argument_count_other_than_three(argv):
    called = False

    def editor(*_args):
        nonlocal called
        called = True

    exit_code, result, _stderr = _run_cli(argv, editor)

    assert exit_code == 2
    assert result == {
        "ok": False,
        "code": "PDF_ARGUMENTS_INVALID",
        "message": "参数数量无效",
    }
    assert called is False


@pytest.mark.parametrize(
    ("request_text", "expected_code", "expected_message"),
    [
        ("not-json", "PDF_REQUEST_INVALID", "请求数据无效"),
        ("[]", "PDF_REQUEST_INVALID", "请求数据无效"),
        ("{}", "PDF_RECORDS_REQUIRED", "测试记录不能为空"),
        ('{"records":null}', "PDF_RECORDS_REQUIRED", "测试记录不能为空"),
        ('{"records":[]}', "PDF_RECORDS_REQUIRED", "测试记录不能为空"),
    ],
)
def test_run_editor_cli_rejects_invalid_requests_without_calling_editor(
    request_text, expected_code, expected_message
):
    called = False

    def editor(*_args):
        nonlocal called
        called = True

    exit_code, result, _stderr = _run_cli(["in.pdf", "out.pdf", request_text], editor)

    assert exit_code == 2
    assert result == {
        "ok": False,
        "code": expected_code,
        "message": expected_message,
    }
    assert called is False


def test_run_editor_cli_reads_request_object_from_a_json_file(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text('{"records":[{"id":"one"}]}', encoding="utf-8")
    output_path = tmp_path / "report.pdf"

    def editor(_input_path, actual_output_path, modifications):
        assert modifications == {"records": [{"id": "one"}]}
        _write_pdf(Path(actual_output_path))
        return {"success": True}

    exit_code, result, _stderr = _run_cli(
        ["template.pdf", str(output_path), str(request_path)],
        editor,
    )

    assert exit_code == 0
    assert result == {
        "ok": True,
        "output": "report.pdf",
        "pages": 1,
        "records": 1,
    }


@pytest.mark.parametrize("output_name", ["report.txt", ".pdf", "trailing-directory/"])
def test_run_editor_cli_rejects_an_unsafe_output_basename(output_name):
    exit_code, result, _stderr = _run_cli(
        ["in.pdf", output_name, '{"records":[{}]}'],
        lambda *_args: pytest.fail("editor must not run"),
    )

    assert exit_code == 2
    assert result == {
        "ok": False,
        "code": "PDF_OUTPUT_NAME_INVALID",
        "message": "输出文件名无效",
    }


def test_run_editor_cli_converts_editor_exceptions_to_a_stable_safe_failure(tmp_path):
    secret = "SECRET-EXCEPTION"

    def editor(*_args):
        raise RuntimeError(f"{secret}: {tmp_path}")

    exit_code, result, stderr = _run_cli(
        ["in.pdf", str(tmp_path / "report.pdf"), '{"records":[{}]}'],
        editor,
    )

    assert exit_code == 3
    assert result == {
        "ok": False,
        "code": "PDF_RENDER_FAILED",
        "message": "报告生成失败",
    }
    assert secret not in stderr
    assert str(tmp_path) not in stderr


@pytest.mark.parametrize(
    "editor_result",
    [
        {"error": "SECRET internal failure"},
        {"success": False, "error": "SECRET internal failure"},
    ],
)
def test_run_editor_cli_treats_an_editor_error_result_as_render_failure(
    editor_result, tmp_path
):
    exit_code, result, _stderr = _run_cli(
        ["in.pdf", str(tmp_path / "report.pdf"), '{"records":[{}]}'],
        lambda *_args: editor_result,
    )

    assert exit_code == 3
    assert result == {
        "ok": False,
        "code": "PDF_RENDER_FAILED",
        "message": "报告生成失败",
    }


def test_run_editor_cli_rejects_a_missing_output_pdf(tmp_path):
    exit_code, result, _stderr = _run_cli(
        ["in.pdf", str(tmp_path / "report.pdf"), '{"records":[{}]}'],
        lambda *_args: {"success": True},
    )

    assert exit_code == 4
    assert result == {
        "ok": False,
        "code": "PDF_OUTPUT_MISSING",
        "message": "报告文件未生成",
    }


def test_run_editor_cli_rejects_an_unreadable_output_pdf(tmp_path):
    output_path = tmp_path / "report.pdf"

    def editor(*_args):
        output_path.write_text("not a PDF", encoding="utf-8")
        return {"success": True}

    exit_code, result, _stderr = _run_cli(
        ["in.pdf", str(output_path), '{"records":[{}]}'],
        editor,
    )

    assert exit_code == 5
    assert result == {
        "ok": False,
        "code": "PDF_OUTPUT_INVALID",
        "message": "报告文件无效",
    }


@pytest.mark.parametrize(
    "entrypoint",
    [
        [str(ROOT / "scripts/pdf_editor.py")],
        [str(ROOT / "scripts/pdf_worker.py"), "editor"],
        [str(ROOT / "scripts/pdf_worker.py"), "pdf_editor"],
    ],
    ids=["compatibility-entry", "shared-worker-editor", "shared-worker-pdf-editor"],
)
def test_real_editor_entrypoints_emit_one_safe_result_line(entrypoint, tmp_path):
    template = ROOT / "assets/M138-DE46-OOB-Cat5e.pdf"
    output_path = tmp_path / "report.pdf"
    request_path = tmp_path / "request.json"
    request_path.write_text(
        json.dumps(
            {
                "site": "SECRET-SITE",
                "records": [
                    {
                        "id": "one",
                        "cable_label": "SECRET-CABLE",
                        "cable_number": "SECRET-CABLE",
                        "limit": "TIA - Cat 5e Channel",
                        "result": "PASS",
                        "length": 20.0,
                        "next_margin": 10.0,
                        "date_time": "15-05-2026 09:00:00 AM",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    completed = subprocess.run(
        [
            sys.executable,
            *entrypoint,
            str(template),
            str(output_path),
            str(request_path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert _decode_single_result(completed.stdout) == {
        "ok": True,
        "output": "report.pdf",
        "pages": 1,
        "records": 1,
    }
    assert "SECRET-SITE" not in completed.stderr
    assert "SECRET-CABLE" not in completed.stderr
    assert "15-05-2026 09:00:00 AM" not in completed.stderr
    assert str(tmp_path) not in completed.stderr


@pytest.mark.parametrize(
    "entrypoint",
    [
        [str(ROOT / "scripts/pdf_editor.py")],
        [str(ROOT / "scripts/pdf_worker.py"), "editor"],
        [str(ROOT / "scripts/pdf_worker.py"), "pdf_editor"],
    ],
    ids=["compatibility-entry", "shared-worker-editor", "shared-worker-pdf-editor"],
)
def test_real_editor_entrypoints_propagate_a_stable_failure_exit(entrypoint, tmp_path):
    completed = subprocess.run(
        [
            sys.executable,
            *entrypoint,
            "template.pdf",
            str(tmp_path / "report.pdf"),
            "not-json",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 2
    assert _decode_single_result(completed.stdout) == {
        "ok": False,
        "code": "PDF_REQUEST_INVALID",
        "message": "请求数据无效",
    }
    assert str(tmp_path) not in completed.stderr
