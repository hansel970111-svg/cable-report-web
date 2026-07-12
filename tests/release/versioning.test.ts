import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import {
  VersioningError,
  compareAppVersions,
  formatCalVer,
  nextReleaseVersion,
  parseCalVer,
  toMacBundleVersion,
} from '../../scripts/versioning.mjs';

const BERLIN = 'Europe/Berlin';

function expectVersioningError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected VersioningError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(VersioningError);
    expect(error).toMatchObject({ code, name: 'VersioningError' });
  }
}

describe('parseCalVer', () => {
  test.each([
    ['2000.101.1', 2000, 1, 1, 1],
    ['2026.105.1', 2026, 1, 5, 1],
    ['2026.710.2', 2026, 7, 10, 2],
    ['2026.1001.10', 2026, 10, 1, 10],
    ['2026.1231.99', 2026, 12, 31, 99],
    ['2024.229.1', 2024, 2, 29, 1],
    ['2099.1231.99', 2099, 12, 31, 99],
  ])(
    'parses %s using real calendar fields',
    (version, year, month, day, sequence) => {
      expect(parseCalVer(version)).toEqual({
        version,
        year,
        month,
        day,
        sequence,
      });
    },
  );

  test.each([
    '',
    '2026',
    '2026.710',
    '2026.710.1.0',
    'v2026.710.1',
    ' 2026.710.1',
    '2026.710.1 ',
    '02026.710.1',
    '2026.0710.1',
    '2026.710.01',
    '2026.+710.1',
    '2026.710.-1',
    '1999.1231.1',
    '2100.101.1',
    '2026.0.1',
    '2026.31.1',
    '2026.1331.1',
    '2026.229.1',
    '2024.230.1',
    '2026.431.1',
    '2026.631.1',
    '2026.931.1',
    '2026.1131.1',
    '2026.710.0',
    '2026.710.100',
    '2026.710.1-alpha',
  ])('returns null for invalid CalVer %j', version => {
    expect(parseCalVer(version)).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(parseCalVer(undefined as never)).toBeNull();
    expect(parseCalVer(20267101 as never)).toBeNull();
  });
});

