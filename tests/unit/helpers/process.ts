import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';


export type ProcessTreePids = {
  parentPid: number;
  childPid: number;
};

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function eventuallyProcessExits(
  pid: number,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await delay(25);
  }
  return !isProcessRunning(pid);
}

export async function waitForPidFile(
  filePath: string,
  timeoutMs = 5_000,
): Promise<ProcessTreePids> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8')) as ProcessTreePids;
      if (Number.isInteger(value.parentPid) && Number.isInteger(value.childPid)) {
        return value;
      }
    } catch {
      // The parent may still be creating the fixture file.
    }
    await delay(25);
  }
  throw new Error('Timed out waiting for process-tree PID fixture');
}

export function terminatePidBestEffort(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
