from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any, Literal

import fitz
from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[2]
CASES_PATH = ROOT / "tests/python/fixtures/pdf-cases.json"
GOLDEN_ROOT = ROOT / "tests/python/golden"

MANIFEST_SCHEMA_VERSION = 1
RENDERER_NAME = "PyMuPDF"
RENDERER_VERSION = "1.26.7"
RENDER_DPI = 144
RENDER_COLORSPACE = "RGB"
RENDER_ALPHA = False
PRINTED_PLACEHOLDER = "Printed: <TIMESTAMP>"
PRINTED_MASK_RECT = (53.0, 816.0, 151.0, 830.0)
PRINTED_GUARD_RECT = (50.0, 813.0, 155.0, 833.0)
PRINTED_PATTERN = re.compile(
    r"^Printed: \d{4}/(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12]\d|3[01]) "
    r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$"
)
SAFE_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")

APPROVED_CASE_NAMES = (
    "cat5e-minimal",
    "cat5e-cross-page",
    "mpo-minimal",
    "mpo-cross-page",
    "lc-minimal",
    "lc-cross-page",
)

_APPROVED_TEMPLATES = {
    "cat5e": Path("assets/M138-DE46-OOB-Cat5e.pdf"),
    "mpo": Path("assets/M138-DE46-P-A-MPO.pdf"),
    "lc": Path("assets/M138-DE46-D-P-cross-LC.pdf"),
}
_ROWS_PER_PAGE = {"cat5e": 46, "mpo": 48, "lc": 46}
_SUMMARY_ROWS_PER_PAGE = {"cat5e": 40, "mpo": 42, "lc": 22}
_RESULT_ICON_RECTS = {
    "cat5e": (271.000, 109.766, 283.000, 121.766),
    "mpo": (170.777, 88.000, 182.777, 100.000),
    "lc": (162.109, 109.766, 174.109, 121.766),
}
_RESULT_ROW_PITCH = 15.0
_EXPECTED_PAGE_RECT = fitz.Rect(0.0, 0.0, 595.0, 842.0)
_EXPECTED_RENDER_SIZE = (1190, 1684)
_ROW_VALUE_COLUMNS = {
    "cat5e": {"length": (290.0, 325.0), "margin": (330.0, 365.0)},
    "mpo": {"length": (190.0, 225.0), "margin": (230.0, 265.0)},
    "lc": {"length": (180.0, 215.0), "margin": (220.0, 255.0)},
}
_ROW_DATE_COLUMNS = {
    "cat5e": (425.0, 530.0),
    "mpo": (275.0, 375.0),
    "lc": (320.0, 420.0),
}
_ROW_LIMIT_COLUMNS = {
    "cat5e": (190.0, 270.0),
    "mpo": (90.0, 165.0),
    "lc": (85.0, 155.0),
}


@dataclass(frozen=True)
class GoldenCase:
    name: str
    kind: Literal["cat5e", "mpo", "lc"]
    template: Path
    site: str
    record_count: int
    expected_pages: int


@dataclass(frozen=True)
class _PdfSnapshot:
    page_count: int
    metadata: dict[str, object]
    normalized_text: list[str]
    printed_pages: list[int]
    printed_span_counts: list[int]
    images: list[Image.Image]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: object) -> bool:
    return (
        (isinstance(value, int) and not isinstance(value, bool))
        or (isinstance(value, float) and math.isfinite(value))
    )


def _strict_equal(actual: object, expected: object) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return set(actual) == set(expected) and all(
            _strict_equal(actual[key], expected[key]) for key in expected
        )
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(
            _strict_equal(actual_item, expected_item)
            for actual_item, expected_item in zip(actual, expected, strict=True)
        )
    return actual == expected


