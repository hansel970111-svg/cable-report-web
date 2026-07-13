import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const requiredDockerExclusions = [
  'next-build',
  'worker-bin',
  'release',
  '.pyinstaller',
  '.superpowers',
  'docs/superpowers/plans',
  'tests/python/golden',
];
const protectedUntrackedPath = 'src/app/api/upload-excel/route 2.ts';

function fail(message) {
  console.error(`[verify-build-inputs] ${message}`);
  process.exit(1);
}

function indexedPaths() {
  const result = spawnSync('git', ['ls-files', '--cached', '-z'], {
    cwd: workspace,
    encoding: 'buffer',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail('Git-index input enumeration failed; no physical-worktree fallback is allowed.');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function normalizeEntry(entryPath) {
  return String(entryPath || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function platformOutputReason(entry) {
  const normalized = normalizeEntry(entry.path ?? entry);
  const segments = normalized.split('/');
  const basename = segments.at(-1) || '';
  const format = String(entry.format || entry.fileType || entry.type || '');

  if (normalized === protectedUntrackedPath && entry.tracked === false) {
    return 'protected untracked input';
  }
  if (entry.tracked === false) return 'untracked input';
  if (segments.some(segment => segment.endsWith('.app'))) return 'macOS app output';
  if (/\.exe$/i.test(basename)) return 'Windows executable output';
  if (segments[0] === 'worker-bin') return 'local worker output';
  if (segments[0] === 'release') return 'release output';
  if (segments[0] === '.pyinstaller') return '.pyinstaller output';
  if (segments.includes('.cache') || segments.includes('cache')) return 'cache output';
  if (segments.includes('diagnostics')) return 'diagnostics output';
  if (process.platform === 'linux' && /mach-o/i.test(format)) return 'Mach-O input on Linux';
  return null;
}

function parseManifest(filePath) {
  const relative = normalizeEntry(path.relative(workspace, path.resolve(workspace, filePath)));
  if (relative === protectedUntrackedPath) {
    fail(`Refusing to access protected untracked path as a manifest: ${relative}`);
  }

  let source;
  try {
    source = fs.readFileSync(path.resolve(workspace, filePath), 'utf8');
  } catch (error) {
    fail(`Unable to read explicit manifest ${filePath}: ${error instanceof Error ? error.message : error}`);
  }

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.entries)) return parsed.entries;
    if (Array.isArray(parsed.files)) return parsed.files;
    fail(`Explicit manifest ${filePath} must contain an array, entries, or files.`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    }
    throw error;
  }
}

function manifestPathsFromArgs(args) {
  const manifests = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--manifest' || !args[index + 1]) {
      fail(`Unknown or incomplete argument: ${args[index] || '(missing)'}`);
    }
    manifests.push(args[index + 1]);
    index += 1;
  }
  return manifests;
}

const dockerIgnorePath = path.join(workspace, '.dockerignore');
const packageJsonPath = path.join(workspace, 'package.json');
let dockerExclusions;
let packageJson;
try {
  dockerExclusions = new Set(
    fs.readFileSync(dockerIgnorePath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
  );
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (error) {
  fail(`Unable to read required build configuration: ${error instanceof Error ? error.message : error}`);
}

for (const exclusion of requiredDockerExclusions) {
  if (!dockerExclusions.has(exclusion)) fail(`.dockerignore is missing ${exclusion}.`);
}

const tracked = indexedPaths();
for (const trackedPath of tracked) {
  const reason = platformOutputReason({ path: trackedPath, tracked: true });
  if (reason) fail(`Git index contains forbidden ${reason}: ${trackedPath}`);
}

const packageFiles = packageJson.build?.files;
if (!Array.isArray(packageFiles)) fail('package.json build.files must be an explicit array.');
for (const packageEntry of packageFiles) {
  const reason = platformOutputReason({ path: packageEntry, tracked: true });
  if (reason) fail(`package.json build.files contains forbidden ${reason}: ${packageEntry}`);
}

for (const manifestPath of manifestPathsFromArgs(process.argv.slice(2))) {
  for (const suppliedEntry of parseManifest(manifestPath)) {
    const entry = typeof suppliedEntry === 'string' ? { path: suppliedEntry } : suppliedEntry;
    if (!entry || typeof entry.path !== 'string') {
      fail(`Explicit manifest ${manifestPath} contains an entry without a path.`);
    }
    const reason = platformOutputReason(entry);
    if (reason) {
      fail(`Explicit manifest contains forbidden manifest entry (${reason}): ${entry.path}`);
    }
  }
}

console.log(
  `[verify-build-inputs] Verified ${tracked.length} Git-index paths, ` +
  `${packageFiles.length} package patterns, and explicit configuration only.`,
);
