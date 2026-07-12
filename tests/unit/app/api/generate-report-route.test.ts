import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ReportDraft } from '@/domain/report/model';
import {
  createGenerateReportHandler,
  MAX_REPORT_BODY_BYTES,
} from '@/server/pdf';
import { POST as productionPost } from '@/app/api/generate-report/route';
import { PdfJobError } from '@/server/pdf/errors';


const ORIGIN = 'http://127.0.0.1:51234';
const TOKEN = 'A'.repeat(43);

function record() {
  return {
    id: 'record-1',
    cableLabel: '#1',
    cableNumber: '1',
    limit: 'TIA - Cat 5e Channel',
    result: 'PASS' as const,
    length: 20,
    nextMargin: 10,
    dateTime: '10-07-2026 09:00:00 AM',
  };
}

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    revision: 1,
    cableType: 'Cat 5e',
    site: 'M138-DE46',
    records: [record()],
    ...overrides,
  };
}

function requestWithText(
  text: string,
  options: { contentLength?: string | null; signal?: AbortSignal } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const contentLength = options.contentLength === undefined
    ? String(new TextEncoder().encode(text).byteLength)
    : options.contentLength;
  if (contentLength !== null) headers.set('Content-Length', contentLength);
  return new Request(`${ORIGIN}/api/generate-report`, {
    method: 'POST',
    headers,
    body: text,
    signal: options.signal,
  });
}

function requestWithJson(
  value: unknown,
  options?: { contentLength?: string | null; signal?: AbortSignal },
): Request {
  return requestWithText(JSON.stringify(value), options);
}

function dependencies(overrides: {
  authenticate?: (request: Request) => Response | null;
  run?: (request: {
    jobId: string;
    draft: ReportDraft;
    signal: AbortSignal;
  }) => Promise<{
    bytes: Uint8Array;
    suggestedName: string;
    pages: number;
    records: number;
  }>;
} = {}) {
  return {
    authenticate: vi.fn(overrides.authenticate ?? (() => null)),
    controller: {
      run: vi.fn(overrides.run ?? (async () => ({
        bytes: Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n')),
        suggestedName: 'SITE_Cat_5e_20260710_093000.pdf',
        pages: 2,
        records: 1,
      }))),
    },
    createJobId: vi.fn(() => 'job-safe-1'),
  };
}

