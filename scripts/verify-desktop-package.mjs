import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : 'mac');

function fail(message) {
  console.error(`[verify-desktop-package] ${message}`);
  process.exitCode = 1;
}

function requirePath(filePath, description) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${description}: ${filePath}`);
    return false;
  }
  return true;
}

function requireDir(dirPath, description) {
  if (!requirePath(dirPath, description)) return false;
  if (!fs.statSync(dirPath).isDirectory()) {
    fail(`${description} is not a directory: ${dirPath}`);
    return false;
  }
  return true;
}

function requireFile(filePath, description) {
  if (!requirePath(filePath, description)) return false;
  if (!fs.statSync(filePath).isFile()) {
    fail(`${description} is not a file: ${filePath}`);
    return false;
  }
  return true;
}

const unpackedDir = platform === 'win'
  ? path.join(workspace, 'release', 'win-unpacked')
  : path.join(workspace, 'release', 'mac');

const resourcesDir = path.join(unpackedDir, 'resources');
const appDir = path.join(resourcesDir, 'app');
const nextBuildDir = path.join(appDir, 'next-build');
const workerExt = platform === 'win' ? '.exe' : '';

requireDir(unpackedDir, 'unpacked desktop app directory');
requireDir(resourcesDir, 'desktop resources directory');
requireDir(appDir, 'packaged app directory');
requireDir(nextBuildDir, 'Next.js production build directory');

const requiredFiles = [
  [path.join(appDir, 'package.json'), 'packaged package.json'],
  [path.join(appDir, 'next.config.mjs'), 'Next config'],
  [path.join(appDir, 'electron', 'main.cjs'), 'Electron main process'],
  [path.join(nextBuildDir, 'BUILD_ID'), 'Next build id'],
  [path.join(nextBuildDir, 'routes-manifest.json'), 'Next routes manifest'],
  [path.join(nextBuildDir, 'server'), 'Next server output'],
  [path.join(nextBuildDir, 'static'), 'Next static output'],
  [path.join(appDir, 'assets', 'M138-DE46-OOB-Cat5e.pdf'), 'Cat 5e template PDF'],
  [path.join(appDir, 'assets', 'M138-DE46-D-P-cross-LC.pdf'), 'LC template PDF'],
  [path.join(appDir, 'assets', 'M138-DE46-P-A-MPO.pdf'), 'MPO template PDF'],
  [path.join(resourcesDir, 'bin', `pdf_editor${workerExt}`), 'PDF editor worker'],
  [path.join(resourcesDir, 'bin', `pdf_processor${workerExt}`), 'PDF processor worker'],
];

for (const [filePath, description] of requiredFiles) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    requireDir(filePath, description);
  } else {
    requireFile(filePath, description);
  }
}

const staleTsConfig = path.join(appDir, 'next.config.ts');
if (fs.existsSync(staleTsConfig)) {
  fail(`Packaged app still contains next.config.ts, which can trigger runtime npm lookup: ${staleTsConfig}`);
}

const forbiddenPaths = [
  [path.join(nextBuildDir, 'cache'), 'Next.js build cache'],
  [path.join(nextBuildDir, 'diagnostics'), 'Next.js diagnostics output'],
  [path.join(nextBuildDir, 'types'), 'Next.js type output'],
  [path.join(appDir, 'public', 'test_lc_fixed.pdf'), 'debug public PDF'],
  [path.join(appDir, 'assets', 'test_lc_final.pdf'), 'debug LC PDF'],
  [path.join(appDir, 'assets', 'FRWE366-N101_MPO.pdf'), 'generated MPO PDF'],
  [path.join(appDir, 'node_modules', 'electron'), 'Electron npm package'],
  [path.join(appDir, 'node_modules', 'electron-builder'), 'Electron Builder package'],
  [path.join(appDir, 'node_modules', 'app-builder-bin'), 'Electron Builder binary package'],
];

for (const [filePath, description] of forbiddenPaths) {
  if (fs.existsSync(filePath)) {
    fail(`Packaged app contains unused ${description}: ${filePath}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`[verify-desktop-package] ${platform} package structure looks good.`);
