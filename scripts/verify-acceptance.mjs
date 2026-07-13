import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { verifyAcceptanceManifest } from './acceptance-evidence.mjs';

const REQUIRED_DESKTOP_STORIES = [
  'packaged Cat5e import edit generate native save',
  'packaged LC import edit generate native save',
  'packaged MPO import edit generate native save',
  'native Save As cancellation returns to ready without false success',
  'packaged renderer API and external navigation stay inside the allowlist',
  'packaged production modules contain no updater download install or execute path',
  'cancel terminates a deterministic test-only hanging pdf_worker and cleans task data',
  'timeout terminates the hanging pdf_worker and exposes REPORT_TIMEOUT',
  'quitting with a hanging pdf_worker aborts it and cleans task data',
];
const GOLDEN_CASES = [
  'cat5e-minimal',
  'cat5e-cross-page',
  'lc-minimal',
  'lc-cross-page',
  'mpo-minimal',
  'mpo-cross-page',
];
const LEGACY_ROUTES = [
  'src/app/api/load-template/route.ts',
  'src/app/api/generate-pdf/route.ts',
  'src/app/api/upload-pdf/route.ts',
  'src/app/api/test-large-response/route.ts',
  'src/app/api/upload-excel/route.ts',
  'src/app/api/modify-pdf/route.ts',
];
const PROTECTED_UNTRACKED = '?? src/app/api/upload-excel/route 2.ts';

function collectSpecs(value, target = []) {
  if (!value || typeof value !== 'object') return target;
  if (Array.isArray(value)) {
    for (const item of value) collectSpecs(item, target);
    return target;
  }
  if (typeof value.title === 'string' && Array.isArray(value.tests)) {
    target.push(value);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'tests') collectSpecs(nested, target);
  }
  return target;
}

export function playwrightEvidence(report, expectedTitles) {
  const specs = collectSpecs(report);
  const passedTitles = new Set(specs.filter(spec => (
    spec.ok === true
    && spec.tests.every(test => (
      test.status === 'expected'
      && test.results?.some(result => result.status === 'passed')
    ))
  )).map(spec => spec.title));
  const missing = expectedTitles.filter(title => !passedTitles.has(title));
  const unexpected = Number(report?.stats?.unexpected ?? 0);
  return {
    passed: unexpected === 0 && missing.length === 0,
    detail: unexpected > 0
      ? `${unexpected} unexpected Playwright result(s)`
      : missing.length > 0
        ? `missing passed stories: ${missing.join(', ')}`
        : `${passedTitles.size} Playwright stories passed`,
  };
}

export function assertCiPlatformEvidence(evidence, expectedPlatform, expectedCommit) {
  if (evidence?.schemaVersion !== 2) throw new Error('CI evidence schemaVersion must be 2');
  if (evidence.platform !== expectedPlatform) {
    throw new Error(`CI evidence platform must be ${expectedPlatform}`);
  }
  if (evidence.conclusion !== 'success') throw new Error('CI evidence conclusion must be success');
  if (evidence.commit !== expectedCommit) throw new Error('CI evidence commit does not match HEAD');
  if (evidence.workflow !== 'desktop-e2e') throw new Error('CI evidence workflow must be desktop-e2e');
  if (!Number.isSafeInteger(evidence.runId) || evidence.runId <= 0) {
    throw new Error('CI evidence runId must be a positive integer');
  }
  if (!Number.isSafeInteger(evidence.runAttempt) || evidence.runAttempt <= 0) {
    throw new Error('CI evidence runAttempt must be a positive integer');
  }
  if (evidence.repository !== 'hansel970111-svg/cable-report-web') {
    throw new Error('CI evidence repository is not trusted');
  }
  const workflowPrefix = `${evidence.repository}/.github/workflows/desktop-e2e.yml@`;
  if (typeof evidence.workflowRef !== 'string' || !evidence.workflowRef.startsWith(workflowPrefix)) {
    throw new Error('CI evidence workflowRef is not trusted');
  }
  if (!Array.isArray(evidence.installerNames) || evidence.installerNames.length < 1) {
    throw new Error('CI evidence must list installer artifacts');
  }
}

