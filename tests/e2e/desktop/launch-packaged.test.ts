import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  resolvePackagedExecutable,
  validateMainProcessStderr,
} from './launch-packaged';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'desktop-launch-contract-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test('resolves the one macOS executable and fails closed for ambiguity', async () => {
  const root = await temporaryRoot();
  const executable = path.join(
    root,
    'release',
    'mac',
    'Cable Report Generator.app',
    'Contents',
    'MacOS',
    'Cable Report Generator',
  );
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');

  await expect(resolvePackagedExecutable(root, 'darwin')).resolves.toBe(executable);

  const second = executable.replace(`${path.sep}mac${path.sep}`, `${path.sep}mac-arm64${path.sep}`);
  await mkdir(path.dirname(second), { recursive: true });
  await writeFile(second, 'fixture');
  await expect(resolvePackagedExecutable(root, 'darwin')).rejects.toThrow(/exactly one/i);
});

test('resolves only the fixed Windows unpacked executable', async () => {
  const root = await temporaryRoot();
  const executable = path.join(
    root,
    'release',
    'win-unpacked',
    'Cable Report Generator.exe',
  );
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');

  await expect(resolvePackagedExecutable(root, 'win32')).resolves.toBe(executable);
  await expect(resolvePackagedExecutable(root, 'linux')).rejects.toThrow(/unsupported/i);
});

test('main-process stderr validation catches only release-fatal diagnostics', () => {
  expect(() => validateMainProcessStderr('Ready in 0ms\n')).not.toThrow();
  expect(() => validateMainProcessStderr('UnhandledPromiseRejection: boom')).toThrow(
    /unhandled/i,
  );
  expect(() => validateMainProcessStderr('uncaught exception: boom')).toThrow(/uncaught/i);
  expect(() => validateMainProcessStderr('Error: 本地服务启动超时')).toThrow(/启动/);
});