def _assert_exact_keys(value: object, expected: set[str], context: str) -> dict[str, Any]:
    _require(isinstance(value, dict), f"{context} must be an object")
    actual = set(value)
    _require(actual == expected, f"{context} keys invalid: expected {sorted(expected)}, got {sorted(actual)}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolved_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _lexically_inside(path: Path, parent: Path) -> bool:
    try:
        path.absolute().relative_to(parent.absolute())
        return True
    except ValueError:
        return False


def _overlay_tokens(words: list[tuple]) -> list[str]:
    accepted: list[tuple] = []
    for word in sorted(words, key=lambda item: (item[0], item[1])):
        duplicate = False
        for existing in accepted:
            if str(existing[4]) != str(word[4]):
                continue
            intersection_width = max(0.0, min(existing[2], word[2]) - max(existing[0], word[0]))
            intersection_height = max(0.0, min(existing[3], word[3]) - max(existing[1], word[1]))
            intersection_area = intersection_width * intersection_height
            existing_area = max(0.0, (existing[2] - existing[0]) * (existing[3] - existing[1]))
            word_area = max(0.0, (word[2] - word[0]) * (word[3] - word[1]))
            smaller_area = min(existing_area, word_area)
            if smaller_area > 0.0 and intersection_area / smaller_area >= 0.9:
                duplicate = True
                break
        if not duplicate:
            accepted.append(word)
    return [str(word[4]) for word in accepted]


def load_cases(path: Path = CASES_PATH) -> list[GoldenCase]:
    try:
        raw_cases = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AssertionError(f"approved case matrix cannot be loaded: {path}: {error}") from error

    _require(isinstance(raw_cases, list), "approved case matrix must be an array")
    _require(len(raw_cases) == 6, "approved case matrix must contain exactly six cases")
    cases: list[GoldenCase] = []
    expected_keys = {"name", "kind", "template", "site", "record_count", "expected_pages"}

    for index, raw_value in enumerate(raw_cases):
        raw = _assert_exact_keys(raw_value, expected_keys, f"case[{index}]")
        name = raw["name"]
        kind = raw["kind"]
        template_text = raw["template"]
        site = raw["site"]
        record_count = raw["record_count"]
        expected_pages = raw["expected_pages"]

        _require(isinstance(name, str) and SAFE_SLUG_PATTERN.fullmatch(name) is not None, f"case[{index}] name must be a safe slug")
        _require(kind in _APPROVED_TEMPLATES, f"case[{index}] kind is not approved")
        _require(isinstance(template_text, str), f"case[{index}] template must be a string")
        template = Path(template_text)
        _require(not template.is_absolute() and ".." not in template.parts, f"case[{index}] template traversal is forbidden")
        _require(template == _APPROVED_TEMPLATES[kind], f"case[{index}] template does not match kind")
        resolved_template = (ROOT / template).resolve()
        _require(_resolved_inside(resolved_template, ROOT / "assets"), f"case[{index}] template escapes assets")
        _require(resolved_template.is_file(), f"case[{index}] approved template missing: {resolved_template}")
        _require(site == "M138-DE46", f"case[{index}] site must be M138-DE46")
        _require(_is_int(record_count) and record_count in (2, 49), f"case[{index}] record_count must be 2 or 49")
        _require(_is_int(expected_pages) and expected_pages in (1, 2), f"case[{index}] expected_pages must be 1 or 2")
        expected_pair = (2, 1) if name.endswith("-minimal") else (49, 2)
        _require((record_count, expected_pages) == expected_pair, f"case[{index}] count/page pair is invalid")
        _require(name == f"{kind}-{'minimal' if record_count == 2 else 'cross-page'}", f"case[{index}] name/kind mismatch")

        cases.append(
            GoldenCase(
                name=name,
                kind=kind,
                template=template,
                site=site,
                record_count=record_count,
                expected_pages=expected_pages,
            )
        )

    names = tuple(case.name for case in cases)
    _require(names == APPROVED_CASE_NAMES, f"approved case matrix must be exactly {APPROVED_CASE_NAMES}")
    _require(len(set(names)) == len(names), "approved case names must be unique")
    return cases


def _date_time_for_index(index: int) -> str:
    total_minutes = 9 * 60 + index * 5
    hour_24, minute = divmod(total_minutes, 60)
    period = "AM" if hour_24 < 12 else "PM"
    hour_12 = hour_24 % 12 or 12
    return f"15-05-2026 {hour_12:02d}:{minute:02d}:00 {period}"


def build_records(case: GoldenCase) -> list[dict[str, object]]:
    prefixes = {"cat5e": "C", "mpo": "M", "lc": "L"}
    limits = {
        "cat5e": "TIA - Cat 5e Channel",
        "mpo": "200GBASE-SR10",
        "lc": "Link Validation",
    }
    prefix = prefixes[case.kind]

    records = []
    for index in range(case.record_count):
        record_number = index + 1
        cable_number = f"{prefix}{record_number:03d}"
        records.append(
            {
                "id": f"{case.name}-{record_number:03d}",
                "cable_label": f"#{cable_number}",
                "cable_number": cable_number,
                "limit": limits[case.kind],
                "result": "FAIL" if record_number == 2 or record_number % 10 == 0 else "PASS",
                "length": 20.0 + index * 0.5,
                "next_margin": 10.0 + (index % 10) * 0.2,
                "date_time": _date_time_for_index(index),
            }
        )
    return records


def _record_boundary(record: dict[str, object]) -> dict[str, object]:
    return {
        "cable_label": record["cable_label"],
        "limit": record["limit"],
        "length": record["length"],
        "next_margin": record["next_margin"],
        "date_time": record["date_time"],
    }


def _expected_page_boundaries(case: GoldenCase) -> list[dict[str, object]]:
    records = build_records(case)
    page_size = _ROWS_PER_PAGE[case.kind]
    boundaries = []
    for page_index, start in enumerate(range(0, len(records), page_size)):
        page_records = records[start : start + page_size]
        boundaries.append(
            {
                "page_index": page_index,
                "record_count": len(page_records),
                "first": _record_boundary(page_records[0]),
                "last": _record_boundary(page_records[-1]),
            }
        )
    return boundaries


def _format_visible_number(value: object, *, force_decimal: bool = False) -> str:
    number = float(value)
    if force_decimal:
        return f"{number:.1f}"
    return str(int(number)) if number.is_integer() else f"{number:.1f}"


def _expected_page_rows(case: GoldenCase) -> list[dict[str, object]]:
    records = build_records(case)
    page_size = _ROWS_PER_PAGE[case.kind]
    pages = []
    for page_index, start in enumerate(range(0, len(records), page_size)):
        rows = []
        for row_index, record in enumerate(records[start : start + page_size]):
            if case.kind == "mpo":
                visible_length = "-"
                visible_margin = "-"
            else:
                visible_length = _format_visible_number(record["length"])
                visible_margin = _format_visible_number(
                    record["next_margin"],
                    force_decimal=case.kind == "cat5e",
                )
            limit_tokens = str(record["limit"]).split()
            date, time, period = str(record["date_time"]).split()
            date_tokens = [date, time, period]
            if case.kind == "mpo" and start + row_index == 47:
                date_tokens = [date, f"{date}{date}", time, period]
            rows.append(
                {
                    "row_index": row_index,
                    "cable_label": record["cable_label"],
                    "limit": record["limit"],
                    "length": visible_length,
                    "margin": visible_margin,
                    "date_time": record["date_time"],
                    "date_tokens": date_tokens,
                    "limit_tokens": limit_tokens,
                    "result": record["result"],
                }
            )
        pages.append({"page_index": page_index, "rows": rows})
    return pages


def expected_semantics(case: GoldenCase) -> dict[str, object]:
    records = build_records(case)
    fail_count = sum(record["result"] == "FAIL" for record in records)
    input_total = sum(float(record["length"]) for record in records)
    input_total_text = str(int(input_total)) if input_total.is_integer() else f"{input_total:.1f}"
    return {
        "site": case.site,
        "record_count": case.record_count,
        "pass_count": case.record_count - fail_count,
        "fail_count": fail_count,
        "input_total_length": input_total_text,
        "summary_total_length": "0" if case.kind == "mpo" else input_total_text,
        "page_boundaries": _expected_page_boundaries(case),
        "pages": _expected_page_rows(case),
        "footer": "Signature:______________________",
    }


def expected_critical_rois(case: GoldenCase) -> list[dict[str, object]]:
    x0, y0, x1, y1 = _RESULT_ICON_RECTS[case.kind]
    rois = []
    for page_index in range(case.expected_pages):
        capacity = (
            _SUMMARY_ROWS_PER_PAGE[case.kind]
            if page_index == case.expected_pages - 1
            else _ROWS_PER_PAGE[case.kind]
        )
        rois.append(
            {
                "name": f"page-{page_index + 1}-result-column",
                "page_index": page_index,
                "rect": [x0, y0, x1, y1 + _RESULT_ROW_PITCH * (capacity - 1)],
            }
        )
    return rois


def _expected_printed_span_counts(case: GoldenCase) -> list[int]:
    return [0] * (case.expected_pages - 1) + [3 if case.kind == "lc" else 1]


def normalize_printed_text(text: str) -> str:
    normalized = []
    for line in text.splitlines():
        stripped = line.strip()
        normalized.append(PRINTED_PLACEHOLDER if PRINTED_PATTERN.fullmatch(stripped) else line.rstrip())
    return "\n".join(normalized)


def _normalize_metadata(metadata: dict[str, object]) -> dict[str, object]:
    normalized: dict[str, object] = {}
    for key in sorted(metadata):
        value = metadata[key]
        if key in {"creationDate", "modDate"}:
            normalized[key] = "<NORMALIZED>" if value else ""
        else:
            normalized[key] = value
    return normalized


def _rect_inside(inner: fitz.Rect, outer: fitz.Rect, tolerance: float = 0.25) -> bool:
    return (
        inner.x0 >= outer.x0 - tolerance
        and inner.y0 >= outer.y0 - tolerance
        and inner.x1 <= outer.x1 + tolerance
        and inner.y1 <= outer.y1 + tolerance
    )


def _printed_span_count(page: fitz.Page, page_index: int) -> int:
    mask = fitz.Rect(PRINTED_MASK_RECT)
    count = 0
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = str(span.get("text", "")).strip()
                if "Printed:" not in text:
                    continue
                _require(PRINTED_PATTERN.fullmatch(text) is not None, f"page {page_index + 1} has invalid Printed timestamp: {text!r}")
                rect = fitz.Rect(span["bbox"])
                _require(_rect_inside(rect, mask), f"page {page_index + 1} Printed span outside fixed footer mask: {tuple(rect)}")
                count += 1
    return count


def _summary_value_count(page: fitz.Page, header: str, value: str) -> int:
    words = page.get_text("words")
    headers = [word for word in words if word[4] == header]
    values = [word for word in words if word[4] == value]
    return sum(
        1
        for heading in headers
        if any(abs(number[0] - heading[0]) <= 4.0 and 8.0 <= number[1] - heading[1] <= 25.0 for number in values)
    )


def _validate_semantics(document: fitz.Document, case: GoldenCase, normalized_text: list[str]) -> None:
    semantics = expected_semantics(case)
    boundaries = semantics["page_boundaries"]
    _require(len(boundaries) == document.page_count, f"semantic page boundary count mismatch for {case.name}")

    prefix = {"cat5e": "C", "mpo": "M", "lc": "L"}[case.kind]
    label_pattern = re.compile(rf"#{prefix}\d{{3}}$")
    for page_expectation in semantics["pages"]:
        page_index = int(page_expectation["page_index"])
        page = document[page_index]
        expected_rows = page_expectation["rows"]
        label_words = sorted(
            (
                (float(word[1]), float(word[0]), str(word[4]))
                for word in page.get_text("words")
                if label_pattern.fullmatch(str(word[4])) is not None
            ),
            key=lambda item: (item[0], item[1]),
        )
        actual_labels = [item[2] for item in label_words]
        expected_labels = [str(row["cable_label"]) for row in expected_rows]
        _require(
            actual_labels == expected_labels,
            f"page {page_index + 1} record label sequence mismatch: "
            f"expected {expected_labels}, got {actual_labels}",
        )

        first_row_y = _RESULT_ICON_RECTS[case.kind][1]
        columns = _ROW_VALUE_COLUMNS[case.kind]
        words = page.get_text("words")
        for row in expected_rows:
            row_index = int(row["row_index"])
            row_y = first_row_y + _RESULT_ROW_PITCH * row_index
            row_words = [word for word in words if row_y - 2.5 <= float(word[1]) <= row_y + 2.5]
            label_matches = [word for word in words if str(word[4]) == str(row["cable_label"])]
            _require(
                len(label_matches) == 1
                and 20.0 <= float(label_matches[0][0]) <= 90.0
                and row_y - 2.5 <= float(label_matches[0][1]) <= row_y + 2.5,
                f"page {page_index + 1} row {row_index + 1} label column/position mismatch: "
                f"{label_matches}",
            )
            for field_name in ("length", "margin"):
                x0, x1 = columns[field_name]
                field_words = [word for word in row_words if x0 <= float(word[0]) <= x1]
                if case.kind != "mpo":
                    field_words = [word for word in field_words if float(word[1]) <= row_y - 1.0]
                tokens = _overlay_tokens(field_words)
                expected_value = str(row[field_name])
                _require(
                    tokens == [expected_value],
                    f"page {page_index + 1} row {row_index + 1} {field_name} "
                    f"missing: expected {expected_value}, got {tokens}",
                )
            limit_x0, limit_x1 = _ROW_LIMIT_COLUMNS[case.kind]
            limit_tokens = _overlay_tokens(
                [word for word in row_words if limit_x0 <= float(word[0]) <= limit_x1]
            )
            expected_limit_tokens = list(row["limit_tokens"])
            _require(
                limit_tokens == expected_limit_tokens,
                f"page {page_index + 1} row {row_index + 1} limit missing: "
                f"expected {expected_limit_tokens}, got {limit_tokens}",
            )
            date_x0, date_x1 = _ROW_DATE_COLUMNS[case.kind]
            date_tokens = _overlay_tokens(
                [
                    word
                    for word in row_words
                    if date_x0 <= float(word[0]) <= date_x1 and float(word[1]) <= row_y - 1.0
                ]
            )
            expected_date_tokens = list(row["date_tokens"])
            _require(
                date_tokens == expected_date_tokens,
                f"page {page_index + 1} row {row_index + 1} date/time missing: "
                f"expected {expected_date_tokens}, got {date_tokens}",
            )

    for boundary in boundaries:
        page_index = int(boundary["page_index"])
        page_text = normalized_text[page_index]
        first = boundary["first"]
        last = boundary["last"]
        for label, expected in (
            ("first label", first["cable_label"]),
            ("last label", last["cable_label"]),
            ("first date", first["date_time"]),
            ("last date", last["date_time"]),
            ("limit", first["limit"]),
        ):
            _require(str(expected) in page_text, f"page {page_index + 1} missing semantic {label}: {expected}")
        _require(f"Site: {case.site}" in page_text, f"page {page_index + 1} missing Site: {case.site}")
        if case.kind != "lc" or page_index < document.page_count - 1:
            _require(f"Page : {page_index + 1}" in page_text, f"page {page_index + 1} missing page footer")

    final_page = document[-1]
    final_text = normalized_text[-1]
    _require(f"Total for Site: {case.site}" in final_text, "final page missing site summary")
    _require("Total for Selected Reports" in final_text, "final page missing selected-report summary")
    _require(str(semantics["footer"]) in final_text, "final page missing signature footer")
    for header, key in (
        ("Pass", "pass_count"),
        ("Fail", "fail_count"),
        ("Length", "summary_total_length"),
    ):
        value = str(semantics[key])
        _require(_summary_value_count(final_page, header, value) >= 2, f"summary {header}={value} not found twice")


def _ensure_renderer(render_dpi: int) -> None:
    _require(fitz.VersionBind == RENDERER_VERSION, f"renderer version mismatch: expected {RENDERER_VERSION}, got {fitz.VersionBind}")
    _require(render_dpi == RENDER_DPI, f"render DPI mismatch: expected {RENDER_DPI}, got {render_dpi}")


def _render_page(page: fitz.Page, render_dpi: int) -> Image.Image:
    scale = render_dpi / 72.0
    pixmap = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        colorspace=fitz.csRGB,
        alpha=RENDER_ALPHA,
    )
    _require(pixmap.n == 3, f"renderer colorspace mismatch: expected RGB, got {pixmap.n} channels")
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _dominant_result_pixels(image: Image.Image) -> tuple[int, int]:
    red = 0
    green = 0
    for r, g, b in image.convert("RGB").get_flattened_data():
        if r >= 140 and r >= g + 30 and r >= b + 30:
            red += 1
        if g >= 110 and g >= r + 20 and g >= b + 10:
            green += 1
    return red, green


