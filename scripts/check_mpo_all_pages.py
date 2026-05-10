#!/usr/bin/env python3
"""检查MPO模板所有页面的字段位置"""

import fitz
import sys

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

print(f"分析MPO模板: {template_path}")
print(f"页面数量: {len(doc)}\n")

for page_num, page in enumerate(doc):
    print(f"{'='*80}")
    print(f"第 {page_num + 1} 页")
    print(f"{'='*80}\n")
    
    blocks = page.get_text("dict")["blocks"]
    
    # 按y坐标组织
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
    
    # 找表头行（Limit等）
    print("【表头信息】")
    for y in sorted(rows.keys()):
        spans = sorted(rows[y], key=lambda s: s['x'])
        for span in spans:
            if 'Limit' in span['text'] or 'GBASE' in span['text'] or 'Length' in span['text']:
                print(f"  '{span['text']}'")
                print(f"    X坐标: {span['x']:.2f}")
                print(f"    Origin: {span['origin']}")
                print()
    
    # 找数据行（以#开头）
    print("【数据行信息】")
    found_first_data_row = False
    for y in sorted(rows.keys()):
        spans = sorted(rows[y], key=lambda s: s['x'])
        if spans and spans[0]['text'].startswith('#'):
            if not found_first_data_row:
                found_first_data_row = True
                print(f"第一行数据（y={y:.2f}）：")
                for span in spans:
                    if 'Length' in span['text'] or span['x'] > 150:  # 显示Length及之后的列
                        print(f"  '{span['text']}' - X: {span['x']:.2f}")
                print()
            break  # 只显示第一行数据
    
    print()

doc.close()
