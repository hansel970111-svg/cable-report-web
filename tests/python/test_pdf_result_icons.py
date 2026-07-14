from __future__ import annotations

import math
from pathlib import Path
import sys

import fitz
from PIL import Image, ImageChops, ImageDraw, ImageStat
import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_engine.dispatch import edit_report  # noqa: E402


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
FACTORY_PASS_RECTS = {
    "cat5e": fitz.Rect(386.362, 110.109, 398.362, 122.109),
    "lc": fitz.Rect(272.008, 109.766, 284.008, 121.766),
}
FIRST_DATA_PAGE_COUNTS = {
    "cat5e": 41,
    "mpo": 43,
    "lc": 23,
}
FOOTER_LOGO_RECT = fitz.Rect(280.5, 819.0, 342.56060791015625, 835.0)
CAT5E_SECOND_PAGE_FACTORY_RECT = fitz.Rect(
    386.068024,
    108.944458,
    398.068024,
    120.944458,
)


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
    for r, g, b in image.convert("RGB").get_flattened_data():
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
    records = _records(kind)
    result = edit_report(
        template,
        output,
        records,
        "M138-DE46",
    )
    assert result.output == output
    assert result.records == len(records)

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
    records = _records("lc", count=49)
    result = edit_report(
        template,
        output,
        records,
        "M138-DE46",
    )
    assert result.output == output
    assert result.pages == 2
    assert result.records == len(records)

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
@pytest.mark.parametrize("kind,template,first_icon_rect", CASES, ids=lambda value: value if isinstance(value, str) else None)
def test_last_pass_icon_before_empty_rows_matches_template(
    kind: str,
    template: Path,
    first_icon_rect: fitz.Rect,
    tmp_path: Path,
) -> None:
    record_count = FIRST_DATA_PAGE_COUNTS[kind]
    output = tmp_path / f"{kind}-last-pass-before-empty-rows.pdf"
    result = edit_report(template, output, _records(kind, record_count), "M138-DE46")
    assert result.pages == 2

    with fitz.open(output) as document:
        page = document[0]
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(8, 8),
            colorspace=fitz.csRGB,
            alpha=False,
        )
        page_image = Image.frombytes(
            "RGB",
            [pixmap.width, pixmap.height],
            pixmap.samples,
        )

        last_row_index = record_count - 1
        last_icon_rect = first_icon_rect + (0, 15 * last_row_index, 0, 15 * last_row_index)
        first_icon = _crop(page_image, first_icon_rect, scale=8.0)
        last_icon = _crop(page_image, last_icon_rect, scale=8.0)
        assert ImageChops.difference(first_icon, last_icon).getbbox() is None, (
            f"{kind} last PASS icon is clipped instead of matching the template"
        )

        next_empty_rect = first_icon_rect + (0, 15 * record_count, 0, 15 * record_count)
        empty_icon = _crop(page_image, next_empty_rect, scale=8.0)
        empty_red, empty_green = _dominant_pixel_counts(empty_icon)
        assert empty_red == 0 and empty_green == 0, (
            f"{kind} first empty row contains a status-icon remnant: "
            f"red={empty_red}, green={empty_green}"
        )
        assert min(minimum for minimum, _maximum in empty_icon.getextrema()) >= 245, (
            f"{kind} first empty row contains a grey status-icon remnant"
        )

        factory_rect = FACTORY_PASS_RECTS.get(kind)
        if factory_rect is not None:
            last_factory_rect = factory_rect + (
                0,
                15 * last_row_index,
                0,
                15 * last_row_index,
            )
            first_factory = _crop(page_image, factory_rect, scale=8.0)
            last_factory = _crop(page_image, last_factory_rect, scale=8.0)
            assert ImageChops.difference(first_factory, last_factory).getbbox() is None, (
                f"{kind} last factory PASS icon is clipped instead of matching the template"
            )


def test_cat5e_second_data_page_uses_its_template_icon_geometry(tmp_path: Path) -> None:
    template = ROOT / "assets/M138-DE46-OOB-Cat5e.pdf"
    output = tmp_path / "cat5e-second-page-last-pass-before-empty-rows.pdf"
    result = edit_report(template, output, _records("cat5e", 87), "M138-DE46")
    assert result.pages == 3

    with fitz.open(output) as document:
        page = document[1]
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(8, 8),
            colorspace=fitz.csRGB,
            alpha=False,
        )
        page_image = Image.frombytes(
            "RGB",
            [pixmap.width, pixmap.height],
            pixmap.samples,
        )

        last_row_index = 40
        last_factory_rect = CAT5E_SECOND_PAGE_FACTORY_RECT + (
            0,
            15 * last_row_index,
            0,
            15 * last_row_index,
        )
        first_factory = _crop(
            page_image,
            CAT5E_SECOND_PAGE_FACTORY_RECT,
            scale=8.0,
        )
        last_factory = _crop(page_image, last_factory_rect, scale=8.0)
        assert ImageChops.difference(first_factory, last_factory).getbbox() is None, (
            "Cat5e second-page factory PASS icon is clipped instead of matching "
            "that page's template geometry"
        )

        empty_factory_rect = CAT5E_SECOND_PAGE_FACTORY_RECT + (
            0,
            15 * (last_row_index + 1),
            0,
            15 * (last_row_index + 1),
        )
        empty_factory = _crop(page_image, empty_factory_rect, scale=8.0)
        assert min(minimum for minimum, _maximum in empty_factory.getextrema()) >= 245, (
            "Cat5e second-page empty row contains a factory PASS remnant"
        )


@pytest.mark.parametrize("kind,template,_first_icon_rect", CASES, ids=lambda value: value if isinstance(value, str) else None)
def test_footer_logo_preserves_template_pixels(
    kind: str,
    template: Path,
    _first_icon_rect: fitz.Rect,
    tmp_path: Path,
) -> None:
    output = tmp_path / f"{kind}-footer-logo.pdf"
    edit_report(template, output, _records(kind), "M138-DE46")

    with fitz.open(template) as template_document, fitz.open(output) as output_document:
        template_pixmap = template_document[-1].get_pixmap(
            matrix=fitz.Matrix(8, 8),
            colorspace=fitz.csRGB,
            alpha=False,
        )
        output_pixmap = output_document[-1].get_pixmap(
            matrix=fitz.Matrix(8, 8),
            colorspace=fitz.csRGB,
            alpha=False,
        )
        template_page = Image.frombytes(
            "RGB",
            [template_pixmap.width, template_pixmap.height],
            template_pixmap.samples,
        )
        output_page = Image.frombytes(
            "RGB",
            [output_pixmap.width, output_pixmap.height],
            output_pixmap.samples,
        )
        template_logo = _crop(template_page, FOOTER_LOGO_RECT, scale=8.0)
        output_logo = _crop(output_page, FOOTER_LOGO_RECT, scale=8.0)
        logo_difference = ImageChops.difference(template_logo, output_logo)
        channel_extrema = logo_difference.getextrema()
        mean_difference = max(ImageStat.Stat(logo_difference).mean)
        assert max(maximum for _minimum, maximum in channel_extrema) <= 1, (
            f"{kind} footer logo differs from the template: extrema={channel_extrema}"
        )
        assert mean_difference <= 0.1, (
            f"{kind} footer logo was resampled instead of preserving the template pixels: "
            f"mean_difference={mean_difference:.3f}"
        )
        assert not any(
            image[2] > 500 or image[3] > 500
            for image in output_document[-1].get_images(full=True)
            if image[2] / max(image[3], 1) > 3
        ), f"{kind} footer logo was replaced by an oversized raster"


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
