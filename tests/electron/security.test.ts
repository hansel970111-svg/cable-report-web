import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import { describe, expect, test, vi } from 'vitest';

type NavigationDecision =
  | { kind: 'internal' }
  | { kind: 'external'; url: string }
  | { kind: 'deny' };

type ElectronSecurity = {
  createDesktopSessionToken(randomBytes?: (size: number) => Buffer): string;
  classifyNavigation(targetUrl: string, appOrigin: string): NavigationDecision;
};

const require = createRequire(import.meta.url);
const security = require('../../electron/security.cjs') as ElectronSecurity;

const appOrigin = 'http://127.0.0.1:51234';
const repositoryRoot = 'https://github.com/hansel970111-svg/cable-report-web';

describe('desktop session token', () => {
  test('uses exactly 32 random bytes and base64url encoding', () => {
    const randomBytes = vi.fn((size: number) => Buffer.alloc(size, 7));
    const token = security.createDesktopSessionToken(randomBytes);

    expect(randomBytes).toHaveBeenCalledOnce();
    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(token).toBe(Buffer.alloc(32, 7).toString('base64url'));
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('navigation allowlist', () => {
  test('allows only the exact application origin as internal', () => {
    expect(security.classifyNavigation(`${appOrigin}/`, appOrigin)).toEqual({
      kind: 'internal',
    });
    expect(
      security.classifyNavigation(`${appOrigin}/reports?id=1#summary`, appOrigin),
    ).toEqual({ kind: 'internal' });
  });

  test.each([
    `${repositoryRoot}/releases/latest`,
  ])('allows only the approved GitHub Releases destination %s', (url) => {
    expect(security.classifyNavigation(url, appOrigin)).toEqual({
      kind: 'external',
      url,
    });
  });

  test.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,boom',
    'http://github.com/hansel970111-svg/cable-report-web/',
    'https://github.com.evil.example/hansel970111-svg/cable-report-web/',
    'https://github.com./hansel970111-svg/cable-report-web/',
    'https://github.com/another/repository/',
    `${repositoryRoot}/`,
    `${repositoryRoot}/releases`,
    `${repositoryRoot}/releases/v1.0.0`,
    `${repositoryRoot}/releases/download/v1/report.exe`,
    `${repositoryRoot}/releases/latest?source=desktop`,
    `${repositoryRoot}/releases/latest#download`,
    'https://github.com/hansel970111-svg/cable-report-web/issues',
    'https://github.com@evil.example/hansel970111-svg/cable-report-web/releases',
    'http://127.0.0.1.evil.example:51234/',
    'not a url',
  ])('denies unapproved or malformed destination %s', (url) => {
    expect(security.classifyNavigation(url, appOrigin)).toEqual({ kind: 'deny' });
  });
});

test('Electron window source retains the mandatory isolation controls', async () => {
  const source = await readFile('electron/main.cjs', 'utf8');
  expect(source).toContain("preload: path.join(__dirname, 'preload.cjs')");
  expect(source).toContain('contextIsolation: true');
  expect(source).toContain('nodeIntegration: false');
  expect(source).toContain('sandbox: true');
  expect(source).toContain('webSecurity: true');
  expect(source).toContain('allowRunningInsecureContent: false');
  expect(source).toContain('setPermissionRequestHandler');
  expect(source).toContain('setPermissionCheckHandler');
  expect(source).toContain('setWindowOpenHandler');
  expect(source).toContain("webContents.on('will-navigate'");
  expect(source).toContain("webContents.on('will-redirect'");
  expect(source).toContain("ipcMain.handle('cable-report:get-session-token'");
  expect(source).toContain('senderFrame === mainWindow.webContents.mainFrame');
  expect(source).not.toContain('shell.openExternal(targetUrl)');
  expect(source.match(/shell\.openExternal\(/g)).toHaveLength(1);
  expect(source).not.toContain('getPreferredAsset');
  expect(source).not.toMatch(/autoUpdater|downloadUpdate|quitAndInstall|installUpdate|execFile|spawn\(/);
  expect(source).toContain(
    "if (app.isPackaged && process.env.CABLE_DESKTOP_E2E !== '1')",
  );
  expect(source).toContain('[CABLE_FATAL_UNHANDLED_REJECTION]');
  expect(source).toContain('[CABLE_FATAL_UNCAUGHT_EXCEPTION]');
  expect(source).toContain("Symbol.for('cable-report.pdf-job-shutdown')");
  expect(source).toContain('event.preventDefault()');
  expect(source).toContain('await shutdownPdfJobs()');

  const originAssignment = source.indexOf('process.env.CABLE_DESKTOP_ORIGIN = origin');
  const standaloneInitialization = source.indexOf('require(standaloneServerPath)');
  expect(originAssignment).toBeGreaterThan(-1);
  expect(originAssignment).toBeLessThan(standaloneInitialization);
});

test('preload exposes only the fixed desktop-token bridge', async () => {
  const source = await readFile('electron/preload.cjs', 'utf8');
  expect(source).toContain("contextBridge.exposeInMainWorld(");
  expect(source).toContain("ipcRenderer.invoke('cable-report:get-session-token')");
  expect(source).not.toContain('ipcRenderer.send(');
  expect(source).not.toContain('ipcRenderer.on(');
});
