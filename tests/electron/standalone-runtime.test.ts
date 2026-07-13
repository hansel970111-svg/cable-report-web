import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

type RuntimeModule = {
  loadPackagedStandalone(standaloneServerPath: string, options: {
    loadModule(path: string): unknown;
    processObject: { chdir(path: string): void };
  }): unknown;
};

const require = createRequire(import.meta.url);
const runtimePath = path.resolve('electron/standalone-runtime.cjs');

function loadRuntime(): RuntimeModule | null {
  expect(existsSync(runtimePath)).toBe(true);
  return existsSync(runtimePath) ? require(runtimePath) as RuntimeModule : null;
}

test('packaged loader swallows only the generated standalone directory chdir', () => {
  const runtime = loadRuntime();
  if (!runtime) return;
  const originalChdir = vi.fn();
  const processObject = { chdir: originalChdir };
  const serverPath = '/Applications/Cable.app/Contents/Resources/app.asar/next-build/standalone/server.js';

  runtime.loadPackagedStandalone(serverPath, {
    processObject,
    loadModule: () => {
      processObject.chdir(
        '/Applications/Cable.app/Contents/Resources/app.asar/next-build/standalone/.',
      );
      return undefined;
    },
  });

  expect(originalChdir).not.toHaveBeenCalled();
});

test('packaged loader delegates a nonmatching chdir target', () => {
  const runtime = loadRuntime();
  if (!runtime) return;
  const originalChdir = vi.fn();
  const processObject = { chdir: originalChdir };
  const serverPath = '/Applications/Cable.app/Contents/Resources/app.asar/next-build/standalone/server.js';

  runtime.loadPackagedStandalone(serverPath, {
    processObject,
    loadModule: () => {
      processObject.chdir('/private/tmp/cable-runtime');
      return undefined;
    },
  });

  expect(originalChdir).toHaveBeenCalledExactlyOnceWith('/private/tmp/cable-runtime');
});

test('packaged loader restores process.chdir after successful require', () => {
  const runtime = loadRuntime();
  if (!runtime) return;
  const originalChdir = vi.fn();
  const processObject = { chdir: originalChdir };
  const loaded = { started: true };

  expect(runtime.loadPackagedStandalone(
    '/App/Contents/Resources/app.asar/next-build/standalone/server.js',
    {
    processObject,
    loadModule: () => loaded,
    },
  )).toBe(loaded);
  expect(processObject.chdir).toBe(originalChdir);
});

test('packaged loader restores process.chdir when require throws', () => {
  const runtime = loadRuntime();
  if (!runtime) return;
  const originalChdir = vi.fn();
  const processObject = { chdir: originalChdir };

  expect(() => runtime.loadPackagedStandalone(
    '/App/Contents/Resources/app.asar/next-build/standalone/server.js',
    {
    processObject,
    loadModule: () => {
      throw new Error('standalone load failed');
    },
    },
  )).toThrow('standalone load failed');
  expect(processObject.chdir).toBe(originalChdir);
});

test('Electron main uses the guarded loader only for packaged standalone startup', () => {
  const source = readFileSync('electron/main.cjs', 'utf8');

  expect(source).toContain("require('./standalone-runtime.cjs')");
  expect(source).toMatch(
    /if \(app\.isPackaged\) \{\s*loadPackagedStandalone\(standaloneServerPath\);\s*\} else \{\s*require\(standaloneServerPath\);\s*\}/,
  );
});
