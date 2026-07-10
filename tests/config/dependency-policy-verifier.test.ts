import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const verifier = resolve('scripts/verify-dependency-policy.mjs');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function runVerifier(packageJson: string, lockfile: string) {
  const directory = await mkdtemp(join(tmpdir(), 'dependency-policy-'));
  temporaryDirectories.push(directory);
  const packagePath = join(directory, 'package.json');
  const lockfilePath = join(directory, 'pnpm-lock.yaml');
  await Promise.all([
    writeFile(packagePath, packageJson),
    writeFile(lockfilePath, lockfile),
  ]);
  return execFileAsync(process.execPath, [
    verifier,
    '--package-json',
    packagePath,
    '--lockfile',
    lockfilePath,
  ]);
}

async function trustedInputs() {
  const [packageJson, lockfile] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('pnpm-lock.yaml', 'utf8'),
  ]);
  return { packageJson, lockfile };
}

test('dependency verifier accepts the trusted root importer', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  await expect(runVerifier(packageJson, lockfile)).resolves.toMatchObject({
    stderr: '',
    stdout: expect.stringContaining('Dependency policy verified'),
  });
});

test('dependency verifier rejects a direct specifier mismatch', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace('specifier: 16.2.10', 'specifier: 16.2.9');
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('next'),
  });
});

test('dependency verifier rejects a resolved exact-version mismatch', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace(
    '      zod:\n        specifier: 4.4.3\n        version: 4.4.3',
    '      zod:\n        specifier: 4.4.3\n        version: 3.25.76',
  );
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('zod resolved version mismatch'),
  });
});

test('dependency verifier rejects a redirected local tarball resolution', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace(
    'tarball: file:vendor/xlsx-0.20.3.tgz',
    'tarball: file:vendor/evil.tgz',
  );
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('xlsx tarball mismatch'),
  });
});

test('dependency verifier rejects a changed local tarball integrity', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace(
    'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==',
    'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  );
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('xlsx integrity mismatch'),
  });
});

test('dependency verifier rejects automatic peer installation', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace(
    'autoInstallPeers: false',
    'autoInstallPeers: true',
  );
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('autoInstallPeers'),
  });
});

test('dependency verifier rejects a ghost root dependency', async () => {
  const { packageJson, lockfile } = await trustedInputs();
  const tampered = lockfile.replace(
    '    dependencies:\n',
    "    dependencies:\n      '@aws-sdk/client-s3':\n        specifier: 3.0.0\n        version: 3.0.0\n",
  );
  expect(tampered).not.toBe(lockfile);

  await expect(runVerifier(packageJson, tampered)).rejects.toMatchObject({
    stderr: expect.stringContaining('@aws-sdk/client-s3'),
  });
});