export function parsePorcelainStatus(output) {
  const tokens = String(output).split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4 || token[2] !== ' ') {
      throw new Error('Invalid NUL-delimited porcelain status record');
    }
    const code = token.slice(0, 2);
    const entry = { code, path: token.slice(3) };
    if (/[RC]/.test(code)) {
      const originalPath = tokens[++index];
      if (!originalPath) throw new Error('Rename status record is missing its original path');
      entry.originalPath = originalPath;
    }
    entries.push(entry);
  }
  return entries;
}

export function parseArguments(argv) {
  const options = { platform: process.platform === 'win32' ? 'win' : 'mac' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--platform') options.platform = argv[++index];
    else if (argument === '--require-ci-platform' || argument === '--ci-report') {
      throw new Error('Cross-platform status must be verified with the GitHub API, not a local JSON report');
    }
    else if (argument === '--emit-ci-report') options.emitCiReport = argv[++index];
    else throw new Error(`Unknown acceptance argument: ${argument}`);
  }
  if (!['mac', 'win'].includes(options.platform)) throw new Error('--platform must be mac or win');
  return options;
}

function readJson(workspace, relativePath) {
  const filePath = path.join(workspace, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Missing or invalid machine-readable report ${relativePath}: ${error.message}`);
  }
}

function run(command, args, workspace) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: { ...process.env, COZE_WORKSPACE_PATH: workspace },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout || ''}\n${result.stderr || result.error}`,
    );
  }
  return result.stdout;
}

function qualityCommandsEvidence(workspace) {
  const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  const python = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python.exe' : 'python3');
  const commands = [
    [process.execPath, ['scripts/verify-dependency-policy.mjs']],
    [process.execPath, ['scripts/verify-runtime-surface.mjs']],
    [python, ['scripts/verify_python_locks.py']],
    [corepack, ['pnpm', 'lint']],
    [corepack, ['pnpm', 'ts-check']],
  ];
  try {
    for (const [command, args] of commands) run(command, args, workspace);
    return {
      passed: true,
      detail: 'dependency/runtime/Python locks, lint, and TypeScript passed on current checkout',
    };
  } catch (error) {
    return { passed: false, detail: error.message };
  }
}

function unitEvidence(report) {
  const failed = Number(report?.numFailedTests ?? -1);
  const passed = Number(report?.numPassedTests ?? -1);
  return {
    passed: failed === 0 && passed >= 500,
    detail: `${passed} unit tests passed; ${failed} failed`,
  };
}

export function formulaEvidence(report) {
  const requirements = [
    ['record-mapper.test.ts', 'preserves Cat5e formulas and random call order'],
    ['time-sequence.test.ts', 'uses inclusive 50-second and 90-second interval bounds'],
    ['date-time.test.ts', 'accepts minute 00 and validates real calendar dates and 12-hour time'],
  ];
  const missing = requirements.filter(([suiteName, assertionName]) => !(
    report?.testResults?.some(result => (
      String(result.name || '').replaceAll('\\', '/').endsWith(`/${suiteName}`)
      && result.status === 'passed'
      && result.assertionResults?.some(assertion => (
        assertion.fullName === assertionName && assertion.status === 'passed'
      ))
    ))
  ));
  return {
    passed: Number(report?.numFailedTests ?? -1) === 0 && missing.length === 0,
    detail: missing.length > 0
      ? `missing formula evidence: ${missing.map(([, name]) => name).join(', ')}`
      : 'formula, random-order, time-bound, and real-date tests passed',
  };
}

function xmlAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attributes.set(match[1], match[2]);
  }
  return attributes;
}

