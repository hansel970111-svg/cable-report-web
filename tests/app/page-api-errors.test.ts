// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';

import { afterEach, expect, test, vi } from 'vitest';

import { browserReportServices } from '@/features/report-workflow/browser-services';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('browser imports preserve the stable non-retryable API error contract', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    error: {
      code: 'INVALID_EXCEL_FILE',
      message: '仅支持有效的 .xls 或 .xlsx Excel 文件。',
      retryable: false,
    },
  }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(browserReportServices.importExcel(
    new File([Uint8Array.from([1])], 'invalid.xlsx'),
    'Cat 5e',
    new AbortController().signal,
  )).rejects.toMatchObject({
    message: '仅支持有效的 .xls 或 .xlsx Excel 文件。',
    retryable: false,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/import-excel',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('the renderer uses direct import and generation without a template request', async () => {
  const [pageSource, servicesSource] = await Promise.all([
    readFile('src/app/page.tsx', 'utf8'),
    readFile('src/features/report-workflow/browser-services.ts', 'utf8'),
  ]);
  const rendererSource = `${pageSource}\n${servicesSource}`;

  expect(pageSource).toContain('<ReportEditor services={browserReportServices} />');
  expect(servicesSource).toContain("desktopFetch('/api/import-excel'");
  expect(servicesSource).toContain("desktopFetch('/api/modify-pdf'");
  expect(rendererSource).not.toContain('/api/load-template');
});
