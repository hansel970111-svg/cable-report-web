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
    '/.pnpm/',
    'artifacts/',
    'test-results/',
  ]));
});

test('CI matrix and frozen runtimes retain the release contract', async () => {
  const source = await readFile('.github/workflows/desktop-e2e.yml', 'utf8');
  const browserConfig = await readFile('playwright.config.ts', 'utf8');

  expect(source).toContain('os: macos-latest');
  expect(source).toContain('platform: mac');
  expect(source).toContain('os: windows-latest');
  expect(source).toContain('platform: win');
  expect(source).toContain('node-version: "24.14.0"');
  expect(source).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
  expect(source).toContain(
    'uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0',
  );
  expect(source).toContain('version: "0.11.28"');
  expect(source).toContain('node scripts/setup-ci-python.mjs 3.12.13');
  expect(source).not.toContain('actions/setup-python');
  expect(source).toContain('corepack pnpm@9.15.9 install --frozen-lockfile');
  expect(source).not.toMatch(/^\s*run: pnpm /m);
  expect(source).toContain('python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock');
  expect(source).toContain('corepack pnpm@9.15.9 exec playwright install chromium');
  expect(source).toContain('node scripts/write-acceptance-evidence.mjs mac');
  expect(source).toContain('node scripts/write-acceptance-evidence.mjs win');
  expect(source.match(/node scripts\/run-evidence-command\.mjs/g)).toHaveLength(9);
  expect(source).toContain('permissions:\n  contents: read');
  expect(source).not.toMatch(/create-release|softprops|gh release/i);
  expect(browserConfig).toContain("testMatch: '**/*.spec.ts'");
  expect(browserConfig).toContain("testIgnore: 'desktop/**'");
});

test('package and acceptance evidence are bound to the current Git commit', async () => {
  const [build, packageVerifier, acceptance] = await Promise.all([
    readFile('scripts/build.mjs', 'utf8'),
    readFile('scripts/verify-desktop-package.mjs', 'utf8'),
    readFile('scripts/verify-acceptance.mjs', 'utf8'),
  ]);

  expect(build).toContain("'.cable-build-commit'");
  expect(packageVerifier).toContain("'next-build/standalone/.cable-build-commit'");
  expect(packageVerifier).toContain('does not match current HEAD');
  expect(acceptance).toContain('verifyAcceptanceManifest');
  expect(acceptance).toContain("commandInvocation('pnpm', ['lint'], platform)");
  expect(acceptance).toContain("commandInvocation('pnpm', ['ts-check'], platform)");
  const evidenceRunner = await readFile('scripts/run-evidence-command.mjs', 'utf8');
  expect(evidenceRunner).toContain("args: ['pnpm@9.15.9', ...args]");
});

test('release documentation uses the actual frozen toolchain and dev lock', async () => {
  const [readme, packaging, windows] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('PACKAGING.md', 'utf8'),
    readFile('WINDOWS.md', 'utf8'),
  ]);
  const releaseDocs = `${packaging}\n${windows}`;
  const releaseReadme = readme.slice(readme.indexOf('## 发布验证'));
  const frozenReleaseDocs = `${releaseReadme}\n${releaseDocs}`;

  expect(readme).toContain('Next.js 16.2.10');
  expect(readme).toContain('pnpm 9.15.9');
  expect(frozenReleaseDocs).not.toContain('corepack prepare pnpm@9.15.9');
  expect(frozenReleaseDocs).not.toMatch(/^pnpm /m);
  expect(frozenReleaseDocs).toContain('corepack pnpm@9.15.9 install --frozen-lockfile');
  expect(releaseDocs).not.toContain('requirements.lock');
  expect(releaseDocs.match(/requirements-dev\.lock/g)?.length).toBeGreaterThanOrEqual(4);
});
