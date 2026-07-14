import { expect, test, vi } from 'vitest';

import { spawnDevServer } from '../../scripts/corepack-spawn.mjs';

test('Windows Corepack commands execute the cmd shim through a shell', () => {
  const child = { on: vi.fn() };
  const spawnImpl = vi.fn(() => child);

  expect(
    spawnDevServer({
      cwd: 'C:\\workspace',
      env: { NODE_ENV: 'test' },
      platform: 'win32',
      spawnImpl: spawnImpl as never,
    }),
  ).toBe(child);

  expect(spawnImpl).toHaveBeenCalledWith(
    'corepack.cmd',
    ['pnpm', 'tsx', 'src/server.ts'],
    expect.objectContaining({
      cwd: 'C:\\workspace',
      shell: true,
      windowsHide: false,
    }),
  );
});

test('POSIX Corepack commands execute without a shell', () => {
  const spawnImpl = vi.fn(() => ({ on: vi.fn() }));

  spawnDevServer({
    cwd: '/workspace',
    env: { NODE_ENV: 'test' },
    platform: 'linux',
    spawnImpl: spawnImpl as never,
  });

  expect(spawnImpl).toHaveBeenCalledWith(
    'corepack',
    ['pnpm', 'tsx', 'src/server.ts'],
    expect.objectContaining({ shell: false }),
  );
});
