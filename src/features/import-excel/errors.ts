export type ImportExcelErrorCode =
  | 'UNSUPPORTED_EXCEL_FILE'
  | 'EXCEL_FILE_TOO_LARGE'
  | 'EXCEL_PARSE_FAILED'
  | 'NO_MATCHING_ROWS'
  | 'QTY_LIMIT_EXCEEDED'
  | 'RECORD_LIMIT_EXCEEDED';

export type ImportExcelApiFailure = {
  status: 400 | 413;
  code: ImportExcelErrorCode;
  message: string;
  retryable: false;
  field?: string;
};

const PUBLIC_ERRORS: Readonly<Record<ImportExcelErrorCode, {
  status: 400 | 413;
  message: string;
  retryable: false;
  field?: string;
}>> = Object.freeze({
  UNSUPPORTED_EXCEL_FILE: {
    status: 400,
    message: '仅支持有效的 .xls 或 .xlsx Excel 文件。',
    retryable: false,
    field: 'file',
  },
  EXCEL_FILE_TOO_LARGE: {
    status: 413,
    message: 'Excel 文件不能超过 25 MiB。',
    retryable: false,
    field: 'file',
  },
  EXCEL_PARSE_FAILED: {
    status: 400,
    message: 'Excel 文件解析失败。',
    retryable: false,
    field: 'file',
  },
  NO_MATCHING_ROWS: {
    status: 400,
    message: '未找到与所选线缆类型匹配的记录。',
    retryable: false,
  },
  QTY_LIMIT_EXCEEDED: {
    status: 400,
    message: '单行 QTY 不能超过 5000。',
    retryable: false,
    field: 'QTY',
  },
  RECORD_LIMIT_EXCEEDED: {
    status: 400,
    message: '导入记录不能超过 10000 条。',
    retryable: false,
    field: 'records',
  },
});

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

export function toImportExcelApiFailure(
  error: ImportExcelError,
): ImportExcelApiFailure {
  const definition = PUBLIC_ERRORS[error.code];
  return {
    status: definition.status,
    code: error.code,
    message: definition.message,
    retryable: definition.retryable,
    ...(definition.field ? { field: definition.field } : {}),
  };
}
