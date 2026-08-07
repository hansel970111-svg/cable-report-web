import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type { CableImportRow, CableType } from '@/domain/report/model';
import { POST } from '@/app/api/import-excel/route';
import { readSheetRows } from './column-detection';
import {
  excelStrategies,
  importExcel,
  ImportExcelError,
  IMPORT_LIMITS,
} from './import-excel';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const ROUTE_ORIGIN = 'http://localhost';
const ROUTE_TOKEN = 'A'.repeat(43);
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

function makeOffsetWorkbookBytes(
  sheetName: string,
  rows: readonly (readonly unknown[])[],
  origin = 'A5',
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet: XLSX.WorkSheet = {};
  XLSX.utils.sheet_add_aoa(
    worksheet,
    rows.map(row => [...row]),
    { origin, cellDates: true },
  );
  const start = XLSX.utils.decode_cell(origin);
  const width = Math.max(...rows.map(row => row.length));
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: start,
    e: { r: start.r + rows.length - 1, c: start.c + width - 1 },
  });
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

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
  return new NextRequest('http://localhost/api/import-excel', {
    method: 'POST',
    headers: {
      'Content-Length': '1024',
      Origin: ROUTE_ORIGIN,
      'X-Cable-Desktop-Token': ROUTE_TOKEN,
    },
    body: formData,
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

  it('expands both Cable Label and length columns on Cross sheets and sorts naturally', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '线长 A', '线号', 'Length'],
        ['SM,LC-LC', 'LC-10', 10, 'LC-11', 20],
        ['SM,LC-LC', 'LC-2', 30, 'LC-3', 40],
      ]],
    ]), 'LC');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: 'LC-2',
        cableTypeText: 'SM,LC-LC',
        length: 30,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 3, expansionIndex: 0, rule: 'lc',
        },
      },
      {
        cableNumber: 'LC-3',
        cableTypeText: 'SM,LC-LC',
        length: 40,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 3, expansionIndex: 1, rule: 'lc',
        },
      },
      {
        cableNumber: 'LC-10',
        cableTypeText: 'SM,LC-LC',
        length: 10,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 2, expansionIndex: 0, rule: 'lc',
        },
      },
      {
        cableNumber: 'LC-11',
        cableTypeText: 'SM,LC-LC',
        length: 20,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 2, expansionIndex: 1, rule: 'lc',
        },
      },
    ]);
    expect(result.metadata.detectedColumns.length).toBe('线长 A, Length');
  });

  it('expands both ODF Cable Label columns with their corresponding lengths', () => {
    const result = importExcel(workbookInput([
      ['DSW-PSW', [
        ['A设备', '线号', 'A-ODF设备', '长度', 'Z-ODF设备', '线号', '长度', '线缆类型'],
        ['DSW-1', '#10', 'ODF-A', 30, 'ODF-Z', '#2', 40, 'SM,LC-LC,200G'],
      ]],
    ]), 'LC');

    expect(result.rows).toEqual<CableImportRow[]>([
      {
        cableNumber: '#2',
        cableTypeText: 'SM,LC-LC,200G',
        length: 40,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'DSW-PSW', rowNumber: 2, expansionIndex: 1, rule: 'lc',
        },
      },
      {
        cableNumber: '#10',
        cableTypeText: 'SM,LC-LC,200G',
        length: 30,
        dateTime: null,
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'DSW-PSW', rowNumber: 2, expansionIndex: 0, rule: 'lc',
        },
      },
    ]);
    expect(result.metadata.detectedColumns.length).toBe('长度, 长度');
  });

  it('pairs ODF labels with length columns by physical column order', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', 'Length', '线号', '线长'],
        ['SM,LC-LC', '#1', 11, '#2', 22],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => ({
      cableNumber: row.cableNumber,
      length: row.length,
      expansionIndex: row.source.expansionIndex,
    }))).toEqual([
      { cableNumber: '#1', length: 11, expansionIndex: 0 },
      { cableNumber: '#2', length: 22, expansionIndex: 1 },
    ]);
  });

  it('does not let an extra length field shift the second ODF segment', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '线长', '总长度', '线号', '长度'],
        ['SM,LC-LC', '#1', 11, 999, '#2', 22],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => ({
      cableNumber: row.cableNumber,
      length: row.length,
    }))).toEqual([
      { cableNumber: '#1', length: 11 },
      { cableNumber: '#2', length: 22 },
    ]);
  });

  it('prefers the segment line length when a total length field comes first', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '总长度', '线长', '线号', '总长度', '长度'],
        ['SM,LC-LC', '#1', 999, 11, '#2', 888, 22],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => ({
      cableNumber: row.cableNumber,
      length: row.length,
    }))).toEqual([
      { cableNumber: '#1', length: 11 },
      { cableNumber: '#2', length: 22 },
    ]);
  });

  it.each([
    [
      'a second Cable Label',
      ['线缆类型', '线号', '长度', '长度'],
      ['SM,LC-LC', '#1', 30, 40],
    ],
    [
      'a corresponding second length',
      ['线缆类型', '线号', '长度', '线号'],
      ['SM,LC-LC', '#1', 30, '#2'],
    ],
  ])('rejects an ODF segment layout missing %s', (_label, headers, row) => {
    expectImportError(
      () => importExcel(workbookInput([
        ['Cross Connect', [headers, row]],
      ]), 'LC'),
      { code: 'ODF_SEGMENT_COLUMNS_INVALID', retryable: false, field: 'file' },
    );
  });

  it('rejects a matching ODF sheet that exposes only one complete segment', () => {
    expectImportError(
      () => importExcel(workbookInput([
        ['ODF Links', [
          ['线缆类型', '线号', '长度', 'A-ODF设备'],
          ['SM,LC-LC', '#1', 30, 'ODF-A'],
        ]],
      ]), 'LC'),
      { code: 'ODF_SEGMENT_COLUMNS_INVALID', retryable: false, field: 'file' },
    );
  });

  it('ignores malformed Cross sheets that contain no matching LC rows', () => {
    const result = importExcel(workbookInput([
      ['Valid LC', [
        ['线缆类型', '线号', '长度'],
        ['SM,LC-LC', '#7', 70],
      ]],
      ['Cross MPO', [
        ['线缆类型', '线号', '长度', '总长度'],
        ['MPO-MPO,200G', '#M1', 10, 20],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => ({
      cableNumber: row.cableNumber,
      length: row.length,
      sheetName: row.source.sheetName,
    }))).toEqual([
      { cableNumber: '#7', length: 70, sheetName: 'Valid LC' },
    ]);
  });

  it('keeps the second ODF segment paired when the first label is empty', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '线长', '线号', '线长'],
        ['SM,LC-LC', '', 11, '#2', 22],
      ]],
    ]), 'LC');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      cableNumber: '#2',
      length: 22,
      source: { expansionIndex: 1 },
    });
  });

  it('skips only the ODF segment whose corresponding length is invalid', () => {
    const result = importExcel(workbookInput([
      ['Cross Connect', [
        ['线缆类型', '线号', '线长', '线号', '线长'],
        ['SM,LC-LC', '#1', '', '#2', 22],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => ({
      cableNumber: row.cableNumber,
      length: row.length,
      expansionIndex: row.source.expansionIndex,
    }))).toEqual([
      { cableNumber: '#2', length: 22, expansionIndex: 1 },
    ]);
  });

  it('keeps the first Cable Label when duplicate number columns are not an ODF path', () => {
    const result = importExcel(workbookInput([
      ['Fiber', [
        ['线缆类型', '线号', '线号', '线长'],
        ['SM,LC-LC', '#DIRECT-A', '#DIRECT-B', 20],
      ]],
    ]), 'LC');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      cableNumber: '#DIRECT-A',
      length: 20,
      source: { expansionIndex: 0 },
    });
  });

  it('keeps metadata sheet names in workbook order after natural row sorting', () => {
    const result = importExcel(workbookInput([
      ['Cross A', [
        ['线缆类型', '线号', '线长'],
        ['SM,LC-LC', '#10', 10],
      ]],
      ['Cross B', [
        ['线缆类型', '线号', '线长'],
        ['SM,LC-LC', '#2', 20],
      ]],
    ]), 'LC');

    expect(result.rows.map(row => row.cableNumber)).toEqual(['#2', '#10']);
    expect(result.metadata.sheetNames).toEqual(['Cross A', 'Cross B']);
  });

  it('does not sum generic LC length columns when the sheet has no Cross or ODF structure', () => {
    const result = importExcel(workbookInput([
      ['Fiber', [
        ['线缆类型', '线号', '线长 A', 'Length', '备注'],
        ['SM,LC-LC', 'LC-DIRECT', 10, 20, 'ODF 仅出现在数据中'],
      ]],
    ]), 'LC');

    expect(result.rows[0].length).toBe(10);
    expect(result.metadata.detectedColumns.length).toBe('线长 A, Length');
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

  it('records the physical Excel row number when a regular sheet starts at A5', () => {
    const bytes = makeOffsetWorkbookBytes('OOB', [
      ['线缆类型', '线号', '线长'],
      ['红', 'OFFSET', 10],
    ]);

    const result = importExcel({
      fileName: 'offset.xlsx', mimeType: XLSX_MIME, bytes,
    }, 'Cat 5e');

    expect(result.rows[0].source.rowNumber).toBe(6);
  });

  it('records the physical Excel row number for Vertical expansions starting at A5', () => {
    const bytes = makeOffsetWorkbookBytes('Vertical Cabling', [
      ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
      ['DE46', 'RU01', '红', 2, 30],
    ]);

    const result = importExcel({
      fileName: 'offset-vertical.xlsx', mimeType: XLSX_MIME, bytes,
    }, 'Cat 5e (Vertical Cabling)');

    expect(result.rows.map(row => ({
      rowNumber: row.source.rowNumber,
      expansionIndex: row.source.expansionIndex,
    }))).toEqual([
      { rowNumber: 6, expansionIndex: 0 },
      { rowNumber: 6, expansionIndex: 1 },
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

  it('rejects an extreme declared sheet range before materializing its cell matrix', () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['线缆类型', '线号', '线长'],
      ['红', '1', 10],
    ]);
    worksheet['!ref'] = 'A1:XFD500';
    XLSX.utils.book_append_sheet(workbook, worksheet, 'OOB');
    const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));

    expectImportError(
      () => importExcel({ fileName: 'extreme.xlsx', mimeType: XLSX_MIME, bytes }, 'Cat 5e'),
      { code: 'EXCEL_SHEET_TOO_LARGE', retryable: false, field: 'file' },
    );
  });

  it.each(['garbage', 'B2:A1', 'A0:A1'])(
    'rejects an invalid declared sheet range %s before materializing rows',
    reference => {
      expectImportError(
        () => readSheetRows({ '!ref': reference }),
        { code: 'EXCEL_PARSE_FAILED', retryable: false, field: 'file' },
      );
    },
  );

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

  it('applies the record limit after expanding an ODF row into two segments', () => {
    expectImportError(
      () => importExcel(workbookInput([
        ['Cross Connect', [
          ['线缆类型', '线号', '线长', '线号', '线长'],
          ['SM,LC-LC', '#1', 10, '#2', 20],
        ]],
      ]), 'LC', { ...IMPORT_LIMITS, maxRecords: 1 }),
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

describe('canonical import route', () => {
  beforeEach(() => {
    vi.stubEnv('CABLE_DESKTOP_ORIGIN', ROUTE_ORIGIN);
    vi.stubEnv('CABLE_DESKTOP_TOKEN', ROUTE_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['cat5e-oob.xlsx', 'Cat 5e', XLSX_MIME, 'cat5e-oob'],
    ['vertical.xlsx', 'Cat 5e (Vertical Cabling)', XLSX_MIME, 'vertical-cabling'],
    ['lc.xls', 'LC', XLS_MIME, 'lc'],
    ['mpo.xlsx', 'MPO', XLSX_MIME, 'mpo'],
  ])('maps %s to the canonical %s rule', async (
    fileName,
    cableType,
    mimeType,
    rule,
  ) => {
    const response = await POST(uploadRequest(
      readFixtureBytes(fileName),
      fileName,
      cableType,
      mimeType,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Deprecation')).toBeNull();
    expect(await response.json()).toMatchObject({ data: { metadata: { rule } } });
  });

  it('returns canonical rows with source provenance', async () => {
    const response = await POST(uploadRequest(
      readFixtureBytes('vertical.xlsx'),
      'vertical.xlsx',
      'Cat 5e (Vertical Cabling)',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        metadata: {
          rule: 'vertical-cabling',
          sheetNames: ['Vertical Cabling'],
        },
        rows: [
          {
            cableNumber: 'DE46-01-1', cableTypeText: '红', length: 30, dateTime: null,
            sourceLabel: null, bandwidth: null,
            source: { rowNumber: 2, sheetName: 'Vertical Cabling', expansionIndex: 0 },
          },
          {
            cableNumber: 'DE46-01-2', cableTypeText: '红', length: 30, dateTime: null,
            sourceLabel: null, bandwidth: null,
            source: { rowNumber: 2, sheetName: 'Vertical Cabling', expansionIndex: 1 },
          },
        ],
      },
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
    expect(body.data.metadata.sheetNames).toEqual(['OOB A', 'OOB B']);
    expect(body.data.rows.map((row: { source: { sheetName: string } }) => row.source.sheetName))
      .toEqual(['OOB A', 'OOB B']);
  });

  it('maps a known no-match import error to a safe 400 envelope', async () => {
    const response = await POST(uploadRequest(makeWorkbookBytes([
      ['OOB', [
        ['线缆类型', '线号', '线长'],
        ['蓝', 'BLUE', 10],
      ]],
    ]), 'no-match.xlsx', 'Cat 5e'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'NO_MATCHING_ROWS',
        message: '未找到与所选线缆类型匹配的记录。',
        retryable: false,
      },
    });
    expect(response.headers.get('Deprecation')).toBeNull();
  });

  it('returns a safe 400 error for an unsupported cable type', async () => {
    const response = await POST(uploadRequest(
      readFixtureBytes('cat5e-oob.xlsx'),
      'cat5e-oob.xlsx',
      'unknown',
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'UNSUPPORTED_CABLE_TYPE',
        message: '不支持的线缆类型。',
        retryable: false,
        field: 'cableType',
      },
    });
  });

  it('returns 413 for a workbook over the public byte limit', async () => {
    const bytes = new Uint8Array(IMPORT_LIMITS.maxBytes + 1);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);

    const response = await POST(uploadRequest(bytes, 'large.xlsx', 'Cat 5e'));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: 'EXCEL_FILE_TOO_LARGE',
        message: 'Excel 文件不能超过 25 MiB。',
        retryable: false,
        field: 'file',
      },
    });
    expect(response.headers.get('Deprecation')).toBeNull();
  });

  it('returns a stable 400 envelope when request form parsing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await POST(new NextRequest('http://localhost/api/import-excel', {
        method: 'POST',
        headers: {
          'content-length': '128',
          'content-type': 'multipart/form-data; boundary=broken',
          Origin: ROUTE_ORIGIN,
          'X-Cable-Desktop-Token': ROUTE_TOKEN,
        },
        body: 'not-a-valid-multipart-body',
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'INVALID_MULTIPART_FORM',
          message: '上传表单格式无效。',
          retryable: false,
        },
      });
      expect(response.headers.get('Deprecation')).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps authentication errors canonical', async () => {
    const request = uploadRequest(
      readFixtureBytes('cat5e-oob.xlsx'),
      'cat5e-oob.xlsx',
      'Cat 5e',
    );
    request.headers.delete('X-Cable-Desktop-Token');

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.headers.get('Deprecation')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DESKTOP_TOKEN_REQUIRED', retryable: false },
    });
  });
});
