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
  percent?: number;
  message?: string;
};

type UpdateManager = {
  getState(): UpdateState;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  dispose(): void;
};

type UpdateManagerModule = {
  createUpdateManager(options: {
    updater: FakeUpdater;
    currentVersion: string;
    supported: boolean;
    emitState?(state: UpdateState): void;
    prepareToInstall?(): Promise<void>;
    logger?: Console;
  }): UpdateManager;
  normalizeProgress(value: unknown): number;
};

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
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

const { createUpdateManager, normalizeProgress } = require(
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

  test('downloads with progress and installs only after cleanup succeeds', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2026.714.4' });
      return { isUpdateAvailable: true, updateInfo: { version: '2026.714.4' } };
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('download-progress', { percent: 47.6 });
      updater.emit('update-downloaded', { version: '2026.714.4' });
      return ['/tmp/update.exe'];
    });
    const prepareToInstall = vi.fn(async () => undefined);
    const states: UpdateState[] = [];
    const manager = createUpdateManager({
      updater,
      currentVersion: '2026.714.3',
      supported: true,
      emitState: state => states.push(state),
      prepareToInstall,
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
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
    expect(states).toContainEqual(expect.objectContaining({
      phase: 'downloading',
      percent: 48,
    }));
    expect(prepareToInstall).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  test('does not quit when pre-install cleanup fails', async () => {
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
      prepareToInstall: async () => {
        throw new Error('cleanup failed');
      },
    });

    await manager.check();
    await manager.download();
    await expect(manager.install()).resolves.toMatchObject({
      phase: 'error',
      message: 'cleanup failed',
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
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
