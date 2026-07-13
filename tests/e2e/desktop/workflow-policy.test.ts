import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

test('CI uploads installers before publishing final acceptance evidence', async () => {
  const source = await readFile('.github/workflows/desktop-e2e.yml', 'utf8');
  const macInstaller = source.indexOf('name: Upload macOS installers');
  const winInstaller = source.indexOf('name: Upload Windows installer');
  const macEvidence = source.indexOf('name: Upload macOS acceptance evidence');
  const winEvidence = source.indexOf('name: Upload Windows acceptance evidence');

  expect(macInstaller).toBeGreaterThan(-1);
  expect(winInstaller).toBeGreaterThan(-1);
  expect(macInstaller).toBeLessThan(macEvidence);
  expect(winInstaller).toBeLessThan(winEvidence);
  expect(source.slice(Math.max(macEvidence, winEvidence))).not.toMatch(/\n\s+- name:/);
});

test('machine reports and Playwright scratch output cannot dirty acceptance status', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');
  expect(gitignore.split(/\r?\n/)).toEqual(expect.arrayContaining([
    'artifacts/',
    'test-results/',
  ]));
});

test('CI matrix and frozen runtimes retain the release contract', async () => {
  const source = await readFile('.github/workflows/desktop-e2e.yml', 'utf8');
  const browserConfig = await readFile('playwright.config.ts', 'utf8');

  expect(source).toContain('os: [macos-latest, windows-latest]');
  expect(source).toContain('node-version: "24.14.0"');
  expect(source).toContain('python-version: "3.12.13"');
  expect(source).toContain('corepack prepare pnpm@9.15.9 --activate');
  expect(source).toContain('pnpm install --frozen-lockfile');
  expect(source).toContain('python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock');
  expect(source).toContain('pnpm exec playwright install chromium');
  expect(source).toContain('permissions:\n  contents: read');
  expect(source).not.toMatch(/create-release|softprops|gh release/i);
  expect(browserConfig).toContain("testMatch: '**/*.spec.ts'");
  expect(browserConfig).toContain("testIgnore: 'desktop/**'");
});

test('release documentation uses the actual frozen toolchain and dev lock', async () => {
  const [readme, packaging, windows] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('PACKAGING.md', 'utf8'),
    readFile('WINDOWS.md', 'utf8'),
  ]);
  const releaseDocs = `${packaging}\n${windows}`;

  expect(readme).toContain('Next.js 16.2.10');
  expect(readme).toContain('pnpm 9.15.9');
  expect(releaseDocs).not.toContain('requirements.lock');
  expect(releaseDocs.match(/requirements-dev\.lock/g)?.length).toBeGreaterThanOrEqual(4);
});
