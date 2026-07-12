/**
 * 跨平台兼容工具函数
 * 支持 macOS, Windows, Linux
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter(Boolean) as string[]));
}

function getElectronResourcesPath(): string | null {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || null;
}

function looksLikeAppRoot(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, 'package.json')) &&
    (
      fs.existsSync(path.join(dirPath, 'next.config.mjs')) ||
      fs.existsSync(path.join(dirPath, 'next-build')) ||
      fs.existsSync(path.join(dirPath, 'scripts'))
    )
  );
}

export function getAppRoot(): string {
  const resourcesPath = getElectronResourcesPath();
  const candidates = uniquePaths([
    process.env.COZE_WORKSPACE_PATH,
    process.cwd(),
    resourcesPath ? path.join(resourcesPath, 'app') : null,
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked') : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'app') : null,
  ]);

  return candidates.find(looksLikeAppRoot) || process.env.COZE_WORKSPACE_PATH || process.cwd();
}

export function getAppPathCandidates(...segments: string[]): string[] {
  const relativePath = path.join(...segments);
  if (path.isAbsolute(relativePath)) return [relativePath];

  const resourcesPath = getElectronResourcesPath();
  return uniquePaths([
    path.join(getAppRoot(), relativePath),
    path.join(process.cwd(), relativePath),
    resourcesPath ? path.join(resourcesPath, 'app', relativePath) : null,
    resourcesPath ? path.join(resourcesPath, relativePath) : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'app', relativePath) : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', relativePath) : null,
  ]);
}

export function resolveAppPath(...segments: string[]): string {
  const candidates = getAppPathCandidates(...segments);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

/**
 * 获取跨平台临时目录
 * macOS/Linux: /tmp 或 /var/folders/...
 * Windows: C:\Users\...\AppData\Local\Temp
 */
export function getTempDir(): string {
  return os.tmpdir();
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

function getBundledWorker(scriptPath: string): { command: string; argsPrefix: string[] } | null {
  const scriptName = path.basename(scriptPath, '.py');
  const executableName = process.platform === 'win32' ? `${scriptName}.exe` : scriptName;
  const sharedWorkerName = process.platform === 'win32' ? 'pdf_worker.exe' : 'pdf_worker';
  const resourcePath = getElectronResourcesPath();

  const envKey = scriptName === 'pdf_editor'
    ? 'PDF_EDITOR_BIN'
    : scriptName === 'pdf_processor'
      ? 'PDF_PROCESSOR_BIN'
      : '';

  const candidates = [
    envKey ? process.env[envKey] : null,
    process.env.PDF_WORKER_DIR ? path.join(process.env.PDF_WORKER_DIR, executableName) : null,
    resourcePath ? path.join(resourcePath, 'bin', executableName) : null,
    path.join(getAppRoot(), 'worker-bin', executableName),
    path.join(getAppRoot(), 'resources', 'bin', executableName),
    path.join(process.cwd(), 'worker-bin', executableName),
    path.join(process.cwd(), 'resources', 'bin', executableName),
  ].filter(Boolean) as string[];

  const directWorker = candidates.find(candidate => fs.existsSync(candidate));
  if (directWorker) {
    return { command: directWorker, argsPrefix: [] };
  }

  const sharedCandidates = [
    process.env.PDF_WORKER_BIN,
    process.env.PDF_WORKER_DIR ? path.join(process.env.PDF_WORKER_DIR, sharedWorkerName) : null,
    resourcePath ? path.join(resourcePath, 'bin', sharedWorkerName) : null,
    path.join(getAppRoot(), 'worker-bin', sharedWorkerName),
    path.join(getAppRoot(), 'resources', 'bin', sharedWorkerName),
    path.join(process.cwd(), 'worker-bin', sharedWorkerName),
    path.join(process.cwd(), 'resources', 'bin', sharedWorkerName),
  ].filter(Boolean) as string[];

  const sharedWorker = sharedCandidates.find(candidate => fs.existsSync(candidate));
  return sharedWorker ? { command: sharedWorker, argsPrefix: [scriptName] } : null;
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

/**
 * 用参数数组运行 Python 脚本，避免 shell 引号、空格路径、反斜杠在 Windows 上出问题。
 */
export async function runPythonScript(
  scriptPath: string,
  args: string[],
  options: { maxBuffer?: number; cwd?: string } = {}
) {
  const bundledWorker = getBundledWorker(scriptPath);
  if (bundledWorker) {
    return execFileAsync(
      bundledWorker.command,
      [...bundledWorker.argsPrefix, ...args],
      {
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        cwd: options.cwd,
        env: getPythonEnv(),
        windowsHide: true,
      }
    );
  }

  let lastError: unknown;

  for (const candidate of getPythonCandidates()) {
    try {
      return await execFileAsync(
        candidate.command,
        [...candidate.argsPrefix, scriptPath, ...args],
        {
          maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
          cwd: options.cwd,
          env: getPythonEnv(),
          windowsHide: true,
        }
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      lastError = error;
      if (code !== 'ENOENT') break;
    }
  }

  throw lastError;
}

/**
 * 创建项目内的临时目录路径
 */
export function getProjectTempDir(projectPath: string): string {
  const tempDir = path.join(projectPath, '.temp');
  return tempDir;
}
