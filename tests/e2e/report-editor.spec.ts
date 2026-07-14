import { expect, test } from '@playwright/test';

import { makeCat5eWorkbookBuffer, XLSX_MIME } from './support/workbook';

type GeneratedPayload = {
  revision: number;
  cableType: string;
  site: string;
  records: Array<{
    cableLabel: string;
    dateTime: string;
  }>;
};

test('imports, edits, deletes, and generates a report in browser mode', async ({ page }) => {
  const generatedRequests: GeneratedPayload[] = [];
  let releaseGeneration!: () => void;
  const generationPaused = new Promise<void>(resolve => {
    releaseGeneration = resolve;
  });

  await page.route('**/api/generate-report', async route => {
    generatedRequests.push(route.request().postDataJSON() as GeneratedPayload);
    await generationPaused;
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: {
        'content-disposition': 'attachment; filename="report.pdf"',
        'x-report-job-id': 'e2e-browser-workflow',
      },
      body: '%PDF-1.4\n%%EOF\n',
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '线缆测试报告编辑器' })).toBeVisible();
  await expect(page.getByRole('status', { name: '运行模式' })).toHaveText('浏览器开发模式');

  await page.getByLabel('项目号 (Site)').fill('YYBX-OE38-00027');
  await page.getByLabel('线缆类型').selectOption('Cat 5e');
  await page.getByLabel('Excel 布线表').setInputFiles({
    name: 'cat5e-three-rows.xlsx',
    mimeType: XLSX_MIME,
    buffer: makeCat5eWorkbookBuffer(3),
  });

  const importResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/import-excel'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '加载并导入' }).click();
  const importResponse = await importResponsePromise;
  expect(importResponse.status()).toBe(200);

  const preview = page.getByRole('table', { name: '线缆记录预览' });
  await expect(preview).toHaveAttribute('aria-rowcount', '4');
  await expect(page.getByText('3 条线缆记录')).toBeVisible();

  await page.getByRole('button', { name: '批量编辑' }).click();
  await page.getByLabel('第 1 条 Cable Label').fill('#EDITED-001');
  await page.getByRole('button', { name: '保存编辑' }).click();
  await expect(preview.getByText('#EDITED-001')).toBeVisible();

  await page.getByLabel('分钟').fill('00');
  await expect(page.getByLabel('分钟')).toHaveValue('00');

  await preview.getByRole('button', { name: /^删除线缆 / }).nth(1).click();
  await expect(page.getByText('2 条线缆记录')).toBeVisible();
  await expect(preview).toHaveAttribute('aria-rowcount', '3');

  const generateButton = page.getByRole('button', { name: '生成测试报告' });
  await expect(generateButton).toBeEnabled();
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await generateButton.click();
  try {
    await expect(page.getByRole('status', { name: '工作流状态' })).toHaveText('正在生成报告…');
  } finally {
    releaseGeneration();
  }

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('report.pdf');
  await expect(page.getByText('已保存 report.pdf。')).toBeVisible();

  expect(generatedRequests).toHaveLength(1);
  const [generatedPayload] = generatedRequests;
  expect(generatedPayload.site).toBe('YYBX-OE38-00027');
  expect(generatedPayload.cableType).toBe('Cat 5e');
  expect(generatedPayload.records).toHaveLength(2);
  expect(generatedPayload.records[0]?.cableLabel).toBe('#EDITED-001');
  expect(generatedPayload.records[0]?.dateTime).toMatch(
    /^\d{2}-\d{2}-\d{4} \d{2}:00:\d{2} (?:AM|PM)$/,
  );
});
