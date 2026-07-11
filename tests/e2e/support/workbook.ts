import * as XLSX from 'xlsx';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function makeCat5eWorkbookBuffer(recordCount: number): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string | number>> = [
    ['线缆类型', '线号', '线长', 'Date & Time'],
  ];

  for (let index = 0; index < recordCount; index += 1) {
    rows.push(['红', String(index + 1), 20 + index, '']);
  }

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    'OOB',
  );

  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}
