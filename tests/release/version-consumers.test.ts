// @vitest-environment node

import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import { toMacBundleVersion } from '../../scripts/versioning.mjs';

type BuilderConfiguration = {
  artifactName?: string;
  asar?: boolean;
  beforeBuild?: () => boolean | Promise<boolean>;
  buildVersion?: string;
  dmg?: { sign?: boolean };
  forceCodeSigning?: boolean;
  extraMetadata?: {
    shortVersion?: string;
    shortVersionWindows?: string;
  };
  extraResources?: unknown[];
  files?: unknown[];
  mac?: {
    bundleShortVersion?: string;
    bundleVersion?: string;
    hardenedRuntime?: boolean;
    identity?: string;
    notarize?: boolean;
  };
  productName?: string;
};

type AppInfoInstance = {
  buildVersion: string;
  getVersionInWeirdWindowsForm(): string;
  shortVersion?: string;
  shortVersionWindows?: string;
  version: string;
};

const projectRoot = resolve('.');
const packageJsonPath = join(projectRoot, 'package.json');
const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { getConfig: loadBuilderConfig } = builderRequire(
  'app-builder-lib/out/util/config/config.js',
) as {
  getConfig(
    projectDir: string,
    configPath: string | null,
    configFromOptions: BuilderConfiguration | null,
  ): Promise<BuilderConfiguration>;
};
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo.js') as {
  AppInfo: new (
    info: {
      config: BuilderConfiguration;
      devMetadata: null;
      framework: { defaultAppIdPrefix: string };
      metadata: Record<string, unknown>;
      repositoryInfo: Promise<null>;
    },
    buildVersion: string | null,
  ) => AppInfoInstance;
};
const { expandMacro } = builderRequire(
  'app-builder-lib/out/util/macroExpander.js',
) as {
  expandMacro(
    pattern: string,
    arch: string,
    appInfo: AppInfoInstance,
    extra: Record<string, string>,
  ): string;
};

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    build: BuilderConfiguration & { extends?: string };
    name: string;
    version: string;
  };
}

async function importFresh(relativePath: string) {
  const url = pathToFileURL(join(projectRoot, relativePath));
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  return import(url.href) as Promise<Record<string, unknown>>;
}

function builderAppInfo(
  packageJson: Awaited<ReturnType<typeof readPackageJson>>,
  config: BuilderConfiguration,
) {
  return new AppInfo({
    config,
    devMetadata: null,
    framework: { defaultAppIdPrefix: 'com.electron.' },
    metadata: {
      ...packageJson,
      ...config.extraMetadata,
    },
    repositoryInfo: Promise.resolve(null),
  }, null);
}

async function writeConsumerFixture(version = '2026.713.2') {
  const root = await mkdtemp(join(tmpdir(), 'calver-consumers-'));
  temporaryRoots.push(root);
  const packageJson = await readPackageJson();
  packageJson.version = version;

  const copiedFiles = [
    'electron-builder.config.mjs',
    'electron/main.cjs',
    'next.config.mjs',
    'scripts/versioning.mjs',
    'src/features/app-update/update-dialog.tsx',
    'src/features/report-editor/report-editor.tsx',
    'src/lib/app-version.ts',
  ];
  await Promise.all(copiedFiles.map(async relativePath => {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const source = await readFile(join(projectRoot, relativePath), 'utf8').catch(() => '');
    await writeFile(destination, source);
  }));
  await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

function releaseGitRunner(version: string, publishedTags = `v${version}`) {
  return (_command: string, args: string[]) => {
    let stdout = '';
    if (args[0] === 'tag' && args[1] === '--list') stdout = publishedTags;
    if (args[0] === 'tag' && args[1] === '--points-at') stdout = `v${version}`;
    if (args[0] === 'cat-file') stdout = 'tag';
    if (args[0] === 'for-each-ref') stdout = '2026-07-13T12:00:00+02:00';
    return { signal: null, status: 0, stderr: '', stdout };
  };
}

function artifactEvidence(version: string) {
  return {
    uiVersion: version,
    electronVersion: version,
    macShortVersion: version,
    macBundleVersion: '2607.13.2',
    windowsVersion: version,
    artifactNames: [
      `Cable-Report-Generator-${version}-mac-x64.dmg`,
      `Cable-Report-Generator-${version}-win-x64.exe`,
    ],
  };
}

async function mutateSource(root: string, relativePath: string, mutate: (source: string) => string) {
  const path = join(root, relativePath);
  await writeFile(path, mutate(await readFile(path, 'utf8')));
}

async function overridePackageBuild(root: string, override: Record<string, unknown>) {
  const path = join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(path, 'utf8')) as {
    build: Record<string, unknown>;
  };
  packageJson.build = { ...packageJson.build, ...override };
  await writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map(root => (
    rm(root, { force: true, recursive: true })
  )));
});

