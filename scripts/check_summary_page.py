#!/usr/bin/env python3
"""检查汇总页的Length计算"""

import fitz

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

# 检查最后一页（汇总页）
page = doc[-1]

print("="*80)
print("汇总页Length检查")
print("="*80)
print()

blocks = page.get_text("dict")["blocks"]

for block in blocks:
    if "lines" not in block:
        continue
    for line in block["lines"]:
        for span in line["spans"]:
            text = span["text"].strip()
            x = span["bbox"][0]
            
            # 查找Length相关的数字
            if 460 < x < 470:
                print(f"文本: '{text}'")
                print(f"  x={x:.2f}")
                print(f"  bbox={span['bbox']}")
                print(f"  是否是数字: {text.replace('.', '').replace('-', '').isdigit()}")
                print()

doc.close()
