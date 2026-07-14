import * as fs from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';

import type { CableType } from '@/domain/report/model';
import {
  importExcel,
  type ImportExcelResult,
} from '@/features/import-excel/import-excel';

const fixturesDirectory = path.resolve('tests/fixtures/excel');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';

XLSX.set_fs(fs);

function fixtureInput(fileName: string) {
  return {
    fileName,
    mimeType: fileName.endsWith('.xls') ? XLS_MIME : XLSX_MIME,
    bytes: Uint8Array.from(readFileSync(path.join(fixturesDirectory, fileName))),
  };
}

const cases: ReadonlyArray<{
  fileName: string;
  cableType: CableType;
  expected: ImportExcelResult;
}> = [
  {
    fileName: 'cat5e-oob.xlsx',
    cableType: 'Cat 5e',
    expected: {
      rows: [{
        cableNumber: '42',
        cableTypeText: '红',
        length: 100,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'OOB', rowNumber: 2, expansionIndex: 0, rule: 'cat5e-oob',
        },
      }],
      metadata: {
        sheetNames: ['OOB'],
        detectedColumns: {
          cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
        },
        rule: 'cat5e-oob',
      },
    },
  },
  {
    fileName: 'vertical.xlsx',
    cableType: 'Cat 5e (Vertical Cabling)',
    expected: {
      rows: [
        {
          cableNumber: 'DE46-01-1',
          cableTypeText: '红',
          length: 30,
          dateTime: null,
          sourceLabel: null,
          bandwidth: null,
          source: {
            sheetName: 'Vertical Cabling', rowNumber: 2, expansionIndex: 0,
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
            sheetName: 'Vertical Cabling', rowNumber: 2, expansionIndex: 1,
            rule: 'vertical-cabling',
          },
        },
      ],
      metadata: {
        sheetNames: ['Vertical Cabling'],
        detectedColumns: {
          cableType: '线缆类型', cableNo: 'Rack&Room', ru: 'RU', qty: 'QTY',
          length: 'Length', dateTime: null,
        },
        rule: 'vertical-cabling',
      },
    },
  },
  {
    fileName: 'lc.xls',
    cableType: 'LC',
    expected: {
      rows: [{
        cableNumber: 'LC-001',
        cableTypeText: 'SM,LC-LC',
        length: 20,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: null,
        source: {
          sheetName: 'Cross Connect', rowNumber: 2, expansionIndex: 0, rule: 'lc',
        },
      }],
      metadata: {
        sheetNames: ['Cross Connect'],
        detectedColumns: {
          cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
        },
        rule: 'lc',
      },
    },
  },
  {
    fileName: 'mpo.xlsx',
    cableType: 'MPO',
    expected: {
      rows: [{
        cableNumber: 'MPO-001',
        cableTypeText: 'MPO 200G',
        length: 15,
        dateTime: '10-07-2026 09:00:00 AM',
        sourceLabel: null,
        bandwidth: '200G',
        source: {
          sheetName: 'Fiber', rowNumber: 2, expansionIndex: 0, rule: 'mpo',
        },
      }],
      metadata: {
        sheetNames: ['Fiber'],
        detectedColumns: {
          cableType: '线缆类型', cableNo: '线号', length: '线长', dateTime: 'Date & Time',
        },
        rule: 'mpo',
      },
    },
  },
];

describe('SheetJS 0.20.3 compatibility', () => {
  test('loads the approved vendored runtime', () => {
    expect(XLSX.version).toBe('0.20.3');
  });

  test.each(cases)('parses $fileName identically', ({ fileName, cableType, expected }) => {
    expect(importExcel(fixtureInput(fileName), cableType)).toEqual(expected);
  });

  test('retains the OOB workbook structure and raw row values', () => {
    const workbook = XLSX.readFile(path.join(fixturesDirectory, 'cat5e-oob.xlsx'));
    expect(workbook.SheetNames).toContain('OOB');
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets.OOB, { header: 1 })[1],
    ).toEqual(['红', '42', 100, '10-07-2026 09:00:00 AM']);
  });
});