async function expectApiError(
  response: Response,
  expected: { status: number; code: string; retryable: boolean },
) {
  expect(response.status).toBe(expected.status);
  const body = await response.json() as {
    error: { code: string; message: string; retryable: boolean };
  };
  expect(body).toEqual({
    error: {
      code: expected.code,
      message: expect.any(String),
      retryable: expected.retryable,
    },
  });
  expect(body.error.message).not.toMatch(/traceback|\/private\/|[A-Z]:\\/i);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('generate-report authentication and body bounds', () => {
  test('authenticates before reading content length or body', async () => {
    const deps = dependencies({
      authenticate: () => Response.json({ error: {
        code: 'DESKTOP_TOKEN_REQUIRED',
        message: 'Desktop session token is required or invalid.',
        retryable: false,
      } }, { status: 401 }),
    });
    const handler = createGenerateReportHandler(deps);
    const request = requestWithJson(draft(), { contentLength: null });
    const readText = vi.spyOn(request, 'text');

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(deps.authenticate).toHaveBeenCalledWith(request);
    expect(readText).not.toHaveBeenCalled();
    expect(deps.controller.run).not.toHaveBeenCalled();
  });

  test.each([
    [null, 411, 'CONTENT_LENGTH_REQUIRED'],
    ['', 400, 'INVALID_CONTENT_LENGTH'],
    ['-1', 400, 'INVALID_CONTENT_LENGTH'],
    ['1.5', 400, 'INVALID_CONTENT_LENGTH'],
    [String(MAX_REPORT_BODY_BYTES + 1), 413, 'REPORT_BODY_TOO_LARGE'],
  ])('rejects declared length %s before request.text()', async (
    contentLength,
    status,
    code,
  ) => {
    const deps = dependencies();
    const handler = createGenerateReportHandler(deps);
    const request = requestWithJson(draft(), { contentLength });
    const readText = vi.spyOn(request, 'text');

    await expectApiError(await handler(request), {
      status,
      code,
      retryable: false,
    });
    expect(readText).not.toHaveBeenCalled();
    expect(deps.controller.run).not.toHaveBeenCalled();
  });

  test('rejects actual UTF-8 bytes over 25 MiB after the declared check', async () => {
    const deps = dependencies();
    const handler = createGenerateReportHandler(deps);
    const text = '€'.repeat(Math.floor(MAX_REPORT_BODY_BYTES / 3) + 1);
    const request = requestWithText(text, {
      contentLength: String(text.length),
    });

    await expectApiError(await handler(request), {
      status: 413,
      code: 'REPORT_BODY_TOO_LARGE',
      retryable: false,
    });
    expect(deps.controller.run).not.toHaveBeenCalled();
  });

  test('wires production POST to desktop authentication', async () => {
    vi.stubEnv('CABLE_DESKTOP_ORIGIN', ORIGIN);
    vi.stubEnv('CABLE_DESKTOP_TOKEN', TOKEN);
    const request = requestWithJson(draft());
    request.headers.set('Origin', ORIGIN);

    await expectApiError(await productionPost(request), {
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
      retryable: false,
    });
  });
});

describe('generate-report schema boundary', () => {
  test('rejects malformed JSON', async () => {
    const deps = dependencies();
    const response = await createGenerateReportHandler(deps)(
      requestWithText('{not-json}'),
    );

    await expectApiError(response, {
      status: 400,
      code: 'REPORT_JSON_INVALID',
      retryable: false,
    });
    expect(deps.controller.run).not.toHaveBeenCalled();
  });

  test.each([
    ['invalid Site', { site: 'SITE_name' }],
    ['invalid cable type', { cableType: 'Cat 6' }],
    ['invalid date', {
      records: [{ ...record(), dateTime: '31-02-2026 09:00:00 AM' }],
    }],
    ['zero records', { records: [] }],
    ['10,001 records', {
      records: Array.from({ length: 10_001 }, (_, index) => ({
        ...record(), id: `record-${index}`,
      })),
    }],
  ])('rejects %s before starting a job', async (_name, patch) => {
    const deps = dependencies();
    const response = await createGenerateReportHandler(deps)(
      requestWithJson({ ...draft(), ...patch }),
    );

    await expectApiError(response, {
      status: 400,
      code: 'REPORT_DRAFT_INVALID',
      retryable: false,
    });
    expect(deps.controller.run).not.toHaveBeenCalled();
  });

  test('passes normalized schema data and the exact request signal', async () => {
    const deps = dependencies();
    const handler = createGenerateReportHandler(deps);
    const request = requestWithJson(draft({ site: '  m138-de46  ' }));

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(deps.controller.run).toHaveBeenCalledWith({
      jobId: 'job-safe-1',
      draft: expect.objectContaining({ site: 'M138-DE46' }),
      signal: request.signal,
    });
  });
});

describe('generate-report result and error presentation', () => {
  test.each([
    ['REPORT_BUSY', 409, true],
    ['REPORT_CANCELLED', 499, false],
    ['REPORT_TIMEOUT', 408, true],
    ['PDF_PROCESS_FAILED', 500, true],
    ['PDF_PROTOCOL_INVALID', 500, false],
    ['PDF_OUTPUT_INVALID', 500, true],
    ['PDF_OUTPUT_TOO_LARGE', 500, false],
  ] as const)('maps %s to HTTP %s', async (code, status, retryable) => {
    const deps = dependencies({
      run: async () => {
        throw new PdfJobError(code, 'safe fixed message', retryable);
      },
    });

    await expectApiError(await createGenerateReportHandler(deps)(
      requestWithJson(draft()),
    ), { status, code, retryable });
  });

  test('sanitizes unknown renderer failures', async () => {
    const deps = dependencies({
      run: async () => {
        throw new Error('/private/tmp/worker.log traceback SITE');
      },
    });
    const response = await createGenerateReportHandler(deps)(requestWithJson(draft()));
    const serialized = await response.clone().text();

    await expectApiError(response, {
      status: 500,
      code: 'PDF_PROCESS_FAILED',
      retryable: true,
    });
    expect(serialized).not.toMatch(/private|traceback|SITE/);
  });

  test('does not trust a PdfJobError message from the controller boundary', async () => {
    const deps = dependencies({
      run: async () => {
        throw new PdfJobError(
          'PDF_PROCESS_FAILED',
          '/private/tmp/worker.log traceback SECRET-SITE',
          true,
        );
      },
    });
    const response = await createGenerateReportHandler(deps)(requestWithJson(draft()));
    const serialized = await response.clone().text();

    await expectApiError(response, {
      status: 500,
      code: 'PDF_PROCESS_FAILED',
      retryable: true,
    });
    expect(serialized).not.toMatch(/private|traceback|SECRET-SITE/);
  });

  test('returns only bounded PDF metadata and no host path', async () => {
    const deps = dependencies();
    const response = await createGenerateReportHandler(deps)(requestWithJson(draft()));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="SITE_Cat_5e_20260710_093000.pdf"',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Report-Pages')).toBe('2');
    expect(response.headers.get('X-Report-Records')).toBe('1');
    expect(response.headers.has('X-Saved-Path')).toBe(false);
    const serializedHeaders = Array.from(response.headers.entries()).flat().join(' ');
    expect(serializedHeaders).not.toMatch(/\/private\/|[A-Z]:\\/i);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString('ascii'))
      .toBe('%PDF-');
  });

  test.each([
    '../report.pdf',
    'folder/report.pdf',
    'C:\\private\\report.pdf',
    'report.pdf"\r\nX-Evil: yes',
    '%2Fprivate%2Freport.pdf',
  ])('rejects an unsafe suggested filename without header injection: %s', async name => {
    const deps = dependencies({
      run: async () => ({
        bytes: Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n')),
        suggestedName: name,
        pages: 1,
        records: 1,
      }),
    });
    const response = await createGenerateReportHandler(deps)(requestWithJson(draft()));
    const serialized = `${Array.from(response.headers.entries()).flat().join(' ')} ${await response.clone().text()}`;

    await expectApiError(response, {
      status: 500,
      code: 'PDF_OUTPUT_INVALID',
      retryable: false,
    });
    expect(serialized).not.toContain(name);
    expect(response.headers.has('X-Evil')).toBe(false);
  });
});
