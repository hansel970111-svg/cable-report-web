import path from 'node:path';

import { expect, test } from 'vitest';

import { setupCiPython } from '../../scripts/setup-ci-python.mjs';

test('CI Python setup installs, verifies, and exports the exact managed interpreter', () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exports: Array<{ file: string; value: string }> = [];
  const reports: string[] = [];
  const pythonPath = '/managed-python/bin/python';
  const venvPath = '/runner/cable-python-3.12.13';
  const venvPython = `${venvPath}/bin/python`;

  setupCiPython({
    version: '3.12.13',
    githubPath: 'github-path',
    runnerTemp: '/runner',
    platform: 'linux',
    pathApi: path.posix,
    run(command: string, args: string[]) {
      calls.push({ command, args });
      if (command === 'uv' && args[0] === 'python' && args[1] === 'find') {
        return `${pythonPath}\n`;
      }
      if (command === pythonPath || command === venvPython) return 'Python 3.12.13\n';
      return '';
    },
    append(file: string, value: string) {
      exports.push({ file, value });
    },
    report(value: string) {
      reports.push(value);
    },
  });

  expect(calls).toEqual([
    { command: 'uv', args: ['python', 'install', '3.12.13'] },
    { command: 'uv', args: ['python', 'find', '3.12.13', '--managed-python'] },
    { command: pythonPath, args: ['--version'] },
    { command: pythonPath, args: ['-m', 'venv', venvPath] },
    { command: venvPython, args: ['--version'] },
  ]);
  expect(exports).toEqual([
    { file: 'github-path', value: `${path.posix.dirname(venvPython)}\n` },
  ]);
  expect(reports).toEqual([`Python 3.12.13 -> ${venvPython}\n`]);
});

test('CI Python setup exports the Windows virtual-environment interpreter', () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exports: string[] = [];
  const pythonPath = 'C:\\uv\\python.exe';
  const venvPath = 'C:\\runner\\cable-python-3.12.13';
  const venvPython = `${venvPath}\\Scripts\\python.exe`;

  setupCiPython({
    version: '3.12.13',
    githubPath: 'github-path',
    runnerTemp: 'C:\\runner',
    platform: 'win32',
    pathApi: path.win32,
    run(command: string, args: string[]) {
      calls.push({ command, args });
      if (command === 'uv' && args[1] === 'find') return `${pythonPath}\n`;
      if (command === pythonPath || command === venvPython) return 'Python 3.12.13\n';
      return '';
    },
    append(_file: string, value: string) {
      exports.push(value);
    },
    report() {},
  });

  expect(calls).toContainEqual({ command: pythonPath, args: ['-m', 'venv', venvPath] });
  expect(calls).toContainEqual({ command: venvPython, args: ['--version'] });
  expect(exports).toEqual([`C:\\runner\\cable-python-3.12.13\\Scripts\n`]);
});

test('CI Python setup rejects an interpreter that does not match the requested patch', () => {
  const pythonPath = '/managed-python/bin/python';

  expect(() => setupCiPython({
    version: '3.12.13',
    githubPath: 'github-path',
    runnerTemp: '/runner',
    platform: 'linux',
    pathApi: path.posix,
    run(command: string, args: string[]) {
      if (command === 'uv' && args[0] === 'python' && args[1] === 'find') {
        return `${pythonPath}\n`;
      }
      if (command === pythonPath) return 'Python 3.12.12\n';
      return '';
    },
    append() {},
    report() {},
  })).toThrow('expected Python 3.12.13');
});
