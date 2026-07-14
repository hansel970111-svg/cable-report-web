import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import packageJson from '../../package.json';

test('desktop packaging is configured for the trusted GitHub update provider', () => {
  expect(packageJson.dependencies['electron-updater']).toBe('6.8.9');
  expect(packageJson.build.publish).toEqual([{
    provider: 'github',
    owner: 'hansel970111-svg',
    repo: 'cable-report-web',
    releaseType: 'release',
  }]);
  expect(packageJson.build.electronUpdaterCompatibility).toBe('>=2.16');
  expect(packageJson.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
  expect(packageJson.build.mac.target).toEqual(['dmg', 'zip']);
});

test('cross-platform workflows retain updater metadata with the installers', async () => {
  const [desktop, windows] = await Promise.all([
    readFile('.github/workflows/desktop-e2e.yml', 'utf8'),
    readFile('.github/workflows/build-windows-exe.yml', 'utf8'),
  ]);

  expect(desktop).toContain('release/latest-mac.yml');
  expect(desktop).toContain('release/latest.yml');
  expect(desktop.match(/release\/\*\.blockmap/g)).toHaveLength(2);
  expect(windows).toContain('release/latest.yml');
  expect(windows).toContain('release/*.blockmap');
});

test('the updater runtime is bundled as one controlled production file', async () => {
  const [main, dist, verifier] = await Promise.all([
    readFile('electron/main.cjs', 'utf8'),
    readFile('scripts/desktop-dist.mjs', 'utf8'),
    readFile('scripts/verify-desktop-package.mjs', 'utf8'),
  ]);

  expect(main).toContain("require('../updater-runtime/index.cjs')");
  expect(main).toContain("supported: app.isPackaged && process.platform === 'win32'");
  expect(dist).toContain("runNodeScript('build-updater-runtime.mjs')");
  expect(packageJson.build.files).toContain('updater-runtime/**/*');
  expect(verifier).toContain("'updater-runtime/index.cjs'");
});
