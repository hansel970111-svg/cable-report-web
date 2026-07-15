import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import nextConfig from '../../next.config.mjs';

test('Next output tracing is rooted at this checkout', () => {
  expect(resolve(nextConfig.outputFileTracingRoot!)).toBe(resolve('.'));
});

test('container installs the vendored Node 24 baseline from the frozen lock', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  expect(dockerfile).toMatch(
    /^FROM python:3\.12\.13-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b AS python-runtime$/m,
  );
  expect(dockerfile).toMatch(
    /^FROM node:24\.14\.0-bookworm@sha256:5a593d74b632d1c6f816457477b6819760e13624455d587eef0fa418c8d0777b$/m,
  );
  expect(dockerfile).toContain('COPY --from=python-runtime /usr/local /usr/local');
  expect(dockerfile).toContain('corepack prepare pnpm@9.15.9 --activate');
  expect(dockerfile).toContain('corepack pnpm install --frozen-lockfile');
  expect(dockerfile).toContain('COPY requirements.lock ./');
  expect(dockerfile).toContain(
    'pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock',
  );
  expect(dockerfile).not.toContain('pip install --no-cache-dir -r requirements.txt');

  const vendorCopy = dockerfile.indexOf(
    'COPY vendor/xlsx-0.20.3.tgz ./vendor/xlsx-0.20.3.tgz',
  );
  const install = dockerfile.indexOf('corepack pnpm install --frozen-lockfile');
  expect(vendorCopy).toBeGreaterThan(-1);
  expect(vendorCopy).toBeLessThan(install);
});

test('Windows build uses the same Node, pnpm, and frozen lock baseline', async () => {
  const workflow = await readFile('.github/workflows/build-windows-exe.yml', 'utf8');
  expect(workflow).toContain('runs-on: windows-2025');
  expect(workflow).toContain('node-version: "24.14.0"');
  expect(workflow).toContain(
    'uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0',
  );
  expect(workflow).toContain('version: "0.11.28"');
  expect(workflow).toContain('node scripts/setup-ci-python.mjs 3.12.13');
  expect(workflow).toContain('corepack pnpm@9.15.9 install --frozen-lockfile');
  expect(workflow).not.toContain('actions/setup-python');
  expect(workflow).toContain(
    'python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock',
  );
  expect(workflow).not.toContain('python -m pip install -r requirements.txt');
  expect(workflow).toContain('node scripts/verify-dependency-policy.mjs');
  expect(workflow).toContain('python scripts/verify_python_locks.py');
  expect(workflow).toContain(
    'corepack pnpm@11.4.0 --pm-on-fail=ignore audit --audit-level high --registry=https://registry.npmjs.org',
  );
  expect(workflow).toContain('corepack pnpm@9.15.9 check:fast');
  expect(workflow).toContain('corepack pnpm@9.15.9 test:python');
  expect(workflow).toContain('corepack pnpm@9.15.9 desktop:dist:win');
  expect(workflow).not.toContain('corepack pnpm@9.15.9 build');
  expect(workflow).not.toContain('corepack pnpm@9.15.9 exec electron-builder');

  const dependencyGate = workflow.indexOf('node scripts/verify-dependency-policy.mjs');
  const build = workflow.indexOf('corepack pnpm@9.15.9 desktop:dist:win');
  expect(dependencyGate).toBeGreaterThan(-1);
  expect(dependencyGate).toBeLessThan(build);

  const documentation = await readFile('WINDOWS.md', 'utf8');
  expect(documentation).toContain('Node.js 24');
  expect(documentation).toContain('Python 3.12');
  expect(documentation).toContain('pnpm@9.15.9');
  expect(documentation).toContain('install --frozen-lockfile');
  expect(documentation).toContain(
    'pip install --require-hashes --only-binary=:all: -r requirements-dev.lock',
  );
});

test('local build entrypoints never fall back to a mutable Node install', async () => {
  const [
    buildModule,
    buildPythonWorkers,
    buildShell,
    devModule,
    devShell,
    prepareShell,
  ] = await Promise.all([
    readFile('scripts/build.mjs', 'utf8'),
    readFile('scripts/build-python-workers.mjs', 'utf8'),
    readFile('scripts/build.sh', 'utf8'),
    readFile('scripts/dev.mjs', 'utf8'),
    readFile('scripts/dev.sh', 'utf8'),
    readFile('scripts/prepare.sh', 'utf8'),
  ]);

  expect(buildModule).toContain("'--frozen-lockfile'");
  expect(buildModule).not.toContain("'--prefer-frozen-lockfile'");
  expect(buildModule).not.toContain('skipping install');
  expect(buildModule).toContain("run(commandName('corepack'), ['pnpm', ...args])");
  expect(buildModule).not.toContain("runRaw(commandName('pnpm'), args)");
  expect(buildShell).toContain('install --frozen-lockfile');
  expect(buildShell).not.toContain('install --prefer-frozen-lockfile');
  expect(buildShell).toContain('corepack pnpm install');
  expect(buildShell).not.toMatch(/^pnpm /m);
  expect(devModule).toContain('spawnDevServer');
  expect(devModule).not.toContain("command: commandName('pnpm')");
  expect(devShell).toContain('corepack pnpm tsx watch');
  expect(devShell).not.toContain('PORT=$PORT pnpm tsx watch');
  expect(prepareShell).toContain('install --frozen-lockfile');
  expect(prepareShell).not.toContain('install --prefer-frozen-lockfile');
  expect(prepareShell).toContain('corepack pnpm install');
  expect(prepareShell).not.toMatch(/^pnpm /m);
  expect(prepareShell).toContain(
    'pip install --require-hashes --only-binary=:all: -r requirements-dev.lock',
  );
  expect(prepareShell).toContain('node ./scripts/run-python.mjs -m pip install');
  expect(prepareShell).not.toContain('${PYTHON_CMD:-python3}');
  expect(prepareShell).not.toContain('pip install --quiet --break-system-packages');
  expect(buildPythonWorkers).toContain('requirements-dev.lock');
  expect(buildPythonWorkers).toContain('--require-hashes');
  expect(buildPythonWorkers).not.toContain('pip install pyinstaller -r requirements.txt');
});

test('packaging documentation only installs the trusted Python lock', async () => {
  const packaging = await readFile('PACKAGING.md', 'utf8');
  expect(packaging).toContain('Python 3.12');
  expect(packaging).toContain(
    'pip install --require-hashes --only-binary=:all: -r requirements-dev.lock',
  );
  expect(packaging).not.toContain('pip install -r requirements.txt');
});
