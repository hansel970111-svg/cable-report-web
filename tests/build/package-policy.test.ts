import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { getAppPathCandidates, getAppRoot } from '@/lib/platform';

const root = path.resolve(import.meta.dirname, '../..');
const fixtures: string[] = [];
const originalEnvironment = { ...process.env };

function fixture(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  fixtures.push(directory);
  return directory;
}

function runScript(script: string, args: string[], workspace: string) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: workspace,
    env: { ...process.env, COZE_WORKSPACE_PATH: workspace },
    encoding: 'utf8',
    shell: false,
  });
}

function collectSymlinks(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const links: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const candidate = path.join(directory, name);
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      links.push(candidate);
    } else if (stats.isDirectory()) {
      links.push(...collectSymlinks(candidate));
    }
  }
  return links;
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Electron Builder uses the exact minimal ASAR graph', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  expect(packageJson.version).toBe('0.1.1');
  expect(packageJson.devDependencies['@electron/asar']).toBe('3.4.1');
  expect(packageJson.build.extends).toBe('./electron-builder.config.mjs');
  expect(packageJson.build.asar).toBe(true);
  expect(packageJson.build.files).toEqual([
    'electron/**/*',
    'scripts/versioning.mjs',
    'next-build/standalone/**/*',
    'package.json',
    'next.config.mjs',
  ]);
  expect(packageJson.build.extraResources).toEqual([
    {
      from: 'assets',
      to: 'assets',
      filter: [
        'M138-DE46-OOB-Cat5e.pdf',
        'M138-DE46-D-P-cross-LC.pdf',
        'M138-DE46-P-A-MPO.pdf',
      ],
    },
    { from: 'worker-bin', to: 'bin', filter: ['pdf_worker*'] },
  ]);
  expect(packageJson.build).not.toHaveProperty('afterPack');
  expect(packageJson.build).not.toHaveProperty('asarUnpack');
});

test('packaged runtime keeps application and external resource roots separate', () => {
  const appRoot = '/Applications/Cable.app/Contents/Resources/app.asar';
  const resourcesRoot = '/Applications/Cable.app/Contents/Resources';
  process.env.COZE_WORKSPACE_PATH = appRoot;
  process.env.CABLE_RESOURCES_PATH = resourcesRoot;

  expect(getAppRoot()).toBe(appRoot);
  expect(getAppPathCandidates('scripts', 'versioning.mjs')).toEqual([
    path.join(appRoot, 'scripts', 'versioning.mjs'),
  ]);
  expect(getAppPathCandidates('assets', 'M138-DE46-P-A-MPO.pdf')).toEqual([
    path.join(resourcesRoot, 'assets', 'M138-DE46-P-A-MPO.pdf'),
  ]);
  expect(getAppPathCandidates('bin', 'pdf_worker')).toEqual([
    path.join(resourcesRoot, 'bin', 'pdf_worker'),
  ]);

  const candidates = getAppPathCandidates('assets', 'M138-DE46-P-A-MPO.pdf')
    .join('\n')
    .replaceAll('\\', '/');
  expect(candidates).not.toContain('resources/app');
  expect(candidates).not.toContain('app.asar.unpacked');
});

test('packaged runtime routes normalized single-string resource paths externally', () => {
  const appRoot = '/Applications/Cable.app/Contents/Resources/app.asar';
  const resourcesRoot = '/Applications/Cable.app/Contents/Resources';
  process.env.COZE_WORKSPACE_PATH = appRoot;
  process.env.CABLE_RESOURCES_PATH = resourcesRoot;

  expect(getAppPathCandidates('assets/M138-DE46-P-A-MPO.pdf')).toEqual([
    path.join(resourcesRoot, 'assets', 'M138-DE46-P-A-MPO.pdf'),
  ]);
  expect(getAppPathCandidates('bin/pdf_worker')).toEqual([
    path.join(resourcesRoot, 'bin', 'pdf_worker'),
  ]);
  expect(getAppPathCandidates('resources/bin/pdf_worker')).toEqual([
    path.join(resourcesRoot, 'bin', 'pdf_worker'),
  ]);

  const absolutePath = path.resolve('/tmp/cable-template.pdf');
  expect(getAppPathCandidates(absolutePath)).toEqual([absolutePath]);
});

