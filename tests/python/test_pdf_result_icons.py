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

FAIL_RED = (236, 28, 36)
FAIL_RING_GRAY = (208, 210, 211)
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


def _render_icon_crop(
    page: fitz.Page,
    rect: fitz.Rect,
    scale: float = 8.0,
) -> Image.Image:
    pixmap = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        clip=rect,
        colorspace=fitz.csRGB,
        alpha=False,
    )
    return Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)


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
    icon_size = min(raster.size)
    image_area = raster.width * raster.height
    red_pixels = []
    exact_red_pixels = []
    exact_ring_pixels = []
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
            if (r, g, b) == FAIL_RING_GRAY:
                exact_ring_pixels.append((x, y, dx, dy))
            if (
                r >= 245
                and g >= 245
                and b >= 245
                and max(abs(dx), abs(dy)) <= icon_size * 0.30
            ):
                white_pixels.append((x, y, dx, dy))

    assert len(exact_red_pixels) >= image_area * 0.38, (
        f"{label} FAIL icon lacks the reference #EC1C24 red core: "
        f"pixels={len(exact_red_pixels)}"
    )
    assert len(exact_ring_pixels) >= image_area * 0.12, (
        f"{label} FAIL icon lacks the reference #D0D2D3 gray outer ring: "
        f"pixels={len(exact_ring_pixels)}"
    )

    red_xs = [pixel[0] for pixel in red_pixels]
    red_ys = [pixel[1] for pixel in red_pixels]
    red_bbox = (min(red_xs), min(red_ys), max(red_xs), max(red_ys))
    body_width = red_bbox[2] - red_bbox[0] + 1
    body_height = red_bbox[3] - red_bbox[1] + 1
    assert (
        icon_size * 0.78 <= body_width <= icon_size * 0.87
        and icon_size * 0.78 <= body_height <= icon_size * 0.87
    ), (
        f"{label} FAIL red body does not match the reference 10pt inner circle: "
        f"bbox={red_bbox}, size={body_width}x{body_height}"
    )
    assert abs(body_width - body_height) <= icon_size * 0.03, (
        f"{label} FAIL red body is not circular: size={body_width}x{body_height}"
    )

    ring_xs = [pixel[0] for pixel in exact_ring_pixels]
    ring_ys = [pixel[1] for pixel in exact_ring_pixels]
    ring_width = max(ring_xs) - min(ring_xs) + 1
    ring_height = max(ring_ys) - min(ring_ys) + 1
    assert ring_width >= icon_size * 0.90 and ring_height >= icon_size * 0.90, (
        f"{label} FAIL gray outer ring is incomplete: "
        f"size={ring_width}x{ring_height}"
    )

    centroid_x = sum(pixel[0] + 0.5 for pixel in red_pixels) / len(red_pixels)
    centroid_y = sum(pixel[1] + 0.5 for pixel in red_pixels) / len(red_pixels)
    assert (
        abs(centroid_x - center_x) <= icon_size * 0.025
        and abs(centroid_y - center_y) <= icon_size * 0.025
    ), (
        f"{label} FAIL red body is off-center: "
        f"centroid=({centroid_x:.2f}, {centroid_y:.2f}), "
        f"expected=({center_x:.2f}, {center_y:.2f})"
    )

    corner_margin = icon_size * 0.10
    corner_red_pixels = sum(
        (x <= red_bbox[0] + corner_margin or x >= red_bbox[2] - corner_margin)
        and (y <= red_bbox[1] + corner_margin or y >= red_bbox[3] - corner_margin)
        for x, y, _dx, _dy in red_pixels
    )
    assert corner_red_pixels <= image_area * 0.005, (
        f"{label} FAIL red body has filled corners instead of a round silhouette: "
        f"corner_pixels={corner_red_pixels}"
    )

    assert white_pixels, f"{label} FAIL icon lacks a centered white X"
    white_xs = [pixel[0] for pixel in white_pixels]
    white_ys = [pixel[1] for pixel in white_pixels]
    white_width = max(white_xs) - min(white_xs) + 1
    white_height = max(white_ys) - min(white_ys) + 1
    assert (
        icon_size * 0.26 <= white_width <= icon_size * 0.35
        and icon_size * 0.26 <= white_height <= icon_size * 0.35
        and image_area * 0.035 <= len(white_pixels) <= image_area * 0.065
    ), (
        f"{label} FAIL icon does not use the reference-sized white X: "
        f"bbox={white_width}x{white_height}, pixels={len(white_pixels)}"
    )

    diagonal_tolerance = icon_size * 0.035
    descending_diagonal = [
        pixel
        for pixel in white_pixels
        if abs(pixel[2] - pixel[3]) <= diagonal_tolerance
    ]
    ascending_diagonal = [
        pixel
        for pixel in white_pixels
        if abs(pixel[2] + pixel[3]) <= diagonal_tolerance
    ]
    branch_offset = icon_size * 0.04
    branch_counts = (
        sum(
            dx < -branch_offset and dy < -branch_offset
            for _x, _y, dx, dy in descending_diagonal
        ),
        sum(
            dx > branch_offset and dy > branch_offset
            for _x, _y, dx, dy in descending_diagonal
        ),
        sum(
            dx < -branch_offset and dy > branch_offset
            for _x, _y, dx, dy in ascending_diagonal
        ),
        sum(
            dx > branch_offset and dy < -branch_offset
            for _x, _y, dx, dy in ascending_diagonal
        ),
    )
    center_white_pixels = sum(
        max(abs(dx), abs(dy)) <= icon_size * 0.035
        for _x, _y, dx, dy in white_pixels
    )
    assert (
        len(descending_diagonal) >= icon_size * 1.4
        and len(ascending_diagonal) >= icon_size * 1.4
        and min(branch_counts) >= icon_size * 0.40
        and center_white_pixels >= icon_size * 0.35
    ), (
        f"{label} FAIL icon lacks a centered white X: "
        f"diagonals={len(descending_diagonal)}/{len(ascending_diagonal)}, "
        f"branches={branch_counts}, center={center_white_pixels}"
    )


