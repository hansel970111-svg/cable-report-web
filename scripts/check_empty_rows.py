#!/usr/bin/env python3
"""检查MPO模板第1页的空行"""

import fitz
import sys
sys.path.append('/workspace/projects/scripts')

from pdf_editor import get_field_positions

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

# 检查第1页
page = doc[0]
blocks = page.get_text("dict")["blocks"]

# 按y坐标组织所有行（不只是以#开头的）
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
                })

print(f"第1页的所有行（前20个y坐标）：\n")

count = 0
for y in sorted(rows.keys()):
    spans = sorted(rows[y], key=lambda s: s['x'])
    
    # 只显示数据行的y坐标（80-800之间）
    if y > 80 and y < 800:
        print(f"y={y:.0f}: ", end="")
        for span in spans:
            print(f"'{span['text']}'(x={span['x']:.0f}) ", end="")
        print()
        
        count += 1
        if count >= 20:
            break

doc.close()