def _validate_result_icon_semantics(images: list[Image.Image], case: GoldenCase) -> None:
    first_rect = _RESULT_ICON_RECTS[case.kind]
    for page_expectation in _expected_page_rows(case):
        page_index = int(page_expectation["page_index"])
        for row in page_expectation["rows"]:
            row_index = int(row["row_index"])
            rect = [
                first_rect[0],
                first_rect[1] + _RESULT_ROW_PITCH * row_index,
                first_rect[2],
                first_rect[3] + _RESULT_ROW_PITCH * row_index,
            ]
            crop = images[page_index].crop(_pixel_box(rect, RENDER_DPI))
            red, green = _dominant_result_pixels(crop)
            expected_result = str(row["result"])
            if expected_result == "FAIL":
                _require(
                    red >= 80 and green <= 10,
                    f"page {page_index + 1} row {row_index + 1} result icon mismatch: "
                    f"expected FAIL, red={red}, green={green}",
                )
            else:
                _require(
                    green >= 80 and red <= 10,
                    f"page {page_index + 1} row {row_index + 1} result icon mismatch: "
                    f"expected PASS, red={red}, green={green}",
                )


def _snapshot_pdf(pdf_path: Path, case: GoldenCase, render_dpi: int) -> _PdfSnapshot:
    _require(not pdf_path.is_symlink(), f"PDF symlink is forbidden: {pdf_path}")
    _require(pdf_path.is_file(), f"PDF missing: {pdf_path}")
    _ensure_renderer(render_dpi)
    try:
        document = fitz.open(pdf_path)
    except Exception as error:
        raise AssertionError(f"cannot open PDF: {pdf_path}: {error}") from error

    try:
        _require(document.page_count == case.expected_pages, f"actual page count mismatch: expected {case.expected_pages}, got {document.page_count}")
        _require(document.is_repaired is False, f"PDF required repair: {pdf_path}")
        for page_index, page in enumerate(document):
            _require(
                page.rotation == 0
                and page.mediabox == _EXPECTED_PAGE_RECT
                and page.cropbox == _EXPECTED_PAGE_RECT
                and page.rect == _EXPECTED_PAGE_RECT,
                f"page geometry mismatch on page {page_index + 1}: "
                f"expected media/crop/rect {tuple(_EXPECTED_PAGE_RECT)} rotation 0, "
                f"got media={tuple(page.mediabox)} crop={tuple(page.cropbox)} "
                f"rect={tuple(page.rect)} rotation={page.rotation}",
            )
        normalized_text = [normalize_printed_text(page.get_text("text")) for page in document]
        printed_pages = []
        printed_span_counts = []
        for page_index, page in enumerate(document):
            count = _printed_span_count(page, page_index)
            printed_span_counts.append(count)
            text_count = sum(line == PRINTED_PLACEHOLDER for line in normalized_text[page_index].splitlines())
            _require(count == text_count, f"page {page_index + 1} Printed span/text count mismatch")
            if count:
                printed_pages.append(page_index)
        _require(printed_pages == [document.page_count - 1], f"Printed footer must exist only on final page, got {printed_pages}")
        _require(
            printed_span_counts == _expected_printed_span_counts(case),
            f"Printed span count mismatch: expected {_expected_printed_span_counts(case)}, got {printed_span_counts}",
        )
        _validate_semantics(document, case, normalized_text)
        metadata = _normalize_metadata(document.metadata)
        images = [_render_page(page, render_dpi) for page in document]
        _require(
            all(image.size == _EXPECTED_RENDER_SIZE for image in images),
            f"rendered page dimensions mismatch: expected {_EXPECTED_RENDER_SIZE}, "
            f"got {[image.size for image in images]}",
        )
        _validate_result_icon_semantics(images, case)
        page_count = document.page_count
    finally:
        document.close()

    try:
        with fitz.open(pdf_path) as reopened:
            _require(reopened.page_count == case.expected_pages, f"reopened page count mismatch: expected {case.expected_pages}, got {reopened.page_count}")
            _require(reopened.is_repaired is False, f"reopened PDF required repair: {pdf_path}")
    except AssertionError:
        raise
    except Exception as error:
        raise AssertionError(f"cannot reopen PDF: {pdf_path}: {error}") from error

    return _PdfSnapshot(
        page_count=page_count,
        metadata=metadata,
        normalized_text=normalized_text,
        printed_pages=printed_pages,
        printed_span_counts=printed_span_counts,
        images=images,
    )


