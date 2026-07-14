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

type Release = {
  tag_name?: string;
  name?: string;
};

type UpdateCheckCallbacks = {
  loadVersioningModule(): Promise<VersioningModule>;
  fetchLatestRelease(): Promise<Release>;
  getCurrentVersion(): string;
  normalizeVersion(version: unknown): string;
  onUpToDate?(details: {
    currentVersion: string;
    latestTag: string;
  }): Promise<void> | void;
  onUpdateAvailable?(details: {
    currentVersion: string;
    latestTag: string;
    release: Release;
  }): Promise<void> | void;
  onManualError?(error: unknown): Promise<void> | void;
};

type UpdateCheckModule = {
  createUpdateChecker(
    callbacks: UpdateCheckCallbacks,
  ): (options?: { manual?: boolean }) => Promise<void>;
};

const require = createRequire(import.meta.url);

const {
  createVersioningLoader,
  loadVersioningModule,
} = require('../../electron/versioning-loader.cjs') as VersioningLoaderModule;

const { createUpdateChecker } = require(
  '../../electron/update-check.cjs'
) as UpdateCheckModule;

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

function normalizeVersion(version: unknown) {
  return String(version || '').trim().replace(/^v/i, '');
}

describe('Electron update check orchestration', () => {
  test('the checking lock prevents concurrent module loads and network requests', async () => {
    let finishLoad: ((module: VersioningModule) => void) | undefined;
    const loadVersioningModule = vi.fn(() => new Promise<VersioningModule>(resolve => {
      finishLoad = resolve;
    }));
    const fetchLatestRelease = vi.fn(async () => ({ tag_name: 'v2026.710.1' }));
    const checkForUpdates = createUpdateChecker({
      loadVersioningModule,
      fetchLatestRelease,
      getCurrentVersion: () => '0.1.1',
      normalizeVersion,
    });

    const first = checkForUpdates();
    const concurrent = checkForUpdates();
    await concurrent;

    expect(loadVersioningModule).toHaveBeenCalledTimes(1);
    expect(fetchLatestRelease).not.toHaveBeenCalled();

    finishLoad?.({ compareAppVersions: () => 1 });
    await first;

    expect(fetchLatestRelease).toHaveBeenCalledTimes(1);
  });

  test('automatic errors stay silent while manual errors invoke the UI callback', async () => {
    const error = new Error('network unavailable');
    const onManualError = vi.fn();
    const checkForUpdates = createUpdateChecker({
      loadVersioningModule: async () => ({ compareAppVersions: () => 1 }),
      fetchLatestRelease: vi.fn(async () => { throw error; }),
      getCurrentVersion: () => '0.1.1',
      normalizeVersion,
      onManualError,
    });

    await checkForUpdates();
    expect(onManualError).not.toHaveBeenCalled();

    await checkForUpdates({ manual: true });
    expect(onManualError).toHaveBeenCalledOnce();
    expect(onManualError).toHaveBeenCalledWith(error);
  });

  test('the pure comparator routes the current version to the manual up-to-date callback', async () => {
    const onUpToDate = vi.fn();
    const onUpdateAvailable = vi.fn();
    const checkForUpdates = createUpdateChecker({
      loadVersioningModule,
      fetchLatestRelease: async () => ({ tag_name: 'v0.1.1' }),
      getCurrentVersion: () => '0.1.1',
      normalizeVersion,
      onUpToDate,
      onUpdateAvailable,
    });

    await checkForUpdates({ manual: true });

    expect(onUpToDate).toHaveBeenCalledWith({
      currentVersion: '0.1.1',
      latestTag: 'v0.1.1',
    });
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  test('the pure comparator routes 0.1.1 to an available CalVer update', async () => {
    const release = { tag_name: 'v2026.710.1' };
    const onUpdateAvailable = vi.fn();
    const checkForUpdates = createUpdateChecker({
      loadVersioningModule,
      fetchLatestRelease: async () => release,
      getCurrentVersion: () => '0.1.1',
      normalizeVersion,
      onUpdateAvailable,
    });

    await checkForUpdates();

    expect(onUpdateAvailable).toHaveBeenCalledWith({
      currentVersion: '0.1.1',
      latestTag: 'v2026.710.1',
      release,
    });
  });
});
