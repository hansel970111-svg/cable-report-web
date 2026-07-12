import { spawnSync } from 'node:child_process';
import {
  readFile, rename, unlink, writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareAppVersions,
  nextReleaseVersion,
  parseCalVer,
  VersioningError,
} from './versioning.mjs';
import {
  createGit,
  highestPublishedVersion,
  listPublishedTags,
  releaseError,
  ReleaseValidationError,
  validateReleaseVersion,
} from './validate-release-version.mjs';

const defaultFileSystem = { readFile, rename, unlink, writeFile };

function parsePackage(text) {
  let packageJson;
  try {
    packageJson = JSON.parse(text);
  } catch {
    releaseError('INVALID_CURRENT_VERSION', 'package.json is not valid JSON.');
  }
  const version = packageJson?.version;
  if (typeof version !== 'string' || (version !== '0.1.1' && !parseCalVer(version))) {
    releaseError('INVALID_CURRENT_VERSION', `Invalid package version: ${String(version)}`);
  }
  return packageJson;
}

function command(runner, commandName, args, cwd) {
  const result = runner(commandName, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr ?? '');
    throw new Error(stderr.trim() || `${commandName} ${args.join(' ')} failed`);
  }
}

async function writeTextAtomically(packagePath, text, fileSystem) {
  const directory = dirname(packagePath);
  const temporaryPath = join(
    directory,
    `.${basename(packagePath)}.release-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await fileSystem.writeFile(temporaryPath, text, 'utf8');
    await fileSystem.rename(temporaryPath, packagePath);
  } catch (error) {
    try {
      await fileSystem.unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already have been renamed.
    }
    throw error;
  }
}

function fetchAndAssertMainCurrent(git) {
  try {
    git(['fetch', 'origin', 'main', '--tags', '--prune']);
  } catch (error) {
    throw new ReleaseValidationError(
      'TAG_FETCH_FAILED',
      `Could not fetch origin/main and release tags: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const counts = git(['rev-list', '--left-right', '--count', 'main...origin/main']).stdout
    .split(/\s+/)
    .map(Number);
  const remoteAhead = counts[1];
  if (counts.length !== 2 || counts.some(value => !Number.isInteger(value)) || remoteAhead > 0) {
    releaseError('MAIN_NOT_CURRENT', 'Local main is behind or diverged from origin/main.');
  }
}

function sameTags(left, right) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function instructionsFor(version) {
  return [
    `Prepared release version ${version} (Europe/Berlin).`,
    '',
    'Review the diff, then run:',
    'git add package.json',
    `git commit -m "chore(release): prepare v${version}"`,
    `git tag -a v${version} -m "Release v${version}"`,
    `git push origin main v${version}`,
  ].join('\n');
}

export async function prepareRelease(options = {}) {
  const {
    cwd = process.cwd(),
    now = new Date(),
    refreshUnreleased = false,
    runner = spawnSync,
    checkRunner = spawnSync,
    fileSystem = defaultFileSystem,
    runPostChecks = false,
  } = options;
  const git = createGit(cwd, runner);

  if (git(['branch', '--show-current']).stdout !== 'main') {
    releaseError('NOT_ON_MAIN', 'Release preparation is allowed only on main.');
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all']).stdout !== '') {
    releaseError('DIRTY_WORKTREE', 'The worktree or index has uncommitted changes.');
  }
  fetchAndAssertMainCurrent(git);

  const packagePath = join(cwd, 'package.json');
  const originalText = await fileSystem.readFile(packagePath, 'utf8');
  const packageJson = parsePackage(originalText);
  const currentVersion = packageJson.version;
  const publishedTags = listPublishedTags(git);
  const currentTag = `v${currentVersion}`;
  const currentIsPublished = publishedTags.includes(currentTag);

  if (refreshUnreleased && !parseCalVer(currentVersion)) {
    throw new ReleaseValidationError(
      'INVALID_CURRENT_VERSION',
      `Cannot refresh historical package version ${currentVersion}; refresh requires an untagged CalVer.`,
      'Prepare a CalVer normally from the historical release; only an untagged CalVer can be refreshed.',
    );
  }
  if (refreshUnreleased && currentIsPublished) {
    releaseError('VERSION_COLLISION', `${currentTag} is published and cannot be refreshed.`);
  }
  if (parseCalVer(currentVersion) && !currentIsPublished && !refreshUnreleased) {
    releaseError('UNRELEASED_VERSION_EXISTS', `Unreleased version ${currentVersion} is already prepared.`);
  }

  if (!refreshUnreleased) {
    const highest = highestPublishedVersion(publishedTags);
    if (!currentIsPublished || highest !== currentVersion) {
      releaseError(
        'CURRENT_VERSION_NOT_LATEST',
        `package.json version ${currentVersion} is not the highest published version ${String(highest)}.`,
      );
    }
    const ancestry = git(
      ['merge-base', '--is-ancestor', `refs/tags/${currentTag}`, 'HEAD'],
      { allowFailure: true },
    );
    if (ancestry.status !== 0) {
      releaseError('CURRENT_VERSION_NOT_LATEST', `${currentTag} is not an ancestor of HEAD.`);
    }
  }

  let version;
  try {
    version = nextReleaseVersion({
      now,
      timeZone: 'Europe/Berlin',
      publishedTags,
    });
  } catch (error) {
    if (error instanceof VersioningError) {
      if (error.code === 'DAILY_RELEASE_LIMIT') {
        throw new ReleaseValidationError('DAILY_RELEASE_LIMIT', error.message);
      }
      if (error.code === 'INVALID_RELEASE_TAG') {
        throw new ReleaseValidationError('INVALID_RELEASE_TAG', error.message);
      }
    }
    throw error;
  }

  fetchAndAssertMainCurrent(git);
  const tagsImmediatelyBeforeWrite = listPublishedTags(git);
  if (!sameTags(tagsImmediatelyBeforeWrite, publishedTags)) {
    releaseError('VERSION_COLLISION', 'Release tag history changed during preparation.');
  }
  if (tagsImmediatelyBeforeWrite.includes(`v${version}`)) {
    releaseError('VERSION_COLLISION', `Release tag v${version} appeared during preparation.`);
  }
  const highestBeforeWrite = highestPublishedVersion(tagsImmediatelyBeforeWrite);
  if (highestBeforeWrite && compareAppVersions(version, highestBeforeWrite) <= 0) {
    releaseError('VERSION_COLLISION', `Release history changed while preparing ${version}.`);
  }

  const nextPackage = { ...packageJson, version };
  const nextText = `${JSON.stringify(nextPackage, null, 2)}\n`;
  await validateReleaseVersion({
    cwd,
    prepared: true,
    runner,
    packageJsonText: nextText,
  });

  await writeTextAtomically(packagePath, nextText, fileSystem);
  if (runPostChecks) {
    try {
      command(
        checkRunner,
        process.execPath,
        ['scripts/validate-release-version.mjs', '--prepared'],
        cwd,
      );
      command(checkRunner, 'corepack', [
        'pnpm', 'vitest', 'run', 'tests/release/versioning.test.ts',
      ], cwd);
      command(checkRunner, process.execPath, ['scripts/verify-dependency-policy.mjs'], cwd);
    } catch (postcheckError) {
      try {
        await writeTextAtomically(packagePath, originalText, fileSystem);
      } catch (rollbackError) {
        const combined = new AggregateError(
          [postcheckError, rollbackError],
          `Release postcheck failed: ${errorMessage(postcheckError)}\nRollback failed: ${errorMessage(rollbackError)}`,
        );
        throw combined;
      }
      throw postcheckError;
    }
  }
  const instructions = instructionsFor(version);
  return { version, instructions };
}

function formatFailure(error) {
  if (error instanceof ReleaseValidationError) {
    return `[${error.code}] ${error.message}\nRecovery: ${error.recovery}`;
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const unknown = args.filter(arg => arg !== '--refresh-unreleased');
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const result = await prepareRelease({
    refreshUnreleased: args.includes('--refresh-unreleased'),
    runPostChecks: true,
  });
  process.stdout.write(`${result.instructions}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${formatFailure(error)}\n`);
    process.exitCode = 1;
  });
}
