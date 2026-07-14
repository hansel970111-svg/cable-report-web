import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

test('CI publishes only the Windows installer before final acceptance evidence', async () => {
  const source = await readFile('.github/workflows/desktop-e2e.yml', 'utf8');
  const macInstaller = source.indexOf('name: Upload macOS installers');
  const winInstaller = source.indexOf('name: Upload Windows installer');
  const macEvidence = source.indexOf('name: Upload macOS acceptance evidence');
  const winEvidence = source.indexOf('name: Upload Windows acceptance evidence');

  expect(macInstaller).toBe(-1);
  expect(winInstaller).toBeGreaterThan(-1);
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
  const source = (await readFile('.github/workflows/desktop-e2e.yml', 'utf8'))
    .replaceAll('\r\n', '\n');
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
  expect(source).toContain('CABLE_PLAYWRIGHT_PREBUILT: "1"');
  expect(source).toContain(
    'run: corepack pnpm@9.15.9 build && node scripts/run-evidence-command.mjs --name browser',
  );
  expect(source).toContain(
    'pnpm exec vitest run --reporter=default --reporter=json --outputFile.json=artifacts/acceptance/unit.json',
  );
  expect(source).toContain('node scripts/write-acceptance-evidence.mjs mac');
  expect(source).toContain('node scripts/write-acceptance-evidence.mjs win');
  expect(source.match(/node scripts\/run-evidence-command\.mjs/g)).toHaveLength(9);
  expect(source).toContain('permissions:\n  contents: read');
  expect(source).not.toMatch(/create-release|softprops|gh release/i);
  expect(browserConfig).toContain("testMatch: '**/*.spec.ts'");
  expect(browserConfig).toContain("testIgnore: 'desktop/**'");
  expect(browserConfig).toContain("process.env.CABLE_PLAYWRIGHT_PREBUILT === '1'");
  expect(source).toContain(
    'run: node scripts/verify-desktop-package.mjs mac && node scripts/verify-macos-trust.mjs && node scripts/check-package-size.mjs mac',
  );
  expect(source).toContain(
    'run: node scripts/verify-desktop-package.mjs win && node scripts/check-package-size.mjs win',
  );
  expect(source).toContain('CABLE_MAC_SIGNING_MODE: adhoc');
  expect(source).not.toContain('name: Upload macOS installers');
  expect(source).not.toContain('CABLE_MAC_SIGNING_MODE: developer-id');
  expect(source).not.toContain('secrets.MAC_CSC_LINK');
  expect(source).not.toContain('secrets.APPLE_API_KEY_BASE64');
});

test('package and acceptance evidence are bound to the current Git commit', async () => {
  const [build, packageVerifier, acceptance] = await Promise.all([
    readFile('scripts/build.mjs', 'utf8'),
    readFile('scripts/verify-desktop-package.mjs', 'utf8'),
    readFile('scripts/verify-acceptance.mjs', 'utf8'),
  ]);

  expect(build).toContain("'.cable-build-commit'");
  expect(packageVerifier).toContain("'next-build/standalone/.cable-build-commit'");
  expect(packageVerifier).toContain(".split('/')");
  expect(packageVerifier).toContain('.join(path.sep)');
  expect(packageVerifier).toContain('does not match current HEAD');
  const macTrustVerifier = await readFile('scripts/verify-macos-trust.mjs', 'utf8');
  expect(macTrustVerifier).toContain("['--verify', '--deep', '--strict', '--verbose=4', appDir]");
  expect(macTrustVerifier).toContain("['verify', dmgPath]");
  expect(macTrustVerifier).not.toContain('stapler');
  expect(macTrustVerifier).not.toContain('spctl');
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
