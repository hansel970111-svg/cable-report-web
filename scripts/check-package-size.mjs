import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const BASELINE_APP_BYTES = 857_735_168;
export const MAX_APP_BYTES = 643_301_376;

const productName = 'Cable Report Generator';

function existingDirectory(candidates) {
  return candidates.find(candidate => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  }) || candidates[0];
}

function findMacAppDir(workspace) {
  const unpackedDir = existingDirectory([
    path.join(workspace, 'release', 'mac'),
    path.join(workspace, 'release', 'mac-arm64'),
    path.join(workspace, 'release', 'mac-x64'),
    path.join(workspace, 'release', 'mac-universal'),
  ]);
  const preferred = path.join(unpackedDir, `${productName}.app`);
  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(unpackedDir)) return preferred;
  const appName = fs.readdirSync(unpackedDir).find(name => name.endsWith('.app'));
  return appName ? path.join(unpackedDir, appName) : preferred;
}

function measureTree(root) {
  const pending = [root];
  const paths = [];
  let totalBytes = 0;

  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) {
        pending.push(path.join(current, name));
      }
      continue;
    }

    totalBytes += stat.size;
    paths.push({ path: path.relative(root, current) || path.basename(current), bytes: stat.size });
  }

  paths.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  return { totalBytes, largestPaths: paths.slice(0, 10) };
}

function printLargest(paths) {
  console.log('[check-package-size] Ten largest paths:');
  for (const entry of paths) {
    console.log(`[check-package-size] ${entry.bytes} ${entry.path}`);
  }
}

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : 'mac');
const appRoot = platform === 'win'
  ? path.join(workspace, 'release', 'win-unpacked')
  : findMacAppDir(workspace);

if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
  console.error(`[check-package-size] Missing unpacked ${platform} application: ${appRoot}`);
  process.exit(1);
}

const { totalBytes, largestPaths } = measureTree(appRoot);
console.log(`[check-package-size] ${platform} unpacked total bytes: ${totalBytes}`);

if (platform === 'mac') {
  printLargest(largestPaths);
  if (totalBytes > MAX_APP_BYTES) {
    console.error(
      `[check-package-size] ${totalBytes} exceeds macOS package budget ${MAX_APP_BYTES}.`,
    );
    process.exit(1);
  }
  console.log(`[check-package-size] macOS package is within ${MAX_APP_BYTES} bytes.`);
} else if (platform === 'win') {
  console.log(
    '[check-package-size] Windows size is informational until a committed Windows baseline exists.',
  );
} else {
  console.error(`[check-package-size] Unsupported platform: ${platform}`);
  process.exit(1);
}
