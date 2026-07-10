from __future__ import annotations

import math
from pathlib import Path
import sys

import fitz
from PIL import Image
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_editor import modify_pdf_precise  # noqa: E402


CASES = [
    (
        "cat5e",
        ROOT / "assets/M138-DE46-OOB-Cat5e.pdf",
        fitz.Rect(271.000, 109.766, 283.000, 121.766),
    ),
    (
        "mpo",
        ROOT / "assets/M138-DE46-P-A-MPO.pdf",
        fitz.Rect(170.777, 88.000, 182.777, 100.000),
    ),
    (
        "lc",
        ROOT / "assets/M138-DE46-D-P-cross-LC.pdf",
        fitz.Rect(162.109, 109.766, 174.109, 121.766),
    ),
]


def _records(kind: str, count: int = 2) -> list[dict[str, object]]:
    limit = {
        "cat5e": "TIA - Cat 5e Channel",
        "mpo": "200GBASE-SR10",
        "lc": "Link Validation",
    }[kind]
    prefix = {"cat5e": "C", "mpo": "M", "lc": "L"}[kind]

    return [
        {
            "id": f"{kind}-{index + 1:03d}",
            "cable_label": f"#{prefix}{index + 1:03d}",
            "cable_number": f"{prefix}{index + 1:03d}",
            "limit": limit,
            "result": "FAIL" if index == 1 else "PASS",
            "length": 20.0 + index * 0.5,
            "next_margin": 10.0 + (index % 10) * 0.2,
            "date_time": "15-05-2026 09:00:00 AM",
        }
        for index in range(count)
    ]


def _crop(page_image: Image.Image, rect: fitz.Rect, scale: float = 2.0) -> Image.Image:
    return page_image.crop(
        (
            math.floor(rect.x0 * scale),
            math.floor(rect.y0 * scale),
            math.ceil(rect.x1 * scale),
            math.ceil(rect.y1 * scale),
        )
    )


def _dominant_pixel_counts(image: Image.Image) -> tuple[int, int]:
    red = 0
    green = 0
    for r, g, b in image.convert("RGB").getdata():
        if r >= 140 and r >= g + 30 and r >= b + 30:
            red += 1
        if g >= 110 and g >= r + 20 and g >= b + 10:
            green += 1
    return red, green


def _summary_has_count(page: fitz.Page, label: str, count: int) -> bool:
    words = page.get_text("words")
    labels = [word for word in words if word[4] == label]
    values = [word for word in words if word[4] == str(count)]
    return any(
        abs(value[0] - header[0]) <= 3.0
        and 8.0 <= value[1] - header[1] <= 24.0
        for header in labels
        for value in values
    )


@pytest.mark.parametrize("kind,template,first_icon_rect", CASES, ids=lambda value: value if isinstance(value, str) else None)
def test_pass_and_fail_result_icons_are_rendered(
    kind: str,
    template: Path,
    first_icon_rect: fitz.Rect,
    tmp_path: Path,
) -> None:
    output = tmp_path / f"{kind}-result-icons.pdf"
    result = modify_pdf_precise(
        str(template),
        str(output),
        {"site": "M138-DE46", "records": _records(kind)},
    )
    assert result.get("success") is True, result

    with fitz.open(output) as document:
        assert document.page_count == 1
        page = document[0]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        page_image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)

        pass_red, pass_green = _dominant_pixel_counts(_crop(page_image, first_icon_rect))
        fail_rect = first_icon_rect + (0, 15, 0, 15)
        fail_red, fail_green = _dominant_pixel_counts(_crop(page_image, fail_rect))

        assert pass_green >= 80, f"{kind} PASS icon lost: red={pass_red}, green={pass_green}"
        assert fail_red >= 80, f"{kind} FAIL icon is not red: red={fail_red}, green={fail_green}"
        assert fail_green <= 10, f"{kind} FAIL icon still contains PASS green: green={fail_green}"
        assert _summary_has_count(page, "Pass", 1), f"{kind} summary does not show Pass = 1"
        assert _summary_has_count(page, "Fail", 1), f"{kind} summary does not show Fail = 1"


def test_lc_data_page_renders_failed_result_icon(tmp_path: Path) -> None:
    template = ROOT / "assets/M138-DE46-D-P-cross-LC.pdf"
    output = tmp_path / "lc-cross-page-result-icons.pdf"
    result = modify_pdf_precise(
        str(template),
        str(output),
        {"site": "M138-DE46", "records": _records("lc", count=49)},
    )
    assert result.get("success") is True, result

    with fitz.open(output) as document:
        assert document.page_count == 2
        page = document[0]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        page_image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
        first_icon_rect = fitz.Rect(162.109, 109.766, 174.109, 121.766)

        pass_red, pass_green = _dominant_pixel_counts(_crop(page_image, first_icon_rect))
        fail_rect = first_icon_rect + (0, 15, 0, 15)
        fail_red, fail_green = _dominant_pixel_counts(_crop(page_image, fail_rect))

        assert pass_green >= 80, f"LC data-page PASS icon lost: red={pass_red}, green={pass_green}"
        assert fail_red >= 80, f"LC data-page FAIL icon is not red: red={fail_red}, green={fail_green}"
        assert fail_green <= 10, f"LC data-page FAIL icon still contains PASS green: green={fail_green}"
