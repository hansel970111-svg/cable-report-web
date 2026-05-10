#!/usr/bin/env python3
"""检查所有页面的Limit列布局"""

import fitz

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

for page_num in range(len(doc)):
    page = doc[page_num]
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
    
    print(f"第{page_num+1}页:")
    
    # 检查数据行的布局
    found_data_row = False
    for y in sorted(rows.keys()):
        if y < 80 or y > 800:
            continue
            
        spans = sorted(rows[y], key=lambda s: s['x'])
        span_texts = [span['text'] for span in spans]
        
        if '#117' in ' '.join(span_texts) or '#112' in ' '.join(span_texts):
            if not found_data_row:
                found_data_row = True
                print(f"  第一个数据行 (y={y}): {span_texts}")
                
                # 检查下一行是否有Limit列
                next_y = y + 1
                if next_y in rows:
                    next_spans = sorted(rows[next_y], key=lambda s: s['x'])
                    next_texts = [span['text'] for span in next_spans]
                    if 'GBASE' in ' '.join(next_texts):
                        print(f"  Limit列在下一行 (y={next_y}): {next_texts}")
                    else:
                        print(f"  Limit列在同一行")
                else:
                    print(f"  Limit列在同一行")
                print()
                break

doc.close()
