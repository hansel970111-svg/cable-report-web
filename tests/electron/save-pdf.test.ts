import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';


type SavePdfRequest = { suggestedName: string; bytes: ArrayBuffer };
type SavePdfResult =
  | { status: 'saved'; fileName: string }
  | { status: 'cancelled' }
  | {
      status: 'error';
      code: 'INVALID_PDF' | 'PDF_TOO_LARGE' | 'SAVE_FAILED' | 'IPC_FORBIDDEN';
      message: string;
      retryable: boolean;
    };

type SaveDependencies = {
  showSaveDialog(options: unknown): Promise<{ canceled: boolean; filePath?: string }>;
  writeAndSyncTemporary(path: string, bytes: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  randomUUID(): string;
};

type SaveHandler = (
  event: { sender: object },
  request: SavePdfRequest,
) => Promise<SavePdfResult>;

type SavePdfModule = {
  MAX_PDF_BYTES: number;
  sanitizeSuggestedPdfName(value: unknown): string;
  validatePdfBytes(bytes: ArrayBuffer, maxBytes?: number): Buffer;
  writeAndSyncTemporary(
    path: string,
    bytes: Buffer,
    openFile?: (
      path: string,
      flags: string,
      mode: number,
    ) => Promise<{
      writeFile(bytes: Buffer): Promise<void>;
      sync(): Promise<void>;
      close(): Promise<void>;
    }>,
  ): Promise<void>;
  savePdfAtomically(
    dependencies: SaveDependencies,
    request: SavePdfRequest,
    maxBytes?: number,
  ): Promise<SavePdfResult>;
  registerSavePdfHandler(input: {
    ipcMain: {
      removeHandler(channel: string): void;
      handle(channel: string, handler: SaveHandler): void;
    };
    getMainWindow(): {
      isDestroyed(): boolean;
      webContents: object;
    } | null;
    savePdf(window: object, request: SavePdfRequest): Promise<SavePdfResult>;
  }): () => void;
};

const require = createRequire(import.meta.url);
const savePdf = require('../../electron/save-pdf.cjs') as SavePdfModule;

const validPdfBytes = (text = '%PDF-1.7\n') => new TextEncoder().encode(text).buffer;

const invalidPdfResult = {
  status: 'error',
  code: 'INVALID_PDF',
  message: 'PDF 文件无效',
  retryable: false,
} as const;
const tooLargeResult = {
  status: 'error',
  code: 'PDF_TOO_LARGE',
  message: 'PDF 文件超过大小限制',
  retryable: false,
} as const;
const saveFailedResult = {
  status: 'error',
  code: 'SAVE_FAILED',
  message: '保存 PDF 失败',
  retryable: true,
} as const;
const forbiddenResult = {
  status: 'error',
  code: 'IPC_FORBIDDEN',
  message: '无权保存 PDF',
  retryable: false,
} as const;

function saveDependencies(
  overrides: Partial<SaveDependencies> = {},
): SaveDependencies {
  return {
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/reports/report.pdf' })),
    writeAndSyncTemporary: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    randomUUID: vi.fn(() => 'fixed-id'),
    ...overrides,
  };
}

describe('sanitizeSuggestedPdfName', () => {
  test.each([
    ['../Site MPO', 'Site MPO.pdf'],
    ['C:\\private\\Site Cat5e.PDF', 'Site Cat5e.pdf'],
    ['/private/mixed\\Site LC', 'Site LC.pdf'],
    ['...hidden?:name.txt', 'hidden_name.txt.pdf'],
    ['', 'report.pdf'],
  ])('turns %j into the safe PDF basename %j', (input, expected) => {
    expect(savePdf.sanitizeSuggestedPdfName(input)).toBe(expected);
  });
});

describe('validatePdfBytes', () => {
  test('accepts the required PDF signature and preserves exact bytes', () => {
    const input = validPdfBytes();

    const result = savePdf.validatePdfBytes(input);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(Buffer.from(input))).toBe(true);
  });

  test.each(['', 'PDF-1.7', ' %PDF-1.7'])('rejects invalid PDF bytes %j', text => {
    expect(() => savePdf.validatePdfBytes(validPdfBytes(text))).toThrowError(
      expect.objectContaining({ code: 'INVALID_PDF' }),
    );
  });

  test('uses a strict greater-than check for an injected 8-byte limit', () => {
    expect(savePdf.validatePdfBytes(validPdfBytes('%PDF-1.7'), 8)).toHaveLength(8);
    expect(() => savePdf.validatePdfBytes(validPdfBytes('%PDF-1.7\n'), 8)).toThrowError(
      expect.objectContaining({ code: 'PDF_TOO_LARGE' }),
    );
  });

  test('exports the 256 MiB production default', () => {
    expect(savePdf.MAX_PDF_BYTES).toBe(256 * 1024 * 1024);
  });
});

