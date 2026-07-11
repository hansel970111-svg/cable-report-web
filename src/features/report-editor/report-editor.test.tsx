// @vitest-environment jsdom

import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DateTimePicker } from '@/components/ui/date-time-picker';
import type { ReportDraft } from '@/domain/report/model';
import type { ImportExcelResult } from '@/features/import-excel/import-excel';
import { browserReportServices } from '@/features/report-workflow/browser-services';
import type { ReportWorkflowServices } from '@/features/report-workflow/services';
import { ReportEditor } from './report-editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function importResult(count = 1): ImportExcelResult {
  return {
    rows: Array.from({ length: count }, (_, index) => ({
      cableNumber: String(index + 1),
      cableTypeText: '红',
      length: 20,
      dateTime: '10-07-2026 09:00:00 AM',
      sourceLabel: null,
      bandwidth: null,
      source: {
        sheetName: 'OOB',
        rowNumber: index + 2,
        expansionIndex: 0,
        rule: 'cat5e-oob' as const,
      },
    })),
    metadata: {
      sheetNames: ['OOB'],
      detectedColumns: {},
      rule: 'cat5e-oob',
    },
  };
}

function makeServices(overrides: Partial<ReportWorkflowServices> = {}) {
  return {
    importExcel: vi.fn<ReportWorkflowServices['importExcel']>(
      async () => importResult(),
    ),
    generateReport: vi.fn<ReportWorkflowServices['generateReport']>(
      async () => ({
        bytes: new ArrayBuffer(8),
        suggestedName: 'report.pdf',
        jobId: 'browser-job-1',
      }),
    ),
    savePdf: vi.fn<ReportWorkflowServices['savePdf']>(
      async () => ({ status: 'saved', fileName: 'report.pdf' }),
    ),
    ...overrides,
  } satisfies ReportWorkflowServices;
}

function excelFile(name = 'cables.xlsx') {
  return new File([Uint8Array.from([1, 2, 3])], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function selectAndImport(
  user: ReturnType<typeof userEvent.setup>,
  file = excelFile(),
) {
  await user.type(screen.getByLabelText('项目号 (Site)'), 'M138-DE46');
  await user.upload(screen.getByLabelText('Excel 布线表'), file);
  await user.click(screen.getByRole('button', { name: '加载并导入' }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.devBrowserMode;
});

describe('ReportEditor import flow', () => {
  it('keeps the preview absent until a complete 5,000-row import commits', async () => {
    const user = userEvent.setup();
    const pending = deferred<ImportExcelResult>();
    const services = makeServices({ importExcel: vi.fn(async () => pending.promise) });
    const { container } = render(<ReportEditor services={services} />);

    await selectAndImport(user);

    expect(screen.getByText('正在导入 Excel…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    pending.resolve(importResult(5_000));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(200);
    expect(screen.getByText('已导入 5000 条记录。')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['file', 'type'] as const)(
    'aborts a stale import when the selected %s changes',
    async mutation => {
      const user = userEvent.setup();
      const pending = deferred<ImportExcelResult>();
      let signal: AbortSignal | undefined;
      const services = makeServices({
        importExcel: vi.fn(async (_file, _type, nextSignal) => {
          signal = nextSignal;
          return pending.promise;
        }),
      });
      render(<ReportEditor services={services} />);
      await selectAndImport(user);
      await waitFor(() => expect(signal).toBeDefined());

      if (mutation === 'file') {
        await user.upload(screen.getByLabelText('Excel 布线表'), excelFile('next.xlsx'));
      } else {
        await user.selectOptions(screen.getByLabelText('线缆类型'), 'LC');
      }

      expect(signal?.aborted).toBe(true);
      expect(screen.queryByText('正在导入 Excel…')).not.toBeInTheDocument();
      pending.resolve(importResult());
      await act(async () => pending.promise);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );

  it('shows a retryable inline import error and retries accessibly', async () => {
    const user = userEvent.setup();
    const importExcel = vi.fn<ReportWorkflowServices['importExcel']>()
      .mockRejectedValueOnce({ message: '文件无法导入。', retryable: true })
      .mockResolvedValueOnce(importResult());
    render(<ReportEditor services={makeServices({ importExcel })} />);

    await selectAndImport(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('文件无法导入。');
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(importExcel).toHaveBeenCalledTimes(2);
  });

  it('deletes the last record into an empty state and disables generation', async () => {
    const user = userEvent.setup();
    render(<ReportEditor services={makeServices()} />);
    await selectAndImport(user);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: '删除线缆 #1' }));

    expect(screen.getByRole('status', { name: '预览状态' }))
      .toHaveTextContent('暂无线缆记录');
    expect(screen.getByRole('button', { name: '生成测试报告' })).toBeDisabled();
  });
});

describe('ReportEditor save feedback', () => {
  it('announces a successful save through the polite live region', async () => {
    const user = userEvent.setup();
    render(<ReportEditor services={makeServices()} />);
    await selectAndImport(user);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: '生成测试报告' }));

    expect(await screen.findByText('已保存 report.pdf。')).toHaveAttribute('aria-live', 'polite');
  });

  it('announces cancellation without claiming success', async () => {
    const user = userEvent.setup();
    const services = makeServices({
      savePdf: vi.fn(async () => ({ status: 'cancelled' as const })),
    });
    render(<ReportEditor services={services} />);
    await selectAndImport(user);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: '生成测试报告' }));

    expect(await screen.findByText('已取消保存。')).toBeInTheDocument();
    expect(screen.queryByText(/PDF 已保存|保存成功/)).not.toBeInTheDocument();
  });

  it('shows a save failure and retries only the cached save', async () => {
    const user = userEvent.setup();
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>()
      .mockResolvedValueOnce({
        status: 'error',
        code: 'SAVE_FAILED',
        message: '保存失败，请重试。',
        retryable: true,
      })
      .mockResolvedValueOnce({ status: 'saved', fileName: 'report.pdf' });
    const services = makeServices({ savePdf });
    render(<ReportEditor services={services} />);
    await selectAndImport(user);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: '生成测试报告' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试。');
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('已保存 report.pdf。')).toBeInTheDocument();
    expect(services.generateReport).toHaveBeenCalledOnce();
    expect(savePdf).toHaveBeenCalledTimes(2);
  });
});

