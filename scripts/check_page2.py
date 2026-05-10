#!/usr/bin/env python3
"""检查MPO模板第2页的数据行"""

import fitz
import sys
sys.path.append('/workspace/projects/scripts')

from pdf_editor import get_field_positions

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

# 检查第2页
page = doc[1]

# 使用get_field_positions
field_positions, is_mpo_template = get_field_positions(page)

print(f"第2页:")
print(f"  是否为MPO模板: {'是' if is_mpo_template else '否'}")
print(f"  field_positions数量: {len(field_positions)}")
print()

# 显示前5行的字段
for i in range(min(5, len(field_positions))):
    print(f"第{i+1}行字段:")
    for field_name in field_positions[i]:
        print(f"  {field_name}")
    print()

# 直接读取文本，看看第2页的实际情况
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
                })

print(f"第2页的数据行（前10个y坐标）：\n")

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
        if count >= 10:
            break

doc.close()
