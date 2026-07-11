import { importExcel } from '@/features/import-excel/import-excel';
import { requireDesktopApi } from '@/server/desktop-auth';
import { createImportExcelHandler } from './handler';

export const POST = createImportExcelHandler({
  importExcel,
  authenticate: requireDesktopApi,
});
