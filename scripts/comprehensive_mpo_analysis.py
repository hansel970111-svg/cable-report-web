#!/usr/bin/env python3
"""地毯式分析MPO模板的所有细节"""

import fitz
import json
import sys

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

print("="*80)
print(f"地毯式分析MPO模板: {template_path}")
print(f"页面数量: {len(doc)}")
print("="*80)
print()

# 分析第1页（数据页）的详细内容
print("="*80)
print("第1页详细分析")
print("="*80)
print()

page = doc[0]

# 1. 页面基本信息
print("【1. 页面基本信息】")
print(f"  页面尺寸: {page.rect}")
print(f"  旋转角度: {page.rotation}")
print()

# 2. 所有文本块
print("【2. 所有文本块（前50个）】")
blocks = page.get_text("dict")["blocks"]
count = 0
for block_idx, block in enumerate(blocks):
    if "lines" not in block:
        continue
    
    for line_idx, line in enumerate(block["lines"]):
        for span_idx, span in enumerate(line["spans"]):
            text = span["text"].strip()
            if text:
                bbox = span["bbox"]
                origin = span.get("origin", None)
                font = span.get("font", "Unknown")
                size = span["size"]
                color = span.get("color", 0)
                
                # 处理color可能是int或tuple的情况
                if isinstance(color, tuple):
                    color_str = f"RGB({int(color[0]*255)}, {int(color[1]*255)}, {int(color[2]*255)})"
                else:
                    # color是int，需要转换为RGB
                    r = (color >> 16) & 0xFF
                    g = (color >> 8) & 0xFF
                    b = color & 0xFF
                    color_str = f"RGB({r}, {g}, {b})"
                
                flags = span.get("flags", 0)
                
                print(f"  文本: '{text}'")
                print(f"    bbox: {bbox}")
                print(f"    origin: {origin}")
                print(f"    字体: {font}")
                print(f"    字号: {size}")
                print(f"    颜色: {color_str}")
                print(f"    字体标志: {flags}")
                print()
                
                count += 1
                if count >= 50:
                    break
        if count >= 50:
            break
    if count >= 50:
        break

# 3. 所有图像
print("【3. 所有图像】")
images = page.get_images()
print(f"  图像数量: {len(images)}")
for img_idx, img in enumerate(images):
    xref = img[0]
    base_image = doc.extract_image(xref)
    image_bytes = base_image["image"]
    ext = base_image["ext"]
    print(f"  图像 {img_idx + 1}:")
    print(f"    xref: {xref}")
    print(f"    格式: {ext}")
    print(f"    大小: {len(image_bytes)} bytes")
    print()

# 4. 图像在页面上的位置
print("【4. 图像在页面上的位置】")
image_list = page.get_image_info()
print(f"  图像位置数量: {len(image_list)}")
for img_idx, img_info in enumerate(image_list):
    bbox = img_info["bbox"]
    print(f"  图像 {img_idx + 1}:")
    print(f"    bbox: {bbox}")
    print(f"    宽度: {bbox[2] - bbox[0]:.2f}")
    print(f"    高度: {bbox[3] - bbox[1]:.2f}")
    print()

doc.close()
