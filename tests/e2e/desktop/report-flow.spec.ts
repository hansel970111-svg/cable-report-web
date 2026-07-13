import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

import {
  addedEntries,
  downloadEntries,
  expect,
  saveDialogCallCount,
  setSaveDialogResult,
  test,
} from './fixtures';
import type { PackagedDesktop } from './launch-packaged';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();

type ReportCase = {
  name: string;
  cableType: 'Cat 5e' | 'LC' | 'MPO';
  fixture: string;
  editedLabel: string;
  expectedPages: number;
  expectedRecords: number;
};

const REPORT_CASES: readonly ReportCase[] = [
  {
    name: 'Cat5e',
    cableType: 'Cat 5e',
    fixture: 'cat5e-oob.xlsx',
    editedLabel: '#E2E-CAT5E',
    expectedPages: 1,
    expectedRecords: 1,
  },
  {
    name: 'LC',
    cableType: 'LC',
    fixture: 'lc.xls',
    editedLabel: '#E2E-LC',
    expectedPages: 1,
    expectedRecords: 1,
  },
  {
    name: 'MPO',
    cableType: 'MPO',
    fixture: 'mpo.xlsx',
    editedLabel: '#E2E-MPO',
    expectedPages: 1,
    expectedRecords: 1,
  },
] as const;

async function importFixture(page: Page, reportCase: ReportCase): Promise<void> {
  await expect(page.getByRole('heading', { name: '线缆测试报告编辑器' })).toBeVisible();
  await page.getByLabel('项目号 (Site)').fill('DE46');
  await page.getByLabel('线缆类型').selectOption(reportCase.cableType);
  await page.getByLabel('Excel 布线表').setInputFiles(
    path.join(workspace, 'tests', 'fixtures', 'excel', reportCase.fixture),
  );
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/import-excel'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '加载并导入' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByText(`${reportCase.expectedRecords} 条线缆记录`)).toBeVisible();

  await page.getByRole('button', { name: '批量编辑' }).click();
  await page.getByLabel('第 1 条 Cable Label').fill(reportCase.editedLabel);
  await page.getByRole('button', { name: '保存编辑' }).click();
  await expect(page.getByRole('table', { name: '线缆记录预览' }))
    .toContainText(reportCase.editedLabel);
}

function verifyPdfWithPyMuPDF(
  pdfPath: string,
  reportCase: ReportCase,
): void {
  const python = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
  const source = [
    'import fitz, json, sys',
    'document = fitz.open(sys.argv[1])',
    'text = "\\n".join(page.get_text() for page in document)',
    'labels = [line.strip() for line in text.splitlines() if line.strip().startswith("#")]',
    'lines = [line.strip() for line in text.splitlines() if line.strip()]',
    'summary = lines[max(i for i, line in enumerate(lines) if line == "Total for Selected Reports") + 1:]',
    'totals = [int(line) for line in summary if line.isdigit()]',
    'value = {"pages": document.page_count, "edited": sys.argv[2] in labels, "records": sum(totals[:2])}',
    'document.close()',
    'print(json.dumps(value))',
  ].join('; ');
  const result = spawnSync(
    python,
    ['-c', source, pdfPath, reportCase.editedLabel],
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  );
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    throw new Error('PyMuPDF verification timed out after 30000 ms');
  }
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    pages: reportCase.expectedPages,
    edited: true,
    records: reportCase.expectedRecords,
  });
}

async function generateAndSave(
  desktop: PackagedDesktop,
  reportCase: ReportCase,
  savePath: string,
): Promise<void> {
  await setSaveDialogResult(desktop, { canceled: false, filePath: savePath });
  const generationPromise = desktop.window.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/generate-report'
    && response.request().method() === 'POST'
  ));
  await desktop.window.getByRole('button', { name: '生成测试报告' }).click();
  const generation = await generationPromise;
  expect(generation.status()).toBe(200);
  expect(generation.headers()['x-report-pages']).toBe(String(reportCase.expectedPages));
  expect(generation.headers()['x-report-records']).toBe(String(reportCase.expectedRecords));
  await expect(desktop.window.getByText(/^已保存 .+\.pdf。$/)).toBeVisible();
}

for (const reportCase of REPORT_CASES) {
  test(`packaged ${reportCase.name} import edit generate native save`, async ({ desktop }, testInfo) => {
    const savePath = testInfo.outputPath(`${reportCase.name.toLowerCase()}-edited.pdf`);
    const beforeDownloads = await downloadEntries();
    await importFixture(desktop.window, reportCase);
    await generateAndSave(desktop, reportCase, savePath);

    expect((await readFile(savePath)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect((await stat(savePath)).isFile()).toBe(true);
    verifyPdfWithPyMuPDF(savePath, reportCase);
    expect(addedEntries(beforeDownloads, await downloadEntries())).toEqual([]);
    await attachCaseEvidence(testInfo, reportCase, savePath);
  });
}

async function attachCaseEvidence(
  testInfo: TestInfo,
  reportCase: ReportCase,
  savePath: string,
): Promise<void> {
  await testInfo.attach('packaged-report-evidence', {
    body: JSON.stringify({
      cableType: reportCase.cableType,
      editedLabel: reportCase.editedLabel,
      pageCount: reportCase.expectedPages,
      recordCount: reportCase.expectedRecords,
      pdfBytes: (await stat(savePath)).size,
    }),
    contentType: 'application/json',
  });
}

test('native Save As cancellation returns to ready without false success', async ({ desktop }) => {
  const reportCase = REPORT_CASES[0];
  await importFixture(desktop.window, reportCase);
  await setSaveDialogResult(desktop, { canceled: true, delayMs: 1_000 });
  const generationPromise = desktop.window.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/generate-report'
    && response.request().method() === 'POST'
  ));
  await desktop.window.getByRole('button', { name: '生成测试报告' }).click();
  expect((await generationPromise).status()).toBe(200);
  await expect.poll(() => saveDialogCallCount(desktop)).toBe(1);
  await expect(desktop.window.getByRole('status', { name: '工作流状态' }))
    .toContainText('正在保存 PDF');
  await expect(desktop.window.getByRole('button', { name: '生成测试报告' })).toBeEnabled();
  await expect(desktop.window.getByRole('status', { name: '工作流状态' })).toHaveCount(0);
  await expect(desktop.window.getByText('已取消保存。')).toBeVisible();
  await expect(desktop.window.getByText(/^已保存 .+\.pdf。$/)).toHaveCount(0);
});
