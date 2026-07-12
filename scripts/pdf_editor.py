#!/usr/bin/env python3
"""PDF Editor Module."""
import sys
import re
import fitz  # PyMuPDF
import os
from datetime import datetime

from pdf_engine.cli import run_editor_cli
from pdf_engine.resources import (
    CALIBRI_BOLD_FONT,
    CALIBRI_REGULAR_FONT,
    EMBED_INSERT_FONTS,
    FONT_DIR,
    PROJECT_FONT_DIR,
    PROJECT_ROOT,
    SCRIPT_DIR,
    first_existing_path as _first_existing_path,
    font_cache as _font_cache,
    resource_path as _resource_path,
    windows_font_path as _windows_font_path,
)

# CID(PDFToUnicode)
# PDFCalibriToUnicode
# C2_2
from pdf_engine.cid import (
    CALIBRI_C2_1_CID_MAP,
    CALIBRI_C2_2_CID_MAP,
    CALIBRI_C2_3_CID_MAP,
    CALIBRI_CID_MAP,
    CABLE_CHAR_TO_CID,
    CABLE_LABEL_CID,
    CAT5E_LIMIT_CHAR_TO_CID,
    DATE_CHAR_TO_CID,
    LIMIT_CHAR_TO_CID,
    LIMIT_CID_TO_CHAR,
    TIME_CHAR_TO_CID,
    _decode_mpo_limit_cid,
    _draw_dates_at_positions,
    _fit_cid_to_hex_length,
    _fix_f2_cmap_for_dates,
    _fix_lc_template_date,
    _fix_missing_glyphs_in_font,
    _get_date_positions_after_redaction,
    _get_date_positions_before_redaction,
    cable_label_to_cid,
    date_to_cid_hex,
    replace_cable_labels_in_page_stream,
    replace_dates_in_page_stream,
    replace_dates_in_tj_format,
    replace_dates_times_with_text_drawing,
    replace_limits_in_page_stream,
    replace_site_in_page_stream,
    replace_times_in_page_stream,
    site_text_to_cid,
    site_text_to_cid_c2_2,
    text_to_cable_cid,
    text_to_cid_hex,
    text_to_cid_hex_lc_style,
    text_to_limit_cid,
    time_to_cid_hex,
)


#
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'assets', 'M138-DE46-OOB-Cat5e.pdf')

# (MPO: 48, Cat5e: 46)
ROWS_PER_PAGE = 48

# (2, 1)
DATA_TEMPLATE_PAGE = 1

# Calibri
#  Calibri
from pdf_engine.layout import (
    CARLITO_BOLD,
    CARLITO_REGULAR,
    DEFAULT_FONT_SIZE,
    FONT_NAME_MAP,
    FONT_SIZE_FACTOR,
    _FAIL_ICON_RED,
    _PAGE_FONT_CACHE,
    _RESULT_ICON_FIRST_RECTS,
    _RESULT_ICON_ROW_PITCH,
    _TEXTWRITER_FONT_CACHE,
    _apply_redacts_and_inserts,
    _cover_rect,
    _draw_clear_rect,
    _draw_clear_rects,
    _draw_fail_result_icon,
    _draw_failed_result_icons,
    _draw_site_header,
    _expanded_rect,
    _field_baseline,
    _field_size,
    _format_lc_datetime,
    _format_lc_label,
    _format_pdf_value,
    _get_lc_rows,
    _get_textwriter_font,
    _insert_text_items,
    _iter_page_spans,
    _page_font_key,
    _queue_lc_site_update,
    _queue_page_number_update,
    _queue_site_header_update,
    _redraw_lc_data_outline,
    _redraw_outline,
    _replace_template_datetimes,
    _result_icon_rect,
    _rewrite_lc_datetimes,
    _row_clear_rect,
    _split_pdf_datetime,
    _text_width_for_insert,
    clear_row_images,
    detect_template_kind,
    get_field_positions,
    insert_text_with_font,
    save_pdf_compact as _save_pdf_compact,
)




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

            # ()
            clear_row_images(page, row_idx, row_idx + 1, is_mpo_template)

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


