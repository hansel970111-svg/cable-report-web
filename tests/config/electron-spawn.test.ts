import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';

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

test('Electron main wires the executed loader and update orchestration without a private comparator', async () => {
  const source = await readFile('electron/main.cjs', 'utf8');

  expect(source).toContain("require('./versioning-loader.cjs')");
  expect(source).toContain("require('./update-check.cjs')");
  expect(source).toContain('createUpdateChecker({');
  expect(source).toContain('loadVersioningModule,');
  expect(source).toContain(".replace(/^v/i, '')");
  expect(source).not.toMatch(/function compareVersions\s*\(/);
  expect(source).not.toMatch(/\.split\('\.'\)\.map\(/);
  expect(source).not.toContain("import('../scripts/versioning.mjs')");
  expect(source).not.toContain('let checkingForUpdates = false');
});

test('desktop package inputs include only the runtime version module from scripts', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  expect(packageJson.build.files).toContain('scripts/versioning.mjs');
  expect(packageJson.build.files).not.toContain('scripts/**/*');
  expect(packageJson.build.files).not.toContain('scripts/**');
});

test('desktop package verification rejects a packaged tree without the runtime version module', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'desktop-package-versioning-'));
  const resourcesDir = join(
    workspace,
    'release',
    'mac',
    'Cable Report Generator.app',
    'Contents',
    'Resources',
  );
  const appDir = join(resourcesDir, 'app');

  try {
    const directories = [
      join(appDir, 'electron'),
      join(appDir, 'next-build', 'server'),
      join(appDir, 'next-build', 'static'),
      join(resourcesDir, 'assets'),
      join(resourcesDir, 'bin'),
    ];
    await Promise.all(directories.map(directory => mkdir(directory, { recursive: true })));

    const files = [
      [join(appDir, 'package.json'), '{}'],
      [join(appDir, 'next.config.mjs'), 'export default {}'],
      [join(appDir, 'electron', 'main.cjs'), ''],
      [join(appDir, 'next-build', 'BUILD_ID'), 'test'],
      [join(appDir, 'next-build', 'routes-manifest.json'), '{}'],
      [join(resourcesDir, 'bin', 'pdf_worker'), ''],
      [join(resourcesDir, 'assets', 'M138-DE46-OOB-Cat5e.pdf'), ''],
      [join(resourcesDir, 'assets', 'M138-DE46-D-P-cross-LC.pdf'), ''],
      [join(resourcesDir, 'assets', 'M138-DE46-P-A-MPO.pdf'), ''],
    ];
    await Promise.all(files.map(([filePath, contents]) => writeFile(filePath, contents)));

    const result = spawnSync(
      process.execPath,
      ['scripts/verify-desktop-package.mjs', 'mac'],
      {
        cwd: process.cwd(),
        env: { ...process.env, COZE_WORKSPACE_PATH: workspace },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing CalVer runtime module');

    await mkdir(join(appDir, 'scripts'));
    await writeFile(join(appDir, 'scripts', 'versioning.mjs'), 'export {};');
    const completeResult = spawnSync(
      process.execPath,
      ['scripts/verify-desktop-package.mjs', 'mac'],
      {
        cwd: process.cwd(),
        env: { ...process.env, COZE_WORKSPACE_PATH: workspace },
        encoding: 'utf8',
      },
    );

    expect(completeResult.status).toBe(0);
    expect(completeResult.stdout).toContain('mac package structure looks good');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