def _manifest_for(case: GoldenCase, snapshot: _PdfSnapshot, page_entries: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "case": {
            "name": case.name,
            "kind": case.kind,
            "site": case.site,
            "record_count": case.record_count,
            "expected_pages": case.expected_pages,
        },
        "fixture": {
            "path": CASES_PATH.relative_to(ROOT).as_posix(),
            "sha256": _sha256(CASES_PATH),
        },
        "template": {
            "path": case.template.as_posix(),
            "sha256": _sha256(ROOT / case.template),
        },
        "renderer": {
            "name": RENDERER_NAME,
            "version": RENDERER_VERSION,
            "dpi": RENDER_DPI,
            "colorspace": RENDER_COLORSPACE,
            "alpha": RENDER_ALPHA,
        },
        "pdf": {
            "page_count": snapshot.page_count,
            "metadata": snapshot.metadata,
            "normalized_text": snapshot.normalized_text,
        },
        "semantics": expected_semantics(case),
        "printed": {
            "placeholder": PRINTED_PLACEHOLDER,
            "mask_rect": list(PRINTED_MASK_RECT),
            "pages": snapshot.printed_pages,
            "span_counts": snapshot.printed_span_counts,
        },
        "critical_rois": expected_critical_rois(case),
        "pages": page_entries,
    }


