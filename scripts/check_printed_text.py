#!/usr/bin/env python3
"""检查Printed时间的字体和字号"""

import fitz

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

# 检查最后一页（汇总页）
page = doc[-1]

print("="*80)
print("最后一页Printed时间检查")
print("="*80)
print()

blocks = page.get_text("dict")["blocks"]

for block in blocks:
    if "lines" not in block:
        continue
    for line in block["lines"]:
        for span in line["spans"]:
            text = span["text"].strip()
            if 'Printed' in text:
                print(f"文本: '{text}'")
                print(f"  bbox: {span['bbox']}")
                print(f"  origin: {span.get('origin')}")
                print(f"  字体: {span.get('font')}")
                print(f"  字号: {span['size']}")
                print()

doc.close()