describe('single-source application version consumers', () => {
  it('injects the package version at Next build time and renders it only in the update dialog', async () => {
    const packageJson = await readPackageJson();
    const nextConfig = (await importFresh('next.config.mjs')).default as {
      env?: Record<string, string>;
    };
    const appVersionSource = await readFile(join(projectRoot, 'src/lib/app-version.ts'), 'utf8')
      .catch(() => '');
    const editorSource = await readFile(
      join(projectRoot, 'src/features/report-editor/report-editor.tsx'),
      'utf8',
    );
    const updateDialogSource = await readFile(
      join(projectRoot, 'src/features/app-update/update-dialog.tsx'),
      'utf8',
    );

    expect(nextConfig.env?.CABLE_REPORT_APP_VERSION).toBe(packageJson.version);
    expect(appVersionSource).toMatch(
      /export const APP_VERSION[^=]*=\s*process\.env\.CABLE_REPORT_APP_VERSION/u,
    );
    expect(appVersionSource).not.toMatch(/export\s+let|function\s+setAppVersion/u);
    expect(editorSource).toMatch(/import\s*\{\s*APP_VERSION\s*\}.*@\/lib\/app-version/u);
    expect(editorSource).toMatch(/<UpdateDialog\s+currentVersion=\{APP_VERSION\}\s*\/>/u);
    expect(editorSource).not.toMatch(/<footer[^>]*>[\s\S]*<UpdateDialog/u);
    expect(updateDialogSource).toMatch(/\{state\.currentVersion\}/u);
    expect(editorSource).not.toMatch(/fetch\([^)]*version|ipc[^\n]*version/u);
  });

  it('configures the native About panel exclusively from Electron package metadata', async () => {
    const mainSource = await readFile(join(projectRoot, 'electron/main.cjs'), 'utf8');

    expect(mainSource).toMatch(/app\.setAboutPanelOptions\(\{[\s\S]*applicationName:\s*app\.getName\(\)[\s\S]*applicationVersion:\s*app\.getVersion\(\)[\s\S]*version:\s*app\.getVersion\(\)[\s\S]*\}\)/u);
    expect(mainSource).not.toMatch(/(?:applicationVersion|version):\s*['"]\d+\.\d+\.\d+['"]/u);
  });

  it('loads the builder config through package.json extends and keeps public platform versions', async () => {
    const packageJson = await readPackageJson();
    const config = await loadBuilderConfig(projectRoot, null, null);
    const appInfo = builderAppInfo(packageJson, config);

    expect(packageJson.build.extends).toBe('./electron-builder.config.mjs');
    expect(config.productName).toBe('Cable Report Generator');
    expect(config.artifactName).toBe(
      'Cable-Report-Generator-${version}-${os}-${arch}.${ext}',
    );
    expect(config.mac).toMatchObject({
      bundleShortVersion: packageJson.version,
      bundleVersion: toMacBundleVersion(packageJson.version),
    });
    expect(config).not.toHaveProperty('buildVersion');
    expect(config.extraMetadata?.shortVersion).toBe(packageJson.version);
    expect(config.extraMetadata?.shortVersionWindows).toBe(`${packageJson.version}.0`);
    expect(config.beforeBuild).toBeTypeOf('function');
    expect(await config.beforeBuild!()).toBe(false);

    const fileVersion = appInfo.shortVersion ?? appInfo.buildVersion;
    const productVersion = appInfo.shortVersionWindows
      ?? appInfo.getVersionInWeirdWindowsForm();
    expect(appInfo.version).toBe(packageJson.version);
    expect(fileVersion).toBe(packageJson.version);
    expect(productVersion).toBe(`${packageJson.version}.0`);

    vi.stubEnv('BUILD_NUMBER', '99');
    const ciAppInfo = builderAppInfo(packageJson, config);
    expect(ciAppInfo.shortVersion ?? ciAppInfo.buildVersion).toBe(packageJson.version);
    expect(expandMacro(config.artifactName!, 'x64', appInfo, {
      ext: 'dmg',
      os: 'mac',
    })).toBe(`Cable-Report-Generator-${packageJson.version}-mac-x64.dmg`);
    expect(expandMacro(config.artifactName!, 'x64', appInfo, {
      ext: 'exe',
      os: 'win',
    })).toBe(`Cable-Report-Generator-${packageJson.version}-win-x64.exe`);

    expect(packageJson.build.asar).toBe(true);
    expect(packageJson.build.files).toBeInstanceOf(Array);
    expect(packageJson.build.extraResources).toBeInstanceOf(Array);
  });

  it('maps native bundle versions while every public consumer stays unchanged', async () => {
    const builderConfigModule = await importFresh('electron-builder.config.mjs');
    const createElectronBuilderConfig = builderConfigModule.createElectronBuilderConfig as
      | ((version: string) => BuilderConfiguration)
      | undefined;

    expect(createElectronBuilderConfig).toBeTypeOf('function');
    const config = createElectronBuilderConfig!('2026.713.2');
    expect(config.mac).toMatchObject({
      bundleShortVersion: '2026.713.2',
      bundleVersion: '2607.13.2',
    });
    expect(config.extraMetadata?.shortVersion).toBe('2026.713.2');
    expect(config.extraMetadata?.shortVersionWindows).toBe('2026.713.2.0');
    expect(config).not.toHaveProperty('buildVersion');
  });

  it('uses explicit macOS signing modes and fails closed for an unknown mode', async () => {
    const builderConfigModule = await importFresh('electron-builder.config.mjs');
    const createElectronBuilderConfig = builderConfigModule.createElectronBuilderConfig as
      | ((version: string, environment?: Record<string, string | undefined>) => BuilderConfiguration)
      | undefined;

    expect(createElectronBuilderConfig).toBeTypeOf('function');

    const adhoc = createElectronBuilderConfig!('2026.713.2', {
      CABLE_MAC_SIGNING_MODE: 'adhoc',
    });
    expect(adhoc.forceCodeSigning).toBe(false);
    expect(adhoc.dmg).toEqual({ sign: false });
    expect(adhoc.mac).toMatchObject({
      hardenedRuntime: false,
      identity: '-',
      notarize: false,
    });

    expect(() => createElectronBuilderConfig!('2026.713.2', {
      CABLE_MAC_SIGNING_MODE: 'unexpected',
    })).toThrow(/Unsupported macOS signing mode/u);
  });

  it('contains no second hard-coded version literal in renderer, About, or builder consumers', async () => {
    const consumerFiles = [
      'electron-builder.config.mjs',
      'electron/main.cjs',
      'next.config.mjs',
      'src/features/app-update/update-dialog.tsx',
      'src/features/report-editor/report-editor.tsx',
      'src/lib/app-version.ts',
    ];
    const consumers = await Promise.all(consumerFiles.map(async relativePath => {
      const source = await readFile(join(projectRoot, relativePath), 'utf8').catch(() => '');
      return {
        relativePath,
        source,
        values: source.match(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/gu) ?? [],
      };
    }));
    const literals = consumers
      .filter(result => result.values.length > 0)
      .map(({ relativePath, values }) => ({ relativePath, values }));

    expect(consumers.filter(result => result.source === '')).toEqual([]);
    expect(literals).toEqual([]);
  });

  it('automatically validates real consumer configuration and fails closed on drift', async () => {
    const version = '2026.713.2';
    const fixtureRoot = await writeConsumerFixture(version);
    const { validateReleaseVersion } = await import(
      '../../scripts/validate-release-version.mjs'
    );

    await expect(validateReleaseVersion({
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).resolves.toMatchObject({
      artifactsValidated: false,
      consumerConfigurationsValidated: true,
      mode: 'tag',
      version,
    });
    await expect(validateReleaseVersion({
      cwd: fixtureRoot,
      prepared: true,
      runner: releaseGitRunner(version, 'v0.1.1'),
    })).resolves.toMatchObject({
      artifactsValidated: false,
      consumerConfigurationsValidated: true,
      mode: 'prepared',
      version,
    });

    const nextConfigPath = join(fixtureRoot, 'next.config.mjs');
    const nextConfig = await readFile(nextConfigPath, 'utf8');
    await writeFile(
      nextConfigPath,
      nextConfig.replace('CABLE_REPORT_APP_VERSION', 'CABLE_REPORT_DRIFT_VERSION'),
    );

    await expect(validateReleaseVersion({
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });

  it('validates configured consumers and supplied artifacts cumulatively in both modes', async () => {
    const version = '2026.713.2';
    const fixtureRoot = await writeConsumerFixture(version);
    const { validateReleaseVersion } = await import(
      '../../scripts/validate-release-version.mjs'
    );
    const artifacts = artifactEvidence(version);

    await expect(validateReleaseVersion({
      artifacts,
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).resolves.toMatchObject({
      artifactValidationPending: false,
      artifactsValidated: true,
      consumerConfigurationsValidated: true,
      mode: 'tag',
    });
    await expect(validateReleaseVersion({
      artifacts,
      cwd: fixtureRoot,
      prepared: true,
      runner: releaseGitRunner(version, 'v0.1.1'),
    })).resolves.toMatchObject({
      artifactValidationPending: false,
      artifactsValidated: true,
      consumerConfigurationsValidated: true,
      mode: 'prepared',
    });
  });

  it.each([
    ['Next', async (root: string) => mutateSource(
      root,
      'next.config.mjs',
      source => source.replace('CABLE_REPORT_APP_VERSION', 'CABLE_REPORT_DRIFT_VERSION'),
    )],
    ['About', async (root: string) => mutateSource(
      root,
      'electron/main.cjs',
      source => source.replace(
        'applicationVersion: app.getVersion()',
        "applicationVersion: 'drifted'",
      ),
    )],
    ['Builder', async (root: string) => mutateSource(
      root,
      'electron-builder.config.mjs',
      source => source.replace(
        'Cable-Report-Generator-${version}-${os}-${arch}.${ext}',
        'Drifted-${version}-${os}-${arch}.${ext}',
      ),
    )],
  ])('rejects valid-looking artifacts when %s configuration drifts', async (_consumer, drift) => {
    const version = '2026.713.2';
    const fixtureRoot = await writeConsumerFixture(version);
    await drift(fixtureRoot);
    const { validateReleaseVersion } = await import(
      '../../scripts/validate-release-version.mjs'
    );

    await expect(validateReleaseVersion({
      artifacts: artifactEvidence(version),
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });

  it.each([
    ['artifactName', { artifactName: 'Override-${version}.${ext}' }],
    ['mac bundleVersion', { mac: { bundleVersion: '9999.1.1' } }],
  ])('rejects an effective package-level %s override', async (_field, override) => {
    const version = '2026.713.2';
    const fixtureRoot = await writeConsumerFixture(version);
    await overridePackageBuild(fixtureRoot, override);
    const { validateReleaseVersion } = await import(
      '../../scripts/validate-release-version.mjs'
    );

    await expect(validateReleaseVersion({
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });

  it('rejects a hidden hard-coded version in the Electron Builder config source', async () => {
    const version = '2026.713.2';
    const fixtureRoot = await writeConsumerFixture(version);
    await mutateSource(
      fixtureRoot,
      'electron-builder.config.mjs',
      source => `${source}\nconst staleVersionMarker = '2026.713.2';\n`,
    );
    const { validateReleaseVersion } = await import(
      '../../scripts/validate-release-version.mjs'
    );

    await expect(validateReleaseVersion({
      cwd: fixtureRoot,
      runner: releaseGitRunner(version),
    })).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });
});