def _load_manifest(path: Path) -> dict[str, Any]:
    _require(not path.is_symlink(), f"manifest symlink is forbidden: {path}")
    _require(path.is_file(), f"approved golden missing: {path}")

    def reject_constant(value: str) -> None:
        raise AssertionError(f"manifest contains non-finite JSON constant: {value}")

    try:
        raw = json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=reject_constant,
        )
    except (OSError, json.JSONDecodeError) as error:
        raise AssertionError(f"manifest is not valid JSON: {path}: {error}") from error
    return _assert_exact_keys(
        raw,
        {
            "schema_version",
            "case",
            "fixture",
            "template",
            "renderer",
            "pdf",
            "semantics",
            "printed",
            "critical_rois",
            "pages",
        },
        "manifest",
    )


def _validate_manifest(manifest: dict[str, Any], golden_dir: Path, render_dpi: int) -> GoldenCase:
    _require(
        _is_int(manifest["schema_version"]),
        "manifest schema_version must be an integer",
    )
    _require(manifest["schema_version"] == MANIFEST_SCHEMA_VERSION, "manifest schema_version mismatch")
    case_data = _assert_exact_keys(manifest["case"], {"name", "kind", "site", "record_count", "expected_pages"}, "manifest.case")
    fixture = _assert_exact_keys(manifest["fixture"], {"path", "sha256"}, "manifest.fixture")
    template = _assert_exact_keys(manifest["template"], {"path", "sha256"}, "manifest.template")
    renderer = _assert_exact_keys(manifest["renderer"], {"name", "version", "dpi", "colorspace", "alpha"}, "manifest.renderer")
    pdf = _assert_exact_keys(manifest["pdf"], {"page_count", "metadata", "normalized_text"}, "manifest.pdf")
    printed = _assert_exact_keys(
        manifest["printed"],
        {"placeholder", "mask_rect", "pages", "span_counts"},
        "manifest.printed",
    )

    _require(isinstance(case_data["name"], str), "manifest case name must be a string")
    _require(isinstance(case_data["kind"], str), "manifest case kind must be a string")
    _require(isinstance(case_data["site"], str), "manifest case site must be a string")
    _require(_is_int(case_data["record_count"]), "manifest record_count must be an integer")
    _require(_is_int(case_data["expected_pages"]), "manifest expected_pages must be an integer")
    _require(isinstance(fixture["path"], str), "manifest fixture path must be a string")
    _require(isinstance(template["path"], str), "manifest template path must be a string")
    _require(isinstance(renderer["name"], str), "manifest renderer name must be a string")
    _require(isinstance(renderer["version"], str), "manifest renderer version must be a string")
    _require(_is_int(renderer["dpi"]), "manifest renderer DPI must be an integer")
    _require(isinstance(renderer["colorspace"], str), "manifest colorspace must be a string")
    _require(isinstance(renderer["alpha"], bool), "manifest alpha must be a boolean")
    _require(_is_int(pdf["page_count"]), "manifest PDF page_count must be an integer")

    cases = {case.name: case for case in load_cases()}
    name = case_data["name"]
    _require(isinstance(name, str) and name in cases, f"manifest case is not approved: {name}")
    case = cases[name]
    _require(golden_dir.name == case.name, f"manifest case/directory mismatch: {case.name} vs {golden_dir.name}")
    _require(
        _strict_equal(
            case_data,
            {
            "name": case.name,
            "kind": case.kind,
            "site": case.site,
            "record_count": case.record_count,
            "expected_pages": case.expected_pages,
            },
        ),
        "manifest case does not match approved fixture",
    )

    _require(
        fixture["path"] == CASES_PATH.relative_to(ROOT).as_posix(),
        "manifest fixture path mismatch",
    )
    _require(isinstance(fixture["sha256"], str) and SHA256_PATTERN.fullmatch(fixture["sha256"]) is not None, "manifest fixture sha256 invalid")
    _require(fixture["sha256"] == _sha256(CASES_PATH), "manifest fixture sha256 mismatch")
    _require(template["path"] == case.template.as_posix(), "manifest template path mismatch")
    _require(isinstance(template["sha256"], str) and SHA256_PATTERN.fullmatch(template["sha256"]) is not None, "manifest template sha256 invalid")
    _require(template["sha256"] == _sha256(ROOT / case.template), "manifest template sha256 mismatch")

    _require(renderer["name"] == RENDERER_NAME, f"renderer name mismatch: expected {RENDERER_NAME}, got {renderer['name']}")
    _require(renderer["version"] == RENDERER_VERSION, f"renderer version mismatch: expected {RENDERER_VERSION}, got {renderer['version']}")
    _require(fitz.VersionBind == RENDERER_VERSION, f"renderer version mismatch: expected {RENDERER_VERSION}, got {fitz.VersionBind}")
    _require(renderer["dpi"] == RENDER_DPI == render_dpi, f"render DPI mismatch: expected {RENDER_DPI}, manifest {renderer['dpi']}, requested {render_dpi}")
    _require(renderer["colorspace"] == RENDER_COLORSPACE, f"colorspace mismatch: expected RGB, got {renderer['colorspace']}")
    _require(renderer["alpha"] is RENDER_ALPHA, f"alpha mismatch: expected false, got {renderer['alpha']}")

    _require(pdf["page_count"] == case.expected_pages, "manifest PDF page count does not match fixture")
    _require(isinstance(pdf["metadata"], dict), "manifest PDF metadata must be an object")
    _require(isinstance(pdf["normalized_text"], list) and len(pdf["normalized_text"]) == case.expected_pages, "manifest normalized text page count mismatch")
    _require(all(isinstance(text, str) for text in pdf["normalized_text"]), "manifest normalized text must contain strings")
    _require(
        _strict_equal(manifest["semantics"], expected_semantics(case)),
        "manifest semantics do not match fixture-derived expectations",
    )

    _require(isinstance(printed["placeholder"], str), "manifest Printed placeholder must be a string")
    _require(
        isinstance(printed["mask_rect"], list)
        and len(printed["mask_rect"]) == 4
        and all(_is_number(value) for value in printed["mask_rect"]),
        "manifest Printed mask must contain four finite numbers",
    )
    _require(
        isinstance(printed["pages"], list)
        and all(_is_int(value) for value in printed["pages"]),
        "manifest Printed pages must contain integers",
    )
    _require(
        isinstance(printed["span_counts"], list)
        and all(_is_int(value) for value in printed["span_counts"]),
        "manifest Printed span counts must contain integers",
    )
    _require(printed["placeholder"] == PRINTED_PLACEHOLDER, "manifest Printed placeholder mismatch")
    _require(_strict_equal(printed["mask_rect"], list(PRINTED_MASK_RECT)), "manifest Printed mask mismatch")
    _require(printed["pages"] == [case.expected_pages - 1], "manifest Printed pages mismatch")
    _require(printed["span_counts"] == _expected_printed_span_counts(case), "manifest Printed span counts mismatch")
    critical_rois = manifest["critical_rois"]
    _require(
        isinstance(critical_rois, list),
        "manifest critical Result ROIs must be a list",
    )
    for index, raw_roi in enumerate(critical_rois):
        roi = _assert_exact_keys(raw_roi, {"name", "page_index", "rect"}, f"manifest.critical_rois[{index}]")
        _require(isinstance(roi["name"], str), f"manifest critical ROI name invalid at {index}")
        _require(_is_int(roi["page_index"]), f"manifest critical ROI page index must be an integer at {index}")
        _require(
            isinstance(roi["rect"], list)
            and len(roi["rect"]) == 4
            and all(_is_number(value) for value in roi["rect"]),
            f"manifest critical ROI rect must contain four finite numbers at {index}",
        )
    _require(
        _strict_equal(critical_rois, expected_critical_rois(case)),
        "manifest critical Result ROIs mismatch",
    )

    pages = manifest["pages"]
    _require(isinstance(pages, list) and len(pages) == case.expected_pages, "manifest page entries count mismatch")
    expected_files = {f"page-{index + 1:03d}.png" for index in range(case.expected_pages)}
    actual_files = {path.name for path in golden_dir.glob("*.png")}
    _require(actual_files == expected_files, f"PNG inventory mismatch: expected {sorted(expected_files)}, got {sorted(actual_files)}")
    expected_inventory = {"manifest.json", *expected_files}
    actual_inventory = {path.name for path in golden_dir.iterdir()}
    _require(
        actual_inventory == expected_inventory
        and not golden_dir.is_symlink()
        and all(path.is_file() and not path.is_symlink() for path in golden_dir.iterdir()),
        f"golden inventory mismatch: expected {sorted(expected_inventory)}, "
        f"got {sorted(actual_inventory)}",
    )

    for index, raw_entry in enumerate(pages):
        entry = _assert_exact_keys(raw_entry, {"index", "file", "width", "height", "mode", "sha256"}, f"manifest.pages[{index}]")
        expected_file = f"page-{index + 1:03d}.png"
        _require(_is_int(entry["index"]), f"manifest page index must be an integer at {index}")
        _require(entry["index"] == index, f"manifest page index mismatch at {index}")
        _require(isinstance(entry["file"], str), f"manifest page filename invalid at {index}")
        _require(entry["file"] == expected_file, f"manifest page filename mismatch at {index}")
        _require(_is_int(entry["width"]) and entry["width"] == _EXPECTED_RENDER_SIZE[0], f"manifest page width invalid at {index}")
        _require(_is_int(entry["height"]) and entry["height"] == _EXPECTED_RENDER_SIZE[1], f"manifest page height invalid at {index}")
        _require(entry["mode"] == "RGB", f"manifest page mode invalid at {index}")
        _require(isinstance(entry["sha256"], str) and SHA256_PATTERN.fullmatch(entry["sha256"]) is not None, f"manifest page sha256 invalid at {index}")

    return case


