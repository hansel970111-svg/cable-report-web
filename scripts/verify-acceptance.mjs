import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_DESKTOP_STORIES = [
  'packaged Cat5e import edit generate native save',
  'packaged LC import edit generate native save',
  'packaged MPO import edit generate native save',
  'native Save As cancellation returns to ready without false success',
  'packaged renderer API and external navigation stay inside the allowlist',
  'packaged production modules contain no updater download install or execute path',
  'cancel terminates a deterministic test-only hanging pdf_worker and cleans task data',
  'timeout terminates the hanging pdf_worker and exposes REPORT_TIMEOUT',
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
  if (evidence?.schemaVersion !== 1) throw new Error('CI evidence schemaVersion must be 1');
  if (evidence.platform !== expectedPlatform) {
    throw new Error(`CI evidence platform must be ${expectedPlatform}`);
  }
  if (evidence.conclusion !== 'success') throw new Error('CI evidence conclusion must be success');
  if (evidence.commit !== expectedCommit) throw new Error('CI evidence commit does not match HEAD');
  if (evidence.workflow !== 'desktop-e2e') throw new Error('CI evidence workflow must be desktop-e2e');
  if (!Number.isSafeInteger(evidence.runId) || evidence.runId <= 0) {
    throw new Error('CI evidence runId must be a positive integer');
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
    else if (argument === '--require-ci-platform') options.requireCiPlatform = argv[++index];
    else if (argument === '--ci-report') options.ciReport = argv[++index];
    else if (argument === '--emit-ci-report') options.emitCiReport = argv[++index];
    else throw new Error(`Unknown acceptance argument: ${argument}`);
  }
  if (!['mac', 'win'].includes(options.platform)) throw new Error('--platform must be mac or win');
  if (options.requireCiPlatform && !['mac', 'win'].includes(options.requireCiPlatform)) {
    throw new Error('--require-ci-platform must be mac or win');
  }
  if (options.requireCiPlatform === options.platform) {
    throw new Error('--require-ci-platform must name the other platform');
  }
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

function pythonEvidence(xml) {
  const failures = [...xml.matchAll(/\bfailures="(\d+)"/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
  const errors = [...xml.matchAll(/\berrors="(\d+)"/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
  const missingGoldens = GOLDEN_CASES.filter(name => !xml.includes(name));
  return {
    passed: failures === 0 && errors === 0 && missingGoldens.length === 0,
    detail: missingGoldens.length > 0
      ? `missing golden cases: ${missingGoldens.join(', ')}`
      : `six golden cases present; ${failures} failures and ${errors} errors`,
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
  let platformName = 'local-platform-gate';
  let platformDetail = `${options.platform} local packaged E2E is green; opposite platform is not claimed`;
  let platformPassed = desktop.passed;
  if (options.requireCiPlatform) {
    const reportPath = options.ciReport
      || `artifacts/acceptance/ci-${options.requireCiPlatform}.json`;
    const ciEvidence = readJson(workspace, reportPath);
    assertCiPlatformEvidence(ciEvidence, options.requireCiPlatform, head);
    platformName = 'cross-platform-jobs';
    platformDetail = `${options.platform} local and ${options.requireCiPlatform} CI are green for ${head}`;
  }

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
      passed: unit.passed && python.passed && browser.passed && packageStructure.passed,
      detail: 'unit, Python, browser, build/package structure reports are green',
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
    schemaVersion: 1,
    platform: options.platform,
    conclusion: 'success',
    commit: result.head,
    workflow: 'desktop-e2e',
    runId,
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
    if (!options.requireCiPlatform) {
      console.log('[verify-acceptance] Opposite-platform CI is unverified and is not claimed green.');
    }
  } catch (error) {
    console.error(`[verify-acceptance] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
