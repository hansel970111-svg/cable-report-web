import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { importExcel, IMPORT_LIMITS } from '@/features/import-excel/import-excel';
import { ImportExcelError } from '@/features/import-excel/errors';
import { requireDesktopApi } from '@/server/desktop-auth';
import { createImportExcelHandler } from './handler';
import { POST as productionPost } from './route';

const ORIGIN = 'http://127.0.0.1:51234';
const TOKEN = 'A'.repeat(43);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const fixturesDirectory = fileURLToPath(
  new URL('../../../../tests/fixtures/excel/', import.meta.url),
);

type UploadFile = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

function readFixture(fileName: string): Uint8Array {
  return Uint8Array.from(readFileSync(path.join(fixturesDirectory, fileName)));
}

function makeWorkbookBytes(
  sheetName: string,
  rows: readonly (readonly unknown[])[],
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows.map(row => [...row]));
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

function appendFile(formData: FormData, file: UploadFile) {
  const buffer = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(buffer).set(file.bytes);
  formData.append('file', new Blob([buffer], { type: file.mimeType }), file.fileName);
}

function multipartRequest({
  cableType = 'Cat 5e',
  file,
  headers,
}: {
  cableType?: string | null;
  file?: UploadFile;
  headers?: HeadersInit;
}): Request {
  const formData = new FormData();
  if (file) appendFile(formData, file);
  if (cableType !== null) formData.append('cableType', cableType);
  return formDataRequest(formData, headers);
}

function formDataRequest(formData: FormData, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('content-length')) {
    requestHeaders.set('Content-Length', '1024');
  }
  return new Request(`${ORIGIN}/api/import-excel`, {
    method: 'POST',
    headers: requestHeaders,
    body: formData,
  });
}

function fixtureUpload(fileName: string): UploadFile {
  return {
    bytes: readFixture(fileName),
    fileName,
    mimeType: fileName.endsWith('.xls') ? XLS_MIME : XLSX_MIME,
  };
}

function handlerWithAuthentication() {
  return createImportExcelHandler({
    importExcel,
    authenticate: request => requireDesktopApi(request, {
      CABLE_DESKTOP_ORIGIN: ORIGIN,
      CABLE_DESKTOP_TOKEN: TOKEN,
    }),
  });
}

function authenticatedHeaders(overrides: HeadersInit = {}): Headers {
  const headers = new Headers({
    Origin: ORIGIN,
    'X-Cable-Desktop-Token': TOKEN,
  });
  new Headers(overrides).forEach((value, key) => headers.set(key, value));
  return headers;
}

function publicHandler(importer = importExcel) {
  return createImportExcelHandler({
    importExcel: importer,
    authenticate: () => null,
  });
}

async function expectApiError(
  response: Response,
  expected: {
    status: number;
    code: string;
    message: string;
    field?: string;
  },
) {
  expect(response.status).toBe(expected.status);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: expected.code,
      message: expected.message,
      retryable: false,
      ...(expected.field ? { field: expected.field } : {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('desktop authentication boundary', () => {
  it('rejects a missing desktop token before parsing multipart data', async () => {
    const importer = vi.fn(importExcel);
    const handler = createImportExcelHandler({
      importExcel: importer,
      authenticate: request => requireDesktopApi(request, {
        CABLE_DESKTOP_ORIGIN: ORIGIN,
        CABLE_DESKTOP_TOKEN: TOKEN,
      }),
    });
    const request = multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
      headers: { Origin: ORIGIN },
    });
    request.headers.delete('Content-Length');
    const parseForm = vi.spyOn(request, 'formData');

    await expectApiError(await handler(request), {
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
      message: 'Desktop session token is required or invalid.',
    });
    expect(parseForm).not.toHaveBeenCalled();
    expect(importer).not.toHaveBeenCalled();
  });

  it('wires the exported production POST to the desktop authenticator', async () => {
    vi.stubEnv('CABLE_DESKTOP_ORIGIN', ORIGIN);
    vi.stubEnv('CABLE_DESKTOP_TOKEN', TOKEN);

    const response = await productionPost(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
      headers: { Origin: ORIGIN },
    }));

    await expectApiError(response, {
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
      message: 'Desktop session token is required or invalid.',
    });
  });

  it('rejects an invalid token and a wrong Origin', async () => {
    const handler = handlerWithAuthentication();
    const file = fixtureUpload('cat5e-oob.xlsx');

    await expectApiError(await handler(multipartRequest({
      file,
      headers: authenticatedHeaders({ 'X-Cable-Desktop-Token': 'B'.repeat(43) }),
    })), {
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
      message: 'Desktop session token is required or invalid.',
    });
    await expectApiError(await handler(multipartRequest({
      file,
      headers: authenticatedHeaders({ Origin: 'https://evil.example' }),
    })), {
      status: 403,
      code: 'ORIGIN_REJECTED',
      message: 'Request origin is not allowed.',
    });
  });

  it('sanitizes an unexpected authentication failure', async () => {
    const handler = createImportExcelHandler({
      importExcel,
      authenticate: () => {
        throw new Error('auth failed at /private/session-store');
      },
    });
    const response = await handler(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
    }));
    const serialized = await response.clone().text();

    await expectApiError(response, {
      status: 500,
      code: 'EXCEL_PARSE_FAILED',
      message: 'Excel 文件解析失败。',
      field: 'file',
    });
    expect(serialized).not.toContain('/private/session-store');
  });
});

