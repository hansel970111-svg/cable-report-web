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

export function verifyDependencyPolicy(packageJson, lockfile) {
  const manifest = JSON.parse(packageJson);
  const root = parseRootImporter(lockfile);
  const packageResolutions = parsePackageResolutions(lockfile);
  const errors = [];

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
  const [packageJson, lockfile] = await Promise.all([
    readFile(packagePath, 'utf8'),
    readFile(lockfilePath, 'utf8'),
  ]);
  const result = verifyDependencyPolicy(packageJson, lockfile);
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
