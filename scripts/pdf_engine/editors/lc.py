"""LC template PDF editor."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
from typing import Sequence

import fitz

from ..cid import _fix_lc_template_date
from ..layout import (
    _apply_redacts_and_inserts,
    _cover_rect,
    _draw_failed_result_icons,
    _expanded_rect,
    _format_lc_datetime,
    _format_lc_label,
    _format_pdf_value,
    _get_lc_rows,
    _insert_text_items,
    _iter_page_spans,
    _queue_lc_site_update,
    _queue_page_number_update,
    _redraw_lc_data_outline,
    _replace_template_datetimes,
    _rewrite_lc_datetimes,
    _row_clear_rect,
    save_pdf_compact as _save_pdf_compact,
)
from ..summary import (
    _clear_summary_body,
    _safe_float,
    draw_final_footer as _draw_final_footer,
    draw_lc_summary_boxes as _draw_lc_summary_boxes,
)
from ..types import CableRecordPayload, PdfEditResult


def _fill_lc_data_page(page, page_records, site, page_num):
    rows = _get_lc_rows(page)
    redacts = []
    inserts = []

    _queue_lc_site_update(page, site, redacts, inserts)
    _queue_page_number_update(page, page_num, redacts, inserts)

    for row_idx, row in enumerate(rows):
        if row_idx >= len(page_records):
            redacts.append(_row_clear_rect(row))
            continue

        record = page_records[row_idx]
        values = {
            "cable_label": _format_lc_label(record),
            "limit": str(record.get("limit") or "Link Validation"),
            "length": _format_pdf_value(record.get("length")),
            "next_margin": _format_pdf_value(record.get("next_margin")),
            "date_time": _format_lc_datetime(record),
        }

        for field_name in ["cable_label", "limit", "length", "next_margin", "date_time"]:
            if field_name == "date_time":
                continue
            field = row.get(field_name)
            if not field:
                continue
            redacts.append(_expanded_rect(field["bbox"], 1.2, 1.0))
            baseline = field["origin"][1] if field.get("origin") else field["bbox"][3]
            inserts.append({
                "x": field["bbox"][0],
                "y": baseline,
                "text": values[field_name],
                "size": field["size"],
                "font": "calibri",
            })

    for rect in redacts:
        _cover_rect(page, rect)

    _insert_text_items(page, inserts)
    _replace_template_datetimes(page, page_records)
    _rewrite_lc_datetimes(page, rows, page_records)
    _redraw_lc_data_outline(page)
    _draw_failed_result_icons(page, page_records, "lc")
    return len(page_records)


def _fill_lc_summary_page(page, page_records, all_records, site, page_num):
    redacts = []
    inserts = []
    rows = _get_lc_rows(page, max_y=440)
    _queue_lc_site_update(page, site, redacts, inserts)

    fail_count = sum(1 for record in all_records if str(record.get("result", "")).strip().upper() == "FAIL")
    pass_count = len(all_records) - fail_count
    total_length = sum(_safe_float(record.get("length")) for record in all_records)
    total_length_str = _format_pdf_value(total_length)

    if not page_records:
        _clear_summary_body(page)
        _draw_lc_summary_boxes(page, 55.0, site, pass_count, fail_count, total_length_str)
        _draw_final_footer(page, page)
        return

    for row_idx, row in enumerate(rows):
        if row_idx >= len(page_records):
            redacts.append(_row_clear_rect(row))
            continue

        record = page_records[row_idx]
        values = {
            "cable_label": _format_lc_label(record),
            "limit": str(record.get("limit") or "Link Validation"),
            "length": _format_pdf_value(record.get("length")),
            "next_margin": _format_pdf_value(record.get("next_margin")),
            "date_time": _format_lc_datetime(record),
        }

        for field_name in ["cable_label", "limit", "length", "next_margin", "date_time"]:
            if field_name == "date_time":
                continue
            field = row.get(field_name)
            if not field:
                continue
            redacts.append(_expanded_rect(field["bbox"], 1.2, 1.0))
            baseline = field["origin"][1] if field.get("origin") else field["bbox"][3]
            inserts.append({
                "x": field["bbox"][0],
                "y": baseline,
                "text": values[field_name],
                "size": field["size"],
                "font": "calibri",
            })

    last_row = rows[len(page_records) - 1]
    data_bottom_y = last_row["baseline"] + 8.53
    first_summary_top = data_bottom_y + 6.23

    # Remove the unused lower part of the original data rectangle and the old
    # fixed-position summary boxes. They will be redrawn immediately below the
    # final populated row.
    redacts.append(fitz.Rect(8.5, data_bottom_y - 0.4, 576.5, 523.5))

    spans = _iter_page_spans(page)
    for span in spans:
        text = span["text"]
        baseline = span["origin"][1] if span.get("origin") else span["bbox"][3]

        if text.startswith("Printed:"):
            printed_text = f"Printed: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}"
            redacts.append(_expanded_rect(span["bbox"], 2.0, 1.0))
            inserts.append({
                "x": span["bbox"][0],
                "y": baseline,
                "text": printed_text,
                "size": span["size"],
                "font": "calibri-bold",
            })

    _apply_redacts_and_inserts(page, redacts, inserts)
    _replace_template_datetimes(page, page_records)
    _rewrite_lc_datetimes(page, rows, page_records)
    _redraw_lc_data_outline(page, data_bottom_y)
    _draw_failed_result_icons(page, page_records, "lc")
    _draw_lc_summary_boxes(page, first_summary_top, site, pass_count, fail_count, total_length_str)
    _draw_final_footer(page, page)


def edit_lc_pdf(
    input_path: Path,
    output_path: Path,
    records: Sequence[CableRecordPayload],
    site: str | None,
) -> PdfEditResult:
    """Fill an LC template and return the stable engine result contract."""
    input_path = Path(input_path)
    output_path = Path(output_path)
    template_doc = fitz.open(input_path)
    doc = fitz.open()

    try:
        _fix_lc_template_date(template_doc)
        rows_per_page = max(len(_get_lc_rows(template_doc[0])), 1)
        summary_rows = max(len(_get_lc_rows(template_doc[-1], max_y=440)), 1)
        total_records = len(records)
        template_data_pages = max(1, len(template_doc) - 1)
        data_pages_needed = max(
            0,
            (max(0, total_records - summary_rows) + rows_per_page - 1)
            // rows_per_page,
        )
        summary_start_idx = min(total_records, data_pages_needed * rows_per_page)
        summary_records = records[summary_start_idx:]

        print("[INFO] : LC", file=sys.stderr)
        print(f"[INFO] LC rows/page: {rows_per_page}", file=sys.stderr)
        print(f"[INFO] LC summary rows/page: {summary_rows}", file=sys.stderr)
        print(
            f"[INFO] LC data pages needed before summary: {data_pages_needed}",
            file=sys.stderr,
        )

        for page_idx in range(data_pages_needed):
            source_page = min(page_idx, template_data_pages - 1)
            doc.insert_pdf(template_doc, from_page=source_page, to_page=source_page)
            page = doc[-1]
            start = page_idx * rows_per_page
            page_records = records[start:start + rows_per_page]
            _fill_lc_data_page(page, page_records, site, page_idx + 1)

        doc.insert_pdf(
            template_doc,
            from_page=len(template_doc) - 1,
            to_page=len(template_doc) - 1,
        )
        _fill_lc_summary_page(
            doc[-1],
            summary_records,
            records,
            site,
            data_pages_needed + 1,
        )

        _save_pdf_compact(doc, output_path)
    finally:
        doc.close()
        template_doc.close()

    return PdfEditResult(
        output=output_path,
        pages=data_pages_needed + 1,
        records=len(records),
    )
