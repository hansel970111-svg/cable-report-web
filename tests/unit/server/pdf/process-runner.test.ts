import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createProcessTreeRunner,
  ProcessRunError,
  runProcessTree,
  type ProcessLogHandle,
  type ProcessRunRequest,
  type ProcessRunnerDependencies,
} from '@/server/pdf/process-runner';
import {
  eventuallyProcessExits,
  terminatePidBestEffort,
  waitForPidFile,
} from '../../helpers/process';


const temporaryDirectories: string[] = [];
const cleanupPids = new Set<number>();

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cable-report-process-'));
  temporaryDirectories.push(directory);
  return directory;
}

function requestFor(
  directory: string,
  controller: AbortController,
  script: string,
  overrides: Partial<ProcessRunRequest> = {},
): ProcessRunRequest {
  return {
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: { ...process.env },
    signal: controller.signal,
    stderrPath: path.join(directory, 'worker.log'),
    ...overrides,
  };
}

async function rejectedRun(promise: Promise<unknown>): Promise<ProcessRunError> {
  const error = await promise.then(
    () => new Error('Expected process run to reject'),
    reason => reason as unknown,
  );
  expect(error).toBeInstanceOf(ProcessRunError);
  return error as ProcessRunError;
}

function fakeLogHandle(overrides: Partial<ProcessLogHandle> = {}): ProcessLogHandle {
  return {
    writeFile: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(async () => {
  for (const pid of cleanupPids) {
    try {
      terminatePidBestEffort(pid);
    } catch {
      // The test assertion should remain the primary failure.
    }
  }
  cleanupPids.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('aborting a real detached parent stops its complete process tree', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cable-report-process-'));
  const pidFile = path.join(directory, 'pids.json');
  const controller = new AbortController();
  let pids: Awaited<ReturnType<typeof waitForPidFile>> | undefined;

  try {
    const running = runProcessTree({
      command: process.execPath,
      args: [path.resolve('tests/fixtures/process-tree-parent.mjs'), pidFile],
      cwd: process.cwd(),
      env: { ...process.env },
      signal: controller.signal,
      stderrPath: path.join(directory, 'worker.log'),
    });
    pids = await waitForPidFile(pidFile);

    controller.abort();

    await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    await expect(eventuallyProcessExits(pids.parentPid)).resolves.toBe(true);
    await expect(eventuallyProcessExits(pids.childPid)).resolves.toBe(true);
  } finally {
    if (pids) {
      terminatePidBestEffort(pids.parentPid);
      terminatePidBestEffort(pids.childPid);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

test('keeps Unix escalation alive after the parent exits until a stubborn child is gone', async () => {
  if (process.platform === 'win32') return;

  const directory = await createTemporaryDirectory();
  const pidFile = path.join(directory, 'pids.json');
  const controller = new AbortController();
  let pids: Awaited<ReturnType<typeof waitForPidFile>> | undefined;

  try {
    const running = runProcessTree({
      command: process.execPath,
      args: [path.resolve('tests/fixtures/process-tree-parent.mjs'), pidFile],
      cwd: process.cwd(),
      env: { ...process.env, PROCESS_TREE_CHILD_IGNORE_SIGTERM: '1' },
      signal: controller.signal,
      stderrPath: path.join(directory, 'worker.log'),
    });
    pids = await waitForPidFile(pidFile);
    controller.abort();

    await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    await expect(eventuallyProcessExits(pids.parentPid, 500)).resolves.toBe(true);
    expect(Number.isFinite(pids.childPid)).toBe(true);
    await expect(eventuallyProcessExits(pids.childPid)).resolves.toBe(true);
  } finally {
    if (pids) {
      terminatePidBestEffort(pids.parentPid);
      terminatePidBestEffort(pids.childPid);
    }
  }
}, 10_000);

describe('completion and abort races', () => {
  test('an already-aborted request opens no log and spawns no process', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    controller.abort(new Error('/private abort reason'));
    const openLog = vi.fn(async () => fakeLogHandle());
    const spawnProcess = vi.fn(() => {
      throw new Error('must not spawn');
    });
    const runner = createProcessTreeRunner({ openLog, spawnProcess });

    const error = await rejectedRun(
      runner(requestFor(directory, controller, 'setInterval(() => {}, 1000)')),
    );

    expect(error).toMatchObject({ code: 'PROCESS_ABORTED', message: 'PDF 工作进程已取消' });
    expect(error.message).not.toContain('/private');
    expect(openLog).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  test('abort during spawn terminates the returned process and settles once', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    let spawnedPid = 0;
    let settlements = 0;
    const spawnProcess: ProcessRunnerDependencies['spawnProcess'] = (command, args, options) => {
      const child = nodeSpawn(command, [...args], options);
      spawnedPid = child.pid ?? 0;
      if (spawnedPid > 0) cleanupPids.add(spawnedPid);
      controller.abort();
      return child;
    };
    const runner = createProcessTreeRunner({ spawnProcess });
    const running = runner(
      requestFor(directory, controller, 'setInterval(() => {}, 1000)'),
    ).then(
      value => {
        settlements += 1;
        return value;
      },
      error => {
        settlements += 1;
        throw error;
      },
    );

    await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    await delay(25);
    expect(settlements).toBe(1);
    expect(spawnedPid).toBeGreaterThan(0);
    await expect(eventuallyProcessExits(spawnedPid)).resolves.toBe(true);
  }, 10_000);

  test('double abort settles a running process exactly once', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    let spawnedPid = 0;
    let settlements = 0;
    const runner = createProcessTreeRunner({
      spawnProcess: (command, args, options) => {
        const child = nodeSpawn(command, [...args], options);
        spawnedPid = child.pid ?? 0;
        if (spawnedPid > 0) cleanupPids.add(spawnedPid);
        return child;
      },
    });
    const running = runner(
      requestFor(directory, controller, 'setInterval(() => {}, 1000)'),
    ).finally(() => {
      settlements += 1;
    });

    await vi.waitFor(() => expect(spawnedPid).toBeGreaterThan(0));
    controller.abort();
    controller.abort();

    await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    await delay(25);
    expect(settlements).toBe(1);
  }, 10_000);

  test('abort after exit does not change a completed result or settle twice', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    let settlements = 0;
    const running = runProcessTree(
      requestFor(directory, controller, "process.stdout.write('done')"),
    ).finally(() => {
      settlements += 1;
    });

    await expect(running).resolves.toMatchObject({ exitCode: 0, stdout: 'done' });
    controller.abort();
    controller.abort();
    await delay(25);
    expect(settlements).toBe(1);
  });

  test('zero exit resolves exactly once', async () => {
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    let settlements = 0;
    const running = runProcessTree(
      requestFor(directory, controller, 'process.exitCode = 0'),
    ).finally(() => {
      settlements += 1;
    });

    const result = await running;
    await delay(25);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(settlements).toBe(1);
  });
});

describe('bounded process output', () => {
  test('accepts exactly the default 65,536 stdout bytes', async () => {
    const directory = await createTemporaryDirectory();
    const result = await runProcessTree(
      requestFor(
        directory,
        new AbortController(),
        "process.stdout.write(Buffer.alloc(65536, 'a'))",
      ),
    );

    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(65_536);
  });

  test('rejects byte 65,537 and retains no more than the allowed prefix', async () => {
    const directory = await createTemporaryDirectory();
    const error = await rejectedRun(
      runProcessTree(
        requestFor(
          directory,
          new AbortController(),
          "process.stdout.write(Buffer.alloc(65537, 'a')); setInterval(() => {}, 1000)",
        ),
      ),
    );

    expect(error.code).toBe('PROCESS_STDOUT_LIMIT');
    expect(Buffer.byteLength(error.stdout, 'utf8')).toBe(65_536);
  }, 10_000);

  test('counts UTF-8 bytes instead of JavaScript characters', async () => {
    const directory = await createTemporaryDirectory();
    const accepted = await runProcessTree(
      requestFor(directory, new AbortController(), "process.stdout.write('€')", {
        stdoutLimitBytes: 3,
      }),
    );
    expect(accepted.stdout).toBe('€');

    const error = await rejectedRun(
      runProcessTree(
        requestFor(directory, new AbortController(), "process.stdout.write('€€')", {
          stderrPath: path.join(directory, 'second.log'),
          stdoutLimitBytes: 5,
        }),
      ),
    );
    expect(error.code).toBe('PROCESS_STDOUT_LIMIT');
    expect(Buffer.byteLength(error.stdout, 'utf8')).toBeLessThanOrEqual(5);
  });

  test('streams complete stderr to disk and returns only its final 16 KiB', async () => {
    const directory = await createTemporaryDirectory();
    const stderrPath = path.join(directory, 'worker.log');
    const prefix = 'A'.repeat(8 * 1024);
    const tail = 'B'.repeat(16 * 1024);
    const result = await runProcessTree(
      requestFor(
        directory,
        new AbortController(),
        `process.stderr.write(${JSON.stringify(prefix + tail)})`,
        { stderrPath },
      ),
    );

    const movedLog = path.join(directory, 'closed-worker.log');
    await rename(stderrPath, movedLog);
    expect(await readFile(movedLog, 'utf8')).toBe(prefix + tail);
    expect(result.stderrTail).toBe(tail);
  });
});

describe('safe process and log failures', () => {
  test('maps an ENOENT spawn error without exposing its command path', async () => {
    const directory = await createTemporaryDirectory();
    const missingCommand = path.join(directory, 'private-missing-worker');
    const error = await rejectedRun(
      runProcessTree({
        ...requestFor(directory, new AbortController(), ''),
        command: missingCommand,
        args: [],
      }),
    );

    expect(error).toMatchObject({
      code: 'PROCESS_SPAWN_FAILED',
      message: 'PDF 工作进程启动失败',
    });
    expect(error.message).not.toContain(missingCommand);
  });

  test('log open failure settles safely without spawning', async () => {
    const directory = await createTemporaryDirectory();
    const spawnProcess = vi.fn(() => {
      throw new Error('must not spawn');
    });
    const runner = createProcessTreeRunner({
      openLog: async () => {
        throw new Error('/private/log/open');
      },
      spawnProcess,
    });
    const error = await rejectedRun(
      runner(requestFor(directory, new AbortController(), 'setInterval(() => {}, 1000)')),
    );

    expect(error).toMatchObject({
      code: 'PROCESS_SPAWN_FAILED',
      message: 'PDF 工作进程日志写入失败',
    });
    expect(error.message).not.toContain('/private');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  test('log write failure terminates the process and closes the log once', async () => {
    const directory = await createTemporaryDirectory();
    let spawnedPid = 0;
    const handle = fakeLogHandle({
      writeFile: vi.fn(async () => {
        throw new Error('/private/log/write');
      }),
    });
    const runner = createProcessTreeRunner({
      openLog: async () => handle,
      spawnProcess: (command, args, options) => {
        const child = nodeSpawn(command, [...args], options);
        spawnedPid = child.pid ?? 0;
        if (spawnedPid > 0) cleanupPids.add(spawnedPid);
        return child;
      },
    });
    const error = await rejectedRun(
      runner(
        requestFor(
          directory,
          new AbortController(),
          "process.stderr.write('boom'); setInterval(() => {}, 1000)",
        ),
      ),
    );

    expect(error).toMatchObject({
      code: 'PROCESS_SPAWN_FAILED',
      message: 'PDF 工作进程日志写入失败',
    });
    expect(handle.close).toHaveBeenCalledOnce();
    await expect(eventuallyProcessExits(spawnedPid)).resolves.toBe(true);
  }, 10_000);

  test('log close failure rejects once with a safe fixed result', async () => {
    const directory = await createTemporaryDirectory();
    const handle = fakeLogHandle({
      close: vi.fn(async () => {
        throw new Error('/private/log/close');
      }),
    });
    const runner = createProcessTreeRunner({ openLog: async () => handle });
    const error = await rejectedRun(
      runner(requestFor(directory, new AbortController(), "process.stderr.write('done')")),
    );

    expect(error).toMatchObject({
      code: 'PROCESS_SPAWN_FAILED',
      message: 'PDF 工作进程日志写入失败',
    });
    expect(handle.close).toHaveBeenCalledOnce();
  });

  test('non-ESRCH Unix termination failure settles as a safe abort error', async () => {
    if (process.platform === 'win32') return;
    const directory = await createTemporaryDirectory();
    const controller = new AbortController();
    let spawnedPid = 0;
    const runner = createProcessTreeRunner({
      killProcess: () => {
        throw Object.assign(new Error('/private/kill/failed'), { code: 'EPERM' });
      },
      spawnProcess: (command, args, options) => {
        const child = nodeSpawn(command, [...args], options);
        child.kill = vi.fn(() => false);
        spawnedPid = child.pid ?? 0;
        if (spawnedPid > 0) cleanupPids.add(spawnedPid);
        return child;
      },
    });
    const running = runner(
      requestFor(directory, controller, 'setInterval(() => {}, 1000)'),
    );
    await vi.waitFor(() => expect(spawnedPid).toBeGreaterThan(0));
    controller.abort();

    const error = await rejectedRun(running);
    expect(error).toMatchObject({
      code: 'PROCESS_ABORTED',
      message: 'PDF 工作进程终止失败',
    });
    expect(error.message).not.toContain('/private');
  }, 10_000);
});

test('the Windows branch waits for exact shell-free taskkill invocation', async () => {
  const directory = await createTemporaryDirectory();
  const controller = new AbortController();
  const mainStdout = new PassThrough();
  const mainStderr = new PassThrough();
  const mainChild = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout: mainStdout,
    stderr: mainStderr,
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
  const taskkill = Object.assign(new EventEmitter(), {
    pid: 9876,
    stdout: null,
    stderr: null,
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
  const spawnProcess = vi.fn<ProcessRunnerDependencies['spawnProcess']>(
    command => {
      if (command === 'taskkill') {
        queueMicrotask(() => {
          taskkill.emit('close', 0, null);
          mainStdout.end();
          mainStderr.end();
          mainChild.emit('exit', null, 'SIGTERM');
          mainChild.emit('close', null, 'SIGTERM');
        });
        return taskkill;
      }
      return mainChild;
    },
  );
  const runner = createProcessTreeRunner({
    openLog: async () => fakeLogHandle(),
    platform: 'win32',
    spawnProcess,
  });
  const running = runner({
    command: 'worker.exe',
    args: ['request.json'],
    cwd: directory,
    env: { ...process.env },
    signal: controller.signal,
    stderrPath: path.join(directory, 'worker.log'),
  });
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
  controller.abort();

  await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
  expect(spawnProcess).toHaveBeenNthCalledWith(
    1,
    'worker.exe',
    ['request.json'],
    expect.objectContaining({ shell: false, detached: false }),
  );
  expect(spawnProcess).toHaveBeenNthCalledWith(
    2,
    'taskkill',
    ['/PID', '4321', '/T', '/F'],
    { shell: false, windowsHide: true, stdio: 'ignore' },
  );
});

test('Windows abort does not start taskkill after the original process already closed', async () => {
  const directory = await createTemporaryDirectory();
  const controller = new AbortController();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const mainChild = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout,
    stderr,
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
  const spawnProcess = vi.fn<ProcessRunnerDependencies['spawnProcess']>(command => {
    if (command === 'taskkill') throw new Error('taskkill must not start');
    return mainChild;
  });
  const runner = createProcessTreeRunner({
    openLog: async () => fakeLogHandle(),
    platform: 'win32',
    spawnProcess,
  });
  const running = runner(
    requestFor(directory, controller, 'ignored', {
      command: 'worker.exe',
      args: [],
    }),
  );
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());

  controller.abort();
  stdout.end();
  stderr.end();
  mainChild.emit('exit', 0, null);
  mainChild.emit('close', 0, null);

  await expect(running).rejects.toMatchObject({
    code: 'PROCESS_ABORTED',
    message: 'PDF 工作进程已取消',
  });
  expect(spawnProcess).toHaveBeenCalledTimes(1);
});

test('Windows taskkill nonzero race preserves abort when the original closes concurrently', async () => {
  const directory = await createTemporaryDirectory();
  const controller = new AbortController();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const mainChild = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout,
    stderr,
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
  const taskkill = Object.assign(new EventEmitter(), {
    pid: 9876,
    stdout: null,
    stderr: null,
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
  const spawnProcess = vi.fn<ProcessRunnerDependencies['spawnProcess']>(command =>
    command === 'taskkill' ? taskkill : mainChild,
  );
  const runner = createProcessTreeRunner({
    openLog: async () => fakeLogHandle(),
    platform: 'win32',
    spawnProcess,
  });
  const running = runner(
    requestFor(directory, controller, 'ignored', {
      command: 'worker.exe',
      args: [],
    }),
  );
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
  controller.abort();
  await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));

  taskkill.emit('close', 1, null);
  stdout.end();
  stderr.end();
  mainChild.emit('exit', 0, null);
  mainChild.emit('close', 0, null);

  await expect(running).rejects.toMatchObject({
    code: 'PROCESS_ABORTED',
    message: 'PDF 工作进程已取消',
  });
});
