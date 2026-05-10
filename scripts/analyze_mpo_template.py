#!/usr/bin/env python3
"""
分析MPO模板PDF的结构
"""
import sys
import fitz

def analyze_mpo_template(pdf_path):
    """分析MPO模板PDF"""
    doc = fitz.open(pdf_path)

    print("=" * 80)
    print(f"分析MPO模板: {pdf_path}")
    print("=" * 80)

    # 分析第一页
    page = doc[0]

    print("\n【页面信息】")
    print(f"页面尺寸: {page.rect}")
    print(f"页面数量: {len(doc)}")

    # 获取文本
    text_dict = page.get_text("dict")

    print("\n【文本块信息】")
    for block_idx, block in enumerate(text_dict["blocks"]):
        if "lines" not in block:
            continue

        for line_idx, line in enumerate(block["lines"]):
            y = line["bbox"][1]
            print(f"\n--- y={y:.2f} ---")

            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue

                bbox = span["bbox"]
                x0, y0, x1, y1 = bbox
                size = span["size"]
                font = span.get("font", "unknown")
                origin = span.get("origin")

                print(f"  文本: {repr(text)}")
                print(f"    位置: x={x0:.2f}-{x1:.2f}, y={y0:.2f}-{y1:.2f}")
                print(f"    大小: {size:.2f}pt")
                print(f"    字体: {font}")
                print(f"    Origin: {origin}")

    # 搜索特定文本
    print("\n【搜索结果】")

    search_terms = ["Limit", "Length", "NEXT Margin", "Date", "Time", "GBASE", "MPO"]
    for term in search_terms:
        instances = page.search_for(term)
        print(f"\n'{term}': {len(instances)} 个匹配")
        for i, rect in enumerate(instances):
            print(f"  {i+1}. {rect}")

    # 图像信息
    print("\n【图像信息】")
    image_list = page.get_images(full=True)
    print(f"图像数量: {len(image_list)}")
    for img_info in image_list:
        print(f"  {img_info}")

    doc.close()

if __name__ == "__main__":
    # MPO模板路径
    template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

    try:
        analyze_mpo_template(template_path)
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)
