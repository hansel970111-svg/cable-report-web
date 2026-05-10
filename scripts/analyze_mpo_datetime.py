#!/usr/bin/env python3
"""
详细分析MPO模板的Date & Time列布局
"""
import sys
import fitz

def analyze_datetime_column(pdf_path):
    """分析MPO模板PDF的Date & Time列"""
    doc = fitz.open(pdf_path)

    print("=" * 80)
    print(f"分析MPO模板Date & Time列: {pdf_path}")
    print("=" * 80)

    # 分析第一页
    page = doc[0]

    # 获取文本
    text_dict = page.get_text("dict")

    # 分析Date & Time列的文本
    print("\n【Date & Time列详细分析】")

    for block in text_dict["blocks"]:
        if "lines" not in block:
            continue

        for line in block["lines"]:
            y = line["bbox"][1]
            spans = sorted(line["spans"], key=lambda s: s["bbox"][0])

            # 查找日期和时间（日期格式：dd-mm-yyyy，时间格式：hh:mm:ss AM/PM）
            date_spans = []
            time_spans = []

            for span in spans:
                text = span["text"].strip()
                if not text:
                    continue

                # 检测日期格式
                if text.count('-') == 2 and len(text) == 10:
                    date_spans.append(span)

                # 检测时间格式（包含AM/PM）
                if 'AM' in text or 'PM' in text:
                    time_spans.append(span)

            # 如果找到日期和时间，打印详细信息
            if date_spans and time_spans:
                print(f"\n--- y={y:.2f} ---")

                for span in date_spans:
                    bbox = span["bbox"]
                    origin = span.get("origin")
                    print(f"  日期: {span['text']}")
                    print(f"    bbox: x={bbox[0]:.2f}-{bbox[1]:.2f}, x1={bbox[2]:.2f}-{bbox[3]:.2f}")
                    print(f"    宽度: {bbox[2] - bbox[0]:.2f}")
                    print(f"    Origin: {origin}")

                for span in time_spans:
                    bbox = span["bbox"]
                    origin = span.get("origin")
                    print(f"  时间: {span['text']}")
                    print(f"    bbox: x={bbox[0]:.2f}-{bbox[1]:.2f}, x1={bbox[2]:.2f}-{bbox[3]:.2f}")
                    print(f"    宽度: {bbox[2] - bbox[0]:.2f}")
                    print(f"    Origin: {origin}")

                # 计算日期和时间之间的间距
                if date_spans and time_spans:
                    date_end_x = date_spans[0]["bbox"][2]
                    time_start_x = time_spans[0]["bbox"][0]
                    gap = time_start_x - date_end_x
                    print(f"  间距: {gap:.2f} 点")

    # 分析前5行数据的Date & Time字段位置
    print("\n\n【前5行Date & Time字段位置】")

    # 获取数据行（以#开头）
    field_positions = []
    for block in text_dict["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            y = round(line["bbox"][1], 0)
            spans = []
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append({
                        'text': text,
                        'x': span["bbox"][0],
                        'bbox': span["bbox"],
                        'size': span["size"],
                        'origin': span.get("origin", None)
                    })
            if spans and spans[0]['text'].startswith('#'):
                field_positions.append({'y': y, 'spans': sorted(spans, key=lambda s: s['x'])})

    # 只看前5行
    for i, row in enumerate(field_positions[:5]):
        print(f"\n第{i+1}行 (y={row['y']}):")

        for span in row['spans']:
            text = span['text']
            bbox = span['bbox']

            # 识别Date字段（日期格式）
            if text.count('-') == 2 and len(text) == 10:
                print(f"  Date字段: {text}")
                print(f"    bbox: ({bbox[0]:.2f}, {bbox[1]:.2f}, {bbox[2]:.2f}, {bbox[3]:.2f})")
                print(f"    Origin: {span['origin']}")

            # 识别Time字段（时间格式）
            if 'AM' in text or 'PM' in text:
                print(f"  Time字段: {text}")
                print(f"    bbox: ({bbox[0]:.2f}, {bbox[1]:.2f}, {bbox[2]:.2f}, {bbox[3]:.2f})")
                print(f"    Origin: {span['origin']}")

    doc.close()

if __name__ == "__main__":
    template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

    try:
        analyze_datetime_column(template_path)
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
