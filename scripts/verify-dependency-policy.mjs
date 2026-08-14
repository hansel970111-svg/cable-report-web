import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const GHOST_DEPENDENCY_PATTERNS = [
  /^@aws-sdk\//,
  /^@supabase\//,
  /^drizzle-/,
  /^@coze\//,
];

const VENDORED_TARBALL_INTEGRITIES = new Map([
  [
    'xlsx@file:vendor/xlsx-0.20.3.tgz',
    'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==',
  ],
]);

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function parseYamlKey(value) {
  return parseYamlScalar(value.replace(/:\s*$/, ''));
}

export function parsePnpmWorkspacePolicy(workspace) {
  const packages = [];
  const overrides = new Map();
  const seenSections = new Set();
  let section = null;

  for (const [index, line] of workspace.split(/\r?\n/).entries()) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (/^[^\s]/.test(line)) {
      const sectionMatch = line.match(/^(packages|overrides):\s*$/);
      if (!sectionMatch) {
        throw new Error(`pnpm-workspace.yaml line ${index + 1} has an unsupported section`);
      }
      section = sectionMatch[1];
      if (seenSections.has(section)) {
        throw new Error(`pnpm-workspace.yaml repeats the ${section} section`);
      }
      seenSections.add(section);
      continue;
    }

    if (section === 'packages') {
      const packageMatch = line.match(/^  - '((?:[^']|'')+)'\s*$/);
      if (!packageMatch) {
        throw new Error(`pnpm-workspace.yaml line ${index + 1} has an invalid package entry`);
      }
      const packagePattern = packageMatch[1].replaceAll("''", "'");
      if (packages.includes(packagePattern)) {
        throw new Error(`pnpm-workspace.yaml repeats package ${packagePattern}`);
      }
      packages.push(packagePattern);
      continue;
    }

    if (section === 'overrides') {
      const overrideMatch = line.match(
        /^  '((?:[^']|'')+)': '((?:[^']|'')+)'\s*$/,
      );
      if (!overrideMatch) {
        throw new Error(`pnpm-workspace.yaml line ${index + 1} has an invalid override entry`);
      }
      const name = overrideMatch[1].replaceAll("''", "'");
      const version = overrideMatch[2].replaceAll("''", "'");
      if (overrides.has(name)) {
        throw new Error(`pnpm-workspace.yaml repeats override ${name}`);
      }
      overrides.set(name, version);
      continue;
    }

    throw new Error(`pnpm-workspace.yaml line ${index + 1} is outside a supported section`);
  }

  return { packages, overrides };
}

export function parseLockfileOverrides(lockfile) {
  const overrides = new Map();
  let inOverrides = false;
  let sawOverrides = false;

  for (const [index, line] of lockfile.split(/\r?\n/).entries()) {
    if (line === 'overrides:') {
      if (sawOverrides) throw new Error('pnpm-lock.yaml repeats the overrides section');
      sawOverrides = true;
      inOverrides = true;
      continue;
    }
    if (!inOverrides) continue;
    if (/^[^\s]/.test(line)) break;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const overrideMatch = line.match(/^  (.+):\s+(.+)$/);
    if (!overrideMatch) {
      throw new Error(`pnpm-lock.yaml line ${index + 1} has an invalid override entry`);
    }
    const name = parseYamlKey(`${overrideMatch[1]}:`);
    const version = parseYamlScalar(overrideMatch[2]);
    if (overrides.has(name)) throw new Error(`pnpm-lock.yaml repeats override ${name}`);
    overrides.set(name, version);
  }

  return overrides;
}

