import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareAppVersions,
  parseCalVer,
  toMacBundleVersion,
} from './versioning.mjs';

export const RELEASE_ERROR_CODES = Object.freeze({
  NOT_ON_MAIN: 'NOT_ON_MAIN',
  DIRTY_WORKTREE: 'DIRTY_WORKTREE',
  TAG_FETCH_FAILED: 'TAG_FETCH_FAILED',
  MAIN_NOT_CURRENT: 'MAIN_NOT_CURRENT',
  INVALID_CURRENT_VERSION: 'INVALID_CURRENT_VERSION',
  INVALID_RELEASE_TAG: 'INVALID_RELEASE_TAG',
  CURRENT_VERSION_NOT_LATEST: 'CURRENT_VERSION_NOT_LATEST',
  UNRELEASED_VERSION_EXISTS: 'UNRELEASED_VERSION_EXISTS',
  VERSION_COLLISION: 'VERSION_COLLISION',
  DAILY_RELEASE_LIMIT: 'DAILY_RELEASE_LIMIT',
  TAG_VERSION_MISMATCH: 'TAG_VERSION_MISMATCH',
  TAG_DATE_MISMATCH: 'TAG_DATE_MISMATCH',
  VERSION_NOT_IN_ARTIFACT: 'VERSION_NOT_IN_ARTIFACT',
});

export const RELEASE_RECOVERY = Object.freeze({
  NOT_ON_MAIN: 'Switch to main and retry.',
  DIRTY_WORKTREE: 'Commit, move, or restore all worktree and index changes, then retry.',
  TAG_FETCH_FAILED: 'Restore network access and origin permissions, then retry; do not guess offline.',
  MAIN_NOT_CURRENT: 'Synchronize main with origin/main and resolve any divergence, then retry.',
  INVALID_CURRENT_VERSION: 'Repair package.json version and retry.',
  INVALID_RELEASE_TAG: 'Repair the explicit release-tag history before calculating another version.',
  CURRENT_VERSION_NOT_LATEST: 'Switch to or synchronize with the latest published release commit.',
  UNRELEASED_VERSION_EXISTS: 'Finish the pending release, or explicitly refresh it after the Berlin date changes.',
  VERSION_COLLISION: 'Fetch again and calculate a new release sequence.',
  DAILY_RELEASE_LIMIT: 'Wait for the next Europe/Berlin calendar date.',
  TAG_VERSION_MISMATCH: 'Use an annotated HEAD tag exactly matching package.json version.',
  TAG_DATE_MISMATCH: 'Keep the existing tag; prepare a new version for the current Berlin date.',
  VERSION_NOT_IN_ARTIFACT: 'Stop the release and repair build version propagation.',
});

export class ReleaseValidationError extends Error {
  constructor(code, message, recovery = RELEASE_RECOVERY[code]) {
    super(message);
    this.name = 'ReleaseValidationError';
    this.code = code;
    this.recovery = recovery;
  }
}

export function releaseError(code, message) {
  throw new ReleaseValidationError(code, message);
}

function outputText(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value == null ? '' : String(value);
}

export function createGit(cwd, runner = spawnSync) {
  return (args, options = {}) => {
    const result = runner('git', args, {
      cwd,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    if (result.error) throw result.error;
    const status = result.status ?? 0;
    if (status !== 0 && !options.allowFailure) {
      const error = new Error(outputText(result.stderr).trim() || `git ${args.join(' ')} failed`);
      error.status = status;
      error.stderr = outputText(result.stderr);
      throw error;
    }
    return {
      status,
      stdout: outputText(result.stdout).trim(),
      stderr: outputText(result.stderr).trim(),
    };
  };
}

export function listPublishedTags(git) {
  const output = git(['tag', '--list', 'v*']).stdout;
  const tags = output ? output.split(/\r?\n/).filter(Boolean) : [];
  for (const tag of tags) {
    if (tag === 'v0.1.1') continue;
    if (!parseCalVer(tag.slice(1))) {
      releaseError('INVALID_RELEASE_TAG', `Invalid release tag: ${tag}`);
    }
  }
  return tags;
}

export function highestPublishedVersion(tags) {
  return tags
    .map(tag => tag.slice(1))
    .sort(compareAppVersions)
    .at(-1) ?? null;
}

function parsePackageVersion(packageJsonText, prepared) {
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    releaseError('INVALID_CURRENT_VERSION', 'package.json is not valid JSON.');
  }
  const version = packageJson?.version;
  if (typeof version !== 'string' || (!parseCalVer(version) && (prepared || version !== '0.1.1'))) {
    releaseError('INVALID_CURRENT_VERSION', `Invalid package version: ${String(version)}`);
  }
  return version;
}

function berlinDateParts(date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date)
      .filter(part => ['year', 'month', 'day'].includes(part.type))
      .map(part => [part.type, Number(part.value)]),
  );
  return values;
}

const REQUIRED_ARTIFACT_FIELDS = Object.freeze([
  'uiVersion',
  'electronVersion',
  'macShortVersion',
  'macBundleVersion',
  'windowsVersion',
  'artifactNames',
]);

function failArtifact(message) {
  releaseError('VERSION_NOT_IN_ARTIFACT', message);
}

