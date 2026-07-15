'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import type { DesktopUpdateApi, DesktopUpdateState } from './model';

function browserState(currentVersion: string): DesktopUpdateState {
  return {
    phase: 'unsupported',
    currentVersion,
    message: '应用内更新仅支持已安装的 Windows 桌面版。',
  };
}

function desktopUpdateApi(): DesktopUpdateApi | null {
  const api = window.cableReport;
  return api
    && typeof api.getUpdateState === 'function'
    && typeof api.checkForUpdates === 'function'
    && typeof api.downloadUpdate === 'function'
    && typeof api.installUpdate === 'function'
    && typeof api.onUpdateState === 'function'
    && typeof api.onOpenUpdateDialog === 'function'
    ? api as DesktopUpdateApi
    : null;
}

function actionLabel(state: DesktopUpdateState): string {
  switch (state.phase) {
    case 'checking':
      return '正在检测…';
    case 'up-to-date':
      return '重新检测';
    case 'available':
      return '下载更新';
    case 'downloading':
      return `下载中 ${Math.round(state.percent ?? 0)}%`;
    case 'downloaded':
      return '重启并更新';
    case 'installing':
      return '正在安装…';
    case 'error':
      return '重试';
    case 'idle':
      return '检测更新';
    case 'unsupported':
      return '关闭';
  }
}

function statusMessage(state: DesktopUpdateState): string {
  if (state.message) return state.message;
  switch (state.phase) {
    case 'checking':
      return '正在检测新版本…';
    case 'available':
      return '发现可用的新版本。';
    case 'downloading':
      return '正在下载更新…';
    case 'downloaded':
      return '更新已下载，可以重启并完成更新。';
    case 'installing':
      return '正在退出应用、后台更新并重新启动…';
    case 'up-to-date':
      return '当前已是最新版本。';
    case 'error':
      return '更新操作失败，请稍后重试。';
    case 'idle':
      return '点击检测更新以查询最新版本。';
    case 'unsupported':
      return '应用内更新仅支持已安装的 Windows 桌面版。';
  }
}

export function UpdateDialog({ currentVersion }: { currentVersion: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DesktopUpdateState>(() => browserState(currentVersion));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    const api = desktopUpdateApi();
    if (!api) return;

    let active = true;
    const setActiveState = (nextState: DesktopUpdateState) => {
      if (active) setState(nextState);
    };
    const reportError = (error: unknown) => {
      setActiveState({
        phase: 'error',
        currentVersion,
        message: error instanceof Error ? error.message : '更新操作失败，请稍后重试。',
      });
    };
    const unsubscribeState = api.onUpdateState(setActiveState);
    const unsubscribeOpen = api.onOpenUpdateDialog(() => {
      if (!active) return;
      setOpen(true);
      setState({ phase: 'checking', currentVersion });
      void api.checkForUpdates().then(setActiveState).catch(reportError);
    });
    void api.getUpdateState().then(setActiveState).catch(reportError);

    return () => {
      active = false;
      unsubscribeOpen();
      unsubscribeState();
    };
  }, [currentVersion]);

  const busy = state.phase === 'checking'
    || state.phase === 'downloading'
    || state.phase === 'installing';

  async function handleAction() {
    const api = desktopUpdateApi();
    if (!api || busy) return;
    if (state.phase === 'unsupported') {
      setOpen(false);
      return;
    }
    const action = state.phase === 'available'
      ? api.downloadUpdate
      : state.phase === 'downloaded'
        ? api.installUpdate
        : api.checkForUpdates;
    try {
      setState(await action());
    } catch (error) {
      setState({
        phase: 'error',
        currentVersion,
        version: state.version,
        message: error instanceof Error ? error.message : '更新操作失败，请稍后重试。',
      });
    }
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    if (state.phase === 'installing') {
      event.preventDefault();
      return;
    }
    setOpen(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="update-dialog"
      aria-labelledby="update-dialog-title"
      onCancel={handleCancel}
      onClose={() => setOpen(false)}
    >
      <div className="update-dialog-content">
        <header className="update-dialog-header">
          <div>
            <h2 id="update-dialog-title">检测更新</h2>
            <p>查询并安装 Cable Report Generator 的最新版本。</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭更新窗口"
            disabled={state.phase === 'installing'}
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </header>

        <div className="update-dialog-body">
          <dl className="update-dialog-versions">
            <div>
              <dt>当前版本</dt>
              <dd>{state.currentVersion}</dd>
            </div>
            {state.version && state.version !== state.currentVersion && (
              <div>
                <dt>最新版本</dt>
                <dd>{state.version}</dd>
              </div>
            )}
          </dl>

          <p className="update-dialog-status" aria-live="polite" aria-atomic="true">
            {statusMessage(state)}
          </p>

          {state.phase === 'downloading' && (
            <progress
              className="update-dialog-progress"
              aria-label="更新下载进度"
              max={100}
              value={state.percent ?? 0}
            />
          )}
        </div>

        <footer className="update-dialog-actions">
          <Button
            type="button"
            variant="outline"
            disabled={state.phase === 'installing'}
            onClick={() => setOpen(false)}
          >
            稍后
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void handleAction()}
          >
            {actionLabel(state)}
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
