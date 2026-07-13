import { expect, test } from 'vitest';

import {
  assertCiPlatformEvidence,
  formulaEvidence,
  parseArguments,
  parsePorcelainStatus,
  playwrightEvidence,
} from '../../../scripts/verify-acceptance.mjs';

test('pnpm argument separator is ignored by the acceptance CLI', () => {
  expect(parseArguments(['--', '--platform', 'mac'])).toMatchObject({ platform: 'mac' });
});

test('Playwright evidence fails closed unless every expected story passed', () => {
  const report = {
    stats: { expected: 2, unexpected: 0 },
    suites: [{ specs: [
      { title: 'first story', ok: true, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
      { title: 'second story', ok: true, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
    ] }],
  };

  expect(playwrightEvidence(report, ['first story', 'second story'])).toMatchObject({
    passed: true,
  });
  expect(playwrightEvidence(report, ['missing story'])).toMatchObject({ passed: false });
  expect(playwrightEvidence({ ...report, stats: { expected: 1, unexpected: 1 } }, []))
    .toMatchObject({ passed: false });
});

test('NUL porcelain parsing preserves an exact unquoted path with spaces', () => {
  expect(parsePorcelainStatus('?? src/app/api/upload-excel/route 2.ts\0')).toEqual([
    { code: '??', path: 'src/app/api/upload-excel/route 2.ts' },
  ]);
  expect(parsePorcelainStatus(' M package.json\0?? another file.txt\0')).toEqual([
    { code: ' M', path: 'package.json' },
    { code: '??', path: 'another file.txt' },
  ]);
});

test('formula evidence requires the named formula, time, and date suites to pass', () => {
  const result = (name: string, fullName: string) => ({
    name,
    status: 'passed',
    assertionResults: [{ fullName, status: 'passed' }],
  });
  const report = {
    numFailedTests: 0,
    testResults: [
      result('/repo/src/domain/report/record-mapper.test.ts', 'preserves Cat5e formulas and random call order'),
      result('/repo/src/domain/report/time-sequence.test.ts', 'uses inclusive 50-second and 90-second interval bounds'),
      result('/repo/src/domain/report/date-time.test.ts', 'accepts minute 00 and validates real calendar dates and 12-hour time'),
    ],
  };

  expect(formulaEvidence(report)).toMatchObject({ passed: true });
  expect(formulaEvidence({ ...report, testResults: report.testResults.slice(1) }))
    .toMatchObject({ passed: false });
});

test('remote CI evidence must be successful, current-commit, and opposite-platform', () => {
  const evidence = {
    schemaVersion: 1,
    platform: 'win',
    conclusion: 'success',
    commit: 'abc123',
    workflow: 'desktop-e2e',
    runId: 42,
    installerNames: ['Cable-Report-Generator-0.1.1.exe'],
  };

  expect(() => assertCiPlatformEvidence(evidence, 'win', 'abc123')).not.toThrow();
  expect(() => assertCiPlatformEvidence(evidence, 'mac', 'abc123')).toThrow(/platform/i);
  expect(() => assertCiPlatformEvidence(evidence, 'win', 'different')).toThrow(/commit/i);
  expect(() => assertCiPlatformEvidence({ ...evidence, conclusion: 'failure' }, 'win', 'abc123'))
    .toThrow(/success/i);
});
