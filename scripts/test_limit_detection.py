#!/usr/bin/env python3
"""测试Limit列检测"""

import fitz
import sys
sys.path.append('/workspace/projects/scripts')

from pdf_editor import get_field_positions

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

print("="*80)
print("测试Limit列检测")
print("="*80)
print()

for page_num in [0, 1]:  # 只测试第1页和第2页
    print(f"第{page_num+1}页:")
    page = doc[page_num]
    field_positions, is_mpo_template = get_field_positions(page)
    
    print(f"  是否为MPO模板: {'是' if is_mpo_template else '否'}")
    print(f"  field_positions数量: {len(field_positions)}")
    print()
    
    # 显示前3行的字段
    for i in range(min(3, len(field_positions))):
        print(f"  第{i+1}行字段:")
        for field_name in ['cable_label', 'limit', 'length', 'next_margin', 'date', 'time']:
            if field_name in field_positions[i]:
                print(f"    ✓ {field_name}")
            else:
                print(f"    ✗ {field_name}")
        print()

doc.close()
