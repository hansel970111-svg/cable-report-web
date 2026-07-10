import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type { CableImportRow, CableType } from '@/domain/report/model';
import { POST } from '@/app/api/upload-excel/route';
import {
  excelStrategies,
  importExcel,
  ImportExcelError,
  IMPORT_LIMITS,
} from './import-excel';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const fixturesDirectory = fileURLToPath(
  new URL('../../../tests/fixtures/excel/', import.meta.url),
);

type SheetFixture = readonly [sheetName: string, rows: readonly (readonly unknown[])[]];

function readFixtureBytes(fileName: string): Uint8Array {
  return Uint8Array.from(readFileSync(path.join(fixturesDirectory, fileName)));
}

function fixtureInput(fileName: string) {
  return {
    fileName,
    mimeType: fileName.endsWith('.xls') ? XLS_MIME : XLSX_MIME,
    bytes: readFixtureBytes(fileName),
  };
}

function makeWorkbookBytes(sheets: readonly SheetFixture[]): Uint8Array {
  const workbook = XLSX.utils.book_new();

  for (const [sheetName, rows] of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(
      rows.map(row => [...row]),
      { cellDates: true },
    );
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

function workbookInput(
  sheets: readonly SheetFixture[],
  fileName = 'generated.xlsx',
) {
  return { fileName, mimeType: XLSX_MIME, bytes: makeWorkbookBytes(sheets) };
}

function uploadRequest(
  bytes: Uint8Array,
  fileName: string,
  cableType: string,
  mimeType = XLSX_MIME,
): NextRequest {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const formData = new FormData();
  formData.append('file', new Blob([arrayBuffer], { type: mimeType }), fileName);
  formData.append('cableType', cableType);
  return new NextRequest('http://localhost/api/upload-excel', {
    method: 'POST', body: formData,
  });
}

function expectImportError(
  run: () => unknown,
  expected: Partial<ImportExcelError>,
): ImportExcelError {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ImportExcelError);
  expect(thrown).toMatchObject(expected);
  return thrown as ImportExcelError;
}

describe('real workbook characterization', () => {
  it('imports the Cat 5e OOB fixture as the exact legacy row', () => {
    const result = importExcel(fixtureInput('cat5e-oob.xlsx'), 'Cat 5e');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: '42',
        cableTypeText: '红',
        length: 100,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'OOB', rowNumber: 2, expansionIndex: 0, rule: 'cat5e-oob',
        },
      },
    ]);
    expect(result.metadata).toEqual({
      sheetNames: ['OOB'],
      detectedColumns: {
        cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
      },
      rule: 'cat5e-oob',
    });
  });

  it('imports the Vertical fixture with zero-based expansion coordinates', () => {
    const result = importExcel(
      fixtureInput('vertical.xlsx'),
      'Cat 5e (Vertical Cabling)',
    );

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: 'DE46-01-1',
        cableTypeText: '红',
        length: 30,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Vertical Cabling',
          rowNumber: 2,
          expansionIndex: 0,
          rule: 'vertical-cabling',
        },
      },
      {
        cableNumber: 'DE46-01-2',
        cableTypeText: '红',
        length: 30,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Vertical Cabling',
          rowNumber: 2,
          expansionIndex: 1,
          rule: 'vertical-cabling',
        },
      },
    ]);
    expect(result.metadata).toEqual({
      sheetNames: ['Vertical Cabling'],
      detectedColumns: {
        cableType: '线缆类型', cableNo: 'Rack&Room', ru: 'RU', qty: 'QTY',
        length: 'Length', dateTime: null,
      },
      rule: 'vertical-cabling',
    });
  });

  it('imports the BIFF LC fixture as the exact legacy row', () => {
    const result = importExcel(fixtureInput('lc.xls'), 'LC');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: 'LC-001',
        cableTypeText: 'SM,LC-LC',
        length: 20,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 2, expansionIndex: 0, rule: 'lc',
        },
      },
    ]);
    expect(result.metadata).toEqual({
      sheetNames: ['Cross Connect'],
      detectedColumns: {
        cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
      },
      rule: 'lc',
    });
  });

  it('imports the MPO fixture with extracted bandwidth', () => {
    const result = importExcel(fixtureInput('mpo.xlsx'), 'MPO');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: 'MPO-001',
        cableTypeText: 'MPO 200G',
        length: 15,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: '200G',
        source: {
          sheetName: 'Fiber', rowNumber: 2, expansionIndex: 0, rule: 'mpo',
        },
      },
    ]);
    expect(result.metadata).toEqual({
      sheetNames: ['Fiber'],
      detectedColumns: {
        cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
      },
      rule: 'mpo',
    });
  });
});

