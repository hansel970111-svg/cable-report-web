'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { CableType, ReportDraft } from '@/domain/report/model';
import {
  defaultRecordIdFactory,
  mapImportedRows,
  type RecordIdFactory,
} from '@/domain/report/record-mapper';
import {
  mathRandomSource,
  type RandomSource,
} from '@/domain/report/random-source';
import { generateWorkingTimes } from '@/domain/report/time-sequence';
import type { WorkflowAction, WorkflowModel, WorkflowSelection } from './model';
import {
  canGenerateReport,
  createInitialWorkflowModel,
  workflowReducer,
} from './reducer';
import type { ReportWorkflowServices } from './services';
import type { GeneratedReport } from './save-contract';

type OperationKind = 'import' | 'generate' | 'save';

export type UseReportWorkflowOptions = {
  services: ReportWorkflowServices;
  initialSelection?: Partial<WorkflowSelection>;
  random?: RandomSource;
  idFactory?: RecordIdFactory;
  createOperationId?: (kind: OperationKind) => string;
};

export type ReportWorkflow = {
  model: WorkflowModel;
  state: WorkflowModel['state'];
  selection: WorkflowSelection;
  canGenerate: boolean;
  selectFile(file: File | null): void;
  selectCableType(cableType: CableType): void;
  changeSite(site: string): void;
  changeStartingDateTime(value: string): void;
  applyCableLabels(values: ReadonlyMap<string, string>): void;
  deleteRecord(id: string): void;
  importSelected(): Promise<void>;
  generateAndSave(): Promise<void>;
  retry(): Promise<void>;
  cancel(): void;
};

type ImportOperation = {
  requestId: string;
  revision: number;
  controller: AbortController;
};

type GenerateOperation = {
  generationId: string;
  revision: number;
  controller: AbortController;
};

type SaveOperation = {
  saveId: string;
  generationId: string;
  revision: number;
};

type GeneratedPdfCache = {
  generationId: string;
  revision: number;
  bytes: ArrayBuffer;
  suggestedName: string;
};

type PublicFailure = {
  message: string;
  retryable: boolean;
};

