# 测试报告生成系统 (Cable Test Report Generator)

## 项目概述
这是一个用于生成线缆测试报告的 Web 应用程序，支持 MPO 和 Cat5e 两种线缆类型。

## 主要功能
- 生成 MPO/LC 光纤跳线测试报告
- 生成 Cat5e 网线测试报告
- 支持自定义 Site、项目号等字段
- PDF 模板填充和 CID 编码替换

## 技术栈
- **前端**: Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS
- **后端**: Python (pdf_editor.py), PyMuPDF
- **字体**: Calibri (通过 CID 编码直接操作内容流)

## 关键文件
- `scripts/pdf_editor.py` - PDF 编辑核心逻辑
- `scripts/pdf_processor.py` - PDF 解析逻辑（load-template API 使用）
- `assets/M138-DE46-P-A-MPO.pdf` - MPO 模板
- `assets/M138-DE46-OOB-Cat5e.pdf` - Cat5e 模板
- `assets/M138-DE46-D-P-cross-LC.pdf` - LC 模板

## 字体处理 (重要)
### CID 编码映射
模板使用 Type0 (Composite) 字体，字符通过 CID (Character ID) 编码。关键映射：

```
Calibri-Bold (C2_0):
  S=005E, i=015D, t=019A, e=011E, :=0357, (空格)=0003
  D=0018, E=001C, 4=03F0, 6=03F2

Calibri (C2_1/C2_2):
  -=0372, M=0044, 1=03ED, 3=03EF, 8=03F4
  0=03EC, 1=03ED, 2=03EE, 3=03EF, 4=03F0, 5=03F1, 6=03F2, 7=03F3, 8=03F4, 9=03F5
```

## Site 字段处理逻辑 (重要)
Site 字段通过 `replace_site_in_page_stream()` 函数处理，使用 CID 编码替换实现：

### 分割策略
- Site 值按 `-` 分割为 part1 和 part2
- Tj[1] (C2_0 字体) 优先使用 C2_0 支持的字符
- Tj[2] (C2_1 字体) 使用连字符 `-` 和 C2_1 支持的数字
- 剩余空间用空格填充

### 字符分类
- **C2_0 支持**: 字母 (B, C, D, E, F, G, L, M, P, R, S, T, a-z)、数字 4, 6、空格、符号 `&():`
- **C2_1 支持**: 数字 0-9、字母 M、连字符 `-`

## 开发命令
```bash
pnpm dev      # 启动开发服务器 (端口 5000)
pnpm build    # 构建生产版本
pnpm ts-check # TypeScript 类型检查
```

## 模板类型判断
系统通过检查第一页是否存在 MPO 标识来自动判断模板类型：
- MPO 模板: 包含蓝色 "MPO" 标识 (x=13, 宽度≈12)
- Cat5e 模板: 不包含 MPO 标识

## LC 模板结构
- 字段：Cable Label, Limit, Length, Worst Margin, Date, Time
- Result 列是图像（绿色勾 = PASS），解析时默认为 PASS
- 数据行按 y 坐标分组（精度 20px）
- x 位置范围：
  - Cable Label: x < 90
  - Limit: 90 < x < 180
  - Length: x < 220
  - Worst Margin: x < 290
  - Date: x > 310
  - Time: x > 360

## 日期字段处理 (重要)
日期字段通过 `replace_dates_in_tj_format()` 函数处理，使用 CID 编码替换实现：

### 日期格式
- 日期格式: `DD-MM-YYYY` (如 15-05-2026)
- 时间格式: `HH:MM` (如 10:30)

### CID 编码映射 (日期)
```
0=03EC, 1=03ED, 2=03EE, 3=03EF, 4=03F0, 5=03F1, 6=03F2, 7=03F3, 8=03F4, 9=03F5, -=0372
```

### CMap 修复 (_fix_f2_cmap_for_dates)
某些字体 (C2_1, C2_2, C2_4) 的 ToUnicode CMap 缺少数字 4, 5, 7, 8, 9 的映射。
函数会自动检测并添加缺失的映射：
- CID 03F0 -> Unicode 0034 (数字 4)
- CID 03F1 -> Unicode 0035 (数字 5)
- CID 03F3 -> Unicode 0037 (数字 7)
- CID 03F4 -> Unicode 0038 (数字 8)
- CID 03F5 -> Unicode 0039 (数字 9)

### 替换流程
1. 首先修复 CMap（`_fix_f2_cmap_for_dates`）
2. 然后替换日期 Tj 内容（`replace_dates_in_tj_format`）
3. 保持 Calibri 字体特性

## 已知限制
- Site 字段只支持部分字符: D, E, M, P, S, 0-9, -, :, 空格
- 不支持的字符将被替换为空格

## LC 模板字体修复 (2026-05-04)
### 问题描述
LC 模板中 Date & Time 列显示异常，月份 "5" (CID 03F1) 等数字显示为希腊字母或缺失。

### 根本原因
1. **QTEATX+Calibri 字体 CFF 数据缺失**：
   - QTEATX+Calibri 的 FontFile2 (xref=3204) 缺少数字 4, 5, 7, 8, 9 的 glyph 数据
   - WDEFUX+Calibri 的 FontFile2 (xref=3181) 包含完整的 glyph 数据

2. **CMap 映射缺失**：
   - C2_2 (QTEATX+Calibri) 字体的 ToUnicode CMap 缺少数字映射

### 修复方案
1. **FontFile2 共享**：修改 QTEATX+Calibri 的 FontDescriptor，将 FontFile2 引用从 3204 改为 3181
   ```python
   # 修改 FontDescriptor (3202) 的 FontFile2 引用
   fd_obj = fd_obj.replace('/FontFile2 3204', '/FontFile2 3181')
   doc.update_object(3202, new_fd_obj)
   ```

2. **CMap 修复**：`_fix_f2_cmap_for_dates()` 函数为缺失的数字添加映射

### 修复后状态
- QTEATX+Calibri 的 FontFile2 指向 xref=3181 (与 WDEFUX+Calibri 共享)
- FontFile2 大小: 26825 bytes
- 日期 "03-05-2026" 可以正确渲染

## 多数据页处理
当实际数据记录数少于模板页数时，系统会自动：
1. 清空多余页面的数据行
2. 删除完全为空的数据页
3. 保留必要的页面数量 + 汇总页

