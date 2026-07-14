import path from 'node:path';

import {
  ProcessRunError,
  runProcessTree,
  type ProcessRunResult,
} from './process-runner';
import { parsePdfWorkerStdout } from './protocol';
import { pdfJobError } from './errors';
import { resolvePdfEditorCommand, type WorkerCommand } from './worker-command';

export type PdfWorkerRequest = {
  templatePath: string;
  requestPath: string;
  outputPath: string;
  cwd: string;
  stderrPath: string;
  signal: AbortSignal;
};

export interface PdfWorker {
  execute(request: PdfWorkerRequest): Promise<{ pages: number; records: number }>;
}

type RunProcess = (request: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stderrPath: string;
}) => Promise<ProcessRunResult>;

export type PdfWorkerDependencies = {
  runProcess: RunProcess;
  resolveCommand(): WorkerCommand;
};

const defaults: PdfWorkerDependencies = {
  runProcess: runProcessTree,
  resolveCommand: resolvePdfEditorCommand,
};

function protocolFailure(exitCode: number | null = null) {
  return pdfJobError('PDF_PROTOCOL_INVALID', false, exitCode);
}

export function createPdfWorker(
  overrides: Partial<PdfWorkerDependencies> = {},
): PdfWorker {
  const dependencies = { ...defaults, ...overrides };

  return {
    async execute(request) {
      if (path.basename(request.outputPath) !== 'report.pdf') {
        throw protocolFailure();
      }

      const resolved = dependencies.resolveCommand();
      let processResult: ProcessRunResult;
      try {
        processResult = await dependencies.runProcess({
          command: resolved.command,
          args: [
            ...resolved.argsPrefix,
            request.templatePath,
            request.outputPath,
            request.requestPath,
          ],
          cwd: request.cwd,
          env: resolved.env,
          signal: request.signal,
          stderrPath: request.stderrPath,
        });
      } catch (error) {
        if (error instanceof ProcessRunError) {
          if (error.code === 'PROCESS_ABORTED') throw error;
          if (error.code === 'PROCESS_STDOUT_LIMIT') throw protocolFailure();
        }
        throw pdfJobError('PDF_PROCESS_FAILED', true);
      }

      let protocolResult: ReturnType<typeof parsePdfWorkerStdout>;
      try {
        protocolResult = parsePdfWorkerStdout(processResult.stdout);
      } catch {
        throw protocolFailure(processResult.exitCode);
      }

      const exitSucceeded = processResult.exitCode === 0;
      if (exitSucceeded !== protocolResult.ok) {
        throw protocolFailure(processResult.exitCode);
      }
      if (!protocolResult.ok) {
        throw pdfJobError('PDF_PROCESS_FAILED', true, processResult.exitCode);
      }
      if (protocolResult.output !== 'report.pdf') {
        throw protocolFailure(processResult.exitCode);
      }

      return {
        pages: protocolResult.pages,
        records: protocolResult.records,
      };
    },
  };
}
