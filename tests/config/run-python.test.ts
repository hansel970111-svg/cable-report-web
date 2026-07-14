import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { expect, test } from 'vitest';

import {
  findCompatiblePython,
  pythonCandidates,
} from '../../scripts/python-runtime.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const runPythonScript = join(repositoryRoot, 'scripts', 'run-python.mjs');
const buildWorkersScript = join(repositoryRoot, 'scripts', 'build-python-workers.mjs');

test('Windows fallback is pinned to the Python 3.12 launcher', () => {
  expect(
    pythonCandidates({ env: { NODE_ENV: 'test' }, platform: 'win32' }),
  ).toEqual([
    { command: 'python', argsPrefix: [] },
    { command: 'py', argsPrefix: ['-3.12'] },
  ]);
});

test('POSIX fallback explicitly probes the Python 3.12 executable', () => {
  expect(
    pythonCandidates({ env: { NODE_ENV: 'test' }, platform: 'linux' }),
  ).toEqual([
    { command: 'python3', argsPrefix: [] },
    { command: 'python3.12', argsPrefix: [] },
    { command: 'python', argsPrefix: [] },
  ]);
});

type Invocation = {
  name: string;
  kind: 'probe' | 'run';
  args: string[];
};

async function writeFakePython(
  directory: string,
  name: string,
  version: string,
): Promise<string> {
  const executable = join(directory, name);
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const isProbe = args[0] === '-c';
fs.appendFileSync(
  process.env.PYTHON_TEST_LOG,
  JSON.stringify({ name: ${JSON.stringify(name)}, kind: isProbe ? 'probe' : 'run', args }) + '\\n',
);
if (isProbe) {
  process.stdout.write(${JSON.stringify(version)});
  process.exit(0);
}
process.stdout.write(${JSON.stringify(`ran:${name}\n`)});
`;

  await writeFile(executable, source, 'utf8');
  await chmod(executable, 0o755);
  return executable;
}

async function readInvocations(logPath: string): Promise<Invocation[]> {
  const contents = await readFile(logPath, 'utf8');
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Invocation);
}

function hostPythonCommand(): string {
  return process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
}

async function writePythonVersionOverride(directory: string, version: string): Promise<void> {
  const [major, minor, patch] = version.split('.').map(Number);
  await writeFile(
    join(directory, 'sitecustomize.py'),
    `import sys\nsys.version_info = (${major}, ${minor}, ${patch})\n`,
    'utf8',
  );
}

function withPythonVersionOverride(
  directory: string,
  values: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...values,
    PYTHONPATH: `${directory}${delimiter}${values.PYTHONPATH ?? ''}`,
  };
}

test(
  'skips an old first candidate and selects the next Python 3.12 candidate',
  async () => {
    if (process.platform === 'win32') {
      const probes: string[] = [];
      const selection = findCompatiblePython({
        env: { NODE_ENV: 'test' },
        platform: 'linux',
        spawn: ((command: string) => {
          probes.push(command);
          return {
            error: undefined,
            status: 0,
            stderr: '',
            stdout: command === 'python3' ? '3.11.9' : '3.12.13',
          };
        }) as typeof spawnSync,
      });

      expect(probes).toEqual(['python3', 'python3.12']);
      expect(selection.python).toMatchObject({ command: 'python3.12' });
      return;
    }

    const directory = await mkdtemp(join(tmpdir(), 'run-python-fallback-'));
    const logPath = join(directory, 'invocations.jsonl');

    try {
      await writeFakePython(directory, 'python3', '3.11.9');
      await writeFakePython(directory, 'python3.12', '3.12.13');

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        PYTHON_TEST_LOG: logPath,
      };
      delete env.PYTHON_CMD;

      const result = spawnSync(
        process.execPath,
        [runPythonScript, '--payload', 'sentinel'],
        { cwd: repositoryRoot, env, encoding: 'utf8' },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('ran:python3.12');
      expect(await readInvocations(logPath)).toEqual([
        expect.objectContaining({ name: 'python3', kind: 'probe' }),
        expect.objectContaining({ name: 'python3.12', kind: 'probe' }),
        {
          name: 'python3.12',
          kind: 'run',
          args: ['--payload', 'sentinel'],
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'rejects an explicitly configured Python older than 3.12 before running the command',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'run-python-old-explicit-'));

    try {
      await writePythonVersionOverride(directory, '3.11.9');
      const result = spawnSync(
        process.execPath,
        [runPythonScript, '--payload', 'must-not-run'],
        {
          cwd: repositoryRoot,
          env: withPythonVersionOverride(directory, {
            ...process.env,
            PYTHON_CMD: hostPythonCommand(),
          }),
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PYTHON_CMD');
      expect(result.stderr).toContain('Python >=3.12,<3.13');
      expect(result.stderr).toContain('3.11.9');
      expect(result.stdout).not.toContain('must-not-run');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'rejects Python 3.13 because the release baseline is the Python 3.12 series',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'run-python-new-explicit-'));

    try {
      await writePythonVersionOverride(directory, '3.13.0');
      const result = spawnSync(
        process.execPath,
        [runPythonScript, '--payload', 'must-not-run'],
        {
          cwd: repositoryRoot,
          env: withPythonVersionOverride(directory, {
            ...process.env,
            PYTHON_CMD: hostPythonCommand(),
          }),
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Python >=3.12,<3.13');
      expect(result.stderr).toContain('3.13.0');
      expect(result.stdout).not.toContain('must-not-run');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'worker packaging rejects an old PYTHON_CMD before checking PyInstaller',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'build-python-old-explicit-'));
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);

    try {
      await writePythonVersionOverride(directory, '3.11.9');
      const result = spawnSync(process.execPath, [buildWorkersScript], {
        cwd: repositoryRoot,
        env: withPythonVersionOverride(directory, {
          ...process.env,
          COZE_WORKSPACE_PATH: workspace,
          PYTHON_CMD: hostPythonCommand(),
        }),
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('PYTHON_CMD');
      expect(result.stderr).toContain('Python >=3.12,<3.13');
      expect(result.stderr).toContain('3.11.9');
      expect(result.stderr).not.toContain('PyInstaller is required');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
