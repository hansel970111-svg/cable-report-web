import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();
const platform = process.argv[2] || (process.platform === 'win32' ? 'win' : 'mac');
const productName = 'Cable Report Generator';

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

function requireAnyFile(filePaths, description) {
  if (filePaths.some(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile())) {
    return true;
  }

  fail(`Missing ${description}. Checked: ${filePaths.join(', ')}`);
  return false;
}

function firstExistingDir(paths) {
  return paths.find(dirPath => fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) || paths[0];
}

function findMacAppDir(unpackedDir) {
  const preferred = path.join(unpackedDir, `${productName}.app`);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) return preferred;

  if (!fs.existsSync(unpackedDir)) return preferred;
  const appName = fs.readdirSync(unpackedDir).find(name => name.endsWith('.app'));
  return appName ? path.join(unpackedDir, appName) : preferred;
}

const unpackedDir = platform === 'win'
  ? path.join(workspace, 'release', 'win-unpacked')
  : firstExistingDir([
      path.join(workspace, 'release', 'mac'),
      path.join(workspace, 'release', 'mac-arm64'),
      path.join(workspace, 'release', 'mac-x64'),
      path.join(workspace, 'release', 'mac-universal'),
    ]);

const macAppDir = platform === 'win' ? null : findMacAppDir(unpackedDir);
const resourcesDir = platform === 'win'
  ? path.join(unpackedDir, 'resources')
  : path.join(macAppDir, 'Contents', 'Resources');
const appDir = path.join(resourcesDir, 'app');
function packagedAppPath(...segments) {
  return path.join(appDir, ...segments);
}

const nextBuildDir = path.join(appDir, 'next-build');
const standaloneDir = path.join(nextBuildDir, 'standalone');
const standaloneNextBuildDir = path.join(standaloneDir, 'next-build');
const appWorkerDir = path.join(appDir, 'worker-bin');
const legacyAppWorkerDir = path.join(appDir, 'resources', 'bin');
const externalWorkerDir = path.join(resourcesDir, 'bin');
const workerExt = platform === 'win' ? '.exe' : '';

requireDir(unpackedDir, 'unpacked desktop app directory');
requireDir(resourcesDir, 'desktop resources directory');
requireDir(appDir, 'packaged app directory');
requireDir(nextBuildDir, 'Next.js production build directory');

const hasStandaloneRuntime = fs.existsSync(path.join(standaloneDir, 'server.js'));
const requiredFiles = hasStandaloneRuntime
  ? [
      [path.join(appDir, 'package.json'), 'packaged package.json'],
      [path.join(appDir, 'next.config.mjs'), 'Next config'],
      [path.join(appDir, 'electron', 'main.cjs'), 'Electron main process'],
      [path.join(standaloneDir, 'server.js'), 'Next standalone server'],
      [path.join(standaloneDir, 'package.json'), 'Next standalone package metadata'],
      [path.join(standaloneDir, 'node_modules'), 'Next standalone node modules'],
      [path.join(standaloneNextBuildDir, 'BUILD_ID'), 'Next standalone build id'],
      [path.join(standaloneNextBuildDir, 'routes-manifest.json'), 'Next standalone routes manifest'],
      [path.join(standaloneNextBuildDir, 'server'), 'Next standalone server output'],
      [path.join(standaloneNextBuildDir, 'static'), 'Next standalone static output'],
    ]
  : [
      [path.join(appDir, 'package.json'), 'packaged package.json'],
      [path.join(appDir, 'next.config.mjs'), 'Next config'],
      [path.join(appDir, 'electron', 'main.cjs'), 'Electron main process'],
      [path.join(nextBuildDir, 'BUILD_ID'), 'Next build id'],
      [path.join(nextBuildDir, 'routes-manifest.json'), 'Next routes manifest'],
      [path.join(nextBuildDir, 'server'), 'Next server output'],
      [path.join(nextBuildDir, 'static'), 'Next static output'],
    ];

requiredFiles.push([
  packagedAppPath('scripts', 'versioning.mjs'),
  'CalVer runtime module',
]);

for (const [filePath, description] of requiredFiles) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    requireDir(filePath, description);
  } else {
    requireFile(filePath, description);
  }
}

const sharedWorkerFiles = [
  path.join(appWorkerDir, `pdf_worker${workerExt}`),
  path.join(legacyAppWorkerDir, `pdf_worker${workerExt}`),
  path.join(externalWorkerDir, `pdf_worker${workerExt}`),
];

requireAnyFile(sharedWorkerFiles, 'shared PDF worker');

const templateFiles = [
  ['assets/M138-DE46-OOB-Cat5e.pdf', 'Cat 5e template PDF'],
  ['assets/M138-DE46-D-P-cross-LC.pdf', 'LC template PDF'],
  ['assets/M138-DE46-P-A-MPO.pdf', 'MPO template PDF'],
];

for (const [relativePath, description] of templateFiles) {
  requireAnyFile([
    path.join(appDir, relativePath),
    path.join(resourcesDir, relativePath),
  ], description);
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
  [path.join(resourcesDir, 'assets', 'test_lc_final.pdf'), 'debug LC PDF'],
  [path.join(resourcesDir, 'assets', 'FRWE366-N101_MPO.pdf'), 'generated MPO PDF'],
  [path.join(appDir, 'node_modules'), 'full root node_modules tree'],
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
