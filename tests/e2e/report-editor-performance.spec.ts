import { readFile, writeFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { makeImportResult } from './support/import-result';
import {
  installPagePerformanceProbe,
  measureControlledInputLatency,
  percentile95,
} from './support/performance';
import { makeCat5eWorkbookBuffer, XLSX_MIME } from './support/workbook';

const BASELINE_PATH = 'tests/performance/browser-baseline.json';
const REQUIRED_METRICS = [
  'domRows',
  'inputP95Ms',
  'importDurationMs',
  'batchSaveMaxLongTaskMs',
] as const;

type RequiredMetric = (typeof REQUIRED_METRICS)[number];
type BrowserPerformanceMetrics = Record<RequiredMetric, number> & {
  peakUsedJsHeapBytes?: number;
};

function finiteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseBaseline(value: unknown): BrowserPerformanceMetrics {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  const record = value as Record<string, unknown>;
  const allowed = new Set<string>([...REQUIRED_METRICS, 'peakUsedJsHeapBytes']);
  expect(Object.keys(record).every(key => allowed.has(key))).toBe(true);
  for (const metric of REQUIRED_METRICS) {
    expect(finiteMetric(record[metric]), `${metric} must be a finite non-negative number`).toBe(true);
  }
  if ('peakUsedJsHeapBytes' in record) {
    expect(
      finiteMetric(record.peakUsedJsHeapBytes),
      'peakUsedJsHeapBytes must be a finite non-negative number',
    ).toBe(true);
  }
  return record as BrowserPerformanceMetrics;
}

async function importInterceptedWorkbook(page: Page): Promise<void> {
  await page.getByLabel('项目号 (Site)').fill('DE46');
  await page.getByLabel('线缆类型').selectOption('Cat 5e');
  await page.getByLabel('Excel 布线表').setInputFiles({
    name: 'cat5e-perf.xlsx',
    mimeType: XLSX_MIME,
    buffer: makeCat5eWorkbookBuffer(1),
  });

  await page.getByRole('button', { name: '加载并导入' }).evaluate(button => {
    button.addEventListener('click', () => {
      const probe = window.__reportPerformanceProbe;
      probe.importStartMs = performance.now();
      probe.sampleHeap();
      const root = document.querySelector('main') ?? document.body;
      const observer = new MutationObserver(() => {
        const preview = document.querySelector(
          '[role="table"][aria-label="线缆记录预览"]',
        );
        if (preview === null || probe.importEndMs !== null) return;
        observer.disconnect();
        requestAnimationFrame(() => {
          probe.importEndMs = performance.now();
          probe.sampleHeap();
        });
      });
      observer.observe(root, { childList: true, subtree: true });
    }, { once: true });
  });

  await page.getByRole('button', { name: '加载并导入' }).click();
  await expect(page.getByRole('table', { name: '线缆记录预览' })).toHaveAttribute(
    'aria-rowcount',
    '5001',
  );
  await page.waitForFunction(() => (
    window.__reportPerformanceProbe.importEndMs !== null
  ));
}

test('5k preview stays bounded and responsive at 320px', async ({ page }, testInfo) => {
  await page.route('**/api/import-excel', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: makeImportResult(5_000) }),
  }));
  await installPagePerformanceProbe(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await importInterceptedWorkbook(page);

  const domRows = await page.getByRole('row').count();
  expect(domRows).toBeLessThanOrEqual(200);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth > innerWidth
  ))).toBe(false);

  await page.getByRole('button', { name: '批量编辑' }).click();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth > innerWidth
  ))).toBe(false);
  const firstInput = page.getByLabel('第 1 条 Cable Label');
  const samples = await measureControlledInputLatency(firstInput, 30);
  expect(samples).toHaveLength(30);
  const inputP95Ms = percentile95(samples);
  expect(inputP95Ms).toBeLessThan(100);

  await page.evaluate(() => {
    const probe = window.__reportPerformanceProbe;
    probe.batchSaveStartMs = performance.now();
    probe.sampleHeap();
  });
  await page.getByRole('button', { name: '保存编辑' }).click();
  await expect(firstInput).toHaveCount(0);

  const pageMetrics = await page.evaluate(async () => {
    const probe = window.__reportPerformanceProbe;
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => (
        requestAnimationFrame(() => resolve())
      )));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      probe.flushLongTasks();
      probe.sampleHeap();
      if (probe.importStartMs === null || probe.importEndMs === null) {
        throw new Error('Import timing was not captured inside the page.');
      }
      if (probe.batchSaveStartMs === null) {
        throw new Error('Batch-save timing was not captured inside the page.');
      }
      const batchLongTasks = probe.longTasks.filter(
        entry => entry.startTime >= probe.batchSaveStartMs!,
      );
      return {
        batchSaveMaxLongTaskMs: Math.max(
          0,
          ...batchLongTasks.map(entry => entry.duration),
        ),
        importDurationMs: probe.importEndMs - probe.importStartMs,
        longTaskSupported: probe.longTaskSupported,
        peakUsedJsHeapBytes: probe.peakUsedJsHeapBytes,
      };
    } finally {
      probe.dispose();
    }
  });

  expect(pageMetrics.longTaskSupported).toBe(true);
  expect(pageMetrics.batchSaveMaxLongTaskMs).toBeLessThan(200);
  expect(await page.evaluate(() => {
    const probe = window.__reportPerformanceProbe;
    return probe.heapSampleIntervalId === null && probe.longTaskObserver === null;
  })).toBe(true);

  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(accessibility.violations).toEqual([]);

  const metrics: BrowserPerformanceMetrics = {
    domRows,
    inputP95Ms: Number(inputP95Ms.toFixed(2)),
    importDurationMs: Number(pageMetrics.importDurationMs.toFixed(2)),
    batchSaveMaxLongTaskMs: Number(pageMetrics.batchSaveMaxLongTaskMs.toFixed(2)),
    ...(pageMetrics.peakUsedJsHeapBytes === null
      ? {}
      : { peakUsedJsHeapBytes: Math.round(pageMetrics.peakUsedJsHeapBytes) }),
  };
  for (const [name, value] of Object.entries(metrics)) {
    expect(finiteMetric(value), `${name} must be a finite non-negative number`).toBe(true);
  }
  await testInfo.attach('browser-performance-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });

  if (process.env.PERF_UPDATE_BASELINE === '1') {
    await writeFile(BASELINE_PATH, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    return;
  }

  const baseline = parseBaseline(JSON.parse(await readFile(BASELINE_PATH, 'utf8')));
  for (const metric of REQUIRED_METRICS) {
    expect(metrics[metric], `${metric} regressed by more than 20%`).toBeLessThanOrEqual(
      baseline[metric] * 1.2,
    );
  }
  if (baseline.peakUsedJsHeapBytes !== undefined) {
    expect(metrics.peakUsedJsHeapBytes).toBeDefined();
    expect(
      metrics.peakUsedJsHeapBytes!,
      'peakUsedJsHeapBytes regressed by more than 20%',
    ).toBeLessThanOrEqual(baseline.peakUsedJsHeapBytes * 1.2);
  }
});
