"""Shared PDF page layout, font, geometry, and save helpers."""

import os
import re
import sys

import fitz

from pdf_engine.cid import (
    _fix_f2_cmap_for_dates,
    replace_dates_in_tj_format,
    replace_times_in_page_stream,
)
from pdf_engine.resources import (
    CALIBRI_BOLD_FONT,
    CALIBRI_REGULAR_FONT,
    EMBED_INSERT_FONTS,
    FONT_DIR,
)


CARLITO_REGULAR = os.path.join(FONT_DIR, 'calibri.ttf')
CARLITO_BOLD = os.path.join(FONT_DIR, 'calibri_bold.ttf')

#
FONT_NAME_MAP = {
    'helv': 'Helvetica',
    'hebo': 'Helvetica-Bold',
    'calibri': 'calibri-regular',  #  Calibri
    'calibri-bold': 'calibri-bold',  #  Calibri Bold
}

# ,
FONT_SIZE_FACTOR = 1.0
DEFAULT_FONT_SIZE = 8.0
_PAGE_FONT_CACHE = set()
_TEXTWRITER_FONT_CACHE = {}

def save_pdf_compact(doc, output_path):
    """Save a generated report with lossless PDF cleanup/compression."""
    try:
        doc.subset_fonts()
    except Exception:
        print("[WARN] Font subsetting skipped", file=sys.stderr)

    try:
        doc.save(
            output_path,
            garbage=4,
            deflate=True,
            encryption=fitz.PDF_ENCRYPT_NONE,
        )
    except TypeError:
        # Older PyMuPDF builds may not support every save option; keep a safe
        # fallback so packaged desktop builds still produce a readable PDF.
        doc.save(output_path, encryption=fitz.PDF_ENCRYPT_NONE)


def _page_font_key(page, fontname):
    return (id(page.parent), page.xref, fontname)


def _draw_clear_rect(page, rect):
    page.draw_rect(fitz.Rect(rect), color=(1, 1, 1), fill=(1, 1, 1), width=0)


def _draw_clear_rects(page, rects):
    rects = list(rects)
    if not rects:
        return
    if len(rects) == 1:
        _draw_clear_rect(page, rects[0])
        return

    try:
        shape = page.new_shape()
        for rect in rects:
            shape.draw_rect(fitz.Rect(rect))
        shape.finish(color=(1, 1, 1), fill=(1, 1, 1), width=0)
        shape.commit()
    except Exception:
        for rect in rects:
            _draw_clear_rect(page, rect)


def _get_textwriter_font(fontname):
    if not EMBED_INSERT_FONTS:
        builtin = "hebo" if fontname in {"calibri-bold", "hebo"} else "helv"
        key = ("builtin", builtin)
        if key not in _TEXTWRITER_FONT_CACHE:
            _TEXTWRITER_FONT_CACHE[key] = fitz.Font(builtin)
        return _TEXTWRITER_FONT_CACHE[key]

    if fontname == 'calibri' and os.path.exists(CALIBRI_REGULAR_FONT):
        key = ('file', CALIBRI_REGULAR_FONT)
        if key not in _TEXTWRITER_FONT_CACHE:
            _TEXTWRITER_FONT_CACHE[key] = fitz.Font(fontfile=CALIBRI_REGULAR_FONT)
        return _TEXTWRITER_FONT_CACHE[key]

    if fontname == 'calibri-bold' and os.path.exists(CALIBRI_BOLD_FONT):
        key = ('file', CALIBRI_BOLD_FONT)
        if key not in _TEXTWRITER_FONT_CACHE:
            _TEXTWRITER_FONT_CACHE[key] = fitz.Font(fontfile=CALIBRI_BOLD_FONT)
        return _TEXTWRITER_FONT_CACHE[key]

    builtin = fontname if fontname in {'helv', 'hebo'} else 'helv'
    key = ('builtin', builtin)
    if key not in _TEXTWRITER_FONT_CACHE:
        _TEXTWRITER_FONT_CACHE[key] = fitz.Font(builtin)
    return _TEXTWRITER_FONT_CACHE[key]


def _insert_text_items(page, inserts):
    if not inserts:
        return

    try:
        writer = fitz.TextWriter(page.rect)
        for item in inserts:
            text = str(item.get("text", ""))
            if not text:
                continue
            writer.append(
                fitz.Point(item["x"], item["y"]),
                text,
                font=_get_textwriter_font(item.get("font", "calibri")),
                fontsize=item.get("size", 8.0),
            )
        writer.write_text(page, color=(0, 0, 0))
    except Exception:
        for item in inserts:
            insert_text_with_font(
                page,
                fitz.Point(item["x"], item["y"]),
                item["text"],
                fontname=item.get("font", "calibri"),
                fontsize=item.get("size", 8.0),
                color=(0, 0, 0),
            )