test('development runtime uses the project root for code and resources', () => {
  const appRoot = '/workspace/cable-report';
  process.env.COZE_WORKSPACE_PATH = appRoot;
  process.env.CABLE_RESOURCES_PATH = appRoot;

  expect(getAppRoot()).toBe(appRoot);
  expect(getAppPathCandidates('scripts', 'pdf_editor.py')).toEqual([
    path.join(appRoot, 'scripts', 'pdf_editor.py'),
  ]);
  expect(getAppPathCandidates('worker-bin', 'pdf_worker')).toEqual([
    path.join(appRoot, 'worker-bin', 'pdf_worker'),
  ]);
  expect(getAppPathCandidates('assets', 'M138-DE46-P-A-MPO.pdf')).toEqual([
    path.join(appRoot, 'assets', 'M138-DE46-P-A-MPO.pdf'),
  ]);
});

test('Electron starts standalone code inside ASAR without changing into the archive', () => {
  const source = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');

  expect(source).toContain('const appRoot = app.getAppPath();');
  expect(source).toContain(
    'const resourcesRoot = app.isPackaged ? process.resourcesPath : appRoot;',
  );
  expect(source).toContain('process.env.COZE_WORKSPACE_PATH = appRoot;');
  expect(source).toContain('process.env.CABLE_RESOURCES_PATH = resourcesRoot;');
  expect(source).toContain("path.join(appRoot, 'next-build', 'standalone', 'server.js')");
  expect(source).not.toContain("path.join(process.resourcesPath, 'app')");
  expect(source).toMatch(/if \(!app\.isPackaged\) \{\s*process\.chdir\(appRoot\);\s*\}/);
});

test('package verifier is ASAR-native and fail-closed', () => {
  const source = readFileSync(path.join(root, 'scripts/verify-desktop-package.mjs'), 'utf8');

  expect(source).toContain("import { extractFile, getRawHeader, listPackage } from '@electron/asar';");
  expect(source).toContain("path.join(resourcesDir, 'app.asar')");
  expect(source).toContain('listPackage(appAsarPath)');
  expect(source).toContain("'electron/main.cjs'");
  expect(source).toContain("'electron/preload.cjs'");
  expect(source).toContain("'electron/standalone-runtime.cjs'");
  expect(source).toContain("'scripts/versioning.mjs'");
  expect(source).toContain("'next-build/standalone/server.js'");
  expect(source).toContain("'next-build/standalone/next-build/static'");
  expect(source).toContain('ASAR standalone dependency tree contains symlink');
  expect(source).not.toContain("path.join(resourcesDir, 'app',");
});

