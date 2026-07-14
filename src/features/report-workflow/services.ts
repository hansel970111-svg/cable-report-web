import type { CableType, ReportDraft } from '@/domain/report/model';
import type { ImportExcelResult } from '@/features/import-excel/import-excel';
import type {
  GeneratedReport,
  SavePdfRequest,
  SavePdfResult,
} from './save-contract';

export interface ReportWorkflowServices {
  importExcel(
    file: File,
    cableType: CableType,
    signal: AbortSignal,
  ): Promise<ImportExcelResult>;
  generateReport(
    draft: ReportDraft,
    signal: AbortSignal,
  ): Promise<GeneratedReport>;
  savePdf(request: SavePdfRequest): Promise<SavePdfResult>;
}
