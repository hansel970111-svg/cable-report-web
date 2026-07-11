export type GeneratedReport = {
  bytes: ArrayBuffer;
  suggestedName: string;
  jobId: string;
};

export type SavePdfRequest = {
  suggestedName: string;
  bytes: ArrayBuffer;
};

export type SavePdfErrorCode =
  | 'INVALID_PDF'
  | 'PDF_TOO_LARGE'
  | 'SAVE_FAILED'
  | 'IPC_FORBIDDEN';

export type SavePdfResult =
  | { status: 'saved'; fileName: string }
  | { status: 'cancelled' }
  | {
      status: 'error';
      code: SavePdfErrorCode;
      message: string;
      retryable: boolean;
    };