def _load_golden_images(golden_dir: Path, pages: list[dict[str, object]]) -> list[Image.Image]:
    images = []
    for index, entry in enumerate(pages):
        path = golden_dir / str(entry["file"])
        _require(not path.is_symlink(), f"golden PNG symlink is forbidden: {path}")
        try:
            with Image.open(path) as opened:
                opened.load()
                image = opened.copy()
        except Exception as error:
            raise AssertionError(f"golden PNG cannot be opened: {path}: {error}") from error
        _require(image.mode == entry["mode"], f"golden PNG mode mismatch on page {index + 1}: expected {entry['mode']}, got {image.mode}")
        _require(image.size == (entry["width"], entry["height"]), f"golden PNG dimensions mismatch on page {index + 1}: expected {(entry['width'], entry['height'])}, got {image.size}")
        _require(_sha256(path) == entry["sha256"], f"golden PNG sha256 mismatch on page {index + 1}")
        images.append(image)
    return images


def _pixel_box(rect: list[float] | tuple[float, ...], render_dpi: int) -> tuple[int, int, int, int]:
    scale = render_dpi / 72.0
    return (
        math.floor(float(rect[0]) * scale),
        math.floor(float(rect[1]) * scale),
        math.ceil(float(rect[2]) * scale),
        math.ceil(float(rect[3]) * scale),
    )


