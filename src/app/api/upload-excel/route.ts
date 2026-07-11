import type { CableType, ImportRule } from '@/domain/report/model';
import {
  createImportExcelPresenterHandler,
  type ImportExcelPresenter,
} from '@/app/api/import-excel/handler';
import { importExcel } from '@/features/import-excel/import-excel';
import { apiError } from '@/server/api-error';
import { requireDesktopApi } from '@/server/desktop-auth';

const LEGACY_DATA_SOURCE: Readonly<Record<ImportRule, string>> = {
  'cat5e-oob': 'OOB',
  'vertical-cabling': 'Vertical Cabling',
  lc: 'LC',
  mpo: 'MPO',
};

const LEGACY_CABLE_TYPE: Readonly<Record<ImportRule, CableType>> = {
  'cat5e-oob': 'Cat 5e',
  'vertical-cabling': 'Cat 5e (Vertical Cabling)',
  lc: 'LC',
  mpo: 'MPO',
};

const LEGACY_PRESENTER: ImportExcelPresenter = {
  success: result => Response.json({
    success: true,
    filteredRows: result.rows.map(row => ({
      cableNo: row.cableNumber,
      cableType: row.cableTypeText,
      length: row.length,
      dateTime: row.dateTime,
      sourceLabel: row.sourceLabel,
      bandwidth: row.bandwidth,
      rowIndex: row.source.rowNumber,
      sheetName: row.source.sheetName,
      ...(row.source.rule === 'vertical-cabling'
        ? { qtyIndex: row.source.expansionIndex + 1 }
        : {}),
    })),
    totalCount: result.rows.length,
    sheetName: result.metadata.sheetNames.join(', '),
    detectedColumns: result.metadata.detectedColumns,
    dataSource: LEGACY_DATA_SOURCE[result.metadata.rule],
    cableType: LEGACY_CABLE_TYPE[result.metadata.rule],
  }),
  failure: failure => apiError(
    failure.status,
    failure.code,
    failure.message,
    failure.retryable,
    failure.field,
  ),
};

const legacyHandler = createImportExcelPresenterHandler({
  importExcel,
  authenticate: requireDesktopApi,
}, LEGACY_PRESENTER);

export async function POST(request: Request): Promise<Response> {
  const response = await legacyHandler(request);
  response.headers.set('Deprecation', 'true');
  return response;
}
