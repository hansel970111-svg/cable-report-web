import { NextRequest } from 'next/server';
import { afterEach, expect, test, vi } from 'vitest';

import { config, proxy } from '@/proxy';

const origin = 'http://127.0.0.1:51234';
const token = 'A'.repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(headers: HeadersInit = {}) {
  return new NextRequest(`${origin}/api/load-template`, {
    method: 'POST',
    headers,
  });
}

test('proxy protects every API path with the desktop boundary', async () => {
  expect(config).toEqual({ matcher: '/api/:path*' });
  vi.stubEnv('CABLE_DESKTOP_ORIGIN', origin);
  vi.stubEnv('CABLE_DESKTOP_TOKEN', token);

  const response = proxy(request({ Origin: origin }));
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'DESKTOP_TOKEN_REQUIRED', retryable: false },
  });
});

test('proxy permits an exact desktop request to continue', () => {
  vi.stubEnv('CABLE_DESKTOP_ORIGIN', origin);
  vi.stubEnv('CABLE_DESKTOP_TOKEN', token);

  const response = proxy(
    request({
      Origin: origin,
      'X-Cable-Desktop-Token': token,
    }),
  );
  expect(response.headers.get('x-middleware-next')).toBe('1');
});

test('proxy reads rotated environment values for every request', () => {
  vi.stubEnv('CABLE_DESKTOP_ORIGIN', origin);
  vi.stubEnv('CABLE_DESKTOP_TOKEN', token);
  expect(
    proxy(request({ Origin: origin, 'X-Cable-Desktop-Token': token })).headers.get(
      'x-middleware-next',
    ),
  ).toBe('1');

  vi.stubEnv('CABLE_DESKTOP_TOKEN', 'B'.repeat(43));
  expect(
    proxy(request({ Origin: origin, 'X-Cable-Desktop-Token': token })).status,
  ).toBe(401);
});
