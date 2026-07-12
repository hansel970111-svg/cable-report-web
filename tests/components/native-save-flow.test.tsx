// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ReportEditor } from '@/features/report-editor/report-editor';
import type { ImportExcelResult } from '@/features/import-excel/import-excel';
import { browserReportServices } from '@/features/report-workflow/browser-services';
import type { ReportWorkflowServices } from '@/features/report-workflow/services';


const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

function importResult(): ImportExcelResult {
  return {
    rows: [{
      cableNumber: 'MPO 1',
      cableTypeText: '红',
      length: 20,
      dateTime: '10-07-2026 09:00:00 AM',
      sourceLabel: null,
      bandwidth: '200G',
      source: {
        sheetName: 'MPO',
        rowNumber: 2,
        expansionIndex: 0,
        rule: 'mpo',
      },
    }],
    metadata: {
      sheetNames: ['MPO'],
      detectedColumns: {},
      rule: 'mpo',
    },
  };
}

function services(overrides: Partial<ReportWorkflowServices> = {}) {
  return {
    importExcel: vi.fn<ReportWorkflowServices['importExcel']>(async () => importResult()),
    generateReport: vi.fn<ReportWorkflowServices['generateReport']>(async () => ({
      bytes: Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n')).buffer,
      suggestedName: 'M138-DE46_MPO_20260710_090000.pdf',
      jobId: 'job-1',
    })),
    savePdf: vi.fn<ReportWorkflowServices['savePdf']>(async request => ({
      status: 'saved',
      fileName: request.suggestedName,
    })),
    ...overrides,
  } satisfies ReportWorkflowServices;
}

function excelFile() {
  return new File([Uint8Array.from([1, 2, 3])], 'cables.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function importOneRecord(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('项目号 (Site)'), 'M138-DE46');
  await user.selectOptions(screen.getByLabelText('线缆类型'), 'MPO');
  await user.upload(screen.getByLabelText('Excel 布线表'), excelFile());
  await user.click(screen.getByRole('button', { name: '加载并导入' }));
  await screen.findByRole('table');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.cableReport;
  delete document.documentElement.dataset.devBrowserMode;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
});

describe('renderer generate and native save flow', () => {
  test('posts the canonical draft to generate-report and saves through preload', async () => {
    const user = userEvent.setup();
    const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n'));
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>(async () => ({
      status: 'saved' as const,
      fileName: 'M138-DE46_MPO_20260710_090000.pdf',
    }));
    window.cableReport = {
      getDesktopSessionToken: vi.fn(async () => 'desktop-token'),
      savePdf,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: importResult() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(pdf, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="M138-DE46_MPO_20260710_090000.pdf"',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ReportEditor services={browserReportServices} />);

    await importOneRecord(user);
    await user.click(screen.getByRole('button', { name: '生成测试报告' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'M138-DE46_MPO_20260710_090000.pdf',
      );
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/import-excel',
      '/api/generate-report',
    ]);
    const generateInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(generateInit.body));
    expect(payload).toMatchObject({
      revision: expect.any(Number),
      cableType: 'MPO',
      site: 'M138-DE46',
      records: [{
        cableLabel: '#1',
        dateTime: '10-07-2026 09:00:00 AM',
      }],
    });
    expect(payload.records[0]).not.toHaveProperty('cable_label');
    expect(savePdf).toHaveBeenCalledOnce();
    const saveRequest = savePdf.mock.calls[0]?.[0];
    expect(saveRequest?.suggestedName).toBe('M138-DE46_MPO_20260710_090000.pdf');
    expect(Array.from(new Uint8Array(saveRequest?.bytes ?? new ArrayBuffer(0))))
      .toEqual(Array.from(pdf));
  });

  test('native save cancellation returns to ready without a success announcement', async () => {
    const user = userEvent.setup();
    const target = services({
      savePdf: vi.fn(async () => ({ status: 'cancelled' as const })),
    });
    render(<ReportEditor services={target} />);
    await importOneRecord(user);

    await user.click(screen.getByRole('button', { name: '生成测试报告' }));

    expect(await screen.findByText('已取消保存。')).toBeInTheDocument();
    expect(screen.queryByText(/已保存 .*\.pdf/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成测试报告' })).toBeEnabled();
  });

  test('retryable save failure retries cached bytes without regenerating', async () => {
    const user = userEvent.setup();
    const bytes = Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n')).buffer;
    const generateReport = vi.fn<ReportWorkflowServices['generateReport']>(async () => ({
      bytes,
      suggestedName: 'M138-DE46_MPO_20260710_090000.pdf',
      jobId: 'job-1',
    }));
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>()
      .mockResolvedValueOnce({
        status: 'error',
        code: 'SAVE_FAILED',
        message: '保存失败，请重试。',
        retryable: true,
      })
      .mockResolvedValueOnce({
        status: 'saved',
        fileName: 'M138-DE46_MPO_20260710_090000.pdf',
      });
    render(<ReportEditor services={services({ generateReport, savePdf })} />);
    await importOneRecord(user);
    await user.click(screen.getByRole('button', { name: '生成测试报告' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(savePdf).toHaveBeenCalledTimes(2));
    expect(generateReport).toHaveBeenCalledOnce();
    expect(savePdf.mock.calls[0]?.[0].bytes).toBe(bytes);
    expect(savePdf.mock.calls[1]?.[0].bytes).toBe(bytes);
  });
});

describe('browserReportServices save boundary', () => {
  test('missing preload is a non-retryable production error with no anchor click', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:report'),
    });

    await expect(browserReportServices.savePdf({
      suggestedName: 'report.pdf',
      bytes: Uint8Array.from(Buffer.from('%PDF-1.7\n')).buffer,
    })).resolves.toEqual({
      status: 'error',
      code: 'IPC_FORBIDDEN',
      message: expect.any(String),
      retryable: false,
    });
    expect(click).not.toHaveBeenCalled();
  });

  test('anchor download is available only in explicit browser development mode', async () => {
    document.documentElement.dataset.devBrowserMode = 'true';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    await expect(browserReportServices.savePdf({
      suggestedName: 'report.pdf',
      bytes: Uint8Array.from(Buffer.from('%PDF-1.7\n')).buffer,
    })).resolves.toEqual({ status: 'saved', fileName: 'report.pdf' });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
