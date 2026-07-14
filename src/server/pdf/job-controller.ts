import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdtemp,
  open,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { CableType, ReportDraft } from '@/domain/report/model';
import { ProcessRunError } from './process-runner';
import {
  PdfJobError,
  pdfJobError,
  type PdfJobErrorCode,
} from './errors';
import type { PdfWorker } from './worker';

export type PdfJobRequest = {
  jobId: string;
  draft: ReportDraft;
  signal: AbortSignal;
};

export type PdfJobResult = {
  bytes: Uint8Array;
  suggestedName: string;
  pages: number;
  records: number;
};

export type PdfJobControllerOptions = {
  worker: PdfWorker;
  templatePathFor: (cableType: CableType) => string;
  suggestedNameFor: (draft: ReportDraft, now: Date) => string;
  tempRoot?: string;
  timeoutMs?: number;
  maxPdfBytes?: number;
  now?: () => Date;
  logger?: PdfJobLogger;
  fileSystem?: PdfJobFileSystem;
};

export type PdfJobLogEvent = {
  jobId: string;
  cableType: CableType;
  recordCount: number;
  phase: 'started' | 'completed' | 'failed';
  durationMs: number;
  exitCode: number | null;
  errorCode: PdfJobErrorCode | null;
};

export type PdfJobLogger = (event: PdfJobLogEvent) => void;

export type PdfJobFileSystem = {
  lstat: typeof lstat;
  openOutput: typeof open;
  rm: typeof rm;
};

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_PDF_BYTES = 256 * 1024 * 1024;
const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
const DEFAULT_FILE_SYSTEM: PdfJobFileSystem = {
  lstat,
  openOutput: open,
  rm,
};

const defaultLogger: PdfJobLogger = event => {
  console.info(JSON.stringify(event));
};

export function toWorkerPayload(draft: ReportDraft) {
  return {
    site: draft.site,
    records: draft.records.map(record => ({
      cable_label: record.cableLabel,
      cable_number: record.cableNumber,
      limit: record.limit,
      result: record.result,
      length: record.length,
      next_margin: record.nextMargin,
      date_time: record.dateTime,
    })),
  };
}

function isSafeSuggestedName(value: string): boolean {
  return (
    value === path.basename(value) &&
    /^[A-Za-z0-9_-]+\.pdf$/.test(value) &&
    !/[\r\n]/.test(value)
  );
}

export class PdfJobController {
  private busy = false;
  private activeStop: (() => void) | null = null;
  private activeCompletion: Promise<void> | null = null;
  private readonly worker: PdfWorker;
  private readonly templatePathFor: (cableType: CableType) => string;
  private readonly suggestedNameFor: (draft: ReportDraft, now: Date) => string;
  private readonly tempRoot: string;
  private readonly timeoutMs: number;
  private readonly maxPdfBytes: number;
  private readonly now: () => Date;
  private readonly logger: PdfJobLogger;
  private readonly fileSystem: PdfJobFileSystem;