function defaultStartingDateTime(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${now.getFullYear()} 09:00:00 AM`;
}

function initialSelection(
  override: Partial<WorkflowSelection> | undefined,
): WorkflowSelection {
  return {
    file: override?.file ?? null,
    cableType: override?.cableType ?? 'Cat 5e',
    site: override?.site ?? '',
    startingDateTime: override?.startingDateTime ?? defaultStartingDateTime(),
  };
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

function publicFailure(
  error: unknown,
  fallback: string,
  defaultRetryable = true,
): PublicFailure {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; retryable?: unknown };
    if (typeof candidate.message === 'string'
        && candidate.message.trim().length > 0
        && typeof candidate.retryable === 'boolean') {
      return {
        message: candidate.message,
        retryable: candidate.retryable,
      };
    }
  }
  return { message: fallback, retryable: defaultRetryable };
}

function basename(value: string): string {
  return value.trim().split(/[\\/]/).at(-1)?.trim() ?? '';
}

function editableDraft(model: WorkflowModel): ReportDraft | null {
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

function isOwnedImport(
  mounted: boolean,
  current: ImportOperation | null,
  operation: ImportOperation,
): boolean {
  return mounted && current === operation;
}

function isOwnedGeneration(
  mounted: boolean,
  current: GenerateOperation | null,
  operation: GenerateOperation,
): boolean {
  return mounted && current === operation;
}

function isOwnedSave(
  mounted: boolean,
  current: SaveOperation | null,
  operation: SaveOperation,
): boolean {
  return mounted && current === operation;
}

export function useReportWorkflow(
  options: UseReportWorkflowOptions,
): ReportWorkflow {
  const [model, setModel] = useState<WorkflowModel>(
    () => createInitialWorkflowModel(initialSelection(options.initialSelection)),
  );
  const modelRef = useRef(model);
  modelRef.current = model;

  const mountedRef = useRef(true);
  const servicesRef = useRef(options.services);
  const randomRef = useRef(options.random ?? mathRandomSource);
  const idFactoryRef = useRef(options.idFactory ?? defaultRecordIdFactory);
  const createOperationIdRef = useRef(options.createOperationId);
  const operationSequenceRef = useRef(0);
  servicesRef.current = options.services;
  randomRef.current = options.random ?? mathRandomSource;
  idFactoryRef.current = options.idFactory ?? defaultRecordIdFactory;
  createOperationIdRef.current = options.createOperationId;

  const importOperationRef = useRef<ImportOperation | null>(null);
  const generateOperationRef = useRef<GenerateOperation | null>(null);
  const saveOperationRef = useRef<SaveOperation | null>(null);
  const generatedPdfRef = useRef<GeneratedPdfCache | null>(null);

  const dispatch = useCallback((action: WorkflowAction): WorkflowModel => {
    const current = modelRef.current;
    const next = workflowReducer(current, action);
    if (next === current) return current;
    modelRef.current = next;
    setModel(next);
    return next;
  }, []);

  const nextOperationId = useCallback((kind: OperationKind): string => {
    const injected = createOperationIdRef.current;
    if (injected) return injected(kind);
    operationSequenceRef.current += 1;
    const randomPart = globalThis.crypto?.randomUUID?.()
      ?? Math.random().toString(36).slice(2);
    return `${kind}-${operationSequenceRef.current}-${randomPart}`;
  }, []);

  const invalidateForMutation = useCallback(() => {
    const importOperation = importOperationRef.current;
    importOperationRef.current = null;
    importOperation?.controller.abort();

    const generateOperation = generateOperationRef.current;
    generateOperationRef.current = null;
    generateOperation?.controller.abort();

    saveOperationRef.current = null;
    generatedPdfRef.current = null;
  }, []);

  const startSave = useCallback(async (
    cache: GeneratedPdfCache,
    source: 'generation' | 'retry',
  ): Promise<void> => {
    if (!mountedRef.current || saveOperationRef.current !== null) return;
    if (cache.revision !== modelRef.current.revision) return;

    const saveId = nextOperationId('save');
    const operation: SaveOperation = {
      saveId,
      generationId: cache.generationId,
      revision: cache.revision,
    };
    saveOperationRef.current = operation;

    const next = source === 'generation'
      ? dispatch({
          type: 'generate/succeeded',
          jobId: cache.generationId,
          revision: cache.revision,
          saveId,
          suggestedName: cache.suggestedName,
        })
      : dispatch({
          type: 'save/started',
          generationId: cache.generationId,
          saveId,
          revision: cache.revision,
          suggestedName: cache.suggestedName,
        });

    if (next.state.status !== 'saving'
        || next.state.saveId !== saveId
        || next.state.generationId !== cache.generationId) {
      if (saveOperationRef.current === operation) saveOperationRef.current = null;
      return;
    }

    const services = servicesRef.current;
    try {
      const result = await services.savePdf({
        bytes: cache.bytes,
        suggestedName: cache.suggestedName,
      });
      if (!isOwnedSave(
        mountedRef.current,
        saveOperationRef.current,
        operation,
      )) return;

      if (result.status === 'saved') {
        const fileName = basename(result.fileName);
        if (fileName.length === 0) {
          dispatch({
            type: 'operation/failed',
            phase: 'save',
            saveId,
            revision: cache.revision,
            message: '保存结果无效，请重试。',
            retryable: true,
          });
          return;
        }
        generatedPdfRef.current = null;
        dispatch({
          type: 'save/succeeded',
          saveId,
          revision: cache.revision,
          fileName,
        });
        return;
      }
      if (result.status === 'cancelled') {
        generatedPdfRef.current = null;
        dispatch({
          type: 'save/cancelled',
          saveId,
          revision: cache.revision,
        });
        return;
      }

      if (!result.retryable) generatedPdfRef.current = null;
      dispatch({
        type: 'operation/failed',
        phase: 'save',
        saveId,
        revision: cache.revision,
        message: result.message.trim() || '保存失败，请重试。',
        retryable: result.retryable,
      });
    } catch (error) {
      if (!isOwnedSave(
        mountedRef.current,
        saveOperationRef.current,
        operation,
      )) return;
      const failure = publicFailure(error, '保存失败，请重试。');
      if (!failure.retryable) generatedPdfRef.current = null;
      dispatch({
        type: 'operation/failed',
        phase: 'save',
        saveId,
        revision: cache.revision,
        message: failure.message,
        retryable: failure.retryable,
      });
    } finally {
      if (saveOperationRef.current === operation) saveOperationRef.current = null;
    }
  }, [dispatch, nextOperationId]);

  const startImport = useCallback(async (): Promise<void> => {
    if (!mountedRef.current || importOperationRef.current !== null) return;
    const current = modelRef.current;
    const selection = current.selection;
    if (selection.file === null) return;

    const requestId = nextOperationId('import');
    const operation: ImportOperation = {
      requestId,
      revision: current.revision,
      controller: new AbortController(),
    };
    importOperationRef.current = operation;
    const next = dispatch({
      type: 'import/started',
      requestId,
      revision: operation.revision,
    });
    if (next.state.status !== 'importing'
        || next.state.requestId !== requestId) {
      importOperationRef.current = null;
      operation.controller.abort();
      return;
    }
    generatedPdfRef.current = null;

    const services = servicesRef.current;
    const random = randomRef.current;
    const idFactory = idFactoryRef.current;
    try {
      const result = await services.importExcel(
        selection.file,
        selection.cableType,
        operation.controller.signal,
      );
      if (!isOwnedImport(
        mountedRef.current,
        importOperationRef.current,
        operation,
      )) return;

      const records = mapImportedRows(result.rows, {
        cableType: selection.cableType,
        startingDateTime: selection.startingDateTime,
        random,
        idFactory,
      });
      if (!isOwnedImport(
        mountedRef.current,
        importOperationRef.current,
        operation,
      )) return;

      dispatch({
        type: 'import/succeeded',
        requestId,
        revision: operation.revision,
        draft: {
          revision: operation.revision,
          cableType: selection.cableType,
          site: selection.site,
          records,
        },
      });
    } catch (error) {
      if (!isOwnedImport(
        mountedRef.current,
        importOperationRef.current,
        operation,
      )) return;
      if (isAbortError(error)) {
        dispatch({
          type: 'operation/cancelled',
          phase: 'import',
          requestId,
          revision: operation.revision,
        });
        return;
      }
      const failure = publicFailure(error, 'Excel 导入失败，请重试。');
      dispatch({
        type: 'import/failed',
        requestId,
        revision: operation.revision,
        message: failure.message,
        retryable: failure.retryable,
      });
    } finally {
      if (importOperationRef.current === operation) importOperationRef.current = null;
    }
  }, [dispatch, nextOperationId]);

  const startGeneration = useCallback(async (
    draft: ReportDraft,
  ): Promise<void> => {
    if (!mountedRef.current
        || generateOperationRef.current !== null
        || saveOperationRef.current !== null) return;
    if (draft.revision !== modelRef.current.revision) return;

    const generationId = nextOperationId('generate');
    const operation: GenerateOperation = {
      generationId,
      revision: draft.revision,
      controller: new AbortController(),
    };
    generateOperationRef.current = operation;
    const next = dispatch({
      type: 'generate/started',
      jobId: generationId,
      revision: operation.revision,
      snapshot: draft,
    });
    if (next.state.status !== 'generating'
        || next.state.jobId !== generationId) {
      generateOperationRef.current = null;
      operation.controller.abort();
      return;
    }
    const snapshot = next.state.snapshot;
    const services = servicesRef.current;
    let report: GeneratedReport;
    try {
      report = await services.generateReport(
        snapshot,
        operation.controller.signal,
      );
      if (!isOwnedGeneration(
        mountedRef.current,
        generateOperationRef.current,
        operation,
      )) return;
      const suggestedName = basename(report.suggestedName);
      if (!(report.bytes instanceof ArrayBuffer)
          || report.bytes.byteLength === 0
          || suggestedName.length === 0) {
        generatedPdfRef.current = null;
        dispatch({
          type: 'operation/failed',
          phase: 'generate',
          jobId: generationId,
          revision: operation.revision,
          message: '生成结果无效，请重试。',
          retryable: true,
        });
        return;
      }
      report = { ...report, suggestedName };
    } catch (error) {
      if (!isOwnedGeneration(
        mountedRef.current,
        generateOperationRef.current,
        operation,
      )) return;
      generatedPdfRef.current = null;
      if (isAbortError(error)) {
        dispatch({
          type: 'operation/cancelled',
          phase: 'generate',
          jobId: generationId,
          revision: operation.revision,
        });
        return;
      }
      const failure = publicFailure(error, '报告生成失败，请重试。');
      dispatch({
        type: 'operation/failed',
        phase: 'generate',
        jobId: generationId,
        revision: operation.revision,
        message: failure.message,
        retryable: failure.retryable,
      });
      return;
    } finally {
      if (generateOperationRef.current === operation) {
        generateOperationRef.current = null;
      }
    }

    if (!mountedRef.current || modelRef.current.state.status !== 'generating') return;
    if (modelRef.current.state.jobId !== generationId
        || modelRef.current.revision !== operation.revision) return;

    const cache: GeneratedPdfCache = {
      generationId,
      revision: operation.revision,
      bytes: report.bytes,
      suggestedName: report.suggestedName,
    };
    generatedPdfRef.current = cache;
    await startSave(cache, 'generation');
  }, [dispatch, nextOperationId, startSave]);

  const selectFile = useCallback((file: File | null) => {
    if (Object.is(modelRef.current.selection.file, file)) return;
    invalidateForMutation();
    dispatch({ type: 'selection/changed', patch: { file } });
  }, [dispatch, invalidateForMutation]);

  const selectCableType = useCallback((cableType: CableType) => {
    if (modelRef.current.selection.cableType === cableType) return;
    invalidateForMutation();
    dispatch({ type: 'selection/changed', patch: { cableType } });
  }, [dispatch, invalidateForMutation]);

  const changeSite = useCallback((site: string) => {
    if (modelRef.current.selection.site === site) return;
    invalidateForMutation();
    dispatch({ type: 'draft/changed', change: { kind: 'site', value: site } });
  }, [dispatch, invalidateForMutation]);

  const changeStartingDateTime = useCallback((value: string) => {
    const current = modelRef.current;
    if (current.selection.startingDateTime === value) return;
    const source = editableDraft(current);
    let dateTimes: readonly string[] = [];
    if (source !== null) {
      const generated = generateWorkingTimes(
        value,
        source.records.length,
        randomRef.current,
      );
      dateTimes = generated.length === source.records.length
        ? generated
        : source.records.map(() => value);
    }
    invalidateForMutation();
    dispatch({
      type: 'draft/changed',
      change: { kind: 'starting-date-time', value, dateTimes },
    });
  }, [dispatch, invalidateForMutation]);

  const applyCableLabels = useCallback((values: ReadonlyMap<string, string>) => {
    const source = editableDraft(modelRef.current);
    if (source === null || values.size === 0) return;
    const changes = source.records.some(record => {
      const value = values.get(record.id);
      return value !== undefined
        && (record.cableLabel !== value
          || record.cableNumber !== value.replace(/^#/, ''));
    });
    if (!changes) return;
    const snapshot = new Map(values);
    invalidateForMutation();
    dispatch({
      type: 'draft/changed',
      change: { kind: 'cable-labels', values: snapshot },
    });
  }, [dispatch, invalidateForMutation]);

  const deleteRecord = useCallback((id: string) => {
    const source = editableDraft(modelRef.current);
    if (source === null || !source.records.some(record => record.id === id)) return;
    invalidateForMutation();
    dispatch({ type: 'draft/changed', change: { kind: 'delete', id } });
  }, [dispatch, invalidateForMutation]);

  const generateAndSave = useCallback(async (): Promise<void> => {
    const current = modelRef.current;
    if (!canGenerateReport(current) || current.state.status !== 'ready') return;
    await startGeneration(current.state.draft);
  }, [startGeneration]);

  const retry = useCallback(async (): Promise<void> => {
    const current = modelRef.current;
    if (current.state.status !== 'error' || !current.state.retryable) return;

    if (current.state.phase === 'import') {
      await startImport();
      return;
    }
    if (current.state.phase === 'generate') {
      if (current.recoverableDraft !== null) {
        await startGeneration(current.recoverableDraft);
      }
      return;
    }

    const cache = generatedPdfRef.current;
    if (cache === null || cache.revision !== current.revision) return;
    await startSave(cache, 'retry');
  }, [startGeneration, startImport, startSave]);

  const cancel = useCallback(() => {
    const importOperation = importOperationRef.current;
    if (importOperation !== null) {
      importOperationRef.current = null;
      importOperation.controller.abort();
      generatedPdfRef.current = null;
      dispatch({
        type: 'operation/cancelled',
        phase: 'import',
        requestId: importOperation.requestId,
        revision: importOperation.revision,
      });
      return;
    }

    const generateOperation = generateOperationRef.current;
    if (generateOperation !== null) {
      generateOperationRef.current = null;
      generateOperation.controller.abort();
      generatedPdfRef.current = null;
      dispatch({
        type: 'operation/cancelled',
        phase: 'generate',
        jobId: generateOperation.generationId,
        revision: generateOperation.revision,
      });
      return;
    }

    if (modelRef.current.state.status === 'error') {
      generatedPdfRef.current = null;
      dispatch({ type: 'error/dismissed' });
    }
  }, [dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const importOperation = importOperationRef.current;
      importOperationRef.current = null;
      importOperation?.controller.abort();
      const generateOperation = generateOperationRef.current;
      generateOperationRef.current = null;
      generateOperation?.controller.abort();
      saveOperationRef.current = null;
      generatedPdfRef.current = null;
    };
  }, []);

  const canGenerate = useMemo(() => canGenerateReport(model), [model]);

  return {
    model,
    state: model.state,
    selection: model.selection,
    canGenerate,
    selectFile,
    selectCableType,
    changeSite,
    changeStartingDateTime,
    applyCableLabels,
    deleteRecord,
    importSelected: startImport,
    generateAndSave,
    retry,
    cancel,
  };
}