export function parseRootImporter(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  const root = { dependencies: new Map(), devDependencies: new Map() };
  let inImporters = false;
  let inRoot = false;
  let section = null;
  let dependency = null;

  for (const line of lines) {
    if (line === 'importers:') {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^[^\s]/.test(line)) break;

    if (line === '  .:') {
      inRoot = true;
      continue;
    }
    if (!inRoot) continue;
    if (/^  \S/.test(line)) break;

    const sectionMatch = line.match(/^    (dependencies|devDependencies):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      dependency = null;
      continue;
    }
    if (/^    \S/.test(line)) {
      section = null;
      dependency = null;
      continue;
    }
    if (!section) continue;

    const dependencyMatch = line.match(/^      (.+):\s*$/);
    if (dependencyMatch) {
      dependency = parseYamlKey(`${dependencyMatch[1]}:`);
      root[section].set(dependency, { specifier: undefined, version: undefined });
      continue;
    }
    const specifierMatch = line.match(/^        specifier:\s*(.+)$/);
    if (dependency && specifierMatch) {
      root[section].get(dependency).specifier = parseYamlScalar(specifierMatch[1]);
      continue;
    }
    const versionMatch = line.match(/^        version:\s*(.+)$/);
    if (dependency && versionMatch) {
      root[section].get(dependency).version = parseYamlScalar(versionMatch[1]);
    }
  }

  return root;
}

function parsePackageResolutions(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  const packages = new Map();
  let inPackages = false;
  let packageKey = null;

  for (const line of lines) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^[^\s]/.test(line)) break;

    const packageMatch = line.match(/^  (.+):\s*$/);
    if (packageMatch) {
      packageKey = parseYamlKey(`${packageMatch[1]}:`);
      packages.set(packageKey, { integrity: undefined, tarball: undefined });
      continue;
    }

    const resolutionMatch = line.match(/^    resolution:\s*\{(.+)\}\s*$/);
    if (!packageKey || !resolutionMatch) continue;
    const integrityMatch = resolutionMatch[1].match(/(?:^|,\s*)integrity:\s*([^,}]+)/);
    if (integrityMatch) {
      packages.get(packageKey).integrity = parseYamlScalar(integrityMatch[1]);
    }
    const tarballMatch = resolutionMatch[1].match(/(?:^|,\s*)tarball:\s*([^,}]+)/);
    if (tarballMatch) {
      packages.get(packageKey).tarball = parseYamlScalar(tarballMatch[1]);
    }
  }

  return packages;
}

function isExactRegistryVersion(specifier) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(specifier);
}

function resolvedVersionBase(version) {
  return version?.split('(', 1)[0];
}

function parseAutoInstallPeers(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  let inSettings = false;
  for (const line of lines) {
    if (line === 'settings:') {
      inSettings = true;
      continue;
    }
    if (!inSettings) continue;
    if (/^[^\s]/.test(line)) break;
    const match = line.match(/^  autoInstallPeers:\s*(true|false)\s*$/);
    if (match) return match[1] === 'true';
  }
  return undefined;
}

function compareOverrideMaps(sourceName, expectedSourceName, expected, actual, errors) {
  for (const [name, version] of expected) {
    if (!actual.has(name)) {
      errors.push(`${sourceName} override ${name} is missing`);
      continue;
    }
    if (actual.get(name) !== version) {
      errors.push(
        `${sourceName} override ${name} mismatch: expected=${version}, actual=${actual.get(name)}`,
      );
    }
  }

  for (const name of actual.keys()) {
    if (!expected.has(name)) {
      errors.push(`${sourceName} override ${name} is not declared in ${expectedSourceName}`);
    }
  }
}

