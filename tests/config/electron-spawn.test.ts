import { expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import { spawnDesktopElectron } from '../../scripts/electron-runtime.mjs';

test('desktop development launches the Electron executable without a shell', () => {
  const child = { on: vi.fn() };
  const requireImpl = vi.fn(() => 'C:\\workspace\\node_modules\\electron\\dist\\electron.exe');
  const spawnImpl = vi.fn(() => child);

  expect(
    spawnDesktopElectron({
      cwd: 'C:\\workspace',
      env: { NODE_ENV: 'test' },
      requireImpl: requireImpl as never,
      spawnImpl: spawnImpl as never,
    }),
  ).toBe(child);

  expect(requireImpl).toHaveBeenCalledWith('electron');
  expect(spawnImpl).toHaveBeenCalledWith(
    'C:\\workspace\\node_modules\\electron\\dist\\electron.exe',
    ['.'],
    expect.objectContaining({
      cwd: 'C:\\workspace',
      shell: false,
      windowsHide: false,
    }),
  );
});

test('desktop development rejects an invalid Electron module export', () => {
  expect(() =>
    spawnDesktopElectron({
      cwd: '/workspace',
      env: { NODE_ENV: 'test' },
      requireImpl: (() => ({ invalid: true })) as never,
      spawnImpl: vi.fn() as never,
    }),
  ).toThrow('Electron package did not expose an executable path');
});

test('Electron update checks use the pure version core through one cached ESM import', async () => {
  const source = await readFile('electron/main.cjs', 'utf8');

  expect(source).toContain("import('../scripts/versioning.mjs')");
  expect(source).toContain('const { compareAppVersions } = await loadVersioningModule()');
  expect(source).toContain('compareAppVersions(latestVersion, currentVersion) <= 0');
  expect(source).toContain(".replace(/^v/i, '')");
  expect(source).not.toMatch(/function compareVersions\s*\(/);
  expect(source).not.toMatch(/\.split\('\.'\)\.map\(/);
});
