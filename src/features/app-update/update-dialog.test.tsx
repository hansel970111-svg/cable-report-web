// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { DesktopUpdateState } from './model';
import { UpdateDialog } from './update-dialog';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.cableReport;
  window.sessionStorage.clear();
});

const currentVersion = '2026.715.1';

function availableState(
  version = '2026.715.2',
  overrides: Partial<DesktopUpdateState> = {},
): DesktopUpdateState {
  return {
    phase: 'available',
    currentVersion,
    version,
    releaseName: `Cable Report Generator ${version}`,
    releaseNotes: ['修复 ODF 线号识别', '提升 PDF 图像清晰度'],
    message: `发现新版本 ${version}`,
    ...overrides,
  };
}

function desktopApi(initial: DesktopUpdateState) {
  let stateListener: ((state: DesktopUpdateState) => void) | undefined;
  let openListener: (() => void) | undefined;
  const checkForUpdates = vi.fn(async () => {
    const next = availableState();
    stateListener?.(next);
    return next;
  });
  const updateNow = vi.fn(async () => {
    const downloading = availableState('2026.715.2', {
      phase: 'downloading',
      percent: 42,
      message: '正在下载更新…',
    });
    stateListener?.(downloading);
    const installing = availableState('2026.715.2', {
      phase: 'installing',
      percent: 100,
      message: '正在退出应用、后台更新并重新启动…',
    });
    stateListener?.(installing);
    return installing;
  });
  const api = {
    getDesktopSessionToken: vi.fn(async () => 'desktop-token'),
    savePdf: vi.fn(),
    getUpdateState: vi.fn(async () => initial),
    checkForUpdates,
    downloadUpdate: vi.fn(async () => initial),
    installUpdate: vi.fn(async () => initial),
    updateNow,
    onUpdateState: vi.fn((callback: (state: DesktopUpdateState) => void) => {
      stateListener = callback;
      return () => {
        stateListener = undefined;
      };
    }),
    onOpenUpdateDialog: vi.fn((callback: () => void) => {
      openListener = callback;
      return () => {
        openListener = undefined;
      };
    }),
  };
  return {
    api,
    emitState: (state: DesktopUpdateState) => stateListener?.(state),
    openDialog: () => openListener?.(),
  };
}

