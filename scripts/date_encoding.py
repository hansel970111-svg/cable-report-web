#!/usr/bin/env python3
"""
日期CID编码转换工具

这个模块提供了将日期文本转换为PDF Calibri字体CID编码的功能
"""
import re

# 日期字符到CID的映射（基于原始PDF的ToUnicode映射）
DATE_CHAR_TO_CID = {
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',
    '-': '0372',
    ' ': '0003'
}

def text_to_cid_hex(text):
    """
    将文本转换为CID十六进制字符串
    
    Args:
        text: 输入文本，如 "15-04-2026"
    
    Returns:
        str: CID十六进制字符串，如 "03ED03F1037203EC03F0037203EE03EC03EE03F2"
    """
    result = []
    for char in text:
        if char in DATE_CHAR_TO_CID:
            result.append(DATE_CHAR_TO_CID[char])
        else:
            # 对于未映射的字符，使用空格
            result.append('0003')
    return ''.join(result)


def cid_hex_to_text(hex_str, cid_to_char=None):
    """
    将CID十六进制字符串转换为文本
    
    Args:
        hex_str: CID十六进制字符串
        cid_to_char: CID到字符的映射字典
    
    Returns:
        str: 解码后的文本
    """
    if cid_to_char is None:
        # 使用默认的反向映射
        cid_to_char = {v: k for k, v in DATE_CHAR_TO_CID.items()}
    
    cids = [hex_str[i:i+4] for i in range(0, len(hex_str), 4)]
    return ''.join(cid_to_char.get(cid, '?') for cid in cids)


def build_cid_mapping_from_pdf(pdf_path):
    """
    从PDF文件中提取CID到字符的映射
    
    Args:
        pdf_path: PDF文件路径
    
    Returns:
        dict: CID到字符的映射字典
    """
    import fitz
    
    doc = fitz.open(pdf_path)
    page = doc[0]
    
    mapping = {}
    
    # 获取页面字体
    fonts = page.get_fonts()
    
    for font in fonts:
        xref = font[0]
        base = font[4]  # 如 C2_2, C2_3
        
        # 只处理 Calibri 字体（用于日期）
        if 'Calibri' in font[3]:
            font_obj = doc.xref_object(xref)
            
            # 获取 ToUnicode
            tu_match = re.search(r'/ToUnicode\s+(\d+)', font_obj)
            if tu_match:
                tu_xref = int(tu_match.group(1))
                tu_data = doc.xref_stream(tu_xref)
                tu_text = tu_data.decode('latin-1')
                
                # 解析 bfrange
                ranges = re.findall(r'<([0-9A-Fa-f]+)><([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', tu_text)
                for start_hex, end_hex, unicode_hex in ranges:
                    start = int(start_hex, 16)
                    end = int(end_hex, 16)
                    unicode_start = int(unicode_hex, 16)
                    for i in range(end - start + 1):
                        cid = format(start + i, '04X')
                        char = chr(unicode_start + i)
                        if cid not in mapping:
                            mapping[cid] = char
                
                # 解析 bfchar
                singles = re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', tu_text)
                for cid_hex, unicode_hex in singles:
                    cid = cid_hex.upper()
                    char = chr(int(unicode_hex, 16))
                    if cid not in mapping:
                        mapping[cid] = char
    
    doc.close()
    return mapping


if __name__ == '__main__':
    # 测试
    test_date = "15-04-2026"
    cid = text_to_cid_hex(test_date)
    print(f"'{test_date}' -> CID: {cid}")
    print(f"CID 长度: {len(cid)//4} 字符")
    
    # 验证
    cids = [cid[i:i+4] for i in range(0, len(cid), 4)]
    print(f"CID 列表: {cids}")
    
    # 从PDF提取映射
    mapping = build_cid_mapping_from_pdf('/workspace/projects/assets/M138-DE46-P-A-MPO.pdf')
    print(f"\n从PDF提取的映射（日期相关）:")
    for cid_hex in ['03ED', '03F1', '0372', '03EC', '03F0', '03EE', '03F2']:
        if cid_hex in mapping:
            print(f"  {cid_hex} -> '{mapping[cid_hex]}'")
        else:
            print(f"  {cid_hex} -> 未找到")
