#!/usr/bin/env python3
"""
调试脚本：检查 PDF 内容流中的时间编码
"""
import sys
import json
import fitz

def analyze_time_encoding(pdf_path):
    """分析 PDF 中的时间编码"""
    doc = fitz.open(pdf_path)
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        contents = page.get_contents()
        if not contents:
            continue
            
        content_xref = contents[0]
        stream = doc.xref_stream(content_xref)
        if stream is None:
            continue
            
        stream_text = stream.decode('latin-1', errors='replace')
        
        # 时间编码模式
        time_pattern1 = r'\[<0003>([-.\d]+)<([0-9A-Fa-f]+0003)>([-.\d]+)<([0-9A-Fa-f]{8})>\]TJ'
        time_pattern2 = r'<([0-9A-Fa-f]+)(00570044|00040044)>Tj'
        
        import re
        matches1 = list(re.finditer(time_pattern1, stream_text, re.IGNORECASE))
        matches2 = list(re.finditer(time_pattern2, stream_text, re.IGNORECASE))
        
        print(f"\n=== Page {page_num + 1} ===")
        print(f"stdTJ (标准TJ格式) 数量: {len(matches1)}")
        print(f"simpleTj (简单Tj格式) 数量: {len(matches2)}")
        
        # 打印前5个时间编码
        print("\n前5个时间编码 (stdTJ):")
        for i, match in enumerate(matches1[:5]):
            time_hex = match.group(2)
            pm_hex = match.group(4)
            # 解析时间
            time_cid = time_hex[:-4]  # 去掉末尾的 0003
            pm_str = "PM" if pm_hex == "00570044" else "AM"
            print(f"  [{i}] {match.group()} -> time_hex={time_hex}, pm={pm_str}")
        
        print("\n前5个时间编码 (simpleTj):")
        for i, match in enumerate(matches2[:5]):
            print(f"  [{i}] {match.group()}")
    
    doc.close()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python debug_time_encoding.py <pdf_path>")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    analyze_time_encoding(pdf_path)
