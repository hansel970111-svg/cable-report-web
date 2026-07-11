import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';


const DEFAULT_STDOUT_LIMIT = 65_536;
const STDERR_TAIL_LIMIT = 16 * 1024;
const TERMINATION_GRACE_MS = 2_000;

const MESSAGES = {
  aborted: 'PDF 工作进程已取消',
  log: 'PDF 工作进程日志写入失败',
  spawn: 'PDF 工作进程启动失败',
  stdout: 'PDF 工作进程标准输出超过限制',
  terminate: 'PDF 工作进程终止失败',
} as const;

export type ProcessRunRequest = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stderrPath: string;
  stdoutLimitBytes?: number;
};

export type ProcessRunResult = {
  exitCode: number;
  stdout: string;
  stderrTail: string;
  durationMs: number;
};

export class ProcessRunError extends Error {
  constructor(
    readonly code:
      | 'PROCESS_ABORTED'
      | 'PROCESS_SPAWN_FAILED'
      | 'PROCESS_STDOUT_LIMIT',
    message: string,
    readonly stdout: string,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'ProcessRunError';
  }
}

export type ProcessLogHandle = {
  writeFile(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type ProcessRunnerDependencies = {
  platform: NodeJS.Platform;
  spawnProcess: SpawnProcess;
  killProcess(pid: number, signal: NodeJS.Signals | 0): void;
  openLog(path: string): Promise<ProcessLogHandle>;
  now(): number;
};

type Failure = {
  code: ProcessRunError['code'];
  kind: 'abort' | 'log' | 'spawn' | 'stdout' | 'terminate';
  message: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function safePid(pid: number | undefined): pid is number {
  return Number.isSafeInteger(pid) && (pid ?? 0) > 0;
}

function appendTail(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= STDERR_TAIL_LIMIT) {
    return Buffer.from(chunk.subarray(chunk.length - STDERR_TAIL_LIMIT));
  }
  if (current.length + chunk.length <= STDERR_TAIL_LIMIT) {
    return Buffer.concat([current, chunk]);
  }
  return Buffer.concat([current, chunk]).subarray(-STDERR_TAIL_LIMIT);
}

function decodeStdout(buffer: Buffer, truncated: boolean): string {
  if (!truncated) return buffer.toString('utf8');
  return new StringDecoder('utf8').write(buffer);
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(25);
  }
  return predicate();
}

function groupIsGone(pid: number, dependencies: ProcessRunnerDependencies): boolean {
  try {
    dependencies.killProcess(-pid, 0);
    return false;
  } catch (error) {
    return isErrno(error, 'ESRCH');
  }
}

async function terminateUnixTree(
  pid: number,
  dependencies: ProcessRunnerDependencies,
): Promise<void> {
  try {
    dependencies.killProcess(-pid, 'SIGTERM');
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return;
    throw new Error('terminate failed');
  }

  if (await waitUntil(() => groupIsGone(pid, dependencies), TERMINATION_GRACE_MS)) {
    return;
  }

  try {
    dependencies.killProcess(-pid, 'SIGKILL');
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return;
    throw new Error('terminate failed');
  }

  if (!(await waitUntil(() => groupIsGone(pid, dependencies), TERMINATION_GRACE_MS))) {
    throw new Error('terminate failed');
  }
}

async function terminateWindowsTree(
  pid: number,
  dependencies: ProcessRunnerDependencies,
  originalClosed: () => boolean,
  originalClose: Promise<{ exitCode: number }>,
): Promise<void> {
  if (originalClosed()) return;

  let taskkill: ChildProcess;
  try {
    taskkill = dependencies.spawnProcess(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    if (originalClosed() || await waitForClose(originalClose, 50)) return;
    throw new Error('terminate failed');
  }

  type TaskkillOutcome = 'failed' | 'original-closed' | 'succeeded' | 'timed-out';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: (outcome: TaskkillOutcome) => void;
  const onError = () => finish('failed');
  const onClose = (code: number | null) => {
    finish(code === 0 ? 'succeeded' : 'failed');
  };

  let outcome: TaskkillOutcome;
  try {
    outcome = await new Promise<TaskkillOutcome>(resolve => {
      let done = false;
      finish = next => {
        if (done) return;
        done = true;
        resolve(next);
      };

      timer = setTimeout(() => finish('timed-out'), TERMINATION_GRACE_MS);
      originalClose.then(() => finish('original-closed'));
      taskkill.once('error', onError);
      taskkill.once('close', onClose);
    });
  } finally {
    if (timer) clearTimeout(timer);
    taskkill.removeListener('error', onError);
    taskkill.removeListener('close', onClose);
    taskkill.unref();
  }

  if (outcome === 'succeeded' || outcome === 'original-closed' || originalClosed()) {
    return;
  }
  if (await waitForClose(originalClose, 50)) {
    return;
  }
  throw new Error('terminate failed');
}

async function waitForClose(
  closePromise: Promise<{ exitCode: number }>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const closed = await Promise.race([closePromise.then(() => true), timeout]);
  if (timer) clearTimeout(timer);
  return closed;
}

const defaultDependencies: ProcessRunnerDependencies = {
  platform: process.platform,
  spawnProcess: (command, args, options) => nodeSpawn(command, [...args], options),
  killProcess: (pid, signal) => process.kill(pid, signal),
  openLog: stderrPath => open(stderrPath, 'w', 0o600),
  now: () => performance.now(),
};

/** @internal Exported only for deterministic platform and failure tests. */
export function createProcessTreeRunner(
  overrides: Partial<ProcessRunnerDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return async function run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const startedAt = dependencies.now();
    const limit = request.stdoutLimitBytes ?? DEFAULT_STDOUT_LIMIT;
    const emptyError = (failure: Failure) =>
      new ProcessRunError(failure.code, failure.message, '', '');

    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw emptyError({
        code: 'PROCESS_STDOUT_LIMIT',
        kind: 'stdout',
        message: MESSAGES.stdout,
      });
    }
    if (request.signal.aborted) {
      throw emptyError({
        code: 'PROCESS_ABORTED',
        kind: 'abort',
        message: MESSAGES.aborted,
      });
    }

    let failureWinner: Failure | undefined;
    const failure = deferred<Failure>();
    let exitObserved = false;
    let processClosed = false;
    const requestFailure = (candidate: Failure) => {
      if (failureWinner) return;
      failureWinner = candidate;
      failure.resolve(candidate);
    };
    const onAbort = () => {
      if (exitObserved) return;
      requestFailure({
        code: 'PROCESS_ABORTED',
        kind: 'abort',
        message: MESSAGES.aborted,
      });
    };

    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();

    let logHandle: ProcessLogHandle;
    try {
      logHandle = await dependencies.openLog(request.stderrPath);
    } catch {
      request.signal.removeEventListener('abort', onAbort);
      if (failureWinner?.kind === 'abort') throw emptyError(failureWinner);
      throw emptyError({
        code: 'PROCESS_SPAWN_FAILED',
        kind: 'log',
        message: MESSAGES.log,
      });
    }

    if (failureWinner?.kind === 'abort') {
      try {
        await logHandle.close();
      } catch {
        // Abort remains the primary result.
      }
      request.signal.removeEventListener('abort', onAbort);
      throw emptyError(failureWinner);
    }

    let child: ChildProcess | undefined;
    let stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let stderrTail: Buffer = Buffer.alloc(0);
    const closeEvent = deferred<{ exitCode: number }>();

    const logStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logHandle.writeFile(Buffer.from(chunk)).then(
          () => callback(),
          error => callback(error as Error),
        );
      },
    });
    const logFinished = finished(logStream, { cleanup: true }).then(
      () => false,
      () => true,
    );
    const onLogError = () => {
      requestFailure({
        code: 'PROCESS_SPAWN_FAILED',
        kind: 'log',
        message: MESSAGES.log,
      });
      child?.stderr?.unpipe(logStream);
      child?.stderr?.resume();
    };
    logStream.on('error', onLogError);

    try {
      child = dependencies.spawnProcess(request.command, request.args, {
        cwd: request.cwd,
        detached: dependencies.platform !== 'win32',
        env: request.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      requestFailure({
        code: 'PROCESS_SPAWN_FAILED',
        kind: 'spawn',
        message: MESSAGES.spawn,
      });
      logStream.end();
    }

    const onChildError = () => requestFailure({
      code: 'PROCESS_SPAWN_FAILED',
      kind: 'spawn',
      message: MESSAGES.spawn,
    });
    const onExit = () => {
      exitObserved = true;
      request.signal.removeEventListener('abort', onAbort);
    };
    const onClose = (code: number | null) => {
      exitObserved = true;
      processClosed = true;
      request.signal.removeEventListener('abort', onAbort);
      closeEvent.resolve({ exitCode: code ?? -1 });
    };
    const onStdoutError = () => requestFailure({
      code: 'PROCESS_SPAWN_FAILED',
      kind: 'spawn',
      message: MESSAGES.spawn,
    });
    const onStderrError = () => requestFailure({
      code: 'PROCESS_SPAWN_FAILED',
      kind: 'log',
      message: MESSAGES.log,
    });
    const onStdout = (value: Buffer) => {
      const chunk = Buffer.from(value);
      const remaining = Math.max(0, limit - stdoutBytes);
      if (remaining > 0) {
        const accepted = chunk.subarray(0, remaining);
        stdoutChunks.push(Buffer.from(accepted));
        stdoutBytes += accepted.length;
      }
      if (chunk.length > remaining) {
        stdoutTruncated = true;
        requestFailure({
          code: 'PROCESS_STDOUT_LIMIT',
          kind: 'stdout',
          message: MESSAGES.stdout,
        });
      }
    };
    const onStderr = (value: Buffer) => {
      stderrTail = appendTail(stderrTail, Buffer.from(value));
    };

    if (child) {
      child.on('error', onChildError);
      child.once('exit', onExit);
      child.once('close', onClose);
      if (!child.stdout || !child.stderr) {
        requestFailure({
          code: 'PROCESS_SPAWN_FAILED',
          kind: 'spawn',
          message: MESSAGES.spawn,
        });
      } else {
        child.stdout.on('data', onStdout);
        child.stdout.on('error', onStdoutError);
        child.stderr.on('data', onStderr);
        child.stderr.on('error', onStderrError);
        child.stderr.pipe(logStream);
      }
    }

    if (!child) {
      await logFinished;
    } else {
      await Promise.race([closeEvent.promise, failure.promise]);
    }

    if (failureWinner && child && safePid(child.pid)) {
      try {
        if (dependencies.platform === 'win32') {
          await terminateWindowsTree(
            child.pid,
            dependencies,
            () => processClosed,
            closeEvent.promise,
          );
        } else {
          await terminateUnixTree(child.pid, dependencies);
        }
      } catch {
        failureWinner = {
          code: 'PROCESS_ABORTED',
          kind: 'terminate',
          message: MESSAGES.terminate,
        };
        if (!processClosed && dependencies.platform !== 'win32') {
          try {
            child.kill('SIGKILL');
          } catch {
            // The safe termination error remains the public result.
          }
        }
      }

      if (!processClosed && !(await waitForClose(closeEvent.promise, 3_000))) {
        failureWinner = {
          code: 'PROCESS_ABORTED',
          kind: 'terminate',
          message: MESSAGES.terminate,
        };
        child.stderr?.unpipe(logStream);
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (!logStream.destroyed && !logStream.writableEnded) {
          logStream.end();
        }
        child.unref();
      }
    } else if (child && !processClosed) {
      await closeEvent.promise;
    }

    if (!logStream.destroyed && !logStream.writableEnded && processClosed) {
      logStream.end();
    }
    const logWriteFailed = await logFinished;
    if (logWriteFailed && !failureWinner) {
      failureWinner = {
        code: 'PROCESS_SPAWN_FAILED',
        kind: 'log',
        message: MESSAGES.log,
      };
    }

    try {
      await logHandle.close();
    } catch {
      if (!failureWinner) {
        failureWinner = {
          code: 'PROCESS_SPAWN_FAILED',
          kind: 'log',
          message: MESSAGES.log,
        };
      }
    }

    request.signal.removeEventListener('abort', onAbort);
    logStream.removeListener('error', onLogError);
    if (child) {
      child.removeListener('error', onChildError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      child.stdout?.removeListener('data', onStdout);
      child.stdout?.removeListener('error', onStdoutError);
      child.stderr?.removeListener('data', onStderr);
      child.stderr?.removeListener('error', onStderrError);
      child.stderr?.unpipe(logStream);
    }
    logStream.destroy();

    const stdoutBuffer = Buffer.concat(stdoutChunks, stdoutBytes);
    stdoutChunks = [];
    const stdout = decodeStdout(stdoutBuffer, stdoutTruncated);
    const stderr = stderrTail.toString('utf8');

    if (failureWinner) {
      throw new ProcessRunError(
        failureWinner.code,
        failureWinner.message,
        stdout,
        stderr,
      );
    }

    const close = await closeEvent.promise;
    return {
      exitCode: close.exitCode,
      stdout,
      stderrTail: stderr,
      durationMs: Math.max(0, dependencies.now() - startedAt),
    };
  };
}

export const runProcessTree = createProcessTreeRunner();
