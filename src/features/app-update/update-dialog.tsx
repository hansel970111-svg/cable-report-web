'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import type { DesktopUpdateApi, DesktopUpdateState } from './model';

const DEFERRED_UPDATE_VERSIONS_KEY = 'cable-report:deferred-update-versions';

function readDeferredVersions(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(DEFERRED_UPDATE_VERSIONS_KEY) ?? '[]',
    );
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter(item => (
      typeof item === 'string' && item.length > 0 && item.length <= 64
    )));
  } catch {
    return new Set();
  }
}

function deferVersionForSession(versions: Set<string>, version: string): void {
  versions.add(version);
  try {
    window.sessionStorage.setItem(
      DEFERRED_UPDATE_VERSIONS_KEY,
      JSON.stringify([...versions].slice(-32)),
    );
  } catch {
    // The in-memory set still prevents repeated prompts in this renderer.
  }
}

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
    && typeof api.updateNow === 'function'
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
      return '立即更新';
    case 'downloading':
      return `下载中 ${Math.round(state.percent ?? 0)}%`;
    case 'downloaded':
      return '立即更新';
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

function isUpdateOffer(state: DesktopUpdateState): boolean {
  return (
    state.phase === 'available'
    || state.phase === 'downloading'
    || state.phase === 'downloaded'
    || state.phase === 'installing'
    || state.phase === 'error'
  ) && Boolean(state.version && state.version !== state.currentVersion);
}

function shouldAutoOpenUpdate(
  state: DesktopUpdateState,
  deferredVersions: ReadonlySet<string>,
): boolean {
  return (state.phase === 'available' || state.phase === 'downloaded')
    && isUpdateOffer(state)
    && !deferredVersions.has(state.version ?? '');
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
      return '更新已下载，可以立即完成安装并重启应用。';
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
  const deferredVersionsRef = useRef(new Set<string>());
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
    deferredVersionsRef.current = readDeferredVersions();

    let active = true;
    let receivedLiveState = false;
    const setActiveState = (nextState: DesktopUpdateState) => {
      if (!active) return;
      setState(nextState);
      if (shouldAutoOpenUpdate(nextState, deferredVersionsRef.current)) {
        setOpen(true);
      }
    };
    const reportError = (error: unknown) => {
      setActiveState({
        phase: 'error',
        currentVersion,
        message: error instanceof Error ? error.message : '更新操作失败，请稍后重试。',
      });
    };
    const unsubscribeState = api.onUpdateState(nextState => {
      receivedLiveState = true;
      setActiveState(nextState);
    });
    const unsubscribeOpen = api.onOpenUpdateDialog(() => {
      if (!active) return;
      receivedLiveState = true;
      setOpen(true);
      setState({ phase: 'checking', currentVersion });
      void api.checkForUpdates().then(setActiveState).catch(reportError);
    });
    void api.getUpdateState().then(nextState => {
      if (!receivedLiveState) setActiveState(nextState);
    }).catch(error => {
      if (!receivedLiveState) reportError(error);
    });

    return () => {
      active = false;
      unsubscribeOpen();
      unsubscribeState();
    };
  }, [currentVersion]);

  const updateInProgress = state.phase === 'downloading'
    || state.phase === 'installing';
  const actionBusy = state.phase === 'checking' || updateInProgress;
  const newVersion = isUpdateOffer(state);

  function dismissDialog() {
    if (updateInProgress) return;
    if (newVersion && state.version) {
      deferVersionForSession(deferredVersionsRef.current, state.version);
    }
    setOpen(false);
  }

  async function handleAction() {
    const api = desktopUpdateApi();
    if (!api || actionBusy) return;
    if (state.phase === 'unsupported') {
      setOpen(false);
      return;
    }
    try {
      if (state.phase === 'available' || state.phase === 'downloaded') {
        setState(await api.updateNow());
        return;
      }
      setState(await api.checkForUpdates());
    } catch (error) {
      setState({
        ...state,
        phase: 'error',
        currentVersion,
        message: error instanceof Error ? error.message : '更新操作失败，请稍后重试。',
      });
    }
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    if (updateInProgress) {
      event.preventDefault();
      return;
    }
    dismissDialog();
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
            <h2 id="update-dialog-title">
              {newVersion ? '发现新版本' : '检测更新'}
            </h2>
            <p>
              {newVersion
                ? '查看本次更新内容，并选择合适的更新时间。'
                : '查询并安装 Cable Report Generator 的最新版本。'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭更新窗口"
            disabled={updateInProgress}
            onClick={dismissDialog}
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

          {newVersion && (
            <section
              className="update-dialog-release-notes"
              aria-labelledby="update-release-notes-title"
            >
              <h3 id="update-release-notes-title">本次更新内容</h3>
              {state.releaseName
                && state.releaseName !== state.version
                && state.releaseName !== `v${state.version}` && (
                <p className="update-dialog-release-name">{state.releaseName}</p>
              )}
              {state.releaseNotes && state.releaseNotes.length > 0 ? (
                <ul>
                  {state.releaseNotes.map(note => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p>发布方暂未提供本次更新说明。</p>
              )}
            </section>
          )}

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
            disabled={updateInProgress}
            onClick={dismissDialog}
          >
            {newVersion ? '稍后更新' : '关闭'}
          </Button>
          <Button
            type="button"
            disabled={actionBusy}
            onClick={() => void handleAction()}
          >
            {actionLabel(state)}
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
