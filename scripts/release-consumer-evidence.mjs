import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseCalVer, toMacBundleVersion } from './versioning.mjs';

const ARTIFACT_NAME_PATTERN = 'Cable-Report-Generator-${version}-${os}-${arch}.${ext}';
let importSequence = 0;

export class VersionConsumerEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VersionConsumerEvidenceError';
  }
}

function fail(message) {
  throw new VersionConsumerEvidenceError(message);
}

function assertEqual(actual, expected, consumer) {
  if (actual !== expected) {
    fail(`${consumer} differs from package.json version ${expected}.`);
  }
}

async function importFresh(filename) {
  const url = pathToFileURL(filename);
  importSequence += 1;
  url.searchParams.set('releaseConsumerEvidence', `${Date.now()}-${importSequence}`);
  return import(url.href);
}

async function readRequiredSource(cwd, relativePath) {
  try {
    const source = await readFile(join(cwd, relativePath), 'utf8');
    if (source === '') fail(`Required consumer source is empty: ${relativePath}.`);
    return source;
  } catch (error) {
    if (error instanceof VersionConsumerEvidenceError) throw error;
    fail(
      `Could not read required consumer source ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function renderArtifactName(pattern, values) {
  const rendered = pattern.replace(/\$\{(version|os|arch|ext)\}/g, (_match, key) => values[key]);
  if (/\$\{[^}]+\}/.test(rendered)) {
    fail(`Artifact name contains an unsupported macro: ${pattern}.`);
  }
  return rendered;
}

function assertSourceWiring(sources) {
  if (!/export const APP_VERSION[^=]*=\s*process\.env\.CABLE_REPORT_APP_VERSION/u
    .test(sources.appVersion)) {
    fail('The renderer version module is not wired to the immutable Next build constant.');
  }
  if (!/import\s*\{\s*APP_VERSION\s*\}.*@\/lib\/app-version/u.test(sources.editor)
      || !/<footer[^>]*>[\s\S]*\u7248\u672c\s*\{APP_VERSION\}[\s\S]*<\/footer>/u
        .test(sources.editor)) {
    fail('ReportEditor does not render the configured application version footer.');
  }
  if (!/app\.setAboutPanelOptions\(\{[\s\S]*applicationName:\s*app\.getName\(\)[\s\S]*applicationVersion:\s*app\.getVersion\(\)[\s\S]*version:\s*app\.getVersion\(\)[\s\S]*\}\)/u
    .test(sources.electronMain)) {
    fail('Electron About metadata is not derived from app package metadata.');
  }

  for (const [relativePath, source] of Object.entries(sources)) {
    const literals = source.match(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/gu) ?? [];
    if (literals.length > 0) {
      fail(`Hard-coded version literal found in ${relativePath}: ${literals.join(', ')}.`);
    }
  }
}

export async function collectVersionConsumerEvidence({ cwd, expectedVersion }) {
  if (typeof cwd !== 'string' || cwd === '') fail('A project directory is required.');
  if (typeof expectedVersion !== 'string' || expectedVersion === '') {
    fail('An expected package version is required.');
  }

  const packageJsonText = await readRequiredSource(cwd, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    fail('package.json is not valid JSON.');
  }
  assertEqual(packageJson.version, expectedVersion, 'package.json');
  if (packageJson.build?.extends !== './electron-builder.config.mjs') {
    fail('package.json build.extends does not load electron-builder.config.mjs.');
  }

  let nextConfig;
  let builderConfig;
  try {
    [nextConfig, builderConfig] = await Promise.all([
      importFresh(join(cwd, 'next.config.mjs')),
      importFresh(join(cwd, 'electron-builder.config.mjs')),
    ]);
  } catch (error) {
    fail(
      `Could not load version consumer configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const effectiveNextConfig = nextConfig.default;
  const effectiveBuilderConfig = builderConfig.default;

  assertEqual(
    effectiveNextConfig?.env?.CABLE_REPORT_APP_VERSION,
    expectedVersion,
    'Next build-time version',
  );
  if (effectiveBuilderConfig?.productName !== 'Cable Report Generator') {
    fail('Electron Builder productName is not configured.');
  }
  if (effectiveBuilderConfig?.artifactName !== ARTIFACT_NAME_PATTERN) {
    fail('Electron Builder artifactName does not use the approved platform pattern.');
  }
  if ('buildVersion' in effectiveBuilderConfig) {
    fail('Electron Builder must not override top-level buildVersion.');
  }

  const expectedMacBundleVersion = parseCalVer(expectedVersion)
    ? toMacBundleVersion(expectedVersion)
    : expectedVersion;
  assertEqual(
    effectiveBuilderConfig?.mac?.bundleShortVersion,
    expectedVersion,
    'macOS public version',
  );
  assertEqual(
    effectiveBuilderConfig?.mac?.bundleVersion,
    expectedMacBundleVersion,
    'macOS bundle version',
  );
  assertEqual(
    effectiveBuilderConfig?.extraMetadata?.shortVersion,
    expectedVersion,
    'Windows FileVersion',
  );
  assertEqual(
    effectiveBuilderConfig?.extraMetadata?.shortVersionWindows,
    expectedVersion,
    'Windows ProductVersion',
  );

  const sources = {
    'electron/main.cjs': await readRequiredSource(cwd, 'electron/main.cjs'),
    'next.config.mjs': await readRequiredSource(cwd, 'next.config.mjs'),
    'src/features/report-editor/report-editor.tsx': await readRequiredSource(
      cwd,
      'src/features/report-editor/report-editor.tsx',
    ),
    'src/lib/app-version.ts': await readRequiredSource(cwd, 'src/lib/app-version.ts'),
  };
  assertSourceWiring({
    appVersion: sources['src/lib/app-version.ts'],
    editor: sources['src/features/report-editor/report-editor.tsx'],
    electronMain: sources['electron/main.cjs'],
    nextConfig: sources['next.config.mjs'],
  });

  return Object.freeze({
    artifactNamePattern: ARTIFACT_NAME_PATTERN,
    configuredArtifactNames: Object.freeze([
      renderArtifactName(ARTIFACT_NAME_PATTERN, {
        arch: 'x64',
        ext: 'dmg',
        os: 'mac',
        version: expectedVersion,
      }),
      renderArtifactName(ARTIFACT_NAME_PATTERN, {
        arch: 'x64',
        ext: 'exe',
        os: 'win',
        version: expectedVersion,
      }),
    ]),
    electronVersion: expectedVersion,
    macBundleVersion: expectedMacBundleVersion,
    macShortVersion: expectedVersion,
    productName: effectiveBuilderConfig.productName,
    uiVersion: expectedVersion,
    windowsVersion: expectedVersion,
  });
}
