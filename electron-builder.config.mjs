import { readFileSync } from 'node:fs';

import {
  parseCalVer,
  toMacBundleVersion,
  toWindowsProductVersion,
} from './scripts/versioning.mjs';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

export function createElectronBuilderConfig(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid package version for Electron Builder: ${String(version)}`);
  }

  return {
    productName: 'Cable Report Generator',
    artifactName: 'Cable-Report-Generator-${version}-${os}-${arch}.${ext}',
    beforeBuild: () => false,
    extraMetadata: {
      shortVersion: version,
      shortVersionWindows: toWindowsProductVersion(version),
    },
    mac: {
      bundleShortVersion: version,
      bundleVersion: parseCalVer(version) ? toMacBundleVersion(version) : version,
    },
  };
}

export default createElectronBuilderConfig(packageJson.version);