from pdf_engine.summary import (
    _clear_summary_body,
    _draw_export_logo,
    _draw_lc_fx_icon,
    _draw_media_icon,
    _final_data_bottom_y,
    _finish_empty_non_lc_summary_page,
    _finish_non_lc_summary_page,
    _footer_printed_text,
    _get_data_outline_rect,
    _get_footer_logo_rect,
    _insert_lc_summary_text,
    _insert_summary_text,
    _non_lc_summary_totals,
    _render_footer_logo_stream,
    _row_baseline,
    _row_bottom_padding,
    _safe_float,
    _summary_rows_capacity,
    draw_final_footer as _draw_final_footer,
    draw_lc_summary_boxes as _draw_lc_summary_boxes,
    draw_non_lc_summary_boxes as _draw_non_lc_summary_boxes,
)


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


def edit_non_lc_pdf(input_path, output_path, records, site=None, template_kind='cat5e'):
    """Fill MPO/Cat5e templates and place totals under the final data row."""
    try:
        template_doc = fitz.open(input_path)
        doc = fitz.open()
        is_mpo_template = template_kind == 'mpo'

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
        doc.close()
        template_doc.close()

        return {
            'success': True,
            'method': 'table_summary_fill',
            'records_processed': total_records,
            'pages_used': data_pages_needed + 1,
            'output_path': output_path
        }
    except Exception:
        print("[ERROR] PDF rendering failed", file=sys.stderr)
        return {'error': 'PDF rendering failed'}


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

    if page_records:
        last_row = rows[len(page_records) - 1]
        data_bottom_y = last_row["baseline"] + 8.53
    else:
        data_bottom_y = 110.0

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


