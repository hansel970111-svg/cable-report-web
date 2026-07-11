'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportDraft } from '@/domain/report/model';
import type { WorkflowState } from '@/features/report-workflow/model';
import type { ReportWorkflowServices } from '@/features/report-workflow/services';
import { useReportWorkflow } from '@/features/report-workflow/use-report-workflow';
import { ImportPanel } from './import-panel';
import { createRecordDraftStore } from './record-draft-store';
import { ReportActions } from './report-actions';
import { VirtualRecordTable } from './virtual-record-table';
import { WorkflowAlert } from './workflow-alert';

const NO_RECORDS: ReportDraft['records'] = [];
const BROWSER_MODE_ATTRIBUTE = 'data-dev-browser-mode';

function browserModeSnapshot(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.dataset.devBrowserMode === 'true';
}

function serverBrowserModeSnapshot(): boolean {
  return false;
}

function subscribeToBrowserMode(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [BROWSER_MODE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function visibleDraft(
  state: WorkflowState,
  recoverableDraft: ReportDraft | null,
): ReportDraft | null {
  switch (state.status) {
    case 'ready':
      return state.draft;
    case 'generating':
    case 'saving':
      return state.snapshot;
    case 'error':
      return recoverableDraft;
    case 'idle':
    case 'importing':
      return null;
  }
}

export type ReportEditorProps = {
  services: ReportWorkflowServices;
};

export function ReportEditor({ services }: ReportEditorProps) {
  const workflow = useReportWorkflow({ services });
  const draftStore = useMemo(() => createRecordDraftStore(), []);
  const [editing, setEditing] = useState(false);
  const draft = visibleDraft(workflow.state, workflow.model.recoverableDraft);
  const records = draft?.records ?? NO_RECORDS;
  const operationInProgress = workflow.state.status === 'importing'
    || workflow.state.status === 'generating'
    || workflow.state.status === 'saving';
  const browserDevelopmentMode = useSyncExternalStore(
    subscribeToBrowserMode,
    browserModeSnapshot,
    serverBrowserModeSnapshot,
  );

  useEffect(() => {
    if (!editing) draftStore.reset(records);
  }, [draftStore, editing, records]);

  const leaveEditing = useCallback(() => {
    draftStore.reset(records);
    setEditing(false);
  }, [draftStore, records]);

  const cancelEditingForSelection = useCallback(() => {
    draftStore.clear();
    setEditing(false);
  }, [draftStore]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (editing) {
      event.preventDefault();
      leaveEditing();
      return;
    }
    if (workflow.state.status === 'importing'
        || workflow.state.status === 'generating'
        || workflow.state.status === 'error') {
      event.preventDefault();
      workflow.cancel();
    }
  }, [editing, leaveEditing, workflow]);

  return (
    <div className="report-editor-shell" onKeyDown={handleKeyDown}>
      <header className="report-editor-header">
        <p className="report-editor-eyebrow">无模板预加载 · 直接导入</p>
        <h1>线缆测试报告编辑器</h1>
        <p>导入 Excel、校对记录，然后生成并保存 PDF 报告。</p>
      </header>

      {browserDevelopmentMode && (
        <div role="status" aria-label="运行模式" className="browser-mode-banner">
          浏览器开发模式
        </div>
      )}

      <ImportPanel
        file={workflow.selection.file}
        cableType={workflow.selection.cableType}
        site={workflow.selection.site}
        startingDateTime={workflow.selection.startingDateTime}
        importing={workflow.state.status === 'importing'}
        operationInProgress={operationInProgress}
        onFileChange={file => {
          cancelEditingForSelection();
          workflow.selectFile(file);
        }}
        onCableTypeChange={cableType => {
          cancelEditingForSelection();
          workflow.selectCableType(cableType);
        }}
        onSiteChange={workflow.changeSite}
        onStartingDateTimeChange={workflow.changeStartingDateTime}
        onImport={async () => {
          cancelEditingForSelection();
          await workflow.importSelected();
        }}
        onCancel={workflow.cancel}
      />

      <WorkflowAlert
        state={workflow.state}
        announcement={workflow.model.announcement}
        onRetry={workflow.retry}
        onDismiss={workflow.cancel}
      />

      {draft !== null && (
        <Card className="report-editor-card report-preview-card">
          <CardHeader className="report-preview-header">
            <div>
              <CardTitle>报告预览</CardTitle>
              <p>{records.length} 条线缆记录</p>
            </div>
            <ReportActions
              state={workflow.state}
              recordCount={records.length}
              editing={editing}
              canGenerate={workflow.canGenerate}
              onBeginEditing={() => {
                draftStore.reset(records);
                setEditing(true);
              }}
              onSaveEditing={() => {
                workflow.applyCableLabels(draftStore.snapshot());
                setEditing(false);
              }}
              onCancelEditing={leaveEditing}
              onGenerate={workflow.generateAndSave}
              onCancelOperation={workflow.cancel}
            />
          </CardHeader>
          <CardContent className="report-preview-content">
            {records.length === 0 ? (
              <div role="status" aria-label="预览状态" className="report-empty-state">
                暂无线缆记录
              </div>
            ) : (
              <VirtualRecordTable
                records={records}
                draftStore={draftStore}
                editing={editing}
                onDelete={workflow.deleteRecord}
              />
            )}
          </CardContent>
        </Card>
      )}

      {draft === null && workflow.state.status !== 'importing' && (
        <div className="report-welcome-state">
          选择 Excel 布线表并开始导入。
        </div>
      )}
    </div>
  );
}