describe('standalone dependency materialization', () => {
  function createStandaloneFixture(): {
    workspace: string;
    standalone: string;
    nodeModules: string;
  } {
    const workspace = fixture('standalone-materialization-');
    const standalone = path.join(workspace, 'next-build', 'standalone');
    const nodeModules = path.join(standalone, 'node_modules');
    const store = path.join(nodeModules, '.pnpm');
    const packageDir = path.join(store, 'next@1.0.0', 'node_modules', 'next');
    const dependencyDir = path.join(
      store,
      '@swc+helpers@1.0.0',
      'node_modules',
      '@swc',
      'helpers',
    );
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(dependencyDir, { recursive: true });
    writeFileSync(path.join(store, 'shared-runtime.js'), 'module.exports = "shared";\n');
    writeFileSync(path.join(packageDir, 'package.json'), '{"name":"next","main":"index.js"}\n');
    writeFileSync(
      path.join(packageDir, 'index.js'),
      'module.exports = require.resolve("@swc/helpers/_/_interop_require_default");\n',
    );
    writeFileSync(
      path.join(dependencyDir, 'package.json'),
      '{"name":"@swc/helpers","exports":{"./_/_interop_require_default":"./cjs/_interop_require_default.cjs"}}\n',
    );
    mkdirSync(path.join(dependencyDir, 'cjs'), { recursive: true });
    writeFileSync(
      path.join(dependencyDir, 'cjs', '_interop_require_default.cjs'),
      'module.exports = function interop() {};\n',
    );
    symlinkSync('../../../shared-runtime.js', path.join(packageDir, 'runtime.js'));
    mkdirSync(path.join(store, 'next@1.0.0', 'node_modules', '@swc'), { recursive: true });
    symlinkSync(
      '../../../@swc+helpers@1.0.0/node_modules/@swc/helpers',
      path.join(store, 'next@1.0.0', 'node_modules', '@swc', 'helpers'),
      'dir',
    );
    symlinkSync('.pnpm/next@1.0.0/node_modules/next', path.join(nodeModules, 'next'), 'dir');
    return { workspace, standalone, nodeModules };
  }

  test('replaces root and nested file/directory links with real inputs', () => {
    const { workspace, standalone, nodeModules } = createStandaloneFixture();

    const result = runScript(
      'build.mjs',
      ['--materialize-standalone-runtime', standalone],
      workspace,
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(collectSymlinks(nodeModules)).toEqual([]);
    expect(lstatSync(path.join(nodeModules, 'next')).isDirectory()).toBe(true);
    expect(lstatSync(path.join(nodeModules, 'next', 'runtime.js')).isFile()).toBe(true);
    expect(readFileSync(path.join(nodeModules, 'next', 'runtime.js'), 'utf8')).toContain('shared');
    expect(lstatSync(path.join(nodeModules, '@swc', 'helpers')).isDirectory()).toBe(true);
    const requireResult = spawnSync(
      process.execPath,
      [
        '-e',
        'require("node:module").createRequire(process.argv[1]).resolve("@swc/helpers/_/_interop_require_default")',
        path.join(nodeModules, 'next', 'index.js'),
      ],
      { encoding: 'utf8' },
    );
    expect(requireResult.status, requireResult.stderr).toBe(0);
    expect(result.stdout).toContain('Materialized 3 standalone dependency symlinks.');
  });

  test.each([
    ['dangling', '.pnpm/missing@1.0.0/node_modules/missing', /Dangling/],
    ['out-of-tree', '../../../outside-package', /Out-of-tree/],
  ])('fails closed for a %s dependency link without owned temp residue', (_label, target, errorPattern) => {
    const { workspace, standalone, nodeModules } = createStandaloneFixture();
    writeFileSync(path.join(workspace, 'outside-package'), 'outside\n');
    symlinkSync(target, path.join(nodeModules, 'invalid-link'));

    const result = runScript(
      'build.mjs',
      ['--materialize-standalone-runtime', standalone],
      workspace,
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(errorPattern);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/standalone dependency symlink/i);
    expect(
      readdirSync(nodeModules, { recursive: true }).filter(name => (
        String(name).includes('.codex-materialize-')
      )),
    ).toEqual([]);
    expect(collectSymlinks(nodeModules).length).toBeGreaterThan(0);
  });

  test.each([
    ['logical alias', 'alias-package', 'real-package', /alias/i],
    ['conflicting target', '@swc/helpers', '@swc/helpers', /conflict/i],
  ])('rejects a %s before replacement and cleans owned temps', (_label, logicalName, packageName, errorPattern) => {
    const { workspace, standalone, nodeModules } = createStandaloneFixture();
    const store = path.join(nodeModules, '.pnpm');
    const conflictDir = path.join(store, 'conflict@1.0.0', 'node_modules', 'conflict');
    const consumerModules = path.join(store, 'consumer@1.0.0', 'node_modules');
    mkdirSync(conflictDir, { recursive: true });
    mkdirSync(consumerModules, { recursive: true });
    writeFileSync(path.join(conflictDir, 'package.json'), JSON.stringify({ name: packageName }));
    const logicalParts = logicalName.split('/');
    const linkPath = path.join(consumerModules, ...logicalParts);
    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(
      path.relative(path.dirname(linkPath), conflictDir),
      linkPath,
      'dir',
    );

    const result = runScript(
      'build.mjs',
      ['--materialize-standalone-runtime', standalone],
      workspace,
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(errorPattern);
    expect(
      readdirSync(nodeModules, { recursive: true }).filter(name => (
        String(name).includes('.codex-materialize-')
      )),
    ).toEqual([]);
    expect(collectSymlinks(nodeModules).length).toBeGreaterThan(0);
  });
});

test('package-size policy exports exact budgets and hard-fails oversized mac apps', () => {
  const scriptPath = path.join(root, 'scripts/check-package-size.mjs');
  expect(existsSync(scriptPath)).toBe(true);
  if (!existsSync(scriptPath)) return;

  const source = readFileSync(scriptPath, 'utf8');
  expect(source).toContain('export const BASELINE_APP_BYTES = 857_735_168;');
  expect(source).toContain('export const MAX_APP_BYTES = 643_301_376;');

  const workspace = fixture('package-size-');
  const appDir = path.join(workspace, 'release', 'mac', 'Cable Report Generator.app');
  mkdirSync(path.join(appDir, 'Contents'), { recursive: true });
  const oversized = path.join(appDir, 'Contents', 'oversized.bin');
  writeFileSync(oversized, '');
  truncateSync(oversized, 643_301_377);

  const result = runScript('check-package-size.mjs', ['mac'], workspace);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('643301377');
  expect(result.stderr).toContain('exceeds macOS package budget');
  expect(result.stdout).toContain('Ten largest paths');
});

describe('macOS package candidate selection', () => {
  function createMultipleMacAppFixture(): {
    workspace: string;
    macApp: string;
    armApp: string;
  } {
    const workspace = fixture('multiple-mac-apps-');
    const macApp = path.join(
      workspace,
      'release',
      'mac',
      'Cable Report Generator.app',
    );
    const armApp = path.join(
      workspace,
      'release',
      'mac-arm64',
      'Cable Report Generator.app',
    );
    mkdirSync(path.join(macApp, 'Contents'), { recursive: true });
    mkdirSync(path.join(armApp, 'Contents'), { recursive: true });
    return { workspace, macApp, armApp };
  }

  test('desktop verifier rejects multiple macOS app candidates', () => {
    const { workspace, macApp, armApp } = createMultipleMacAppFixture();

    const result = runScript('verify-desktop-package.mjs', ['mac'], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected exactly one macOS .app candidate');
    expect(result.stderr).toContain(macApp);
    expect(result.stderr).toContain(armApp);
  });

  test('package-size check rejects multiple macOS app candidates', () => {
    const { workspace, macApp, armApp } = createMultipleMacAppFixture();

    const result = runScript('check-package-size.mjs', ['mac'], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected exactly one macOS .app candidate');
    expect(result.stderr).toContain(macApp);
    expect(result.stderr).toContain(armApp);
  });
});

describe('build-input policy', () => {
  function createBuildInputFixture(): string {
    const workspace = fixture('build-inputs-');
    mkdirSync(path.join(workspace, 'src'), { recursive: true });
    writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        build: {
          files: [
            'electron/**/*',
            'scripts/versioning.mjs',
            'next-build/standalone/**/*',
            'package.json',
            'next.config.mjs',
          ],
        },
      }),
    );
    writeFileSync(
      path.join(workspace, '.dockerignore'),
      [
        'next-build',
        'worker-bin',
        'release',
        '.pyinstaller',
        '.superpowers',
        'docs/superpowers/plans',
        'tests/python/golden',
        '',
      ].join('\n'),
    );
    writeFileSync(path.join(workspace, 'src', 'tracked.ts'), 'export {};\n');
    spawnSync('git', ['init', '-q'], { cwd: workspace });
    spawnSync(
      'git',
      ['add', '--', 'package.json', '.dockerignore', 'src/tracked.ts'],
      { cwd: workspace },
    );
    return workspace;
  }

  test('enumerates Git-index/config inputs without touching untracked files', () => {
    const workspace = createBuildInputFixture();
    writeFileSync(
      path.join(workspace, 'src', 'untracked-secret.ts'),
      'physical-untracked-sentinel',
    );

    const result = runScript('verify-build-inputs.mjs', [], workspace);

    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain('physical-untracked-sentinel');
  });

  test('rejects forbidden platform output only when a manifest supplies it', () => {
    const workspace = createBuildInputFixture();
    const manifest = path.join(workspace, 'context-manifest.json');
    writeFileSync(
      manifest,
      JSON.stringify([
        {
          path: 'worker-bin/pdf_worker',
          format: 'Mach-O 64-bit executable',
          tracked: false,
        },
      ]),
    );

    const result = runScript('verify-build-inputs.mjs', ['--manifest', manifest], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('forbidden manifest entry');
    expect(result.stderr).toContain('worker-bin/pdf_worker');
  });

  test('rejects the protected path from an explicit manifest string', () => {
    const workspace = createBuildInputFixture();
    const manifest = path.join(workspace, 'context-manifest.json');
    writeFileSync(
      manifest,
      JSON.stringify(['src/app/api/upload-excel/route 2.ts']),
    );

    const result = runScript('verify-build-inputs.mjs', ['--manifest', manifest], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('protected input');
    expect(result.stderr).toContain('src/app/api/upload-excel/route 2.ts');
  });

  test('rejects the protected path from package build files', () => {
    const workspace = createBuildInputFixture();
    const packagePath = path.join(workspace, 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.build.files.push('src/app/api/upload-excel/route 2.ts');
    writeFileSync(packagePath, JSON.stringify(packageJson));

    const result = runScript('verify-build-inputs.mjs', [], workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('protected input');
    expect(result.stderr).toContain('src/app/api/upload-excel/route 2.ts');
  });
});

test('Docker excludes every local build and platform output', () => {
  const ignored = new Set(
    readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).filter(Boolean),
  );

  for (const entry of [
    'next-build',
    'worker-bin',
    'release',
    '.pyinstaller',
    '.superpowers',
    'docs/superpowers/plans',
    'tests/python/golden',
  ]) {
    expect(ignored.has(entry), `missing ${entry}`).toBe(true);
  }
});

test('quality workflow runs the fixed PR gates in exact order', () => {
  const workflowPath = path.join(root, '.github/workflows/quality.yml');
  expect(existsSync(workflowPath)).toBe(true);
  if (!existsSync(workflowPath)) return;
  const workflow = readFileSync(workflowPath, 'utf8');
  const commands = [
    'node scripts/setup-ci-python.mjs 3.12.13',
    'corepack pnpm@9.15.9 install --frozen-lockfile',
    'python -m pip install --require-hashes -r requirements-dev.lock',
    'corepack pnpm@9.15.9 lint',
    'corepack pnpm@9.15.9 ts-check',
    'corepack pnpm@9.15.9 test:unit',
    'python -m pytest -q',
    'corepack pnpm@9.15.9 audit --prod --audit-level high --registry=https://registry.npmjs.org',
    'corepack pnpm@9.15.9 build',
    'node scripts/verify-build-inputs.mjs',
  ];
  const positions = commands.map(command => workflow.indexOf(`run: ${command}`));

  expect(workflow).toContain('pull_request:');
  expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
  expect(workflow).toContain(
    'uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0',
  );
  expect(workflow).toContain('version: "0.11.28"');
  expect(workflow).not.toContain('actions/setup-python');
  expect(workflow).not.toMatch(/^\s*- run: pnpm /m);
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
});

test('Windows CI is read-only and has one desktop build entry', () => {
  const workflow = readFileSync(
    path.join(root, '.github/workflows/build-windows-exe.yml'),
    'utf8',
  );

  expect(workflow).toMatch(/permissions:\s+contents: read/);
  expect(workflow).toContain(
    'uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0',
  );
  expect(workflow).toContain('node scripts/setup-ci-python.mjs 3.12.13');
  expect(workflow).toContain('corepack pnpm@9.15.9 install --frozen-lockfile');
  expect(workflow).toContain(
    'python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock',
  );
  expect(workflow.match(/corepack pnpm@9\.15\.9 desktop:dist:win/g)).toHaveLength(1);
  expect(workflow).not.toContain('corepack pnpm@9.15.9 build');
  expect(workflow).not.toContain('build-python-workers.mjs');
  expect(workflow).not.toContain('electron-builder --win');
  expect(workflow).not.toContain('softprops/action-gh-release');
});

test('desktop distribution fails closed for errors, signals, and null status', () => {
  const source = readFileSync(path.join(root, 'scripts/desktop-dist.mjs'), 'utf8');

  expect(source).toContain('if (result.error || result.signal || result.status === null)');
  expect(source).toContain('process.exit(1);');
});
