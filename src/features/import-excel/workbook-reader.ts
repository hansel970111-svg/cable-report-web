import * as XLSX from 'xlsx';

import type { ExcelFileInput, ImportLimits, WorkbookContext } from './contracts';
import { ImportExcelError } from './errors';

const XLS_MIME = 'application/vnd.ms-excel';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_PREFIXES = [
  Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
  Uint8Array.from([0x50, 0x4b, 0x05, 0x06]),
  Uint8Array.from([0x50, 0x4b, 0x07, 0x08]),
] as const;

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.byteLength >= prefix.byteLength && prefix.every(
    (value, index) => bytes[index] === value,
  );
}

function excelExtension(fileName: string): '.xls' | '.xlsx' | null {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.xlsx')) return '.xlsx';
  if (normalized.endsWith('.xls')) return '.xls';
  return null;
}

function hasMatchingMimeAndMagic(input: ExcelFileInput, extension: '.xls' | '.xlsx') {
  if (extension === '.xls') {
    return input.mimeType === XLS_MIME && startsWith(input.bytes, OLE);
  }

  return input.mimeType === XLSX_MIME && ZIP_PREFIXES.some(
    prefix => startsWith(input.bytes, prefix),
  );
}

export function readWorkbook(
  input: ExcelFileInput,
  limits: ImportLimits,
): WorkbookContext {
  if (input.bytes.byteLength > limits.maxBytes) {
    throw new ImportExcelError(
      'EXCEL_FILE_TOO_LARGE',
      `Excel file exceeds the ${limits.maxBytes}-byte limit.`,
      false,
      'file',
    );
  }

  const extension = excelExtension(input.fileName);
  if (!extension || !hasMatchingMimeAndMagic(input, extension)) {
    throw new ImportExcelError(
      'UNSUPPORTED_EXCEL_FILE',
      'Only valid .xls and .xlsx Excel workbooks are supported.',
      false,
      'file',
    );
  }

  try {
    const workbook = XLSX.read(input.bytes, { type: 'array', cellDates: true });
    return {
      workbook,
      fileName: input.fileName,
      sheetNames: [...workbook.SheetNames],
    };
  } catch {
    throw new ImportExcelError(
      'EXCEL_PARSE_FAILED',
      'Unable to parse the Excel workbook.',
      false,
      'file',
    );
  }
}
