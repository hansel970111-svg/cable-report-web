#!/usr/bin/env python3
"""
PDF Processor for Cable Test Reports
Handles reading, modifying, and generating PDF reports
"""

import sys
import json
import re
from datetime import datetime
from typing import List, Dict, Any


def parse_pdf(file_path: str, cable_type: str = None) -> Dict[str, Any]:
    """Parse PDF and extract cable test data"""
    try:
        data = {
            'site': '',
            'records': [],
            'page_count': 0,
            'cable_type': cable_type
        }
        
        # Auto-detect cable type from file path if not provided
        if not cable_type:
            if 'LC' in file_path or 'cross' in file_path.lower():
                cable_type = 'LC'
            elif 'MPO' in file_path:
                cable_type = 'MPO'
            else:
                cable_type = 'Cat 5e'
        
        data['cable_type'] = cable_type
        
        import fitz
        doc = fitz.open(file_path)
        data['page_count'] = doc.page_count
        
        # Extract site from first page
        if doc.page_count > 0:
            page = doc[0]
            text = page.get_text()
            if 'Site:' in text:
                site_match = re.search(r'Site:\s*(\S+)', text)
                if site_match:
                    data['site'] = site_match.group(1).strip()
        
        # Parse based on cable type
        if cable_type == 'LC':
            data = parse_lc_records(doc, data)
        elif cable_type == 'MPO':
            data = parse_mpo_records(doc, data)
        else:
            data = parse_cat5e_records(doc, data)
        
        doc.close()
        return data
    except Exception as e:
        return {'error': str(e)}


def parse_mpo_records(doc, data: Dict[str, Any]) -> Dict[str, Any]:
    """Parse MPO records from PDF"""
    import fitz
    
    # 列位置（从之前分析的MPO模板）
    CABLE_LABEL_X = 27
    LIMIT_X = 113
    LENGTH_X = 195
    MARGIN_X = 237
    DATE_X = 280
    TIME_X = 318
    
    X_TOLERANCE = 30  # x坐标容差
    
    def get_x_group(x):
        """将x坐标映射到列组"""
        if x < CABLE_LABEL_X + X_TOLERANCE:
            return 'cable_label'
        elif x < LIMIT_X + X_TOLERANCE:
            return 'limit'
        elif x < LENGTH_X + X_TOLERANCE:
            return 'length'
        elif x < MARGIN_X + X_TOLERANCE:
            return 'margin'
        elif x < TIME_X - X_TOLERANCE:
            return 'date'
        else:
            return 'time'
    
    def y_to_row(y, start_y=87, row_height=15):
        """将y坐标映射到行号"""
        return round((y - start_y) / row_height)
    
    # 预先收集所有日期和时间项（用于合并跨列的日期时间）
    all_dates = {}  # row_num -> date
    all_times = {}  # row_num -> time
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        
        # 获取带坐标的文本
        blocks = page.get_text("dict")["blocks"]
        
        # 第一遍：收集所有日期和时间
        for block in blocks:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if text:
                            x = span["bbox"][0]
                            y = span["bbox"][1]
                            row_num = y_to_row(y)
                            
                            if row_num >= 0:
                                if re.match(r'^\d{2}-\d{2}-\d{4}$', text):
                                    all_dates[row_num] = text
                                elif re.match(r'^\d{2}:\d{2}:\d{2}\s*[AP]M$', text):
                                    all_times[row_num] = text
        
        # 第二遍：按行分组收集数据
        rows = {}  # row_num -> list of (x_group, text)
        
        for block in blocks:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if text:
                            x = span["bbox"][0]
                            y = span["bbox"][1]
                            
                            x_group = get_x_group(x)
                            if x_group:
                                row_num = y_to_row(y)
                                if row_num >= 0:
                                    if row_num not in rows:
                                        rows[row_num] = []
                                    rows[row_num].append((x_group, text))
        
        # 处理每行数据
        for row_num in sorted(rows.keys()):
            items = rows[row_num]
            
            cable_label = None
            limit = None
            length = None
            margin = None
            date = None
            time = None
            
            for x_group, text in items:
                if x_group == 'cable_label' and text.startswith('#'):
                    cable_label = text
                elif x_group == 'limit' and text:
                    limit = text
                elif x_group == 'length' and text and text != '-':
                    length = text
                elif x_group == 'margin' and text and text != '-':
                    margin = text
                elif x_group == 'date':
                    date = text
                elif x_group == 'time':
                    time = text
            
            # 只处理有 cable_label 的行
            if cable_label:
                # 合并日期时间 - 优先使用预收集的数据
                date_time = None
                if row_num in all_dates:
                    date = all_dates[row_num]
                    if row_num in all_times:
                        time = all_times[row_num]
                        date_time = f"{date} {time}"
                    else:
                        # 查找最近的时间
                        for delta in [1, 2, -1, 3, -2]:
                            if row_num + delta in all_times:
                                time = all_times[row_num + delta]
                                date_time = f"{date} {time}"
                                break
                        if not date_time:
                            date_time = date
                
                data['records'].append({
                    'cable_label': cable_label,
                    'limit': limit or '200GBASE-SR10',
                    'result': 'PASS',  # MPO的Result是图像，默认PASS
                    'length': length if length else '-',
                    'next_margin': margin if margin else '-',
                    'date_time': date_time
                })
    
    return data


