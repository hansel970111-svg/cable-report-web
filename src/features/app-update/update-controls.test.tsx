// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { DesktopUpdateState } from './model';
import { UpdateControls } from './update-controls';

afterEach(() => {
  vi.restoreAllMocks();
  delete window.cableReport;
});

function desktopApi(initial: DesktopUpdateState) {
  let listener: ((state: DesktopUpdateState) => void) | undefined;
  const checkForUpdates = vi.fn(async () => {
    const next = {
      phase: 'available',
      currentVersion: initial.currentVersion,
      version: '2026.714.4',
      message: '发现新版本 2026.714.4',
    } satisfies DesktopUpdateState;
    listener?.(next);
    return next;
  });
  const downloadUpdate = vi.fn(async () => {
    const next = {
      phase: 'downloaded',
      currentVersion: initial.currentVersion,
      version: '2026.714.4',
      percent: 100,
      message: '更新已下载，点击“重启并更新”后将自动完成更新。',
    } satisfies DesktopUpdateState;
    listener?.(next);
    return next;
  });
  const installUpdate = vi.fn(async () => ({
    phase: 'installing',
    currentVersion: initial.currentVersion,
    version: '2026.714.4',
    percent: 100,
    message: '正在退出应用、后台更新并重新启动…',
  } satisfies DesktopUpdateState));
  return {
    getDesktopSessionToken: vi.fn(async () => 'desktop-token'),
    savePdf: vi.fn(),
    getUpdateState: vi.fn(async () => initial),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    onUpdateState: vi.fn((callback: (state: DesktopUpdateState) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
  };
}

describe('UpdateControls', () => {
  test('keeps update actions disabled in browser development mode', () => {
    render(<UpdateControls currentVersion="2026.714.3" />);

    expect(screen.getByRole('button', { name: '检测更新' })).toBeDisabled();
    expect(screen.getByText(/仅支持已安装的桌面版/)).toBeInTheDocument();
  });

  test('checks, downloads, and offers restart installation through the desktop bridge', async () => {
    const user = userEvent.setup();
    const api = desktopApi({ phase: 'idle', currentVersion: '2026.714.3' });
    window.cableReport = api;
    render(<UpdateControls currentVersion="2026.714.3" />);

    const checkButton = await screen.findByRole('button', { name: '检测更新' });
    await user.click(checkButton);
    expect(api.checkForUpdates).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: '下载 2026.714.4' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '下载 2026.714.4' }));
    expect(api.downloadUpdate).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: '重启并更新' })).toBeEnabled();
    expect(screen.getByText(/更新已下载/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重启并更新' }));
    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledOnce());
  });
});
