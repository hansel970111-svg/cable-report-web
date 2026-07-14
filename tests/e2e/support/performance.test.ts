import { expect, test } from 'vitest';

import {
  RELEASE_PERFORMANCE_LIMITS,
  releasePerformanceLimit,
} from './performance';

test('local performance comparisons retain the strict 20 percent baseline budget', () => {
  expect(releasePerformanceLimit('inputP95Ms', 17.7, false)).toBeCloseTo(21.24);
  expect(releasePerformanceLimit('importDurationMs', 68.9, false)).toBeCloseTo(82.68);
});

test('CI performance comparisons use stable cross-runner release SLOs', () => {
  expect(RELEASE_PERFORMANCE_LIMITS).toEqual({
    domRows: 200,
    inputP95Ms: 100,
    importDurationMs: 500,
    batchSaveMaxLongTaskMs: 200,
    peakUsedJsHeapBytes: 128 * 1024 * 1024,
  });
  expect(releasePerformanceLimit('inputP95Ms', 17.7, true)).toBe(100);
  expect(releasePerformanceLimit('importDurationMs', 68.9, true)).toBe(500);
  expect(releasePerformanceLimit('peakUsedJsHeapBytes', 10_000_000, true)).toBe(
    128 * 1024 * 1024,
  );
});
