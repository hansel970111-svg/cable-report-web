'use client';

import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkflowState } from '@/features/report-workflow/model';

export type WorkflowAlertProps = {
  state: WorkflowState;
  announcement: string | null;
  onRetry(): Promise<void>;
  onDismiss(): void;
};

export function WorkflowAlert({
  state,
  announcement,
  onRetry,
  onDismiss,
}: WorkflowAlertProps) {
  return (
    <div className="workflow-feedback">
      {state.status === 'error' && (
        <div role="alert" className="workflow-error">
          <AlertCircle aria-hidden="true" />
          <p>{state.message}</p>
          <div className="workflow-error-actions">
            {state.retryable && (
              <Button type="button" size="sm" onClick={() => void onRetry()}>
                重试
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
              关闭
            </Button>
          </div>
        </div>
      )}

      {(state.status === 'generating' || state.status === 'saving') && (
        <div role="status" aria-label="工作流状态" className="workflow-progress">
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          {state.status === 'generating' ? '正在生成报告…' : '正在保存 PDF…'}
        </div>
      )}

      {announcement !== null && (
        <p aria-live="polite" aria-atomic="true" className="workflow-announcement">
          <CheckCircle2 aria-hidden="true" />
          {announcement}
        </p>
      )}
    </div>
  );
}
