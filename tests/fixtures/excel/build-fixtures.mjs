import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as XLSX from 'xlsx';

XLSX.set_fs(fs);

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));

const cases = [
  ['cat5e-oob.xlsx', 'OOB', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['红', '42', 100, '10-07-2026 09:00:00 AM'],
  ]],
  ['vertical.xlsx', 'Vertical Cabling', [
    ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
    ['DE46', 'RU01', '红', 2, 30],
  ]],
  ['lc.xls', 'Cross Connect', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['SM,LC-LC', 'LC-001', 20, '10-07-2026 09:00:00 AM'],
  ]],
  ['mpo.xlsx', 'Fiber', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['MPO 200G', 'MPO-001', 15, '10-07-2026 09:00:00 AM'],
  ]],
];

for (const [fileName, sheetName, rows] of cases) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  XLSX.writeFile(workbook, path.join(fixtureDirectory, fileName));
}
