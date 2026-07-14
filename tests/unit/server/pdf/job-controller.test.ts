import {
  appendFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { suggestedPdfName } from '@/domain/report/cable-rules';
import type { ReportDraft } from '@/domain/report/model';
import { resolvePythonCommand } from '@/lib/platform';
import { PdfJobError } from '@/server/pdf/errors';
import { PdfJobController } from '@/server/pdf/job-controller';
import {
  createPdfWorker,
  type PdfWorker,
  type PdfWorkerRequest,
} from '@/server/pdf/worker';


const roots: string[] = [];
const FIXED_NOW = new Date(2026, 6, 10, 9, 30, 0);
const MAX_PDF_BYTES = 256 * 1024 * 1024;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    revision: 1,
    cableType: 'Cat 5e',
    site: 'SITE',
    records: [{
      id: 'record-1',
      cableLabel: '#1',
      cableNumber: '1',
      limit: 'TIA - Cat 5e Channel',
      result: 'PASS',
      length: 20,
      nextMargin: 10,
      dateTime: '10-07-2026 09:00:00 AM',
    }],
    ...overrides,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cable-report-controller-'));
  roots.push(root);
  return root;
}

function validPdf(): Buffer {
  return Buffer.from('%PDF-1.7\nfixture\n%%EOF\n', 'ascii');
}

async function writeValidPdf(request: PdfWorkerRequest): Promise<void> {
  await writeFile(request.outputPath, validPdf());
}

function fakeWorker(
  execute: PdfWorker['execute'],
): PdfWorker {
  return { execute: vi.fn(execute) };
}

function controller(
  root: string,
  worker: PdfWorker,
  overrides: Partial<ConstructorParameters<typeof PdfJobController>[0]> = {},
) {
  return new PdfJobController({
    worker,
    templatePathFor: cableType => `/templates/${cableType}.pdf`,
    suggestedNameFor: suggestedPdfName,
    tempRoot: root,
    now: () => FIXED_NOW,
    logger: vi.fn(),
    ...overrides,
  });
}

async function expectClean(root: string, target: PdfJobController): Promise<void> {
  expect(await readdir(root)).toEqual([]);
  expect(target.isBusy()).toBe(false);
}

