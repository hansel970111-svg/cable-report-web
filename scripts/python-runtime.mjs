import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const PYTHON_VERSION_REQUIREMENT = 'Python >=3.12,<3.13';

const VERSION_PROBE =
  'import sys; sys.stdout.write(".".join(str(part) for part in sys.version_info[:3]))';

export function pythonCandidates({
  env = process.env,
  platform = process.platform,
  includePythonEnv = false,
} = {}) {
  if (env.PYTHON_CMD) {
    return [{ command: env.PYTHON_CMD, argsPrefix: [], source: 'PYTHON_CMD' }];
  }

  if (includePythonEnv && env.PYTHON) {
    return [{ command: env.PYTHON, argsPrefix: [], source: 'PYTHON' }];
  }

  return platform === 'win32'
    ? [
        { command: 'python', argsPrefix: [] },
        { command: 'py', argsPrefix: ['-3.12'] },
      ]
    : [
        { command: 'python3', argsPrefix: [] },
        { command: 'python3.12', argsPrefix: [] },
        { command: 'python', argsPrefix: [] },
      ];
}

function parseVersion(stdout) {
  const match = String(stdout ?? '')
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) return null;

  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    text: `${major}.${minor}.${patch}`,
  };
}

function isSupportedVersion(version) {
  return version.major === 3 && version.minor === 12;
}

export function findCompatiblePython({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  includePythonEnv = false,
  spawn = spawnSync,
} = {}) {
  const attempts = [];

  for (const candidate of pythonCandidates({ env, platform, includePythonEnv })) {
    const result = spawn(
      candidate.command,
      [...candidate.argsPrefix, '-c', VERSION_PROBE],
      {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      },
    );

    if (result.error) {
      attempts.push({ candidate, error: result.error.message });
      continue;
    }

    if (result.status !== 0) {
      attempts.push({
        candidate,
        error: String(result.stderr ?? '').trim() || `exited with status ${result.status}`,
      });
      continue;
    }

    const version = parseVersion(result.stdout);
    if (!version) {
      attempts.push({ candidate, error: 'did not report a valid Python version' });
      continue;
    }

    attempts.push({ candidate, version });
    if (isSupportedVersion(version)) {
      return { python: candidate, attempts };
    }
  }

  return { python: null, attempts };
}

export function formatPythonSelectionError(selection) {
  const explicitAttempt = selection.attempts.find(
    ({ candidate }) => candidate.source === 'PYTHON_CMD' || candidate.source === 'PYTHON',
  );

  if (explicitAttempt) {
    const setting = explicitAttempt.candidate.source;
    const command = explicitAttempt.candidate.command;
    if (explicitAttempt.version) {
      return `${setting} (${command}) reports Python ${explicitAttempt.version.text}; ${PYTHON_VERSION_REQUIREMENT} is required.`;
    }

    return `${setting} (${command}) could not be used: ${explicitAttempt.error}; ${PYTHON_VERSION_REQUIREMENT} is required.`;
  }

  const rejectedVersions = selection.attempts
    .filter(({ version }) => version)
    .map(({ candidate, version }) => `${candidate.command}=${version.text}`)
    .join(', ');
  const suffix = rejectedVersions ? ` Rejected candidates: ${rejectedVersions}.` : '';

  return `${PYTHON_VERSION_REQUIREMENT} was not found; install Python 3.12 or set PYTHON_CMD.${suffix}`;
}
