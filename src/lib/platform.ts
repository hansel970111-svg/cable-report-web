/**
 * 跨平台兼容工具函数
 * 支持 macOS, Windows, Linux
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
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
export function getPythonCommand(): string {
  if (process.env.PYTHON_CMD) return process.env.PYTHON_CMD;
  if (process.env.PYTHON) return process.env.PYTHON;

  // Windows 通常使用 python，macOS/Linux 通常使用 python3
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getPythonCandidates(): Array<{ command: string; args: string[] }> {
  const configured = getPythonCommand();
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: configured, args: [] },
  ];

  if (process.platform === 'win32' && configured !== 'py') {
    candidates.push({ command: 'py', args: ['-3'] });
  } else if (process.platform !== 'win32' && configured !== 'python') {
    candidates.push({ command: 'python', args: [] });
  }

  return candidates;
}

function getBundledWorkerPath(scriptPath: string): string | null {
  const scriptName = path.basename(scriptPath, '.py');
  const executableName = process.platform === 'win32' ? `${scriptName}.exe` : scriptName;
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
    path.join(getAppRoot(), 'resources', 'bin', executableName),
    path.join(process.cwd(), 'resources', 'bin', executableName),
  ].filter(Boolean) as string[];

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function getPythonEnv(): NodeJS.ProcessEnv {
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
  const bundledWorkerPath = getBundledWorkerPath(scriptPath);
  if (bundledWorkerPath) {
    return execFileAsync(
      bundledWorkerPath,
      args,
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
        [...candidate.args, scriptPath, ...args],
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
 * 构建跨平台兼容的命令参数
 * 避免使用 shell 特定语法（如 cat, $(...)）
 */
export function buildPythonCommand(
  scriptPath: string,
  args: string[]
): { command: string; useShell: boolean } {
  const pythonCmd = getPythonCommand();
  
  // 对路径进行转义处理
  const escapedScriptPath = process.platform === 'win32' 
    ? `"${scriptPath}"` 
    : `'${scriptPath}'`;
  
  const escapedArgs = args.map(arg => {
    if (process.platform === 'win32') {
      return `"${arg}"`;
    } else {
      return `'${arg}'`;
    }
  });
  
  const command = `${pythonCmd} ${escapedScriptPath} ${escapedArgs.join(' ')}`;
  
  return {
    command,
    useShell: true
  };
}

/**
 * 创建项目内的临时目录路径
 */
export function getProjectTempDir(projectPath: string): string {
  const tempDir = path.join(projectPath, '.temp');
  return tempDir;
}