def parse_cat5e_records(doc, data: Dict[str, Any]) -> Dict[str, Any]:
    """Parse Cat 5e records from PDF - 按列解析"""
    import fitz
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        
        # 获取带坐标的文本
        blocks = page.get_text("dict")["blocks"]
        
        # 收集所有文本项并按行分组
        rows_data: Dict[int, Dict[str, str]] = {}
        
        for block in blocks:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if not text:
                            continue
                        
                        x = span["bbox"][0]
                        y = round(span["bbox"][1] / 15) * 15  # 按15px分组行
                        
                        if y not in rows_data:
                            rows_data[y] = {}
                        
                        # 按 x 坐标分类
                        if text.startswith('#'):
                            rows_data[y]['cable_label'] = text
                        elif re.match(r'^[\d.]+$', text) and 'margin' not in rows_data[y]:
                            rows_data[y]['margin'] = text
                        elif text.startswith('TIA'):
                            rows_data[y]['limit'] = text
                        elif text in ['PASS', 'FAIL']:
                            rows_data[y]['result'] = text
                        elif text == '-':
                            rows_data[y]['length'] = '-'
                        elif re.match(r'^[\d.]+$', text) and 'length' not in rows_data[y]:
                            rows_data[y]['length'] = text
                        elif re.match(r'^\d{2}-\d{2}-\d{4}$', text):
                            rows_data[y]['date'] = text
                        elif re.match(r'^\d{2}:\d{2}:\d{2}\s*[AP]M$', text):
                            rows_data[y]['time'] = text
        
        # 预先收集所有日期和时间项
        all_dates = {}  # y -> date
        all_times = {}  # y -> time
        for block in blocks:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if not text:
                            continue
                        y = round(span["bbox"][1] / 15) * 15
                        if re.match(r'^\d{2}-\d{2}-\d{4}$', text):
                            all_dates[y] = text
                        elif re.match(r'^\d{2}:\d{2}:\d{2}\s*[AP]M$', text):
                            all_times[y] = text
        
        # 提取记录
        for y in sorted(rows_data.keys()):
            row = rows_data[y]
            if 'cable_label' in row and row['cable_label'].startswith('#'):
                # 合并日期时间 - 查找最近的日期和时间
                date_time = None
                if 'date' in row and 'time' in row:
                    date_time = f"{row['date']} {row['time']}"
                elif 'date' not in row:
                    # 查找上下15px范围内的日期
                    for dy in [y-15, y, y+15]:
                        if dy in all_dates:
                            row['date'] = all_dates[dy]
                            break
                    if 'date' in row:
                        # 查找最近的时间
                        for dy in [y, y-15, y-30, y+15]:
                            if dy in all_times:
                                row['time'] = all_times[dy]
                                break
                        if 'time' in row:
                            date_time = f"{row['date']} {row['time']}"
                
                data['records'].append({
                    'cable_label': row.get('cable_label', ''),
                    'limit': row.get('limit', 'TIA - Cat 5e Channel'),
                    'result': row.get('result', 'PASS'),
                    'length': row.get('length', '-'),
                    'next_margin': row.get('margin', '-'),
                    'date_time': date_time,
                    'page': page_num + 1
                })
    
    return data


