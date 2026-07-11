import type { Locator, Page } from '@playwright/test';

export type PagePerformanceProbe = {
  batchSaveStartMs: number | null;
  heapSampleIntervalId: number | null;
  importEndMs: number | null;
  importStartMs: number | null;
  longTaskObserver: PerformanceObserver | null;
  longTaskSupported: boolean;
  longTasks: Array<{ duration: number; startTime: number }>;
  peakUsedJsHeapBytes: number | null;
  dispose(): void;
  flushLongTasks(): void;
  sampleHeap(): void;
};

declare global {
  interface Window {
    __reportPerformanceProbe: PagePerformanceProbe;
  }
}

export async function installPagePerformanceProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: PagePerformanceProbe = {
      batchSaveStartMs: null,
      heapSampleIntervalId: null,
      importEndMs: null,
      importStartMs: null,
      longTaskObserver: null,
      longTaskSupported: false,
      longTasks: [],
      peakUsedJsHeapBytes: null,
      dispose() {
        this.flushLongTasks();
        this.longTaskObserver?.disconnect();
        this.longTaskObserver = null;
        if (this.heapSampleIntervalId !== null) {
          window.clearInterval(this.heapSampleIntervalId);
          this.heapSampleIntervalId = null;
        }
      },
      flushLongTasks() {
        for (const entry of this.longTaskObserver?.takeRecords() ?? []) {
          this.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      },
      sampleHeap() {
        const browserPerformance = performance as Performance & {
          memory?: { usedJSHeapSize?: number };
        };
        const used = browserPerformance.memory?.usedJSHeapSize;
        if (typeof used !== 'number' || !Number.isFinite(used)) return;
        this.peakUsedJsHeapBytes = Math.max(
          this.peakUsedJsHeapBytes ?? 0,
          used,
        );
      },
    };

    window.__reportPerformanceProbe = probe;
    probe.sampleHeap();
    probe.heapSampleIntervalId = window.setInterval(() => probe.sampleHeap(), 50);

    probe.longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (probe.longTaskSupported) {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      });
      probe.longTaskObserver = observer;
      observer.observe({ entryTypes: ['longtask'] });
    }
  });
}

export async function measureControlledInputLatency(
  input: Locator,
  samples: number,
): Promise<number[]> {
  return input.evaluate(async (element, count) => {
    const target = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    const timings: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = performance.now();
      setter.call(target, `#PERF-${index}`);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      timings.push(performance.now() - start);
    }
    return timings;
  }, samples);
}

export function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}