describe('formatCalVer', () => {
  test.each([
    ['2000-01-01T12:00:00.000Z', 1, '2000.101.1'],
    ['2026-01-05T12:00:00.000Z', 1, '2026.105.1'],
    ['2026-07-10T12:00:00.000Z', 2, '2026.710.2'],
    ['2026-10-01T12:00:00.000Z', 10, '2026.1001.10'],
    ['2026-12-31T12:00:00.000Z', 99, '2026.1231.99'],
    ['2024-02-29T12:00:00.000Z', 1, '2024.229.1'],
    ['2099-12-31T12:00:00.000Z', 1, '2099.1231.1'],
  ])('formats Berlin date %s with sequence %i', (iso, sequence, expected) => {
    expect(formatCalVer(new Date(iso), sequence, BERLIN)).toBe(expected);
  });

  test.each([
    ['2026-03-29T00:59:59.999Z', '2026.329.1'],
    ['2026-03-29T01:00:00.000Z', '2026.329.1'],
    ['2026-10-25T00:59:59.999Z', '2026.1025.1'],
    ['2026-10-25T01:00:00.000Z', '2026.1025.1'],
    ['2026-07-09T21:59:59.999Z', '2026.709.1'],
    ['2026-07-09T22:00:00.000Z', '2026.710.1'],
  ])('uses the Berlin calendar across DST boundary instant %s', (iso, expected) => {
    expect(formatCalVer(new Date(iso), 1, BERLIN)).toBe(expected);
  });

  test.each([0, -1, 1.5, 100, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid release sequence %j',
    sequence => {
      expectVersioningError(
        () => formatCalVer(new Date('2026-07-10T12:00:00Z'), sequence, BERLIN),
        'INVALID_SEQUENCE',
      );
    },
  );

  test('rejects unapproved time zones explicitly', () => {
    expectVersioningError(
      () => formatCalVer(new Date('2026-07-10T12:00:00Z'), 1, 'UTC' as never),
      'INVALID_TIME_ZONE',
    );
    expectVersioningError(
      () => formatCalVer(new Date('2026-07-10T12:00:00Z'), 1, undefined as never),
      'INVALID_TIME_ZONE',
    );
  });

  test.each([
    new Date(Number.NaN),
    new Date('1999-12-31T12:00:00Z'),
    new Date('2100-01-01T12:00:00Z'),
  ])('rejects invalid or unsupported dates', date => {
    expectVersioningError(
      () => formatCalVer(date, 1, BERLIN),
      'INVALID_DATE',
    );
  });
});

describe('compareAppVersions', () => {
  test.each([
    ['0.1.1', '2026.101.1', -1],
    ['2026.105.1', '2026.710.1', -1],
    ['2026.710.1', '2026.710.2', -1],
    ['2026.710.2', '2026.710.10', -1],
    ['2026.1231.99', '2027.101.1', -1],
    ['1.10.0', '1.2.99', 1],
    ['2026.710.10', '2026.710.2', 1],
    ['2026.710.1', '2026.710.1', 0],
  ])('compares %s and %s numerically', (left, right, direction) => {
    expect(Math.sign(compareAppVersions(left, right))).toBe(direction);
  });

  test.each([
    ['', '0.1.1'],
    ['v2026.710.1', '0.1.1'],
    ['2026.0710.1', '0.1.1'],
    ['2026.710.01', '0.1.1'],
    ['2026.710', '0.1.1'],
    ['2026.710.1.0', '0.1.1'],
    ['2026.710.1-alpha', '0.1.1'],
    ['2026.710.1', ' 0.1.1'],
    ['2026.710.1', '1.2.9007199254740992'],
  ])('fails closed for malformed version pair %j / %j', (left, right) => {
    expectVersioningError(
      () => compareAppVersions(left, right),
      'INVALID_APP_VERSION',
    );
  });
});

describe('toMacBundleVersion', () => {
  test.each([
    ['2000.101.1', '1.1.1'],
    ['2026.105.1', '2601.5.1'],
    ['2026.710.2', '2607.10.2'],
    ['2026.1001.10', '2610.1.10'],
    ['2026.1231.10', '2612.31.10'],
    ['2099.1231.99', '9912.31.99'],
  ])('maps public version %s to Apple bundle version %s', (version, expected) => {
    expect(toMacBundleVersion(version)).toBe(expected);
  });

  test.each(['0.1.1', 'v2026.710.1', '2026.229.1', '2026.710.100']) (
    'rejects invalid public CalVer %j',
    version => {
      expectVersioningError(
        () => toMacBundleVersion(version),
        'INVALID_CALVER',
      );
    },
  );
});

describe('nextReleaseVersion', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');

  test.each([
    [[], '2026.710.1'],
    [['v0.1.1'], '2026.710.1'],
    [['v2026.709.99', 'v2026.701.4'], '2026.710.1'],
    [['v2026.710.1'], '2026.710.2'],
    [['v2026.710.10', 'v2026.710.2', 'v2025.710.99'], '2026.710.11'],
    [['v2026.710.98', 'v2026.710.10'], '2026.710.99'],
  ])('chooses the maximum published daily sequence for %j', (publishedTags, expected) => {
    expect(nextReleaseVersion({ now, timeZone: BERLIN, publishedTags })).toBe(expected);
  });

  test.each([
    ['2026-01-31T22:59:59.999Z', '2026.131.1'],
    ['2026-01-31T23:00:00.000Z', '2026.201.1'],
    ['2026-12-31T22:59:59.999Z', '2026.1231.1'],
    ['2026-12-31T23:00:00.000Z', '2027.101.1'],
  ])('advances across Berlin day/month/year at %s', (iso, expected) => {
    expect(
      nextReleaseVersion({
        now: new Date(iso),
        timeZone: BERLIN,
        publishedTags: ['v0.1.1'],
      }),
    ).toBe(expected);
  });

  test('rejects the one-hundredth release on a Berlin date', () => {
    expectVersioningError(
      () => nextReleaseVersion({
        now,
        timeZone: BERLIN,
        publishedTags: ['v2026.710.99'],
      }),
      'DAILY_RELEASE_LIMIT',
    );
  });

  test.each([
    ['2026.710.1'],
    ['vx'],
    ['v1.2.3'],
    ['v2026.0710.1'],
    ['v2026.229.1'],
    ['v2026.710.100'],
    ['v0.1.2'],
  ])('rejects invalid published tag set %j', publishedTags => {
    expectVersioningError(
      () => nextReleaseVersion({ now, timeZone: BERLIN, publishedTags }),
      'INVALID_RELEASE_TAG',
    );
  });

  test('rejects invalid date, zone, and tag container inputs', () => {
    expectVersioningError(
      () => nextReleaseVersion(null as never),
      'INVALID_DATE',
    );
    expectVersioningError(
      () => nextReleaseVersion({
        now: new Date(Number.NaN),
        timeZone: BERLIN,
        publishedTags: [],
      }),
      'INVALID_DATE',
    );
    expectVersioningError(
      () => nextReleaseVersion({ now, timeZone: 'UTC' as never, publishedTags: [] }),
      'INVALID_TIME_ZONE',
    );
    expectVersioningError(
      () => nextReleaseVersion({ now, timeZone: BERLIN, publishedTags: null as never }),
      'INVALID_RELEASE_TAG',
    );
  });
});

test('the version core has no side-effect dependencies or ambient version state', async () => {
  const source = await readFile('scripts/versioning.mjs', 'utf8');

  expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net)/);
  expect(source).not.toMatch(/\bprocess\b/);
  expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest)\s*\(/);
  expect(source).not.toMatch(/Date\.now\s*\(/);
  expect(source).not.toMatch(/toLocale(?:Date|Time)?String\s*\(/);
});
