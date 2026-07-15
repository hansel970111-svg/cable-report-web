// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { DesktopUpdateState } from './model';
import { UpdateDialog } from './update-dialog';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.cableReport;
});

function desktopApi(initial: DesktopUpdateState) {
  let stateListener: ((state: DesktopUpdateState) => void) | undefined;
  let openListener: (() => void) | undefined;
  const checkForUpdates = vi.fn(async () => {
    const next = {
      phase: 'available',
      currentVersion: initial.currentVersion,
      version: '2026.715.2',
      message: '发现新版本 2026.715.2',
    } satisfies DesktopUpdateState;
    stateListener?.(next);
    return next;
  });
  const downloadUpdate = vi.fn(async () => {
    const next = {
      phase: 'downloaded',
      currentVersion: initial.currentVersion,
      version: '2026.715.2',
      percent: 100,
      message: '更新已下载，点击“重启并更新”后将自动完成更新。',
    } satisfies DesktopUpdateState;
    stateListener?.(next);
    return next;
  });
  const installUpdate = vi.fn(async () => ({
    phase: 'installing',
    currentVersion: initial.currentVersion,
    version: '2026.715.2',
    percent: 100,
    message: '正在退出应用、后台更新并重新启动…',
  } satisfies DesktopUpdateState));
  const api = {
    getDesktopSessionToken: vi.fn(async () => 'desktop-token'),
    savePdf: vi.fn(),
    getUpdateState: vi.fn(async () => initial),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
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
    openDialog: () => openListener?.(),
  };
}

describe('UpdateDialog', () => {
  test('renders no version or update controls at the bottom of browser mode', () => {
    render(<UpdateDialog currentVersion="2026.715.1" />);

    expect(screen.queryByRole('dialog', { name: '检测更新' })).not.toBeInTheDocument();
    expect(screen.getByText('当前版本')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: '检测更新' })).not.toBeInTheDocument();
  });

  test('opens from the Help menu event, checks, downloads, and restarts', async () => {
    const user = userEvent.setup();
    const desktop = desktopApi({ phase: 'idle', currentVersion: '2026.715.1' });
    window.cableReport = desktop.api;
    render(<UpdateDialog currentVersion="2026.715.1" />);

    await waitFor(() => expect(desktop.api.onOpenUpdateDialog).toHaveBeenCalledOnce());
    act(() => desktop.openDialog());

    expect(await screen.findByRole('dialog', { name: '检测更新' })).toBeVisible();
    await waitFor(() => expect(desktop.api.checkForUpdates).toHaveBeenCalledOnce());
    expect(await screen.findByText('发现新版本 2026.715.2')).toBeVisible();
    expect(screen.getByText('2026.715.1')).toBeVisible();
    expect(screen.getByText('2026.715.2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '下载更新' }));
    expect(desktop.api.downloadUpdate).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: '重启并更新' })).toBeEnabled();
    expect(screen.getByText(/更新已下载/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '重启并更新' }));
    await waitFor(() => expect(desktop.api.installUpdate).toHaveBeenCalledOnce());
  });
});
