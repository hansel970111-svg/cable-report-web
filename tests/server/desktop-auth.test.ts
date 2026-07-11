import { describe, expect, test, vi } from 'vitest';

import { apiError } from '@/server/api-error';
import {
  requireDesktopApi,
  verifyDesktopRequest,
} from '@/server/desktop-auth';

const expectedOrigin = 'http://127.0.0.1:51234';
const expectedToken = 'A'.repeat(43);

function productionInput(overrides: Partial<Parameters<typeof verifyDesktopRequest>[0]> = {}) {
  return {
    origin: expectedOrigin,
    token: expectedToken,
    expectedOrigin,
    expectedToken,
    devBrowserMode: false,
    ...overrides,
  };
}

describe('verifyDesktopRequest', () => {
  test('accepts only an exact production origin and token', () => {
    expect(verifyDesktopRequest(productionInput())).toEqual({ ok: true });
    const timingSafeEqual = vi.fn(() => true);
    expect(verifyDesktopRequest(productionInput(), timingSafeEqual)).toEqual({ ok: true });
    expect(timingSafeEqual).toHaveBeenCalledOnce();
  });

  test('returns 401 when the token is absent or invalid', () => {
    expect(verifyDesktopRequest(productionInput({ token: null }))).toEqual({
      ok: false,
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
    });
    expect(verifyDesktopRequest(productionInput({ token: 'B'.repeat(43) }))).toEqual({
      ok: false,
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
    });
  });

  test('returns 403 for an origin mismatch', () => {
    expect(
      verifyDesktopRequest(productionInput({ origin: 'http://localhost:51234' })),
    ).toEqual({ ok: false, status: 403, code: 'ORIGIN_REJECTED' });
  });

  test('never calls timingSafeEqual for unequal byte lengths', () => {
    const timingSafeEqual = vi.fn(() => false);
    expect(verifyDesktopRequest(productionInput({ token: 'short' }), timingSafeEqual)).toEqual({
      ok: false,
      status: 401,
      code: 'DESKTOP_TOKEN_REQUIRED',
    });
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  test('rejects Unicode lookalikes without calling timingSafeEqual', () => {
    const timingSafeEqual = vi.fn(() => false);
    expect(
      verifyDesktopRequest(productionInput({ token: 'Ａ'.repeat(43) }), timingSafeEqual),
    ).toEqual({ ok: false, status: 401, code: 'DESKTOP_TOKEN_REQUIRED' });
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  test.each([
    'http://127.0.0.1:5000',
    'http://localhost:5000',
    'http://localhost',
  ])('allows explicit browser development on loopback origin %s', (origin) => {
    expect(
      verifyDesktopRequest({
        origin,
        token: null,
        expectedOrigin: '',
        expectedToken: '',
        devBrowserMode: true,
      }),
    ).toEqual({ ok: true });
  });

  test.each([
    null,
    'https://localhost:5000',
    'http://localhost.evil.example:5000',
    'http://127.0.0.1.evil.example:5000',
    'http://[::1]:5000',
    'file:///tmp/index.html',
  ])('rejects browser development from non-approved origin %s', (origin) => {
    expect(
      verifyDesktopRequest({
        origin,
        token: null,
        expectedOrigin: '',
        expectedToken: '',
        devBrowserMode: true,
      }),
    ).toEqual({ ok: false, status: 403, code: 'ORIGIN_REJECTED' });
  });
});

describe('API auth boundary', () => {
  test('returns null when a direct route request is authorized', () => {
    const request = new Request(`${expectedOrigin}/api/load-template`, {
      headers: {
        Origin: expectedOrigin,
        'X-Cable-Desktop-Token': expectedToken,
      },
    });
    expect(
      requireDesktopApi(request, {
        CABLE_DESKTOP_ORIGIN: expectedOrigin,
        CABLE_DESKTOP_TOKEN: expectedToken,
      }),
    ).toBeNull();
  });

  test('returns the stable error envelope for an unauthorized request', async () => {
    const request = new Request(`${expectedOrigin}/api/load-template`, {
      headers: { Origin: expectedOrigin },
    });
    const response = requireDesktopApi(request, {
      CABLE_DESKTOP_ORIGIN: expectedOrigin,
      CABLE_DESKTOP_TOKEN: expectedToken,
    });

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'DESKTOP_TOKEN_REQUIRED',
        message: 'Desktop session token is required or invalid.',
        retryable: false,
      },
    });
  });
});

test('apiError includes an optional field without changing the envelope', async () => {
  const response = apiError(422, 'INVALID_FIELD', 'Invalid field.', false, 'site');
  expect(response.status).toBe(422);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: 'INVALID_FIELD',
      message: 'Invalid field.',
      retryable: false,
      field: 'site',
    },
  });
});
