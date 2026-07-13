import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/).includes('..');
}

function hashFile(workspace, relativePath) {
  if (!safeRelativePath(relativePath)) {
    throw new Error(`Unsafe acceptance evidence path: ${relativePath}`);
  }
  const absolutePath = path.join(workspace, relativePath);
  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Acceptance evidence is not a regular file: ${relativePath}`);
  }
  return createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function macAsarCandidates(workspace) {
  const release = path.join(workspace, 'release');
  if (!fs.existsSync(release)) return [];
  const candidates = [];
  for (const entry of fs.readdirSync(release, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^mac(?:-|$)/.test(entry.name)) continue;
    const directory = path.join(release, entry.name);
    for (const app of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!app.isDirectory() || !app.name.endsWith('.app')) continue;
      const candidate = path.join(directory, app.name, 'Contents', 'Resources', 'app.asar');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) candidates.push(candidate);
    }
  }
  return candidates.sort();
}

export function packageAsarRelativePath(workspace, platform) {
  if (platform === 'win') {
    const candidate = path.join(workspace, 'release', 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      throw new Error(`Missing packaged Windows ASAR: ${candidate}`);
    }
    return path.relative(workspace, candidate).split(path.sep).join('/');
  }
  const candidates = macAsarCandidates(workspace);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one packaged macOS ASAR; found ${candidates.length}`);
  }
  return path.relative(workspace, candidates[0]).split(path.sep).join('/');
}

export function installerNames(workspace, platform) {
  const release = path.join(workspace, 'release');
  const names = fs.existsSync(release) ? fs.readdirSync(release).sort() : [];
  return platform === 'mac'
    ? names.filter(name => /\.(?:dmg|zip)$/i.test(name))
    : names.filter(name => /\.exe$/i.test(name));
}

export function createAcceptanceManifest({ workspace, platform, head }) {
  if (!['mac', 'win'].includes(platform)) throw new Error('platform must be mac or win');
  if (!/^[0-9a-f]{40}$/i.test(head)) throw new Error('head must be a full Git commit SHA');
  const reports = [
    'artifacts/acceptance/unit.json',
    'artifacts/acceptance/python.xml',
    'artifacts/acceptance/browser.json',
    `artifacts/acceptance/desktop-${platform}.json`,
    `artifacts/acceptance/audit-${platform}.json`,
  ];
  const gateNames = ['unit', 'python', 'browser', 'audit', 'package', 'desktop'];
  const gateReceipts = gateNames.map(name => `artifacts/acceptance/gate-${name}-${platform}.json`);
  const packageAsar = packageAsarRelativePath(workspace, platform);
  const names = installerNames(workspace, platform);
  const minimumInstallers = platform === 'mac' ? 2 : 1;
  if (names.length < minimumInstallers) {
    throw new Error(`Expected at least ${minimumInstallers} ${platform} installer(s)`);
  }
  const relativePaths = [
    ...reports,
    ...gateReceipts,
    packageAsar,
    ...names.map(name => `release/${name}`),
  ];
  const files = Object.fromEntries(relativePaths.map(relativePath => (
    [relativePath, hashFile(workspace, relativePath)]
  )));
  return {
    schemaVersion: 1,
    head,
    platform,
    packageAsar,
    installerNames: names,
    files,
  };
}

const GATE_COMMAND_PATTERNS = {
  unit: /\bvitest\b.*\brun\b/,
  python: /\bpytest\b/,
  browser: /\bplaywright\b.*\btest\b/,
  audit: /\bpnpm\b.*\baudit\b/,
  package: /\bdesktop:dist:(?:mac|win)\b/,
  desktop: /\btest:e2e:(?:mac|win)\b/,
};

function verifyGateReceipts(workspace, manifest, platform, head) {
  for (const [name, commandPattern] of Object.entries(GATE_COMMAND_PATTERNS)) {
    const relativePath = `artifacts/acceptance/gate-${name}-${platform}.json`;
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(path.join(workspace, relativePath), 'utf8'));
    } catch (error) {
      throw new Error(`Missing or invalid ${name} gate receipt: ${error.message}`);
    }
    if (receipt?.schemaVersion !== 1 || receipt.name !== name || receipt.platform !== platform) {
      throw new Error(`${name} gate receipt identity does not match`);
    }
    if (receipt.head !== head || receipt.exitCode !== 0) {
      throw new Error(`${name} gate receipt does not match successful current HEAD`);
    }
    const command = Array.isArray(receipt.command) ? receipt.command.join(' ') : '';
    if (!commandPattern.test(command)) throw new Error(`${name} gate receipt command is not trusted`);
    const expectedArtifact = name === 'unit'
      ? 'artifacts/acceptance/unit.json'
      : name === 'python'
        ? 'artifacts/acceptance/python.xml'
        : name === 'browser'
          ? 'artifacts/acceptance/browser.json'
          : name === 'audit'
            ? `artifacts/acceptance/audit-${platform}.json`
            : name === 'desktop'
              ? `artifacts/acceptance/desktop-${platform}.json`
              : undefined;
    if (expectedArtifact) {
      if (receipt.artifact !== expectedArtifact) {
        throw new Error(`${name} gate receipt artifact path does not match`);
      }
      if (receipt.artifactSha256 !== manifest.files[expectedArtifact]) {
        throw new Error(`${name} gate receipt artifact digest does not match`);
      }
    } else if ('artifact' in receipt || 'artifactSha256' in receipt) {
      throw new Error(`${name} gate receipt must not claim an artifact`);
    }
  }
}

export function verifyAcceptanceManifest({ workspace, manifest, platform, head }) {
  if (manifest?.schemaVersion !== 1) throw new Error('acceptance manifest schemaVersion must be 1');
  if (manifest.head !== head) throw new Error('acceptance manifest does not match current HEAD');
  if (manifest.platform !== platform) throw new Error(`acceptance manifest platform must be ${platform}`);
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('acceptance manifest files must be an object');
  }
  const expected = createAcceptanceManifest({ workspace, platform, head });
  if (manifest.packageAsar !== expected.packageAsar) {
    throw new Error('acceptance manifest package ASAR path does not match');
  }
  if (JSON.stringify(manifest.installerNames) !== JSON.stringify(expected.installerNames)) {
    throw new Error('acceptance manifest installer inventory does not match');
  }
  const actualPaths = Object.keys(manifest.files).sort();
  const expectedPaths = Object.keys(expected.files).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('acceptance manifest file inventory does not match');
  }
  for (const relativePath of expectedPaths) {
    if (!/^[0-9a-f]{64}$/i.test(manifest.files[relativePath] || '')) {
      throw new Error(`acceptance manifest has an invalid digest for ${relativePath}`);
    }
    if (manifest.files[relativePath] !== expected.files[relativePath]) {
      throw new Error(`acceptance manifest digest mismatch for ${relativePath}`);
    }
  }
  verifyGateReceipts(workspace, manifest, platform, head);
  return expected;
}