function integerAttribute(attributes, name) {
  const value = attributes.get(name);
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

export function pythonEvidence(xml) {
  const document = String(xml);
  const suiteOpenings = [...document.matchAll(/<testsuites?\b([^>]*)>/g)];
  const root = suiteOpenings
    .map(match => xmlAttributes(match[1]))
    .find(attributes => ['tests', 'failures', 'errors', 'skipped'].every(name => (
      attributes.has(name)
    )));
  if (!root) return { passed: false, detail: 'Python JUnit report has no complete suite counters' };

  const tests = integerAttribute(root, 'tests');
  const failures = integerAttribute(root, 'failures');
  const errors = integerAttribute(root, 'errors');
  const skipped = integerAttribute(root, 'skipped');
  const countersValid = Number.isSafeInteger(tests) && tests >= 100
    && failures === 0 && errors === 0 && skipped === 0;
  const forbiddenOutcome = /<(?:failure|error|skipped)\b/i.test(document);

  const names = [];
  const failedCases = [];
  for (const match of document.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = xmlAttributes(match[1]).get('name');
    if (!name) continue;
    names.push(name);
    if (/<(?:failure|error|skipped)\b/i.test(match[2] || '')) failedCases.push(name);
  }
  const expectedNames = GOLDEN_CASES.map(name => `test_pdf_matches_approved_golden[${name}]`);
  const missingGoldens = expectedNames.filter(name => names.filter(value => value === name).length !== 1);
  const duplicates = names.length !== new Set(names).size;
  return {
    passed: countersValid && !forbiddenOutcome && !duplicates
      && failedCases.length === 0 && missingGoldens.length === 0,
    detail: !countersValid
      ? `invalid JUnit counters: tests=${tests}, failures=${failures}, errors=${errors}, skipped=${skipped}`
      : forbiddenOutcome || failedCases.length > 0
        ? 'JUnit report contains a failed, errored, or skipped test'
        : duplicates
          ? 'JUnit report contains duplicate testcase names'
          : missingGoldens.length > 0
            ? `missing uniquely passed golden cases: ${missingGoldens.join(', ')}`
            : `${tests} Python tests passed with six unique golden cases and no skips`,
  };
}

function auditEvidence(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return { passed: false, detail: 'audit report has no vulnerability summary' };
  }
  const high = Number(vulnerabilities.high ?? 0);
  const critical = Number(vulnerabilities.critical ?? 0);
  return {
    passed: high === 0 && critical === 0,
    detail: `${high} high and ${critical} critical production vulnerabilities`,
  };
}

function installers(workspace, platform) {
  const names = fs.existsSync(path.join(workspace, 'release'))
    ? fs.readdirSync(path.join(workspace, 'release')).sort()
    : [];
  return platform === 'mac'
    ? names.filter(name => /\.(?:dmg|zip)$/i.test(name))
    : names.filter(name => /\.exe$/i.test(name));
}

function statusEvidence(workspace) {
  const output = run(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    workspace,
  );
  const entries = parsePorcelainStatus(output);
  const passed = entries.length === 0 || (
    entries.length === 1
    && `${entries[0].code} ${entries[0].path}` === PROTECTED_UNTRACKED
  );
  return {
    passed,
    detail: passed
      ? (entries.length === 0 ? 'clean CI checkout' : 'protected user file is the sole untracked path')
      : `unexpected worktree status: ${entries.map(entry => `${entry.code} ${entry.path}`).join(' | ')}`,
  };
}

