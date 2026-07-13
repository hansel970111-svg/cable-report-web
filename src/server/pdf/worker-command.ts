import fs from 'node:fs';
import path from 'node:path';

import {
  getAppPathCandidates,
  getPythonEnv,
  resolvePythonCommand,
  resolveAppPath,
} from '@/lib/platform';

export type WorkerCommand = {
  command: string;
  argsPrefix: readonly string[];
  env: NodeJS.ProcessEnv;
};

function unique(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

export function resolvePdfEditorCommand(): WorkerCommand {
  const workerName = process.platform === 'win32' ? 'pdf_worker.exe' : 'pdf_worker';
  const candidates = unique([
    process.env.PDF_WORKER_BIN,
    process.env.PDF_WORKER_DIR
      ? path.join(process.env.PDF_WORKER_DIR, workerName)
      : null,
    ...getAppPathCandidates('bin', workerName),
    ...getAppPathCandidates('worker-bin', workerName),
    ...getAppPathCandidates('resources', 'bin', workerName),
  ]);
  const packagedWorker = candidates.find(candidate => fs.existsSync(candidate));
  const env = getPythonEnv();

  if (packagedWorker) {
    return {
      command: packagedWorker,
      argsPrefix:
        process.env.CABLE_DESKTOP_E2E === '1'
        && process.env.CABLE_DESKTOP_E2E_HANG_WORKER === '1'
          ? ['__cable_report_e2e_hang__']
          : ['pdf_editor'],
      env,
    };
  }

  const python = resolvePythonCommand();
  return {
    command: python.command,
    argsPrefix: [
      ...python.argsPrefix,
      resolveAppPath('scripts', 'pdf_editor.py'),
    ],
    env,
  };
}
