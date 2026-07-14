'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { DesktopUpdateApi, DesktopUpdateState } from './model';

function browserState(currentVersion: string): DesktopUpdateState {
  return {
    phase: 'unsupported',
    currentVersion,
    message: '应用内更新仅支持已安装的桌面版。',
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
    ? api as DesktopUpdateApi
    : null;
}

function buttonLabel(state: DesktopUpdateState): string {
  switch (state.phase) {
    case 'checking':
      return '正在检测…';
    case 'up-to-date':
      return '再次检测';
    case 'available':
      return state.version ? `下载 ${state.version}` : '下载更新';
    case 'downloading':
      return `下载中 ${Math.round(state.percent ?? 0)}%`;
    case 'downloaded':
      return '重启并安装';
    case 'installing':
      return '正在安装…';
    case 'error':
      return '重试检测';
    case 'idle':
    case 'unsupported':
      return '检测更新';
  }
}

export function UpdateControls({ currentVersion }: { currentVersion: string }) {
  const [state, setState] = useState<DesktopUpdateState>(() => browserState(currentVersion));

  useEffect(() => {
    const api = desktopUpdateApi();
    if (!api) {
      return;
    }

    let active = true;
    const unsubscribe = api.onUpdateState(nextState => {
      if (active) setState(nextState);
    });
    void api.getUpdateState()
      .then(nextState => {
        if (active) setState(nextState);
      })
      .catch(error => {
        if (!active) return;
        setState({
          phase: 'error',
          currentVersion,
          message: error instanceof Error ? error.message : '读取更新状态失败。',
        });
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentVersion]);

  const busy = state.phase === 'checking'
    || state.phase === 'downloading'
    || state.phase === 'installing';
  const disabled = state.phase === 'unsupported' || busy;

  async function handleAction() {
    const api = desktopUpdateApi();
    if (!api || disabled) return;
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

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span>版本 {currentVersion}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => void handleAction()}
      >
        {buttonLabel(state)}
      </Button>
      <span aria-live="polite" aria-atomic="true" className="basis-full text-center">
        {state.message ?? ''}
      </span>
    </div>
  );
}
