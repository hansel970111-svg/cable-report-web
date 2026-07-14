export type PdfJobErrorCode =
  | 'REPORT_BUSY'
  | 'REPORT_CANCELLED'
  | 'REPORT_TIMEOUT'
  | 'PDF_PROCESS_FAILED'
  | 'PDF_PROTOCOL_INVALID'
  | 'PDF_OUTPUT_INVALID'
  | 'PDF_OUTPUT_TOO_LARGE';

export class PdfJobError extends Error {
  constructor(
    readonly code: PdfJobErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = 'PdfJobError';
  }
}

export const PDF_JOB_MESSAGES: Readonly<Record<PdfJobErrorCode, string>> = {
  REPORT_BUSY: '已有报告正在生成，请稍后重试。',
  REPORT_CANCELLED: '报告生成已取消。',
  REPORT_TIMEOUT: '报告生成超时，请重试。',
  PDF_PROCESS_FAILED: 'PDF 工作进程执行失败。',
  PDF_PROTOCOL_INVALID: 'PDF 工作进程返回了无效结果。',
  PDF_OUTPUT_INVALID: '生成的 PDF 文件无效。',
  PDF_OUTPUT_TOO_LARGE: '生成的 PDF 文件超过大小限制。',
};

export function pdfJobError(
  code: PdfJobErrorCode,
  retryable: boolean,
  exitCode: number | null = null,
): PdfJobError {
  return new PdfJobError(code, PDF_JOB_MESSAGES[code], retryable, exitCode);
}
