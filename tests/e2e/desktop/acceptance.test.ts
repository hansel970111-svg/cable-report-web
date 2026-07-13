import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAcceptanceManifest,
  verifyAcceptanceManifest,
} from '../../../scripts/acceptance-evidence.mjs';
import { commandInvocation } from '../../../scripts/run-evidence-command.mjs';

import {
  assertCiPlatformEvidence,
  formulaEvidence,
  parseArguments,
  parsePorcelainStatus,
  playwrightEvidence,
  pythonEvidence,
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
    schemaVersion: 2,
    platform: 'win',
    conclusion: 'success',
    commit: 'abc123',
    workflow: 'desktop-e2e',
    runId: 42,
    runAttempt: 1,
    repository: 'hansel970111-svg/cable-report-web',
    workflowRef: 'hansel970111-svg/cable-report-web/.github/workflows/desktop-e2e.yml@refs/heads/main',
    installerNames: ['Cable-Report-Generator-0.1.1.exe'],
  };

  expect(() => assertCiPlatformEvidence(evidence, 'win', 'abc123')).not.toThrow();
  expect(() => assertCiPlatformEvidence(evidence, 'mac', 'abc123')).toThrow(/platform/i);
  expect(() => assertCiPlatformEvidence(evidence, 'win', 'different')).toThrow(/commit/i);
  expect(() => assertCiPlatformEvidence({ ...evidence, conclusion: 'failure' }, 'win', 'abc123'))
    .toThrow(/success/i);
});

test('Python JUnit evidence rejects skipped, duplicate, empty, and collection-error suites', () => {
  const cases = [
    'cat5e-minimal',
    'cat5e-cross-page',
    'lc-minimal',
    'lc-cross-page',
    'mpo-minimal',
    'mpo-cross-page',
  ];
  const testcases = cases.map(name => (
    `<testcase classname="tests.python.test_pdf_golden" `
    + `name="test_pdf_matches_approved_golden[${name}]" time="0.1" />`
  )).join('');
  const valid = '<testsuites name="pytest tests">'
    + `<testsuite name="pytest" tests="191" failures="0" errors="0" skipped="0">`
    + `${testcases}</testsuite></testsuites>`;

  expect(pythonEvidence(valid)).toMatchObject({ passed: true });
  expect(pythonEvidence(valid.replace('skipped="0"', 'skipped="1"')))
    .toMatchObject({ passed: false });
  expect(pythonEvidence(valid.replace(testcases, `${testcases}${testcases}`)))
    .toMatchObject({ passed: false });
  expect(pythonEvidence('<testsuites tests="0" failures="0" errors="0" skipped="0" />'))
    .toMatchObject({ passed: false });
  expect(pythonEvidence(valid.replace('</testsuite>', '<error message="collection failed"/></testsuite>')))
    .toMatchObject({ passed: false });
});

test('cross-platform claims cannot be enabled from an untrusted local JSON report', () => {
  expect(() => parseArguments([
    '--platform', 'mac',
    '--require-ci-platform', 'win',
    '--ci-report', 'hand-written.json',
  ])).toThrow(/GitHub API/i);
});

test('evidence commands pin pnpm and use a shell only for Windows command shims', () => {
  expect(commandInvocation('pnpm', ['exec', 'vitest'], 'darwin')).toEqual({
    command: 'corepack',
    args: ['pnpm@9.15.9', 'exec', 'vitest'],
    shell: false,
  });
  expect(commandInvocation('pnpm', ['exec', 'vitest'], 'win32')).toEqual({
    command: 'corepack',
    args: ['pnpm@9.15.9', 'exec', 'vitest'],
    shell: true,
  });
  expect(commandInvocation('python', ['-m', 'pytest'], 'win32')).toEqual({
    command: 'python',
    args: ['-m', 'pytest'],
    shell: false,
  });
});

test('acceptance manifest binds every report, package, and installer to current HEAD', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'acceptance-evidence-'));
  const head = 'a'.repeat(40);
  const paths = [
    'artifacts/acceptance/unit.json',
    'artifacts/acceptance/python.xml',
    'artifacts/acceptance/browser.json',
    'artifacts/acceptance/desktop-mac.json',
    'artifacts/acceptance/audit-mac.json',
    'release/mac/Cable Report Generator.app/Contents/Resources/app.asar',
    'release/Cable-Report-Generator-0.1.1.dmg',
    'release/Cable-Report-Generator-0.1.1.zip',
  ];
  try {
    for (const relativePath of paths) {
      const absolutePath = path.join(workspace, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, relativePath);
    }
    const gates: Record<string, { command: string[]; artifact?: string }> = {
      unit: { command: ['pnpm', 'exec', 'vitest', 'run'], artifact: 'artifacts/acceptance/unit.json' },
      python: { command: ['python', '-m', 'pytest'], artifact: 'artifacts/acceptance/python.xml' },
      browser: { command: ['pnpm', 'exec', 'playwright', 'test'], artifact: 'artifacts/acceptance/browser.json' },
      audit: { command: ['pnpm', 'audit'], artifact: 'artifacts/acceptance/audit-mac.json' },
      package: { command: ['pnpm', 'desktop:dist:mac'] },
      desktop: { command: ['pnpm', 'test:e2e:mac'], artifact: 'artifacts/acceptance/desktop-mac.json' },
    };
    for (const [name, gate] of Object.entries(gates)) {
      const artifactSha256 = gate.artifact
        ? createHash('sha256').update(gate.artifact).digest('hex')
        : undefined;
      await writeFile(
        path.join(workspace, `artifacts/acceptance/gate-${name}-mac.json`),
        JSON.stringify({
          schemaVersion: 1,
          name,
          platform: 'mac',
          head,
          command: gate.command,
          exitCode: 0,
          ...(gate.artifact ? { artifact: gate.artifact, artifactSha256 } : {}),
        }),
      );
    }
    const manifest = createAcceptanceManifest({ workspace, platform: 'mac', head });
    expect(() => verifyAcceptanceManifest({ workspace, manifest, platform: 'mac', head }))
      .not.toThrow();
    expect(() => verifyAcceptanceManifest({
      workspace, manifest, platform: 'mac', head: 'b'.repeat(40),
    })).toThrow(/HEAD/i);

    await writeFile(path.join(workspace, 'artifacts/acceptance/unit.json'), 'stale-or-mutated');
    expect(() => verifyAcceptanceManifest({ workspace, manifest, platform: 'mac', head }))
      .toThrow(/digest mismatch/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
