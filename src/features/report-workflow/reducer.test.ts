import { describe, expect, it } from 'vitest';

import type { ReportDraft } from '@/domain/report/model';
import type { WorkflowSelection } from './model';
import {
  canGenerateReport,
  createInitialWorkflowModel,
  workflowReducer,
} from './reducer';

const selection: WorkflowSelection = {
  file: new File([Uint8Array.from([1])], 'cables.xlsx'),
  cableType: 'Cat 5e',
  site: 'M138-DE46',
  startingDateTime: '10-07-2026 09:00:00 AM',
};

function draft(revision = 0): ReportDraft {
  return {
    revision,
    cableType: 'Cat 5e',
    site: 'M138-DE46',
    records: [{
      id: 'record-1',
      cableLabel: '#C001',
      cableNumber: 'C001',
      limit: 'TIA - Cat 5e Channel',
      result: 'PASS',
      length: 20,
      nextMargin: 10,
      dateTime: '10-07-2026 09:00:00 AM',
    }],
  };
}

function readyModel() {
  let model = createInitialWorkflowModel(selection);
  model = workflowReducer(model, {
    type: 'import/started',
    requestId: 'request-1',
    revision: 0,
  });
  return workflowReducer(model, {
    type: 'import/succeeded',
    requestId: 'request-1',
    revision: 0,
    draft: draft(),
  });
}

describe('revision and stale completions', () => {
  it('ignores an old import after the selected cable type changes', () => {
    let model = createInitialWorkflowModel(selection);
    model = workflowReducer(model, {
      type: 'import/started',
      requestId: 'request-1',
      revision: 0,
    });
    model = workflowReducer(model, {
      type: 'selection/changed',
      patch: { cableType: 'MPO' },
    });
    const beforeStaleCompletion = model;
    model = workflowReducer(model, {
      type: 'import/succeeded',
      requestId: 'request-1',
      revision: 0,
      draft: draft(),
    });

    expect(model).toBe(beforeStaleCompletion);
    expect(model.revision).toBe(1);
    expect(model.selection.cableType).toBe('MPO');
    expect(model.state).toEqual({ status: 'idle' });
    expect(model.recoverableDraft).toBeNull();
  });

  it('increments Site, time, label, and delete edits exactly once each', () => {
    let model = readyModel();

    model = workflowReducer(model, {
      type: 'draft/changed',
      change: { kind: 'site', value: 'M138-DE47' },
    });
    expect(model.revision).toBe(1);
    expect(model.selection.site).toBe('M138-DE47');

    model = workflowReducer(model, {
      type: 'draft/changed',
      change: {
        kind: 'starting-date-time',
        value: '10-07-2026 10:00:00 AM',
        dateTimes: ['10-07-2026 10:00:00 AM'],
      },
    });
    expect(model.revision).toBe(2);

    model = workflowReducer(model, {
      type: 'draft/changed',
      change: {
        kind: 'cable-labels',
        values: new Map([['record-1', '#C002']]),
      },
    });
    expect(model.revision).toBe(3);

    model = workflowReducer(model, {
      type: 'draft/changed',
      change: { kind: 'delete', id: 'record-1' },
    });
    expect(model.revision).toBe(4);
    expect(model.state).toMatchObject({ status: 'ready' });
    expect(canGenerateReport(model)).toBe(false);
  });

  it('returns the same object for a no-op selection change', () => {
    const model = createInitialWorkflowModel(selection);
    expect(workflowReducer(model, {
      type: 'selection/changed',
      patch: { cableType: 'Cat 5e' },
    })).toBe(model);
  });

  it('does not allocate a revision for unchanged draft deltas', () => {
    const model = readyModel();

    expect(workflowReducer(model, {
      type: 'draft/changed',
      change: { kind: 'site', value: 'M138-DE46' },
    })).toBe(model);
    expect(workflowReducer(model, {
      type: 'draft/changed',
      change: {
        kind: 'cable-labels',
        values: new Map([['record-1', '#C001']]),
      },
    })).toBe(model);
    expect(workflowReducer(model, {
      type: 'draft/changed',
      change: { kind: 'delete', id: 'missing-record' },
    })).toBe(model);
  });

  it('preserves record identity for a Site-only change', () => {
    const model = readyModel();
    if (model.state.status !== 'ready') throw new Error('Expected ready state.');
    const records = model.state.draft.records;

    const changed = workflowReducer(model, {
      type: 'draft/changed', change: { kind: 'site', value: 'M138-DE47' },
    });
    if (changed.state.status !== 'ready') throw new Error('Expected ready state.');

    expect(changed.state.draft.records).toBe(records);
  });

  it('guards import completion by both request ID and revision', () => {
    let model = createInitialWorkflowModel(selection);
    model = workflowReducer(model, {
      type: 'import/started', requestId: 'request-1', revision: 0,
    });

    expect(workflowReducer(model, {
      type: 'import/succeeded', requestId: 'request-2', revision: 0,
      draft: draft(),
    })).toBe(model);
    expect(workflowReducer(model, {
      type: 'import/failed', requestId: 'request-1', revision: 1,
      message: 'stale', retryable: true,
    })).toBe(model);
  });

  it('does not start an import without a selected file', () => {
    const model = createInitialWorkflowModel({ ...selection, file: null });

    expect(workflowReducer(model, {
      type: 'import/started', requestId: 'request-1', revision: 0,
    })).toBe(model);
  });

  it('keeps the last complete draft recoverable while reimporting', () => {
    let model = readyModel();
    const recoverableDraft = model.recoverableDraft;

    model = workflowReducer(model, {
      type: 'import/started', requestId: 'request-2', revision: 0,
    });
    expect(model.recoverableDraft).toBe(recoverableDraft);

    model = workflowReducer(model, {
      type: 'import/failed', requestId: 'request-2', revision: 0,
      message: '请重试。', retryable: true,
    });
    expect(model.state).toMatchObject({ status: 'error', phase: 'import' });
    expect(model.recoverableDraft).toBe(recoverableDraft);
  });

  it('derives generation eligibility from the runtime ReportDraft schema', () => {
    let model = readyModel();
    expect(canGenerateReport(model)).toBe(true);

    model = workflowReducer(model, {
      type: 'draft/changed',
      change: {
        kind: 'starting-date-time',
        value: 'invalid date',
        dateTimes: ['invalid date'],
      },
    });

    expect(model.state).toMatchObject({ status: 'ready' });
    expect(canGenerateReport(model)).toBe(false);
  });

  it('restores the last complete draft after a failed reimport is dismissed', () => {
    let model = readyModel();
    const previousDraft = model.recoverableDraft;
    model = workflowReducer(model, {
      type: 'import/started', requestId: 'request-2', revision: 0,
    });
    model = workflowReducer(model, {
      type: 'import/failed', requestId: 'request-2', revision: 0,
      message: '文件无法导入。', retryable: false,
    });

    model = workflowReducer(model, { type: 'error/dismissed' });

    expect(model.state).toMatchObject({ status: 'ready' });
    expect(model.recoverableDraft).toBe(previousDraft);
    expect(model.announcement).toBe('已恢复上次报告。');
  });
});

