const { randomUUID: nodeRandomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');


const SAVE_PDF_CHANNEL = 'cable-report:save-pdf';
const MAX_PDF_BYTES = 256 * 1024 * 1024;
const TEMPORARY_FILE_CREATED = Symbol('temporaryFileCreated');

const ERROR_DETAILS = Object.freeze({
  INVALID_PDF: Object.freeze({ message: 'PDF 文件无效', retryable: false }),
  PDF_TOO_LARGE: Object.freeze({ message: 'PDF 文件超过大小限制', retryable: false }),
  SAVE_FAILED: Object.freeze({ message: '保存 PDF 失败', retryable: true }),
  IPC_FORBIDDEN: Object.freeze({ message: '无权保存 PDF', retryable: false }),
});

const activeRegistrations = new WeakMap();

function errorResult(code) {
  const details = ERROR_DETAILS[code];
  return {
    status: 'error',
    code,
    message: details.message,
    retryable: details.retryable,
  };
}

function protocolError(code) {
  return Object.assign(new Error(code), { code });
}

function dualPlatformBasename(value) {
  return path.win32.basename(path.posix.basename(String(value)));
}

function sanitizeSuggestedPdfName(value) {
  const base = path.win32.basename(path.posix.basename(String(value || 'report.pdf')));
  const safe = base
    .replace(/[^a-zA-Z0-9 ._-]+/g, '_')
    .replace(/^\.+/, '')
    .trim() || 'report';
  return `${safe.replace(/\.pdf$/i, '')}.pdf`;
}

function validatePdfBytes(bytes, maxBytes = MAX_PDF_BYTES) {
  let buffer;
  try {
    if (Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]') {
      throw protocolError('INVALID_PDF');
    }
    buffer = Buffer.from(bytes);
  } catch {
    throw protocolError('INVALID_PDF');
  }

  if (buffer.byteLength > maxBytes) {
    throw protocolError('PDF_TOO_LARGE');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw protocolError('INVALID_PDF');
  }
  return buffer;
}

async function writeAndSyncTemporary(
  temporaryPath,
  bytes,
  openFile = fs.open,
) {
  let handle;
  try {
    try {
      handle = await openFile(temporaryPath, 'wx', 0o600);
    } catch {
      const error = new Error('temporary file was not created');
      error[TEMPORARY_FILE_CREATED] = false;
      throw error;
    }
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
}

function forcePdfExtension(filePath) {
  const value = String(filePath || '');
  if (!value || value.includes('\0')) throw new Error('invalid save path');
  return /\.pdf$/i.test(value) ? value : `${value}.pdf`;
}

async function savePdfAtomically(
  dependencies,
  request,
  maxBytes = MAX_PDF_BYTES,
) {
  let bytes;
  try {
    bytes = validatePdfBytes(request?.bytes, maxBytes);
  } catch (error) {
    return errorResult(error?.code === 'PDF_TOO_LARGE' ? 'PDF_TOO_LARGE' : 'INVALID_PDF');
  }

  let temporaryPath;
  let cleanupTemporary = false;
  try {
    const suggestedName = sanitizeSuggestedPdfName(request?.suggestedName);
    const dialogResult = await dependencies.showSaveDialog({
      title: '保存 PDF 报告',
      buttonLabel: '保存',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (dialogResult?.canceled) return { status: 'cancelled' };
    if (!dialogResult?.filePath) return errorResult('SAVE_FAILED');

    const finalPath = forcePdfExtension(dialogResult.filePath);
    const uuid = (dependencies.randomUUID || nodeRandomUUID)();
    temporaryPath = `${finalPath}.${uuid}.tmp`;
    cleanupTemporary = true;

    await dependencies.writeAndSyncTemporary(temporaryPath, bytes);
    await dependencies.rename(temporaryPath, finalPath);

    return {
      status: 'saved',
      fileName: dualPlatformBasename(finalPath),
    };
  } catch (error) {
    if (error?.[TEMPORARY_FILE_CREATED] === false) {
      cleanupTemporary = false;
    }
    return errorResult('SAVE_FAILED');
  } finally {
    if (temporaryPath && cleanupTemporary) {
      try {
        await dependencies.remove(temporaryPath);
      } catch {
        // Cleanup is best effort and cannot replace the primary save result.
      }
    }
  }
}

function registerSavePdfHandler({ ipcMain, getMainWindow, savePdf }) {
  const previous = activeRegistrations.get(ipcMain);
  if (previous) previous.active = false;

  ipcMain.removeHandler(SAVE_PDF_CHANNEL);

  const registration = { active: true };
  const handler = async (event, request) => {
    let window;
    try {
      window = getMainWindow();
      const destroyed =
        !window ||
        (typeof window.isDestroyed === 'function' && window.isDestroyed());
      if (destroyed || event?.sender !== window.webContents) {
        return errorResult('IPC_FORBIDDEN');
      }
    } catch {
      return errorResult('IPC_FORBIDDEN');
    }

    try {
      return await savePdf(window, request);
    } catch {
      return errorResult('SAVE_FAILED');
    }
  };

  ipcMain.handle(SAVE_PDF_CHANNEL, handler);
  activeRegistrations.set(ipcMain, registration);

  return () => {
    if (!registration.active || activeRegistrations.get(ipcMain) !== registration) {
      return;
    }
    registration.active = false;
    activeRegistrations.delete(ipcMain);
    ipcMain.removeHandler(SAVE_PDF_CHANNEL);
  };
}

module.exports = {
  MAX_PDF_BYTES,
  registerSavePdfHandler,
  sanitizeSuggestedPdfName,
  savePdfAtomically,
  validatePdfBytes,
  writeAndSyncTemporary,
};
