import path from 'node:path';

import { expect, test } from 'vitest';

import { setupCiPython } from '../../scripts/setup-ci-python.mjs';

test('CI Python setup installs, verifies, and exports the exact managed interpreter', () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exports: Array<{ file: string; value: string }> = [];
  const reports: string[] = [];
  const pythonPath = path.join(path.parse(process.cwd()).root, 'managed-python', 'bin', 'python');

  setupCiPython({
    version: '3.12.13',
    githubPath: 'github-path',
    run(command: string, args: string[]) {
      calls.push({ command, args });
      if (command === 'uv' && args[0] === 'python' && args[1] === 'find') {
        return `${pythonPath}\n`;
      }
      if (command === pythonPath) return 'Python 3.12.13\n';
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
  ]);
  expect(exports).toEqual([
    { file: 'github-path', value: `${path.dirname(pythonPath)}\n` },
  ]);
  expect(reports).toEqual([`Python 3.12.13 -> ${pythonPath}\n`]);
});

test('CI Python setup rejects an interpreter that does not match the requested patch', () => {
  const pythonPath = path.join(path.parse(process.cwd()).root, 'managed-python', 'bin', 'python');

  expect(() => setupCiPython({
    version: '3.12.13',
    githubPath: 'github-path',
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