describe('generate and save snapshots', () => {
  it('deeply freezes a generation snapshot', () => {
    const model = readyModel();
    const mutableSnapshot: ReportDraft = {
      ...model.recoverableDraft!,
      records: model.recoverableDraft!.records.map(record => ({ ...record })),
    };
    const generating = workflowReducer(model, {
      type: 'generate/started',
      jobId: 'generation-1',
      revision: model.revision,
      snapshot: mutableSnapshot,
    });

    expect(generating.state.status).toBe('generating');
    if (generating.state.status !== 'generating') throw new Error('Expected generating state.');
    expect(generating.state.snapshot).not.toBe(mutableSnapshot);
    expect(Object.isFrozen(generating.state.snapshot)).toBe(true);
    expect(Object.isFrozen(generating.state.snapshot.records)).toBe(true);
    expect(Object.isFrozen(generating.state.snapshot.records[0])).toBe(true);

    mutableSnapshot.records[0].cableLabel = '#MUTATED';
    expect(generating.state.snapshot.records[0].cableLabel).toBe('#C001');
  });

  it('cannot move an old generation into saving after revision changes', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started',
      jobId: 'generation-1',
      revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'selection/changed',
      patch: { cableType: 'MPO' },
    });
    const beforeStaleCompletion = model;

    model = workflowReducer(model, {
      type: 'generate/succeeded',
      jobId: 'generation-1',
      revision: 0,
      saveId: 'save-1',
      suggestedName: 'old.pdf',
    });

    expect(model).toBe(beforeStaleCompletion);
    expect(model.state).toEqual({ status: 'idle' });
  });

  it('guards generation completion by both job ID and revision', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started',
      jobId: 'generation-1',
      revision: 0,
      snapshot: model.recoverableDraft!,
    });

    expect(workflowReducer(model, {
      type: 'generate/succeeded',
      jobId: 'generation-2',
      revision: 0,
      saveId: 'save-1',
      suggestedName: 'report.pdf',
    })).toBe(model);
    expect(workflowReducer(model, {
      type: 'operation/failed',
      phase: 'generate',
      jobId: 'generation-1',
      revision: 1,
      message: 'stale',
      retryable: true,
    })).toBe(model);
  });

  it('turns an invalid generation success payload into a recoverable error', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1', revision: 0,
      snapshot: model.recoverableDraft!,
    });

    model = workflowReducer(model, {
      type: 'generate/succeeded', jobId: 'generation-1', revision: 0,
      saveId: 'save-1', suggestedName: '',
    });

    expect(model.state).toMatchObject({
      status: 'error', phase: 'generate', retryable: true,
    });
    expect(model.recoverableDraft).not.toBeNull();
  });

  it('exposes generation eligibility only while ready', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1', revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'operation/failed', phase: 'generate', jobId: 'generation-1',
      revision: 0, message: '生成失败。', retryable: true,
    });

    expect(model.state).toMatchObject({ status: 'error', phase: 'generate' });
    expect(canGenerateReport(model)).toBe(false);
  });

  it('cannot bypass an invalid source draft with a valid action snapshot', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'draft/changed',
      change: {
        kind: 'starting-date-time', value: 'invalid date',
        dateTimes: ['invalid date'],
      },
    });
    const before = model;
    const forgedValidSnapshot = draft(model.revision);

    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1',
      revision: before.revision, snapshot: forgedValidSnapshot,
    });

    expect(model).toBe(before);
    expect(model.state.status).toBe('ready');
  });

  it('guards save completions by save ID and returns cancellation to ready', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started',
      jobId: 'generation-1',
      revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'generate/succeeded',
      jobId: 'generation-1',
      revision: 0,
      saveId: 'save-1',
      suggestedName: 'report.pdf',
    });
    expect(model.state).toMatchObject({ status: 'saving', saveId: 'save-1' });
    expect(model.state).toMatchObject({ generationId: 'generation-1' });

    const beforeStaleSave = model;
    model = workflowReducer(model, {
      type: 'save/succeeded',
      saveId: 'old-save',
      revision: 0,
      fileName: 'wrong.pdf',
    });
    expect(model).toBe(beforeStaleSave);

    model = workflowReducer(model, {
      type: 'save/cancelled',
      saveId: 'save-1',
      revision: 0,
    });
    expect(model.state).toMatchObject({ status: 'ready' });
    expect(model.announcement).toBe('已取消保存。');
    expect(model.announcement).not.toMatch(/成功|已保存/);
    expect(canGenerateReport(model)).toBe(true);
  });

  it('starts a new save identity for retry without changing revision', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started',
      jobId: 'generation-1',
      revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'generate/succeeded',
      jobId: 'generation-1',
      revision: 0,
      saveId: 'save-1',
      suggestedName: 'report.pdf',
    });
    model = workflowReducer(model, {
      type: 'operation/failed',
      phase: 'save',
      saveId: 'save-1',
      revision: 0,
      message: '保存失败，请重试。',
      retryable: true,
    });

    model = workflowReducer(model, {
      type: 'save/started',
      generationId: 'generation-1',
      saveId: 'save-2',
      revision: 0,
      suggestedName: 'report.pdf',
    });

    expect(model.revision).toBe(0);
    expect(model.state).toMatchObject({
      status: 'saving',
      saveId: 'save-2',
      suggestedName: 'report.pdf',
    });

    const beforeOldCompletion = model;
    expect(workflowReducer(model, {
      type: 'save/succeeded',
      saveId: 'save-1',
      revision: 0,
      fileName: 'old.pdf',
    })).toBe(beforeOldCompletion);
  });

  it('rejects save-only retry after a non-retryable save failure', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1', revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'generate/succeeded', jobId: 'generation-1', revision: 0,
      saveId: 'save-1', suggestedName: 'report.pdf',
    });
    model = workflowReducer(model, {
      type: 'operation/failed', phase: 'save', saveId: 'save-1', revision: 0,
      message: '无法重试。', retryable: false,
    });
    const failed = model;

    expect(workflowReducer(model, {
      type: 'save/started', generationId: 'generation-1',
      saveId: 'save-2', revision: 0,
      suggestedName: 'report.pdf',
    })).toBe(failed);
  });

  it('announces only the basename returned by native save', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1', revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'generate/succeeded', jobId: 'generation-1', revision: 0,
      saveId: 'save-1', suggestedName: 'report.pdf',
    });
    model = workflowReducer(model, {
      type: 'save/succeeded', saveId: 'save-1', revision: 0,
      fileName: 'C:\\private\\reports\\report.pdf',
    });

    expect(model.announcement).toBe('已保存 report.pdf。');
  });

  it('turns an invalid save success payload into a recoverable error', () => {
    let model = readyModel();
    model = workflowReducer(model, {
      type: 'generate/started', jobId: 'generation-1', revision: 0,
      snapshot: model.recoverableDraft!,
    });
    model = workflowReducer(model, {
      type: 'generate/succeeded', jobId: 'generation-1', revision: 0,
      saveId: 'save-1', suggestedName: 'report.pdf',
    });

    model = workflowReducer(model, {
      type: 'save/succeeded', saveId: 'save-1', revision: 0,
      fileName: '',
    });

    expect(model.state).toMatchObject({
      status: 'error', phase: 'save', retryable: true,
    });
    expect(model.recoverableDraft).not.toBeNull();
  });
});