def insert_text_with_font(page, point, text, fontname="helv", fontsize=DEFAULT_FONT_SIZE, color=(0, 0, 0), clip=None):
    """
    ( Calibri )

     DejaVu  Calibri ,

    Args:
        page: PDF
        point:
        text:
        fontname: ("helv", "hebo", "calibri", "calibri-bold")
        fontsize:
        color:
        clip: ,
    """
    actual_fontname = fontname

    if not EMBED_INSERT_FONTS:
        if fontname == 'calibri':
            actual_fontname = "helv"
        elif fontname == 'calibri-bold':
            actual_fontname = "hebo"
        else:
            actual_fontname = FONT_NAME_MAP.get(fontname, fontname)
        page.insert_text(point, text, fontname=actual_fontname, fontsize=fontsize, color=color)
        return

    if fontname == 'calibri':
        if os.path.exists(CALIBRI_REGULAR_FONT):
            actual_fontname = "CalibriRegular"
            cache_key = _page_font_key(page, actual_fontname)
            if cache_key not in _PAGE_FONT_CACHE:
                page.insert_font(fontfile=CALIBRI_REGULAR_FONT, fontname=actual_fontname)
                _PAGE_FONT_CACHE.add(cache_key)
        else:
            actual_fontname = "helv"
    elif fontname == 'calibri-bold':
        if os.path.exists(CALIBRI_BOLD_FONT):
            actual_fontname = "CalibriBold"
            cache_key = _page_font_key(page, actual_fontname)
            if cache_key not in _PAGE_FONT_CACHE:
                page.insert_font(fontfile=CALIBRI_BOLD_FONT, fontname=actual_fontname)
                _PAGE_FONT_CACHE.add(cache_key)
        else:
            actual_fontname = "hebo"
    else:
        actual_fontname = FONT_NAME_MAP.get(fontname, fontname)

    page.insert_text(point, text, fontname=actual_fontname, fontsize=fontsize, color=color)


