import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import packageJson from '../../package.json';

test('approved dependency baseline is exact', async () => {
  expect(packageJson.dependencies).toMatchObject({
    '@tanstack/react-virtual': '3.14.5',
    'electron-updater': '6.8.9',
    'lucide-react': '0.469.0',
    next: '16.2.10',
    react: '19.2.7',
    'react-dom': '19.2.7',
    xlsx: 'file:vendor/xlsx-0.20.3.tgz',
    zod: '4.4.3',
  });
  expect(packageJson.devDependencies).toMatchObject({
    electron: '43.1.0',
    'electron-builder': '26.15.3',
    'electron-builder-squirrel-windows': '26.15.3',
    'eslint-config-next': '16.2.10',
    '@testing-library/dom': '10.4.1',
    '@types/node': '24.13.3',
    'playwright-core': '1.61.1',
    typescript: '5.9.3',
  });
  expect(packageJson.devDependencies).not.toHaveProperty('shadcn');
  expect(packageJson.pnpm?.overrides).toMatchObject({
    '@babel/core@7.28.6': '7.29.7',
    'ajv@6.12.6': '6.14.0',
    'brace-expansion@1.1.12': '1.1.13',
    'brace-expansion@2.0.2': '2.0.3',
    'esbuild@0.27.3': '0.28.1',
    lodash: '4.18.1',
    postcss: '8.5.16',
    'minimatch@3.1.2': '3.1.4',
    'minimatch@9.0.5': '9.0.7',
    flatted: '3.4.2',
    'picomatch@2.3.1': '2.3.2',
    'picomatch@4.0.3': '4.0.5',
    'fast-uri': '3.1.2',
    'js-yaml@4.1.1': '4.3.0',
    'tar@7.5.15': '7.5.19',
    tmp: '0.2.7',
    'form-data': '4.0.6',
    '@electron/get@5.0.0>undici': '7.28.0',
    'jsdom@29.1.1>undici': '7.28.0',
    'node-gyp@12.3.0>undici': '6.27.0',
  });
  expect(packageJson.pnpm?.overrides).not.toHaveProperty('undici');
  expect(packageJson.packageManager).toBe('pnpm@9.15.9');
  expect(packageJson.engines.node).toBe('>=24.0.0 <25');
  expect(packageJson.engines.pnpm).toBe('9.15.9');
  expect(packageJson.scripts.test).toBe(
    'corepack pnpm test:unit && corepack pnpm test:python',
  );
  expect(packageJson.scripts['check:fast']).toBe(
    'corepack pnpm lint && corepack pnpm ts-check && corepack pnpm test:unit',
  );

  for (const section of [packageJson.dependencies, packageJson.devDependencies]) {
    for (const specifier of Object.values(section)) {
      expect(specifier).not.toBe('latest');
      expect(specifier).not.toMatch(/^(?:git\+|https?:)/);
      expect(specifier).toMatch(
        /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|file:vendor\/[0-9A-Za-z._/-]+)$/,
      );
    }
  }

  const tarball = await readFile('vendor/xlsx-0.20.3.tgz');
  expect(createHash('sha256').update(tarball).digest('hex')).toBe(
    '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8',
  );
});

function snapshotDependency(
  lockfile: string,
  packageKey: string,
  dependency: string,
): string | undefined {
  const lines = lockfile.split(/\r?\n/);
  const quotedKey = `  '${packageKey}':`;
  const plainKey = `  ${packageKey}:`;
  let inSnapshots = false;
  let inPackage = false;

  for (const line of lines) {
    if (line === 'snapshots:') {
      inSnapshots = true;
      continue;
    }
    if (!inSnapshots) continue;
    if (/^[^\s]/.test(line)) break;

    if (/^  \S/.test(line)) {
      inPackage = line === quotedKey || line === plainKey;
      continue;
    }
    if (!inPackage) continue;

    const match = line.match(new RegExp(`^      ${dependency}: (.+)$`));
    if (match) return match[1];
  }

  return undefined;
}

test('undici lock topology follows supported consumer ranges', async () => {
  const lockfile = await readFile('pnpm-lock.yaml', 'utf8');

  expect(snapshotDependency(lockfile, 'jsdom@29.1.1(@noble/hashes@2.2.0)', 'undici'))
    .toBe('7.28.0');
  expect(snapshotDependency(lockfile, '@electron/get@5.0.0', 'undici'))
    .toBe('7.28.0');
  expect(snapshotDependency(lockfile, 'node-gyp@12.3.0', 'undici'))
    .toBe('6.27.0');
});

test('package store and compiler policy is strict', async () => {
  const npmrc = await readFile('.npmrc', 'utf8');
  expect(npmrc).toContain('registry=https://registry.npmjs.org');
  expect(npmrc).toContain('strictStorePkgContentCheck=true');
  expect(npmrc).toContain('verifyStoreIntegrity=true');
  expect(npmrc).toContain('strict-peer-dependencies=true');
  expect(npmrc).toContain('auto-install-peers=false');
  expect(npmrc).toContain('prefer-frozen-lockfile=true');
  expect(npmrc).toContain('engine-strict=true');
  expect(npmrc).toContain('save-exact=true');
  expect(npmrc).not.toContain('resolution-mode=highest');

  await expect(access('.babelrc')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access('next.config.ts')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access('next.config.mjs')).resolves.toBeUndefined();
});
