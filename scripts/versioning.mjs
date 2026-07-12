const APPROVED_TIME_ZONE = 'Europe/Berlin';
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;
const MAX_DAILY_SEQUENCE = 99;

export const VERSION_ERROR_CODES = Object.freeze({
  INVALID_DATE: 'INVALID_DATE',
  INVALID_SEQUENCE: 'INVALID_SEQUENCE',
  INVALID_TIME_ZONE: 'INVALID_TIME_ZONE',
  INVALID_APP_VERSION: 'INVALID_APP_VERSION',
  INVALID_CALVER: 'INVALID_CALVER',
  INVALID_RELEASE_TAG: 'INVALID_RELEASE_TAG',
  DAILY_RELEASE_LIMIT: 'DAILY_RELEASE_LIMIT',
});

export class VersioningError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VersioningError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new VersioningError(code, message);
}

function isRealCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function assertTimeZone(timeZone) {
  if (timeZone !== APPROVED_TIME_ZONE) {
    fail(
      VERSION_ERROR_CODES.INVALID_TIME_ZONE,
      `Unsupported release time zone: ${String(timeZone)}`,
    );
  }
}

function assertSequence(sequence) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_DAILY_SEQUENCE) {
    fail(
      VERSION_ERROR_CODES.INVALID_SEQUENCE,
      `Release sequence must be an integer from 1 to ${MAX_DAILY_SEQUENCE}`,
    );
  }
}

function getZonedCalendarDate(date, timeZone) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    fail(VERSION_ERROR_CODES.INVALID_DATE, 'Release date must be a valid Date');
  }
  assertTimeZone(timeZone);

  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(part => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map(part => [part.type, Number(part.value)]),
  );
  const { year, month, day } = values;

  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || year < MIN_YEAR
    || year > MAX_YEAR
    || !isRealCalendarDate(year, month, day)
  ) {
    fail(
      VERSION_ERROR_CODES.INVALID_DATE,
      `Release date must be within ${MIN_YEAR}-${MAX_YEAR} in ${APPROVED_TIME_ZONE}`,
    );
  }

  return { year, month, day };
}

function parseNumericTriple(version) {
  if (typeof version !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;

  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function parseCalVer(version) {
  if (typeof version !== 'string') return null;
  const match = /^([1-9]\d{3})\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;

  const year = Number(match[1]);
  const monthDay = Number(match[2]);
  const sequence = Number(match[3]);
  const month = Math.floor(monthDay / 100);
  const day = monthDay % 100;

  if (
    year < MIN_YEAR
    || year > MAX_YEAR
    || !Number.isSafeInteger(monthDay)
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > MAX_DAILY_SEQUENCE
    || !isRealCalendarDate(year, month, day)
  ) {
    return null;
  }

  return { version, year, month, day, sequence };
}

export function formatCalVer(date, sequence, timeZone) {
  assertSequence(sequence);
  const { year, month, day } = getZonedCalendarDate(date, timeZone);
  return `${year}.${month * 100 + day}.${sequence}`;
}

export function compareAppVersions(left, right) {
  const leftParts = parseNumericTriple(left);
  const rightParts = parseNumericTriple(right);
  if (!leftParts || !rightParts) {
    fail(
      VERSION_ERROR_CODES.INVALID_APP_VERSION,
      'Application versions must contain exactly three canonical numeric parts',
    );
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function toMacBundleVersion(version) {
  const parsed = parseCalVer(version);
  if (!parsed) {
    fail(VERSION_ERROR_CODES.INVALID_CALVER, `Invalid public CalVer: ${String(version)}`);
  }

  const firstPart = (parsed.year % 100) * 100 + parsed.month;
  return `${firstPart}.${parsed.day}.${parsed.sequence}`;
}

export function nextReleaseVersion(input = {}) {
  const { now, timeZone, publishedTags } = input ?? {};
  const releaseDate = getZonedCalendarDate(now, timeZone);
  if (!Array.isArray(publishedTags)) {
    fail(VERSION_ERROR_CODES.INVALID_RELEASE_TAG, 'Published tags must be an array');
  }

  let maximumSequence = 0;
  for (const tag of publishedTags) {
    if (tag === 'v0.1.1') continue;
    if (typeof tag !== 'string' || !tag.startsWith('v')) {
      fail(VERSION_ERROR_CODES.INVALID_RELEASE_TAG, `Invalid release tag: ${String(tag)}`);
    }

    const parsed = parseCalVer(tag.slice(1));
    if (!parsed) {
      fail(VERSION_ERROR_CODES.INVALID_RELEASE_TAG, `Invalid release tag: ${tag}`);
    }

    if (
      parsed.year === releaseDate.year
      && parsed.month === releaseDate.month
      && parsed.day === releaseDate.day
    ) {
      maximumSequence = Math.max(maximumSequence, parsed.sequence);
    }
  }

  const nextSequence = maximumSequence + 1;
  if (nextSequence > MAX_DAILY_SEQUENCE) {
    fail(
      VERSION_ERROR_CODES.DAILY_RELEASE_LIMIT,
      `The ${MAX_DAILY_SEQUENCE}-release daily limit has been reached`,
    );
  }

  return formatCalVer(now, nextSequence, timeZone);
}
