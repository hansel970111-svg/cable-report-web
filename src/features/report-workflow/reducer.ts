import type { ReportDraft } from '@/domain/report/model';
import { ReportDraftSchema } from '@/domain/report/schema';
import type {
  DraftChange,
  WorkflowAction,
  WorkflowModel,
  WorkflowSelection,
} from './model';

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const basename = (value: string): string =>
  value.trim().split(/[\\/]/).at(-1)?.trim() ?? '';

function currentEditableDraft(model: WorkflowModel): ReportDraft | null {
  switch (model.state.status) {
    case 'ready':
      return model.state.draft;
    case 'generating':
    case 'saving':
      return model.state.snapshot;
    case 'error':
      return model.recoverableDraft;
    default:
      return null;
  }
}

function generationStartDraft(model: WorkflowModel): ReportDraft | null {
  if (model.state.status === 'ready') return model.state.draft;
  if (model.state.status === 'error'
      && model.state.phase === 'generate'
      && model.state.retryable) {
    return model.recoverableDraft;
  }
  return null;
}

function withDraftChanges(
  draft: ReportDraft,
  overrides: Partial<Pick<ReportDraft, 'revision' | 'site' | 'records'>> = {},
): ReportDraft {
  return {
    ...draft,
    ...overrides,
    records: overrides.records ?? draft.records,
  };
}

export function createReportSnapshot(draft: ReportDraft): ReportDraft {
  const records = draft.records.map(record => Object.freeze({ ...record }));
  Object.freeze(records);
  return Object.freeze({ ...draft, records }) as ReportDraft;
}

export function createInitialWorkflowModel(
  selection: WorkflowSelection,
): WorkflowModel {
  return {
    revision: 0,
    selection: { ...selection },
    state: { status: 'idle' },
    recoverableDraft: null,
    announcement: null,
  };
}

export function canGenerateReport(model: WorkflowModel): boolean {
  if (model.state.status !== 'ready') return false;
  const draft = model.state.draft;
  if (draft.revision !== model.revision) return false;
  if (draft.cableType !== model.selection.cableType) return false;
  if (draft.site !== model.selection.site || draft.records.length === 0) return false;
  return ReportDraftSchema.safeParse(draft).success;
}

function toReadyModel(
  model: WorkflowModel,
  draft: ReportDraft,
  announcement: string | null,
): WorkflowModel {
  return {
    ...model,
    state: { status: 'ready', draft },
    recoverableDraft: draft,
    announcement,
  };
}

function applySiteChange(
  model: WorkflowModel,
  source: ReportDraft | null,
  value: string,
): WorkflowModel {
  if (model.selection.site === value && (source === null || source.site === value)) {
    return model;
  }

  const revision = model.revision + 1;
  const selection = { ...model.selection, site: value };
  if (source === null) {
    return {
      ...model,
      revision,
      selection,
      state: { status: 'idle' },
      recoverableDraft: null,
      announcement: null,
    };
  }

  const draft = withDraftChanges(source, { revision, site: value });
  return {
    ...toReadyModel(model, draft, null),
    revision,
    selection,
  };
}

function applyStartingDateTimeChange(
  model: WorkflowModel,
  source: ReportDraft | null,
  change: Extract<DraftChange, { kind: 'starting-date-time' }>,
): WorkflowModel {
  if (source === null) {
    if (model.selection.startingDateTime === change.value) return model;
    return {
      ...model,
      revision: model.revision + 1,
      selection: { ...model.selection, startingDateTime: change.value },
      state: { status: 'idle' },
      recoverableDraft: null,
      announcement: null,
    };
  }

  let recordsChanged = false;
  const records = source.records.map((record, index) => {
    const dateTime = change.dateTimes[index];
    if (dateTime === undefined || dateTime === record.dateTime) return record;
    recordsChanged = true;
    return { ...record, dateTime };
  });
  const selectionChanged = model.selection.startingDateTime !== change.value;
  if (!selectionChanged && !recordsChanged) return model;

  const revision = model.revision + 1;
  const draft = withDraftChanges(source, { revision, records });
  return {
    ...toReadyModel(model, draft, null),
    revision,
    selection: { ...model.selection, startingDateTime: change.value },
  };
}

