import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from './fixtures';
import { descendantProcesses, processExists } from './launch-packaged';

const RELEASES_URL = 'https://github.com/hansel970111-svg/cable-report-web/releases/latest';

test('packaged renderer API and external navigation stay inside the allowlist', async ({ desktop }) => {
  const unauthenticated = await desktop.window.evaluate(() => (
    fetch('/api/import-excel', { method: 'POST' }).then(response => response.status)
  ));
  expect(unauthenticated).toBe(401);

  await desktop.app.evaluate(async ({ shell }) => {
    const state = globalThis as unknown as { __cableE2eExternalOpens: string[] };
    state.__cableE2eExternalOpens = [];
    shell.openExternal = async url => {
      state.__cableE2eExternalOpens.push(url);
    };
  });

  const denied = [
    'file:///etc/passwd',
    'javascript:void(0)',
    'data:text/html,blocked',
    'http://github.com/hansel970111-svg/cable-report-web/releases/latest',
    'https://github.com.evil.example/hansel970111-svg/cable-report-web/releases/latest',
    'https://github.com/hansel970111-svg/cable-report-web/',
    'https://github.com/hansel970111-svg/cable-report-web/releases/v1.0.0',
    `${RELEASES_URL}?source=desktop`,
    `${RELEASES_URL}#download`,
    'https://user@github.com/hansel970111-svg/cable-report-web/releases/latest',
    'https://user:pass@github.com/hansel970111-svg/cable-report-web/releases/latest',
    'https://github.com:444/hansel970111-svg/cable-report-web/releases/latest',
  ];
  for (const url of [desktop.window.url(), ...denied, RELEASES_URL]) {
    await desktop.window.evaluate(target => {
      window.open(target, '_blank');
    }, url);
  }

  await expect.poll(() => desktop.app.evaluate(async () => {
    const state = globalThis as unknown as { __cableE2eExternalOpens?: string[] };
    return state.__cableE2eExternalOpens ?? [];
  })).toEqual([RELEASES_URL]);
});

test('packaged production modules contain no updater download install or execute path', async ({ desktop }) => {
  const sources = await desktop.app.evaluate(async ({ app }) => {
    // The callback is serialized into Electron's main process, so it cannot
    // close over this test module's imports.
    const fs = process.getBuiltinModule('node:fs');
    const pathModule = process.getBuiltinModule('node:path');
    const root = app.getAppPath();
    return ['main.cjs', 'update-check.cjs', 'security.cjs']
      .map(name => fs.readFileSync(pathModule.join(root, 'electron', name), 'utf8'))
      .join('\n');
  });

  expect(sources).not.toMatch(
    /autoUpdater|downloadUpdate|quitAndInstall|installUpdate|child_process|execFile|spawn\(/,
  );
  expect(sources).not.toContain('browser_download_url');
  expect(sources).toContain("'/hansel970111-svg/cable-report-web/releases/latest'");
});

test('cancel terminates a deterministic test-only hanging pdf_worker and cleans task data', async ({ desktop }) => {
  await desktop.app.evaluate(async () => {
    process.env.CABLE_DESKTOP_E2E_HANG_WORKER = '1';
  });
  await desktop.window.getByLabel('项目号 (Site)').fill('DE46');
  await desktop.window.getByLabel('线缆类型').selectOption('Cat 5e');
  await desktop.window.getByLabel('Excel 布线表').setInputFiles(
    path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'tests/fixtures/excel/cat5e-oob.xlsx'),
  );
  await desktop.window.getByRole('button', { name: '加载并导入' }).click();
  await expect(desktop.window.getByText('1 条线缆记录')).toBeVisible();
  await desktop.window.getByRole('button', { name: '生成测试报告' }).click();

  await expect.poll(() => descendantProcesses(desktop.mainPid).filter(processInfo => (
    /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command)
  )).length).toBe(1);
  await desktop.window.getByRole('button', { name: '取消生成' }).click();
  await expect.poll(() => descendantProcesses(desktop.mainPid).filter(processInfo => (
    /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command)
  )).length).toBe(0);
  await expect.poll(async () => (
    (await readdir(tmpdir())).filter(name => (
      name.startsWith('cable-report-') && !desktop.taskDirectoriesBefore.has(name)
    ))
  )).toEqual([]);
  await desktop.app.evaluate(async () => {
    delete process.env.CABLE_DESKTOP_E2E_HANG_WORKER;
  });
});

