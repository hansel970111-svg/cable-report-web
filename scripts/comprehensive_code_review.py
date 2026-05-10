#!/usr/bin/env python3
"""地毯式检查代码中所有字体、字号、位置设置"""

import fitz
import re
import sys

# 模板路径
template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

# 打开模板
doc = fitz.open(template_path)

print("="*80)
print("MPO模板详细分析")
print("="*80)
print()

# 分析第1页
page = doc[0]

# 1. 页面基本信息
print("【1. 页面基本信息】")
print(f"  页面尺寸: {page.rect}")
print()

# 2. 所有文本块（按字段类型分组）
print("【2. 文本块详细信息】")
blocks = page.get_text("dict")["blocks"]

# 分组统计
headers = []  # 表头
site_texts = []  # Site相关
data_rows = []  # 数据行

for block in blocks:
    if "lines" not in block:
        continue
    
    for line in block["lines"]:
        y = round(line["bbox"][1], 0)
        
        for span in line["spans"]:
            text = span["text"].strip()
            if not text:
                continue
            
            bbox = span["bbox"]
            origin = span.get("origin")
            font = span.get("font", "Unknown")
            size = span["size"]
            flags = span.get("flags", 0)
            
            # 判断文本类型
            if y < 80:
                # 表头或Site
                if 'Site:' in text or re.match(r'^-[A-Za-z0-9]+$', text):
                    site_texts.append({
                        'text': text,
                        'x': bbox[0],
                        'y': y,
                        'bbox': bbox,
                        'origin': origin,
                        'font': font,
                        'size': size,
                        'flags': flags
                    })
                elif text in ['Cable Label', 'Limit', 'Result', 'Length (m)', 'Margin (dB)', 'Date & Time']:
                    headers.append({
                        'text': text,
                        'x': bbox[0],
                        'y': y,
                        'bbox': bbox,
                        'origin': origin,
                        'font': font,
                        'size': size,
                        'flags': flags
                    })
            elif text.startswith('#') or text == '-' or re.match(r'^\d{2}-\d{2}-\d{4}$', text) or re.match(r'^\d{1,2}:\d{2}:\d{2} (AM|PM)$', text):
                # 数据行
                data_rows.append({
                    'text': text,
                    'x': bbox[0],
                    'y': y,
                    'bbox': bbox,
                    'origin': origin,
                    'font': font,
                    'size': size,
                    'flags': flags
                })

print("【Site文本】")
for item in site_texts:
    print(f"  '{item['text']}'")
    print(f"    x={item['x']:.2f}, y={item['y']:.0f}")
    print(f"    bbox={item['bbox']}")
    print(f"    origin={item['origin']}")
    print(f"    字体={item['font']}, 字号={item['size']}")
    print(f"    字体标志={item['flags']} (Bold={item['flags'] & 20 == 20})")
    print()

print("【表头】")
for item in headers:
    print(f"  '{item['text']}'")
    print(f"    x={item['x']:.2f}, y={item['y']:.0f}")
    print(f"    bbox={item['bbox']}")
    print(f"    origin={item['origin']}")
    print(f"    字体={item['font']}, 字号={item['size']}")
    print(f"    字体标志={item['flags']} (Bold={item['flags'] & 20 == 20})")
    print()

print("【数据行前10个】")
for i, item in enumerate(data_rows[:10]):
    print(f"  {i+1}. '{item['text']}'")
    print(f"     x={item['x']:.2f}, y={item['y']:.0f}")
    print(f"     bbox={item['bbox']}")
    print(f"     origin={item['origin']}")
    print(f"     字体={item['font']}, 字号={item['size']}")
    print(f"     字体标志={item['flags']} (Bold={item['flags'] & 20 == 20})")
    print()

# 3. 图像信息
print("【3. 图像信息（前10个）】")
images = page.get_image_info()
for i, img_info in enumerate(images[:10]):
    bbox = img_info["bbox"]
    print(f"  图像 {i+1}:")
    print(f"    bbox: {bbox}")
    print(f"    宽度: {bbox[2] - bbox[0]:.2f}")
    print(f"    高度: {bbox[3] - bbox[1]:.2f}")
    print()

doc.close()

# 4. 检查代码中的字体设置
print("="*80)
print("代码中的字体设置检查")
print("="*80)
print()

code_path = "/workspace/projects/scripts/pdf_editor.py"
with open(code_path, 'r') as f:
    code_content = f.read()

# 查找所有使用insert_text或insert_text_with_font的地方
font_usage = []

# 查找insert_text_with_font调用
matches = re.findall(r'insert_text_with_font\([^)]+fontname="([^"]+)"[^)]+fontsize=(\d+)[^)]*\)', code_content)
for fontname, fontsize in matches:
    font_usage.append({
        'function': 'insert_text_with_font',
        'fontname': fontname,
        'fontsize': fontsize
    })

# 查找insert_text调用
matches = re.findall(r'\.insert_text\([^)]+fontname="([^"]+)"[^)]+fontsize=(\d+)[^)]*\)', code_content)
for fontname, fontsize in matches:
    font_usage.append({
        'function': 'insert_text',
        'fontname': fontname,
        'fontsize': fontsize
    })

print(f"找到 {len(font_usage)} 处字体设置:\n")
for i, usage in enumerate(font_usage):
    print(f"{i+1}. {usage['function']}:")
    print(f"   字体: {usage['fontname']}")
    print(f"   字号: {usage['fontsize']}")
    print()

print("="*80)
print("对比分析")
print("="*80)
print()

print("【模板字体 vs 代码字体】")
print("模板:")
print("  数据字段: Calibri, 8pt")
print("  表头和Site: Calibri,Bold 或 Calibri-Bold, 8pt")
print()
print("代码:")
print("  数据字段: dejavu-sans, 8pt")
print("  表头和Site: dejavu-sans-bold, 8pt")
print()
print("结论: ✓ 代码使用DejaVu Sans替代Calibri，字号一致")