describe('writeAndSyncTemporary', () => {
  test('uses exclusive 0600 creation then writes, syncs, and closes in order', async () => {
    const calls: string[] = [];
    const handle = {
      writeFile: vi.fn(async () => {
        calls.push('write');
      }),
      sync: vi.fn(async () => {
        calls.push('sync');
      }),
      close: vi.fn(async () => {
        calls.push('close');
      }),
    };
    const openFile = vi.fn(async () => handle);
    const bytes = Buffer.from(validPdfBytes());

    await savePdf.writeAndSyncTemporary('/reports/report.pdf.id.tmp', bytes, openFile);

    expect(openFile).toHaveBeenCalledWith('/reports/report.pdf.id.tmp', 'wx', 0o600);
    expect(handle.writeFile).toHaveBeenCalledWith(bytes);
    expect(calls).toEqual(['write', 'sync', 'close']);
  });

  test('closes the exclusive handle when writing fails', async () => {
    const failure = new Error('/private/path must not escape');
    const handle = {
      writeFile: vi.fn(async () => {
        throw failure;
      }),
      sync: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    await expect(
      savePdf.writeAndSyncTemporary(
        '/reports/report.pdf.id.tmp',
        Buffer.from(validPdfBytes()),
        async () => handle,
      ),
    ).rejects.toBe(failure);
    expect(handle.sync).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });
});

describe('savePdfAtomically', () => {
  test('cancelled native save performs no write', async () => {
    const writes: string[] = [];
    const showSaveDialog = vi.fn(async () => ({ canceled: true }));
    const dependencies = saveDependencies({
      showSaveDialog,
      writeAndSyncTemporary: async path => {
        writes.push(path);
      },
    });

    const result = await savePdf.savePdfAtomically(dependencies, {
      suggestedName: '../Site MPO',
      bytes: validPdfBytes(),
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(writes).toEqual([]);
    expect(dependencies.rename).not.toHaveBeenCalled();
    expect(dependencies.remove).not.toHaveBeenCalled();
    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Site MPO.pdf' }),
    );
  });

  test('validates before opening the native dialog', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: true }));
    const dependencies = saveDependencies({ showSaveDialog });

    await expect(
      savePdf.savePdfAtomically(dependencies, {
        suggestedName: 'report.pdf',
        bytes: validPdfBytes('not-pdf'),
      }),
    ).resolves.toEqual(invalidPdfResult);
    await expect(
      savePdf.savePdfAtomically(
        dependencies,
        { suggestedName: 'report.pdf', bytes: validPdfBytes('%PDF-1.7\n') },
        8,
      ),
    ).resolves.toEqual(tooLargeResult);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  test('writes a same-directory temporary file and exposes only the final basename', async () => {
    const calls: string[] = [];
    const dependencies = saveDependencies({
      showSaveDialog: async () => ({
        canceled: false,
        filePath: '/private/customer/reports/final-report',
      }),
      writeAndSyncTemporary: vi.fn(async path => {
        calls.push(`write:${path}`);
      }),
      rename: vi.fn(async (from, to) => {
        calls.push(`rename:${from}->${to}`);
      }),
      remove: vi.fn(async path => {
        calls.push(`remove:${path}`);
      }),
    });

    const result = await savePdf.savePdfAtomically(dependencies, {
      suggestedName: 'ignored.pdf',
      bytes: validPdfBytes(),
    });

    const temporaryPath = '/private/customer/reports/final-report.pdf.fixed-id.tmp';
    expect(calls).toEqual([
      `write:${temporaryPath}`,
      `rename:${temporaryPath}->/private/customer/reports/final-report.pdf`,
      `remove:${temporaryPath}`,
    ]);
    expect(result).toEqual({ status: 'saved', fileName: 'final-report.pdf' });
    expect(JSON.stringify(result)).not.toContain('/private/customer');
  });

  test('strips a Windows path from the public success result', async () => {
    const dependencies = saveDependencies({
      showSaveDialog: async () => ({
        canceled: false,
        filePath: 'C:\\private\\customer\\report.PDF',
      }),
    });

    await expect(
      savePdf.savePdfAtomically(dependencies, {
        suggestedName: 'report.pdf',
        bytes: validPdfBytes(),
      }),
    ).resolves.toEqual({ status: 'saved', fileName: 'report.PDF' });
  });

  test.each(['write', 'rename'] as const)(
    'cleans the temporary file and returns a safe result when %s fails',
    async stage => {
      const privatePath = '/private/customer/report.pdf';
      const failure = new Error(`${privatePath} could not be saved`);
      const temporaryPath = `${privatePath}.fixed-id.tmp`;
      const dependencies = saveDependencies({
        showSaveDialog: async () => ({ canceled: false, filePath: privatePath }),
        writeAndSyncTemporary: vi.fn(async () => {
          if (stage === 'write') throw failure;
        }),
        rename: vi.fn(async () => {
          if (stage === 'rename') throw failure;
        }),
      });

      const result = await savePdf.savePdfAtomically(dependencies, {
        suggestedName: 'report.pdf',
        bytes: validPdfBytes(),
      });

      expect(result).toEqual(saveFailedResult);
      expect(JSON.stringify(result)).not.toContain(privatePath);
      expect(dependencies.remove).toHaveBeenCalledWith(temporaryPath);
      if (stage === 'write') expect(dependencies.rename).not.toHaveBeenCalled();
    },
  );

  test('a cleanup failure cannot replace a successful atomic rename', async () => {
    const dependencies = saveDependencies({
      remove: vi.fn(async () => {
        throw new Error('/private/temp path was already renamed');
      }),
    });

    await expect(
      savePdf.savePdfAtomically(dependencies, {
        suggestedName: 'report.pdf',
        bytes: validPdfBytes(),
      }),
    ).resolves.toEqual({ status: 'saved', fileName: 'report.pdf' });
  });

  test('an exclusive-open collision never removes a temporary file it did not create', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cable-report-save-'));
    const finalPath = path.join(directory, 'report.pdf');
    const temporaryPath = `${finalPath}.fixed-id.tmp`;
    const existingContent = 'owned by another save';
    await writeFile(temporaryPath, existingContent, { mode: 0o600 });
    const remove = vi.fn(async candidate => rm(candidate, { force: true }));

    try {
      const result = await savePdf.savePdfAtomically(
        {
          showSaveDialog: async () => ({ canceled: false, filePath: finalPath }),
          writeAndSyncTemporary: savePdf.writeAndSyncTemporary,
          rename,
          remove,
          randomUUID: () => 'fixed-id',
        },
        { suggestedName: 'report.pdf', bytes: validPdfBytes() },
      );

      expect(result).toEqual(saveFailedResult);
      expect(remove).not.toHaveBeenCalled();
      await expect(readFile(temporaryPath, 'utf8')).resolves.toBe(existingContent);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('missing dialog file path fails without creating a temporary file', async () => {
    const dependencies = saveDependencies({
      showSaveDialog: async () => ({ canceled: false }),
    });

    await expect(
      savePdf.savePdfAtomically(dependencies, {
        suggestedName: 'report.pdf',
        bytes: validPdfBytes(),
      }),
    ).resolves.toEqual(saveFailedResult);
    expect(dependencies.writeAndSyncTemporary).not.toHaveBeenCalled();
  });
});

describe('registerSavePdfHandler', () => {
  function setupRegistration() {
    let handler: SaveHandler | undefined;
    const operations: string[] = [];
    const ipcMain = {
      removeHandler: vi.fn(() => {
        operations.push('remove');
      }),
      handle: vi.fn((_channel: string, registeredHandler: typeof handler) => {
        operations.push('handle');
        handler = registeredHandler;
      }),
    };
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {},
    };
    let currentWindow = mainWindow;
    const performSave = vi.fn(async () => ({
      status: 'saved' as const,
      fileName: 'report.pdf',
    }));
    const unregister = savePdf.registerSavePdfHandler({
      ipcMain,
      getMainWindow: () => currentWindow,
      savePdf: performSave,
    });

    if (!handler) throw new Error('handler was not registered');
    return {
      handler,
      ipcMain,
      mainWindow,
      operations,
      performSave,
      setMainWindow: (value: typeof mainWindow) => {
        currentWindow = value;
      },
      unregister,
    };
  }

  test('removes an old handler before registering the fixed channel', () => {
    const { ipcMain, operations } = setupRegistration();

    expect(operations).toEqual(['remove', 'handle']);
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('cable-report:save-pdf');
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'cable-report:save-pdf',
      expect.any(Function),
    );
  });

  test('rejects a sender mismatch without calling the save capability', async () => {
    const { handler, performSave } = setupRegistration();

    const result = await handler(
      { sender: {} },
      { suggestedName: 'report.pdf', bytes: validPdfBytes() },
    );

    expect(result).toEqual(forbiddenResult);
    expect(performSave).not.toHaveBeenCalled();
  });

  test('uses the current live main window for every authorized request', async () => {
    const { handler, mainWindow, performSave, setMainWindow } = setupRegistration();
    const request = { suggestedName: 'report.pdf', bytes: validPdfBytes() };

    await expect(handler({ sender: mainWindow.webContents }, request)).resolves.toEqual({
      status: 'saved',
      fileName: 'report.pdf',
    });

    const replacementWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {},
    };
    setMainWindow(replacementWindow);

    await expect(handler({ sender: mainWindow.webContents }, request)).resolves.toEqual(
      forbiddenResult,
    );
    const result = await handler({ sender: replacementWindow.webContents }, request);

    expect(result).toEqual({ status: 'saved', fileName: 'report.pdf' });
    expect(performSave).toHaveBeenNthCalledWith(1, mainWindow, request);
    expect(performSave).toHaveBeenNthCalledWith(2, replacementWindow, request);
  });

  test('returns IPC_FORBIDDEN for a destroyed window', async () => {
    const { handler, mainWindow, performSave } = setupRegistration();
    mainWindow.isDestroyed.mockReturnValue(true);

    await expect(
      handler(
        { sender: mainWindow.webContents },
        { suggestedName: 'report.pdf', bytes: validPdfBytes() },
      ),
    ).resolves.toEqual(forbiddenResult);
    expect(performSave).not.toHaveBeenCalled();
  });

  test('maps an unexpected save exception without returning its host path', async () => {
    const { handler, mainWindow, performSave } = setupRegistration();
    performSave.mockRejectedValueOnce(new Error('/private/customer/report.pdf'));

    const result = await handler(
      { sender: mainWindow.webContents },
      { suggestedName: 'report.pdf', bytes: validPdfBytes() },
    );

    expect(result).toEqual(saveFailedResult);
    expect(JSON.stringify(result)).not.toContain('/private/customer');
  });

  test('stale cleanup cannot remove a newer registration', () => {
    const first = setupRegistration();
    const secondUnregister = savePdf.registerSavePdfHandler({
      ipcMain: first.ipcMain,
      getMainWindow: () => first.mainWindow,
      savePdf: first.performSave,
    });
    const removalsAfterSecondRegistration = first.ipcMain.removeHandler.mock.calls.length;

    first.unregister();
    expect(first.ipcMain.removeHandler).toHaveBeenCalledTimes(removalsAfterSecondRegistration);

    secondUnregister();
    expect(first.ipcMain.removeHandler).toHaveBeenCalledTimes(
      removalsAfterSecondRegistration + 1,
    );
  });
});