function workerRequest(
  root: string,
  overrides: Partial<PdfWorkerRequest> = {},
): PdfWorkerRequest {
  return {
    templatePath: path.join(root, 'template.pdf'),
    requestPath: path.join(root, 'request.json'),
    outputPath: path.join(root, 'report.pdf'),
    cwd: root,
    stderrPath: path.join(root, 'worker.log'),
    signal: new AbortController().signal,
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('PdfJobController ownership and cleanup', () => {
  test('rejects a second job as busy without queueing it', async () => {
    const root = await temporaryRoot();
    const started = deferred<PdfWorkerRequest>();
    const release = deferred();
    const worker = fakeWorker(async request => {
      started.resolve(request);
      await release.promise;
      await writeValidPdf(request);
      return { pages: 2, records: 1 };
    });
    const target = controller(root, worker);
    const first = target.run({
      jobId: 'job-1',
      draft: draft(),
      signal: new AbortController().signal,
    });
    const firstRequest = await started.promise;

    await expect(target.run({
      jobId: 'job-2',
      draft: draft(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'REPORT_BUSY', retryable: true });
    expect(worker.execute).toHaveBeenCalledOnce();

    release.resolve();
    await expect(first).resolves.toMatchObject({
      suggestedName: 'SITE_Cat_5e_20260710_093000.pdf',
      pages: 2,
      records: 1,
    });
    expect(path.basename(firstRequest.cwd)).toMatch(/^cable-report-/);
    expect(path.dirname(firstRequest.requestPath)).toBe(firstRequest.cwd);
    expect(path.dirname(firstRequest.outputPath)).toBe(firstRequest.cwd);
    expect(path.dirname(firstRequest.stderrPath)).toBe(firstRequest.cwd);
    await expectClean(root, target);
  });

  test('writes a snake-case request in a fresh private directory for every run', async () => {
    const root = await temporaryRoot();
    const directories: string[] = [];
    const payloads: unknown[] = [];
    const worker = fakeWorker(async request => {
      directories.push(request.cwd);
      payloads.push(JSON.parse(await readFile(request.requestPath, 'utf8')));
      expect(path.basename(request.requestPath)).toBe('request.json');
      expect(path.basename(request.outputPath)).toBe('report.pdf');
      expect(path.basename(request.stderrPath)).toBe('worker.log');
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    });
    const target = controller(root, worker);

    const first = await target.run({
      jobId: 'job-1', draft: draft(), signal: new AbortController().signal,
    });
    const second = await target.run({
      jobId: 'job-2', draft: draft(), signal: new AbortController().signal,
    });

    expect(directories[0]).not.toBe(directories[1]);
    expect(payloads[0]).toEqual({
      site: 'SITE',
      records: [{
        cable_label: '#1',
        cable_number: '1',
        limit: 'TIA - Cat 5e Channel',
        result: 'PASS',
        length: 20,
        next_margin: 10,
        date_time: '10-07-2026 09:00:00 AM',
      }],
    });
    expect(Buffer.from(first.bytes)).toEqual(validPdf());
    expect(Buffer.from(second.bytes)).toEqual(validPdf());
    await expectClean(root, target);
  });

  test('uses a 600,000 ms default timeout and cleans the aborted job', async () => {
    vi.useFakeTimers();
    const root = await temporaryRoot();
    const started = deferred<AbortSignal>();
    const worker = fakeWorker(async request => {
      started.resolve(request.signal);
      return new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    });
    const target = controller(root, worker);
    const running = target.run({
      jobId: 'job-timeout', draft: draft(), signal: new AbortController().signal,
    });
    const outcome = running.catch(error => error as unknown);
    const signal = await started.promise;

    await vi.advanceTimersByTimeAsync(599_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toMatchObject({
      code: 'REPORT_TIMEOUT', retryable: true,
    });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expectClean(root, target);
  });

  test('caller abort wins and propagates to the worker signal', async () => {
    const root = await temporaryRoot();
    const caller = new AbortController();
    const started = deferred<AbortSignal>();
    const worker = fakeWorker(async request => {
      started.resolve(request.signal);
      return new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    });
    const target = controller(root, worker, { timeoutMs: 60_000 });
    const running = target.run({ jobId: 'job-abort', draft: draft(), signal: caller.signal });
    const workerSignal = await started.promise;

    caller.abort();

    await expect(running).rejects.toMatchObject({
      code: 'REPORT_CANCELLED', retryable: false,
    });
    expect(workerSignal.aborted).toBe(true);
    await expectClean(root, target);
  });

  test('shutdown aborts the active worker and waits for private-directory cleanup', async () => {
    const root = await temporaryRoot();
    const started = deferred<AbortSignal>();
    const worker = fakeWorker(async request => {
      started.resolve(request.signal);
      return new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('shutdown')), {
          once: true,
        });
      });
    });
    const target = controller(root, worker, { timeoutMs: 60_000 });
    const running = target.run({
      jobId: 'job-shutdown', draft: draft(), signal: new AbortController().signal,
    });
    const workerSignal = await started.promise;

    await target.shutdown();

    expect(workerSignal.aborted).toBe(true);
    await expect(running).rejects.toMatchObject({ code: 'REPORT_CANCELLED' });
    await expectClean(root, target);
    await expect(target.shutdown()).resolves.toBeUndefined();
  });

  test('an already-aborted request never calls the worker', async () => {
    const root = await temporaryRoot();
    const caller = new AbortController();
    caller.abort();
    const worker = fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    });
    const target = controller(root, worker);

    await expect(target.run({
      jobId: 'job-aborted', draft: draft(), signal: caller.signal,
    })).rejects.toMatchObject({ code: 'REPORT_CANCELLED' });
    expect(worker.execute).not.toHaveBeenCalled();
    await expectClean(root, target);
  });
});