describe('UpdateDialog', () => {
  test('renders no version or update controls at the bottom of browser mode', () => {
    render(<UpdateDialog currentVersion={currentVersion} />);

    expect(screen.queryByRole('dialog', { name: '检测更新' })).not.toBeInTheDocument();
    expect(screen.getByText('当前版本')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: '检测更新' })).not.toBeInTheDocument();
  });

  test('opens from Help, shows release notes, and starts the complete update with one action', async () => {
    const user = userEvent.setup();
    const desktop = desktopApi({ phase: 'idle', currentVersion });
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.onOpenUpdateDialog).toHaveBeenCalledOnce());
    act(() => desktop.openDialog());

    await waitFor(() => expect(desktop.api.checkForUpdates).toHaveBeenCalledOnce());
    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();
    expect(screen.getByText(currentVersion)).toBeVisible();
    expect(screen.getByText('2026.715.2')).toBeVisible();
    expect(screen.getByText('修复 ODF 线号识别')).toBeVisible();
    expect(screen.getByText('提升 PDF 图像清晰度')).toBeVisible();
    expect(screen.getByRole('button', { name: '稍后更新' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '立即更新' }));
    await waitFor(() => expect(desktop.api.updateNow).toHaveBeenCalledOnce());
    expect(desktop.api.downloadUpdate).not.toHaveBeenCalled();
    expect(desktop.api.installUpdate).not.toHaveBeenCalled();
    expect(await screen.findByText('正在退出应用、后台更新并重新启动…')).toBeVisible();
  });

  test('automatically opens only for a new version and defers the same version for this run', async () => {
    const user = userEvent.setup();
    const desktop = desktopApi({ phase: 'idle', currentVersion });
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.onUpdateState).toHaveBeenCalledOnce());
    act(() => desktop.emitState({
      phase: 'up-to-date',
      currentVersion,
      version: currentVersion,
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => desktop.emitState(availableState()));
    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '稍后更新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => desktop.emitState(availableState()));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => desktop.emitState(availableState('2026.715.3')));
    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();
    expect(screen.getByText('2026.715.3')).toBeVisible();
  });

  test('keeps a deferred version quiet after a renderer remount in the same app run', async () => {
    const user = userEvent.setup();
    const firstDesktop = desktopApi({ phase: 'idle', currentVersion });
    window.cableReport = firstDesktop.api;
    const firstRender = render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(firstDesktop.api.onUpdateState).toHaveBeenCalledOnce());
    act(() => firstDesktop.emitState(availableState()));
    await user.click(await screen.findByRole('button', { name: '稍后更新' }));
    firstRender.unmount();

    const secondDesktop = desktopApi(availableState());
    window.cableReport = secondDesktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);
    await waitFor(() => expect(secondDesktop.api.getUpdateState).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('opens from a retained available state when the live event happened before mount', async () => {
    const desktop = desktopApi(availableState());
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();
    expect(screen.getByText('修复 ODF 线号识别')).toBeVisible();
  });

  test('opens from a retained downloaded state and can install immediately', async () => {
    const user = userEvent.setup();
    const desktop = desktopApi(availableState('2026.715.2', {
      phase: 'downloaded',
      percent: 100,
      message: '更新已下载，可以立即完成安装并重启应用。',
    }));
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '立即更新' }));
    await waitFor(() => expect(desktop.api.updateNow).toHaveBeenCalledOnce());
  });

  test('does not let a delayed idle snapshot overwrite a newer live available event', async () => {
    let resolveSnapshot: ((state: DesktopUpdateState) => void) | undefined;
    const desktop = desktopApi({ phase: 'idle', currentVersion });
    desktop.api.getUpdateState = vi.fn(() => new Promise(resolve => {
      resolveSnapshot = resolve;
    }));
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.getUpdateState).toHaveBeenCalledOnce());
    act(() => desktop.emitState(availableState()));
    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();

    await act(async () => {
      resolveSnapshot?.({ phase: 'idle', currentVersion });
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog', { name: '发现新版本' })).toBeVisible();
    expect(screen.getByText('2026.715.2')).toBeVisible();
  });

  test('does not let a delayed snapshot failure overwrite a newer live available event', async () => {
    let rejectSnapshot: ((error: Error) => void) | undefined;
    const desktop = desktopApi({ phase: 'idle', currentVersion });
    desktop.api.getUpdateState = vi.fn(() => new Promise((_resolve, reject) => {
      rejectSnapshot = reject;
    }));
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.getUpdateState).toHaveBeenCalledOnce());
    act(() => desktop.emitState(availableState()));
    expect(await screen.findByRole('dialog', { name: '发现新版本' })).toBeVisible();

    await act(async () => {
      rejectSnapshot?.(new Error('stale snapshot failed'));
      await Promise.resolve();
    });
    expect(screen.getByText('发现新版本 2026.715.2')).toBeVisible();
    expect(screen.queryByText('stale snapshot failed')).not.toBeInTheDocument();
  });

  test('does not let an initial snapshot overwrite a manual check in progress', async () => {
    let resolveSnapshot: ((state: DesktopUpdateState) => void) | undefined;
    let resolveCheck: ((state: DesktopUpdateState) => void) | undefined;
    const desktop = desktopApi({ phase: 'idle', currentVersion });
    desktop.api.getUpdateState = vi.fn(() => new Promise(resolve => {
      resolveSnapshot = resolve;
    }));
    desktop.api.checkForUpdates = vi.fn(() => new Promise(resolve => {
      resolveCheck = resolve;
    }));
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.getUpdateState).toHaveBeenCalledOnce());
    act(() => desktop.openDialog());
    expect(await screen.findByRole('dialog', { name: '检测更新' })).toBeVisible();

    await act(async () => {
      resolveSnapshot?.({ phase: 'idle', currentVersion });
      await Promise.resolve();
    });
    expect(screen.getByText('正在检测新版本…')).toBeVisible();

    await act(async () => {
      resolveCheck?.({
        phase: 'up-to-date',
        currentVersion,
        version: currentVersion,
        message: '当前已是最新版本。',
      });
      await Promise.resolve();
    });
    expect(screen.getByText('当前已是最新版本。')).toBeVisible();
  });

  test.each<DesktopUpdateState>([
    { phase: 'checking', currentVersion },
    { phase: 'up-to-date', currentVersion, version: currentVersion },
    { phase: 'error', currentVersion, message: '网络不可用' },
  ])('does not automatically open for $phase', async initial => {
    const desktop = desktopApi(initial);
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion={currentVersion} />);

    await waitFor(() => expect(desktop.api.getUpdateState).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
