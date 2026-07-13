import { getRawHeader, listPackage } from '@electron/asar';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : 'mac');
const productName = 'Cable Report Generator';
const templateNames = [
  'M138-DE46-D-P-cross-LC.pdf',
  'M138-DE46-OOB-Cat5e.pdf',
  'M138-DE46-P-A-MPO.pdf',
];
let failed = false;

function fail(message) {
  failed = true;
  console.error(`[verify-desktop-package] ${message}`);
}

function existingDirectory(candidates) {
  return candidates.find(candidate => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  }) || candidates[0];
}

function findMacAppDir(unpackedDir) {
  const preferred = path.join(unpackedDir, `${productName}.app`);
  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(unpackedDir)) return preferred;
  const appName = fs.readdirSync(unpackedDir).find(name => name.endsWith('.app'));
  return appName ? path.join(unpackedDir, appName) : preferred;
}

function requireFile(filePath, description) {
  try {
    if (fs.statSync(filePath).isFile()) return true;
  } catch {
    // Report the fixed failure below.
  }
  fail(`Missing ${description}: ${filePath}`);
  return false;
}

function requireExactDirectory(dirPath, expectedNames, description) {
  let actualNames;
  try {
    if (!fs.statSync(dirPath).isDirectory()) throw new Error('not a directory');
    actualNames = fs.readdirSync(dirPath).sort();
  } catch {
    fail(`Missing ${description}: ${dirPath}`);
    return;
  }

  const expected = [...expectedNames].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
    fail(
      `${description} must contain exactly ${expected.join(', ')}; ` +
      `found ${actualNames.join(', ') || '(empty)'}.`,
    );
    return;
  }

  for (const name of expected) {
    requireFile(path.join(dirPath, name), `${description} file ${name}`);
  }
}

function collectArchiveLinks(node, prefix = '') {
  const links = [];
  for (const [name, entry] of Object.entries(node?.files || {})) {
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (typeof entry.link === 'string') {
      links.push({ entryPath, target: entry.link });
    }
    if (entry.files) links.push(...collectArchiveLinks(entry, entryPath));
  }
  return links;
}

const unpackedDir = platform === 'win'
  ? path.join(workspace, 'release', 'win-unpacked')
  : existingDirectory([
      path.join(workspace, 'release', 'mac'),
      path.join(workspace, 'release', 'mac-arm64'),
      path.join(workspace, 'release', 'mac-x64'),
      path.join(workspace, 'release', 'mac-universal'),
    ]);
const macAppDir = platform === 'win' ? null : findMacAppDir(unpackedDir);
const resourcesDir = platform === 'win'
  ? path.join(unpackedDir, 'resources')
  : path.join(macAppDir, 'Contents', 'Resources');
const appAsarPath = path.join(resourcesDir, 'app.asar');

requireFile(appAsarPath, 'ASAR application archive');

let entries = [];
let archiveLinks = [];
if (fs.existsSync(appAsarPath)) {
  try {
    entries = listPackage(appAsarPath).map(entry => (
      entry.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/$/, '')
    ));
    const { header } = await getRawHeader(appAsarPath);
    archiveLinks = collectArchiveLinks(header);
  } catch (error) {
    fail(`Unable to inspect ASAR archive ${appAsarPath}: ${error instanceof Error ? error.message : error}`);
  }
}
const entrySet = new Set(entries);

for (const { entryPath, target } of archiveLinks) {
  if (
    entryPath === 'next-build/standalone/node_modules' ||
    entryPath.startsWith('next-build/standalone/node_modules/')
  ) {
    fail(`ASAR standalone dependency tree contains symlink: ${entryPath} -> ${target}`);
  }
}

const requiredEntries = [
  'package.json',
  'next.config.mjs',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/standalone-runtime.cjs',
  'scripts/versioning.mjs',
  'next-build/standalone/server.js',
  'next-build/standalone/package.json',
  'next-build/standalone/next-build/BUILD_ID',
  'next-build/standalone/next-build/routes-manifest.json',
];
for (const requiredEntry of requiredEntries) {
  if (!entrySet.has(requiredEntry)) {
    fail(`ASAR archive is missing required entry: ${requiredEntry}`);
  }
}

const requiredTrees = [
  'next-build/standalone/node_modules',
  'next-build/standalone/next-build/server',
  'next-build/standalone/next-build/static',
];
for (const requiredTree of requiredTrees) {
  if (!entries.some(entry => entry === requiredTree || entry.startsWith(`${requiredTree}/`))) {
    fail(`ASAR archive is missing required tree: ${requiredTree}`);
  }
}

function forbiddenReason(entry) {
  const segments = entry.split('/');
  const basename = segments.at(-1) || '';
  if (entry === 'node_modules' || entry.startsWith('node_modules/')) {
    return 'root node_modules';
  }
  if (segments.includes('cache')) return 'cache output';
  if (segments.includes('diagnostics')) return 'diagnostics output';
  if (segments.includes('.pyinstaller')) return '.pyinstaller output';
  if (segments.includes('tests') || segments.includes('__tests__')) return 'test source';
  if (/^(?:test_|debug[-_])[^/]*\.pdf$/i.test(basename)) return 'debug PDF';
  if (basename === 'FRWE366-N101_MPO.pdf') return 'generated debug PDF';
  if (/^pdf_worker(?:\.exe)?$/i.test(basename)) return 'embedded PDF worker';
  if (templateNames.includes(basename)) return 'embedded template PDF';
  return null;
}

for (const entry of entries) {
  const reason = forbiddenReason(entry);
  if (reason) fail(`ASAR archive contains forbidden ${reason}: ${entry}`);
}

for (const legacyPath of [
  path.join(resourcesDir, 'app'),
  path.join(resourcesDir, 'app.asar.unpacked'),
]) {
  if (fs.existsSync(legacyPath)) {
    fail(`Packaged resources contain a forbidden copied/unpacked app tree: ${legacyPath}`);
  }
}

const workerName = platform === 'win' ? 'pdf_worker.exe' : 'pdf_worker';
requireExactDirectory(path.join(resourcesDir, 'bin'), [workerName], 'external worker directory');
requireExactDirectory(path.join(resourcesDir, 'assets'), templateNames, 'external template directory');

if (failed) process.exit(1);
console.log(
  `[verify-desktop-package] ${platform} package structure looks good ` +
  `(${entries.length} ASAR entries, one worker, three templates).`,
);
