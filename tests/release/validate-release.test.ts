import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const validatorScript = resolve('scripts/validate-release-version.mjs');

function git(cwd: string, args: string[], env?: Record<string, string | undefined>) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function writePackage(work: string, version: string) {
  await writeFile(
    join(work, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version, private: true }, null, 2)}\n`,
  );
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'calver-validate-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, ['init', '--bare', '--initial-branch=main', origin]);
  git(root, ['clone', origin, work]);
  git(work, ['config', 'user.name', 'Release Test']);
  git(work, ['config', 'user.email', 'release@example.test']);
  await writePackage(work, '0.1.1');
  git(work, ['add', 'package.json']);
  git(work, ['commit', '-m', 'initial']);
  git(work, ['tag', '-a', 'v0.1.1', '-m', 'historical']);
  git(work, ['push', '-u', 'origin', 'main', 'v0.1.1']);
  return { root, origin, work };
}

async function commitVersion(work: string, version: string) {
  await writePackage(work, version);
  git(work, ['add', 'package.json']);
  git(work, ['commit', '-m', `version ${version}`]);
}

function annotatedTag(work: string, version: string, date = '2026-07-10T12:00:00+02:00') {
  git(work, ['tag', '-a', `v${version}`, '-m', `Release v${version}`], {
    GIT_COMMITTER_DATE: date,
  });
}

function artifactEvidence(version: string) {
  let macBundleVersion = version;
  const match = /^(\d{4})\.(\d+?)\.(\d+)$/.exec(version);
  if (match) {
    const monthDay = Number(match[2]);
    const month = Math.floor(monthDay / 100);
    const day = monthDay % 100;
    macBundleVersion = `${(Number(match[1]) % 100) * 100 + month}.${day}.${match[3]}`;
  }
  return {
    uiVersion: version,
    electronVersion: version,
    macShortVersion: version,
    macBundleVersion,
    windowsVersion: version,
    artifactNames: [`Cable-Report-${version}.dmg`, `Cable-Report-${version}.exe`],
  };
}

async function validate(work: string, options: Record<string, unknown> = {}) {
  const { validateReleaseVersion } = await import('../../scripts/validate-release-version.mjs');
  return validateReleaseVersion({ cwd: work, ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('validate-release command with real Git tags', () => {
  it('exports a programmatic entry point', async () => {
    const command = await import('../../scripts/validate-release-version.mjs');
    expect(command.validateReleaseVersion).toBeTypeOf('function');
  });

  it('accepts a prepared CalVer higher than every published version with no same-name tag', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1');
    await commitVersion(work, '2026.710.2');

    await expect(validate(work, { prepared: true }))
      .resolves.toMatchObject({
        mode: 'prepared',
        version: '2026.710.2',
        artifactsValidated: false,
      });

    const stdout = execFileSync(process.execPath, [validatorScript, '--prepared'], {
      cwd: work,
      encoding: 'utf8',
    });
    expect(stdout).toContain('Validated prepared version prerequisites 2026.710.2; consumer validation pending.');
  });

  it('rejects invalid prepared candidates, non-increasing candidates, and collisions', async () => {
    const invalid = await fixture();
    await commitVersion(invalid.work, 'banana');
    await expect(validate(invalid.work, { prepared: true }))
      .rejects.toMatchObject({ code: 'INVALID_CURRENT_VERSION' });

    const lower = await fixture();
    await commitVersion(lower.work, '2026.710.2');
    annotatedTag(lower.work, '2026.710.2');
    await commitVersion(lower.work, '2026.710.1');
    await expect(validate(lower.work, { prepared: true }))
      .rejects.toMatchObject({ code: 'CURRENT_VERSION_NOT_LATEST' });

    const collision = await fixture();
    await commitVersion(collision.work, '2026.710.1');
    annotatedTag(collision.work, '2026.710.1');
    await expect(validate(collision.work, { prepared: true }))
      .rejects.toMatchObject({ code: 'VERSION_COLLISION' });
  });

  it('accepts an exact annotated HEAD tag whose tagger Berlin date matches', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1', '2026-07-10T23:30:00+02:00');

    await expect(validate(work, { artifacts: artifactEvidence('2026.710.1') })).resolves.toMatchObject({
      mode: 'tag',
      tag: 'v2026.710.1',
      version: '2026.710.1',
      artifactsValidated: true,
    });
  });

  it('rejects a lightweight tag and a mismatched HEAD tag', async () => {
    const lightweight = await fixture();
    await commitVersion(lightweight.work, '2026.710.1');
    git(lightweight.work, ['tag', 'v2026.710.1']);
    await expect(validate(lightweight.work)).rejects.toMatchObject({ code: 'TAG_VERSION_MISMATCH' });

    const mismatch = await fixture();
    await commitVersion(mismatch.work, '2026.710.2');
    annotatedTag(mismatch.work, '2026.710.1');
    await expect(validate(mismatch.work)).rejects.toMatchObject({ code: 'TAG_VERSION_MISMATCH' });
  });

  it('rejects a tagger instant whose Berlin date differs from the CalVer date', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1', '2026-07-09T23:30:00+02:00');

    await expect(validate(work)).rejects.toMatchObject({ code: 'TAG_DATE_MISMATCH' });
  });

  it('requires the exact tag to be the highest published version', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1');
    annotatedTag(work, '2026.710.2');

    await expect(validate(work)).rejects.toMatchObject({ code: 'CURRENT_VERSION_NOT_LATEST' });
  });

  it('rejects malformed release tags and artifact version drift', async () => {
    const malformed = await fixture();
    await commitVersion(malformed.work, '2026.710.1');
    annotatedTag(malformed.work, '2026.710.1');
    git(malformed.work, ['tag', 'vbad']);
    await expect(validate(malformed.work)).rejects.toMatchObject({ code: 'INVALID_RELEASE_TAG' });

    const drift = await fixture();
    await commitVersion(drift.work, '2026.710.1');
    annotatedTag(drift.work, '2026.710.1');
    await expect(validate(drift.work, {
      artifacts: { uiVersion: '2026.710.2' },
    })).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });

  it('fails closed when formal tag validation lacks complete non-empty artifact evidence', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1');

    await expect(validate(work)).rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
    await expect(validate(work, { artifacts: {} }))
      .rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
    await expect(validate(work, { artifacts: { uiVersion: '2026.710.1' } }))
      .rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
  });

  it('accepts strict artifact JSON through the real formal-tag CLI and rejects unusable evidence', async () => {
    const { work } = await fixture();
    const version = '2026.710.1';
    await commitVersion(work, version);
    annotatedTag(work, version);

    const validPath = join(work, 'valid-artifacts.json');
    const malformedPath = join(work, 'malformed-artifacts.json');
    const incompletePath = join(work, 'incomplete-artifacts.json');
    const driftingPath = join(work, 'drifting-artifacts.json');
    await writeFile(validPath, `${JSON.stringify(artifactEvidence(version), null, 2)}\n`);
    await writeFile(malformedPath, '{not json}\n');
    await writeFile(incompletePath, `${JSON.stringify({ uiVersion: version })}\n`);
    await writeFile(driftingPath, `${JSON.stringify({
      ...artifactEvidence(version),
      electronVersion: '2026.710.2',
    })}\n`);

    const runCli = (args: string[]) => spawnSync(process.execPath, [validatorScript, ...args], {
      cwd: work,
      encoding: 'utf8',
    });
    const valid = runCli(['--artifacts', validPath]);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain(`Validated tag release version ${version}.`);

    for (const args of [
      [],
      ['--artifacts', malformedPath],
      ['--artifacts', incompletePath],
      ['--artifacts', driftingPath],
    ]) {
      const result = runCli(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[VERSION_NOT_IN_ARTIFACT]');
    }
  });

  it('rejects artifact filename substring collisions but accepts complete exact evidence', async () => {
    const { work } = await fixture();
    await commitVersion(work, '2026.710.1');
    annotatedTag(work, '2026.710.1');
    const collision = {
      ...artifactEvidence('2026.710.1'),
      artifactNames: ['Cable-Report-2026.710.10.dmg'],
    };

    await expect(validate(work, { artifacts: collision }))
      .rejects.toMatchObject({ code: 'VERSION_NOT_IN_ARTIFACT' });
    await expect(validate(work, { artifacts: artifactEvidence('2026.710.1') }))
      .resolves.toMatchObject({ artifactsValidated: true });
  });

  it('keeps historical 0.1.1 valid only as a tagged migration baseline', async () => {
    const { work } = await fixture();
    await expect(validate(work, { artifacts: artifactEvidence('0.1.1') }))
      .resolves.toMatchObject({ version: '0.1.1', tag: 'v0.1.1', artifactsValidated: true });
    await expect(validate(work, { prepared: true }))
      .rejects.toMatchObject({ code: 'INVALID_CURRENT_VERSION' });
  });
});