test('preload exposes fixed save and update bridges without exposing ipcRenderer', async () => {
  const source = await readFile('electron/preload.cjs', 'utf8');

  expect(source).toContain("ipcRenderer.invoke('cable-report:get-session-token')");
  expect(source).toContain("ipcRenderer.invoke('cable-report:save-pdf', request)");
  expect(source).toContain("ipcRenderer.invoke('cable-report:check-for-updates')");
  expect(source).toContain("ipcRenderer.invoke('cable-report:download-update')");
  expect(source).toContain("ipcRenderer.invoke('cable-report:install-update')");
  expect(source).toContain('ipcRenderer.on(UPDATE_STATE_CHANNEL, listener)');
  expect(source).toContain('ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener)');
  expect(source).not.toMatch(/\bipcRenderer\s*:/);
  expect(source).not.toContain('ipcRenderer.send(');
});

test('Electron type bridge imports the canonical save contract without redeclaring it', async () => {
  const source = await readFile('src/types/electron.d.ts', 'utf8');

  expect(source).toContain(
    "import type { SavePdfRequest, SavePdfResult } from '@/features/report-workflow/save-contract';",
  );
  expect(source).toContain(
    'savePdf(request: SavePdfRequest): Promise<SavePdfResult>;',
  );
  expect(source).not.toContain('type SavePdfResult');
  expect(source).not.toContain("status: 'saved'");
});

test('main process registers and disposes the native save handler', async () => {
  const source = await readFile('electron/main.cjs', 'utf8');

  expect(source).toContain("require('./save-pdf.cjs')");
  expect(source).toContain('registerSavePdfHandler({');
  expect(source).toContain('getMainWindow: () => mainWindow');
  expect(source).toContain('unregisterSavePdfHandler?.()');
});
