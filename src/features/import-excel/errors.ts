export type ImportExcelErrorCode =
  | 'UNSUPPORTED_EXCEL_FILE'
  | 'EXCEL_FILE_TOO_LARGE'
  | 'EXCEL_PARSE_FAILED'
  | 'NO_MATCHING_ROWS'
  | 'QTY_LIMIT_EXCEEDED'
  | 'RECORD_LIMIT_EXCEEDED';

export class ImportExcelError extends Error {
  constructor(
    readonly code: ImportExcelErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ImportExcelError';
  }
}
