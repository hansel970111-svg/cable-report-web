import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdtemp, readFile, readdir, rename, rm, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const NOW = new Date('2026-07-10T10:00:00.000Z');

function git(cwd: string, args: string[], env?: Record<string, string | undefined>) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function packageText(root: string) {
  return readFile(join(root, 'package.json'), 'utf8');
}

async function writePackage(root: string, version: string) {
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version, private: true }, null, 2)}\n`,
  );
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'calver-prepare-'));
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

async function publish(work: string, version: string, date = '2026-07-10T12:00:00+02:00') {
  await writePackage(work, version);
  git(work, ['add', 'package.json']);
  git(work, ['commit', '-m', `release ${version}`]);
  git(work, ['tag', '-a', `v${version}`, '-m', `Release v${version}`], {
    GIT_COMMITTER_DATE: date,
  });
  git(work, ['push', 'origin', 'main', `v${version}`]);
}

async function remoteCommit(origin: string, root: string, name: string) {
  const peer = join(root, name);
  git(root, ['clone', origin, peer]);
  git(peer, ['config', 'user.name', 'Peer']);
  git(peer, ['config', 'user.email', 'peer@example.test']);
  await writeFile(join(peer, `${name}.txt`), name);
  git(peer, ['add', '.']);
  git(peer, ['commit', '-m', name]);
  git(peer, ['push', 'origin', 'main']);
}

async function pendingRemoteRelease(origin: string, root: string, version: string) {
  const peer = join(root, `peer-${version}`);
  git(root, ['clone', origin, peer]);
  git(peer, ['config', 'user.name', 'Racing Publisher']);
  git(peer, ['config', 'user.email', 'race@example.test']);
  await writePackage(peer, version);
  git(peer, ['add', 'package.json']);
  git(peer, ['commit', '-m', `race release ${version}`]);
  git(peer, ['tag', '-a', `v${version}`, '-m', `Release v${version}`], {
    GIT_COMMITTER_DATE: '2026-07-10T12:00:00+02:00',
  });
  return {
    publish: () => git(peer, ['push', 'origin', 'main', `v${version}`]),
  };
}

async function pendingRemoteTag(origin: string, root: string, version: string) {
  const peer = join(root, `tag-peer-${version}`);
  git(root, ['clone', origin, peer]);
  git(peer, ['config', 'user.name', 'Racing Tagger']);
  git(peer, ['config', 'user.email', 'tag-race@example.test']);
  git(peer, ['tag', '-a', `v${version}`, '-m', `Release v${version}`], {
    GIT_COMMITTER_DATE: '2026-07-10T12:00:00+02:00',
  });
  return {
    publish: () => git(peer, ['push', 'origin', `v${version}`]),
  };
}

async function temporaryReleaseFiles(work: string) {
  return (await readdir(work)).filter(name => name.includes('.package.json.release-'));
}

async function prepare(work: string, options: Record<string, unknown> = {}) {
  const { prepareRelease } = await import('../../scripts/prepare-release.mjs');
  return prepareRelease({ cwd: work, now: NOW, runPostChecks: false, ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('prepare-release command with a real bare origin', () => {
  it('exports a programmatic entry point', async () => {
    const command = await import('../../scripts/prepare-release.mjs');
    expect(command.prepareRelease).toBeTypeOf('function');
  });

  it('prepares .1 on main from historical 0.1.1 and preserves two-space JSON/newline', async () => {
    const { work } = await fixture();
    const result = await prepare(work);

    expect(result.version).toBe('2026.710.1');
    expect(await packageText(work)).toBe(
      '{\n  "name": "fixture",\n  "version": "2026.710.1",\n  "private": true\n}\n',
    );
    expect(git(work, ['tag', '--list', 'v2026.710.1'])).toBe('');
    expect(result.instructions).toContain('git tag -a v2026.710.1');
  });

  it('rejects a non-main branch and a dirty worktree', async () => {
    const first = await fixture();
    git(first.work, ['switch', '-c', 'feature']);
    await expect(prepare(first.work)).rejects.toMatchObject({ code: 'NOT_ON_MAIN' });

    const second = await fixture();
    await writeFile(join(second.work, 'dirty.txt'), 'dirty');
    await expect(prepare(second.work)).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' });
  });

  it('does not write package.json when fetch fails', async () => {
    const { work } = await fixture();
    const before = await packageText(work);
    git(work, ['remote', 'set-url', 'origin', join(work, 'missing-origin.git')]);

    await expect(prepare(work)).rejects.toMatchObject({ code: 'TAG_FETCH_FAILED' });
    expect(await packageText(work)).toBe(before);
  });

  it('refetches before writing and rejects a real remote release race without changing package bytes', async () => {
    const { origin, root, work } = await fixture();
    const race = await pendingRemoteRelease(origin, root, '2026.710.1');
    const before = await packageText(work);
    let fetches = 0;
    const runner = (command: string, args: string[], options: Record<string, unknown>) => {
      const result = spawnSync(command, args, options);
      if (command === 'git' && args[0] === 'fetch') {
        fetches += 1;
        if (fetches === 1) race.publish();
      }
      return result;
    };

    await expect(prepare(work, { runner })).rejects.toMatchObject({ code: 'MAIN_NOT_CURRENT' });
    expect(fetches).toBe(2);
    expect(await packageText(work)).toBe(before);
  });

  it('rejects a remote-only tag race even when origin/main does not move', async () => {
    const { origin, root, work } = await fixture();
    const race = await pendingRemoteTag(origin, root, '2026.710.1');
    const before = await packageText(work);
    let fetches = 0;
    const runner = (command: string, args: string[], options: Record<string, unknown>) => {
      const result = spawnSync(command, args, options);
      if (command === 'git' && args[0] === 'fetch') {
        fetches += 1;
        if (fetches === 1) race.publish();
      }
      return result;
    };

    await expect(prepare(work, { runner })).rejects.toMatchObject({
      code: 'VERSION_COLLISION',
    });
    expect(fetches).toBe(2);
    expect(await packageText(work)).toBe(before);
  });

  it('maps a second fetch failure to TAG_FETCH_FAILED and preserves package bytes', async () => {
    const { work } = await fixture();
    const before = await packageText(work);
    let fetches = 0;
    const runner = (command: string, args: string[], options: Record<string, unknown>) => {
      const result = spawnSync(command, args, options);
      if (command === 'git' && args[0] === 'fetch') {
        fetches += 1;
        if (fetches === 1) {
          git(work, ['remote', 'set-url', 'origin', join(work, 'vanished-origin.git')]);
        }
      }
      return result;
    };

    await expect(prepare(work, { runner })).rejects.toMatchObject({ code: 'TAG_FETCH_FAILED' });
    expect(fetches).toBe(2);
    expect(await packageText(work)).toBe(before);
  });

  it('rejects a behind or diverged main but allows a locally-ahead main', async () => {
    const behind = await fixture();
    await remoteCommit(behind.origin, behind.root, 'remote-behind');
    await expect(prepare(behind.work)).rejects.toMatchObject({ code: 'MAIN_NOT_CURRENT' });

    const diverged = await fixture();
    await writeFile(join(diverged.work, 'local.txt'), 'local');
    git(diverged.work, ['add', '.']);
    git(diverged.work, ['commit', '-m', 'local']);
    await remoteCommit(diverged.origin, diverged.root, 'remote-diverged');
    await expect(prepare(diverged.work)).rejects.toMatchObject({ code: 'MAIN_NOT_CURRENT' });

    const ahead = await fixture();
    await writeFile(join(ahead.work, 'local.txt'), 'local');
    git(ahead.work, ['add', '.']);
    git(ahead.work, ['commit', '-m', 'local']);
    await expect(prepare(ahead.work)).resolves.toMatchObject({ version: '2026.710.1' });
  });

  it('strictly rejects malformed local and remote v* tags', async () => {
    const local = await fixture();
    git(local.work, ['tag', 'vbanana']);
    await expect(prepare(local.work)).rejects.toMatchObject({ code: 'INVALID_RELEASE_TAG' });

    const remote = await fixture();
    git(remote.work, ['tag', 'v2026.0710.1']);
    git(remote.work, ['push', 'origin', 'v2026.0710.1']);
    git(remote.work, ['tag', '-d', 'v2026.0710.1']);
    await expect(prepare(remote.work)).rejects.toMatchObject({ code: 'INVALID_RELEASE_TAG' });
  });

  it('rejects an invalid current version', async () => {
    const { work } = await fixture();
    await writePackage(work, '1.2');
    git(work, ['add', 'package.json']);
    git(work, ['commit', '-m', 'invalid version']);
    await expect(prepare(work)).rejects.toMatchObject({ code: 'INVALID_CURRENT_VERSION' });
  });

  it('requires current package version to be the highest published ancestor', async () => {
    const stale = await fixture();
    await publish(stale.work, '2026.710.1');
    await publish(stale.work, '2026.710.2');
    await writePackage(stale.work, '2026.710.1');
    git(stale.work, ['add', 'package.json']);
    git(stale.work, ['commit', '-m', 'stale package']);
    await expect(prepare(stale.work)).rejects.toMatchObject({ code: 'CURRENT_VERSION_NOT_LATEST' });

    const nonAncestor = await fixture();
    git(nonAncestor.work, ['switch', '-c', 'tag-side']);
    await writePackage(nonAncestor.work, '2026.710.1');
    git(nonAncestor.work, ['add', 'package.json']);
    git(nonAncestor.work, ['commit', '-m', 'side release']);
    git(nonAncestor.work, ['tag', '-a', 'v2026.710.1', '-m', 'side release']);
    git(nonAncestor.work, ['switch', 'main']);
    await writePackage(nonAncestor.work, '2026.710.1');
    git(nonAncestor.work, ['add', 'package.json']);
    git(nonAncestor.work, ['commit', '-m', 'claim side version']);
    await expect(prepare(nonAncestor.work)).rejects.toMatchObject({ code: 'CURRENT_VERSION_NOT_LATEST' });
  });

  it('uses the same-day maximum plus one and rejects the daily limit', async () => {
    const increment = await fixture();
    await publish(increment.work, '2026.710.1');
    await publish(increment.work, '2026.710.4');
    await expect(prepare(increment.work)).resolves.toMatchObject({ version: '2026.710.5' });

    const limit = await fixture();
    await publish(limit.work, '2026.710.99');
    await expect(prepare(limit.work)).rejects.toMatchObject({ code: 'DAILY_RELEASE_LIMIT' });
  });

  it('does not increment an unreleased CalVer twice and refreshes only an untagged version', async () => {
    const pending = await fixture();
    await writePackage(pending.work, '2026.709.1');
    git(pending.work, ['add', 'package.json']);
    git(pending.work, ['commit', '-m', 'prepared yesterday']);
    await expect(prepare(pending.work)).rejects.toMatchObject({ code: 'UNRELEASED_VERSION_EXISTS' });
    await expect(prepare(pending.work, { refreshUnreleased: true }))
      .resolves.toMatchObject({ version: '2026.710.1' });

    const published = await fixture();
    await publish(published.work, '2026.709.1', '2026-07-09T12:00:00+02:00');
    await expect(prepare(published.work, { refreshUnreleased: true }))
      .rejects.toMatchObject({ code: 'VERSION_COLLISION' });
  });

  it('rejects refreshing historical 0.1.1 because refresh requires an untagged CalVer', async () => {
    const { work } = await fixture();
    const before = await packageText(work);

    await expect(prepare(work, { refreshUnreleased: true })).rejects.toMatchObject({
      code: 'INVALID_CURRENT_VERSION',
      recovery: expect.stringContaining('CalVer'),
    });
    expect(await packageText(work)).toBe(before);
  });

  it('detects a tag collision introduced after version calculation', async () => {
    const { work } = await fixture();
    let tagLists = 0;
    const runner = (command: string, args: string[], options: Record<string, unknown>) => {
      if (command === 'git' && args[0] === 'tag' && args[1] === '--list') {
        tagLists += 1;
        if (tagLists === 2) git(work, ['tag', 'v2026.710.1']);
      }
      return spawnSync(command, args, options);
    };

    await expect(prepare(work, { runner })).rejects.toMatchObject({ code: 'VERSION_COLLISION' });
  });

  it('keeps the original file when the atomic same-directory rename fails', async () => {
    const { work } = await fixture();
    const before = await packageText(work);
    const fileSystem = {
      readFile,
      writeFile,
      unlink,
      rename: async () => { throw new Error('rename blocked'); },
    };

    await expect(prepare(work, { fileSystem })).rejects.toThrow('rename blocked');
    expect(await packageText(work)).toBe(before);
    expect(await temporaryReleaseFiles(work)).toEqual([]);
  });

  it('runs all postchecks against the candidate on disk and keeps it after success', async () => {
    const { work } = await fixture();
    const calls: Array<{ command: string; args: string[]; version: string }> = [];
    const checkRunner = (command: string, args: string[]) => {
      calls.push({
        command,
        args,
        version: JSON.parse(readFileSync(join(work, 'package.json'), 'utf8')).version,
      });
      return { status: 0, stdout: '', stderr: '' };
    };

    await expect(prepare(work, { runPostChecks: true, checkRunner }))
      .resolves.toMatchObject({ version: '2026.710.1' });
    expect(calls.map(call => [call.command, ...call.args])).toEqual([
      [process.execPath, 'scripts/validate-release-version.mjs', '--prepared'],
      ['corepack', 'pnpm', 'vitest', 'run', 'tests/release/versioning.test.ts'],
      [process.execPath, 'scripts/verify-dependency-policy.mjs'],
    ]);
    expect(calls.every(call => call.version === '2026.710.1')).toBe(true);
    expect(JSON.parse(await packageText(work)).version).toBe('2026.710.1');
  });

  it('atomically restores original bytes and cleans temporary files when a postcheck fails', async () => {
    const { work } = await fixture();
    const before = await packageText(work);
    const seenVersions: string[] = [];
    const checkRunner = () => {
      seenVersions.push(JSON.parse(readFileSync(join(work, 'package.json'), 'utf8')).version);
      return { status: 1, stdout: '', stderr: 'postcheck exploded' };
    };

    await expect(prepare(work, { runPostChecks: true, checkRunner }))
      .rejects.toThrow('postcheck exploded');
    expect(seenVersions).toEqual(['2026.710.1']);
    expect(await packageText(work)).toBe(before);
    expect(await temporaryReleaseFiles(work)).toEqual([]);
  });

  it('fails closed with both errors when postcheck rollback itself fails', async () => {
    const { work } = await fixture();
    let renames = 0;
    const fileSystem = {
      readFile,
      writeFile,
      unlink,
      rename: async (source: string, destination: string) => {
        renames += 1;
        if (renames === 2) throw new Error('rollback blocked');
        await rename(source, destination);
      },
    };
    const checkRunner = () => ({ status: 1, stdout: '', stderr: 'postcheck exploded' });

    await expect(prepare(work, { runPostChecks: true, checkRunner, fileSystem }))
      .rejects.toThrow(/postcheck exploded[\s\S]*rollback blocked/);
    expect(renames).toBe(2);
    expect(await temporaryReleaseFiles(work)).toEqual([]);
  });

  it('invokes Git shell-free with argument arrays', async () => {
    const { work } = await fixture();
    const calls: Array<{ command: string; args: string[]; shell: unknown }> = [];
    const runner = (command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, shell: options.shell });
      return spawnSync(command, args, options);
    };

    await prepare(work, { runner });
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every(call => call.command === 'git' && Array.isArray(call.args))).toBe(true);
    expect(calls.every(call => call.shell !== true)).toBe(true);
  });
});
