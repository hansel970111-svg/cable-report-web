'use client';

import { Download, Edit2, Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkflowState } from '@/features/report-workflow/model';

export type ReportActionsProps = {
  state: WorkflowState;
  recordCount: number;
  editing: boolean;
  canGenerate: boolean;
  onBeginEditing(): void;
  onSaveEditing(): void;
  onCancelEditing(): void;
  onGenerate(): Promise<void>;
  onCancelOperation(): void;
};

export function ReportActions({
  state,
  recordCount,
  editing,
  canGenerate,
  onBeginEditing,
  onSaveEditing,
  onCancelEditing,
  onGenerate,
  onCancelOperation,
}: ReportActionsProps) {
  const operationInProgress = state.status === 'importing'
    || state.status === 'generating'
    || state.status === 'saving';

  return (
    <div className="report-actions" aria-label="报告操作">
      {editing ? (
        <>
          <Button type="button" onClick={onSaveEditing}>
            <Save aria-hidden="true" />
            保存编辑
          </Button>
          <Button type="button" variant="outline" onClick={onCancelEditing}>
            <X aria-hidden="true" />
            取消编辑
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={recordCount === 0 || operationInProgress}
          onClick={onBeginEditing}
        >
          <Edit2 aria-hidden="true" />
          批量编辑
        </Button>
      )}

      <Button
        type="button"
        disabled={!canGenerate || editing || operationInProgress}
        onClick={() => void onGenerate()}
      >
        <Download aria-hidden="true" />
        生成测试报告
      </Button>

      {state.status === 'generating' && (
        <Button type="button" variant="outline" onClick={onCancelOperation}>
          取消生成
        </Button>
      )}
    </div>
  );
}
