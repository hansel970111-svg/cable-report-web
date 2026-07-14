import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import packageJson from '../../package.json';

test('desktop packaging is configured for the trusted GitHub update provider', () => {
  expect(packageJson.dependencies['electron-updater']).toBe('6.8.9');
  expect(packageJson.build).not.toHaveProperty('publish');
  expect(packageJson.build.win.publish).toEqual([{
    provider: 'github',
    owner: 'hansel970111-svg',
    repo: 'cable-report-web',
    releaseType: 'release',
  }]);
  expect(packageJson.build.electronUpdaterCompatibility).toBe('>=2.16');
  expect(packageJson.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
  expect(packageJson.build.mac.target).toEqual(['dmg', 'zip']);
  expect(packageJson.build.mac.publish).toBeNull();
});

test('release workflows retain only Windows updater metadata with a published installer', async () => {
  const [desktop, windows, workflowNames] = await Promise.all([
    readFile('.github/workflows/desktop-e2e.yml', 'utf8'),
    readFile('.github/workflows/build-windows-exe.yml', 'utf8'),
    readdir('.github/workflows'),
  ]);
  const allWorkflows = (await Promise.all(
    workflowNames
      .filter(name => /\.ya?ml$/u.test(name))
      .map(name => readFile(`.github/workflows/${name}`, 'utf8')),
  )).join('\n');

  expect(desktop).not.toContain('release/latest-mac.yml');
  expect(desktop).toContain('release/latest.yml');
  expect(desktop.match(/release\/\*\.blockmap/g)).toHaveLength(1);
  expect(windows).toContain('release/latest.yml');
  expect(windows).toContain('release/*.blockmap');
  expect(desktop).not.toContain('Upload macOS installers');
  expect(desktop).toContain('Upload Windows installer');
  expect(allWorkflows).not.toContain('release/*.dmg');
  expect(allWorkflows).not.toContain('release/*.zip');
  expect(allWorkflows).not.toContain('release/latest-mac.yml');
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
  expect(verifier).toContain("if (platform === 'win')");
  expect(verifier).toContain('Internal macOS packages must not contain updater provider configuration.');
});