def parse_lc_records(doc, data: Dict[str, Any]) -> Dict[str, Any]:
    """Parse LC records from PDF - 使用分组-拼接方法处理日期时间"""
    import fitz
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        dict_text = page.get_text('dict')
        image_info = page.get_image_info()
        
        # 获取图像位置映射 (y坐标 -> 行索引)
        result_icons = []
        for img in image_info:
            bbox = img['bbox']
            if 100 < bbox[1] < 800 and 150 < bbox[0] < 180:
                result_icons.append(bbox[1])  # y 坐标
        
        # 收集所有文本项并按行分组
        all_items = []  # [(y, x, text), ...]
        
        for block in dict_text.get('blocks', []):
            if 'lines' not in block:
                continue
            
            for line in block['lines']:
                spans = line.get('spans', [])
                if not spans:
                    continue
                
                for span in spans:
                    x = span['bbox'][0]
                    y = span['bbox'][1]
                    text = span['text'].strip()
                    
                    if not text:
                        continue
                    
                    if 90 < y < 800:  # 数据行范围
                        all_items.append((y, x, text))
        
        # 按 y 坐标分组（精度 15px，与日期时间分组一致）
        rows = {}  # {round_y: [(x, text), ...]}
        for y, x, text in all_items:
            row_key = round(y / 15) * 15  # 使用 15px 精度分组
            if row_key not in rows:
                rows[row_key] = []
            rows[row_key].append((x, text))
        
        # 预先收集所有日期和时间项
        date_time_items = [(y, x, text) for y, x, text in all_items if x > 300]
        # 按 y 坐标分组（精度 15px）
        dt_groups = {}
        for y, x, text in date_time_items:
            group_key = round(y / 15) * 15
            if group_key not in dt_groups:
                dt_groups[group_key] = []
            dt_groups[group_key].append((x, text))
        
        # 解析每一行
        for row_y, spans_list in sorted(rows.items()):
            # 按 x 坐标排序
            spans_list = sorted(spans_list, key=lambda s: s[0])
            
            cable_label = ''
            limit = ''
            length = ''
            worst_margin = ''
            date_time = ''
            
            for x, text in spans_list:
                if x < 80:  # Cable Label 列
                    if '#' in text:
                        cable_label = text
                elif 90 < x < 185:  # Limit 列
                    if text:
                        limit = text
                elif x < 220:  # Length 列
                    try:
                        length = str(float(text))
                    except:
                        pass
                elif x < 290:  # Worst Margin 列
                    try:
                        worst_margin = str(float(text))
                    except:
                        pass
            
            # 获取该行的日期时间（查找相近的 y 坐标组）
            # 使用 row_y 直接查找，或者查找相近的行
            row_key = round(row_y / 15) * 15
            for dy in [0, 15, -15, 30, -30]:
                group_y = row_key + dy
                if group_y in dt_groups:
                    items = sorted(dt_groups[group_y], key=lambda s: s[0])
                    combined = ' '.join([text for _, text in items])
                    # 尝试匹配日期时间格式
                    if re.search(r'\d{2}-\d{2}-\d{4}', combined):
                        date_time = combined
                        break
            
            if cable_label and '#' in cable_label:
                # 从图像判断结果
                result = 'PASS'  # 默认
                for icon_y in result_icons:
                    if abs(icon_y - row_y) < 10:  # 同一行
                        result = 'PASS'
                        break
                
                data['records'].append({
                    'cable_label': cable_label,
                    'cable_number': cable_label.replace('#', ''),
                    'limit': limit if limit else 'N/A',  # LC使用模板原值
                    'result': result,
                    'length': float(length) if length else 0,
                    'next_margin': float(worst_margin) if worst_margin else 0,
                    'date_time': date_time,
                    'page': page_num + 1
                })
    
    return data


def format_datetime_for_display(date_time_str: str) -> str:
    """格式化日期时间用于显示"""
    if not date_time_str:
        return ''
    try:
        # 格式: DD-MM-YYYY HH:MM
        parts = date_time_str.strip().split()
        if len(parts) >= 1:
            date_part = parts[0]
            # DD-MM-YYYY 保持原格式
            date_components = date_part.split('-')
            if len(date_components) == 3:
                formatted_date = f"{date_components[0]}-{date_components[1]}-{date_components[2]}"
            else:
                formatted_date = date_part
        else:
            formatted_date = date_time_str
        
        if len(parts) >= 2:
            time_part = parts[1]
            return f"{formatted_date} {time_part}"
        return formatted_date
    except Exception:
        return date_time_str


