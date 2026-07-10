import type { CableImportRow } from '@/domain/report/model';
import {
  detectVerticalColumns,
  matchesRedCableType,
  normalizeCell,
  readDateTime,
  readLength,
  readSheetRows,
  type DetectedColumns,
  type ExcelRow,
  type VerticalColumnProfile,
} from '../column-detection';
import { ImportExcelError } from '../errors';
import { defineStrategy, recordLimitExceeded, type StrategyExtraction } from './strategy';

function normalizeVerticalRu(value: unknown): string {
  const text = normalizeCell(value);
  if (!text) return '';

  const match = text.match(/\d{1,2}/);
  return match ? match[0] : text;
}

function verticalRackRoomContainsRu(rackRoom: string, ru: string): boolean {
  if (!rackRoom || !ru) return false;

  const escapedRu = ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[-_]${escapedRu}(?:$|[._\\s-])`).test(rackRoom);
}

function buildVerticalCableBase(row: ExcelRow, rackRoomColumn: number, ruColumn: number) {
  const rackRoom = normalizeCell(row[rackRoomColumn]);
  if (!rackRoom) return '';

  const ru = normalizeVerticalRu(row[ruColumn]);
  if (ru && !verticalRackRoomContainsRu(rackRoom, ru)) return `${rackRoom}-${ru}`;
  return rackRoom;
}

function buildVerticalCableBaseWithFallback(
  row: ExcelRow,
  rackRoomColumn: number,
  ruColumn: number,
): string {
  return buildVerticalCableBase(row, rackRoomColumn, ruColumn)
    || normalizeCell(row[0])
    || normalizeCell(row[4]);
}

function detectedVerticalColumns(profile: VerticalColumnProfile): DetectedColumns {
  const rackRoomColumn = profile.rackRoomCol >= 0 ? profile.rackRoomCol : 1;
  const ruColumn = profile.ruCol >= 0 ? profile.ruCol : 2;

  return {
    cableType: normalizeCell(profile.headers[profile.cableTypeCol]),
    cableNo: normalizeCell(profile.headers[rackRoomColumn]) || 'B列',
    ru: normalizeCell(profile.headers[ruColumn]) || 'C列',
    qty: profile.qtyCol >= 0 ? normalizeCell(profile.headers[profile.qtyCol]) : null,
    length: profile.lengthCols.length > 0
      ? profile.lengthCols.map(column => normalizeCell(profile.headers[column])).join(', ')
      : null,
    dateTime: profile.dateTimeCol >= 0
      ? normalizeCell(profile.headers[profile.dateTimeCol])
      : null,
  };
}

function emptyExtraction(): StrategyExtraction {
  return {
    rows: [],
    detectedColumns: {
      cableType: '未知', cableNo: '未知', ru: null, qty: null, length: null, dateTime: null,
    },
  };
}

export const verticalCablingStrategy = defineStrategy(
  'Cat 5e (Vertical Cabling)',
  (context, limits) => {
    const sheetName = context.workbook.SheetNames.find(
      name => name.toLowerCase().includes('vertical cabling'),
    );
    if (!sheetName) return emptyExtraction();

    const sheetRows = readSheetRows(context.workbook.Sheets[sheetName]);
    if (sheetRows.length === 0) return emptyExtraction();

    const columns = detectVerticalColumns(sheetRows);
    if (!columns) return emptyExtraction();

    const rows: CableImportRow[] = [];
    for (let rowIndex = columns.headerRowIndex + 1; rowIndex < sheetRows.length; rowIndex++) {
      const row = sheetRows[rowIndex];
      const cableTypeText = normalizeCell(row[columns.cableTypeCol]);
      if (!matchesRedCableType(cableTypeText)) continue;

      const rackRoomColumn = columns.rackRoomCol >= 0 ? columns.rackRoomCol : 1;
      const ruColumn = columns.ruCol >= 0 ? columns.ruCol : 2;
      const cableBase = buildVerticalCableBaseWithFallback(
        row,
        rackRoomColumn,
        ruColumn,
      );
      if (!cableBase) continue;

      const qty = columns.qtyCol >= 0
        ? Math.max(Number.parseInt(normalizeCell(row[columns.qtyCol]), 10) || 1, 1)
        : 1;
      if (qty > limits.maxQtyPerRow) {
        throw new ImportExcelError(
          'QTY_LIMIT_EXCEEDED',
          `QTY exceeds the ${limits.maxQtyPerRow}-record per-row limit.`,
          false,
          'QTY',
        );
      }
      if (rows.length + qty > limits.maxRecords) {
        throw recordLimitExceeded(limits.maxRecords);
      }

      for (let expansionIndex = 0; expansionIndex < qty; expansionIndex++) {
        rows.push({
          cableNumber: `${cableBase}-${expansionIndex + 1}`,
          cableTypeText,
          length: readLength(row, columns.lengthCols),
          dateTime: readDateTime(row, columns.dateTimeCol),
          sourceLabel: null,
          bandwidth: null,
          source: {
            sheetName,
            rowNumber: rowIndex + 1,
            expansionIndex,
            rule: 'vertical-cabling',
          },
        });
      }
    }

    return { rows, detectedColumns: detectedVerticalColumns(columns) };
  },
);