def _masked(image: Image.Image, page_index: int, printed_pages: list[int], render_dpi: int) -> Image.Image:
    copy = image.copy()
    if page_index in printed_pages:
        copy.paste((255, 255, 255), _pixel_box(PRINTED_MASK_RECT, render_dpi))
    return copy


def _diff_metrics(diff: Image.Image) -> tuple[int, float, float]:
    red, green, blue = diff.split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    histogram = maximum.histogram()
    total_pixels = diff.width * diff.height
    changed_pixels = total_pixels - histogram[0]
    ratio = changed_pixels / total_pixels
    channel_histogram = diff.histogram()
    delta_sum = sum((index % 256) * count for index, count in enumerate(channel_histogram))
    mean_delta = delta_sum / (total_pixels * 3)
    return changed_pixels, ratio, mean_delta


def _write_diff_artifacts(pdf_path: Path, page_index: int, actual: Image.Image, diff: Image.Image) -> None:
    _require(not pdf_path.is_symlink(), f"diff artifact source PDF symlink is forbidden: {pdf_path}")
    _require(
        not _lexically_inside(pdf_path, GOLDEN_ROOT)
        and not _resolved_inside(pdf_path, GOLDEN_ROOT),
        f"diff artifacts must stay outside golden root: {pdf_path}",
    )
    stem = pdf_path.stem
    actual_path = pdf_path.with_name(f"{stem}-page-{page_index + 1:03d}-actual.png")
    diff_path = pdf_path.with_name(f"{stem}-page-{page_index + 1:03d}-diff.png")
    for artifact_path in (actual_path, diff_path):
        _require(
            not artifact_path.is_symlink(),
            f"artifact target symlink is forbidden: {artifact_path}",
        )
        _require(
            not _lexically_inside(artifact_path, GOLDEN_ROOT)
            and not _resolved_inside(artifact_path, GOLDEN_ROOT),
            f"artifact target must stay outside golden root: {artifact_path}",
        )
        _require(
            not artifact_path.exists() or artifact_path.is_file(),
            f"artifact target must be a regular file path: {artifact_path}",
        )
    actual.save(actual_path)
    diff.save(diff_path)


