from __future__ import annotations

import math
from pathlib import Path
import sys

import fitz
from PIL import Image, ImageDraw
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

FAIL_RED = (220, 38, 38)


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


def _assert_fail_icon_design(image: Image.Image, label: str) -> None:
    raster = image.convert("RGB")
    center_x = raster.width / 2
    center_y = raster.height / 2
    red_pixels = []
    exact_red_pixels = []
    white_pixels = []

    for y in range(raster.height):
        for x in range(raster.width):
            r, g, b = raster.getpixel((x, y))
            dx = x + 0.5 - center_x
            dy = y + 0.5 - center_y
            if r >= 140 and r >= g + 30 and r >= b + 30:
                red_pixels.append((x, y, dx, dy))
            if (r, g, b) == FAIL_RED:
                exact_red_pixels.append((x, y, dx, dy))
            if r >= 245 and g >= 245 and b >= 245:
                white_pixels.append((x, y, dx, dy))

    assert len(exact_red_pixels) >= 100, (
        f"{label} FAIL icon lacks an exact #DC2626 core: "
        f"pixels={len(exact_red_pixels)}"
    )

    red_xs = [pixel[0] for pixel in red_pixels]
    red_ys = [pixel[1] for pixel in red_pixels]
    red_bbox = (min(red_xs), min(red_ys), max(red_xs), max(red_ys))
    body_width = red_bbox[2] - red_bbox[0] + 1
    body_height = red_bbox[3] - red_bbox[1] + 1
    assert 21 <= body_width <= 24 and 21 <= body_height <= 24, (
        f"{label} FAIL red body has the wrong 12pt size: "
        f"bbox={red_bbox}, size={body_width}x{body_height}"
    )
    assert abs(body_width - body_height) <= 2, (
        f"{label} FAIL red body is not circular: size={body_width}x{body_height}"
    )

    centroid_x = sum(pixel[0] + 0.5 for pixel in red_pixels) / len(red_pixels)
    centroid_y = sum(pixel[1] + 0.5 for pixel in red_pixels) / len(red_pixels)
    assert abs(centroid_x - center_x) <= 1.0 and abs(centroid_y - center_y) <= 1.0, (
        f"{label} FAIL red body is off-center: "
        f"centroid=({centroid_x:.2f}, {centroid_y:.2f}), "
        f"expected=({center_x:.2f}, {center_y:.2f})"
    )

    corner_red_pixels = sum(
        (x <= red_bbox[0] + 2 or x >= red_bbox[2] - 2)
        and (y <= red_bbox[1] + 2 or y >= red_bbox[3] - 2)
        for x, y, _dx, _dy in red_pixels
    )
    assert corner_red_pixels <= 4, (
        f"{label} FAIL red body has filled corners instead of a round silhouette: "
        f"corner_pixels={corner_red_pixels}"
    )

    inner_white = [
        pixel for pixel in white_pixels
        if max(abs(pixel[2]), abs(pixel[3])) <= 6.0
    ]
    descending_diagonal = [
        pixel for pixel in inner_white if abs(pixel[2] - pixel[3]) <= 1.5
    ]
    ascending_diagonal = [
        pixel for pixel in inner_white if abs(pixel[2] + pixel[3]) <= 1.5
    ]
    branch_counts = (
        sum(dx < -1 and dy < -1 for _x, _y, dx, dy in descending_diagonal),
        sum(dx > 1 and dy > 1 for _x, _y, dx, dy in descending_diagonal),
        sum(dx < -1 and dy > 1 for _x, _y, dx, dy in ascending_diagonal),
        sum(dx > 1 and dy < -1 for _x, _y, dx, dy in ascending_diagonal),
    )
    center_white_pixels = sum(
        max(abs(dx), abs(dy)) <= 1.5 for _x, _y, dx, dy in white_pixels
    )
    assert (
        len(descending_diagonal) >= 16
        and len(ascending_diagonal) >= 16
        and min(branch_counts) >= 4
        and center_white_pixels >= 4
    ), (
        f"{label} FAIL icon lacks a centered white X: "
        f"diagonals={len(descending_diagonal)}/{len(ascending_diagonal)}, "
        f"branches={branch_counts}, center={center_white_pixels}"
    )

    off_diagonal_red_pixels = sum(
        max(abs(dx), abs(dy)) <= 6.0
        and abs(dx - dy) > 2.0
        and abs(dx + dy) > 2.0
        for _x, _y, dx, dy in red_pixels
    )
    assert off_diagonal_red_pixels >= 40, (
        f"{label} FAIL icon center is over-cleared instead of a white X on red: "
        f"off_diagonal_red={off_diagonal_red_pixels}"
    )


def _synthetic_fail_icon(variant: str) -> Image.Image:
    image = Image.new("RGB", (24, 24), "white")
    draw = ImageDraw.Draw(image)
    fill = (255, 0, 0) if variant == "wrong-red" else FAIL_RED
    body_box = (1, 1, 22, 22)
    if variant == "red-square":
        draw.rectangle(body_box, fill=fill)
    else:
        draw.ellipse(body_box, fill=fill)

    if variant != "no-x":
        draw.line((7, 7, 17, 17), fill="white", width=3)
        draw.line((7, 17, 17, 7), fill="white", width=3)
    return image


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
        _assert_fail_icon_design(_crop(page_image, fail_rect), kind)
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
        _assert_fail_icon_design(_crop(page_image, fail_rect), "LC data-page")


@pytest.mark.parametrize(
    "variant,error_pattern",
    [
        ("red-square", "round silhouette"),
        ("wrong-red", "exact #DC2626 core"),
        ("no-x", "centered white X"),
    ],
)
def test_fail_icon_contract_rejects_invalid_raster(
    variant: str,
    error_pattern: str,
) -> None:
    with pytest.raises(AssertionError, match=error_pattern):
        _assert_fail_icon_design(_synthetic_fail_icon(variant), variant)