test.describe('packaged timeout cleanup', () => {
  test.use({
    desktopEnvironment: {
      CABLE_DESKTOP_E2E_HANG_WORKER: '1',
      CABLE_DESKTOP_E2E_TIMEOUT: '1',
    },
  });

  test('timeout terminates the hanging pdf_worker and exposes REPORT_TIMEOUT', async ({ desktop }) => {
    await desktop.window.getByLabel('项目号 (Site)').fill('DE46');
    await desktop.window.getByLabel('线缆类型').selectOption('Cat 5e');
    await desktop.window.getByLabel('Excel 布线表').setInputFiles(
      path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'tests/fixtures/excel/cat5e-oob.xlsx'),
    );
    await desktop.window.getByRole('button', { name: '加载并导入' }).click();
    await expect(desktop.window.getByText('1 条线缆记录')).toBeVisible();

    const responsePromise = desktop.window.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/generate-report'
      && response.request().method() === 'POST'
    ));
    await desktop.window.getByRole('button', { name: '生成测试报告' }).click();
    await expect.poll(() => descendantProcesses(desktop.mainPid).filter(processInfo => (
      /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command)
    )).length).toBe(1);
    const response = await responsePromise;
    expect(response.status()).toBe(408);
    expect(await response.json()).toEqual({
      error: {
        code: 'REPORT_TIMEOUT',
        message: '报告生成超时，请重试。',
        retryable: true,
      },
    });
    await expect(desktop.window.locator('.workflow-error')).toContainText('报告生成超时，请重试。');
    await expect.poll(() => descendantProcesses(desktop.mainPid).filter(processInfo => (
      /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command)
    )).length).toBe(0);
    await expect.poll(async () => (
      (await readdir(tmpdir())).filter(name => (
        name.startsWith('cable-report-') && !desktop.taskDirectoriesBefore.has(name)
      ))
    )).toEqual([]);
  });
});

test.describe('packaged quit cleanup', () => {
  test.use({
    desktopEnvironment: {
      CABLE_DESKTOP_E2E_HANG_WORKER: '1',
    },
  });

  test('quitting with a hanging pdf_worker aborts it and cleans task data', async ({ desktop }) => {
    await desktop.window.getByLabel('项目号 (Site)').fill('DE46');
    await desktop.window.getByLabel('线缆类型').selectOption('Cat 5e');
    await desktop.window.getByLabel('Excel 布线表').setInputFiles(
      path.join(process.env.COZE_WORKSPACE_PATH || process.cwd(), 'tests/fixtures/excel/cat5e-oob.xlsx'),
    );
    await desktop.window.getByRole('button', { name: '加载并导入' }).click();
    await expect(desktop.window.getByText('1 条线缆记录')).toBeVisible();
    await desktop.window.getByRole('button', { name: '生成测试报告' }).click();

    let workerPids: number[] = [];
    await expect.poll(() => {
      workerPids = descendantProcesses(desktop.mainPid)
        .filter(processInfo => /(?:^|[/\\])pdf_worker(?:\.exe)?(?:\s|$)/i.test(processInfo.command))
        .map(processInfo => processInfo.pid);
      return workerPids.length;
    }).toBe(1);
    await expect.poll(async () => (
      (await readdir(tmpdir())).filter(name => (
        name.startsWith('cable-report-') && !desktop.taskDirectoriesBefore.has(name)
      )).length
    )).toBe(1);

    await desktop.app.close();

    await expect.poll(() => workerPids.filter(processExists)).toEqual([]);
    await expect.poll(async () => (
      (await readdir(tmpdir())).filter(name => (
        name.startsWith('cable-report-') && !desktop.taskDirectoriesBefore.has(name)
      ))
    )).toEqual([]);
  });
});