function hasVersionToken(filename, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?=$|[^0-9A-Za-z])`).test(filename);
}

function validateArtifacts(version, artifacts, required) {
  if (artifacts === undefined && !required) return false;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    failArtifact('Complete consumer and artifact evidence is required.');
  }
  const missing = REQUIRED_ARTIFACT_FIELDS.filter(field => !(field in artifacts));
  if (missing.length > 0) {
    failArtifact(`Artifact evidence is incomplete; missing: ${missing.join(', ')}.`);
  }
  const directFields = [
    'uiVersion',
    'electronVersion',
    'macShortVersion',
    'windowsVersion',
  ];
  if (directFields.some(field => typeof artifacts[field] !== 'string' || artifacts[field] === '')) {
    failArtifact('Consumer version evidence must contain non-empty strings.');
  }
  if (directFields.some(field => artifacts[field] !== version)) {
    releaseError('VERSION_NOT_IN_ARTIFACT', 'An artifact metadata version differs from package.json.');
  }
  const expectedMacBundleVersion = version === '0.1.1' ? version : toMacBundleVersion(version);
  if (typeof artifacts.macBundleVersion !== 'string'
      || artifacts.macBundleVersion === ''
      || artifacts.macBundleVersion !== expectedMacBundleVersion) {
    releaseError('VERSION_NOT_IN_ARTIFACT', 'The macOS CFBundleVersion does not match the approved mapping.');
  }
  if (!Array.isArray(artifacts.artifactNames)
      || artifacts.artifactNames.length === 0
      || artifacts.artifactNames.some(name => typeof name !== 'string' || name === '')) {
    failArtifact('Artifact filename evidence must be a non-empty list of non-empty strings.');
  }
  if (artifacts.artifactNames.some(name => !hasVersionToken(name, version))) {
    failArtifact('An artifact filename does not contain an exact package-version token.');
  }
  return true;
}

export async function validateReleaseVersion(options = {}) {
  const {
    cwd = process.cwd(),
    prepared = false,
    runner = spawnSync,
    packageJsonText,
    artifacts,
  } = options;
  const git = createGit(cwd, runner);
  const text = packageJsonText ?? await readFile(join(cwd, 'package.json'), 'utf8');
  const version = parsePackageVersion(text, prepared);
  const tags = listPublishedTags(git);
  const expectedTag = `v${version}`;
  const highest = highestPublishedVersion(tags);

  if (prepared) {
    if (tags.includes(expectedTag)) {
      releaseError('VERSION_COLLISION', `Release tag ${expectedTag} already exists.`);
    }
    if (highest && compareAppVersions(version, highest) <= 0) {
      releaseError('CURRENT_VERSION_NOT_LATEST', `Prepared version ${version} is not above ${highest}.`);
    }
    const artifactsValidated = validateArtifacts(version, artifacts, false);
    return {
      mode: 'prepared',
      version,
      highestPublishedVersion: highest,
      artifactsValidated,
      consumerValidationPending: !artifactsValidated,
    };
  }

  const headTagsOutput = git(['tag', '--points-at', 'HEAD', '--list', 'v*']).stdout;
  const headTags = headTagsOutput ? headTagsOutput.split(/\r?\n/).filter(Boolean) : [];
  if (!headTags.includes(expectedTag)) {
    releaseError('TAG_VERSION_MISMATCH', `HEAD is not tagged exactly ${expectedTag}.`);
  }
  if (git(['cat-file', '-t', `refs/tags/${expectedTag}`]).stdout !== 'tag') {
    releaseError('TAG_VERSION_MISMATCH', `${expectedTag} must be an annotated tag.`);
  }
  if (highest !== version) {
    releaseError('CURRENT_VERSION_NOT_LATEST', `${expectedTag} is not the highest published release tag.`);
  }

  const calVer = parseCalVer(version);
  if (calVer) {
    const taggerText = git([
      'for-each-ref',
      '--format=%(taggerdate:iso-strict)',
      `refs/tags/${expectedTag}`,
    ]).stdout;
    const taggerDate = new Date(taggerText);
    if (!taggerText || !Number.isFinite(taggerDate.getTime())) {
      releaseError('TAG_DATE_MISMATCH', `${expectedTag} has no valid annotated tagger date.`);
    }
    const actual = berlinDateParts(taggerDate);
    if (actual.year !== calVer.year || actual.month !== calVer.month || actual.day !== calVer.day) {
      releaseError('TAG_DATE_MISMATCH', `${expectedTag} tagger date does not match its Berlin CalVer date.`);
    }
  }

  validateArtifacts(version, artifacts, true);
  return {
    mode: 'tag',
    version,
    tag: expectedTag,
    highestPublishedVersion: highest,
    artifactsValidated: true,
  };
}

function formatFailure(error) {
  if (error instanceof ReleaseValidationError) {
    return `[${error.code}] ${error.message}\nRecovery: ${error.recovery}`;
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== '--prepared');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}`);
  }
  const result = await validateReleaseVersion({ prepared: args.includes('--prepared') });
  if (result.mode === 'prepared' && !result.artifactsValidated) {
    process.stdout.write(
      `Validated prepared version prerequisites ${result.version}; consumer validation pending.\n`,
    );
    return;
  }
  process.stdout.write(`Validated ${result.mode} release version ${result.version}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${formatFailure(error)}\n`);
    process.exitCode = 1;
  });
}
