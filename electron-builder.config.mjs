import { readFileSync } from 'node:fs';

import {
  parseCalVer,
  toMacBundleVersion,
  toWindowsProductVersion,
} from './scripts/versioning.mjs';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

const MAC_SIGNING_MODES = new Set(['auto', 'adhoc']);

function resolveMacSigningConfiguration(environment) {
  const mode = environment.CABLE_MAC_SIGNING_MODE?.trim() || 'auto';
  if (!MAC_SIGNING_MODES.has(mode)) {
    throw new Error(`Unsupported macOS signing mode: ${mode}`);
  }

  if (mode === 'adhoc') {
    return {
      dmg: { sign: false },
      forceCodeSigning: false,
      mac: {
        hardenedRuntime: false,
        identity: '-',
        notarize: false,
      },
    };
  }

  return {
    forceCodeSigning: false,
    mac: { hardenedRuntime: true },
  };
}

export function createElectronBuilderConfig(version, environment = process.env) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid package version for Electron Builder: ${String(version)}`);
  }

  const signing = resolveMacSigningConfiguration(environment);

  return {
    productName: 'Cable Report Generator',
    artifactName: 'Cable-Report-Generator-${version}-${os}-${arch}.${ext}',
    beforeBuild: () => false,
    ...(signing.dmg ? { dmg: signing.dmg } : {}),
    forceCodeSigning: signing.forceCodeSigning,
    extraMetadata: {
      shortVersion: version,
      shortVersionWindows: toWindowsProductVersion(version),
    },
    mac: {
      bundleShortVersion: version,
      bundleVersion: parseCalVer(version) ? toMacBundleVersion(version) : version,
      ...signing.mac,
    },
  };
}

export default createElectronBuilderConfig(packageJson.version);
