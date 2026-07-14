import type { SavePdfRequest, SavePdfResult } from '@/features/report-workflow/save-contract';
import type { DesktopUpdateApi } from '@/features/app-update/model';

export {};

declare global {
  interface Window {
    cableReport?: Partial<DesktopUpdateApi> & {
      getDesktopSessionToken(): Promise<string>;
      savePdf(request: SavePdfRequest): Promise<SavePdfResult>;
    };
  }
}