describe('PdfJobController output validation', () => {
  test.each([
    {
      name: 'missing output',
      execute: async () => ({ pages: 1, records: 1 }),
      code: 'PDF_OUTPUT_INVALID',
    },
    {
      name: 'record-count mismatch',
      execute: async (request: PdfWorkerRequest) => {
        await writeValidPdf(request);
        return { pages: 1, records: 0 };
      },
      code: 'PDF_OUTPUT_INVALID',
    },
    {
      name: 'zero-page output',
      execute: async (request: PdfWorkerRequest) => {
        await writeValidPdf(request);
        return { pages: 0, records: 1 };
      },
      code: 'PDF_OUTPUT_INVALID',
    },
    {
      name: 'missing PDF header',
      execute: async (request: PdfWorkerRequest) => {
        await writeFile(request.outputPath, 'not a PDF');
        return { pages: 1, records: 1 };
      },
      code: 'PDF_OUTPUT_INVALID',
    },
  ])('rejects $name and cleans the private directory', async ({ execute, code }) => {
    const root = await temporaryRoot();
    const target = controller(root, fakeWorker(execute));

    await expect(target.run({
      jobId: 'job-invalid', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code });
    await expectClean(root, target);
  });

  test('rejects a sparse 268,435,457-byte output before reading it', async () => {
    const root = await temporaryRoot();
    const worker = fakeWorker(async request => {
      await writeValidPdf(request);
      await truncate(request.outputPath, MAX_PDF_BYTES + 1);
      return { pages: 1, records: 1 };
    });
    const target = controller(root, worker);

    await expect(target.run({
      jobId: 'job-large', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'PDF_OUTPUT_TOO_LARGE', retryable: false,
    });
    await expectClean(root, target);
  });

  test('rejects a report.pdf symlink even when its target is a valid PDF', async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const outsidePdf = path.join(outsideRoot, 'outside.pdf');
    await writeFile(outsidePdf, validPdf());
    const target = controller(root, fakeWorker(async request => {
      await symlink(outsidePdf, request.outputPath);
      return { pages: 1, records: 1 };
    }));

    await expect(target.run({
      jobId: 'job-symlink', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_OUTPUT_INVALID' });
    await expectClean(root, target);
    expect(await readFile(outsidePdf)).toEqual(validPdf());
  });

  test('rejects output growth after the opened file descriptor is sized', async () => {
    const root = await temporaryRoot();
    let outputPath = '';
    const openWithGrowth: typeof open = async (...args) => {
      const handle = await open(...args);
      const originalStat = handle.stat.bind(handle);
      let firstStat = true;
      handle.stat = (async (...statArgs: Parameters<typeof handle.stat>) => {
        const result = await originalStat(...statArgs);
        if (firstStat) {
          firstStat = false;
          await appendFile(outputPath, 'X');
        }
        return result;
      }) as typeof handle.stat;
      return handle;
    };
    const target = controller(root, fakeWorker(async request => {
      outputPath = request.outputPath;
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat, openOutput: openWithGrowth, rm },
    });

    await expect(target.run({
      jobId: 'job-growth', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_OUTPUT_INVALID' });
    await expectClean(root, target);
  });

  test('rejects when the opened descriptor is not the file that was lstat-ed', async () => {
    const root = await temporaryRoot();
    const replacementRoot = await temporaryRoot();
    const replacementPath = path.join(replacementRoot, 'replacement.pdf');
    await writeFile(replacementPath, validPdf());
    const openReplacement: typeof open = async (_outputPath, flags) => (
      open(replacementPath, flags)
    );
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat, openOutput: openReplacement, rm },
    });

    await expect(target.run({
      jobId: 'job-replaced-output',
      draft: draft(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_OUTPUT_INVALID' });
    await expectClean(root, target);
  });

  test('uses bigint file identity so distinct 64-bit inode values cannot collide', async () => {
    const root = await temporaryRoot();
    const pathInode = BigInt('9007199254740992');
    const descriptorInode = pathInode + BigInt(1);
    const withInode = <T extends object>(value: T, inode: number | bigint): T => (
      new Proxy(value, {
        get(target, property) {
          if (property === 'ino') return inode;
          const member = Reflect.get(target, property, target);
          return typeof member === 'function' ? member.bind(target) : member;
        },
      })
    );
    const preciseLstat = (async (
      filePath: string,
      options?: { bigint?: boolean },
    ) => {
      if (options?.bigint) {
        return withInode(await lstat(filePath, { bigint: true }), pathInode);
      }
      return withInode(await lstat(filePath), Number(pathInode));
    }) as unknown as typeof lstat;
    const openWithDistinctInode: typeof open = async (...args) => {
      const handle = await open(...args);
      const originalStat = handle.stat.bind(handle);
      handle.stat = (async (options?: { bigint?: boolean }) => {
        if (options?.bigint) {
          return withInode(await originalStat({ bigint: true }), descriptorInode);
        }
        return withInode(await originalStat(), Number(descriptorInode));
      }) as typeof handle.stat;
      return handle;
    };
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat: preciseLstat, openOutput: openWithDistinctInode, rm },
    });

    await expect(target.run({
      jobId: 'job-bigint-identity',
      draft: draft(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_OUTPUT_INVALID' });
    await expectClean(root, target);
  });

  test('preserves a size failure when closing the output descriptor also fails', async () => {
    const root = await temporaryRoot();
    const openWithCloseFailure: typeof open = async (...args) => {
      const handle = await open(...args);
      const originalClose = handle.close.bind(handle);
      handle.close = vi.fn(async () => {
        await originalClose();
        throw new Error('/private/output-close');
      });
      return handle;
    };
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      await truncate(request.outputPath, MAX_PDF_BYTES + 1);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat, openOutput: openWithCloseFailure, rm },
    });

    await expect(target.run({
      jobId: 'job-size-and-close-failure',
      draft: draft(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'PDF_OUTPUT_TOO_LARGE',
      retryable: false,
    });
    await expectClean(root, target);
  });

  test('maps an output descriptor close-only failure to a safe fixed error', async () => {
    const root = await temporaryRoot();
    const openWithCloseFailure: typeof open = async (...args) => {
      const handle = await open(...args);
      const originalClose = handle.close.bind(handle);
      handle.close = vi.fn(async () => {
        await originalClose();
        throw new Error('/private/output-close');
      });
      return handle;
    };
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat, openOutput: openWithCloseFailure, rm },
    });

    const error = await target.run({
      jobId: 'job-close-only-failure',
      draft: draft(),
      signal: new AbortController().signal,
    }).then(
      () => new Error('expected rejection'),
      reason => reason as PdfJobError,
    );
    expect(error).toMatchObject({ code: 'PDF_OUTPUT_INVALID', retryable: true });
    expect(error.message).not.toContain('/private');
    await expectClean(root, target);
  });

  test('cleans up and releases busy after a worker error', async () => {
    const root = await temporaryRoot();
    const target = controller(root, fakeWorker(async () => {
      throw new PdfJobError('PDF_PROCESS_FAILED', 'safe', true);
    }));

    await expect(target.run({
      jobId: 'job-worker-error', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_PROCESS_FAILED' });
    await expectClean(root, target);
  });

  test('maps a cleanup-only failure safely and always releases busy', async () => {
    const root = await temporaryRoot();
    const removeDirectory = vi.fn<typeof rm>(async (...args) => {
      await rm(...args);
      throw new Error('/private/cable-report-cleanup');
    });
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      fileSystem: { lstat, openOutput: open, rm: removeDirectory },
    });

    const error = await target.run({
      jobId: 'job-cleanup', draft: draft(), signal: new AbortController().signal,
    }).then(
      () => new Error('expected rejection'),
      reason => reason as PdfJobError,
    );
    expect(error).toMatchObject({ code: 'PDF_PROCESS_FAILED' });
    expect(error.message).not.toContain('/private');
    await expectClean(root, target);
  });

  test('preserves the primary job error when cleanup also fails', async () => {
    const root = await temporaryRoot();
    const removeDirectory = vi.fn<typeof rm>(async (...args) => {
      await rm(...args);
      throw new Error('/private/cable-report-cleanup');
    });
    const target = controller(root, fakeWorker(async () => {
      throw new PdfJobError('PDF_PROTOCOL_INVALID', 'safe protocol failure', false);
    }), {
      fileSystem: { lstat, openOutput: open, rm: removeDirectory },
    });

    await expect(target.run({
      jobId: 'job-primary', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_PROTOCOL_INVALID' });
    await expectClean(root, target);
  });
});

describe('PdfJobController safe structured logging', () => {
  const safeKeys = [
    'cableType',
    'durationMs',
    'errorCode',
    'exitCode',
    'jobId',
    'phase',
    'recordCount',
  ].sort();

  function expectSafeEvents(events: unknown[]) {
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const event of events) {
      expect(Object.keys(event as object).sort()).toEqual(safeKeys);
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/SECRET-SITE|SECRET-LABEL|10-07-2026|\/templates\//);
  }

  test('logs only the allowed fields for a successful job', async () => {
    const root = await temporaryRoot();
    const events: unknown[] = [];
    const target = controller(root, fakeWorker(async request => {
      await writeValidPdf(request);
      return { pages: 1, records: 1 };
    }), {
      logger: event => events.push(event),
    });

    await target.run({
      jobId: 'job-log-success',
      draft: draft({
        site: 'SECRET-SITE',
        records: [{ ...draft().records[0]!, cableLabel: 'SECRET-LABEL' }],
      }),
      signal: new AbortController().signal,
    });

    expect(events.map(event => (event as { phase: string }).phase))
      .toEqual(['started', 'completed']);
    expect((events.at(-1) as { exitCode: number | null }).exitCode).toBe(0);
    expectSafeEvents(events);
  });

  test('logs a fixed error code without the worker failure message', async () => {
    const root = await temporaryRoot();
    const events: unknown[] = [];
    const target = controller(root, fakeWorker(async () => {
      throw new PdfJobError(
        'PDF_PROCESS_FAILED',
        '/private/traceback SECRET-LABEL',
        true,
      );
    }), {
      logger: event => events.push(event),
    });

    await expect(target.run({
      jobId: 'job-log-failure', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_PROCESS_FAILED' });
    expect(events.map(event => (event as { phase: string }).phase))
      .toEqual(['started', 'failed']);
    expect((events.at(-1) as { errorCode: string }).errorCode)
      .toBe('PDF_PROCESS_FAILED');
    expect((events.at(-1) as { exitCode: number | null }).exitCode).toBeNull();
    expect(JSON.stringify(events)).not.toMatch(/private|traceback|SECRET-LABEL/);
    expectSafeEvents(events);
  });

  test('logs a known nonzero worker exit code without worker output', async () => {
    const root = await temporaryRoot();
    const events: unknown[] = [];
    const workerError = new PdfJobError(
      'PDF_PROCESS_FAILED',
      '/private/worker output',
      true,
      3,
    );
    const target = controller(root, fakeWorker(async () => {
      throw workerError;
    }), {
      logger: event => events.push(event),
    });

    await expect(target.run({
      jobId: 'job-log-exit', draft: draft(), signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PDF_PROCESS_FAILED' });
    expect(events.at(-1)).toMatchObject({
      phase: 'failed',
      exitCode: 3,
      errorCode: 'PDF_PROCESS_FAILED',
    });
    expect(JSON.stringify(events)).not.toMatch(/private|worker output/);
    expectSafeEvents(events);
  });

  test('logs cancellation as a safe failed terminal event', async () => {
    const root = await temporaryRoot();
    const caller = new AbortController();
    const started = deferred();
    const events: unknown[] = [];
    const target = controller(root, fakeWorker(async request => {
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    }), {
      logger: event => events.push(event),
    });
    const running = target.run({
      jobId: 'job-log-cancel', draft: draft(), signal: caller.signal,
    });
    await started.promise;

    caller.abort();

    await expect(running).rejects.toMatchObject({ code: 'REPORT_CANCELLED' });
    expect((events.at(-1) as { errorCode: string }).errorCode)
      .toBe('REPORT_CANCELLED');
    expectSafeEvents(events);
  });
});

describe('process-backed PdfWorker protocol boundary', () => {
  const command = {
    command: 'python3',
    argsPrefix: ['/app/scripts/pdf_editor.py'],
    env: { ...process.env, PDF_ENV: 'safe' },
  };

  test('uses argv arrays and accepts only exit zero with ok true report.pdf', async () => {
    const root = await temporaryRoot();
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: '{"ok":true,"output":"report.pdf","pages":2,"records":1}\n',
      stderrTail: '',
      durationMs: 10,
    }));
    const worker = createPdfWorker({
      resolveCommand: () => command,
      runProcess,
    });
    const request = workerRequest(root);

    await expect(worker.execute(request)).resolves.toEqual({ pages: 2, records: 1 });
    expect(runProcess).toHaveBeenCalledWith({
      command: 'python3',
      args: [
        '/app/scripts/pdf_editor.py',
        request.templatePath,
        request.outputPath,
        request.requestPath,
      ],
      cwd: request.cwd,
      env: command.env,
      signal: request.signal,
      stderrPath: request.stderrPath,
    });
  });

  test.each([
    {
      name: 'nonzero failure',
      exitCode: 3,
      stdout: '{"ok":false,"code":"PDF_RENDER_FAILED","message":"private"}\n',
      code: 'PDF_PROCESS_FAILED',
    },
    {
      name: 'invalid stdout',
      exitCode: 0,
      stdout: 'debug\n',
      code: 'PDF_PROTOCOL_INVALID',
    },
    {
      name: 'zero exit failure mismatch',
      exitCode: 0,
      stdout: '{"ok":false,"code":"PDF_RENDER_FAILED","message":"private"}\n',
      code: 'PDF_PROTOCOL_INVALID',
    },
    {
      name: 'nonzero success mismatch',
      exitCode: 3,
      stdout: '{"ok":true,"output":"report.pdf","pages":1,"records":1}\n',
      code: 'PDF_PROTOCOL_INVALID',
    },
    {
      name: 'wrong output basename',
      exitCode: 0,
      stdout: '{"ok":true,"output":"other.pdf","pages":1,"records":1}\n',
      code: 'PDF_PROTOCOL_INVALID',
    },
  ])('maps $name to a fixed safe error', async ({ exitCode, stdout, code }) => {
    const root = await temporaryRoot();
    const worker = createPdfWorker({
      resolveCommand: () => command,
      runProcess: async () => ({
        exitCode,
        stdout,
        stderrTail: '/private/worker traceback SITE 10-07-2026',
        durationMs: 10,
      }),
    });

    const error = await worker.execute(workerRequest(root)).then(
      () => new Error('expected rejection'),
      reason => reason as PdfJobError,
    );
    expect(error).toMatchObject({ code });
    if (exitCode !== 0) expect(error).toMatchObject({ exitCode });
    expect(error.message).not.toMatch(/private|traceback|SITE|10-07-2026/);
  });
});

describe('shell-free Python command discovery', () => {
  test('falls back from python3 to python on Unix', () => {
    const result = resolvePythonCommand({
      platform: 'darwin',
      environment: { ...process.env, PYTHON_CMD: undefined, PYTHON: undefined },
      isAvailable: command => command === 'python',
    });

    expect(result).toEqual({ command: 'python', argsPrefix: [] });
  });

  test('falls back from python to py -3 on Windows', () => {
    const result = resolvePythonCommand({
      platform: 'win32',
      environment: { ...process.env, PYTHON_CMD: undefined, PYTHON: undefined },
      isAvailable: (command, argsPrefix) => (
        command === 'py' && argsPrefix.length === 1 && argsPrefix[0] === '-3'
      ),
    });

    expect(result).toEqual({ command: 'py', argsPrefix: ['-3'] });
  });

  test('prefers an available configured PYTHON_CMD without building a shell string', () => {
    const result = resolvePythonCommand({
      platform: 'linux',
      environment: { ...process.env, PYTHON_CMD: '/opt/python-custom' },
      isAvailable: command => command === '/opt/python-custom',
    });

    expect(result).toEqual({ command: '/opt/python-custom', argsPrefix: [] });
  });
});