export function verifyDependencyPolicy(packageJson, lockfile, workspace) {
  const manifest = JSON.parse(packageJson);
  const root = parseRootImporter(lockfile);
  const packageResolutions = parsePackageResolutions(lockfile);
  const errors = [];

  const manifestOverrides = new Map(Object.entries(manifest.pnpm?.overrides ?? {}));
  const workspacePolicy = parsePnpmWorkspacePolicy(workspace);
  const workspaceOverrides = workspacePolicy.overrides;
  const lockOverrides = parseLockfileOverrides(lockfile);
  if (manifestOverrides.size === 0) {
    errors.push('package.json pnpm.overrides must not be empty');
  }
  if (workspacePolicy.packages.length !== 1 || workspacePolicy.packages[0] !== '.') {
    errors.push(
      `pnpm-workspace.yaml packages must be exactly ["."]; received ${JSON.stringify(workspacePolicy.packages)}`,
    );
  }
  compareOverrideMaps(
    'pnpm-workspace.yaml',
    'package.json',
    manifestOverrides,
    workspaceOverrides,
    errors,
  );
  compareOverrideMaps(
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    workspaceOverrides,
    lockOverrides,
    errors,
  );

  const autoInstallPeers = parseAutoInstallPeers(lockfile);
  if (autoInstallPeers !== false) {
    errors.push(
      `pnpm lock settings.autoInstallPeers must be false; received ${String(autoInstallPeers)}`,
    );
  }

  for (const section of ['dependencies', 'devDependencies']) {
    const expected = manifest[section] ?? {};
    const actual = root[section];

    for (const [name, specifier] of Object.entries(expected)) {
      if (!actual.has(name)) {
        errors.push(`${section}.${name} is missing from the root lock importer`);
        continue;
      }
      const locked = actual.get(name);
      const lockedSpecifier = locked.specifier;
      if (lockedSpecifier !== specifier) {
        errors.push(
          `${section}.${name} specifier mismatch: package.json=${specifier}, lock=${lockedSpecifier}`,
        );
      }

      if (isExactRegistryVersion(specifier)) {
        const resolved = resolvedVersionBase(locked.version);
        if (resolved !== specifier) {
          errors.push(
            `${section}.${name} resolved version mismatch: package.json=${specifier}, lock=${String(locked.version)}`,
          );
        }
      }

      if (specifier.startsWith('file:')) {
        if (locked.version !== specifier) {
          errors.push(
            `${section}.${name} resolved file mismatch: package.json=${specifier}, lock=${String(locked.version)}`,
          );
        }
        const packageKey = `${name}@${specifier}`;
        const resolution = packageResolutions.get(packageKey);
        const tarball = resolution?.tarball;
        if (tarball !== specifier) {
          errors.push(
            `${section}.${name} tarball mismatch: package.json=${specifier}, lock=${String(tarball)}`,
          );
        }
        const expectedIntegrity = VENDORED_TARBALL_INTEGRITIES.get(packageKey);
        if (!expectedIntegrity) {
          errors.push(`${section}.${name} has no approved vendored integrity policy`);
        } else if (resolution?.integrity !== expectedIntegrity) {
          errors.push(
            `${section}.${name} integrity mismatch: expected=${expectedIntegrity}, lock=${String(resolution?.integrity)}`,
          );
        }
      }
    }

    for (const name of actual.keys()) {
      if (GHOST_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(name))) {
        errors.push(`${section}.${name} is a forbidden ghost root dependency`);
      }
      if (!Object.hasOwn(expected, name)) {
        errors.push(`${section}.${name} is not declared in package.json`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Dependency policy verification failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    dependencies: root.dependencies.size,
    devDependencies: root.devDependencies.size,
  };
}

function optionValue(arguments_, name, fallback) {
  const index = arguments_.indexOf(name);
  if (index === -1) return fallback;
  if (!arguments_[index + 1]) throw new Error(`${name} requires a path`);
  return arguments_[index + 1];
}

async function main() {
  const packagePath = optionValue(process.argv.slice(2), '--package-json', 'package.json');
  const lockfilePath = optionValue(process.argv.slice(2), '--lockfile', 'pnpm-lock.yaml');
  const workspacePath = optionValue(
    process.argv.slice(2),
    '--workspace',
    'pnpm-workspace.yaml',
  );
  const [packageJson, lockfile, workspace] = await Promise.all([
    readFile(packagePath, 'utf8'),
    readFile(lockfilePath, 'utf8'),
    readFile(workspacePath, 'utf8'),
  ]);
  const result = verifyDependencyPolicy(packageJson, lockfile, workspace);
  console.log(
    `Dependency policy verified: ${result.dependencies} dependencies, ${result.devDependencies} devDependencies.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
