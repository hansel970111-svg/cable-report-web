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
  run(commandName('corepack'), ['pnpm', ...args]);
}

function copyDirIfExists(sourceDir, targetDir, label) {
  if (!fs.existsSync(sourceDir)) return;

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log(`Copied ${label} into standalone runtime.`);
}

function pathEntryExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function collectSymlinks(directory) {
  const links = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const candidate = path.join(directory, name);
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      links.push(candidate);
    } else if (stats.isDirectory()) {
      links.push(...collectSymlinks(candidate));
    }
  }
  return links;
}

function isInsideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function copyMaterializedTarget(source, target, stats) {
  if (stats.isDirectory()) {
    fs.cpSync(source, target, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
    });
    return;
  }
  if (stats.isFile()) {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return;
  }
  throw new Error(`Unsupported standalone dependency symlink target: ${source}`);
}

function logicalPackageName(nodeModulesDir, linkPath) {
  const relativeParts = path.relative(nodeModulesDir, linkPath).split(path.sep);
  const nestedNodeModules = relativeParts.lastIndexOf('node_modules');
  const packageParts = relativeParts.slice(nestedNodeModules + 1);
  if (
    packageParts.length === 1 &&
    packageParts[0] !== '' &&
    packageParts[0] !== '.pnpm'
  ) {
    return packageParts[0];
  }
  if (
    packageParts.length === 2 &&
    packageParts[0].startsWith('@') &&
    packageParts.every(part => part !== '' && part !== '.' && part !== '..')
  ) {
    return packageParts.join('/');
  }
  return null;
}

function readPackageName(packageDir, linkPath) {
  const manifestPath = path.join(packageDir, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(
      `Unsupported standalone dependency symlink without a readable package manifest: ${linkPath}`,
    );
  }
  if (typeof packageJson.name !== 'string' || packageJson.name === '') {
    throw new Error(`Unsupported unnamed standalone dependency package: ${linkPath}`);
  }
  return packageJson.name;
}

function planRootPackages(nodeModulesDir, plans) {
  const packages = new Map();
  for (const plan of plans) {
    const logicalName = logicalPackageName(nodeModulesDir, plan.linkPath);
    if (logicalName === null) continue;
    if (!plan.targetStats.isDirectory()) {
      throw new Error(`Unsupported standalone package file symlink: ${plan.linkPath}`);
    }
    const declaredName = readPackageName(plan.targetPath, plan.linkPath);
    if (declaredName !== logicalName) {
      throw new Error(
        `Unsupported standalone dependency alias: ${logicalName} -> ${declaredName} at ${plan.linkPath}`,
      );
    }
    const previousTarget = packages.get(logicalName);
    if (previousTarget && previousTarget !== plan.targetPath) {
      throw new Error(
        `Conflicting standalone dependency targets for ${logicalName}: ` +
        `${previousTarget} and ${plan.targetPath}`,
      );
    }
    packages.set(logicalName, plan.targetPath);
  }

  return [...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([packageName, targetPath]) => ({
      packageName,
      targetPath,
      targetStats: fs.statSync(targetPath),
      destination: path.join(nodeModulesDir, ...packageName.split('/')),
    }));
}

function materializeRootPackages(nodeModulesDir, packages) {
  for (const rootPackage of packages) {
    if (pathEntryExists(rootPackage.destination)) continue;

    fs.mkdirSync(path.dirname(rootPackage.destination), { recursive: true });
    const owner = `.codex-materialize-${process.pid}-package-${rootPackage.packageName.replace('/', '-')}`;
    const stagedPath = path.join(path.dirname(rootPackage.destination), `${owner}-new`);
    fs.rmSync(stagedPath, { recursive: true, force: true });
    try {
      copyMaterializedTarget(rootPackage.targetPath, stagedPath, rootPackage.targetStats);
      fs.renameSync(stagedPath, rootPackage.destination);
    } finally {
      fs.rmSync(stagedPath, { recursive: true, force: true });
    }
  }

  for (const rootPackage of packages) {
    const declaredName = readPackageName(rootPackage.destination, rootPackage.destination);
    if (declaredName !== rootPackage.packageName) {
      throw new Error(
        `Materialized standalone dependency has incompatible root package: ` +
        `${rootPackage.destination}`,
      );
    }
  }
}