def _synthetic_fail_icon(variant: str) -> Image.Image:
    image = Image.new("RGB", (96, 96), "white")
    draw = ImageDraw.Draw(image)
    fill = (255, 0, 0) if variant == "wrong-red" else FAIL_RED
    if variant != "missing-ring":
        draw.ellipse((0, 0, 95, 95), fill=FAIL_RING_GRAY)

    if variant == "red-square":
        draw.rectangle((10, 10, 85, 85), fill=fill)
    else:
        draw.ellipse((8, 8, 87, 87), fill=fill)

    if variant != "no-x":
        center_x = 48
        center_y = 47
        offset = 20 if variant == "oversized-x" else 11
        width = 12 if variant == "oversized-x" else 7
        radius = width / 2
        endpoints = (
            (center_x - offset, center_y - offset),
            (center_x + offset, center_y + offset),
            (center_x - offset, center_y + offset),
            (center_x + offset, center_y - offset),
        )
        draw.line((*endpoints[0], *endpoints[1]), fill="white", width=width)
        draw.line((*endpoints[2], *endpoints[3]), fill="white", width=width)
        for x, y in endpoints:
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill="white",
            )
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
        _assert_fail_icon_design(_render_icon_crop(page, fail_rect), kind)

        assert _summary_has_count(page, "Pass", 1), f"{kind} summary does not show Pass = 1"
        assert _summary_has_count(page, "Fail", 1), f"{kind} summary does not show Fail = 1"


def test_cat5e_three_digit_console_label_renders_with_fail_icon(tmp_path: Path) -> None:
    template = ROOT / "assets/M138-DE46-OOB-Cat5e.pdf"
    output = tmp_path / "cat5e-console-fail.pdf"
    records = [
        {
            "id": "cat5e-red-1",
            "cable_label": "#1",
            "cable_number": "1",
            "limit": "TIA - Cat 5e Channel",
            "result": "PASS",
            "length": 20.0,
            "next_margin": 10.0,
            "date_time": "15-05-2026 09:00:00 AM",
        },
        {
            "id": "cat5e-console-123",
            "cable_label": "#123(console)",
            "cable_number": "123",
            "limit": "TIA - Cat 5e Channel",
            "result": "FAIL",
            "length": 21.0,
            "next_margin": 10.0,
            "date_time": "15-05-2026 09:00:30 AM",
        },
    ]

    result = edit_report(template, output, records, "M138-DE46")
    assert result.output == output
    assert result.records == 2

    with fitz.open(output) as document:
        assert document.is_repaired is False
        page = document[0]
        label_spans = [
            span
            for block in page.get_text("dict").get("blocks", [])
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            if span.get("text") == "#123(console)"
        ]
        assert len(label_spans) == 1
        assert label_spans[0]["bbox"][2] <= 190.25
        assert label_spans[0]["size"] >= 4.5

        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        page_image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
        pass_rect = CASES[0][2]
        fail_rect = pass_rect + (0, 15, 0, 15)
        pass_red, pass_green = _dominant_pixel_counts(_crop(page_image, pass_rect))
        fail_red, fail_green = _dominant_pixel_counts(_crop(page_image, fail_rect))
        assert pass_green >= 80
        assert pass_red <= 10
        assert fail_red >= 80
        assert fail_green <= 10
        _assert_fail_icon_design(
            _render_icon_crop(page, fail_rect),
            "cat5e console",
        )
        assert _summary_has_count(page, "Pass", 1)
        assert _summary_has_count(page, "Fail", 1)


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
        _assert_fail_icon_design(
            _render_icon_crop(page, fail_rect),
            "LC data-page",
        )
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
        ("wrong-red", "reference #EC1C24 red core"),
        ("missing-ring", "reference #D0D2D3 gray outer ring"),
        ("oversized-x", "reference-sized white X"),
        ("no-x", "centered white X"),
    ],
)
def test_fail_icon_contract_rejects_invalid_raster(
    variant: str,
    error_pattern: str,
) -> None:
    with pytest.raises(AssertionError, match=error_pattern):
        _assert_fail_icon_design(_synthetic_fail_icon(variant), variant)
