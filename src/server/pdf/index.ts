import { ReportDraftSchema } from '@/domain/report/schema';
import { suggestedPdfName, templateAssetFor } from '@/domain/report/cable-rules';
import { resolveAppPath } from '@/lib/platform';
import { apiError } from '@/server/api-error';
import { PDF_JOB_MESSAGES, PdfJobError } from './errors';
import { PdfJobController } from './job-controller';
import { createPdfWorker } from './worker';

export * from './errors';
export * from './job-controller';
export * from './worker';
export * from './worker-command';

export function desktopE2eTimeoutMs(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number | undefined {
  return environment.CABLE_DESKTOP_E2E === '1'
    && environment.CABLE_DESKTOP_E2E_TIMEOUT === '1'
    ? 3_000
    : undefined;
}

export const pdfJobController = new PdfJobController({
  worker: createPdfWorker(),
  templatePathFor: cableType => resolveAppPath(templateAssetFor(cableType)),
  suggestedNameFor: suggestedPdfName,
  timeoutMs: desktopE2eTimeoutMs(),
});

export const MAX_REPORT_BODY_BYTES = 25 * 1024 * 1024;

export type GenerateReportRouteDependencies = {
  authenticate(request: Request): Response | null;
  controller: Pick<PdfJobController, 'run'>;
  createJobId(): string;
};

function requestFailure(
  status: number,
  code: string,
  message: string,
  retryable = false,
): Response {
  return apiError(status, code, message, retryable);
}

function statusFor(error: PdfJobError): number {
  switch (error.code) {
    case 'REPORT_BUSY':
      return 409;
    case 'REPORT_CANCELLED':
      return 499;
    case 'REPORT_TIMEOUT':
      return 408;
    case 'PDF_PROCESS_FAILED':
    case 'PDF_PROTOCOL_INVALID':
    case 'PDF_OUTPUT_INVALID':
    case 'PDF_OUTPUT_TOO_LARGE':
      return 500;
  }
}

function safeSuggestedName(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.pdf$/.test(value) && !/[\r\n/\\]/.test(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function createGenerateReportHandler(
  dependencies: GenerateReportRouteDependencies,
): (request: Request) => Promise<Response> {
  return async request => {
    try {
      const denied = dependencies.authenticate(request);
      if (denied) return denied;

      const declaredLength = request.headers.get('content-length');
      if (declaredLength === null) {
        return requestFailure(
          411,
          'CONTENT_LENGTH_REQUIRED',
          '请求必须包含 Content-Length。',
        );
      }
      if (!/^\d+$/.test(declaredLength)) {
        return requestFailure(
          400,
          'INVALID_CONTENT_LENGTH',
          'Content-Length 格式无效。',
        );
      }
      if (BigInt(declaredLength) > BigInt(MAX_REPORT_BODY_BYTES)) {
        return requestFailure(
          413,
          'REPORT_BODY_TOO_LARGE',
          '报告请求不能超过 25 MiB。',
        );
      }

      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_REPORT_BODY_BYTES) {
        return requestFailure(
          413,
          'REPORT_BODY_TOO_LARGE',
          '报告请求不能超过 25 MiB。',
        );
      }

      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return requestFailure(
          400,
          'REPORT_JSON_INVALID',
          '报告请求 JSON 格式无效。',
        );
      }

      const parsed = ReportDraftSchema.safeParse(value);
      if (!parsed.success || parsed.data.records.length < 1) {
        return requestFailure(
          400,
          'REPORT_DRAFT_INVALID',
          '报告数据无效。',
        );
      }

      const result = await dependencies.controller.run({
        jobId: dependencies.createJobId(),
        draft: parsed.data,
        signal: request.signal,
      });
      if (!safeSuggestedName(result.suggestedName)) {
        throw new PdfJobError(
          'PDF_OUTPUT_INVALID',
          '生成的 PDF 文件无效。',
          false,
        );
      }

      return new Response(exactArrayBuffer(result.bytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${result.suggestedName}"`,
          'Cache-Control': 'no-store',
          'X-Report-Pages': String(result.pages),
          'X-Report-Records': String(result.records),
        },
      });
    } catch (error) {
      if (error instanceof PdfJobError) {
        return requestFailure(
          statusFor(error),
          error.code,
          PDF_JOB_MESSAGES[error.code],
          error.retryable,
        );
      }
      return requestFailure(
        500,
        'PDF_PROCESS_FAILED',
        'PDF 工作进程执行失败。',
        true,
      );
    }
  };
}