describe('ReportEditor keyboard and environment behavior', () => {
  it('supports Tab, Enter, and Escape without committing draft labels', async () => {
    const user = userEvent.setup();
    render(<ReportEditor services={makeServices()} />);

    await user.tab();
    expect(screen.getByLabelText('项目号 (Site)')).toHaveFocus();
    await user.type(screen.getByLabelText('项目号 (Site)'), 'M138-DE46');
    await user.upload(screen.getByLabelText('Excel 布线表'), excelFile());
    await user.click(screen.getByRole('button', { name: '加载并导入' }));
    await screen.findByRole('table');

    const editButton = screen.getByRole('button', { name: '批量编辑' });
    editButton.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByLabelText('第 1 条 Cable Label');
    await user.clear(input);
    await user.type(input, '#changed');
    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('第 1 条 Cable Label')).not.toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('keeps server-rendered markup free of the client-only browser banner', () => {
    document.documentElement.dataset.devBrowserMode = 'true';

    const markup = renderToString(<ReportEditor services={makeServices()} />);

    expect(markup).not.toContain('浏览器开发模式');
  });

  it('tracks browser mode dataset changes after mount without a parent rerender', async () => {
    render(<ReportEditor services={makeServices()} />);

    expect(screen.queryByText('浏览器开发模式')).not.toBeInTheDocument();

    document.documentElement.dataset.devBrowserMode = 'true';
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '运行模式' }))
        .toHaveTextContent('浏览器开发模式');
    });

    document.documentElement.dataset.devBrowserMode = 'false';
    await waitFor(() => {
      expect(screen.queryByText('浏览器开发模式')).not.toBeInTheDocument();
    });
  });

  it('accepts minute 00 in the date-time picker', () => {
    function Harness() {
      const [value, setValue] = useState('10-07-2026 09:15:00 AM');
      return (
        <>
          <DateTimePicker value={value} onChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('分钟'), { target: { value: '00' } });

    expect(screen.getByText('10-07-2026 09:00:00 AM')).toBeInTheDocument();
  });
});

describe('browserReportServices', () => {
  it('imports raw rows once and generates through only the compatibility APIs', async () => {
    const result = importResult();
    const pdf = Uint8Array.from([37, 80, 68, 70]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(pdf, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="report.pdf"',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const imported = await browserReportServices.importExcel(
      excelFile(),
      'Cat 5e',
      new AbortController().signal,
    );
    const draft: ReportDraft = {
      revision: 1,
      cableType: 'Cat 5e',
      site: 'M138-DE46',
      records: [{
        id: 'record-1',
        cableLabel: '#1',
        cableNumber: '1',
        limit: 'TIA - Cat 5e Channel',
        result: 'PASS',
        length: 20,
        nextMargin: 10,
        dateTime: '10-07-2026 09:00:00 AM',
      }],
    };
    const generated = await browserReportServices.generateReport(
      draft,
      new AbortController().signal,
    );

    expect(imported).toEqual(result);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/import-excel',
      '/api/modify-pdf',
    ]);
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('/api/load-template');
    const importInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(importInit.body).toBeInstanceOf(FormData);
    expect((importInit.body as FormData).get('cableType')).toBe('Cat 5e');
    const generateInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(generateInit.body))).toMatchObject({
      cableType: 'Cat 5e',
      site: 'M138-DE46',
      records: [{ cable_label: '#1', date_time: '10-07-2026 09:00:00 AM' }],
    });
    expect(generated.suggestedName).toBe('report.pdf');
    expect(Array.from(new Uint8Array(generated.bytes))).toEqual(Array.from(pdf));
  });

  it('downloads generated bytes with an object URL and reports the saved name', async () => {
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

    const result = await browserReportServices.savePdf({
      suggestedName: 'report.pdf',
      bytes: Uint8Array.from([37, 80, 68, 70]).buffer,
    });

    expect(result).toEqual({ status: 'saved', fileName: 'report.pdf' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
