import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.error || result.signal || result.status === null || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`,
      { cause: result.error },
    );
  }

  return result.stdout ?? '';
}

function appendPathEntry(file, value) {
  appendFileSync(file, value);
}

function reportPath(value) {
  process.stdout.write(value);
}

export function setupCiPython({
  version,
  githubPath,
  runnerTemp,
  platform = process.platform,
  pathApi = path,
  run = runCommand,
  append = appendPathEntry,
  report = reportPath,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid exact Python version: ${version}`);
  }
  if (!githubPath) {
    throw new Error('GITHUB_PATH is required');
  }
  if (!runnerTemp) {
    throw new Error('RUNNER_TEMP is required');
  }

  run('uv', ['python', 'install', version]);
  const pythonPath = run('uv', [
    'python',
    'find',
    version,
    '--managed-python',
  ]).trim();

  if (!pathApi.isAbsolute(pythonPath)) {
    throw new Error(`uv returned a non-absolute Python path: ${pythonPath}`);
  }

  const actualVersion = run(pythonPath, ['--version']).trim();
  const expectedVersion = `Python ${version}`;
  if (actualVersion !== expectedVersion) {
    throw new Error(`expected ${expectedVersion}, received ${actualVersion || 'no version'}`);
  }

  const venvPath = pathApi.join(runnerTemp, `cable-python-${version}`);
  run(pythonPath, ['-m', 'venv', venvPath]);
  const venvPython = platform === 'win32'
    ? pathApi.join(venvPath, 'Scripts', 'python.exe')
    : pathApi.join(venvPath, 'bin', 'python');
  const venvVersion = run(venvPython, ['--version']).trim();
  if (venvVersion !== expectedVersion) {
    throw new Error(
      `expected virtual environment ${expectedVersion}, received ${venvVersion || 'no version'}`,
    );
  }

  append(githubPath, `${pathApi.dirname(venvPython)}\n`);
  report(`${expectedVersion} -> ${venvPython}\n`);
}

function main() {
  const version = process.argv[2];
  try {
    setupCiPython({
      version,
      githubPath: process.env.GITHUB_PATH,
      runnerTemp: process.env.RUNNER_TEMP,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
