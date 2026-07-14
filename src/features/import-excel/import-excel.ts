import type { CableType } from '@/domain/report/model';
import {
  IMPORT_LIMITS,
  type ExcelFileInput,
  type ImportExcelResult,
  type ImportLimits,
} from './contracts';
import { ImportExcelError } from './errors';
import { cat5eOobStrategy } from './strategies/cat5e-oob';
import { lcStrategy } from './strategies/lc';
import { mpoStrategy } from './strategies/mpo';
import {
  type DetailedExcelImportStrategy,
  type ExcelImportStrategy,
} from './strategies/strategy';
import { verticalCablingStrategy } from './strategies/vertical-cabling';
import { readWorkbook } from './workbook-reader';

const detailedStrategies: Readonly<Record<CableType, DetailedExcelImportStrategy>> =
  Object.freeze({
    'Cat 5e': cat5eOobStrategy,
    'Cat 5e (Vertical Cabling)': verticalCablingStrategy,
    LC: lcStrategy,
    MPO: mpoStrategy,
  });

export const excelStrategies: Readonly<Record<CableType, ExcelImportStrategy>> =
  detailedStrategies;

export function importExcel(
  input: ExcelFileInput,
  cableType: CableType,
  limits: ImportLimits = IMPORT_LIMITS,
): ImportExcelResult {
  const workbook = readWorkbook(input, limits);
  const extraction = detailedStrategies[cableType].extractWithMetadata(workbook, limits);

  if (extraction.rows.length === 0) {
    throw new ImportExcelError(
      'NO_MATCHING_ROWS',
      `No matching rows were found for ${cableType}.`,
      false,
    );
  }

  return {
    rows: extraction.rows,
    metadata: {
      sheetNames: Array.from(new Set(
        extraction.rows.map(row => row.source.sheetName),
      )),
      detectedColumns: extraction.detectedColumns,
      rule: extraction.rows[0].source.rule,
    },
  };
}

export { IMPORT_LIMITS, ImportExcelError };
export type {
  ExcelFileInput,
  ImportExcelResult,
  ImportLimits,
  ExcelImportStrategy,
};
