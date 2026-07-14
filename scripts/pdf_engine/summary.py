"""Summary boxes and final footer rendering for PDF reports."""

from datetime import datetime

import fitz

from pdf_engine.layout import (
    _draw_clear_rect,
    _format_pdf_value,
    _redraw_outline,
    insert_text_with_font,
)


def _safe_float(value, default=0.0):
    try:
        if value in (None, "", "-"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _draw_lc_fx_icon(page, x, y):
    page.draw_circle(fitz.Point(x, y), 5.8, color=(0.65, 0.65, 0.65), fill=(1.0, 0.86, 0.0), width=0.8)
    insert_text_with_font(
        page,
        fitz.Point(x - 3.7, y + 2.0),
        "FX",
        fontname="calibri-bold",
        fontsize=5.0,
        color=(0, 0, 0),
    )


def _insert_lc_summary_text(page, x, y, text, bold=True):
    insert_text_with_font(
        page,
        fitz.Point(x, y),
        text,
        fontname="calibri-bold" if bold else "calibri",
        fontsize=8.0,
        color=(0, 0, 0),
    )


def _footer_printed_text():
    now = datetime.now()
    return f"Printed: {now.year}/{now.month}/{now.day} {now.strftime('%H:%M:%S')}"


def _get_footer_logo_rect(footer_template_page):
    for image in footer_template_page.get_images(full=True):
        if image[2:4] != (128, 33):
            continue
        xref = image[0]
        rects = footer_template_page.get_image_rects(xref)
        footer_rects = [fitz.Rect(rect) for rect in rects if rect.y0 > 730]
        if not footer_rects:
            continue
        footer_rects.sort(key=lambda rect: (rect.y0, rect.x0))
        return footer_rects[0]
    return fitz.Rect(280.5, 819.0, 342.56, 835.0)


def _get_existing_footer_logo_xref(page):
    for image in page.get_images(full=True):
        if image[2:4] != (128, 33):
            continue
        xref = image[0]
        if any(rect.y0 > 730 for rect in page.get_image_rects(xref)):
            return xref
    return 0


def _draw_export_logo(page, logo_rect, logo_xref):
    if logo_xref:
        page.insert_image(
            logo_rect,
            xref=logo_xref,
            keep_proportion=False,
        )


def draw_final_footer(page, footer_template_page):
    logo_rect = _get_footer_logo_rect(footer_template_page)
    logo_xref = _get_existing_footer_logo_xref(page)
    _draw_clear_rect(page, fitz.Rect(0.0, 812.0, 595.0, 842.0))

    insert_text_with_font(
        page,
        fitz.Point(55.0, 825.66),
        _footer_printed_text(),
        fontname="calibri",
        fontsize=7.0,
        color=(0, 0, 0),
    )
    _draw_export_logo(page, logo_rect, logo_xref)
    insert_text_with_font(
        page,
        fitz.Point(464.33, 825.66),
        "Signature:______________________",
        fontname="calibri",
        fontsize=7.0,
        color=(0, 0, 0),
    )


def draw_lc_summary_boxes(page, top_y, site, pass_count, fail_count, total_length_str):
    first = fitz.Rect(10.0, top_y, 575.0, top_y + 35.0)
    second = fitz.Rect(10.0, top_y + 40.0, 575.0, top_y + 75.0)

    page.draw_rect(first, color=(0, 0, 0), width=1.0)
    page.draw_rect(second, color=(0, 0, 0), width=1.0)

    rows = [
        (top_y, f"Total for Site: {site or ''}"),
        (top_y + 40.0, "Total for Selected Reports"),
    ]

    for box_top, title in rows:
        header_y = box_top + 10.0
        value_y = box_top + 25.0

        _insert_lc_summary_text(page, 13.95, header_y, title)
        _insert_lc_summary_text(page, 214.0, header_y, "Pass")
        _insert_lc_summary_text(page, 334.0, header_y, "Fail")
        _insert_lc_summary_text(page, 464.0, header_y, "Length (m)")

        _draw_lc_fx_icon(page, 29.0, box_top + 22.5)
        _insert_lc_summary_text(page, 39.0, value_y, "Fiber", bold=False)
        _insert_lc_summary_text(page, 214.0, value_y, str(pass_count), bold=False)
        _insert_lc_summary_text(page, 334.0, value_y, str(fail_count), bold=False)
        _insert_lc_summary_text(page, 464.0, value_y, total_length_str, bold=False)


def _row_baseline(fields):
    for field_name in ["cable_label", "limit", "length", "next_margin", "date", "time"]:
        field = fields.get(field_name)
        if not field:
            continue
        origin = field.get("origin")
        if origin:
            return origin[1]
        return field["bbox"][3]
    return None


def _get_data_outline_rect(page, default_bottom=800.7659912109375):
    candidates = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if not rect:
            continue
        if rect.width > 500 and rect.height > 250 and 8 <= rect.x0 <= 12 and 570 <= rect.x1 <= 578:
            candidates.append(rect)
    if candidates:
        candidates.sort(key=lambda rect: rect.height, reverse=True)
        return fitz.Rect(candidates[0])
    return fitz.Rect(10.0, 74.0, 575.0, default_bottom)


def _row_bottom_padding(fields, table_rect):
    baselines = [baseline for baseline in (_row_baseline(row) for row in fields) if baseline is not None]
    if not baselines:
        return 9.0
    return max(7.0, min(11.0, table_rect.y1 - baselines[-1]))


def _summary_rows_capacity(fields, table_rect):
    row_bottom_pad = _row_bottom_padding(fields, table_rect)
    # Two 35 pt summary boxes with a 5 pt gap and 5 pt gap after the table.
    required_summary_height = 80.0
    capacity = 0
    for idx, fields_for_row in enumerate(fields):
        baseline = _row_baseline(fields_for_row)
        if baseline is None:
            continue
        data_bottom = baseline + row_bottom_pad
        if data_bottom + required_summary_height <= table_rect.y1 + 0.5:
            capacity = idx + 1
    return capacity


def _final_data_bottom_y(fields, filled_count, table_rect):
    row_bottom_pad = _row_bottom_padding(fields, table_rect)
    if filled_count > 0 and filled_count <= len(fields):
        baseline = _row_baseline(fields[filled_count - 1])
        if baseline is not None:
            return baseline + row_bottom_pad

    baselines = [baseline for baseline in (_row_baseline(row) for row in fields) if baseline is not None]
    if baselines:
        return max(table_rect.y0 + 12.0, baselines[0] - 5.0)
    return table_rect.y0 + 24.0


def _draw_media_icon(page, x, y, label, fill_color):
    page.draw_circle(fitz.Point(x, y), 5.8, color=(0.62, 0.62, 0.62), fill=fill_color, width=0.8)
    font_size = 3.6 if len(label) > 2 else 5.0
    text_x = x - (4.6 if len(label) > 2 else 3.2)
    insert_text_with_font(
        page,
        fitz.Point(text_x, y + 1.8),
        label,
        fontname="calibri-bold",
        fontsize=font_size,
        color=(1, 1, 1),
    )


def _insert_summary_text(page, x, y, text, bold=True, size=8.0):
    insert_text_with_font(
        page,
        fitz.Point(x, y),
        text,
        fontname="calibri-bold" if bold else "calibri",
        fontsize=size,
        color=(0, 0, 0),
    )


def draw_non_lc_summary_boxes(page, top_y, site, pass_count, fail_count, total_length_str, is_mpo_template):
    first = fitz.Rect(10.0, top_y, 575.0, top_y + 35.0)
    second = fitz.Rect(10.0, top_y + 40.0, 575.0, top_y + 75.0)

    page.draw_rect(first, color=(0, 0, 0), width=1.0)
    page.draw_rect(second, color=(0, 0, 0), width=1.0)

    media_name = "MPO" if is_mpo_template else "Copper"
    icon_text = "MPO" if is_mpo_template else "CU"
    icon_fill = (0.22, 0.55, 0.80) if is_mpo_template else (0.50, 0.34, 0.18)

    rows = [
        (top_y, f"Total for Site: {site or ''}"),
        (top_y + 40.0, "Total for Selected Reports"),
    ]

    for box_top, title in rows:
        header_y = box_top + 10.0
        value_y = box_top + 25.0

        _insert_summary_text(page, 13.95, header_y, title)
        _insert_summary_text(page, 214.0, header_y, "Pass")
        _insert_summary_text(page, 334.0, header_y, "Fail")
        _insert_summary_text(page, 464.0, header_y, "Length (m)")

        _draw_media_icon(page, 29.0, box_top + 22.5, icon_text, icon_fill)
        _insert_summary_text(page, 39.0, value_y, media_name, bold=False)
        _insert_summary_text(page, 214.0, value_y, str(pass_count), bold=False)
        _insert_summary_text(page, 334.0, value_y, str(fail_count), bold=False)
        _insert_summary_text(page, 464.0, value_y, total_length_str, bold=False)


def _non_lc_summary_totals(records, is_mpo_template):
    fail_count = sum(1 for record in records if str(record.get("result", "")).strip().upper() == "FAIL")
    pass_count = len(records) - fail_count
    total_length = 0.0 if is_mpo_template else sum(_safe_float(record.get("length")) for record in records)
    return pass_count, fail_count, _format_pdf_value(total_length)


def _clear_summary_body(page):
    _draw_clear_rect(page, fitz.Rect(8.5, 45.0, 576.5, 805.0))


def _finish_empty_non_lc_summary_page(page, site, records, is_mpo_template):
    _clear_summary_body(page)
    pass_count, fail_count, total_length_str = _non_lc_summary_totals(records, is_mpo_template)
    summary_top_y = 80.0 if site else 55.0
    draw_non_lc_summary_boxes(page, summary_top_y, site, pass_count, fail_count, total_length_str, is_mpo_template)


def _finish_non_lc_summary_page(page, fields, filled_count, site, records, is_mpo_template):
    table_rect = _get_data_outline_rect(page, default_bottom=810.0 if is_mpo_template else 800.7659912109375)
    data_bottom_y = _final_data_bottom_y(fields, filled_count, table_rect)
    summary_top_y = data_bottom_y + 5.0

    clear_rect = fitz.Rect(table_rect.x0 - 1.5, data_bottom_y - 0.4, table_rect.x1 + 1.5, table_rect.y1 + 1.5)
    _draw_clear_rect(page, clear_rect)

    _redraw_outline(page, fitz.Rect(table_rect.x0, table_rect.y0, table_rect.x1, data_bottom_y), width=1.0)

    pass_count, fail_count, total_length_str = _non_lc_summary_totals(records, is_mpo_template)
    draw_non_lc_summary_boxes(page, summary_top_y, site, pass_count, fail_count, total_length_str, is_mpo_template)