def write_golden_candidate(
    case: GoldenCase,
    pdf_path: Path,
    golden_dir: Path,
    *,
    render_dpi: int = RENDER_DPI,
) -> None:
    _require(case in load_cases(), f"case is not in approved matrix: {case.name}")
    _require(not golden_dir.exists(), f"candidate directory already exists: {golden_dir}")
    snapshot = _snapshot_pdf(pdf_path, case, render_dpi)
    golden_dir.mkdir(parents=True)
    page_entries = []
    try:
        for index, image in enumerate(snapshot.images):
            canonical_image = _masked(image, index, snapshot.printed_pages, render_dpi)
            filename = f"page-{index + 1:03d}.png"
            path = golden_dir / filename
            canonical_image.save(path, format="PNG")
            page_entries.append(
                {
                    "index": index,
                    "file": filename,
                    "width": canonical_image.width,
                    "height": canonical_image.height,
                    "mode": canonical_image.mode,
                    "sha256": _sha256(path),
                }
            )
        manifest = _manifest_for(case, snapshot, page_entries)
        manifest_path = golden_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        loaded = _load_manifest(manifest_path)
        _validate_manifest(loaded, golden_dir, render_dpi)
        _load_golden_images(golden_dir, loaded["pages"])
    except Exception:
        for path in golden_dir.iterdir():
            if path.is_file():
                path.unlink()
        golden_dir.rmdir()
        raise


def assert_pdf_matches_golden(
    pdf_path: Path,
    golden_dir: Path,
    *,
    render_dpi: int = RENDER_DPI,
    max_changed_pixel_ratio: float = 0.001,
    max_mean_channel_delta: float = 0.5,
) -> None:
    _require(_is_number(max_changed_pixel_ratio) and 0.0 <= max_changed_pixel_ratio <= 1.0, "max_changed_pixel_ratio must be between 0 and 1")
    _require(_is_number(max_mean_channel_delta) and 0.0 <= max_mean_channel_delta <= 255.0, "max_mean_channel_delta must be between 0 and 255")
    _require(
        not pdf_path.is_symlink()
        and not _lexically_inside(pdf_path, GOLDEN_ROOT)
        and not _resolved_inside(pdf_path, GOLDEN_ROOT),
        f"actual PDF symlink or golden root path is forbidden: {pdf_path}",
    )
    _require(pdf_path.is_file(), f"PDF missing: {pdf_path}")
    manifest = _load_manifest(golden_dir / "manifest.json")
    case = _validate_manifest(manifest, golden_dir, render_dpi)
    golden_images = _load_golden_images(golden_dir, manifest["pages"])
    actual = _snapshot_pdf(pdf_path, case, render_dpi)

    _require(actual.page_count == manifest["pdf"]["page_count"], f"actual page count mismatch: manifest {manifest['pdf']['page_count']}, actual {actual.page_count}")
    _require(actual.metadata == manifest["pdf"]["metadata"], "stable PDF metadata mismatch")
    _require(actual.normalized_text == manifest["pdf"]["normalized_text"], "normalized text mismatch")
    _require(actual.printed_pages == manifest["printed"]["pages"], "Printed footer pages mismatch")
    _require(actual.printed_span_counts == manifest["printed"]["span_counts"], "Printed footer span counts mismatch")

    rois_by_page: dict[int, list[dict[str, object]]] = {}
    for roi in manifest["critical_rois"]:
        rois_by_page.setdefault(int(roi["page_index"]), []).append(roi)

    for page_index, (golden_image, actual_image) in enumerate(zip(golden_images, actual.images, strict=True)):
        _require(golden_image.mode == actual_image.mode == "RGB", f"actual image mode mismatch on page {page_index + 1}")
        _require(golden_image.size == actual_image.size, f"actual image dimensions mismatch on page {page_index + 1}: expected {golden_image.size}, got {actual_image.size}")
        golden_masked = _masked(golden_image, page_index, manifest["printed"]["pages"], render_dpi)
        actual_masked = _masked(actual_image, page_index, manifest["printed"]["pages"], render_dpi)
        full_diff = ImageChops.difference(golden_masked, actual_masked)

        for roi in rois_by_page.get(page_index, []):
            box = _pixel_box(roi["rect"], render_dpi)
            roi_diff = full_diff.crop(box)
            if roi_diff.getbbox() is not None:
                _write_diff_artifacts(pdf_path, page_index, actual_masked, full_diff)
                raise AssertionError(f"critical Result ROI mismatch on page {page_index + 1}: {roi['name']}")

        if page_index in manifest["printed"]["pages"]:
            footer_guard_diff = full_diff.crop(_pixel_box(PRINTED_GUARD_RECT, render_dpi))
            if footer_guard_diff.getbbox() is not None:
                _write_diff_artifacts(pdf_path, page_index, actual_masked, full_diff)
                raise AssertionError(f"pixel mismatch in fixed Printed footer guard on page {page_index + 1}")

        changed_pixels, changed_ratio, mean_delta = _diff_metrics(full_diff)
        if changed_ratio > float(max_changed_pixel_ratio) or mean_delta > float(max_mean_channel_delta):
            _write_diff_artifacts(pdf_path, page_index, actual_masked, full_diff)
            raise AssertionError(
                f"pixel mismatch outside approved Printed mask on page {page_index + 1}: "
                f"changed={changed_pixels}, ratio={changed_ratio:.9f}/{float(max_changed_pixel_ratio):.9f}, "
                f"mean_delta={mean_delta:.6f}/{float(max_mean_channel_delta):.6f} exceeds configured global thresholds"
            )