export function materializeStandaloneSymlinks(standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  let nodeModulesRoot;
  try {
    if (!fs.statSync(nodeModulesDir).isDirectory()) throw new Error('not a directory');
    nodeModulesRoot = fs.realpathSync(nodeModulesDir);
  } catch {
    throw new Error(`Missing standalone dependency directory: ${nodeModulesDir}`);
  }

  const symlinks = collectSymlinks(nodeModulesDir).sort();
  const plans = symlinks.map(linkPath => {
    let targetPath;
    try {
      targetPath = fs.realpathSync(linkPath);
    } catch {
      throw new Error(`Dangling standalone dependency symlink: ${linkPath}`);
    }
    if (!isInsideDirectory(nodeModulesRoot, targetPath)) {
      throw new Error(
        `Out-of-tree standalone dependency symlink: ${linkPath} -> ${targetPath}`,
      );
    }
    return { linkPath, targetPath, targetStats: fs.statSync(targetPath) };
  });
  const rootPackages = planRootPackages(nodeModulesDir, plans);

  for (const rootPackage of rootPackages) {
    if (!pathEntryExists(rootPackage.destination)) continue;
    const existingTarget = fs.realpathSync(rootPackage.destination);
    if (existingTarget !== rootPackage.targetPath) {
      throw new Error(
        `Conflicting standalone root dependency for ${rootPackage.packageName}: ` +
        `${existingTarget} and ${rootPackage.targetPath}`,
      );
    }
  }

  for (const [index, plan] of plans.entries()) {
    const owner = `.codex-materialize-${process.pid}-${index}`;
    const stagedPath = path.join(path.dirname(plan.linkPath), `${owner}-new`);
    const backupPath = path.join(path.dirname(plan.linkPath), `${owner}-backup`);
    fs.rmSync(stagedPath, { recursive: true, force: true });
    fs.rmSync(backupPath, { recursive: true, force: true });

    let backupCreated = false;
    try {
      copyMaterializedTarget(plan.targetPath, stagedPath, plan.targetStats);
      fs.renameSync(plan.linkPath, backupPath);
      backupCreated = true;
      fs.renameSync(stagedPath, plan.linkPath);
      fs.rmSync(backupPath, { recursive: true, force: true });
      backupCreated = false;
    } catch (error) {
      if (backupCreated) {
        if (pathEntryExists(plan.linkPath)) {
          fs.rmSync(plan.linkPath, { recursive: true, force: true });
        }
        fs.renameSync(backupPath, plan.linkPath);
        backupCreated = false;
      }
      throw error;
    } finally {
      fs.rmSync(stagedPath, { recursive: true, force: true });
      if (backupCreated && pathEntryExists(backupPath)) {
        if (!pathEntryExists(plan.linkPath)) fs.renameSync(backupPath, plan.linkPath);
        else fs.rmSync(backupPath, { recursive: true, force: true });
      }
    }
  }

  materializeRootPackages(nodeModulesDir, rootPackages);

  const remaining = collectSymlinks(nodeModulesDir);
  if (remaining.length > 0) {
    throw new Error(
      `Standalone dependency materialization left ${remaining.length} symlink(s): ${remaining[0]}`,
    );
  }
  return plans.length;
}

function prepareStandaloneRuntime() {
  const nextBuildDir = path.join(workspace, 'next-build');
  const standaloneDir = path.join(nextBuildDir, 'standalone');

  if (!fs.existsSync(standaloneDir)) return;

  const materializedCount = materializeStandaloneSymlinks(standaloneDir);
  console.log(`Materialized ${materializedCount} standalone dependency symlinks.`);

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

if (process.argv[2] === '--materialize-standalone-runtime') {
  const standaloneDir = process.argv[3];
  if (!standaloneDir) {
    console.error('Missing standalone directory for dependency materialization.');
    process.exit(1);
  }
  try {
    const count = materializeStandaloneSymlinks(path.resolve(standaloneDir));
    console.log(`Materialized ${count} standalone dependency symlinks.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else {
  console.log('Verifying dependencies against the frozen lock...');
  runPnpm([
    'install',
    '--frozen-lockfile',
    '--prefer-offline',
    '--loglevel',
    'debug',
    '--reporter=append-only',
  ]);

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
    'node24',
    '--outDir',
    'dist',
    '--no-splitting',
    '--no-minify',
  ]);

  console.log('Build completed successfully!');
}
