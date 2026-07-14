// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReportDraft } from '@/domain/report/model';
import type { ImportExcelResult } from '@/features/import-excel/import-excel';
import type { ReportWorkflowServices } from './services';
import { useReportWorkflow } from './use-report-workflow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const importResult: ImportExcelResult = {
  rows: [{
    cableNumber: '42',
    cableTypeText: '红',
    length: 20,
    dateTime: '10-07-2026 09:00:00 AM',
    sourceLabel: null,
    bandwidth: null,
    source: {
      sheetName: 'OOB',
      rowNumber: 2,
      expansionIndex: 0,
      rule: 'cat5e-oob',
    },
  }],
  metadata: {
    sheetNames: ['OOB'],
    detectedColumns: {},
    rule: 'cat5e-oob',
  },
};

function makeFile(name = 'cables.xlsx') {
  return new File([Uint8Array.from([1, 2, 3, 4])], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeServices(overrides: Partial<ReportWorkflowServices> = {}) {
  const services: ReportWorkflowServices = {
    importExcel: vi.fn(async () => importResult),
    generateReport: vi.fn(async () => ({
      bytes: new ArrayBuffer(8),
      suggestedName: 'report.pdf',
      jobId: 'server-job-1',
    })),
    savePdf: vi.fn<ReportWorkflowServices['savePdf']>(
      async () => ({ status: 'saved', fileName: 'report.pdf' }),
    ),
    ...overrides,
  };
  return services;
}

function operationIds() {
  let index = 0;
  return (kind: 'import' | 'generate' | 'save') => `${kind}-${++index}`;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>{children}</StrictMode>
);

function renderWorkflow(services: ReportWorkflowServices) {
  return renderHook(() => useReportWorkflow({
    services,
    initialSelection: {
      file: makeFile(),
      cableType: 'Cat 5e',
      site: 'M138-DE46',
      startingDateTime: '10-07-2026 09:00:00 AM',
    },
    random: { next: () => 0.5 },
    idFactory: () => 'record-1',
    createOperationId: operationIds(),
  }), { wrapper });
}

describe('import ownership', () => {
  it('normalizes undefined initial-selection fields to safe defaults', () => {
    const services = makeServices();
    const { result } = renderHook(() => useReportWorkflow({
      services,
      initialSelection: {
        file: undefined,
        cableType: undefined,
        site: undefined,
        startingDateTime: undefined,
      },
    }), { wrapper });

    expect(result.current.selection.file).toBeNull();
    expect(result.current.selection.cableType).toBe('Cat 5e');
    expect(result.current.selection.site).toBe('');
    expect(result.current.selection.startingDateTime)
      .toMatch(/^\d{2}-\d{2}-\d{4} 09:00:00 AM$/);
  });

  it('aborts before selection transition and ignores a signal-blind stale import', async () => {
    const pending = deferred<ImportExcelResult>();
    let signal: AbortSignal | undefined;
    const importExcel = vi.fn<ReportWorkflowServices['importExcel']>(
      async (_file, _cableType, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      },
    );
    const services = makeServices({ importExcel });
    const { result } = renderWorkflow(services);
    let importPromise!: Promise<void>;

    act(() => {
      importPromise = result.current.importSelected();
    });
    await waitFor(() => expect(result.current.state.status).toBe('importing'));

    act(() => result.current.selectCableType('MPO'));
    expect(signal?.aborted).toBe(true);
    expect(result.current.selection.cableType).toBe('MPO');
    expect(result.current.model.revision).toBe(1);

    pending.resolve(importResult);
    await act(async () => importPromise);

    expect(result.current.state).toEqual({ status: 'idle' });
    expect(result.current.model.recoverableDraft).toBeNull();
  });

  it('maps a successful import exactly once and commits the complete draft', async () => {
    const services = makeServices();
    const { result } = renderWorkflow(services);

    await act(async () => result.current.importSelected());

    expect(services.importExcel).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe('ready');
    expect(result.current.model.recoverableDraft?.records).toEqual([
      expect.objectContaining({
        id: 'record-1',
        cableLabel: '#42',
        cableNumber: '42',
        result: 'PASS',
      }),
    ]);
    expect(result.current.canGenerate).toBe(true);
  });

  it('cancels a signal-blind import explicitly and ignores its late result', async () => {
    const pending = deferred<ImportExcelResult>();
    let signal: AbortSignal | undefined;
    const services = makeServices({
      importExcel: vi.fn(async (_file, _cableType, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      }),
    });
    const { result } = renderWorkflow(services);
    let importPromise!: Promise<void>;

    act(() => {
      importPromise = result.current.importSelected();
    });
    await waitFor(() => expect(result.current.state.status).toBe('importing'));
    act(() => result.current.cancel());

    expect(signal?.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(result.current.model.announcement).toBe('已取消导入。');

    pending.resolve(importResult);
    await act(async () => importPromise);
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(result.current.model.recoverableDraft).toBeNull();
  });

  it('snapshots a mutable label map at the event boundary', async () => {
    const services = makeServices();
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    const values = new Map([['record-1', '#C100']]);

    act(() => {
      result.current.applyCableLabels(values);
      values.set('record-1', '#C200');
    });

    expect(result.current.model.recoverableDraft?.records[0].cableLabel)
      .toBe('#C100');
    expect(result.current.model.recoverableDraft?.records[0].cableNumber)
      .toBe('C100');
  });
});

describe('generate and save ownership', () => {
  it('uses the exact reducer-owned snapshot for generation', async () => {
    const pending = deferred<{
      bytes: ArrayBuffer; suggestedName: string; jobId: string;
    }>();
    let receivedDraft: ReportDraft | undefined;
    const services = makeServices({
      generateReport: vi.fn(async draftValue => {
        receivedDraft = draftValue;
        return pending.promise;
      }),
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    let generationPromise!: Promise<void>;
    act(() => {
      generationPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(result.current.state.status).toBe('generating'));
    if (result.current.state.status !== 'generating') throw new Error('Expected generating.');

    expect(receivedDraft).toBe(result.current.state.snapshot);

    act(() => result.current.cancel());
    pending.resolve({
      bytes: new ArrayBuffer(8), suggestedName: 'ignored.pdf', jobId: 'ignored',
    });
    await act(async () => generationPromise);
  });

  it('does not save when a signal-blind generation resolves after selection changed', async () => {
    const pending = deferred<{
      bytes: ArrayBuffer;
      suggestedName: string;
      jobId: string;
    }>();
    let signal: AbortSignal | undefined;
    const generateReport = vi.fn<ReportWorkflowServices['generateReport']>(
      async (_draft, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      },
    );
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>();
    const services = makeServices({ generateReport, savePdf });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    let generationPromise!: Promise<void>;

    act(() => {
      generationPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(result.current.state.status).toBe('generating'));
    act(() => result.current.selectFile(makeFile('replacement.xlsx')));
    expect(signal?.aborted).toBe(true);

    pending.resolve({
      bytes: new ArrayBuffer(8),
      suggestedName: 'stale.pdf',
      jobId: 'server-stale',
    });
    await act(async () => generationPromise);

    expect(savePdf).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('retries save with the same bytes without regenerating', async () => {
    const bytes = new ArrayBuffer(16);
    const generateReport = vi.fn<ReportWorkflowServices['generateReport']>(async draft => {
      expect(Object.isFrozen(draft)).toBe(true);
      expect(Object.isFrozen(draft.records)).toBe(true);
      expect(Object.isFrozen(draft.records[0])).toBe(true);
      return { bytes, suggestedName: 'report.pdf', jobId: 'server-job-1' };
    });
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>()
      .mockResolvedValueOnce({
        status: 'error',
        code: 'SAVE_FAILED',
        message: '保存失败，请重试。',
        retryable: true,
      })
      .mockResolvedValueOnce({ status: 'saved', fileName: 'report.pdf' });
    const services = makeServices({ generateReport, savePdf });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());

    await act(async () => result.current.generateAndSave());
    expect(result.current.state).toMatchObject({
      status: 'error',
      phase: 'save',
      retryable: true,
    });

    await act(async () => result.current.retry());

    expect(generateReport).toHaveBeenCalledOnce();
    expect(savePdf).toHaveBeenCalledTimes(2);
    expect(vi.mocked(savePdf).mock.calls[0][0].bytes).toBe(bytes);
    expect(vi.mocked(savePdf).mock.calls[1][0].bytes).toBe(bytes);
    expect(result.current.state.status).toBe('ready');
    expect(result.current.model.announcement).toBe('已保存 report.pdf。');
  });

  it('coalesces two same-tick save retries into one native save attempt', async () => {
    const pendingRetry = deferred<Awaited<ReturnType<ReportWorkflowServices['savePdf']>>>();
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>()
      .mockResolvedValueOnce({
        status: 'error', code: 'SAVE_FAILED', message: '请重试。', retryable: true,
      })
      .mockImplementationOnce(async () => pendingRetry.promise);
    const services = makeServices({ savePdf });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    await act(async () => result.current.generateAndSave());
    expect(result.current.state).toMatchObject({ status: 'error', phase: 'save' });

    let firstRetry!: Promise<void>;
    let secondRetry!: Promise<void>;
    act(() => {
      firstRetry = result.current.retry();
      secondRetry = result.current.retry();
    });
    await waitFor(() => expect(savePdf).toHaveBeenCalledTimes(2));
    expect(result.current.state.status).toBe('saving');

    pendingRetry.resolve({ status: 'saved', fileName: 'report.pdf' });
    await act(async () => Promise.all([firstRetry, secondRetry]));
    expect(savePdf).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe('ready');
  });

  it('ignores a native save completion after the selected file changes', async () => {
    const pendingSave = deferred<Awaited<ReturnType<ReportWorkflowServices['savePdf']>>>();
    const services = makeServices({
      savePdf: vi.fn(async () => pendingSave.promise),
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    let generationPromise!: Promise<void>;
    act(() => {
      generationPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(result.current.state.status).toBe('saving'));

    act(() => result.current.selectFile(makeFile('replacement.xlsx')));
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(result.current.model.announcement).toBeNull();

    pendingSave.resolve({ status: 'saved', fileName: 'stale.pdf' });
    await act(async () => generationPromise);
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(result.current.model.announcement).toBeNull();
  });

  it('retries generation from its frozen recoverable draft', async () => {
    const generateReport = vi.fn<ReportWorkflowServices['generateReport']>()
      .mockRejectedValueOnce({ message: '生成失败，请重试。', retryable: true })
      .mockResolvedValueOnce({
        bytes: new ArrayBuffer(8), suggestedName: 'report.pdf', jobId: 'server-job-2',
      });
    const services = makeServices({ generateReport });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    await act(async () => result.current.generateAndSave());
    expect(result.current.state).toMatchObject({ status: 'error', phase: 'generate' });

    await act(async () => result.current.retry());
    expect(generateReport).toHaveBeenCalledTimes(2);
    expect(services.savePdf).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe('ready');
  });

  it('turns an empty generated filename into a recoverable generation error', async () => {
    const services = makeServices({
      generateReport: vi.fn(async () => ({
        bytes: new ArrayBuffer(8), suggestedName: '', jobId: 'server-job-1',
      })),
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());

    await act(async () => result.current.generateAndSave());

    expect(services.savePdf).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: 'error', phase: 'generate', retryable: true,
    });
  });

  it('removes host paths from the generated suggested filename', async () => {
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>(
      async () => ({ status: 'saved', fileName: 'report.pdf' }),
    );
    const services = makeServices({
      generateReport: vi.fn(async () => ({
        bytes: new ArrayBuffer(8),
        suggestedName: '/Users/private/reports/report.pdf',
        jobId: 'server-job-1',
      })),
      savePdf,
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());

    await act(async () => result.current.generateAndSave());

    expect(savePdf).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'report.pdf',
    }));
    expect(result.current.state.status).toBe('ready');
  });

  it('turns an empty native saved filename into a retryable save error', async () => {
    const bytes = new ArrayBuffer(8);
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>()
      .mockResolvedValueOnce({ status: 'saved', fileName: '' })
      .mockResolvedValueOnce({ status: 'saved', fileName: 'report.pdf' });
    const services = makeServices({
      generateReport: vi.fn(async () => ({
        bytes, suggestedName: 'report.pdf', jobId: 'server-job-1',
      })),
      savePdf,
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    await act(async () => result.current.generateAndSave());
    expect(result.current.state).toMatchObject({
      status: 'error', phase: 'save', retryable: true,
    });

    await act(async () => result.current.retry());

    expect(savePdf).toHaveBeenCalledTimes(2);
    expect(vi.mocked(savePdf).mock.calls[0][0].bytes).toBe(bytes);
    expect(vi.mocked(savePdf).mock.calls[1][0].bytes).toBe(bytes);
    expect(result.current.state.status).toBe('ready');
  });

  it('restores the previous draft after a non-retryable reimport failure', async () => {
    const importExcel = vi.fn<ReportWorkflowServices['importExcel']>()
      .mockResolvedValueOnce(importResult)
      .mockRejectedValueOnce({ message: '文件无法导入。', retryable: false });
    const services = makeServices({ importExcel });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    const previousDraft = result.current.model.recoverableDraft;
    await act(async () => result.current.importSelected());
    expect(result.current.state).toMatchObject({
      status: 'error', phase: 'import', retryable: false,
    });

    act(() => result.current.cancel());

    expect(result.current.state.status).toBe('ready');
    expect(result.current.model.recoverableDraft).toBe(previousDraft);
    expect(result.current.model.announcement).toBe('已恢复上次报告。');
  });

  it('uses ref identity when a cancelled and replacement generation share an ID', async () => {
    const first = deferred<{
      bytes: ArrayBuffer; suggestedName: string; jobId: string;
    }>();
    const second = deferred<{
      bytes: ArrayBuffer; suggestedName: string; jobId: string;
    }>();
    const generateReport = vi.fn<ReportWorkflowServices['generateReport']>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const services = makeServices({ generateReport });
    const { result } = renderHook(() => useReportWorkflow({
      services,
      initialSelection: {
        file: makeFile(), cableType: 'Cat 5e', site: 'M138-DE46',
        startingDateTime: '10-07-2026 09:00:00 AM',
      },
      random: { next: () => 0.5 },
      idFactory: () => 'record-1',
      createOperationId: kind => `${kind}-fixed`,
    }), { wrapper });
    await act(async () => result.current.importSelected());
    let oldPromise!: Promise<void>;
    act(() => {
      oldPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(result.current.state.status).toBe('generating'));
    act(() => result.current.cancel());

    let replacementPromise!: Promise<void>;
    act(() => {
      replacementPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(2));

    first.resolve({
      bytes: new ArrayBuffer(4), suggestedName: 'old.pdf', jobId: 'server-old',
    });
    await act(async () => oldPromise);
    expect(services.savePdf).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('generating');

    second.resolve({
      bytes: new ArrayBuffer(8), suggestedName: 'new.pdf', jobId: 'server-new',
    });
    await act(async () => replacementPromise);
    expect(services.savePdf).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe('ready');
  });

  it('treats native save cancellation as ready without a success announcement', async () => {
    const services = makeServices({
      savePdf: vi.fn<ReportWorkflowServices['savePdf']>(
        async () => ({ status: 'cancelled' }),
      ),
    });
    const { result } = renderWorkflow(services);
    await act(async () => result.current.importSelected());

    await act(async () => result.current.generateAndSave());

    expect(result.current.state.status).toBe('ready');
    expect(result.current.model.announcement).toBe('已取消保存。');
    expect(result.current.model.announcement).not.toMatch(/成功|已保存/);

    await act(async () => result.current.retry());
    expect(services.generateReport).toHaveBeenCalledOnce();
    expect(services.savePdf).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight generation on unmount and ignores its late result', async () => {
    const pending = deferred<{
      bytes: ArrayBuffer;
      suggestedName: string;
      jobId: string;
    }>();
    let signal: AbortSignal | undefined;
    const savePdf = vi.fn<ReportWorkflowServices['savePdf']>();
    const services = makeServices({
      generateReport: vi.fn(async (_draft, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      }),
      savePdf,
    });
    const { result, unmount } = renderWorkflow(services);
    await act(async () => result.current.importSelected());
    let generationPromise!: Promise<void>;
    act(() => {
      generationPromise = result.current.generateAndSave();
    });
    await waitFor(() => expect(result.current.state.status).toBe('generating'));

    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve({
      bytes: new ArrayBuffer(8),
      suggestedName: 'late.pdf',
      jobId: 'server-late',
    });
    await generationPromise;

    expect(savePdf).not.toHaveBeenCalled();
  });
});
