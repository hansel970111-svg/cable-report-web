#!/usr/bin/env python3
"""
分析MPO模板的图像位置
"""
import sys
import fitz

def analyze_mpo_images(pdf_path):
    """分析MPO模板PDF中的图像"""
    doc = fitz.open(pdf_path)

    print("=" * 80)
    print(f"分析MPO模板图像: {pdf_path}")
    print("=" * 80)

    # 分析第一页
    page = doc[0]

    # 获取所有图像实例（包括位置信息）
    image_list = page.get_images(full=True)
    print(f"\n总图像数量: {len(image_list)}")

    # 分析每个图像实例
    for img_info in image_list:
        xref = img_info[0]
        print(f"\n图像 xref={xref}:")
        print(f"  基础信息: {img_info}")

        # 查找该图像在页面上的所有实例
        image_instances = page.get_image_rects(xref)
        print(f"  实例数量: {len(image_instances)}")

        for i, rect in enumerate(image_instances):
            print(f"    实例 {i+1}: {rect}")
            # 显示图像所在区域的文本
            area_text = page.get_text("text", clip=rect)
            if area_text.strip():
                print(f"      附近文本: {repr(area_text.strip())}")

    # 分析第一行数据附近的图像
    print("\n\n" + "=" * 80)
    print("第一行数据(y≈87)附近的图像")
    print("=" * 80)

    # 定义第一行数据的大致区域
    first_row_area = fitz.Rect(0, 85, 600, 100)
    nearby_images = []

    for img_info in image_list:
        xref = img_info[0]
        image_instances = page.get_image_rects(xref)

        for rect in image_instances:
            if rect.intersects(first_row_area):
                nearby_images.append((xref, rect))
                print(f"\n图像 xref={xref}:")
                print(f"  位置: {rect}")
                print(f"  基础信息: {img_info}")

    # 分析Result列(x≈171)附近的图像
    print("\n\n" + "=" * 80)
    print("Result列(x≈171)附近的图像（可能是绿色对勾）")
    print("=" * 80)

    result_column_area = fitz.Rect(160, 80, 180, 800)
    result_images = []

    for img_info in image_list:
        xref = img_info[0]
        image_instances = page.get_image_rects(xref)

        for rect in image_instances:
            if rect.intersects(result_column_area):
                result_images.append((xref, rect))
                print(f"\n图像 xref={xref}:")
                print(f"  位置: {rect}")

    # 分析Cable Label列(x≈27)附近的图像（可能是MPO标识）
    print("\n\n" + "=" * 80)
    print("Cable Label列(x≈27)附近的图像（可能是蓝色MPO标识）")
    print("=" * 80)

    cable_label_area = fitz.Rect(10, 80, 60, 800)
    cable_images = []

    for img_info in image_list:
        xref = img_info[0]
        image_instances = page.get_image_rects(xref)

        for rect in image_instances:
            if rect.intersects(cable_label_area):
                cable_images.append((xref, rect))
                print(f"\n图像 xref={xref}:")
                print(f"  位置: {rect}")

    doc.close()

if __name__ == "__main__":
    template_path = "/workspace/projects/assets/M138-DE46-P-A-MPO.pdf"

    try:
        analyze_mpo_images(template_path)
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