describe('legacy parsing rules', () => {
  it('lets YYBX precedence select sheets before the first Workload sheet', () => {
    const result = importExcel(workbookInput([
      ['Before', [
        ['线缆类型', '线号', '线长', 'Marker'],
        ['红', 'BEFORE', 10, 'YYBX'],
      ]],
      ['Workload', [
        ['线缆类型', '线号', '线长'],
        ['红', 'WORKLOAD', 20],
      ]],
      ['OOB After', [
        ['线缆类型', '线号', '线长'],
        ['红', 'AFTER', 30],
      ]],
    ], 'source.xlsx'), 'Cat 5e');

    expect(result.rows.map(row => row.cableNumber)).toEqual(['BEFORE']);
    expect(result.metadata.sheetNames).toEqual(['Before']);
    expect(result.rows[0].source).toEqual({
      sheetName: 'Before', rowNumber: 2, expansionIndex: 0, rule: 'cat5e-oob',
    });
  });

  it('sums the first two prioritized length columns and adds 50 on Cross sheets', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '线长 A', 'Length'],
        ['SM,LC-LC', 'LC-SUM', 10, 20],
      ]],
    ]), 'LC');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: 'LC-SUM',
        cableTypeText: 'SM,LC-LC',
        length: 80,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 2, expansionIndex: 0, rule: 'lc',
        },
      },
    ]);
    expect(result.metadata.detectedColumns.length).toBe('线长 A, Length + 50m');
  });

  it('extracts the MPO blue fallback bandwidth from Source Label', () => {
    const result = importExcel(workbookInput([
      ['Fiber', [
        ['线缆类型', '线号', '线长', 'Source Label'],
        ['MPO', 'MPO-BLUE', 10, 'blue trunk'],
      ]],
    ]), 'MPO');

    expect(result.rows[0]).toMatchObject({
      cableNumber: 'MPO-BLUE', sourceLabel: 'blue trunk', bandwidth: '100G',
    });
  });

  it('normalizes Date cells and preserves already formatted text', () => {
    const result = importExcel(workbookInput([
      ['OOB', [
        ['线缆类型', '线号', '线长', 'Date & Time'],
        ['红', 'DATE', 10, new Date(2026, 6, 10, 9, 0, 0)],
        ['红', 'TEXT', 11, ' 10-07-2026 09:01:00 AM '],
      ]],
    ]), 'Cat 5e');

    expect(result.rows.map(row => row.dateTime)).toEqual([
      '10-07-2026 09:00:00 AM',
      '10-07-2026 09:01:00 AM',
    ]);
  });

  it('keeps the legacy Vertical QTY integer and minimum-one behavior', () => {
    const result = importExcel(workbookInput([
      ['Vertical Cabling', [
        ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
        ['DE46', 'RU01', '红', 2.9, 30],
        ['DE47', 'RU02', '红', 0, 30],
        ['DE48', 'RU03', '红', -4, 30],
        ['DE49', 'RU04', '红', 'invalid', 30],
      ]],
    ]), 'Cat 5e (Vertical Cabling)');

    expect(result.rows.map(row => row.cableNumber)).toEqual([
      'DE46-01-1', 'DE46-01-2', 'DE47-02-1', 'DE48-03-1', 'DE49-04-1',
    ]);
    expect(result.rows.map(row => row.source.expansionIndex)).toEqual([0, 1, 0, 0, 0]);
  });
});

