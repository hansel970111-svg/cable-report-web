"""Shared mechanics for Cat5e and MPO PDF editors."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Literal, Sequence

import fitz

from ..cid import (
    _fix_f2_cmap_for_dates,
    _get_date_positions_before_redaction,
    replace_cable_labels_in_page_stream,
    replace_dates_in_tj_format,
    replace_limits_in_page_stream,
    replace_times_in_page_stream,
)
from ..layout import (
    FONT_SIZE_FACTOR,
    _apply_redacts_and_inserts,
    _draw_clear_rects,
    _draw_failed_result_icons,
    _draw_site_header,
    _field_baseline,
    _field_size,
    _insert_text_items,
    _redraw_outline,
    _split_pdf_datetime,
    _text_width_for_insert,
    clear_row_images,
    get_field_positions,
    save_pdf_compact as _save_pdf_compact,
)
from ..summary import (
    _finish_empty_non_lc_summary_page,
    _finish_non_lc_summary_page,
    _get_data_outline_rect,
    _summary_rows_capacity,
    draw_final_footer as _draw_final_footer,
)
from ..types import CableRecordPayload, PdfEditResult


DATA_TEMPLATE_PAGE = 1


def fill_page(page, records, start_idx, page_num, is_last_data_page=False):
    """


    Args:
        page: PDF
        records:
        start_idx:
        page_num: ()
        is_last_data_page: ()

    Returns:
        int:
    """
    #  Limit ()
    # Save all records for later use (in case records is a slice)
    all_records_for_dates = list(records)
    fill_page._limit_rows = []

    #  get_field_positions ,
    import re
    contents_before = page.get_contents()
    if contents_before:
        content_xref = contents_before[0]
        doc = page.parent
        stream = doc.xref_stream(content_xref)
        if stream:
            stream_text = stream.decode('latin-1', errors='replace')
            #
            date_pattern = re.compile(rb'<03[0-9A-Fa-f]{38}>Tj', re.IGNORECASE)
            date_matches = list(re.finditer(date_pattern, stream_text.encode('latin-1')))
            date_count_before = len(date_matches)
            print(f"[DEBUG] fill_page : ={date_count_before}", file=sys.stderr)

    field_positions, is_mpo_template = get_field_positions(page)
    print(f"[DEBUG fill_page] get_field_positions {len(field_positions)} ", file=sys.stderr)
    if not field_positions:
        return 0

    #  get_field_positions ,
    contents_after = page.get_contents()
    if contents_after:
        content_xref = contents_after[0]
        doc = page.parent
        stream = doc.xref_stream(content_xref)
        if stream:
            stream_text = stream.decode('latin-1', errors='replace')
            #
            date_pattern = re.compile(rb'<03[0-9A-Fa-f]{38}>Tj', re.IGNORECASE)
            date_matches = list(re.finditer(date_pattern, stream_text.encode('latin-1')))
            date_count_after = len(date_matches)
            print(f"[DEBUG] fill_page get_field_positions: xref={content_xref}, ={date_count_after}", file=sys.stderr)

    # : y
    def get_insert_y(field):
        """originy"""
        if field.get('origin'):
            return field['origin'][1]
        # : 8pt, origin.y  bbox[3] - 2.5
        return field['bbox'][3] - 2.5

    # redact
    redact_rects = []
    date_rects = []  # Track date rects separately
    inserts = []
    processed = 0
    first_empty_row = -1  #
    max_records_on_page = len(records) - start_idx  #

    for row_idx, fields in enumerate(field_positions):
        record_idx = start_idx + row_idx

        if record_idx >= len(records):
            #  - , limit
            for field_name in ['cable_label', 'limit', 'length', 'next_margin', 'date', 'time']:
                if field_name in fields:
                    redact_rects.append(fitz.Rect(fields[field_name]['bbox']))

            #
            if first_empty_row < 0:
                first_empty_row = row_idx
            continue

        record = records[record_idx]
        processed += 1  #

        # Cable Label -  CID (has been)
        # :  redaction,  CID has been
        #  redaction, page.clean_contents()  CID
        # if 'cable_label' in fields:
        #     field = fields['cable_label']
        #     redact_rects.append(fitz.Rect(field['bbox']))

        # Limit -  CID ( Calibri )
        # :  redaction  insert,  apply_redactions()
        #  replace_limits_in_page_stream  CID
        #
        if 'limit' in fields:
            record = records[record_idx] if record_idx < len(records) else None
            if record and record.get('limit'):
                #  Limit
                if not hasattr(fill_page, '_limit_rows'):
                    fill_page._limit_rows = []
                fill_page._limit_rows.append((row_idx, record.get('limit', '')))

        # Length - MPO,
        if 'length' in fields:
            field = fields['length']
            # MPO: Length"-", ,
            if is_mpo_template:
                print(f"[INFO] MPO{row_idx+1}: Length(: '-')", file=sys.stderr)
                # redact_rectsinserts,
            else:
                # Cat5e: Length
                redact_rects.append(fitz.Rect(field['bbox']))
                length = record.get('length', 0)
                if isinstance(length, (int, float)):
                    length_str = str(int(length)) if length == int(length) else f"{length:.1f}"
                else:
                    length_str = str(length)
                inserts.append({
                    'x': field['bbox'][0],
                    'y': get_insert_y(field),
                    'text': length_str,
                    'size': field['size'],
                    'font': 'calibri'
                })

        # NEXT Margin - MPO,
        if 'next_margin' in fields:
            field = fields['next_margin']
            # MPO: Margin"-", ,
            if is_mpo_template:
                print(f"[INFO] MPO{row_idx+1}: Margin(: '-')", file=sys.stderr)
                # redact_rectsinserts,
            else:
                # Cat5e: Margin
                redact_rects.append(fitz.Rect(field['bbox']))
                margin = record.get('next_margin', 0)
                margin_str = f"{float(margin):.1f}" if isinstance(margin, (int, float)) else str(margin)
                inserts.append({
                    'x': field['bbox'][0],
                    'y': get_insert_y(field),
                    'text': margin_str,
                    'size': field['size'],
                    'font': 'calibri'
                })

        # Date & Time - CID(Calibri)
        # Add redaction for date field to clear old text before redrawing
        # Track date rects separately so we can skip them if dates are replaced in content stream
        if 'date' in fields and record_idx < len(records):
            field = fields['date']
            date_rects.append(fitz.Rect(field['bbox']))

    #  - ()
    page_areas = page.search_for("Page :")
    for area in page_areas:
        #
        expanded_area = fitz.Rect(area.x0, area.y0, 590, area.y1)
        redact_rects.append(expanded_area)

    #
    if first_empty_row >= 0:
        clear_row_images(page, first_empty_row, len(field_positions), is_mpo_template)

    # :  apply_redactions()  CID
    #  clean_contents()  /TouchUp_TextEdit MP  CID
    # Cable Label  CID ,  clean_contents()
    if processed > 0:
        # xref
        contents_before_cid = page.get_contents()
        xref_before = contents_before_cid[0] if contents_before_cid else None
        doc = page.parent
        xref_len = doc.xref_length()
        stream_before = doc.xref_stream(xref_before) if xref_before else None
        stream_len_before = len(stream_before) if stream_before else 0
        print(f"[DEBUG fill_page:{page_num}] CID: xref={xref_before}, xref_length={xref_len}, valid={xref_before < xref_len if xref_before else False}, stream_len={stream_len_before}", file=sys.stderr)

        page_records = records[start_idx:start_idx + processed]
        print(f"[DEBUG fill_page:{page_num}] page_records={len(page_records)}", file=sys.stderr)

        #  Cable Label CID ( clean_contents )
        replace_result = replace_cable_labels_in_page_stream(page, page_records, 0)
        print(f"[DEBUG fill_page:{page_num}] Cable Label: {replace_result}", file=sys.stderr)
        if replace_result == 0 and processed > 0:
            # CID,
            contents = page.get_contents()
            xref = contents[0] if contents else None
            stream = doc.xref_stream(xref) if xref else None
            print(f"[DEBUG fill_page:{page_num}] CID: xref={xref}, stream={len(stream) if stream else 0}", file=sys.stderr)

        # Limit (, )
        if hasattr(fill_page, '_limit_rows') and fill_page._limit_rows:
            limit_records = [{'limit': limit} for _, limit in fill_page._limit_rows]
            replace_limits_in_page_stream(page, limit_records, 0, is_mpo_template)
            fill_page._limit_rows = []
        # Times stay in the template's own text streams so the original
        # Calibri positioning and spacing are preserved.
        replace_times_in_page_stream(
            page,
            page_records,
            0,
            std_tj_record_offset=1 if is_mpo_template else 0,
        )

        # Dates: Replace BEFORE redaction using Tj format to preserve Calibri font
        # Step 1: Fix C2_2 font's FontFile2 to add missing glyph data (digits 4,5,7,8,9)
        # DISABLED - causes MuPDF rendering errors
        # _fix_missing_glyphs_in_font(page.parent)
        # Step 2: Fix CMap mappings for digits
        _fix_f2_cmap_for_dates(page.parent)
        # Step 3: Replace dates in Tj format
        dates_replaced = replace_dates_in_tj_format(page, page_records, 0)
        if dates_replaced > 0:
            print(f"[DEBUG fill_page:{page_num}] Dates: replaced {dates_replaced} in Tj format (Calibri font preserved)", file=sys.stderr)

        # Get date positions BEFORE redaction for later drawing
        # Re-get date positions AFTER redaction to ensure they're up to date
        date_positions = _get_date_positions_before_redaction(page)
        if hasattr(_get_date_positions_before_redaction, '_debug'):
            _get_date_positions_before_redaction._debug = True
        print(f"[DEBUG fill_page:{page_num}] date_positions count: {len(date_positions)}", file=sys.stderr)

    # Apply redaction for non-date rects only
    # Skip date rects since dates are replaced directly in content stream
    clear_rects = []
    for rect in redact_rects:
        if rect not in date_rects:
            clear_rects.append(rect)

    # Do NOT redact date rects - dates are already replaced in content stream (preserves Calibri font)
    # Skip redaction for dates
    _draw_clear_rects(page, clear_rects)

    # Dates are already replaced - no need to redraw

    # :  clean_contents(),  ToUnicode
    #  CID ()
    # page.clean_contents()

    #
    text_inserts = []
    for item in inserts:
        font = item.get('font', 'helv')  # Helvetica

        # ()
        col_width = item.get('col_width')
        if col_width and font == 'helv':
            #
            #
            import math
            target_width = col_width
            font_obj = fitz.Font(font)

            #
            min_size = 5.0
            max_size = 10.0

            for _ in range(20):  # 20
                mid_size = (min_size + max_size) / 2
                width = font_obj.text_length(item['text'], fontsize=mid_size)
                if width < target_width:
                    min_size = mid_size
                else:
                    max_size = mid_size

            #
            adjusted_size = (min_size + max_size) / 2
        else:
            #  Calibri 8pt
            # Helvetica 7.5pt  Calibri 8pt
            adjusted_size = item['size'] * FONT_SIZE_FACTOR

        text_inserts.append({
            "x": item["x"],
            "y": item["y"],
            "text": item["text"],
            "size": adjusted_size,
            "font": font,
        })

    #  -
    #  Page  Calibri 8pt(,  Bold)
    # Carlito  Calibri ,  8.0pt
    text_inserts.append({
        "x": 550,
        "y": 826.6,  # 826.6 = 819.4 + 7.2()
        "text": f"Page : {page_num}",
        "font": "calibri",  # Carlito-Regular
        "size": 8.0,  #  Calibri 8pt
    })
    _insert_text_items(page, text_inserts)

    template_kind = "mpo" if is_mpo_template else "cat5e"
    _draw_failed_result_icons(
        page,
        records[start_idx:start_idx + processed],
        template_kind,
    )

    # :  clean_contents(),  ToUnicode
    # page.clean_contents()

    return processed


def _rewrite_non_lc_datetimes(page, fields, page_records, is_mpo_template=False):
    """Rewrite visible Date & Time text and remove any stale template fragments."""
    redacts = []
    inserts = []

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(fields):
            break

        row = fields[row_idx]
        date_field = row.get("date")
        time_field = row.get("time")
        if not date_field and not time_field:
            continue

        date_part, time_part = _split_pdf_datetime(record)
        row_fields = [item for item in [date_field, time_field] if item]
        y0 = min(item["bbox"][1] for item in row_fields)
        y1 = max(item["bbox"][3] for item in row_fields)
        baseline = (
            (date_field.get("origin")[1] if date_field and date_field.get("origin") else None)
            or (time_field.get("origin")[1] if time_field and time_field.get("origin") else None)
            or y1
        )

        if is_mpo_template:
            clear_x0, clear_x1 = 274.0, 430.0
            fallback_date_x = 280.6
        else:
            clear_x0, clear_x1 = 425.0, 586.0
            fallback_date_x = 430.0

        redacts.append(fitz.Rect(clear_x0, y0 - 1.1, clear_x1, y1 + 1.1))

        if date_field and time_field:
            date_size = _field_size(date_field)
            time_size = _field_size(time_field)
            if date_part:
                inserts.append({
                    "x": date_field["bbox"][0],
                    "y": date_field.get("origin", (None, baseline))[1] if date_field.get("origin") else baseline,
                    "text": date_part,
                    "size": date_size,
                    "font": "calibri",
                })
            if time_part:
                time_x = time_field["bbox"][0]
                if date_part:
                    min_time_x = date_field["bbox"][0] + _text_width_for_insert("calibri", date_part, date_size) + 2.0
                    time_x = max(time_x, min_time_x)
                inserts.append({
                    "x": time_x,
                    "y": time_field.get("origin", (None, baseline))[1] if time_field.get("origin") else baseline,
                    "text": time_part,
                    "size": time_size,
                    "font": "calibri",
                })
        else:
            datetime_text = f"{date_part} {time_part}".strip()
            if datetime_text:
                inserts.append({
                    "x": date_field["bbox"][0] if date_field else fallback_date_x,
                    "y": baseline,
                    "text": datetime_text,
                    "size": _field_size(date_field, time_field),
                    "font": "calibri",
                })
    _apply_redacts_and_inserts(page, redacts, inserts)


def _rewrite_non_lc_cable_labels(page, fields, page_records, is_mpo_template=False):
    """Rewrite Cable Label values as real text instead of limited CID digits."""
    redacts = []
    inserts = []
    clear_x1 = 92.0 if is_mpo_template else 190.0

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(fields):
            break

        field = fields[row_idx].get("cable_label")
        if not field:
            continue

        label = str(record.get("cable_label") or record.get("cable_number") or "").strip()
        if not label:
            continue

        bbox = fitz.Rect(field["bbox"])
        redacts.append(fitz.Rect(max(0.0, bbox.x0 - 1.4), bbox.y0 - 1.0, clear_x1, bbox.y1 + 1.0))
        inserts.append({
            "x": bbox.x0,
            "y": _field_baseline(field),
            "text": label,
            "size": _field_size(field),
            "font": "calibri",
        })

    _apply_redacts_and_inserts(page, redacts, inserts)


def edit_non_lc_pdf(
    input_path: Path,
    output_path: Path,
    records: Sequence[CableRecordPayload],
    site: str | None,
    template_kind: Literal["cat5e", "mpo"],
) -> PdfEditResult:
    """Fill a Cat5e or MPO template using the shared non-LC mechanics."""
    input_path = Path(input_path)
    output_path = Path(output_path)
    template_doc = fitz.open(input_path)
    doc = fitz.open()

    try:
        is_mpo_template = template_kind == "mpo"

        data_template_page = DATA_TEMPLATE_PAGE if len(template_doc) > DATA_TEMPLATE_PAGE + 1 else 0
        template_fields, _ = get_field_positions(template_doc[data_template_page])
        if not template_fields:
            template_fields, _ = get_field_positions(template_doc[0])
            data_template_page = 0

        rows_per_page = max(1, len(template_fields))
        table_rect = _get_data_outline_rect(template_doc[data_template_page], default_bottom=810.0 if is_mpo_template else 800.7659912109375)
        summary_rows = _summary_rows_capacity(template_fields, table_rect)
        summary_rows = max(0, min(summary_rows, rows_per_page))

        total_records = len(records)
        data_pages_needed = max(0, (max(0, total_records - summary_rows) + rows_per_page - 1) // rows_per_page)
        summary_start_idx = min(total_records, data_pages_needed * rows_per_page)

        print(f"[INFO] : {'MPO' if is_mpo_template else 'Cat5e'}", file=sys.stderr)
        print(f"[INFO] rows/page: {rows_per_page}", file=sys.stderr)
        print(f"[INFO] summary rows/page: {summary_rows}", file=sys.stderr)
        print(f"[INFO] data pages before summary: {data_pages_needed}", file=sys.stderr)

        for page_idx in range(data_pages_needed):
            source_page = 0 if page_idx == 0 else data_template_page
            doc.insert_pdf(template_doc, from_page=source_page, to_page=source_page)
            page = doc[-1]
            start = page_idx * rows_per_page
            fields_for_page, _ = get_field_positions(page)
            processed = fill_page(page, records, start, page_idx + 1)
            page_records = records[start:start + processed]
            _rewrite_non_lc_cable_labels(page, fields_for_page, page_records, is_mpo_template)
            _rewrite_non_lc_datetimes(page, fields_for_page, page_records, is_mpo_template)
            _redraw_outline(page, _get_data_outline_rect(page, default_bottom=810.0 if is_mpo_template else 800.7659912109375), width=1.0)
            if page_idx == 0 and site:
                _draw_site_header(page, site)

        summary_record_count = total_records - summary_start_idx
        final_source_page = (
            len(template_doc) - 1
            if summary_record_count == 0
            else (0 if data_pages_needed == 0 else data_template_page)
        )
        doc.insert_pdf(template_doc, from_page=final_source_page, to_page=final_source_page)
        summary_page = doc[-1]
        summary_page_num = data_pages_needed + 1
        if summary_record_count == 0:
            _finish_empty_non_lc_summary_page(summary_page, site, records, is_mpo_template)
            if site:
                _draw_site_header(summary_page, site)
        else:
            fields_for_summary, _ = get_field_positions(summary_page)
            processed = fill_page(summary_page, records, summary_start_idx, summary_page_num)
            summary_page_records = records[summary_start_idx:summary_start_idx + processed]
            _rewrite_non_lc_cable_labels(summary_page, fields_for_summary, summary_page_records, is_mpo_template)
            _rewrite_non_lc_datetimes(summary_page, fields_for_summary, summary_page_records, is_mpo_template)
            if site:
                _draw_site_header(summary_page, site)
            _finish_non_lc_summary_page(summary_page, fields_for_summary, processed, site, records, is_mpo_template)
        _draw_final_footer(summary_page, template_doc[-1])

        _save_pdf_compact(doc, output_path)
    finally:
        doc.close()
        template_doc.close()

    return PdfEditResult(
        output=output_path,
        pages=data_pages_needed + 1,
        records=total_records,
    )
