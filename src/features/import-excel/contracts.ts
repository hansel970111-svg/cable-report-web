import type * as XLSX from 'xlsx';

import type { CableImportRow, ImportRule } from '@/domain/report/model';

export const IMPORT_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxRecords: 10_000,
  maxQtyPerRow: 5_000,
} as const;

export type ExcelFileInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type ImportExcelResult = {
  rows: CableImportRow[];
  metadata: {
    sheetNames: string[];
    detectedColumns: Readonly<Record<string, string | null>>;
    rule: ImportRule;
  };
};

export type ImportLimits = {
  maxBytes: number;
  maxRecords: number;
  maxQtyPerRow: number;
};

export type WorkbookContext = {
  workbook: XLSX.WorkBook;
  fileName: string;
  sheetNames: readonly string[];
};
