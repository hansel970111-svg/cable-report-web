#!/usr/bin/env python3
"""检查field_positions的具体内容"""

import fitz
import sys
sys.path.append('/workspace/projects/scripts')

from pdf_editor import get_field_positions

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

for page_num in range(min(3, len(doc))):  # 只检查前3页
    print(f"{'='*80}")
    print(f"第 {page_num + 1} 页")
    print(f"{'='*80}\n")
    
    page = doc[page_num]
    field_positions = get_field_positions(page)
    
    print(f"field_positions数量: {len(field_positions)}\n")
    
    if field_positions:
        # 显示第一行数据
        first_row = field_positions[0]
        print("第一行数据字段：")
        for field_name, field_data in first_row.items():
            bbox = field_data.get('bbox')
            origin = field_data.get('origin')
            print(f"  {field_name}:")
            print(f"    bbox: {bbox}")
            print(f"    origin: {origin}")
            if bbox:
                print(f"    bbox[0]: {bbox[0]}")
        print()
        
        # 检查limit字段
        if 'limit' in first_row:
            limit_bbox = first_row['limit']['bbox']
            limit_x = limit_bbox[0]
            print(f"Limit字段X坐标: {limit_x}")
            print(f"是否为MPO模板: {'是' if limit_x < 150 else '否'}")
        else:
            print("没有找到limit字段")
    
    print()

doc.close()