describe('workbook boundary', () => {
  it('publishes the exact default safety limits and all four strategies', () => {
    expect(IMPORT_LIMITS).toEqual({
      maxBytes: 25 * 1024 * 1024,
      maxRecords: 10_000,
      maxQtyPerRow: 5_000,
    });
    expect(excelStrategies).toMatchObject({
      'Cat 5e': { cableType: 'Cat 5e' },
      'Cat 5e (Vertical Cabling)': { cableType: 'Cat 5e (Vertical Cabling)' },
      LC: { cableType: 'LC' },
      MPO: { cableType: 'MPO' },
    });
  });

  it.each([
    ['unsupported extension', 'workbook.csv', XLSX_MIME, readFixtureBytes('cat5e-oob.xlsx')],
    ['trailing extension whitespace', 'workbook.xlsx ', XLSX_MIME, readFixtureBytes('cat5e-oob.xlsx')],
    ['unsupported MIME', 'workbook.xlsx', 'text/csv', readFixtureBytes('cat5e-oob.xlsx')],
    ['extension/MIME mismatch', 'workbook.xlsx', XLS_MIME, readFixtureBytes('cat5e-oob.xlsx')],
    ['invalid ZIP magic', 'workbook.xlsx', XLSX_MIME, Uint8Array.from([1, 2, 3, 4])],
    ['invalid OLE magic', 'workbook.xls', XLS_MIME, readFixtureBytes('cat5e-oob.xlsx')],
  ])('rejects %s before strategy dispatch', (_label, fileName, mimeType, bytes) => {
    expectImportError(
      () => importExcel({ fileName, mimeType, bytes }, 'Cat 5e'),
      { code: 'UNSUPPORTED_EXCEL_FILE', retryable: false },
    );
  });

  it('rejects an oversized payload before attempting to parse its ZIP body', () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);

    expectImportError(
      () => importExcel(
        { fileName: 'large.xlsx', mimeType: XLSX_MIME, bytes },
        'Cat 5e',
        { ...IMPORT_LIMITS, maxBytes: 8 },
      ),
      { code: 'EXCEL_FILE_TOO_LARGE', retryable: false },
    );
  });

  it('maps SheetJS parser failures without exposing the parser message', () => {
    const error = expectImportError(
      () => importExcel({
        fileName: 'corrupt.xlsx',
        mimeType: XLSX_MIME,
        bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      }, 'Cat 5e'),
      { code: 'EXCEL_PARSE_FAILED', retryable: false },
    );

    expect(error.message).not.toMatch(/unsupported zip|sheetjs/i);
  });

  it('returns a typed error when no rows match the requested strategy', () => {
    expectImportError(
      () => importExcel(workbookInput([
        ['OOB', [
          ['线缆类型', '线号', '线长'],
          ['蓝', 'BLUE', 10],
        ]],
      ]), 'Cat 5e'),
      { code: 'NO_MATCHING_ROWS', retryable: false },
    );
  });
});

describe('expansion and record limits', () => {
  it('rejects a Vertical QTY over 5000 before expanding the row', () => {
    expect(() => importExcel({
      fileName: 'vertical.xlsx',
      mimeType: XLSX_MIME,
      bytes: makeWorkbookBytes([
        ['Vertical Cabling', [
          ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
          ['DE46', 'RU01', '红', 5001, 30],
        ]],
      ]),
    }, 'Cat 5e (Vertical Cabling)')).toThrowError(expect.objectContaining({
      code: 'QTY_LIMIT_EXCEEDED', field: 'QTY', retryable: false,
    }));
  });

  it('rejects a cumulative Vertical expansion over 10000 records', () => {
    expectImportError(
      () => importExcel(workbookInput([
        ['Vertical Cabling', [
          ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
          ['DE46', 'RU01', '红', 5000, 30],
          ['DE47', 'RU02', '红', 5000, 30],
          ['DE48', 'RU03', '红', 1, 30],
        ]],
      ]), 'Cat 5e (Vertical Cabling)'),
      { code: 'RECORD_LIMIT_EXCEEDED', retryable: false },
    );
  });

  it.each([
    ['Cat 5e', 'OOB', '红'],
    ['LC', 'Cross Connect', 'SM,LC-LC'],
    ['MPO', 'Fiber', 'MPO 200G'],
  ] satisfies readonly (readonly [CableType, string, string])[])(
    'stops the %s strategy before record maxRecords + 1',
    (cableType, sheetName, rowType) => {
      expectImportError(
        () => importExcel(workbookInput([
          [sheetName, [
            ['线缆类型', '线号', '线长'],
            [rowType, '1', 10],
            [rowType, '2', 10],
            [rowType, '3', 10],
          ]],
        ]), cableType, { ...IMPORT_LIMITS, maxRecords: 2 }),
        { code: 'RECORD_LIMIT_EXCEEDED', retryable: false },
      );
    },
  );
});

