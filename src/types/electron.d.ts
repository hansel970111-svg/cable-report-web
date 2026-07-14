import type { SavePdfRequest, SavePdfResult } from '@/features/report-workflow/save-contract';

export {};

declare global {
  interface Window {
    cableReport?: {
      getDesktopSessionToken(): Promise<string>;
      savePdf(request: SavePdfRequest): Promise<SavePdfResult>;
    };
  }
}
