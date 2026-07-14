import type { CableType, ReportDraft } from '@/domain/report/model';

export type WorkflowSelection = {
  file: File | null;
  cableType: CableType;
  site: string;
  startingDateTime: string;
};

export type WorkflowState =
  | { status: 'idle' }
  | { status: 'importing'; requestId: string; revision: number }
  | { status: 'ready'; draft: ReportDraft }
  | { status: 'generating'; snapshot: ReportDraft; jobId: string }
  | {
      status: 'saving';
      snapshot: ReportDraft;
      generationId: string;
      saveId: string;
      suggestedName: string;
    }
  | {
      status: 'error';
      phase: 'import' | 'generate' | 'save';
      message: string;
      retryable: boolean;
    };

export type WorkflowModel = {
  revision: number;
  selection: WorkflowSelection;
  state: WorkflowState;
  recoverableDraft: ReportDraft | null;
  announcement: string | null;
};

export type DraftChange =
  | { kind: 'site'; value: string }
  | {
      kind: 'starting-date-time';
      value: string;
      dateTimes: readonly string[];
    }
  | {
      kind: 'cable-labels';
      values: ReadonlyMap<string, string>;
    }
  | { kind: 'delete'; id: string };

export type WorkflowAction =
  | {
      type: 'selection/changed';
      patch: Partial<Pick<WorkflowSelection, 'file' | 'cableType'>>;
    }
  | { type: 'draft/changed'; change: DraftChange }
  | { type: 'error/dismissed' }
  | { type: 'import/started'; requestId: string; revision: number }
  | {
      type: 'import/succeeded';
      requestId: string;
      revision: number;
      draft: ReportDraft;
    }
  | {
      type: 'import/failed';
      requestId: string;
      revision: number;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'generate/started';
      jobId: string;
      revision: number;
      snapshot: ReportDraft;
    }
  | {
      type: 'generate/succeeded';
      jobId: string;
      revision: number;
      saveId: string;
      suggestedName: string;
    }
  | {
      type: 'operation/failed';
      phase: 'generate';
      jobId: string;
      revision: number;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'operation/failed';
      phase: 'save';
      saveId: string;
      revision: number;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'operation/cancelled';
      phase: 'import';
      requestId: string;
      revision: number;
    }
  | {
      type: 'operation/cancelled';
      phase: 'generate';
      jobId: string;
      revision: number;
    }
  | {
      type: 'save/started';
      generationId: string;
      saveId: string;
      revision: number;
      suggestedName: string;
    }
  | {
      type: 'save/cancelled';
      saveId: string;
      revision: number;
    }
  | {
      type: 'save/succeeded';
      saveId: string;
      revision: number;
      fileName: string;
    };
