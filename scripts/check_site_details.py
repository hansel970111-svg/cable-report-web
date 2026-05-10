#!/usr/bin/env python3
"""检查Site文字的详细结构"""

import fitz

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

# 检查第1页
page = doc[0]

print("="*80)
print("第1页Site文字详细结构")
print("="*80)
print()

blocks = page.get_text("dict")["blocks"]

# 按y坐标组织所有行
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
                    'origin': span.get("origin"),
                    'font': span.get("font", "Unknown")
                })

# 显示y=60-75之间的行（Site区域）
for y in sorted(rows.keys()):
    if y >= 58 and y <= 75:
        spans = sorted(rows[y], key=lambda s: s['x'])
        print(f"y={y:.0f}:")
        for span in spans:
            print(f"  文本: '{span['text']}'")
            print(f"    x={span['x']:.2f}, bbox={span['bbox']}")
            print(f"    origin={span['origin']}")
            print(f"    字体: {span['font']}, 字号: {span['size']}")
            print()

doc.close()
