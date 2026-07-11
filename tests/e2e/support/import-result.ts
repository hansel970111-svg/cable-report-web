import type { ImportExcelResult } from '@/features/import-excel/import-excel';

export function makeImportResult(recordCount: number): ImportExcelResult {
  return {
    rows: Array.from({ length: recordCount }, (_, index) => ({
      cableNumber: String(index + 1),
      cableTypeText: '红',
      length: 20 + (index % 10),
      dateTime: '10-07-2026 09:00:00 AM',
      sourceLabel: null,
      bandwidth: null,
      source: {
        sheetName: 'OOB',
        rowNumber: index + 2,
        expansionIndex: 0,
        rule: 'cat5e-oob',
      },
    })),
    metadata: {
      sheetNames: ['OOB'],
      detectedColumns: {
        cableType: '线缆类型',
        cableNo: '线号',
        length: '线长',
        dateTime: 'Date & Time',
      },
      rule: 'cat5e-oob',
    },
  };
}
