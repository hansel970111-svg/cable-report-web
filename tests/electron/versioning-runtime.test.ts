import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { describe, expect, test, vi } from 'vitest';

type VersioningModule = {
  compareAppVersions(left: string, right: string): number;
};

type VersioningLoaderModule = {
  createVersioningLoader(
    importModule: () => Promise<VersioningModule>,
  ): () => Promise<VersioningModule>;
  loadVersioningModule(): Promise<VersioningModule>;
};

type UpdateState = {
  phase: string;
  currentVersion: string;
  version?: string;
  releaseName?: string;
  releaseDate?: string;
  releaseNotes?: string[];
  percent?: number;
  message?: string;
};

type UpdateManager = {
  getState(): UpdateState;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  updateNow(): Promise<UpdateState>;
  dispose(): void;
};

type UpdateManagerModule = {
  createAutomaticUpdateChecker(options: {
    check(): Promise<unknown>;
    enabled?: boolean;
    delayMs?: number;
    setTimer?(callback: () => void, delayMs: number): { unref?(): void };
    clearTimer?(timer: unknown): void;
    logger?: Pick<Console, 'warn'>;
  }): { schedule(): boolean; cancel(): void };
  createUpdateManager(options: {
    updater: FakeUpdater;
    currentVersion: string;
    supported: boolean;
    emitState?(state: UpdateState): void;
    logger?: Console;
  }): UpdateManager;
  normalizeProgress(value: unknown): number;
  normalizeReleaseNotes(value: unknown): string[];
};

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
  fullChangelog = true;
  allowPrerelease = true;
  allowDowngrade = true;
  disableWebInstaller = false;
  logger: Console | null = null;
  checkForUpdates = vi.fn(async () => ({
    isUpdateAvailable: false,
    updateInfo: { version: '2026.714.3' },
  }));
  downloadUpdate = vi.fn(async () => [] as string[]);
  quitAndInstall = vi.fn();
}

const require = createRequire(import.meta.url);

const {
  createVersioningLoader,
  loadVersioningModule,
} = require('../../electron/versioning-loader.cjs') as VersioningLoaderModule;

const {
  createAutomaticUpdateChecker,
  createUpdateManager,
  normalizeProgress,
  normalizeReleaseNotes,
} = require(
  '../../electron/update-check.cjs'
) as UpdateManagerModule;