export function verifyAcceptance({ workspace, options }) {
  const unitReport = readJson(workspace, 'artifacts/acceptance/unit.json');
  const browserReport = readJson(workspace, 'artifacts/acceptance/browser.json');
  const desktopReport = readJson(
    workspace,
    `artifacts/acceptance/desktop-${options.platform}.json`,
  );
  const auditReport = readJson(
    workspace,
    `artifacts/acceptance/audit-${options.platform}.json`,
  );
  const pythonXmlPath = path.join(workspace, 'artifacts', 'acceptance', 'python.xml');
  let pythonXml;
  try {
    pythonXml = fs.readFileSync(pythonXmlPath, 'utf8');
  } catch (error) {
    throw new Error(`Missing machine-readable Python report: ${error.message}`);
  }

  const unit = unitEvidence(unitReport);
  const formulas = formulaEvidence(unitReport);
  const python = pythonEvidence(pythonXml);
  const browser = playwrightEvidence(browserReport, ['5k preview stays bounded and responsive at 320px']);
  const desktop = playwrightEvidence(desktopReport, REQUIRED_DESKTOP_STORIES);
  const installerNames = installers(workspace, options.platform);
  const packageStructure = (() => {
    try {
      run(process.execPath, ['scripts/verify-desktop-package.mjs', options.platform], workspace);
      return { passed: true, detail: `${options.platform} ASAR/package structure verified` };
    } catch (error) {
      return { passed: false, detail: error.message };
    }
  })();
  const packageSize = (() => {
    try {
      run(process.execPath, ['scripts/check-package-size.mjs', options.platform], workspace);
      return { passed: true, detail: `${options.platform} unpacked package size verified` };
    } catch (error) {
      return { passed: false, detail: error.message };
    }
  })();

  const tracked = run('git', ['ls-files'], workspace).split(/\r?\n/);
  const legacyMissing = LEGACY_ROUTES.every(file => !tracked.includes(file));
  const head = run('git', ['rev-parse', 'HEAD'], workspace).trim();
  const manifest = (() => {
    try {
      const value = readJson(workspace, `artifacts/acceptance/manifest-${options.platform}.json`);
      verifyAcceptanceManifest({ workspace, manifest: value, platform: options.platform, head });
      return { passed: true, detail: `all reports, package, and installers match ${head}` };
    } catch (error) {
      return { passed: false, detail: error.message };
    }
  })();
  const qualityCommands = qualityCommandsEvidence(workspace);
  const platformName = 'local-platform-gate';
  const platformDetail = `${options.platform} local packaged E2E is green; opposite platform is not claimed`;
  const platformPassed = desktop.passed;

  const criteria = [
    { id: 1, name: 'formula-tests', ...formulas },
    { id: 2, name: 'six-pdf-goldens', ...python },
    { id: 3, name: '5k-p95-dom', ...browser },
    { id: 4, name: 'worker-cleanup', ...desktop },
    { id: 5, name: 'native-save', ...desktop },
    { id: 6, name: 'safe-api-and-logs', ...desktop },
    {
      id: 7,
      name: 'quality-gates',
      passed: unit.passed && python.passed && browser.passed && packageStructure.passed
        && manifest.passed && qualityCommands.passed,
      detail: `${qualityCommands.detail}; ${manifest.detail}`,
    },
    { id: 8, name: platformName, passed: platformPassed, detail: platformDetail },
    {
      id: 9,
      name: 'legacy-absence',
      passed: legacyMissing,
      detail: legacyMissing ? 'legacy routes absent from Git index' : 'legacy route remains tracked',
    },
    { id: 10, name: 'dependency-audit', ...auditEvidence(auditReport) },
    {
      id: 11,
      name: 'package-size-and-installers',
      passed: packageSize.passed && installerNames.length >= (options.platform === 'mac' ? 2 : 1),
      detail: `${packageSize.detail}; installers: ${installerNames.join(', ') || '(none)'}`,
    },
    { id: 12, name: 'protected-worktree-status', ...statusEvidence(workspace) },
  ];
  return { criteria, head, installerNames };
}

function writeCiEvidence(filePath, options, result) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('--emit-ci-report is allowed only inside GitHub Actions');
  }
  const runId = Number(process.env.GITHUB_RUN_ID);
  const evidence = {
    schemaVersion: 2,
    platform: options.platform,
    conclusion: 'success',
    commit: result.head,
    workflow: 'desktop-e2e',
    runId,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    repository: process.env.GITHUB_REPOSITORY,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    installerNames: result.installerNames,
  };
  assertCiPlatformEvidence(evidence, options.platform, result.head);
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryPath, absolutePath);
  console.log(`[verify-acceptance] Wrote CI platform evidence: ${absolutePath}`);
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const result = verifyAcceptance({ workspace, options });
    for (const criterion of result.criteria) {
      console.log(
        `[verify-acceptance] ${criterion.passed ? 'PASS' : 'FAIL'} `
        + `${criterion.id}/12 ${criterion.name}: ${criterion.detail}`,
      );
    }
    const failed = result.criteria.filter(criterion => !criterion.passed);
    if (failed.length > 0) process.exit(1);
    if (options.emitCiReport) writeCiEvidence(options.emitCiReport, options, result);
    console.log(`[verify-acceptance] Local acceptance is green for ${options.platform}.`);
    console.log('[verify-acceptance] Opposite-platform CI is unverified and is not claimed green.');
  } catch (error) {
    console.error(`[verify-acceptance] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
