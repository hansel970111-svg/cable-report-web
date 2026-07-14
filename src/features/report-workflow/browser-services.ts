import type { ApiError } from '@/domain/report/model';
import type { ImportExcelResult } from '@/features/import-excel/import-excel';
import { desktopFetch, readApiError } from '@/lib/desktop-api';
import type { ReportWorkflowServices } from './services';

type PublicServiceError = Error & { retryable: boolean };

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function throwResponseError(response: Response): Promise<never> {
  let message: string | undefined;
  let retryable = retryableStatus(response.status);
  try {
    const body = await response.clone().json() as Partial<ApiError>;
    if (typeof body.error?.message === 'string' && body.error.message.trim()) {
      message = body.error.message.trim();
    }
    if (typeof body.error?.retryable === 'boolean') {
      retryable = body.error.retryable;
    }
  } catch {
    // readApiError supplies the stable fallback for non-JSON responses.
  }

  const error = new Error(message ?? await readApiError(response)) as PublicServiceError;
  error.retryable = retryable;
  throw error;
}

function responseFileName(response: Response): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8Name = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (utf8Name) {
    try {
      return safeFileName(decodeURIComponent(utf8Name));
    } catch {
      // Fall back to the simple filename parameter.
    }
  }
  const simpleName = /filename[^;=]*=(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  return safeFileName(simpleName?.[1] ?? simpleName?.[2] ?? '');
}

function safeFileName(value: string): string {
  const basename = value.trim().replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  return /^[A-Za-z0-9_-]+\.pdf$/i.test(basename)
    ? basename
    : 'cable_test_report.pdf';
}

export const browserReportServices: ReportWorkflowServices = {
  async importExcel(file, cableType, signal) {
    const formData = new FormData();
    formData.set('file', file);
    formData.set('cableType', cableType);
    const response = await desktopFetch('/api/import-excel', {
      method: 'POST',
      body: formData,
      signal,
    });
    if (!response.ok) await throwResponseError(response);
    const body = await response.json() as { data?: ImportExcelResult };
    if (body.data === undefined || !Array.isArray(body.data.rows)) {
      const error = new Error('导入服务返回了无效数据。') as PublicServiceError;
      error.retryable = true;
      throw error;
    }
    return body.data;
  },

  async generateReport(draft, signal) {
    const response = await desktopFetch('/api/generate-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
      signal,
    });
    if (!response.ok) await throwResponseError(response);
    return {
      bytes: await response.arrayBuffer(),
      suggestedName: responseFileName(response),
      jobId: response.headers.get('x-report-job-id') ?? 'browser-report',
    };
  },

  async savePdf({ bytes, suggestedName }) {
    if (window.cableReport?.savePdf) {
      try {
        return await window.cableReport.savePdf({ bytes, suggestedName });
      } catch {
        return {
          status: 'error',
          code: 'SAVE_FAILED',
          message: '无法保存 PDF，请重试。',
          retryable: true,
        };
      }
    }

    if (document.documentElement.dataset.devBrowserMode !== 'true') {
      return {
        status: 'error',
        code: 'IPC_FORBIDDEN',
        message: '桌面保存服务不可用，请重启应用。',
        retryable: false,
      };
    }

    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = suggestedName;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      return { status: 'saved', fileName: suggestedName };
    } catch {
      return {
        status: 'error',
        code: 'SAVE_FAILED',
        message: '无法保存 PDF，请重试。',
        retryable: true,
      };
    } finally {
      anchor?.remove();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    }
  },
};
