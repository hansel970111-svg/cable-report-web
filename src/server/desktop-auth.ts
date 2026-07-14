import { timingSafeEqual as defaultTimingSafeEqual } from 'node:crypto';

import { apiError } from '@/server/api-error';

export type DesktopAuthInput = {
  origin: string | null;
  token: string | null;
  expectedOrigin: string;
  expectedToken: string;
  devBrowserMode: boolean;
};

export type DesktopAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 403;
      code: 'DESKTOP_TOKEN_REQUIRED' | 'ORIGIN_REJECTED';
    };

export type DesktopAuthEnvironment = Readonly<Record<string, string | undefined>>;

type TimingSafeEqual = typeof defaultTimingSafeEqual;

function isApprovedBrowserDevelopmentOrigin(origin: string | null): boolean {
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin === origin &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export function verifyDesktopRequest(
  input: DesktopAuthInput,
  timingSafeEqual: TimingSafeEqual = defaultTimingSafeEqual,
): DesktopAuthResult {
  if (input.devBrowserMode) {
    return isApprovedBrowserDevelopmentOrigin(input.origin)
      ? { ok: true }
      : { ok: false, status: 403, code: 'ORIGIN_REJECTED' };
  }

  if (!input.expectedOrigin || input.origin !== input.expectedOrigin) {
    return { ok: false, status: 403, code: 'ORIGIN_REJECTED' };
  }

  if (!input.token || !input.expectedToken) {
    return { ok: false, status: 401, code: 'DESKTOP_TOKEN_REQUIRED' };
  }

  const actual = Buffer.from(input.token, 'utf8');
  const expected = Buffer.from(input.expectedToken, 'utf8');
  if (actual.length !== expected.length) {
    return { ok: false, status: 401, code: 'DESKTOP_TOKEN_REQUIRED' };
  }

  return timingSafeEqual(actual, expected)
    ? { ok: true }
    : { ok: false, status: 401, code: 'DESKTOP_TOKEN_REQUIRED' };
}

export function requireDesktopApi(
  request: Request,
  environment: DesktopAuthEnvironment = process.env,
): Response | null {
  const result = verifyDesktopRequest({
    origin: request.headers.get('origin'),
    token: request.headers.get('x-cable-desktop-token'),
    expectedOrigin: environment.CABLE_DESKTOP_ORIGIN ?? '',
    expectedToken: environment.CABLE_DESKTOP_TOKEN ?? '',
    devBrowserMode: environment.CABLE_DEV_BROWSER_MODE === '1',
  });

  if (result.ok) return null;

  const message = result.code === 'ORIGIN_REJECTED'
    ? 'Request origin is not allowed.'
    : 'Desktop session token is required or invalid.';
  return apiError(result.status, result.code, message, false);
}
