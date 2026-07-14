# PDF FAIL 结果图标实施计划

> **执行要求：** 使用 `superpowers:test-driven-development`、`superpowers:systematic-debugging`、`pdf` 和 `superpowers:verification-before-completion`。

**目标：** 修复 Cat5e、MPO、LC 数据行中的 FAIL 图标，使其遵守已批准的“红色实心圆 + 白色叉号”设计，同时保持 PASS、汇总和其他版面不变。

**约束：** 只改 `scripts/pdf_editor.py`，并新增独立回归测试 `tests/python/test_pdf_result_icons.py`；不生成或批准 golden，不修改模板 PDF，不重构无关的 PDF 编辑逻辑。

## Task 1: 用真实渲染测试复现缺陷

**Files:**
- Create: `tests/python/test_pdf_result_icons.py`

- [ ] 为 Cat5e、MPO、LC 各构造一条 PASS 和一条 FAIL 记录，并调用现有 `modify_pdf_precise` 入口生成 PDF。
- [ ] 在测试中独立硬编码三种模板首行图标矩形和 15 pt 行距，以 144 DPI 渲染第一页。
- [ ] 断言 PASS 裁剪区含绿色主导像素，FAIL 裁剪区含红色主导像素且无绿色 PASS 图标簇；同时断言文本汇总为 Pass 1 / Fail 1。
- [ ] 运行 `PYTHON_CMD=/Users/lhs/.codex/venvs/cable-report/bin/python corepack pnpm@9.15.9 test:python -- tests/python/test_pdf_result_icons.py`，确认三个模板都因 FAIL 图标仍为绿色而失败。

## Task 2: 最小实现 FAIL 矢量图标

**Files:**
- Modify: `scripts/pdf_editor.py`

- [ ] 新增按模板类型与行索引返回 12 × 12 pt 结果图标矩形的小型 helper。
- [ ] 新增绘制 helper：覆白原区域，绘制 `#DC2626` 实心圆，再绘制两条约 1.5 pt 的白色对角线。
- [ ] 在 Cat5e/MPO 的通用数据页填充路径和 LC 数据页填充路径中，仅当记录 `result == "FAIL"` 时调用绘制 helper；PASS 路径保持不动。
- [ ] 重新运行聚焦测试，确认由红转绿；不得通过放宽像素阈值掩盖错误。

## Task 3: 渲染、检查和回归

- [ ] 将三份两行预览渲染到 `/tmp/pdfs/task5-result-icons/`，分别用 PyMuPDF 与 Poppler 检查图标中心、大小、颜色、抗锯齿和裁切。
- [ ] 运行现有 Task 5 golden 测试，确认它仍只因尚未批准的 `manifest.json` 缺失而失败。
- [ ] 运行完整 Python 测试、`pnpm lint` 和 `pnpm ts-check`，记录精确结果。
- [ ] 只提交实现与结果图标测试，提交信息为 `fix(pdf): render failed row results`；不得暂存 `src/app/api/upload-excel/route 2.ts` 或尚未批准的 golden 文件。