def edit_lc_pdf(input_path, output_path, records, site=None):
    """Fill the LC template without using MPO/Cat5e column assumptions."""
    try:
        template_doc = fitz.open(input_path)
        _fix_lc_template_date(template_doc)
        doc = fitz.open()

        rows_per_page = len(_get_lc_rows(template_doc[0]))
        rows_per_page = max(rows_per_page, 1)
        summary_rows = len(_get_lc_rows(template_doc[-1], max_y=440))
        summary_rows = max(summary_rows, 1)
        total_records = len(records)
        template_data_pages = max(1, len(template_doc) - 1)
        data_pages_needed = max(0, (max(0, total_records - summary_rows) + rows_per_page - 1) // rows_per_page)
        summary_start_idx = min(total_records, data_pages_needed * rows_per_page)
        summary_records = records[summary_start_idx:]

        print(f"[INFO] : LC", file=sys.stderr)
        print(f"[INFO] LC rows/page: {rows_per_page}", file=sys.stderr)
        print(f"[INFO] LC summary rows/page: {summary_rows}", file=sys.stderr)
        print(f"[INFO] LC data pages needed before summary: {data_pages_needed}", file=sys.stderr)

        for page_idx in range(data_pages_needed):
            source_page = min(page_idx, template_data_pages - 1)
            doc.insert_pdf(template_doc, from_page=source_page, to_page=source_page)
            page = doc[-1]
            start = page_idx * rows_per_page
            page_records = records[start:start + rows_per_page]
            _fill_lc_data_page(page, page_records, site, page_idx + 1)

        doc.insert_pdf(template_doc, from_page=len(template_doc) - 1, to_page=len(template_doc) - 1)
        _fill_lc_summary_page(doc[-1], summary_records, records, site, data_pages_needed + 1)

        _save_pdf_compact(doc, output_path)
        doc.close()
        template_doc.close()

        return {
            'success': True,
            'method': 'lc_template_fill',
            'records_processed': total_records,
            'pages_used': data_pages_needed + 1,
            'output_path': output_path
        }
    except Exception:
        print("[ERROR] PDF rendering failed", file=sys.stderr)
        return {'error': 'PDF rendering failed'}


def edit_pdf(input_path, output_path, records, site=None):
    """Edit PDF template with test records.

    Args:
        input_path: Input PDF path.
        output_path: Output PDF path.
        records: List of test records.
        site: Site identifier.

    Returns:
        dict: Result dictionary.
    """
    try:
        template_doc = fitz.open(input_path)
        template_kind = detect_template_kind(template_doc)
        if template_kind == 'lc':
            template_doc.close()
            return edit_lc_pdf(input_path, output_path, records, site)
        if template_kind in ('mpo', 'cat5e'):
            template_doc.close()
            return edit_non_lc_pdf(input_path, output_path, records, site, template_kind)

        doc = fitz.open()
        is_mpo_template = template_kind == 'mpo'

        print(f"[INFO] : {'MPO' if is_mpo_template else 'Cat5e'}", file=sys.stderr)

        # 
        # MPO, 
        # Detect template_data_pages BEFORE inserting template_doc to avoid cache issues
        import re
        template_data_pages = 0
        for i in range(len(template_doc) - 1):  # Exclude summary page
            page = template_doc[i]
            contents = page.get_contents()
            has_data_rows = False
            for xref in contents:
                stream = template_doc.xref_stream(xref)
                if stream:
                    text = stream.decode('latin-1', errors='replace')
                    # Check for Cable Label patterns in stream
                    if re.search(r'\(#[0-9]{3,}\)', text):  # e.g., (#1122)
                        has_data_rows = True
                        break
            if has_data_rows:
                template_data_pages = i + 1  # (0, +1)
                print(f"[DEBUG] {i} (template_data_pages={template_data_pages})", file=sys.stderr)

        # Fix corrupted date Tj in template_doc page 1 (if LC template)
        # Page 1 of LC template has corrupted date Tj (37 chars) instead of correct 45 chars
        # This is a template issue that needs to be fixed before inserting
        _fix_lc_template_date(template_doc)

        # 
        doc.insert_pdf(template_doc)
        # template_doc, 

        total_records = len(records)
        record_idx = 0
        page_num = 0

        # ()
        summary_page_idx = len(doc) - 1

        print(f"[INFO] PDF,  {total_records} ", file=sys.stderr)
        print(f"[INFO]  {ROWS_PER_PAGE} ", file=sys.stderr)
        print(f"[INFO] : {template_data_pages}", file=sys.stderr)
        print(f"[INFO] : {summary_page_idx}", file=sys.stderr)

        # 
        total_pages_needed = max(
            (total_records + ROWS_PER_PAGE - 1) // ROWS_PER_PAGE,
            template_data_pages  # 
        )

        print(f"[INFO] : {total_pages_needed}", file=sys.stderr)

        # : 
        print(f"[DEBUG] : page_num={page_num}, record_idx={record_idx}, total_records={total_records}", file=sys.stderr)

        # Site: 
        # - template_data_pages > 0, 1(doc[0])Site, while
        # - template_data_pages = 0, 1insert_pdf, Site
        
        # Site1(template_data_pages=0)
        first_page_site_info = None
        if template_data_pages == 0 and site:
            # 0Site
            template_first_page = template_doc[0]
            blocks = template_first_page.get_text("dict")["blocks"]
            for block in blocks:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    y = line["bbox"][1]
                    if 58 < y < 75:
                        for span in line["spans"]:
                            if 'Site:' in span["text"]:
                                first_page_site_info = {
                                    'origin': span.get("origin"),
                                    'bbox': span["bbox"]
                                }
                                print(f"[INFO] 1Site", file=sys.stderr)
                                break
                        if first_page_site_info:
                            break

        # 
        # : record_idx < total_records 
        while page_num < total_pages_needed:
            # : 
            print(f"[DEBUG LOOP] {page_num}: record_idx={record_idx}, processed={record_idx}", file=sys.stderr)
            
            # 
            has_records = record_idx < total_records
            
            # file or JSON 
            if not has_records:
                # 
                page = doc[page_num]
                blocks = page.get_text("dict")["blocks"]
                rows = {}
                for block in blocks:
                    if "lines" not in block:
                        continue
                    for line in block["lines"]:
                        y = round(line["bbox"][1], 0)
                        if y not in rows:
                            rows[y] = []
                        for span in line["spans"]:
                            text = span["text"].strip()
                            if text:
                                rows[y].append({
                                    'text': text,
                                    'x': span["bbox"][0],
                                    'bbox': span["bbox"],
                                    'size': span["size"],
                                    'origin': span.get("origin", None)
                                })
                
                # 
                redact_rects = []
                for y in sorted(rows.keys()):
                    spans = sorted(rows[y], key=lambda s: s['x'])
                    # Find Cable Label span (x < 90)
                    cable_label_span = None
                    for span in spans:
                        if span['x'] < 90 and span['text'].startswith('#'):
                            cable_label_span = span
                            break
                    
                    # Only clear rows that have placeholder Cable Label (not replaced by fill_page)
                    # Placeholder is "#Cable Label", replaced value is like "#354"
                    if cable_label_span:
                        text = cable_label_span['text']
                        # Check if this is a placeholder (starts with "#Cable")
                        is_placeholder = text.startswith('#Cable') or text == '#'
                        # Only redact placeholder rows
                        if is_placeholder:
                            redact_rects.append(fitz.Rect(cable_label_span['bbox']))
                
                # 
                if redact_rects:
                    for rect in redact_rects:
                        page.add_redact_annot(rect, fill=(1, 1, 1))
                    page.apply_redactions()
                
                page_num += 1
                continue
            
            # ()
            is_new_page = False
            if page_num >= template_data_pages:
                # 2(1)
                # 
                # : , 
                insert_position = page_num  # page_num
                
                
                doc.insert_pdf(template_doc, from_page=DATA_TEMPLATE_PAGE, to_page=DATA_TEMPLATE_PAGE, start_at=insert_position)
                
                # : 
                print(f"[DEBUG LOOP] : page_num={page_num}, doc.page_count={doc.page_count}", file=sys.stderr)
                contents_after = doc[page_num].get_contents()

            page = doc[page_num]

            #  fill_page ,  Cable Label CID 
            #  fill_page  apply_redactions()  CID 
            page_records_start = record_idx
            page_records = records[page_records_start:page_records_start + ROWS_PER_PAGE]
            if page_records:
                print(f"[DEBUG edit_pdf] {page_num}: page_records={len(page_records)}, record_idx={record_idx}", file=sys.stderr)

            #  fill_page 
            # :  page_records_start
            page_records_start = record_idx
            processed = fill_page(page, records, page_records_start, page_num + 1)
            
            # : fill_pageprocessed
            print(f"[DEBUG LOOP] fill_page: processed={processed}, record_idx={record_idx + processed}", file=sys.stderr)
            
            # ( CID )
            # fill_page  apply_redactions()  CID , 
            # REMOVED: Duplicate call to _draw_dates_at_positions
            # fill_page  _draw_dates_at_positions
            # if records:
            #     # Get date positions after redaction
            #     date_positions = _get_date_positions_after_redaction(page)
            #     if date_positions:
            #         # Use page_records_start as start_idx to get correct records
            #         _draw_dates_at_positions(page, records, date_positions, page_records_start)
            
            
            # Site()- CID
            if page_num == 0 and site:
                site_replaced = _draw_site_header(page, site)
                
                if not site_replaced:
                    print(f"[WARN] Site", file=sys.stderr)
            
            # ()
            # :  fill_page 1359,  Length  Margin
            #  fill_page
            
            record_idx += processed
            
            # records
            page_start_idx = record_idx - processed
            
            # : replace_cable_labels_in_page_stream has been fill_page 
            # file or JSON  clean_contents() 
            
            page_num += 1
        
        # ()
        # 
        min_data_pages = max(1, (total_records + ROWS_PER_PAGE - 1) // ROWS_PER_PAGE)
        current_data_pages = summary_page_idx  # 
        pages_to_delete = current_data_pages - min_data_pages
        
        # ()
        for i in range(pages_to_delete):
            # ( doc.page_count - 2, )
            doc.delete_page(doc.page_count - 2)
            summary_page_idx -= 1
            print(f"[INFO] ,  {doc.page_count} ", file=sys.stderr)
        
        # 
        # After inserting data pages, the summary page is now the last page
        summary_page_idx = len(doc) - 1
        summary_page = doc[summary_page_idx]

        # PassLength
        pass_count = len(records)

        # MPOLength"-", Length, 0
        if is_mpo_template:
            total_length = 0
        else:
            # length
            def safe_float(val, default=0):
                try:
                    return float(val) if val not in (None, '', '-') else default
                except (ValueError, TypeError):
                    return default
            total_length = sum(safe_float(r.get('length', 0)) for r in records)

        total_length_str = str(int(total_length)) if total_length == int(total_length) else f"{total_length:.1f}"
        
        # 
        # Passx=214, Lengthx=464
        # : y=72.4(Total for Site)y=112.4(Total for Selected Reports)
        summary_redacts = []
        summary_inserts = []
        
        blocks = summary_page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    x = span["bbox"][0]
                    text = span["text"].strip()
                    origin = span.get("origin")
                    
                    # Pass (x214)
                    if 210 < x < 220 and text.isdigit():
                        summary_redacts.append(fitz.Rect(span["bbox"]))
                        summary_inserts.append({
                            'x': x,
                            'y': origin[1] if origin else span["bbox"][3] - 2.5,
                            'text': str(pass_count)
                        })
                    
                    # Length (x464)
                    if 460 < x < 470 and (text.replace('.', '').isdigit()):
                        summary_redacts.append(fitz.Rect(span["bbox"]))
                        summary_inserts.append({
                            'x': x,
                            'y': origin[1] if origin else span["bbox"][3] - 2.5,
                            'text': total_length_str
                        })
        
        # Replace dates on summary page BEFORE redaction
        # This is needed because the summary page dates use C2_2 font with specific CID encoding
        if records:
            # Support both 'date_time' and 'date' + 'time' fields
            first_record_date = ''
            if records:
                record = records[0]
                date_time = record.get('date_time', '')
                if date_time:
                    first_record_date = date_time.split(' ')[0]
                else:
                    first_record_date = record.get('date', '')
            if first_record_date:
                # Get page xref and object
                page_xref = summary_page.xref
                page_obj = doc.xref_object(page_xref)
                
                # Find C2_2 font reference (summary page dates use C2_2)
                c2_2_match = re.search(r'/C2_2\s+(\d+)\s+0\s+R', page_obj)
                if c2_2_match:
                    c2_2_xref = int(c2_2_match.group(1))
                    font_obj = doc.xref_object(c2_2_xref)
                    
                    # Get ToUnicode stream and add missing mappings
                    tu_match = re.search(r'/ToUnicode\s+(\d+)\s+0\s+R', font_obj)
                    if tu_match:
                        tu_xref = int(tu_match.group(1))
                        tu_stream = doc.xref_stream(tu_xref)
                        if tu_stream:
                            tu_text = tu_stream.decode('latin-1', errors='replace')
                            
                            # Add mappings for digits 4, 5, 7, 8, 9
                            new_mappings = [
                                ('03F0', '0034'),  # 4
                                ('03F1', '0035'),  # 5
                                ('03F3', '0037'),  # 7
                                ('03F4', '0038'),  # 8
                                ('03F5', '0039'),  # 9
                            ]
                            
                            insert_pos = tu_text.rfind('endbfchar')
                            if insert_pos >= 0:
                                new_cmap = tu_text[:insert_pos]
                                for cid, unicode_val in new_mappings:
                                    if f'<{cid}>' not in tu_text:
                                        new_cmap += f'<{cid}> <{unicode_val}>\n'
                                new_cmap += tu_text[insert_pos:]
                                doc.update_stream(tu_xref, new_cmap.encode('latin-1'))
                
                # Build CID map for digits and hyphen
                cid_map = {
                    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
                    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
                    '8': '03F4', '9': '03F5', '-': '0372'
                }
                
                # Build new date hex
                date_chars = list(first_record_date)
                new_date_hex = ''.join(cid_map.get(c, '03EC') for c in date_chars if c in cid_map)
                new_date_hex_wrapped = f'<{new_date_hex}>'
                
                # Old date "23-01-2026" hex in C2_2: <03EE03EF037203EC03ED037203EE03EC03EE03F2>
                old_date_hex = '<03EE03EF037203EC03ED037203EE03EC03EE03F2>'
                
                # Replace dates in content streams BEFORE redaction
                contents = summary_page.get_contents()
                replaced_count = 0
                for xref in contents:
                    stream = doc.xref_stream(xref)
                    if stream:
                        stream_text = stream.decode('latin-1', errors='replace')
                        if old_date_hex in stream_text:
                            new_stream_text = stream_text.replace(old_date_hex, new_date_hex_wrapped)
                            doc.update_stream(xref, new_stream_text.encode('latin-1'))
                            replaced_count += 1
                
                print(f"[INFO] LC Summary page: replaced {replaced_count} date value(s)", file=sys.stderr)
        
        # Apply redactions for Pass and Length fields
        for rect in summary_redacts:
            summary_page.add_redact_annot(rect, fill=(1, 1, 1))
        summary_page.apply_redactions()
        
        for item in summary_inserts:
            # DejaVu SansCalibri, 
            adjusted_size = 6.0 if is_mpo_template else 8
            insert_text_with_font(
                summary_page,
                fitz.Point(item['x'], item['y']),
                item['text'],
                fontname="hebo",
                fontsize=adjusted_size,
                color=(0, 0, 0)
            )
        
        # Printed
        current_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        printed_text = f"Printed: {current_time}"
        
        # Printed
        printed_updated = False
        blocks = summary_page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    if 'Printed' in text:
                        bbox = span["bbox"]
                        origin = span.get("origin")
                        
                        # 
                        summary_page.add_redact_annot(fitz.Rect(bbox), fill=(1, 1, 1))
                        summary_page.apply_redactions()
                        
                        # 
                        insert_y = origin[1] if origin else bbox[3] - 2
                        # DejaVu SansCalibri, 
                        adjusted_size = 5.5 if is_mpo_template else 7
                        insert_text_with_font(
                            summary_page,
                            fitz.Point(55.0, insert_y),
                            printed_text,
                            fontname="hebo",
                            fontsize=adjusted_size,
                            color=(0, 0, 0)
                        )
                        printed_updated = True
                        print("[INFO] Printed timestamp updated", file=sys.stderr)
                        break
                if printed_updated:
                    break
            if printed_updated:
                break
        
        # , 
        
        # :  clean_contents(),  ToUnicode 
        # summary_page.clean_contents()

        print("[INFO] Summary values updated", file=sys.stderr)
        print(f"[INFO] : Page : {page_num + 1}", file=sys.stderr)

        # ()
        total_pages = len(doc)
        expected_pages = total_pages_needed + 1  #  + 
        if total_pages > expected_pages:
            print(f"[INFO] : {total_pages - expected_pages}", file=sys.stderr)
            for i in range(total_pages - expected_pages):
                doc.delete_page(total_pages_needed)  # (total_pages_needed)
        
        # , 
        # summary_page_idx 
        correct_page_num = summary_page_idx + 1  # 1-based 
        
        print("[INFO] Summary values verified", file=sys.stderr)
        print(f"[INFO] : Page : {correct_page_num}", file=sys.stderr)
        
        #  PDF - 
        # , 
        _save_pdf_compact(doc, output_path)
        doc.close()
        template_doc.close()
        
        return {
            'success': True,
            'method': 'column_replace',
            'records_processed': total_records,
            'pages_used': page_num,
            'output_path': output_path
        }
        
    except Exception:
        print("[ERROR] PDF rendering failed", file=sys.stderr)
        return {'error': 'PDF rendering failed'}


def modify_pdf_precise(input_path: str, output_path: str, modifications: dict) -> dict:
    """Precise PDF modification."""
    records = modifications.get('records', [])
    site = modifications.get('site', None)
    
    print(f"[PYTHON]  {len(records)} ", file=sys.stderr)

    if not records:
        return {'error': 'No records provided'}
    
    return edit_pdf(input_path, output_path, records, site)


def main(argv=None):
    """Run the compatibility editor entry point through the shared protocol."""
    editor_args = sys.argv[1:] if argv is None else argv
    return run_editor_cli(
        editor_args,
        modify_pdf_precise,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


if __name__ == '__main__':
    raise SystemExit(main())