describe('CalVer runtime loader', () => {
  test('concurrent calls share one import promise and module', async () => {
    const versioningModule = { compareAppVersions: vi.fn(() => 1) };
    const importModule = vi.fn(async () => versioningModule);
    const load = createVersioningLoader(importModule);

    const first = load();
    const second = load();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(versioningModule);
    await expect(second).resolves.toBe(versioningModule);
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  test('a rejected import clears the cache so the next call retries', async () => {
    const versioningModule = { compareAppVersions: vi.fn(() => 1) };
    const importModule = vi
      .fn<() => Promise<VersioningModule>>()
      .mockRejectedValueOnce(new Error('first import failed'))
      .mockResolvedValueOnce(versioningModule);
    const load = createVersioningLoader(importModule);

    await expect(load()).rejects.toThrow('first import failed');
    await expect(load()).resolves.toBe(versioningModule);
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  test('the packaged runtime loader executes the real version core for migration comparison', async () => {
    const versioningModule = await loadVersioningModule();

    expect(versioningModule.compareAppVersions('0.1.1', '2026.710.1')).toBeLessThan(0);
  });
});

describe('Electron update manager', () => {
  test('schedules one non-blocking automatic check and supports shutdown cancellation', async () => {
    const check = vi.fn(async () => undefined);
    const unref = vi.fn();
    const clearTimer = vi.fn();
    let run: (() => void) | undefined;
    const setTimer = vi.fn((callback: () => void) => {
      run = callback;
      return { unref };
    });
    const checker = createAutomaticUpdateChecker({
      check,
      delayMs: 8_000,
      setTimer,
      clearTimer,
    });

    expect(checker.schedule()).toBe(true);
    expect(checker.schedule()).toBe(false);
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 8_000);
    expect(unref).toHaveBeenCalledOnce();
    run?.();
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    checker.cancel();
    expect(clearTimer).not.toHaveBeenCalled();
  });

  test('does not schedule when disabled and cancels before the timer fires', () => {
    const disabledTimer = vi.fn();
    const disabled = createAutomaticUpdateChecker({
      check: vi.fn(async () => undefined),
      enabled: false,
      setTimer: disabledTimer,
    });
    expect(disabled.schedule()).toBe(false);
    expect(disabledTimer).not.toHaveBeenCalled();

    const timerToken = { unref: vi.fn() };
    const clearTimer = vi.fn();
    const enabled = createAutomaticUpdateChecker({
      check: vi.fn(async () => undefined),
      setTimer: vi.fn(() => timerToken),
      clearTimer,
    });
    expect(enabled.schedule()).toBe(true);
    enabled.cancel();
    expect(clearTimer).toHaveBeenCalledWith(timerToken);
  });

  test('normalizes untrusted GitHub HTML release notes into bounded plain text', () => {
    expect(normalizeReleaseNotes(
      '<h2>本次更新</h2><ul><li>修复 PDF &amp; PASS 图标</li>'
      + '<li><a href="https://evil.example">提升导入稳定性</a></li></ul>'
      + '<script>alert(1)</script>',
    )).toEqual([
      '本次更新',
      '修复 PDF & PASS 图标',
      '提升导入稳定性',
    ]);

    const bounded = normalizeReleaseNotes(Array.from({ length: 24 }, (_value, index) => ({
      version: `2026.715.${index}`,
      note: `${index}-\u202e${'x'.repeat(500)}`,
    })));
    expect(bounded.length).toBeLessThanOrEqual(16);
    expect(bounded.every(line => line.length <= 320)).toBe(true);
    expect(bounded.join('').length).toBeLessThanOrEqual(4_000);
    expect(bounded.join('')).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
  });

  test('keeps browser and unpackaged builds unsupported without network access', async () => {
    const updater = new FakeUpdater();
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: false,
    });

    await expect(manager.check()).resolves.toMatchObject({ phase: 'unsupported' });
    await expect(manager.download()).resolves.toMatchObject({ phase: 'unsupported' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('reports an up-to-date result and prevents duplicate concurrent checks', async () => {
    const updater = new FakeUpdater();
    let finish: ((value: { isUpdateAvailable: boolean; updateInfo: { version: string } }) => void) | undefined;
    updater.checkForUpdates.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    const states: UpdateState[] = [];
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
      emitState: state => states.push(state),
    });

    const first = manager.check();
    const second = manager.check();
    await Promise.resolve();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    finish?.({ isUpdateAvailable: false, updateInfo: { version: '2026.714.3' } });

    await expect(first).resolves.toMatchObject({ phase: 'up-to-date' });
    await expect(second).resolves.toMatchObject({ phase: 'up-to-date' });
    expect(states.map(state => state.phase)).toEqual(['checking', 'up-to-date']);
  });

  test('downloads with progress and starts the explicit installer', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      const updateInfo = {
        version: '2026.714.4',
        releaseName: 'Cable Report Generator 2026.714.4',
        releaseDate: '2026-07-14T12:00:00.000Z',
        releaseNotes: '<ul><li>修复 ODF 导入</li><li>提升 PDF 清晰度</li></ul>',
      };
      updater.emit('update-available', updateInfo);
      return { isUpdateAvailable: true, updateInfo };
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('download-progress', { percent: 47.6 });
      updater.emit('update-downloaded', { version: '2026.714.4' });
      return ['/tmp/update.exe'];
    });
    const states: UpdateState[] = [];
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
      emitState: state => states.push(state),
    });

    await expect(manager.check()).resolves.toMatchObject({
      phase: 'available',
      version: '2026.714.4',
    });
    await expect(manager.download()).resolves.toMatchObject({
      phase: 'downloaded',
      version: '2026.714.4',
      percent: 100,
    });
    await expect(manager.check()).resolves.toMatchObject({ phase: 'downloaded' });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    await expect(manager.install()).resolves.toMatchObject({ phase: 'installing' });

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.autoRunAppAfterInstall).toBe(true);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
    expect(updater.fullChangelog).toBe(false);
    expect(states).toContainEqual(expect.objectContaining({
      phase: 'available',
      releaseName: 'Cable Report Generator 2026.714.4',
      releaseNotes: ['修复 ODF 导入', '提升 PDF 清晰度'],
    }));
    expect(states).toContainEqual(expect.objectContaining({
      phase: 'downloaded',
      releaseNotes: ['修复 ODF 导入', '提升 PDF 清晰度'],
    }));
    expect(states).toContainEqual(expect.objectContaining({
      phase: 'downloading',
      percent: 48,
    }));
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test('updates now with one call by downloading, installing, and restarting', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2026.714.4' });
      return { isUpdateAvailable: true, updateInfo: { version: '2026.714.4' } };
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('update-downloaded', { version: '2026.714.4' });
      return ['/tmp/update.exe'];
    });
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
    });

    await manager.check();
    await expect(manager.updateNow()).resolves.toMatchObject({ phase: 'installing' });
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test('coalesces concurrent immediate-update requests into one download and one install', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2026.714.4' });
      return { isUpdateAvailable: true, updateInfo: { version: '2026.714.4' } };
    });
    let finishDownload: (() => void) | undefined;
    updater.downloadUpdate.mockImplementation(() => new Promise(resolve => {
      finishDownload = () => {
        updater.emit('update-downloaded', { version: '2026.714.4' });
        resolve(['/tmp/update.exe']);
      };
    }));
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
    });

    await manager.check();
    const first = manager.updateNow();
    const second = manager.updateNow();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce());
    finishDownload?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ phase: 'installing' }),
      expect.objectContaining({ phase: 'installing' }),
    ]);
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  test('does not start the installer when the immediate download fails', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2026.714.4' });
      return { isUpdateAvailable: true, updateInfo: { version: '2026.714.4' } };
    });
    updater.downloadUpdate.mockRejectedValue(new Error('download failed'));
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
    });

    await manager.check();
    await expect(manager.updateNow()).resolves.toMatchObject({
      phase: 'error',
      version: '2026.714.4',
      message: 'download failed',
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('keeps the running app usable when the installer cannot start', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2026.714.4' });
      return { isUpdateAvailable: true, updateInfo: { version: '2026.714.4' } };
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('update-downloaded', { version: '2026.714.4' });
      return ['/tmp/update.exe'];
    });
    updater.quitAndInstall.mockImplementation(() => {
      updater.emit('error', new Error('installer failed'));
    });
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
    });

    await manager.check();
    await manager.download();
    await expect(manager.install()).resolves.toMatchObject({
      phase: 'error',
      version: '2026.714.4',
      message: 'installer failed',
    });
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  test('normalizes progress and exposes updater errors for a safe retry', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error('network unavailable'));
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
    });

    await expect(manager.check()).resolves.toMatchObject({
      phase: 'error',
      message: 'network unavailable',
    });
    expect(normalizeProgress(-5)).toBe(0);
    expect(normalizeProgress(41.7)).toBe(42);
    expect(normalizeProgress(500)).toBe(100);
  });
});