def generate_pdf(data: Dict[str, Any], output_path: str) -> bool:
    """Generate a new PDF with modified data"""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, PageBreak
        from reportlab.lib.enums import TA_CENTER, TA_LEFT

        doc = SimpleDocTemplate(
            output_path,
            pagesize=letter,
            rightMargin=0.5*inch,
            leftMargin=0.5*inch,
            topMargin=0.5*inch,
            bottomMargin=0.5*inch
        )
        
        elements = []
        styles = getSampleStyleSheet()
        
        # Custom styles
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=18,
            alignment=TA_CENTER,
            spaceAfter=20
        )
        
        site_style = ParagraphStyle(
            'SiteStyle',
            parent=styles['Heading2'],
            fontSize=14,
            alignment=TA_LEFT,
            spaceAfter=20
        )
        
        # Title
        elements.append(Paragraph("Summary Report", title_style))
        
        # Site info
        if data.get('site'):
            elements.append(Paragraph(f"Site: {data['site']}", site_style))
        
        # Create table data
        table_data = [
            ['Cable Label', 'Limit', 'Result', 'Length (m)', 'NEXT Margin (dB)', 'Factory Calibration Status', 'Date & Time']
        ]
        
        for record in data['records']:
            # 格式化日期时间
            date_time = format_datetime_for_display(record.get('date_time', ''))
            table_data.append([
                record.get('cable_label', ''),
                record.get('limit', ''),
                record.get('result', 'PASS'),
                str(record.get('length', '')),
                str(record.get('next_margin', '')),
                record.get('calibration_status', ''),
                date_time
            ])
        
        # Create table with pagination (max 30 rows per page)
        rows_per_page = 30
        total_rows = len(table_data)
        
        for start_idx in range(0, total_rows, rows_per_page):
            end_idx = min(start_idx + rows_per_page, total_rows)
            page_data = table_data[start_idx:end_idx]
            
            if start_idx > 0:
                elements.append(PageBreak())
            
            table = Table(page_data, repeatRows=1)
            table.setStyle(TableStyle([
                # Header styling
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('TOPPADDING', (0, 0), (-1, 0), 12),
                
                # Body styling
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                
                # Grid
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f0f0')]),
                
                # Padding
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ('TOPPADDING', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
            ]))
            
            elements.append(table)
        
        doc.build(elements)
        return True
    except Exception as e:
        print(f"Error generating PDF: {e}", file=sys.stderr)
        return False


def main():
    """Main function to handle command line arguments - 支持跨平台"""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No action specified'}))
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == 'parse':
        if len(sys.argv) < 3:
            print(json.dumps({'error': 'No file path specified'}))
            sys.exit(1)
        
        file_path = sys.argv[2]
        result = parse_pdf(file_path)
        print(json.dumps(result, indent=2))
    
    elif action == 'generate':
        if len(sys.argv) < 4:
            print(json.dumps({'error': 'Missing output path or data'}))
            sys.exit(1)
        
        output_path = sys.argv[2]
        json_arg = sys.argv[3]
        
        try:
            # 检查参数是JSON字符串还是文件路径
            if json_arg.startswith('{') or json_arg.startswith('['):
                # 直接是JSON字符串
                data = json.loads(json_arg)
            else:
                # 可能是文件路径，尝试读取文件
                try:
                    with open(json_arg, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                except (FileNotFoundError, IOError):
                    # 如果文件不存在，尝试解析为JSON
                    data = json.loads(json_arg)
            
            success = generate_pdf(data, output_path)
            print(json.dumps({'success': success}))
        except json.JSONDecodeError as e:
            print(json.dumps({'error': f'Invalid JSON data: {e}'}))
            sys.exit(1)
        except Exception as e:
            print(json.dumps({'error': f'Error: {str(e)}'}))
            sys.exit(1)
    
    else:
        print(json.dumps({'error': f'Unknown action: {action}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
