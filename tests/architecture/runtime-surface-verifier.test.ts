import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, expect, test } from 'vitest';

const verifier = resolve('scripts/verify-runtime-surface.mjs');
const fixtures: string[] = [];

function createFixture({
  dependencies = { 'tracked-package': '1.0.0' },
  devDependencies = {},
  trackedSources = { 'src/tracked.ts': "import 'tracked-package';\n" },
  initializeGit = true,
}: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  trackedSources?: Record<string, string>;
  initializeGit?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-surface-'));
  fixtures.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies, devDependencies }),
    'utf8',
  );
  for (const [relativePath, source] of Object.entries(trackedSources)) {
    const filePath = join(root, relativePath);
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, source, 'utf8');
  }
  if (initializeGit) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '--', 'package.json', ...Object.keys(trackedSources)], {
      cwd: root,
    });
  }
  return root;
}

function runVerifier(root: string) {
  return spawnSync(process.execPath, [verifier], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('untracked production source cannot affect the runtime surface', () => {
  const root = createFixture();
  writeFileSync(join(root, 'src/untracked.ts'), "import 'untracked-sentinel';\n", 'utf8');

  const result = runVerifier(root);

  expect(result.status, result.stderr).toBe(0);
  expect(`${result.stdout}${result.stderr}`).not.toContain('untracked-sentinel');
});

test('a staged production source is scanned', () => {
  const root = createFixture();
  writeFileSync(join(root, 'src/staged.ts'), "import 'undeclared-staged';\n", 'utf8');
  execFileSync('git', ['add', '--', 'src/staged.ts'], { cwd: root });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Undeclared production imports: undeclared-staged');
});

test('a staged deletion is not scanned', () => {
  const root = createFixture({
    trackedSources: {
      'src/tracked.ts': "import 'tracked-package';\n",
      'src/deleted.ts': "import 'undeclared-deleted';\n",
    },
  });
  rmSync(join(root, 'src/deleted.ts'));
  execFileSync('git', ['add', '-u', '--', 'src/deleted.ts'], { cwd: root });

  const result = runVerifier(root);

  expect(result.status, result.stderr).toBe(0);
  expect(`${result.stdout}${result.stderr}`).not.toContain('undeclared-deleted');
});

test('Git index enumeration failure exits with a fixed error and no fallback scan', () => {
  const root = createFixture({
    dependencies: {},
    trackedSources: { 'src/untracked.ts': "import 'fallback-sentinel';\n" },
    initializeGit: false,
  });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Runtime source enumeration failed: Git index unavailable.');
  expect(`${result.stdout}${result.stderr}`).not.toContain('fallback-sentinel');
});

test('production source cannot satisfy an import from devDependencies', () => {
  const root = createFixture({
    devDependencies: { 'dev-only-package': '1.0.0' },
    trackedSources: {
      'src/tracked.ts': [
        "import 'tracked-package';",
        "import 'dev-only-package';",
        '',
      ].join('\n'),
    },
  });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Undeclared production imports: dev-only-package');
});

test('production source import passes after the package moves to dependencies', () => {
  const root = createFixture({
    dependencies: {
      'tracked-package': '1.0.0',
      'runtime-package': '1.0.0',
    },
    trackedSources: {
      'src/tracked.ts': [
        "import 'tracked-package';",
        "import 'runtime-package';",
        '',
      ].join('\n'),
    },
  });

  const result = runVerifier(root);

  expect(result.status, result.stderr).toBe(0);
});

test('a package imported only by tooling remains unused in the production surface', () => {
  const root = createFixture({
    dependencies: {
      'tracked-package': '1.0.0',
      'tool-only-package': '1.0.0',
    },
    trackedSources: {
      'src/tracked.ts': "import 'tracked-package';\n",
      'scripts/tool.mjs': "import 'tool-only-package';\n",
    },
  });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unused production dependencies: tool-only-package');
});

test('Electron is accepted only as an exactly pinned platform-provided dev dependency', () => {
  const root = createFixture({
    devDependencies: { electron: '43.1.0' },
    trackedSources: {
      'src/tracked.ts': "import 'tracked-package';\n",
      'electron/main.cjs': "const { app } = require('electron');\nvoid app;\n",
    },
  });

  const result = runVerifier(root);

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Platform-provided imports verified: electron.');
  expect(result.stdout).toContain(
    '1 covered production dependencies, 1 declared production dependencies ' +
    '(1 imported, 0 approved indirect)',
  );
});

test('Electron production import fails when the platform dependency is undeclared', () => {
  const root = createFixture({
    trackedSources: {
      'src/tracked.ts': "import 'tracked-package';\n",
      'electron/main.cjs': "require('electron');\n",
    },
  });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Invalid platform-provided import: electron must be an exact devDependency.',
  );
});

test('Electron production import fails when its dev dependency is not exact', () => {
  const root = createFixture({
    devDependencies: { electron: '^43.1.0' },
    trackedSources: {
      'src/tracked.ts': "import 'tracked-package';\n",
      'electron/main.cjs': "require('electron');\n",
    },
  });

  const result = runVerifier(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'Invalid platform-provided import: electron must be an exact devDependency.',
  );
});