  constructor(options: PdfJobControllerOptions) {
    this.worker = options.worker;
    this.templatePathFor = options.templatePathFor;
    this.suggestedNameFor = options.suggestedNameFor;
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxPdfBytes = options.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? defaultLogger;
    this.fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.maxPdfBytes) || this.maxPdfBytes <= 0) {
      throw new TypeError('maxPdfBytes must be a positive safe integer');
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  async shutdown(): Promise<void> {
    const completion = this.activeCompletion;
    this.activeStop?.();
    await completion;
  }

  private log(
    request: PdfJobRequest,
    phase: PdfJobLogEvent['phase'],
    startedAt: number,
    errorCode: PdfJobErrorCode | null,
    exitCode: number | null,
  ): void {
    try {
      this.logger({
        jobId: request.jobId,
        cableType: request.draft.cableType,
        recordCount: request.draft.records.length,
        phase,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        exitCode,
        errorCode,
      });
    } catch {
      // Diagnostics must never affect job ownership or public results.
    }
  }

  private normalizeFailure(
    error: unknown,
    stopReason: 'cancelled' | 'timeout' | 'shutdown' | undefined,
  ): PdfJobError {
    if (stopReason === 'cancelled' || stopReason === 'shutdown') {
      return pdfJobError('REPORT_CANCELLED', false);
    }
    if (stopReason === 'timeout') return pdfJobError('REPORT_TIMEOUT', true);
    if (error instanceof PdfJobError) {
      return pdfJobError(error.code, error.retryable, error.exitCode);
    }
    if (error instanceof ProcessRunError && error.code === 'PROCESS_ABORTED') {
      return pdfJobError('PDF_PROCESS_FAILED', true);
    }
    return pdfJobError('PDF_PROCESS_FAILED', true);
  }

  private async readValidatedOutput(
    outputPath: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    let pathStat;
    try {
      pathStat = await this.fileSystem.lstat(outputPath, { bigint: true });
    } catch {
      throw pdfJobError('PDF_OUTPUT_INVALID', true);
    }
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw pdfJobError('PDF_OUTPUT_INVALID', true);
    }

    const noFollow = process.platform === 'win32'
      ? 0
      : fsConstants.O_NOFOLLOW;
    let handle;
    try {
      handle = await this.fileSystem.openOutput(
        outputPath,
        fsConstants.O_RDONLY | noFollow,
      );
    } catch {
      throw pdfJobError('PDF_OUTPUT_INVALID', true);
    }

    let primaryError: unknown;
    try {
      const openedStat = await handle.stat({ bigint: true });
      if (
        !openedStat.isFile() ||
        openedStat.dev !== pathStat.dev ||
        openedStat.ino !== pathStat.ino ||
        openedStat.size < BigInt(PDF_HEADER.length)
      ) {
        throw pdfJobError('PDF_OUTPUT_INVALID', true);
      }
      if (openedStat.size > BigInt(this.maxPdfBytes)) {
        throw pdfJobError('PDF_OUTPUT_TOO_LARGE', false);
      }

      const size = Number(openedStat.size);
      const output = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        if (signal.aborted) throw signal.reason;
        const { bytesRead } = await handle.read(
          output,
          offset,
          size - offset,
          offset,
        );
        if (bytesRead === 0) {
          throw pdfJobError('PDF_OUTPUT_INVALID', true);
        }
        offset += bytesRead;
      }

      const growthProbe = new Uint8Array(1);
      const { bytesRead: extraBytes } = await handle.read(
        growthProbe,
        0,
        1,
        size,
      );
      const finalStat = await handle.stat({ bigint: true });
      if (extraBytes !== 0 || finalStat.size !== openedStat.size) {
        throw pdfJobError('PDF_OUTPUT_INVALID', true);
      }
      if (!Buffer.from(output.subarray(0, PDF_HEADER.length)).equals(PDF_HEADER)) {
        throw pdfJobError('PDF_OUTPUT_INVALID', true);
      }
      return output;
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await handle.close();
      } catch {
        if (primaryError === undefined) {
          throw pdfJobError('PDF_OUTPUT_INVALID', true);
        }
      }
    }
  }

  async run(request: PdfJobRequest): Promise<PdfJobResult> {
    const startedAt = performance.now();
    if (this.busy) {
      const busy = pdfJobError('REPORT_BUSY', true);
      this.log(request, 'failed', startedAt, busy.code, null);
      throw busy;
    }
    this.busy = true;
    this.log(request, 'started', startedAt, null, null);

    let directory: string | undefined;
    let stopReason: 'cancelled' | 'timeout' | 'shutdown' | undefined;
    const combined = new AbortController();
    const stop = (reason: 'cancelled' | 'timeout' | 'shutdown') => {
      if (stopReason !== undefined) return;
      stopReason = reason;
      combined.abort();
    };
    let resolveCompletion!: () => void;
    const completion = new Promise<void>(resolve => {
      resolveCompletion = resolve;
    });
    this.activeStop = () => stop('shutdown');
    this.activeCompletion = completion;
    const onCallerAbort = () => stop('cancelled');
    request.signal.addEventListener('abort', onCallerAbort, { once: true });
    if (request.signal.aborted) onCallerAbort();
    const timeoutId = setTimeout(() => stop('timeout'), this.timeoutMs);

    const throwIfStopped = () => {
      if (stopReason === 'cancelled' || stopReason === 'shutdown') {
        throw pdfJobError('REPORT_CANCELLED', false);
      }
      if (stopReason === 'timeout') throw pdfJobError('REPORT_TIMEOUT', true);
    };

    let resultValue: PdfJobResult | undefined;
    let failure: PdfJobError | undefined;
    try {
      throwIfStopped();
      directory = await mkdtemp(path.join(this.tempRoot, 'cable-report-'));
      throwIfStopped();

      const requestPath = path.join(directory, 'request.json');
      const outputPath = path.join(directory, 'report.pdf');
      const stderrPath = path.join(directory, 'worker.log');
      await writeFile(
        requestPath,
        JSON.stringify(toWorkerPayload(request.draft)),
        'utf8',
      );
      throwIfStopped();

      const result = await this.worker.execute({
        templatePath: this.templatePathFor(request.draft.cableType),
        requestPath,
        outputPath,
        cwd: directory,
        stderrPath,
        signal: combined.signal,
      });
      throwIfStopped();

      if (
        !Number.isSafeInteger(result.pages) || result.pages <= 0 ||
        result.records !== request.draft.records.length
      ) {
        throw pdfJobError('PDF_OUTPUT_INVALID', true);
      }

      const output = await this.readValidatedOutput(outputPath, combined.signal);
      throwIfStopped();

      const suggestedName = this.suggestedNameFor(request.draft, this.now());
      if (!isSafeSuggestedName(suggestedName)) {
        throw pdfJobError('PDF_OUTPUT_INVALID', false);
      }
      resultValue = {
        bytes: output,
        suggestedName,
        pages: result.pages,
        records: result.records,
      };
    } catch (error) {
      failure = this.normalizeFailure(error, stopReason);
    } finally {
      clearTimeout(timeoutId);
      request.signal.removeEventListener('abort', onCallerAbort);
      try {
        if (directory !== undefined) {
          await this.fileSystem.rm(directory, { recursive: true, force: true });
        }
      } catch {
        failure ??= pdfJobError('PDF_PROCESS_FAILED', true);
      } finally {
        this.busy = false;
        if (this.activeCompletion === completion) {
          this.activeStop = null;
          this.activeCompletion = null;
        }
        resolveCompletion();
      }
    }

    if (failure !== undefined) {
      this.log(request, 'failed', startedAt, failure.code, failure.exitCode);
      throw failure;
    }
    if (resultValue === undefined) {
      const missing = pdfJobError('PDF_PROCESS_FAILED', true);
      this.log(request, 'failed', startedAt, missing.code, null);
      throw missing;
    }
    this.log(request, 'completed', startedAt, null, 0);
    return resultValue;
  }
}
