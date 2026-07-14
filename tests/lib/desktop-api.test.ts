import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  ApiResponseError,
  desktopFetch,
  readApiError,
  requireApiSuccess,
} from '@/lib/desktop-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktopFetch', () => {
  test('overwrites an untrusted token header with the Electron session token', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        href: 'http://127.0.0.1:51234/',
        origin: 'http://127.0.0.1:51234',
      },
      cableReport: {
        getDesktopSessionToken: vi.fn(async () => 'trusted-desktop-token'),
      },
    });

    await desktopFetch('/api/test', {
      headers: {
        Accept: 'application/json',
        'X-Cable-Desktop-Token': 'attacker-controlled',
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.redirect).toBe('error');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Cable-Desktop-Token')).toBe('trusted-desktop-token');
  });

  test('does not invent a desktop token in browser development mode', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        href: 'http://127.0.0.1:51234/',
        origin: 'http://127.0.0.1:51234',
      },
    });

    await desktopFetch('/api/test');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has('X-Cable-Desktop-Token')).toBe(false);
  });

  test('never sends the desktop token to a cross-origin URL', async () => {
    const getDesktopSessionToken = vi.fn(async () => 'must-not-leak');
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: {
        href: 'http://127.0.0.1:51234/',
        origin: 'http://127.0.0.1:51234',
      },
      cableReport: { getDesktopSessionToken },
    });

    await desktopFetch('https://example.com/api/collect', {
      headers: { 'X-Cable-Desktop-Token': 'caller-supplied' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has('X-Cable-Desktop-Token')).toBe(false);
    expect(getDesktopSessionToken).not.toHaveBeenCalled();
  });
});

describe('readApiError', () => {
  test('reads the stable nested API error envelope', async () => {
    const response = Response.json(
      {
        error: {
          code: 'ORIGIN_REJECTED',
          message: 'Request origin is not allowed.',
          retryable: false,
        },
      },
      { status: 403 },
    );
    await expect(readApiError(response)).resolves.toBe('Request origin is not allowed.');
  });

  test('falls back to a useful message for an HTML gateway error', async () => {
    const response = new Response('<!doctype html><title>502</title>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    await expect(readApiError(response)).resolves.toBe(
      '服务器生成 PDF 超时或临时不可用，请稍后重试。',
    );
  });
});

test('requireApiSuccess preserves the stable API message for callers', async () => {
  const response = Response.json(
    {
      error: {
        code: 'DESKTOP_TOKEN_REQUIRED',
        message: 'Desktop session token is required or invalid.',
        retryable: false,
      },
    },
    { status: 401 },
  );

  const failure = requireApiSuccess(response);
  await expect(failure).rejects.toBeInstanceOf(ApiResponseError);
  await expect(failure).rejects.toMatchObject({
    message: 'Desktop session token is required or invalid.',
    status: 401,
  });
});