describe('legacy upload route adapter', () => {
  it.each([
    ['cat5e-oob.xlsx', 'Cat 5e', XLSX_MIME, 'OOB'],
    ['vertical.xlsx', 'Cat 5e (Vertical Cabling)', XLSX_MIME, 'Vertical Cabling'],
    ['lc.xls', 'LC', XLS_MIME, 'LC'],
    ['mpo.xlsx', 'MPO', XLSX_MIME, 'MPO'],
  ])('maps %s to the legacy %s data source', async (
    fileName,
    cableType,
    mimeType,
    dataSource,
  ) => {
    const response = await POST(uploadRequest(
      readFixtureBytes(fileName),
      fileName,
      cableType,
      mimeType,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dataSource });
  });

  it('preserves the current page fields and legacy source labels', async () => {
    const response = await POST(uploadRequest(
      readFixtureBytes('vertical.xlsx'),
      'vertical.xlsx',
      'Cat 5e (Vertical Cabling)',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      totalCount: 2,
      cableType: 'Cat 5e (Vertical Cabling)',
      sheetName: 'Vertical Cabling',
      dataSource: 'Vertical Cabling',
      filteredRows: [
        {
          cableNo: 'DE46-01-1', cableType: '红', length: 30, dateTime: null,
          sourceLabel: null, bandwidth: null, rowIndex: 2,
          sheetName: 'Vertical Cabling', qtyIndex: 1,
        },
        {
          cableNo: 'DE46-01-2', cableType: '红', length: 30, dateTime: null,
          sourceLabel: null, bandwidth: null, rowIndex: 2,
          sheetName: 'Vertical Cabling', qtyIndex: 2,
        },
      ],
    });
  });

  it('joins only matched source sheets in workbook order', async () => {
    const response = await POST(uploadRequest(makeWorkbookBytes([
      ['OOB A', [
        ['线缆类型', '线号', '线长'],
        ['红', 'A', 10],
      ]],
      ['Ignored', [
        ['线缆类型', '线号', '线长'],
        ['红', 'IGNORED', 20],
      ]],
      ['OOB B', [
        ['线缆类型', '线号', '线长'],
        ['红', 'B', 30],
      ]],
    ]), 'multi.xlsx', 'Cat 5e'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sheetName).toBe('OOB A, OOB B');
    expect(body.filteredRows.map((row: { sheetName: string }) => row.sheetName))
      .toEqual(['OOB A', 'OOB B']);
  });

  it('maps a known no-match import error to a safe legacy 400 envelope', async () => {
    const response = await POST(uploadRequest(makeWorkbookBytes([
      ['OOB', [
        ['线缆类型', '线号', '线长'],
        ['蓝', 'BLUE', 10],
      ]],
    ]), 'no-match.xlsx', 'Cat 5e'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'No matching rows were found for Cat 5e.' });
  });

  it('returns a safe 400 error for an unsupported cable type', async () => {
    const response = await POST(uploadRequest(
      readFixtureBytes('cat5e-oob.xlsx'),
      'cat5e-oob.xlsx',
      'unknown',
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported cable type' });
  });

  it('returns 413 for a workbook over the public byte limit', async () => {
    const bytes = new Uint8Array(IMPORT_LIMITS.maxBytes + 1);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);

    const response = await POST(uploadRequest(bytes, 'large.xlsx', 'Cat 5e'));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: `Excel file exceeds the ${IMPORT_LIMITS.maxBytes}-byte limit.`,
    });
  });

  it('returns a sanitized 500 envelope when request form parsing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await POST(new NextRequest('http://localhost/api/upload-excel', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=broken' },
        body: 'not-a-valid-multipart-body',
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Excel文件解析失败' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
