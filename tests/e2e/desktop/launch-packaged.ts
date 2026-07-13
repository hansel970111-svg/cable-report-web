import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from 'playwright-core';

const APPLICATION_NAME = 'Cable Report Generator';
const OWNED_PREFIX = 'cable-report-e2e-';
const FATAL_STDERR = [
  /\[CABLE_FATAL_UNHANDLED_REJECTION\]/,
  /\[CABLE_FATAL_UNCAUGHT_EXCEPTION\]/,
  /unhandled(?:promiserejection| rejection)/i,
  /uncaught exception/i,
  /(?:next(?:\.js)?\s+)?(?:server\s+)?(?:startup|start)[^\n]*(?:error|failed)/i,
  /本地服务启动超时/,
  /启动失败/,
] as const;
const PROCESS_PROBE_TIMEOUT_MS = 15_000;

export type ProcessSnapshot = {
  pid: number;
  ppid: number;
  command: string;
};

export type PackagedDesktop = {
  app: ElectronApplication;
  window: Page;
  executablePath: string;
  userDataDir: string;
  mainPid: number;
  stderr: string[];
  taskDirectoriesBefore: ReadonlySet<string>;
};

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function resolvePackagedExecutable(
  workspace: string,
  platform: NodeJS.Platform,
): Promise<string> {
  if (platform === 'win32') {
    const executable = path.join(
      workspace,
      'release',
      'win-unpacked',
      `${APPLICATION_NAME}.exe`,
    );
    if (!(await isFile(executable))) {
      throw new Error(`Expected packaged Windows executable: ${executable}`);
    }
    return executable;
  }

  if (platform !== 'darwin') {
    throw new Error(`Unsupported packaged desktop platform: ${platform}`);
  }

  const releaseDirectory = path.join(workspace, 'release');
  let entries: Array<{ isDirectory(): boolean; name: string }> = [];
  try {
    entries = await readdir(releaseDirectory, { withFileTypes: true });
  } catch {
    // The fixed exactly-one failure below includes the discovered count.
  }

  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^mac(?:-|$)/.test(entry.name)) continue;
    const executable = path.join(
      releaseDirectory,
      entry.name,
      `${APPLICATION_NAME}.app`,
      'Contents',
      'MacOS',
      APPLICATION_NAME,
    );
    if (await isFile(executable)) candidates.push(executable);
  }

  candidates.sort();
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one packaged macOS executable; found ${candidates.length}: `
      + (candidates.join(', ') || '(none)'),
    );
  }
  return candidates[0];
}

export function validateMainProcessStderr(stderr: string): void {
  const match = FATAL_STDERR.find(pattern => pattern.test(stderr));
  if (match) {
    throw new Error(`Packaged main process emitted a fatal diagnostic: ${stderr.trim()}`);
  }
}

async function taskDirectories(): Promise<Set<string>> {
  const names = await readdir(tmpdir());
  return new Set(names.filter(name => name.startsWith('cable-report-')));
}

function parseUnixProcesses(stdout: string): ProcessSnapshot[] {
  return stdout.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }];
  });
}

function processTable(platform: NodeJS.Platform): ProcessSnapshot[] {
  if (platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
      ],
      {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
    if (result.error || result.status !== 0) {
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
        throw new Error(`Windows process-tree probe timed out after ${PROCESS_PROBE_TIMEOUT_MS} ms`);
      }
      throw new Error(`Unable to inspect Windows process tree: ${result.stderr || result.error}`);
    }
    const value = JSON.parse(result.stdout || '[]') as Record<string, unknown> | Record<string, unknown>[];
    const rows = Array.isArray(value) ? value : [value];
    return rows.map(row => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      command: String(row.Name ?? ''),
    })).filter(row => Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.ppid));
  }

  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    shell: false,
    timeout: PROCESS_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
      throw new Error(`Unix process-tree probe timed out after ${PROCESS_PROBE_TIMEOUT_MS} ms`);
    }
    throw new Error(`Unable to inspect process tree: ${result.stderr || result.error}`);
  }
  return parseUnixProcesses(result.stdout);
}

export function descendantProcesses(
  rootPid: number,
  platform: NodeJS.Platform = process.platform,
): ProcessSnapshot[] {
  const rows = processTable(platform);
  const descendants: ProcessSnapshot[] = [];
  const parents = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (parents.has(row.pid) || !parents.has(row.ppid)) continue;
      parents.add(row.pid);
      descendants.push(row);
      changed = true;
    }
  }
  return descendants;
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForProcessExit(pids: readonly number[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every(pid => !processExists(pid))) return;
    await delay(100);
  }
  const alive = pids.filter(processExists);
  if (alive.length > 0) throw new Error(`Descendant processes survived cleanup: ${alive.join(', ')}`);
}

export async function launchPackaged(
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<PackagedDesktop> {
  const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
  const executablePath = await resolvePackagedExecutable(workspace, platform);
  await access(executablePath);
  const userDataDir = await mkdtemp(path.join(tmpdir(), OWNED_PREFIX));
  const taskDirectoriesBefore = await taskDirectories();
  const stderr: string[] = [];

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        ...environment,
        CABLE_DESKTOP_E2E: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      timeout: 60_000,
    });
    app.process().stderr?.on('data', chunk => stderr.push(String(chunk)));
    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');
    validateMainProcessStderr(stderr.join(''));
    return {
      app,
      window,
      executablePath,
      userDataDir,
      mainPid: app.process().pid ?? 0,
      stderr,
      taskDirectoriesBefore,
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true });
    const diagnostics = stderr.join('').trim();
    throw new Error(
      `Packaged application did not become ready${diagnostics ? `: ${diagnostics}` : ''}`,
      { cause: error },
    );
  }
}

export async function closePackaged(desktop: PackagedDesktop): Promise<void> {
  const descendants = desktop.mainPid > 0
    ? descendantProcesses(desktop.mainPid)
    : [];
  let primaryError: unknown;
  try {
    await desktop.app.close();
    await waitForProcessExit(descendants.map(processInfo => processInfo.pid));
    validateMainProcessStderr(desktop.stderr.join(''));
    const after = await taskDirectories();
    const leaked = [...after].filter(name => !desktop.taskDirectoriesBefore.has(name));
    if (leaked.length > 0) {
      throw new Error(`Test-created PDF task directories survived cleanup: ${leaked.join(', ')}`);
    }
    const workerPids = descendants
      .filter(processInfo => /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command))
      .map(processInfo => processInfo.pid)
      .filter(processExists);
    if (workerPids.length > 0) {
      throw new Error(`pdf_worker descendants survived cleanup: ${workerPids.join(', ')}`);
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (path.basename(desktop.userDataDir).startsWith(OWNED_PREFIX)) {
        await rm(desktop.userDataDir, { recursive: true, force: true });
      } else if (primaryError === undefined) {
        throw new Error(`Refusing to delete non-test path: ${desktop.userDataDir}`);
      }
    } catch (error) {
      if (primaryError === undefined) throw error;
    }
  }
}
