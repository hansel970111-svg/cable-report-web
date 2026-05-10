#!/usr/bin/env python3
"""测试所有页面的模板检测"""

import fitz
import sys
sys.path.append('/workspace/projects/scripts')

from pdf_editor import get_field_positions

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

print(f"分析MPO模板: {template_path}")
print(f"页面数量: {len(doc)}\n")

for page_num in range(len(doc)):
    print(f"{'='*80}")
    print(f"第 {page_num + 1} 页")
    print(f"{'='*80}\n")
    
    page = doc[page_num]
    field_positions, is_mpo_template = get_field_positions(page)
    
    print(f"是否为MPO模板: {'是' if is_mpo_template else '否'}")
    print(f"field_positions数量: {len(field_positions)}\n")
    
    if field_positions:
        # 显示第一行数据
        first_row = field_positions[0]
        print("第一行数据字段：")
        for field_name, field_data in first_row.items():
            print(f"  {field_name}")
        print()

doc.close()

print(f"\n{'='*80}")
print("检测结果汇总")
print(f"{'='*80}")

doc = fitz.open(template_path)
all_mpo = True
for page_num in range(len(doc)):
    page = doc[page_num]
    field_positions, is_mpo_template = get_field_positions(page)
    if not is_mpo_template:
        print(f"第 {page_num + 1} 页：不是MPO模板 ❌")
        all_mpo = False

if all_mpo:
    print("✓ 所有页面都正确识别为MPO模板")
else:
    print("✗ 有页面未正确识别为MPO模板")

doc.close()
