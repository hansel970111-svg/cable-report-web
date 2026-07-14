import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const releaseDir = path.join(workspace, 'release');
let failed = false;

function fail(message) {
  failed = true;
  console.error(`[verify-macos-trust] ${message}`);
}

function runChecked(command, args, description) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error || result.signal || result.status !== 0) {
    fail(
      `${description} failed${Number.isInteger(result.status) ? ` (exit ${result.status})` : ''}: ` +
      `${output || result.error?.message || result.signal || 'no command output'}`,
    );
    return null;
  }
  return output;
}

function findSinglePath(predicate, description) {
  let candidates = [];
  try {
    candidates = fs.readdirSync(releaseDir, { withFileTypes: true })
      .filter(predicate)
      .map(entry => path.join(releaseDir, entry.name))
      .sort();
  } catch (error) {
    fail(`Unable to inspect ${releaseDir}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  if (candidates.length !== 1) {
    fail(`Expected exactly one ${description}; found ${candidates.length}.`);
    return null;
  }
  return candidates[0];
}

function findMacApp() {
  const unpackedDir = findSinglePath(
    entry => entry.isDirectory() && /^mac(?:-|$)/u.test(entry.name),
    'macOS unpacked directory',
  );
  if (!unpackedDir) return null;
  const appNames = fs.readdirSync(unpackedDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    .map(entry => entry.name)
    .sort();
  if (appNames.length !== 1) {
    fail(`Expected exactly one macOS application bundle; found ${appNames.length}.`);
    return null;
  }
  return path.join(unpackedDir, appNames[0]);
}

if (process.platform !== 'darwin') {
  fail('macOS trust verification must run on macOS.');
}

const dmgPath = findSinglePath(
  entry => entry.isFile() && entry.name.endsWith('.dmg'),
  'macOS DMG',
);
const appDir = findMacApp();

if (dmgPath) {
  runChecked('/usr/bin/hdiutil', ['verify', dmgPath], `DMG integrity verification for ${dmgPath}`);
}

if (appDir) {
  runChecked(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=4', appDir],
    `strict code-signature verification for ${appDir}`,
  );
}

if (failed) process.exit(1);
console.log('[verify-macos-trust] internal macOS package checks passed; no installer is published.');