def get_field_positions(page):
    """


    Returns:
        tuple: (field_positions, is_mpo_template)
            field_positions: list,  [{'cable_label': {'bbox':..., 'origin':..., 'size':...}, ...}, ...]
            is_mpo_template: bool, MPO
    """
    blocks = page.get_text("dict")["blocks"]

    # y
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
                        'origin': span.get("origin", None)  # origin
                    })

    # : Limit
    # Cat5e: Limit x  200
    # MPO: Limit x  96
    is_mpo_template = False
    for y in rows.keys():
        spans = sorted(rows[y], key=lambda s: s['x'])
        for span in spans:
            if 'Limit' in span['text'] or 'GBASE' in span['text']:
                if span['x'] < 150:  # MPOLimitx=96
                    is_mpo_template = True
                break

    # (#)
    # : MPO, Cable Label(#)spans[0],
    # PDF.
    # : yspan#, Cable Label xspan.
    field_positions = []
    for y in sorted(rows.keys()):
        spans = sorted(rows[y], key=lambda s: s['x'])

        # MPO: Cable Label(x < 50  text#)
        # span#
        has_cable_label = any(s['x'] < 50 and s['text'].startswith('#') for s in spans)
        has_any_hash = any(s['text'].startswith('#') for s in spans)

        # MPO, has_cable_label
        # Cat5e, has_any_hash
        is_data_row = has_cable_label if is_mpo_template else (spans and has_any_hash)

        if not is_data_row:
            continue

        row_fields = {}

        #
        for span in spans:
                x = span['x']
                bbox = span['bbox']
                text = span['text']
                origin = span['origin']

                # x
                if is_mpo_template:
                    # MPO
                    if x < 50:
                        row_fields['cable_label'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 50 < x < 170:  # Limitx=96
                        row_fields['limit'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 170 < x < 220:  # Lengthx=196
                        row_fields['length'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 220 < x < 270:  # Marginx=237
                        row_fields['next_margin'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 270 < x < 310 and '-' in text:  # MPO Date x=280.68
                        row_fields['date'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 310 < x < 380:  # MPO Time x=318.01
                        row_fields['time'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                else:
                    # Cat5e
                    if x < 50:
                        row_fields['cable_label'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 190 < x < 210:
                        row_fields['limit'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 290 < x < 310:
                        row_fields['length'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 330 < x < 350:
                        row_fields['next_margin'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 430 < x < 450:
                        row_fields['date'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif x > 460:
                        row_fields['time'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}

        # has beenDateTime
        # MPOCable Label
        if 'date' not in row_fields or 'time' not in row_fields:
            # DateTime
            prev_y = y - 1  #
            date_field = None
            time_field = None
            if prev_y in rows:
                prev_spans = sorted(rows[prev_y], key=lambda s: s['x'])
                for span in prev_spans:
                    x = span['x']
                    text = span['text']
                    bbox = span['bbox']
                    origin = span['origin']

                    if is_mpo_template:
                        # MPO: Datex=281, Timex=318
                        if 270 < x < 310 and '-' in text:  # Date,  '29-01-2026'
                            date_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                        elif x > 310:  # Time,  '01:43:17 PM'
                            time_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    else:
                        # Cat5e
                        if 430 < x < 450 and '-' in text:  # Date
                            date_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                        elif x > 460:  # Time
                            time_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}

            # Date, row_fields
            if date_field:
                row_fields['date'] = date_field
            # Time, row_fields
            if time_field:
                row_fields['time'] = time_field

        # MPOLimit,
        if is_mpo_template and 'limit' not in row_fields:
            next_y = y + 1
            if next_y in rows:
                next_spans = sorted(rows[next_y], key=lambda s: s['x'])
                # Limit('GBASE')
                for span in next_spans:
                    if 'GBASE' in span['text']:
                        # Limit, y
                        limit_bbox = fitz.Rect(
                            span['bbox'][0],
                            rows[y][0]['bbox'][1],  # y
                            span['bbox'][2],
                            rows[y][0]['bbox'][3]
                        )
                        limit_origin = (span['origin'][0], rows[y][0]['origin'][1])
                        row_fields['limit'] = {
                            'bbox': limit_bbox,
                            'origin': limit_origin,
                            'size': span['size']
                        }
                        break

        field_positions.append(row_fields)

    return field_positions, is_mpo_template


def clear_row_images(page, start_row, end_row, is_mpo_template=False):
    """
    (CU, )

    Args:
        page: PDF
        start_row: (0-based)
        end_row: ()
        is_mpo_template: MPO
    """
    # y()
    if is_mpo_template:
        # MPO: 1y  87
        row_start_y = 87
        row_height = 15

        # MPO
        # x=13: "MPO"
        # x=171: (Result)
        image_positions = [
            (13, 12),    # "MPO": x=13, 12
            (171, 12),   # : x=171, 12
        ]
    else:
        # Cat5e: 1y  108
        row_start_y = 108
        row_height = 15

        # x()
        image_positions = [
            (13, 12),   # "CU": x=13, 12
            (271, 12),  # : x=271, 12
            (386, 12),  # : x=386, 12
        ]

    # , redaction
    for row in range(start_row, end_row):
        y = row_start_y + row * row_height
        for x, width in image_positions:
            # : yy-1, 12
            # y-2redactiony0,
            rect = fitz.Rect(x - 1, y - 2, x + width + 1, y + 12)
            _draw_clear_rect(page, rect)

def detect_template_kind(template_doc):
    """Return 'lc', 'mpo', or 'cat5e' based on stable header positions."""
    if len(template_doc) == 0:
        return 'cat5e'

    page = template_doc[0]
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append({
                        "text": text,
                        "x": span["bbox"][0],
                        "y": span["bbox"][1],
                    })

    factory_xs = [s["x"] for s in spans if s["text"] == "Factory"]
    has_early_factory = any(250 <= x <= 320 for x in factory_xs)
    if has_early_factory:
        return 'lc'

    has_mpo_limit_data = any("GBASE" in s["text"] and s["x"] < 170 for s in spans)
    if has_mpo_limit_data:
        return 'mpo'

    limit_xs = [s["x"] for s in spans if s["text"] == "Limit"]
    if any(x < 150 for x in limit_xs) and not factory_xs:
        return 'mpo'

    return 'cat5e'


def _iter_page_spans(page):
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue
                spans.append({
                    "text": text,
                    "bbox": span["bbox"],
                    "origin": span.get("origin"),
                    "size": span["size"],
                    "x": span["bbox"][0],
                    "y": span["bbox"][1],
                })
    return spans


def _get_lc_rows(page, max_y=None):
    """Collect LC data rows and their template text positions."""
    spans = _iter_page_spans(page)
    label_spans = [
        span for span in spans
        if span["text"].startswith("#")
        and 15 <= span["x"] <= 60
        and span["bbox"][1] > 100
        and (max_y is None or span["bbox"][1] < max_y)
    ]
    label_spans.sort(key=lambda span: (span["origin"][1] if span.get("origin") else span["bbox"][1]))

    def same_row(span, baseline):
        origin = span.get("origin")
        y = origin[1] if origin else span["bbox"][3]
        return abs(y - baseline) <= 2.2

    rows = []
    for label in label_spans:
        baseline = label["origin"][1] if label.get("origin") else label["bbox"][3]
        row_spans = [span for span in spans if same_row(span, baseline)]

        def find_in_x(min_x, max_x, predicate=None):
            candidates = [
                span for span in row_spans
                if min_x <= span["x"] <= max_x
                and (predicate is None or predicate(span["text"]))
            ]
            if not candidates:
                return None
            candidates.sort(key=lambda span: span["x"])
            return candidates[0]

        row = {
            "baseline": baseline,
            "cable_label": label,
            "limit": find_in_x(80, 155, lambda text: bool(text)),
            "length": find_in_x(175, 215, lambda text: bool(text)),
            "next_margin": find_in_x(220, 260, lambda text: bool(text)),
            "date_time": find_in_x(310, 500, lambda text: "-" in text or "/" in text),
        }
        rows.append(row)

    return rows


def _expanded_rect(bbox, x_pad=1.2, y_pad=1.0):
    rect = fitz.Rect(bbox)
    rect.x0 -= x_pad
    rect.x1 += x_pad
    rect.y0 -= y_pad
    rect.y1 += y_pad
    return rect


def _row_clear_rect(row, right=500):
    baseline = row["baseline"]
    return fitz.Rect(13, baseline - 9.5, right, baseline + 4.5)


def _format_pdf_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        if float(value).is_integer():
            return str(int(value))
        return f"{float(value):.1f}".rstrip("0").rstrip(".")
    return str(value)


def _format_lc_label(record):
    label = str(record.get("cable_label") or record.get("cable_number") or "").strip()
    if label and not label.startswith("#"):
        label = f"#{label}"
    return label


def _format_lc_datetime(record):
    date_time = str(record.get("date_time") or "").strip()
    if date_time:
        return date_time

    date_part = str(record.get("date") or "").strip()
    time_part = str(record.get("time") or "").strip()
    return f"{date_part} {time_part}".strip()


def _split_pdf_datetime(record):
    date_time = str(record.get("date_time") or "").strip()
    if date_time:
        parts = date_time.split(" ", 1)
        date_part = parts[0].strip() if parts else ""
        time_part = parts[1].strip() if len(parts) > 1 else ""
        return date_part, time_part

    return (
        str(record.get("date") or "").strip(),
        str(record.get("time") or "").strip(),
    )


def _replace_template_datetimes(page, page_records):
    if not page_records:
        return
    replace_times_in_page_stream(page, page_records, 0, std_tj_record_offset=0)
    _fix_f2_cmap_for_dates(page.parent)
    replace_dates_in_tj_format(page, page_records, 0)


def _field_baseline(field):
    return field["origin"][1] if field and field.get("origin") else field["bbox"][3]


def _field_size(*fields, default=8.0):
    for field in fields:
        if field and field.get("size"):
            return field["size"]
    return default


def _text_width_for_insert(fontname, text, size):
    try:
        return _get_textwriter_font(fontname).text_length(str(text), fontsize=size)
    except Exception:
        try:
            return fitz.Font('helv').text_length(str(text), fontsize=size)
        except Exception:
            return 0.0


def _rewrite_lc_datetimes(page, rows, page_records):
    """Clear and redraw LC Date & Time values so stale template text cannot remain."""
    redacts = []
    inserts = []

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(rows):
            break

        field = rows[row_idx].get("date_time")
        if not field:
            continue

        baseline = _field_baseline(field)
        redacts.append(fitz.Rect(field["bbox"][0] - 1.4, field["bbox"][1] - 1.0, 505.0, field["bbox"][3] + 1.0))
        inserts.append({
            "x": field["bbox"][0],
            "y": baseline,
            "text": _format_lc_datetime(record),
            "size": _field_size(field),
            "font": "calibri",
        })

    _apply_redacts_and_inserts(page, redacts, inserts)


def _queue_site_header_update(page, site, redacts, inserts):
    if not site:
        return False

    spans = _iter_page_spans(page)
    anchor_spans = [
        span for span in spans
        if 55 <= span["bbox"][1] <= 72
        and "Site:" in span["text"]
        and span["x"] < 130
    ]
    if not anchor_spans:
        redacts.append(fitz.Rect(18.5, 57.5, 210.0, 73.4))
        inserts.append({
            "x": 20.0,
            "y": 70.0,
            "text": f"Site: {site}",
            "size": 8.0,
            "font": "calibri-bold",
        })
        return True

    anchor = min(anchor_spans, key=lambda span: span["bbox"][0])
    anchor_center_y = (anchor["bbox"][1] + anchor["bbox"][3]) / 2
    site_spans = [
        span for span in spans
        if span["bbox"][0] < 210
        and abs(((span["bbox"][1] + span["bbox"][3]) / 2) - anchor_center_y) < 2.5
    ]
    if not site_spans:
        site_spans = anchor_spans

    y0 = max(57.5, min(span["bbox"][1] for span in site_spans) - 0.8)
    y1 = min(73.4, max(span["bbox"][3] for span in site_spans) + 0.4)
    baseline = anchor["origin"][1] if anchor.get("origin") else 70.0
    font_size = anchor.get("size", 8.0)
    redacts.append(fitz.Rect(18.5, y0, 210.0, y1))
    inserts.append({
        "x": 20.0,
        "y": baseline,
        "text": f"Site: {site}",
        "size": font_size,
        "font": "calibri-bold",
    })
    return True


def _draw_site_header(page, site):
    redacts = []
    inserts = []
    if not _queue_site_header_update(page, site, redacts, inserts):
        return False
    _apply_redacts_and_inserts(page, redacts, inserts)
    return True


def _queue_lc_site_update(page, site, redacts, inserts):
    _queue_site_header_update(page, site, redacts, inserts)


def _cover_rect(page, rect):
    page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), width=0)


_RESULT_ICON_FIRST_RECTS = {
    "cat5e": fitz.Rect(271.000, 109.766, 283.000, 121.766),
    "mpo": fitz.Rect(170.777, 88.000, 182.777, 100.000),
    "lc": fitz.Rect(162.109, 109.766, 174.109, 121.766),
}
_RESULT_ICON_ROW_PITCH = 15.0
_FAIL_ICON_RED = (220 / 255, 38 / 255, 38 / 255)


def _result_icon_rect(template_kind, row_index):
    first = _RESULT_ICON_FIRST_RECTS[template_kind]
    y_offset = row_index * _RESULT_ICON_ROW_PITCH
    return fitz.Rect(first.x0, first.y0 + y_offset, first.x1, first.y1 + y_offset)


def _draw_fail_result_icon(page, rect):
    _cover_rect(page, rect)
    center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    page.draw_circle(
        center,
        5.5,
        color=_FAIL_ICON_RED,
        fill=_FAIL_ICON_RED,
        width=0.5,
    )
    cross_offset = 2.5
    page.draw_line(
        fitz.Point(center.x - cross_offset, center.y - cross_offset),
        fitz.Point(center.x + cross_offset, center.y + cross_offset),
        color=(1, 1, 1),
        width=1.5,
        lineCap=1,
    )
    page.draw_line(
        fitz.Point(center.x - cross_offset, center.y + cross_offset),
        fitz.Point(center.x + cross_offset, center.y - cross_offset),
        color=(1, 1, 1),
        width=1.5,
        lineCap=1,
    )


def _draw_failed_result_icons(page, records, template_kind):
    for row_index, record in enumerate(records):
        if record.get("result") == "FAIL":
            _draw_fail_result_icon(page, _result_icon_rect(template_kind, row_index))


def _redraw_outline(page, rect, width=1.0):
    pad = 1.4
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y0 - pad, rect.x1 + pad, rect.y0 + pad))
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y0 - pad, rect.x0 + pad, rect.y1 + pad))
    _cover_rect(page, fitz.Rect(rect.x1 - pad, rect.y0 - pad, rect.x1 + pad, rect.y1 + pad))
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y1 - pad, rect.x1 + pad, rect.y1 + pad))
    page.draw_rect(rect, color=(0, 0, 0), width=width)


def _redraw_lc_data_outline(page, bottom_y=800.7659912109375):
    _redraw_outline(page, fitz.Rect(10.0, 74.0, 575.0, bottom_y), width=1.0)


def _queue_page_number_update(page, page_num, redacts, inserts):
    for span in _iter_page_spans(page):
        if "Page :" not in span["text"]:
            continue
        redacts.append(_expanded_rect(span["bbox"], 1.5, 1.0))
        baseline = span["origin"][1] if span.get("origin") else span["bbox"][3]
        inserts.append({
            "x": span["bbox"][0],
            "y": baseline,
            "text": f"Page : {page_num}",
            "size": span["size"],
            "font": "calibri",
        })
        return


def _apply_redacts_and_inserts(page, redacts, inserts):
    _draw_clear_rects(page, redacts)
    _insert_text_items(page, inserts)
