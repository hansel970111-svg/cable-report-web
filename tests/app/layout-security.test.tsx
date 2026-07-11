import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import RootLayout, { dynamic } from '@/app/layout';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('layout resolves the browser-development marker at request time', () => {
  expect(dynamic).toBe('force-dynamic');
  vi.stubEnv('CABLE_DEV_BROWSER_MODE', '1');

  const layout = RootLayout({ children: <main /> }) as ReactElement<{
    'data-dev-browser-mode'?: string;
  }>;
  expect(layout.props['data-dev-browser-mode']).toBe('true');
});

test('layout omits the marker unless browser development is explicit', () => {
  vi.stubEnv('CABLE_DEV_BROWSER_MODE', 'true');
  const layout = RootLayout({ children: <main /> }) as ReactElement<{
    'data-dev-browser-mode'?: string;
  }>;
  expect(layout.props['data-dev-browser-mode']).toBeUndefined();
});
