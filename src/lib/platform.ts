/**
 * 跨平台兼容工具函数
 * 支持 macOS, Windows, Linux
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

function getElectronResourcesPath(): string | null {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || null;
}

export function getAppRoot(): string {
  return process.env.COZE_WORKSPACE_PATH || process.cwd();
}

function getResourcesRoot(): string {
  return (
    process.env.CABLE_RESOURCES_PATH ||
    getElectronResourcesPath() ||
    getAppRoot()
  );
}

export function getAppPathCandidates(...segments: string[]): string[] {
  const relativePath = path.join(...segments);
  if (path.isAbsolute(relativePath)) return [relativePath];

  const normalizedSegments = relativePath.split(path.sep);
  const firstSegment = normalizedSegments[0];
  if (
    firstSegment === 'assets' ||
    firstSegment === 'bin' ||
    firstSegment === 'worker-bin' ||
    firstSegment === 'resources'
  ) {
    const resourceSegments = firstSegment === 'resources'
      ? normalizedSegments.slice(1)
      : normalizedSegments;
    return [path.join(getResourcesRoot(), ...resourceSegments)];
  }

  return [path.join(getAppRoot(), relativePath)];
}

export function resolveAppPath(...segments: string[]): string {
  const candidates = getAppPathCandidates(...segments);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

/**
 * 获取Python命令
 * macOS/Linux: python3
 * Windows: python (通常)
 */
export function getPythonCommand(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (environment.PYTHON_CMD) return environment.PYTHON_CMD;
  if (environment.PYTHON) return environment.PYTHON;

  // Windows 通常使用 python，macOS/Linux 通常使用 python3
  return platform === 'win32' ? 'python' : 'python3';
}

export type PythonCommand = {
  command: string;
  argsPrefix: readonly string[];
};

type ResolvePythonCommandOptions = {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  isAvailable?: (command: string, argsPrefix: readonly string[]) => boolean;
};

function getPythonCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): PythonCommand[] {
  const configured = getPythonCommand(environment, platform);
  const candidates: PythonCommand[] = [{ command: configured, argsPrefix: [] }];
  const fallbacks: PythonCommand[] = platform === 'win32'
    ? [
        { command: 'python', argsPrefix: [] },
        { command: 'py', argsPrefix: ['-3'] },
      ]
    : [
        { command: 'python3', argsPrefix: [] },
        { command: 'python', argsPrefix: [] },
      ];

  for (const candidate of fallbacks) {
    const duplicate = candidates.some(existing => (
      existing.command === candidate.command &&
      existing.argsPrefix.join('\0') === candidate.argsPrefix.join('\0')
    ));
    if (!duplicate) candidates.push(candidate);
  }
  return candidates;
}

function pythonIsAvailable(
  command: string,
  argsPrefix: readonly string[],
): boolean {
  const result = spawnSync(command, [...argsPrefix, '--version'], {
    shell: false,
    stdio: 'ignore',
    timeout: 5_000,
    windowsHide: true,
  });
  return result.error === undefined && result.status === 0;
}

export function resolvePythonCommand(
  options: ResolvePythonCommandOptions = {},
): PythonCommand {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const candidates = getPythonCandidates(platform, environment);
  const isAvailable = options.isAvailable ?? pythonIsAvailable;
  return candidates.find(candidate => (
    isAvailable(candidate.command, candidate.argsPrefix)
  )) ?? candidates[0];
}

export function getPythonEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const localDeps = path.join(getAppRoot(), '.codex_pydeps');

  if (fs.existsSync(localDeps)) {
    env.PYTHONPATH = env.PYTHONPATH
      ? `${localDeps}${path.delimiter}${env.PYTHONPATH}`
      : localDeps;
  }

  return env;
}