describe('request size and field boundary', () => {
  it.each([
    [null, 411, 'CONTENT_LENGTH_REQUIRED', '请求必须包含 Content-Length。'],
    ['', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
    ['-1', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
    ['1.5', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
    ['1e3', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
    ['NaN', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
    ['1, 2', 400, 'INVALID_CONTENT_LENGTH', 'Content-Length 格式无效。'],
  ])('rejects invalid declared length %s before formData()', async (
    declaredLength,
    status,
    code,
    message,
  ) => {
    const importer = vi.fn(importExcel);
    const handler = publicHandler(importer);
    const headers = new Headers();
    if (declaredLength !== null) headers.set('Content-Length', declaredLength);
    const request = new Request(`${ORIGIN}/api/import-excel`, {
      method: 'POST',
      headers,
    });
    const parseForm = vi.spyOn(request, 'formData');

    await expectApiError(await handler(request), {
      status,
      code,
      message,
      field: 'file',
    });
    expect(parseForm).not.toHaveBeenCalled();
    expect(importer).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared body before formData()', async () => {
    const importer = vi.fn(importExcel);
    const handler = publicHandler(importer);
    const request = new Request(`${ORIGIN}/api/import-excel`, {
      method: 'POST',
      headers: {
        'Content-Length': String(IMPORT_LIMITS.maxBytes + 64 * 1024 + 1),
      },
    });
    const parseForm = vi.spyOn(request, 'formData');

    await expectApiError(await handler(request), {
      status: 413,
      code: 'EXCEL_FILE_TOO_LARGE',
      message: 'Excel 文件不能超过 25 MiB。',
      field: 'file',
    });
    expect(parseForm).not.toHaveBeenCalled();
    expect(importer).not.toHaveBeenCalled();
  });

  it('rejects a file whose actual size exceeds 25 MiB', async () => {
    const importer = vi.fn(importExcel);
    const handler = publicHandler(importer);
    const request = multipartRequest({
      file: {
        bytes: new Uint8Array(IMPORT_LIMITS.maxBytes + 1),
        fileName: 'large.xlsx',
        mimeType: XLSX_MIME,
      },
      headers: {
        'Content-Length': String(IMPORT_LIMITS.maxBytes + 1),
      },
    });

    await expectApiError(await handler(request), {
      status: 413,
      code: 'EXCEL_FILE_TOO_LARGE',
      message: 'Excel 文件不能超过 25 MiB。',
      field: 'file',
    });
    expect(importer).not.toHaveBeenCalled();
  });

  it('accepts an actual file at exactly 25 MiB before importer validation', async () => {
    const result = importExcel(fixtureUpload('cat5e-oob.xlsx'), 'Cat 5e');
    const importer = vi.fn<typeof importExcel>();
    importer.mockReturnValue(result);
    const response = await publicHandler(importer)(multipartRequest({
      file: {
        bytes: new Uint8Array(IMPORT_LIMITS.maxBytes),
        fileName: 'exact.xlsx',
        mimeType: XLSX_MIME,
      },
      headers: {
        'Content-Length': String(IMPORT_LIMITS.maxBytes + 1024),
      },
    }));

    expect(response.status).toBe(200);
    expect(importer).toHaveBeenCalledOnce();
    const firstCall = importer.mock.calls[0];
    if (!firstCall) throw new Error('Expected importer to be called once.');
    expect(firstCall[0].bytes).toHaveLength(IMPORT_LIMITS.maxBytes);
  });

  it('rejects an absent file and an unsupported cable type', async () => {
    const handler = publicHandler();

    await expectApiError(await handler(multipartRequest({})), {
      status: 400,
      code: 'EXCEL_FILE_REQUIRED',
      message: '请选择 Excel 文件。',
      field: 'file',
    });
    await expectApiError(await handler(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
      cableType: 'unknown',
    })), {
      status: 400,
      code: 'UNSUPPORTED_CABLE_TYPE',
      message: '不支持的线缆类型。',
      field: 'cableType',
    });
    await expectApiError(await handler(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
      cableType: null,
    })), {
      status: 400,
      code: 'UNSUPPORTED_CABLE_TYPE',
      message: '不支持的线缆类型。',
      field: 'cableType',
    });
  });

  it('rejects string, duplicate, and unexpected multipart fields', async () => {
    const stringFile = new FormData();
    stringFile.append('file', 'not-a-file');
    stringFile.append('cableType', 'Cat 5e');
    await expectApiError(await publicHandler()(formDataRequest(stringFile)), {
      status: 400,
      code: 'EXCEL_FILE_REQUIRED',
      message: '请选择 Excel 文件。',
      field: 'file',
    });

    const duplicateFile = new FormData();
    appendFile(duplicateFile, fixtureUpload('cat5e-oob.xlsx'));
    appendFile(duplicateFile, fixtureUpload('cat5e-oob.xlsx'));
    duplicateFile.append('cableType', 'Cat 5e');
    await expectApiError(await publicHandler()(formDataRequest(duplicateFile)), {
      status: 400,
      code: 'INVALID_MULTIPART_FORM',
      message: '上传表单格式无效。',
    });

    const duplicateType = new FormData();
    appendFile(duplicateType, fixtureUpload('cat5e-oob.xlsx'));
    duplicateType.append('cableType', 'Cat 5e');
    duplicateType.append('cableType', 'LC');
    await expectApiError(await publicHandler()(formDataRequest(duplicateType)), {
      status: 400,
      code: 'INVALID_MULTIPART_FORM',
      message: '上传表单格式无效。',
    });

    const unexpected = new FormData();
    appendFile(unexpected, fixtureUpload('cat5e-oob.xlsx'));
    unexpected.append('cableType', 'Cat 5e');
    unexpected.append('debug', 'secret');
    await expectApiError(await publicHandler()(formDataRequest(unexpected)), {
      status: 400,
      code: 'INVALID_MULTIPART_FORM',
      message: '上传表单格式无效。',
    });
  });

  it('reads multipart, file bytes, and importer exactly once on success', async () => {
    const source = fixtureUpload('cat5e-oob.xlsx');
    const buffer = new ArrayBuffer(source.bytes.byteLength);
    new Uint8Array(buffer).set(source.bytes);
    const file = new File([buffer], source.fileName, { type: source.mimeType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('cableType', 'Cat 5e');
    const request = new Request(`${ORIGIN}/api/import-excel`, {
      method: 'POST',
      headers: { 'Content-Length': '1024' },
    });
    const parseForm = vi.spyOn(request, 'formData').mockResolvedValue(formData);
    const readBytes = vi.spyOn(file, 'arrayBuffer');
    const result = importExcel(source, 'Cat 5e');
    const importer = vi.fn(() => result);

    const response = await publicHandler(importer)(request);

    expect(response.status).toBe(200);
    expect(parseForm).toHaveBeenCalledOnce();
    expect(readBytes).toHaveBeenCalledOnce();
    expect(importer).toHaveBeenCalledOnce();
  });

  it('rejects cable type before reading file bytes', async () => {
    const source = fixtureUpload('cat5e-oob.xlsx');
    const buffer = new ArrayBuffer(source.bytes.byteLength);
    new Uint8Array(buffer).set(source.bytes);
    const file = new File([buffer], source.fileName, { type: source.mimeType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('cableType', 'unknown');
    const request = new Request(`${ORIGIN}/api/import-excel`, {
      method: 'POST',
      headers: { 'Content-Length': '1024' },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(formData);
    const readBytes = vi.spyOn(file, 'arrayBuffer');
    const importer = vi.fn(importExcel);

    await expectApiError(await publicHandler(importer)(request), {
      status: 400,
      code: 'UNSUPPORTED_CABLE_TYPE',
      message: '不支持的线缆类型。',
      field: 'cableType',
    });
    expect(readBytes).not.toHaveBeenCalled();
    expect(importer).not.toHaveBeenCalled();
  });
});

describe('workbook validation and limits', () => {
  it.each([
    ['extension', { ...fixtureUpload('cat5e-oob.xlsx'), fileName: 'report.csv' }],
    ['MIME', { ...fixtureUpload('cat5e-oob.xlsx'), mimeType: 'text/csv' }],
    ['XLS MIME for XLSX', { ...fixtureUpload('cat5e-oob.xlsx'), mimeType: XLS_MIME }],
    ['XLSX MIME for XLS', { ...fixtureUpload('lc.xls'), mimeType: XLSX_MIME }],
    ['magic', {
      bytes: Uint8Array.from([1, 2, 3, 4]),
      fileName: 'report.xlsx',
      mimeType: XLSX_MIME,
    }],
  ] satisfies readonly (readonly [string, UploadFile])[])(
    'rejects an extension/%s mismatch',
    async (_label, file) => {
      await expectApiError(await publicHandler()(multipartRequest({ file })), {
        status: 400,
        code: 'UNSUPPORTED_EXCEL_FILE',
        message: '仅支持有效的 .xls 或 .xlsx Excel 文件。',
        field: 'file',
      });
    },
  );

  it('maps a Vertical QTY of 5,001 to the approved field error', async () => {
    const bytes = makeWorkbookBytes('Vertical Cabling', [
      ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
      ['DE46', 'RU01', '红', 5001, 30],
    ]);
    await expectApiError(await publicHandler()(multipartRequest({
      cableType: 'Cat 5e (Vertical Cabling)',
      file: { bytes, fileName: 'vertical.xlsx', mimeType: XLSX_MIME },
    })), {
      status: 400,
      code: 'QTY_LIMIT_EXCEEDED',
      message: '单行 QTY 不能超过 5000。',
      field: 'QTY',
    });
  });

  it('rejects cumulative expansion at record 10,001', async () => {
    const bytes = makeWorkbookBytes('Vertical Cabling', [
      ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
      ['DE46', 'RU01', '红', 5000, 30],
      ['DE47', 'RU02', '红', 5000, 30],
      ['DE48', 'RU03', '红', 1, 30],
    ]);
    await expectApiError(await publicHandler()(multipartRequest({
      cableType: 'Cat 5e (Vertical Cabling)',
      file: { bytes, fileName: 'vertical.xlsx', mimeType: XLSX_MIME },
    })), {
      status: 400,
      code: 'RECORD_LIMIT_EXCEEDED',
      message: '导入记录不能超过 10000 条。',
      field: 'records',
    });
  });

  it('sanitizes parser failures and no-match errors', async () => {
    const corrupt = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    await expectApiError(await publicHandler()(multipartRequest({
      file: { bytes: corrupt, fileName: 'corrupt.xlsx', mimeType: XLSX_MIME },
    })), {
      status: 400,
      code: 'EXCEL_PARSE_FAILED',
      message: 'Excel 文件解析失败。',
      field: 'file',
    });

    const noMatch = makeWorkbookBytes('OOB', [
      ['线缆类型', '线号', '线长'],
      ['蓝', 'BLUE', 10],
    ]);
    await expectApiError(await publicHandler()(multipartRequest({
      file: { bytes: noMatch, fileName: 'no-match.xlsx', mimeType: XLSX_MIME },
    })), {
      status: 400,
      code: 'NO_MATCHING_ROWS',
      message: '未找到与所选线缆类型匹配的记录。',
    });
  });

  it('does not expose an unknown importer error or stack', async () => {
    const importer = vi.fn(() => {
      throw new Error('SheetJS failed at /private/secret/report.xlsx\nstack trace');
    });
    const response = await publicHandler(importer)(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
    }));
    const serialized = await response.clone().text();

    await expectApiError(response, {
      status: 500,
      code: 'EXCEL_PARSE_FAILED',
      message: 'Excel 文件解析失败。',
      field: 'file',
    });
    expect(serialized).not.toContain('/private/secret');
    expect(serialized).not.toContain('stack trace');
  });

  it('ignores mutable ImportExcelError details in the public envelope', async () => {
    const importer = vi.fn(() => {
      throw new ImportExcelError(
        'QTY_LIMIT_EXCEEDED',
        'secret row contents',
        true,
        '/private/secret.xlsx:42',
      );
    });
    const response = await publicHandler(importer)(multipartRequest({
      file: fixtureUpload('cat5e-oob.xlsx'),
    }));
    const serialized = await response.clone().text();

    await expectApiError(response, {
      status: 400,
      code: 'QTY_LIMIT_EXCEEDED',
      message: '单行 QTY 不能超过 5000。',
      field: 'QTY',
    });
    expect(serialized).not.toContain('secret row contents');
    expect(serialized).not.toContain('/private/secret.xlsx');
  });
});

describe('successful imports', () => {
  it.each([
    ['cat5e-oob.xlsx', 'Cat 5e'],
    ['lc.xls', 'LC'],
  ])('returns the typed data envelope for %s', async (fileName, cableType) => {
    const response = await publicHandler()(multipartRequest({
      cableType,
      file: fixtureUpload(fileName),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: importExcel(fixtureUpload(fileName), cableType as 'Cat 5e' | 'LC') });
  });
});