function applyCableLabelChanges(
  model: WorkflowModel,
  source: ReportDraft | null,
  values: ReadonlyMap<string, string>,
): WorkflowModel {
  if (source === null || values.size === 0) return model;

  let changed = false;
  const records = source.records.map(record => {
    if (!values.has(record.id)) return record;
    const cableLabel = values.get(record.id);
    if (cableLabel === undefined) return record;
    const cableNumber = cableLabel.replace(/^#/, '');
    if (record.cableLabel === cableLabel && record.cableNumber === cableNumber) {
      return record;
    }
    changed = true;
    return { ...record, cableLabel, cableNumber };
  });
  if (!changed) return model;

  const revision = model.revision + 1;
  const draft = withDraftChanges(source, { revision, records });
  return {
    ...toReadyModel(model, draft, null),
    revision,
  };
}

function applyDelete(
  model: WorkflowModel,
  source: ReportDraft | null,
  id: string,
): WorkflowModel {
  if (source === null || !source.records.some(record => record.id === id)) {
    return model;
  }

  const revision = model.revision + 1;
  const records = source.records.filter(record => record.id !== id);
  const draft = withDraftChanges(source, { revision, records });
  return {
    ...toReadyModel(model, draft, null),
    revision,
  };
}

function applyDraftChange(
  model: WorkflowModel,
  change: DraftChange,
): WorkflowModel {
  const source = currentEditableDraft(model);
  switch (change.kind) {
    case 'site':
      return applySiteChange(model, source, change.value);
    case 'starting-date-time':
      return applyStartingDateTimeChange(model, source, change);
    case 'cable-labels':
      return applyCableLabelChanges(model, source, change.values);
    case 'delete':
      return applyDelete(model, source, change.id);
  }
}

function isCurrentImport(
  model: WorkflowModel,
  action: { requestId: string; revision: number },
): boolean {
  return model.state.status === 'importing'
    && model.state.requestId === action.requestId
    && model.state.revision === action.revision
    && model.revision === action.revision;
}

function isCurrentGeneration(
  model: WorkflowModel,
  action: { jobId: string; revision: number },
): model is WorkflowModel & {
  state: Extract<WorkflowModel['state'], { status: 'generating' }>;
} {
  return model.state.status === 'generating'
    && model.state.jobId === action.jobId
    && model.state.snapshot.revision === action.revision
    && model.revision === action.revision;
}

function isCurrentSave(
  model: WorkflowModel,
  action: { saveId: string; revision: number },
): model is WorkflowModel & {
  state: Extract<WorkflowModel['state'], { status: 'saving' }>;
} {
  return model.state.status === 'saving'
    && model.state.saveId === action.saveId
    && model.state.snapshot.revision === action.revision
    && model.revision === action.revision;
}

function handleSelectionChange(
  model: WorkflowModel,
  patch: Extract<WorkflowAction, { type: 'selection/changed' }>['patch'],
): WorkflowModel {
  const file = hasOwn(patch, 'file') && patch.file !== undefined
    ? patch.file
    : model.selection.file;
  const cableType = hasOwn(patch, 'cableType') && patch.cableType !== undefined
    ? patch.cableType
    : model.selection.cableType;
  if (Object.is(file, model.selection.file) && cableType === model.selection.cableType) {
    return model;
  }

  return {
    revision: model.revision + 1,
    selection: { ...model.selection, file, cableType },
    state: { status: 'idle' },
    recoverableDraft: null,
    announcement: null,
  };
}

function handleImportStarted(
  model: WorkflowModel,
  action: Extract<WorkflowAction, { type: 'import/started' }>,
): WorkflowModel {
  if (action.revision !== model.revision || action.requestId.length === 0) {
    return model;
  }
  if (model.selection.file === null) return model;
  if (model.state.status === 'generating' || model.state.status === 'saving') {
    return model;
  }
  const recoverableDraft = model.state.status === 'ready'
    ? model.state.draft
    : model.recoverableDraft;
  return {
    ...model,
    state: {
      status: 'importing',
      requestId: action.requestId,
      revision: action.revision,
    },
    recoverableDraft,
    announcement: null,
  };
}

function handleImportSucceeded(
  model: WorkflowModel,
  action: Extract<WorkflowAction, { type: 'import/succeeded' }>,
): WorkflowModel {
  if (!isCurrentImport(model, action)) return model;
  const draft = withDraftChanges(action.draft, {
    revision: model.revision,
    site: model.selection.site,
    records: action.draft.records.map(record => ({ ...record })),
  });
  draft.cableType = model.selection.cableType;
  return toReadyModel(
    model,
    draft,
    `已导入 ${draft.records.length} 条记录。`,
  );
}

function handleGenerateStarted(
  model: WorkflowModel,
  action: Extract<WorkflowAction, { type: 'generate/started' }>,
): WorkflowModel {
  if (action.jobId.length === 0 || action.revision !== model.revision) return model;
  const source = generationStartDraft(model);
  if (source === null || source.records.length === 0) return model;
  if (source.revision !== model.revision || action.snapshot.revision !== model.revision) {
    return model;
  }
  if (!ReportDraftSchema.safeParse(source).success) return model;
  if (action.snapshot.cableType !== model.selection.cableType) return model;
  if (action.snapshot.site !== model.selection.site) return model;
  if (!ReportDraftSchema.safeParse(action.snapshot).success) return model;

  const snapshot = createReportSnapshot(source);
  return {
    ...model,
    state: { status: 'generating', snapshot, jobId: action.jobId },
    recoverableDraft: snapshot,
    announcement: null,
  };
}

function handleSaveStarted(
  model: WorkflowModel,
  action: Extract<WorkflowAction, { type: 'save/started' }>,
): WorkflowModel {
  if (action.revision !== model.revision
      || action.generationId.length === 0
      || action.saveId.length === 0
      || action.suggestedName.length === 0) {
    return model;
  }
  if (model.state.status !== 'error'
      || model.state.phase !== 'save'
      || !model.state.retryable) return model;
  const draft = model.recoverableDraft;
  if (draft === null || draft.revision !== action.revision) return model;
  if (draft.records.length === 0 || !ReportDraftSchema.safeParse(draft).success) {
    return model;
  }

  const snapshot = createReportSnapshot(draft);
  return {
    ...model,
    state: {
      status: 'saving',
      snapshot,
      generationId: action.generationId,
      saveId: action.saveId,
      suggestedName: action.suggestedName,
    },
    recoverableDraft: snapshot,
    announcement: null,
  };
}

export function workflowReducer(
  model: WorkflowModel,
  action: WorkflowAction,
): WorkflowModel {
  switch (action.type) {
    case 'selection/changed':
      return handleSelectionChange(model, action.patch);
    case 'draft/changed':
      return applyDraftChange(model, action.change);
    case 'error/dismissed':
      if (model.state.status !== 'error') return model;
      if (model.recoverableDraft !== null
          && model.recoverableDraft.revision === model.revision) {
        return toReadyModel(
          model,
          model.recoverableDraft,
          '已恢复上次报告。',
        );
      }
      return {
        ...model,
        state: { status: 'idle' },
        recoverableDraft: null,
        announcement: null,
      };
    case 'import/started':
      return handleImportStarted(model, action);
    case 'import/succeeded':
      return handleImportSucceeded(model, action);
    case 'import/failed':
      if (!isCurrentImport(model, action)) return model;
      return {
        ...model,
        state: {
          status: 'error',
          phase: 'import',
          message: action.message,
          retryable: action.retryable,
        },
        recoverableDraft: model.recoverableDraft,
        announcement: null,
      };
    case 'generate/started':
      return handleGenerateStarted(model, action);
    case 'generate/succeeded':
      if (!isCurrentGeneration(model, action)) return model;
      {
        const suggestedName = basename(action.suggestedName);
        if (action.saveId.trim().length === 0 || suggestedName.length === 0) {
          return {
            ...model,
            state: {
              status: 'error',
              phase: 'generate',
              message: '生成结果无效，请重试。',
              retryable: true,
            },
            recoverableDraft: model.state.snapshot,
            announcement: null,
          };
        }
        return {
          ...model,
          state: {
            status: 'saving',
            snapshot: model.state.snapshot,
            generationId: action.jobId,
            saveId: action.saveId,
            suggestedName,
          },
          recoverableDraft: model.state.snapshot,
          announcement: null,
        };
      }
    case 'operation/failed':
      if (action.phase === 'generate') {
        if (!isCurrentGeneration(model, action)) return model;
        return {
          ...model,
          state: {
            status: 'error',
            phase: 'generate',
            message: action.message,
            retryable: action.retryable,
          },
          recoverableDraft: model.state.snapshot,
          announcement: null,
        };
      }
      if (!isCurrentSave(model, action)) return model;
      return {
        ...model,
        state: {
          status: 'error',
          phase: 'save',
          message: action.message,
          retryable: action.retryable,
        },
        recoverableDraft: model.state.snapshot,
        announcement: null,
      };
    case 'operation/cancelled':
      if (action.phase === 'import') {
        if (!isCurrentImport(model, action)) return model;
        if (model.recoverableDraft !== null) {
          return toReadyModel(model, model.recoverableDraft, '已取消导入。');
        }
        return {
          ...model,
          state: { status: 'idle' },
          recoverableDraft: null,
          announcement: '已取消导入。',
        };
      }
      if (!isCurrentGeneration(model, action)) return model;
      return toReadyModel(model, model.state.snapshot, '已取消生成。');
    case 'save/started':
      return handleSaveStarted(model, action);
    case 'save/cancelled':
      if (!isCurrentSave(model, action)) return model;
      return toReadyModel(model, model.state.snapshot, '已取消保存。');
    case 'save/succeeded':
      if (!isCurrentSave(model, action)) return model;
      {
        const fileName = basename(action.fileName);
        if (fileName.length === 0) {
          return {
            ...model,
            state: {
              status: 'error',
              phase: 'save',
              message: '保存结果无效，请重试。',
              retryable: true,
            },
            recoverableDraft: model.state.snapshot,
            announcement: null,
          };
        }
        return toReadyModel(model, model.state.snapshot, `已保存 ${fileName}。`);
      }
  }
}
