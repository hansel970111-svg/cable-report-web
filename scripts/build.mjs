import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspace = process.env.COZE_WORKSPACE_PATH || process.cwd();

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function runRaw(command, args) {
  return spawnSync(command, args, {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: false,
  });
}

function run(command, args) {
  const result = runRaw(command, args);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPnpm(args) {
  const pnpmResult = runRaw(commandName('pnpm'), args);
  if (!pnpmResult.error) {
    if (pnpmResult.status !== 0) process.exit(pnpmResult.status ?? 1);
    return;
  }

  if (pnpmResult.error.code !== 'ENOENT') {
    console.error(pnpmResult.error);
    process.exit(1);
  }

  run(commandName('corepack'), ['pnpm', ...args]);
}

function copyDirIfExists(sourceDir, targetDir, label) {
  if (!fs.existsSync(sourceDir)) return;

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log(`Copied ${label} into standalone runtime.`);
}

function prepareStandaloneRuntime() {
  const nextBuildDir = path.join(workspace, 'next-build');
  const standaloneDir = path.join(nextBuildDir, 'standalone');

  if (!fs.existsSync(standaloneDir)) return;

  for (const relativeDir of ['worker-bin', path.join('resources', 'bin')]) {
    fs.rmSync(path.join(standaloneDir, relativeDir), { recursive: true, force: true });
  }

  copyDirIfExists(
    path.join(nextBuildDir, 'static'),
    path.join(standaloneDir, 'next-build', 'static'),
    'Next.js static files'
  );

  copyDirIfExists(
    path.join(workspace, 'public'),
    path.join(standaloneDir, 'public'),
    'public assets'
  );
}

if (fs.existsSync(path.join(workspace, 'node_modules'))) {
  console.log('Dependencies already installed; skipping install.');
} else {
  console.log('Installing dependencies...');
  runPnpm([
    'install',
    '--prefer-frozen-lockfile',
    '--prefer-offline',
    '--loglevel',
    'debug',
    '--reporter=append-only',
  ]);
}

console.log('Building the Next.js project...');
runPnpm(['next', 'build', '--webpack']);
prepareStandaloneRuntime();

console.log('Bundling server with tsup...');
runPnpm([
  'tsup',
  'src/server.ts',
  '--format',
  'cjs',
  '--platform',
  'node',
  '--target',
  'node20',
  '--outDir',
  'dist',
  '--no-splitting',
  '--no-minify',
]);

console.log('Build completed successfully!');
