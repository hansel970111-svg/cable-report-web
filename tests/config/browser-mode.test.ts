import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import {
  createBrowserDevelopmentEnvironment,
  createStartConfiguration,
} from '../../scripts/browser-mode.mjs';

test('the --browser-dev flag forces loopback and the explicit bypass marker', () => {
  const configuration = createStartConfiguration({
    args: ['--browser-dev'],
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      HOSTNAME: 'public.example',
      CABLE_DEV_BROWSER_MODE: 'stale',
      PORT: '7000',
    },
    workspace: '/workspace',
  });

  expect(configuration.browserDevMode).toBe(true);
  expect(configuration.host).toBe('127.0.0.1');
  expect(configuration.port).toBe('7000');
  expect(configuration.childEnv).toMatchObject({
    CABLE_DEV_BROWSER_MODE: '1',
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
  });
});

test('normal production start removes an inherited browser bypass', () => {
  const configuration = createStartConfiguration({
    args: [],
    env: {
      NODE_ENV: 'production',
      CABLE_DEV_BROWSER_MODE: '1',
      PORT: '7000',
    },
    workspace: '/workspace',
  });

  expect(configuration.browserDevMode).toBe(false);
  expect(configuration.host).toBe('0.0.0.0');
  expect(configuration.childEnv).not.toHaveProperty('CABLE_DEV_BROWSER_MODE');
});

test('the development server always binds the browser bypass to loopback', () => {
  const environment = createBrowserDevelopmentEnvironment(
    { NODE_ENV: 'development', HOST: '0.0.0.0' },
    { workspace: '/workspace', port: '5000' },
  );

  expect(environment).toMatchObject({
    CABLE_DEV_BROWSER_MODE: '1',
    COZE_WORKSPACE_PATH: '/workspace',
    DEPLOY_RUN_PORT: '5000',
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    PORT: '5000',
  });
});

test('the deploy shell entrypoint clears any inherited browser bypass', async () => {
  const source = await readFile('scripts/start.sh', 'utf8');
  const clearBypass = source.indexOf('unset CABLE_DEV_BROWSER_MODE');
  const startServer = source.indexOf('node dist/server.js');

  expect(clearBypass).toBeGreaterThan(-1);
  expect(startServer).toBeGreaterThan(clearBypass);
});
