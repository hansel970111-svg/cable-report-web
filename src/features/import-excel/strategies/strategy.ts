import type { CableImportRow, CableType, ImportRule } from '@/domain/report/model';
import type { ImportLimits, WorkbookContext } from '../contracts';
import {
  detectSheetColumns,
  readDateTime,
  readFirstCableNo,
  readFirstSourceLabel,
  readLength,
  readSheetRows,
  normalizeCell,
  type DetectedColumns,
} from '../column-detection';
import { ImportExcelError } from '../errors';

export interface ExcelImportStrategy {
  readonly cableType: CableType;
  extract(workbook: WorkbookContext, limits: ImportLimits): CableImportRow[];
}

export type StrategyExtraction = {
  rows: CableImportRow[];
  detectedColumns: DetectedColumns;
};

export interface DetailedExcelImportStrategy extends ExcelImportStrategy {
  extractWithMetadata(
    workbook: WorkbookContext,
    limits: ImportLimits,
  ): StrategyExtraction;
}

type CollectMatchingRowsOptions = {
  rule: ImportRule;
  sheetFilter: (sheetName: string) => boolean;
  typeMatcher: (value: unknown) => boolean;
  generatedCableNo?: (sequence: number) => string;
  replaceConstantExplicitCableNo?: boolean;
  bandwidth?: (cableTypeText: string, sourceLabel: string) => string | null;
  requirePositiveLength?: boolean;
};

export function defineStrategy(
  cableType: CableType,
  extractWithMetadata: DetailedExcelImportStrategy['extractWithMetadata'],
): DetailedExcelImportStrategy {
  return {
    cableType,
    extract: (workbook, limits) => extractWithMetadata(workbook, limits).rows,
    extractWithMetadata,
  };
}

export function recordLimitExceeded(maxRecords: number): ImportExcelError {
  return new ImportExcelError(
    'RECORD_LIMIT_EXCEEDED',
    `Excel import exceeds the ${maxRecords}-record limit.`,
    false,
    'records',
  );
}

export function collectMatchingRows(
  context: WorkbookContext,
  limits: ImportLimits,
  options: CollectMatchingRowsOptions,
): StrategyExtraction {
  const rows: CableImportRow[] = [];
  const explicitCableNumbers: string[] = [];
  let detectedColumns: DetectedColumns | null = null;
  let replacedConstantCableNumber = false;

  for (const sheetName of context.workbook.SheetNames) {
    if (!options.sheetFilter(sheetName)) continue;

    const worksheet = context.workbook.Sheets[sheetName];
    const { rows: sheetRows, firstRowNumber } = readSheetRows(worksheet);
    if (sheetRows.length === 0) continue;

    const columns = detectSheetColumns(sheetRows, sheetName, options.typeMatcher);
    if (!columns) continue;

    for (let rowIndex = columns.headerRowCount; rowIndex < sheetRows.length; rowIndex++) {
      const row = sheetRows[rowIndex];
      const cableTypeText = normalizeCell(row[columns.cableTypeCol]);
      if (!cableTypeText || !options.typeMatcher(cableTypeText)) continue;

      const hasCableNumberColumn = columns.cableNoCols.length > 0;
      const explicitCableNumber = hasCableNumberColumn
        ? readFirstCableNo(row, columns.cableNoCols)
        : '';
      if (hasCableNumberColumn && !explicitCableNumber) continue;

      const generatedCableNumber = hasCableNumberColumn
        ? ''
        : options.generatedCableNo?.(rows.length + 1) || '';
      const cableNumber = explicitCableNumber || generatedCableNumber;
      if (!cableNumber) continue;

      if (!detectedColumns) detectedColumns = columns.detectedColumns;

      const length = readLength(row, columns.lengthCols, columns.lengthMode);
      if (options.requirePositiveLength && (!columns.lengthCols.length || length <= 0)) {
        continue;
      }

      if (rows.length >= limits.maxRecords) throw recordLimitExceeded(limits.maxRecords);

      const sourceLabel = readFirstSourceLabel(row, columns.sourceLabelCols);
      rows.push({
        cableNumber,
        cableTypeText,
        length,
        dateTime: readDateTime(row, columns.dateTimeCol),
        sourceLabel: sourceLabel || null,
        bandwidth: options.bandwidth?.(cableTypeText, sourceLabel) ?? null,
        source: {
          sheetName,
          rowNumber: firstRowNumber + rowIndex,
          expansionIndex: 0,
          rule: options.rule,
        },
      });
      explicitCableNumbers.push(explicitCableNumber);
    }
  }

  if (options.replaceConstantExplicitCableNo && options.generatedCableNo) {
    const rowIndexesBySheet = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const indexes = rowIndexesBySheet.get(row.source.sheetName) || [];
      indexes.push(index);
      rowIndexesBySheet.set(row.source.sheetName, indexes);
    });

    rowIndexesBySheet.forEach(indexes => {
      const values = indexes.map(index => explicitCableNumbers[index]).filter(Boolean);
      if (
        indexes.length > 1
        && values.length === indexes.length
        && new Set(values).size === 1
      ) {
        indexes.forEach(index => {
          rows[index].cableNumber = options.generatedCableNo!(index + 1);
        });
        replacedConstantCableNumber = true;
      }
    });
  }

  if (replacedConstantCableNumber && detectedColumns) {
    detectedColumns = {
      ...detectedColumns,
      cableNo: `${detectedColumns.cableNo} / 自动序号`,
    };
  }

  return {
    rows,
    detectedColumns: detectedColumns || {
      cableType: '未知',
      cableNo: options.generatedCableNo ? '自动序号' : '未知',
      length: null,
      dateTime: null,
    },
  };
}
